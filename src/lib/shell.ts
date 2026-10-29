import { type Channel, invoke } from "@tauri-apps/api/core";

/** One event from a running local command. */
export type ShellEvent =
  | { kind: "stdout"; chunk: string }
  | { kind: "stderr"; chunk: string }
  | { kind: "exit"; code: number | null; stopped: boolean };

/**
 * Runs one command in the user's shell, reporting what it prints as it goes.
 *
 * @param id - The name to run the command under, which is also how it is stopped.
 * @param command - The command, without the leading `!`.
 * @param cwd - The directory to run it in.
 * @param onEvent - The channel the command's output and exit arrive on.
 * @param detectNode - Whether the command may be given a version manager's
 *   environment, so node is found when the window was started without a shell.
 * @throws When the command cannot be started.
 */
export async function runShellCommand(
  id: string,
  command: string,
  cwd: string | null,
  onEvent: Channel<ShellEvent>,
  detectNode = true,
): Promise<void> {
  return invoke("run_shell_command", { id, command, cwd, onEvent, detectNode });
}

/**
 * Stops a running command.
 *
 * @param id - The name the command was started under.
 * @returns True when a command was there to stop.
 * @throws When the backend cannot be asked.
 */
export async function stopShellCommand(id: string): Promise<boolean> {
  return invoke<boolean>("stop_shell_command", { id });
}
