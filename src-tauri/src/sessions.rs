//! Past Claude Code sessions, read from the transcript directory.

use crate::home;
use serde::Serialize;
use std::cmp::Reverse;
use std::collections::HashMap;
use std::io::BufRead;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

/// A past session, as offered by the resume picker.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    /// The session id, which is the transcript's file name.
    pub id: String,
    /// Last write time, in milliseconds since the epoch.
    pub modified: u64,
    /// Size in bytes, a rough proxy for how much is in the session.
    pub bytes: u64,
    /// The first thing the user asked, for recognition.
    pub preview: String,
}

/// Returns the transcript directory for a working directory.
///
/// Claude Code names the folder after the path with every non-alphanumeric
/// character replaced by a dash.
fn project_dir(cwd: &str) -> Option<PathBuf> {
    let slug: String = cwd
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    home::home_dir().map(|dir| dir.join(".claude").join("projects").join(slug))
}

/// Reads the first user message from a transcript, for display in a list.
fn read_preview(path: &Path) -> String {
    let file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(_) => return String::new(),
    };

    for line in std::io::BufReader::new(file).lines().take(400).flatten() {
        let value: serde_json::Value = match serde_json::from_str(&line) {
            Ok(value) => value,
            Err(_) => continue,
        };
        if value.get("type").and_then(|t| t.as_str()) != Some("user") {
            continue;
        }
        let content = value.get("message").and_then(|m| m.get("content"));
        let text = match content {
            Some(serde_json::Value::String(text)) => text.clone(),
            Some(serde_json::Value::Array(blocks)) => blocks
                .iter()
                .find_map(|block| {
                    if block.get("type").and_then(|t| t.as_str()) == Some("text") {
                        block
                            .get("text")
                            .and_then(|t| t.as_str())
                            .map(str::to_string)
                    } else {
                        None
                    }
                })
                .unwrap_or_default(),
            _ => continue,
        };

        if value
            .get("isCompactSummary")
            .and_then(|flag| flag.as_bool())
            == Some(true)
        {
            continue;
        }

        let collapsed = text.split_whitespace().collect::<Vec<_>>().join(" ");
        if collapsed.is_empty()
            || collapsed.starts_with('<')
            || collapsed.starts_with("[Request interrupted by user")
        {
            continue;
        }
        return collapsed.chars().take(120).collect();
    }

    String::new()
}

/// The most records of a subagent's own transcript that are replayed.
///
/// A report and the work that led to it can be long, but a card is a summary of
/// a run rather than a file viewer. The tail is kept, so the handback and the
/// report it carried are always there.
const MAX_SUBAGENT_FRAMES: usize = 1000;

/// Reads the text out of a message's content.
///
/// Content is either a bare string or a list of blocks, and only the text blocks
/// are wanted: the rest is tool traffic.
fn content_text(content: Option<&serde_json::Value>) -> Option<String> {
    match content? {
        serde_json::Value::String(text) => Some(text.clone()),
        serde_json::Value::Array(blocks) => Some(
            blocks
                .iter()
                .filter(|block| block.get("type").and_then(|kind| kind.as_str()) == Some("text"))
                .filter_map(|block| block.get("text").and_then(|text| text.as_str()))
                .collect::<Vec<_>>()
                .join(""),
        ),
        _ => None,
    }
}

/// Whether a message's content carries any tool results.
fn has_tool_result(content: Option<&serde_json::Value>) -> bool {
    matches!(
        content,
        Some(serde_json::Value::Array(blocks))
            if blocks
                .iter()
                .any(|block| block.get("type").and_then(|kind| kind.as_str()) == Some("tool_result"))
    )
}

/// Whether a name is safe to join to a path.
fn is_safe_name(name: &str) -> bool {
    !name.is_empty()
        && name.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '-' || character == '_'
        })
}

/// Reads every record in a transcript file.
fn read_records(path: &Path) -> Vec<serde_json::Value> {
    let Ok(file) = std::fs::File::open(path) else {
        return Vec::new();
    };

    std::io::BufReader::new(file)
        .lines()
        .map_while(Result::ok)
        .filter_map(|line| serde_json::from_str(&line).ok())
        .collect()
}

/// Where one subagent's own transcript lives.
fn subagent_path(dir: &Path, session_id: &str, agent_id: &str) -> PathBuf {
    dir.join(session_id)
        .join("subagents")
        .join(format!("agent-{agent_id}.jsonl"))
}

