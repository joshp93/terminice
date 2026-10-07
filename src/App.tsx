import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChatPane } from "./components/ChatPane";
import { Composer } from "./components/Composer";
import { DialogCard } from "./components/DialogCard";
import { SettingsMenu } from "./components/SettingsMenu";
import { useClaudeChat } from "./hooks/useClaudeChat";
import { describePermissionMode } from "./lib/claudeConfig";
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
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);

  const chat = useClaudeChat(cwd);

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

  return (
    <div className="app">
      <header className="titlebar">
        <SettingsMenu
          settings={settings}
          onChange={updateSettings}
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
        />
        <div className="session">
          <span className="session-agent">CLAUDE</span>
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
          <span className="cwd" title={cwd ?? ""}>
            {cwd ?? "…"}
          </span>
        </div>
      </header>
      <main className="workspace">
        <ChatPane state={chat.state} status={chat.status} />
      </main>
      <div className={chat.prompt ? "composer-slot hidden" : "composer-slot"} inert={chat.prompt !== null}>
        <Composer
          submitsOnEnter={() => settings.enterBehaviour === "send"}
          onSend={chat.send}
          menu={menu}
          running={chat.state.busy}
          compacting={chat.state.compacting}
          onStop={chat.interrupt}
          onCycleMode={chat.cyclePermissionMode}
        />
      </div>
      {chat.prompt && (
        <DialogCard key={chat.prompt.requestId} prompt={chat.prompt} onResolve={chat.resolve} />
      )}
    </div>
  );
}
