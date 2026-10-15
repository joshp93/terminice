import { invoke } from "@tauri-apps/api/core";
import { type CSSProperties, useCallback, useEffect, useMemo, useState } from "react";
import { ChatPane, type RevealTarget } from "./components/ChatPane";
import { Composer } from "./components/Composer";
import { DialogCard } from "./components/DialogCard";
import { DiffLayoutProvider } from "./components/DiffLayoutContext";
import { PlanSidebar } from "./components/PlanSidebar";
import { SettingsMenu } from "./components/SettingsMenu";
import { WindowControls } from "./components/WindowControls";
import { useClaudeChat } from "./hooks/useClaudeChat";
import { useVoice } from "./hooks/useVoice";
import { describeFastMode, describePermissionMode } from "./lib/claudeConfig";
import { composerPlaceholder } from "./lib/composerPlaceholder";
import { monoFontStack, uiFontStack } from "./lib/fonts";
import { isModShortcut } from "./lib/isModShortcut";
import { modifierShortcut } from "./lib/modifierShortcut";
import { pendingMessages } from "./lib/pendingMessages";
import { planOf } from "./lib/planOf";
import { runningGroups } from "./lib/runningTools";
import { describeCost, sessionCost } from "./lib/sessionCost";
import { sessionTitle } from "./lib/sessionTitle";
import { loadSettings, saveSettings } from "./lib/settings";
import type { SlashMenuHost } from "./lib/slashMenu";
import { claimWindowColour } from "./lib/windowColour";
import { setWindowTitle } from "./lib/windowControls";
import { paletteColour, WINDOW_INK, WINDOW_LINE } from "./lib/windowPalette";
import { createDefaultSettings, type Settings } from "./types";

/**
 * Renders the terminice workspace.
 *
 * @returns The rendered application.
 */
