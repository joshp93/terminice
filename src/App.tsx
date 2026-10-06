import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChatPane } from "./components/ChatPane";
import { Composer } from "./components/Composer";
import { SettingsMenu } from "./components/SettingsMenu";
import { TerminalPane } from "./components/TerminalPane";
import { useClaudeChat } from "./hooks/useClaudeChat";
import { useTerminal } from "./hooks/useTerminal";
import { loadSettings, saveSettings } from "./lib/settings";
import { createDefaultSettings, type PaneMode, type Settings } from "./types";

const MODES: readonly { value: PaneMode; label: string }[] = [
  { value: "claude", label: "CLAUDE" },
  { value: "terminal", label: "TERMINAL" },
];

/**
 * Renders the terminice workspace.
 *
 * One pane is shown at a time; both stay mounted so the shell keeps running
 * whichever mode is active.
 *
 * @returns The rendered application.
 */
export function App() {
  const [cwd, setCwd] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(createDefaultSettings);
  const [mode, setMode] = useState<PaneMode>("claude");

  useEffect(() => {
    void invoke<string>("startup_directory_command")
      .then(setCwd)
      .catch(() => setCwd(""));
    void loadSettings().then((loaded) => {
      setSettings(loaded);
      setMode(loaded.defaultMode);
    });
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);

  const terminal = useTerminal(cwd, settings.theme);
  const chat = useClaudeChat(cwd);

  const updateSettings = useCallback((next: Settings) => {
    setSettings(next);
    void saveSettings(next).catch(() => undefined);
  }, []);

  const send = (text: string): void => {
    if (mode === "terminal") {
      void terminal.sendText(text);
      return;
    }

    const trimmed = text.trimStart();
    if (trimmed.startsWith("!")) {
      const command = trimmed.slice(1).trim();
      if (command.length === 0) return;
      void terminal.sendText(command);
      chat.notice(`Sent to the terminal: ${command}`);
      return;
    }

    void chat.send(text);
  };

  return (
    <div className="app">
      <header className="titlebar">
        <div className="mode-tabs" role="tablist" aria-label="Pane">
          {MODES.map((option) => (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={mode === option.value}
              className={mode === option.value ? "mode-tab active" : "mode-tab"}
              onClick={() => setMode(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <SettingsMenu settings={settings} onChange={updateSettings} />
        <span className="cwd" title={cwd ?? ""}>
          {cwd ?? "…"}
        </span>
      </header>
      <main className="workspace">
        <TerminalPane
          containerRef={terminal.containerRef}
          status={terminal.status}
          active={mode === "terminal"}
        />
        <ChatPane state={chat.state} status={chat.status} active={mode === "claude"} />
      </main>
      <Composer
        key={mode}
        mode={mode}
        submitsOnEnter={() => settings.enterBehaviour === "send"}
        onSend={send}
      />
    </div>
  );
}
