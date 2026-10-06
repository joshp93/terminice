import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChatPane } from "./components/ChatPane";
import { Composer } from "./components/Composer";
import { SettingsMenu } from "./components/SettingsMenu";
import { useClaudeChat } from "./hooks/useClaudeChat";
import { loadSettings, saveSettings } from "./lib/settings";
import { createDefaultSettings, type Settings } from "./types";

/**
 * Renders the terminice workspace.
 *
 * @returns The rendered application.
 */
export function App() {
  const [cwd, setCwd] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(createDefaultSettings);

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

  const { contextUsed, contextWindow } = chat.state;
  const contextPercent =
    contextUsed !== null && contextWindow ? Math.round((contextUsed / contextWindow) * 100) : null;

  return (
    <div className="app">
      <header className="titlebar">
        <SettingsMenu settings={settings} onChange={updateSettings} />
        <div className="session">
          <span className="session-agent">CLAUDE</span>
          {chat.state.model !== null && <span className="session-item">{chat.state.model}</span>}
          {chat.state.costUsd !== null && (
            <span className="session-item">${chat.state.costUsd.toFixed(3)}</span>
          )}
          {contextPercent !== null && <span className="session-item">{contextPercent}%</span>}
          <span className="cwd" title={cwd ?? ""}>
            {cwd ?? "…"}
          </span>
        </div>
      </header>
      <main className="workspace">
        <ChatPane state={chat.state} status={chat.status} />
      </main>
      <Composer
        submitsOnEnter={() => settings.enterBehaviour === "send"}
        onSend={(text) => void chat.send(text)}
      />
    </div>
  );
}
