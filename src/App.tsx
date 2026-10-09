import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChatPane, type RevealTarget } from "./components/ChatPane";
import { Composer } from "./components/Composer";
import { DialogCard } from "./components/DialogCard";
import { SettingsMenu } from "./components/SettingsMenu";
import { useClaudeChat } from "./hooks/useClaudeChat";
import { useVoice } from "./hooks/useVoice";
import { describeFastMode, describePermissionMode } from "./lib/claudeConfig";
import { composerPlaceholder } from "./lib/composerPlaceholder";
import { monoFontStack, uiFontStack } from "./lib/fonts";
import { runningGroups } from "./lib/runningTools";
import { loadSettings, saveSettings } from "./lib/settings";
import type { SlashMenuHost } from "./lib/slashMenu";
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

  useEffect(() => {
    void invoke<string>("startup_directory_command")
      .then(setCwd)
      .catch(() => setCwd(""));
    void loadSettings().then(setSettings);
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
   * Asks the transcript to bring one entry into view.
   *
   * The count is what makes a second request for the same entry a second
   * request, rather than a state that was already set and so changes nothing.
   */
  const revealEntry = useCallback((id: string) => {
    setReveal((current) => ({ id, seq: (current?.seq ?? 0) + 1 }));
  }, []);

  const trackers = useMemo(() => runningGroups(chat.state), [chat.state]);

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

  return (
    <div className="app">
      <header className="titlebar">
        <SettingsMenu
          settings={settings}
          onChange={updateSettings}
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          voice={voice}
        />
        <span className="session-agent">CLAUDE</span>
        <div className="session">
          {chat.state.model !== null && <span className="session-item">{chat.state.model}</span>}
          {chat.state.costUsd !== null && (
            <span className="session-item">${chat.state.costUsd.toFixed(3)}</span>
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
            title="Permission mode — Shift+Tab cycles"
            onClick={chat.cyclePermissionMode}
          >
            {describePermissionMode(chat.state.permissionMode)}
          </button>
          <span className="cwd" title={sessionCwd ?? ""}>
            {sessionCwd ?? "…"}
          </span>
        </div>
      </header>
      <main className="workspace">
        <ChatPane state={chat.state} reveal={reveal} />
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
          voice={voice}
        />
      </div>
      {chat.prompt && (
        <DialogCard key={chat.prompt.requestId} prompt={chat.prompt} onResolve={chat.resolve} />
      )}
    </div>
  );
}
