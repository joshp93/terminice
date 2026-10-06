import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChatPane } from "./components/ChatPane";
import { Composer } from "./components/Composer";
import { TerminalPane } from "./components/TerminalPane";
import { useClaudeChat } from "./hooks/useClaudeChat";
import { useTerminal } from "./hooks/useTerminal";
import type { ComposerTarget } from "./types";

/**
 * Renders the terminice workspace: a terminal, a chat transcript, and the
 * composer that feeds either of them.
 *
 * @returns The rendered application.
 */
export function App() {
  const [cwd, setCwd] = useState<string | null>(null);
  const [target, setTarget] = useState<ComposerTarget>("claude");

  useEffect(() => {
    void invoke<string>("startup_directory_command")
      .then(setCwd)
      .catch(() => setCwd(""));
  }, []);

  const terminal = useTerminal(cwd);
  const chat = useClaudeChat(cwd);

  const send = (text: string): void => {
    if (target === "terminal") {
      void terminal.sendText(text);
      return;
    }
    void chat.send(text);
  };

  return (
    <div className="app">
      <header className="titlebar">
        <span className="brand">terminice</span>
        <span className="cwd" title={cwd ?? ""}>
          {cwd ?? "…"}
        </span>
      </header>
      <main className="workspace">
        <TerminalPane containerRef={terminal.containerRef} status={terminal.status} />
        <ChatPane state={chat.state} status={chat.status} />
      </main>
      <Composer target={target} onTargetChange={setTarget} onSend={send} />
    </div>
  );
}
