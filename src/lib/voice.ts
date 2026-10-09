import { type Channel, invoke } from "@tauri-apps/api/core";
import type { VoiceEvent, VoiceStatus } from "../types";

/**
 * Asks what the speech engine has to work with.
 *
 * @returns Where the model is expected, and whether it is there.
 */
export function voiceStatus(): Promise<VoiceStatus> {
  return invoke<VoiceStatus>("voice_status");
}

/**
 * Fetches the speech model and writes it beside the settings.
 *
 * The download is the backend's, not the webview's, so the address the model
 * comes from never has to be allowed through the application's content policy.
 * Nothing is fetched until this is called.
 *
 * @param onEvent - Receives the download's progress.
 * @returns When the download has finished.
 */
export function downloadVoiceModel(onEvent: Channel<VoiceEvent>): Promise<void> {
  return invoke<void>("download_voice_model", { onEvent });
}

/**
 * Opens the microphone and starts capturing.
 *
 * @param onEvent - Receives the level while recording, and the transcript after.
 * @returns When the microphone is open and capturing.
 */
export function startVoiceRecording(onEvent: Channel<VoiceEvent>): Promise<void> {
  return invoke<void>("start_voice_recording", { onEvent });
}

/**
 * Stops capturing and transcribes what was recorded.
 *
 * The text arrives on the channel the recording was started with, once the
 * decode has finished.
 *
 * @returns When the microphone has been released.
 */
export function stopVoiceRecording(): Promise<void> {
  return invoke<void>("stop_voice_recording");
}