/// Whether a record is a prompt the reader sent.
///
/// A queued message is written as an attachment rather than a `user` record, so
/// it counts as one the same way a prompt does. A compaction summary is written
/// as a user record too, and opens the conversation that follows it.
fn is_user_prompt(value: &serde_json::Value) -> bool {
    if value.get("isMeta").and_then(|meta| meta.as_bool()) == Some(true) {
        return false;
    }
    if value
        .get("isCompactSummary")
        .and_then(|flag| flag.as_bool())
        == Some(true)
    {
        return true;
    }

    match value.get("type").and_then(|kind| kind.as_str()) {
        Some("user") => {
            let content = value.pointer("/message/content");
            if has_tool_result(content) {
                return false;
            }
            let text = content_text(content).unwrap_or_default();
            !text.trim().is_empty() && !text.starts_with('<')
        }
        Some("attachment") => {
            value
                .pointer("/attachment/type")
                .and_then(|kind| kind.as_str())
                == Some("queued_command")
        }
        _ => false,
    }
}

/// Whether a record is something that was said, rather than tool traffic.
fn is_spoken_message(value: &serde_json::Value) -> bool {
    if is_user_prompt(value) {
        return true;
    }

    if value.get("type").and_then(|kind| kind.as_str()) != Some("assistant") {
        return false;
    }

    let text = content_text(value.pointer("/message/content")).unwrap_or_default();
    !text.trim().is_empty() && !text.starts_with('<')
}

/// Finds where the last `limit` spoken messages begin.
///
/// The window is moved back to the prompt that opened the turn, so the assistant
/// reply and every tool call it made are all inside it. That matters because a
/// turn can hold far more records than it has words.
fn replay_start(records: &[serde_json::Value], limit: usize) -> usize {
    if limit == 0 {
        return records.len();
    }

    let mut spoken = Vec::new();
    for (index, record) in records.iter().enumerate() {
        if is_spoken_message(record) {
            spoken.push(index);
        }
    }

    if spoken.len() <= limit {
        return 0;
    }

    let cutoff = spoken[spoken.len() - limit];
    for index in (0..=cutoff).rev() {
        if is_user_prompt(&records[index]) {
            return index;
        }
    }
    cutoff
}

/// What one subagent's transcript contributes to a replay.
struct SubagentReplay {
    /// The frames for the card's own transcript.
    frames: Vec<serde_json::Value>,
    /// True when the agent handed its report back.
    completed: bool,
    /// The report, as the handback carried it.
    report: String,
}

/// Reads one subagent's transcript into frames for its card.
fn read_subagent(path: &Path, parent_tool_use_id: &str) -> SubagentReplay {
    let records = read_records(path);
    let mut frames = Vec::new();
    let mut completed = false;
    let mut report = String::new();
    let mut last_text = String::new();
    let mut handback_id = String::new();

    for record in &records {
        if record.get("isMeta").and_then(|meta| meta.as_bool()) == Some(true) {
            continue;
        }

        match record.get("type").and_then(|kind| kind.as_str()) {
            Some("assistant") => {
                let Some(content) = record.pointer("/message/content") else {
                    continue;
                };

                if let Some(blocks) = content.as_array() {
                    for block in blocks {
                        match block.get("type").and_then(|kind| kind.as_str()) {
                            Some("text") => {
                                if let Some(text) = block.get("text").and_then(|text| text.as_str())
                                {
                                    if !text.trim().is_empty() {
                                        last_text = text.to_string();
                                    }
                                }
                            }
                            Some("tool_use")
                                if block.get("name").and_then(|name| name.as_str())
                                    == Some("SubagentHandback") =>
                            {
                                if let Some(id) = block.get("id").and_then(|id| id.as_str()) {
                                    handback_id = id.to_string();
                                }
                                if let Some(message) = block
                                    .pointer("/input/message")
                                    .and_then(|message| message.as_str())
                                {
                                    if !message.trim().is_empty() {
                                        report = message.to_string();
                                    }
                                }
                            }
                            _ => {}
                        }
                    }
                }

                frames.push(serde_json::json!({
                    "type": "assistant",
                    "parent_tool_use_id": parent_tool_use_id,
                    "message": { "content": content },
                }));
            }
            Some("user") => {
                let Some(content) = record.pointer("/message/content") else {
                    continue;
                };
                if !has_tool_result(Some(content)) {
                    continue;
                }

                if !handback_id.is_empty()
                    && content.as_array().is_some_and(|blocks| {
                        blocks.iter().any(|block| {
                            block.get("type").and_then(|kind| kind.as_str()) == Some("tool_result")
                                && block.get("tool_use_id").and_then(|id| id.as_str())
                                    == Some(handback_id.as_str())
                        })
                    })
                {
                    completed = true;
                }

                let mut frame = serde_json::json!({
                    "type": "user",
                    "parent_tool_use_id": parent_tool_use_id,
                    "message": { "content": content },
                });
                if let Some(structured) = record.get("toolUseResult") {
                    frame["tool_use_result"] = structured.clone();
                }
                frames.push(frame);
            }
            _ => {}
        }
    }

    if frames.len() > MAX_SUBAGENT_FRAMES {
        let start = frames.len() - MAX_SUBAGENT_FRAMES;
        frames = frames.split_off(start);
    }

    if report.is_empty() {
        report = last_text;
    }

    SubagentReplay {
        frames,
        completed,
        report,
    }
}