export function App() {
  const [cwd, setCwd] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(createDefaultSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** The colour claimed for this window, which tells it from other instances. */
  const [colour, setColour] = useState<string | null>(null);

  useEffect(() => {
    void invoke<string>("startup_directory_command")
      .then(setCwd)
      .catch(() => setCwd(""));
    void loadSettings().then(setSettings);
    void claimWindowColour().then((index) => setColour(paletteColour(index)));
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = settings.theme;
    root.style.setProperty("--composer-font-size", `${settings.composerFontSize}px`);
    root.style.setProperty("--chat-font-size", `${settings.chatFontSize}px`);
    root.style.setProperty("--font-mono", monoFontStack(settings.fontFamily));
    root.style.setProperty("--font-ui", uiFontStack(settings.appFontFamily));
  }, [
    settings.theme,
    settings.composerFontSize,
    settings.chatFontSize,
    settings.fontFamily,
    settings.appFontFamily,
  ]);

  const chat = useClaudeChat(cwd);
  const voice = useVoice(settings.voiceEnabled);
  const [reveal, setReveal] = useState<RevealTarget | null>(null);
  /**
   * Counts the times the transcript has handed the keyboard back.
   *
   * A count rather than a flag, because the same request twice is two requests:
   * a state that is already set would change nothing, which is the same problem
   * a jump back to one entry has. This is the third of them, which is why all
   * three are counts.
   */
  const [composerFocus, setComposerFocus] = useState(0);

  /**
   * Takes the window's own keys: F1 for the settings, and the mode switch.
   *
   * Both are claimed on the document in the capture phase, the way the composer
   * claims F6, so that whatever happens to be holding the keyboard cannot
   * swallow them. Neither belongs to the composer even though the mode is shown
   * beside it: a mode is a property of the session, and Claude can change it
   * itself while the reader is looking somewhere else in the window.
   *
   * The settings panel focuses its own first control as it opens, which is what
   * puts the keyboard in it; there is nothing to do here beyond opening it.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "F1") {
        event.preventDefault();
        setSettingsOpen(true);
        return;
      }
      if (isModShortcut(event, "m")) {
        event.preventDefault();
        event.stopPropagation();
        chat.cyclePermissionMode();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [chat.cyclePermissionMode]);

  /**
   * Asks the transcript to bring one entry into view.
   *
   * The count is what makes a second request for the same entry a second
   * request, rather than a state that was already set and so changes nothing.
   */
  const revealEntry = useCallback((id: string) => {
    setReveal((current) => ({ id, seq: (current?.seq ?? 0) + 1 }));
  }, []);

  /** Hands the keyboard back to the composer, from the transcript's own keys. */
  const returnToComposer = useCallback(() => {
    setComposerFocus((seq) => seq + 1);
  }, []);

  const trackers = useMemo(() => runningGroups(chat.state), [chat.state]);
  const pending = useMemo(() => pendingMessages(chat.state), [chat.state]);

  const updateSettings = useCallback((next: Settings) => {
    setSettings(next);
    void saveSettings(next).catch(() => undefined);
  }, []);

  const menu = useMemo<SlashMenuHost>(
    () => ({
      catalogue: chat.state.catalogue,
      contextUsage: chat.state.contextUsage,
      mcpServers: chat.state.mcpServers,
      plugins: chat.state.plugins,
      skills: chat.state.skills,
      permissionMode: chat.state.permissionMode,
      sessions: chat.resumable,
      runCommand: chat.send,
      setPermissionMode: chat.setPermissionMode,
      setModel: chat.setModel,
      currentModel: chat.state.model ?? "",
      openTerminiceSettings: () => setSettingsOpen(true),
      newSession: chat.startNew,
      resumeSession: chat.resume,
      refreshSessions: chat.refreshSessions,
      refreshMcp: chat.refreshMcp,
    }),
    [
      chat.state.catalogue,
      chat.state.contextUsage,
      chat.state.mcpServers,
      chat.state.plugins,
      chat.state.skills,
      chat.state.permissionMode,
      chat.resumable,
      chat.state.model,
      chat.send,
      chat.setPermissionMode,
      chat.setModel,
      chat.startNew,
      chat.resume,
      chat.refreshSessions,
      chat.refreshMcp,
    ],
  );

  const usage = chat.state.contextUsage;
  const sessionCwd = chat.state.cwd ?? cwd;
  const placeholder = composerPlaceholder({
    enterBehaviour: settings.enterBehaviour,
    dictates: voice.ready,
  });
  const title = sessionTitle(chat.state.entries);
  const plan = planOf(chat.prompt);
  const cost = sessionCost({
    reported: chat.state.costUsd,
    unknown: chat.state.costUnknown,
    model: chat.state.model,
    tokens: chat.state.tokens,
    rates: {
      input: settings.inputCostPerMillion,
      output: settings.outputCostPerMillion,
      cacheRead: settings.cacheReadCostPerMillion,
      cacheWrite: settings.cacheWriteCostPerMillion,
    },
  });

  /**
   * Names the window, which is what the taskbar, the window switcher and the
   * system menu show. The session's own name is in it because several
   * instances of this application can be open at once, and which one is which
   * is the first thing a reader looking for one needs to know.
   */
  useEffect(() => {
    void setWindowTitle(title);
  }, [title]);

  return (
    <div className="app">
      <header
        className="titlebar"
        data-tauri-drag-region="deep"
        style={
          colour === null
            ? undefined
            : ({
                "--bar-bg": colour,
                "--bar-ink": WINDOW_INK,
                "--bar-line": WINDOW_LINE,
              } as CSSProperties)
        }
      >
        <SettingsMenu
          settings={settings}
          onChange={updateSettings}
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          voice={voice}
        />
        <span className="session-agent">CLAUDE</span>
        <span className="window-session" title={title}>
          {title}
        </span>
        <div className="session">
          {chat.state.model !== null && <span className="session-item">{chat.state.model}</span>}
          {cost !== null && (
            <span className="session-item" title={describeCost(cost)}>
              {cost.kind === "unknown" ? "cost —" : null}
              {cost.kind === "estimated" ? `≈$${cost.usd.toFixed(2)}` : null}
              {cost.kind === "reported" ? `$${cost.usd.toFixed(3)}` : null}
            </span>
          )}
          {usage && (
            <span
              className="session-item"
              title={`${usage.totalTokens.toLocaleString()} of ${usage.maxTokens.toLocaleString()} tokens in context`}
            >
              {usage.percentage}%
            </span>
          )}
          <button
            type="button"
            className="session-mode"
            title={`Permission mode — ${modifierShortcut("M")} cycles`}
            onClick={chat.cyclePermissionMode}
          >
            {describePermissionMode(chat.state.permissionMode)}
          </button>
          <span className="cwd" title={sessionCwd ?? ""}>
            {sessionCwd ?? "…"}
          </span>
        </div>
        <WindowControls />
      </header>
      <main className="workspace">
        <DiffLayoutProvider sideBySide={settings.diffSideBySide}>
          <ChatPane state={chat.state} reveal={reveal} onReturnToComposer={returnToComposer} />
        </DiffLayoutProvider>
        {plan !== null && <PlanSidebar key={plan.requestId} text={plan.text} />}
      </main>
      <div
        className={chat.prompt ? "composer-slot hidden" : "composer-slot"}
        inert={chat.prompt !== null}
      >
        <Composer
          submitsOnEnter={() => settings.enterBehaviour === "send"}
          onSend={chat.send}
          menu={menu}
          running={chat.state.busy}
          thinkingTokens={chat.state.thinkingTokens}
          trackers={trackers}
          pending={pending}
          onUnqueue={chat.unqueue}
          onReveal={revealEntry}
          onStop={chat.interrupt}
          onCycleMode={chat.cyclePermissionMode}
          onRunShell={chat.runShell}
          suggestion={chat.state.suggestion}
          fastMode={chat.state.fastMode !== "off"}
          fastModeTitle={describeFastMode(chat.state.fastMode, chat.state.fastModeReason)}
          onSuggestFiles={chat.suggestFiles}
          sessionId={chat.state.sessionId}
          placeholder={placeholder}
          focusSignal={composerFocus}
          voice={voice}
        />
      </div>
      {chat.prompt && (
        <DialogCard key={chat.prompt.requestId} prompt={chat.prompt} onResolve={chat.resolve} />
      )}
    </div>
  );
}
