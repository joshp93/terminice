import { invoke } from "@tauri-apps/api/core";

/**
 * Claims the colour this window should wear.
 *
 * The colour is decided by the backend because it has to be unique across every
 * running instance, which is a question only one process can answer for the
 * others. An instance that cannot claim one — every colour taken, or no backend
 * at all — is drawn in the first colour rather than being left unstyled.
 *
 * @returns The index of the colour in the palette.
 */
export async function claimWindowColour(): Promise<number | null> {
  try {
    return await invoke<number | null>("claim_window_colour");
  } catch {
    return null;
  }
}