/// Whether a tool result is the CLI acknowledging an agent started in the
/// background.
fn is_async_launch(structured: Option<&serde_json::Value>) -> bool {
    let Some(record) = structured else {
        return false;
    };
    record.get("isAsync").and_then(|flag| flag.as_bool()) == Some(true)
        && record.get("status").and_then(|status| status.as_str()) == Some("async_launched")
}

/// Builds the frame for a message's tool results.
fn result_frame(
    results: &[serde_json::Value],
    structured: Option<&serde_json::Value>,
) -> serde_json::Value {
    let mut frame = serde_json::json!({
        "type": "user",
        "message": { "content": results },
    });
    if let Some(structured) = structured {
        frame["tool_use_result"] = structured.clone();
    }
    frame
}

/// Builds the frame that says a background agent has finished.
fn completion_frame(tool_use_id: &str, report: &str) -> serde_json::Value {
    serde_json::json!({
        "type": "user",
        "message": { "content": [{ "type": "tool_result", "tool_use_id": tool_use_id }] },
        "tool_use_result": {
            "status": "completed",
            "handbackReport": { "text": report },
        },
    })
}

/// Adds the frames for one `user` record.
fn append_user_record(
    record: &serde_json::Value,
    dir: &Path,
    session_id: &str,
    frames: &mut Vec<serde_json::Value>,
) {
    let Some(content) = record.pointer("/message/content") else {
        return;
    };

    if record
        .get("isCompactSummary")
        .and_then(|flag| flag.as_bool())
        == Some(true)
    {
        frames.push(serde_json::json!({
            "type": "user",
            "isCompactSummary": true,
            "message": { "content": content },
        }));
        return;
    }

    if has_tool_result(Some(content)) {
        let results: Vec<serde_json::Value> = content
            .as_array()
            .map(|blocks| {
                blocks
                    .iter()
                    .filter(|block| {
                        block.get("type").and_then(|kind| kind.as_str()) == Some("tool_result")
                    })
                    .cloned()
                    .collect()
            })
            .unwrap_or_default();
        if results.is_empty() {
            return;
        }

        let structured = record.get("toolUseResult");
        if results.len() == 1 {
            let tool_use_id = results[0]
                .get("tool_use_id")
                .and_then(|id| id.as_str())
                .unwrap_or_default();
            let agent_id = structured
                .and_then(|result| result.get("agentId"))
                .and_then(|id| id.as_str())
                .unwrap_or_default();

            if !tool_use_id.is_empty() && !agent_id.is_empty() && is_safe_name(agent_id) {
                let subagent =
                    read_subagent(&subagent_path(dir, session_id, agent_id), tool_use_id);
                if is_async_launch(structured) {
                    frames.push(result_frame(&results, structured));
                    frames.extend(subagent.frames);
                    if subagent.completed {
                        frames.push(completion_frame(tool_use_id, &subagent.report));
                    }
                } else {
                    frames.extend(subagent.frames);
                    frames.push(result_frame(&results, structured));
                }
                return;
            }
        }

        frames.push(result_frame(&results, structured));
        return;
    }

    let text = content_text(Some(content)).unwrap_or_default();
    if text.trim().is_empty() || text.starts_with('<') {
        return;
    }

    frames.push(serde_json::json!({
        "type": "user",
        "message": { "content": content },
    }));
}

