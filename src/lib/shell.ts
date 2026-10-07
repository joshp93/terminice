import { invoke } from "@tauri-apps/api/core";

/** What a local command produced. */
export type ShellOutput = {
  stdout: string;
  stderr: string;
  code: number | null;
};

/**
 * Runs one command in the user's shell.
 *
 * @param command - The command, without the leading `!`.
 * @param cwd - The directory to run it in.
 * @returns What the command printed.
 */
export async function runShellCommand(command: string, cwd: string | null): Promise<ShellOutput> {
  return invoke<ShellOutput>("run_shell_command", { command, cwd });
}