/// Adds the frames for one record, if it says anything a replay needs.
fn append_parent_frames(
    record: &serde_json::Value,
    dir: &Path,
    session_id: &str,
    frames: &mut Vec<serde_json::Value>,
) {
    if record.get("isMeta").and_then(|meta| meta.as_bool()) == Some(true) {
        return;
    }

    match record.get("type").and_then(|kind| kind.as_str()) {
        Some("assistant") => {
            let Some(content) = record.pointer("/message/content") else {
                return;
            };
            if !content.as_array().is_some_and(|blocks| !blocks.is_empty()) {
                return;
            }
            frames.push(serde_json::json!({
                "type": "assistant",
                "message": { "content": content },
            }));
        }
        Some("user") => append_user_record(record, dir, session_id, frames),
        Some("attachment") => {
            if record
                .pointer("/attachment/type")
                .and_then(|kind| kind.as_str())
                != Some("queued_command")
            {
                return;
            }
            let Some(prompt) = record.pointer("/attachment/prompt") else {
                return;
            };
            frames.push(serde_json::json!({
                "type": "user",
                "message": { "content": prompt },
            }));
        }
        _ => {}
    }
}

/// Builds the replay frames for a list of transcript records.
fn replay_records(
    records: &[serde_json::Value],
    dir: &Path,
    session_id: &str,
    limit: usize,
) -> Vec<serde_json::Value> {
    let start = replay_start(records, limit);
    let mut frames = Vec::new();
    for record in &records[start..] {
        append_parent_frames(record, dir, session_id, &mut frames);
    }
    frames
}

/// Reads a stored session as frames the chat can replay.
///
/// The frames are the same shapes the live stream uses, so the transcript is
/// rebuilt by the same reducers rather than by a second interpretation of it.
/// A subagent's card brings its own transcript with it, read from the file the
/// CLI keeps beside the session.
#[tauri::command]
pub fn read_session_replay(cwd: String, id: String, limit: usize) -> Vec<serde_json::Value> {
    let Some(dir) = project_dir(&cwd) else {
        return Vec::new();
    };
    if !is_safe_name(&id) {
        return Vec::new();
    }

    let records = read_records(&dir.join(format!("{id}.jsonl")));
    replay_records(&records, &dir, &id, limit)
}

#[cfg(test)]
mod tests {
    use super::{is_spoken_message, is_user_prompt, replay_records, replay_start};
    use serde_json::json;
    use std::path::Path;

    /// The window starts at a prompt rather than at a record, so a turn's tool
    /// calls are never cut away from the message that asked for them.
    #[test]
    fn starts_the_window_at_the_prompt_that_opened_the_turn() {
        let records: Vec<serde_json::Value> = vec![
            json!({"type": "user", "message": {"content": [{"type": "text", "text": "one"}]}}),
            json!({"type": "assistant", "message": {"content": [{"type": "text", "text": "a"}]}}),
            json!({"type": "user", "message": {"content": [{"type": "text", "text": "two"}]}}),
            json!({"type": "assistant", "message": {"content": [{"type": "text", "text": "b"}]}}),
        ];

        assert_eq!(replay_start(&records, 1), 2);
        assert_eq!(replay_start(&records, 2), 2);
        assert_eq!(replay_start(&records, 4), 0);
        assert_eq!(replay_start(&records, 0), records.len());
    }

    /// A cutoff in the middle of a reply moves back to the prompt, which keeps
    /// the turn's tool calls with it.
    #[test]
    fn moves_a_cutoff_in_the_middle_of_a_reply_back_to_its_prompt() {
        let records: Vec<serde_json::Value> = vec![
            json!({"type": "user", "message": {"content": [{"type": "text", "text": "one"}]}}),
            json!({"type": "assistant", "message": {"content": [{"type": "text", "text": "a"}]}}),
            json!({"type": "user", "message": {"content": [{"type": "text", "text": "two"}]}}),
            json!({"type": "assistant", "message": {"content": [{"type": "tool_use", "id": "t1", "name": "Bash", "input": {"command": "ls"}}]}}),
            json!({"type": "assistant", "message": {"content": [{"type": "text", "text": "b"}]}}),
        ];

        assert_eq!(replay_start(&records, 1), 2);
    }

    #[test]
    fn counts_a_queued_message_and_a_summary_as_spoken_but_not_tool_traffic() {
        let queued = json!({"type": "attachment", "attachment": {"type": "queued_command", "prompt": [{"type": "text", "text": "mid-turn"}]}});
        let summary =
            json!({"type": "user", "isCompactSummary": true, "message": {"content": "before"}});
        let results = json!({"type": "user", "message": {"content": [{"type": "tool_result", "content": "x"}]}});
        let wrapper = json!({"type": "user", "message": {"content": [{"type": "text", "text": "<system-reminder>"}]}});
        let reply = json!({"type": "assistant", "message": {"content": [{"type": "text", "text": "hello"}]}});
        let tool_only = json!({"type": "assistant", "message": {"content": [{"type": "tool_use", "id": "t1", "name": "Bash", "input": {"command": "ls"}}]}});

        assert!(is_user_prompt(&queued));
        assert!(is_user_prompt(&summary));
        assert!(!is_user_prompt(&results));
        assert!(!is_user_prompt(&wrapper));
        assert!(is_spoken_message(&reply));
        assert!(!is_spoken_message(&tool_only));
    }

    #[test]
    fn replays_a_queued_message_as_a_user_message() {
        let records = vec![
            json!({"type": "attachment", "attachment": {"type": "queued_command", "prompt": [{"type": "text", "text": "mid-turn"}]}}),
        ];

        let frames = replay_records(&records, Path::new("."), "s1", 10);
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0]["type"], "user");
        assert_eq!(frames[0]["message"]["content"][0]["text"], "mid-turn");
    }

    #[test]
    fn replays_a_compaction_summary_as_a_summary() {
        let records = vec![json!({
            "type": "user",
            "isCompactSummary": true,
            "message": {"content": "This session is being continued."},
        })];

        let frames = replay_records(&records, Path::new("."), "s1", 10);
        assert_eq!(frames[0]["isCompactSummary"], true);
        assert_eq!(
            frames[0]["message"]["content"],
            "This session is being continued."
        );
    }

    /// The subagent's own transcript is beside the session, and its frames are
    /// tagged with the call that spawned it so the reducer files them in the
    /// card rather than in the main conversation.
    #[test]
    fn reads_a_foreground_subagents_transcript_into_its_card() {
        let dir = std::env::temp_dir().join(format!("terminice-replay-{}", uuid::Uuid::new_v4()));
        let session = "session-1";
        let agents = dir.join(session).join("subagents");
        std::fs::create_dir_all(&agents).expect("the agent folder");

        let agent_records = [
            json!({"type": "user", "message": {"content": [{"type": "text", "text": "find it"}]}}),
            json!({"type": "assistant", "message": {"content": [{"type": "text", "text": "working"}]}}),
            json!({"type": "assistant", "message": {"content": [{"type": "tool_use", "id": "handback", "name": "SubagentHandback", "input": {"message": "the report"}}]}}),
            json!({"type": "user", "message": {"content": [{"type": "tool_result", "tool_use_id": "handback", "content": "ok"}]}}),
        ];
        let agent_text = agent_records
            .iter()
            .map(|record| record.to_string())
            .collect::<Vec<_>>()
            .join("\n");
        std::fs::write(agents.join("agent-a1.jsonl"), agent_text).expect("the agent transcript");

        let parent = vec![
            json!({"type": "user", "message": {"content": [{"type": "text", "text": "go"}]}}),
            json!({"type": "assistant", "message": {"content": [{"type": "tool_use", "id": "call-1", "name": "Agent", "input": {"description": "Explore"}}]}}),
            json!({
                "type": "user",
                "message": {"content": [{"type": "tool_result", "tool_use_id": "call-1"}]},
                "toolUseResult": {"status": "completed", "agentId": "a1", "handbackReport": {"text": "the report"}},
            }),
        ];

        let frames = replay_records(&parent, &dir, session, 10);
        let tagged: Vec<&serde_json::Value> = frames
            .iter()
            .filter(|frame| {
                frame.get("parent_tool_use_id").and_then(|id| id.as_str()) == Some("call-1")
            })
            .collect();

        assert_eq!(
            tagged.len(),
            3,
            "the reply, the handback call and its result"
        );
        assert_eq!(tagged[0]["type"], "assistant");
        assert_eq!(tagged[0]["message"]["content"][0]["text"], "working");
        assert_eq!(tagged[2]["type"], "user");
        assert_eq!(
            frames.last().unwrap()["message"]["content"][0]["tool_use_id"],
            "call-1"
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    /// A background agent's launch is only an acknowledgement, so the replay
    /// adds the completion the parent transcript does not carry.
    #[test]
    fn completes_a_background_subagent_from_its_own_transcript() {
        let dir = std::env::temp_dir().join(format!("terminice-replay-{}", uuid::Uuid::new_v4()));
        let session = "session-1";
        let agents = dir.join(session).join("subagents");
        std::fs::create_dir_all(&agents).expect("the agent folder");

        let agent_records = [
            json!({"type": "assistant", "message": {"content": [{"type": "tool_use", "id": "handback", "name": "SubagentHandback", "input": {"message": "background report"}}]}}),
            json!({"type": "user", "message": {"content": [{"type": "tool_result", "tool_use_id": "handback", "content": "ok"}]}}),
        ];
        let agent_text = agent_records
            .iter()
            .map(|record| record.to_string())
            .collect::<Vec<_>>()
            .join("\n");
        std::fs::write(agents.join("agent-a2.jsonl"), agent_text).expect("the agent transcript");

        let parent = vec![
            json!({"type": "assistant", "message": {"content": [{"type": "tool_use", "id": "call-2", "name": "Agent", "input": {"description": "Background"}}]}}),
            json!({
                "type": "user",
                "message": {"content": [{"type": "tool_result", "tool_use_id": "call-2"}]},
                "toolUseResult": {"status": "async_launched", "isAsync": true, "agentId": "a2"},
            }),
        ];

        let frames = replay_records(&parent, &dir, session, 10);
        let completion = frames.last().expect("a completion frame");

        assert_eq!(completion["tool_use_result"]["status"], "completed");
        assert_eq!(
            completion["tool_use_result"]["handbackReport"]["text"],
            "background report"
        );

        std::fs::remove_dir_all(&dir).ok();
    }
}

/// Path of the record of sessions left waiting on a decision.
fn interrupted_path() -> Option<PathBuf> {
    home::home_dir().map(|dir| dir.join(".config").join("terminice-interrupted.json"))
}

fn read_interrupted() -> HashMap<String, String> {
    interrupted_path()
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn write_interrupted(map: &HashMap<String, String>) -> Result<(), String> {
    let path = interrupted_path().ok_or("no home directory is available")?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let text = serde_json::to_string_pretty(map).map_err(|error| error.to_string())?;
    std::fs::write(path, text).map_err(|error| error.to_string())
}

/// Records that a session is waiting on a decision.
///
/// Written when the prompt arrives rather than when the session ends, so a
/// crash or a hard close cannot lose it.
#[tauri::command]
pub fn remember_interrupted(session_id: String, tool: String) -> Result<(), String> {
    if session_id.is_empty() {
        return Ok(());
    }
    let mut map = read_interrupted();
    map.insert(session_id, tool);
    write_interrupted(&map)
}

/// Forgets that a session was waiting, once the decision has been made.
#[tauri::command]
pub fn forget_interrupted(session_id: String) -> Result<(), String> {
    let mut map = read_interrupted();
    if map.remove(&session_id).is_none() {
        return Ok(());
    }
    write_interrupted(&map)
}

/// Reads and clears what a session was waiting on, if anything.
#[tauri::command]
pub fn take_interrupted(session_id: String) -> Option<String> {
    let mut map = read_interrupted();
    let tool = map.remove(&session_id)?;
    let _ = write_interrupted(&map);
    Some(tool)
}

/// Lists past sessions for a working directory, newest first.
#[tauri::command]
pub fn list_sessions(cwd: String, limit: usize) -> Vec<SessionSummary> {
    let Some(dir) = project_dir(&cwd) else {
        return Vec::new();
    };
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };

    let mut sessions: Vec<(PathBuf, SessionSummary)> = entries
        .flatten()
        .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "jsonl"))
        .filter_map(|entry| {
            let path = entry.path();
            let metadata = entry.metadata().ok()?;
            let id = path.file_stem()?.to_string_lossy().into_owned();
            let modified = metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map(|since| since.as_millis() as u64)
                .unwrap_or(0);
            Some((
                path,
                SessionSummary {
                    id,
                    modified,
                    bytes: metadata.len(),
                    preview: String::new(),
                },
            ))
        })
        .collect();

    sessions.sort_by_key(|entry| Reverse(entry.1.modified));
    sessions.truncate(limit);

    sessions
        .into_iter()
        .map(|(path, mut summary)| {
            summary.preview = read_preview(&path);
            summary
        })
        .collect()
}
