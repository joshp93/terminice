import type { Voice } from "../hooks/useVoice";
import { SegmentedChoice } from "./SegmentedChoice";

/** Props for {@link VoiceSetting}. */
export type VoiceSettingProps = {
  /** Whether dictation is turned on. */
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  /** The voice session, for the model's state and the download. */
  voice: Voice;
};

/** How big the model is, in the units a reader would say it in. */
function describeSize(bytes: number): string {
  if (bytes <= 0) return "not downloaded";
  const megabytes = bytes / (1024 * 1024);
  return megabytes >= 1 ? `${megabytes.toFixed(0)} MB on disk` : "downloaded";
}

/**
 * Renders the dictation setting and the state of the speech model.
 *
 * The model is fetched rather than bundled, so this is where its absence is
 * visible and where the one thing that fixes it lives. Nothing is downloaded
 * until the button is pressed: an application that reaches for the network the
 * first time a settings menu is opened is an application you stop trusting.
 *
 * @param props - The setting's value, a change handler, and the voice session.
 * @returns The rendered settings rows.
 */
export function VoiceSetting({ enabled, onEnabledChange, voice }: VoiceSettingProps) {
  const present = voice.status?.modelPresent === true;
  const progress = voice.downloadProgress;

  /**
   * The bar while the model is arriving.
   *
   * A server that did not say how large the model is leaves nothing for the bar
   * to be a fraction of, so it sweeps instead. That is also what stops the
   * Download button from coming back mid-download and offering to start a
   * second one.
   */
  const downloadBar = () => {
    const share = progress === null ? null : Math.round(progress * 100);
    return (
      <div
        className={share === null ? "voice-download indeterminate" : "voice-download"}
        role="progressbar"
        aria-label="Downloading the speech model"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={share ?? undefined}
      >
        <div
          className="voice-download-fill"
          style={share === null ? undefined : { width: `${share}%` }}
        />
      </div>
    );
  };

  return (
    <>
      <SegmentedChoice
        label="Voice input"
        value={enabled ? "on" : "off"}
        options={[
          { value: "off", label: "Off" },
          { value: "on", label: "Hold space" },
        ]}
        onSelect={(value) => onEnabledChange(value === "on")}
      />
      <div className="setting">
        <span className="setting-label">Speech model</span>
        <div className="voice-model">
          {voice.downloading && downloadBar()}
          {!voice.downloading && present && (
            <span className="voice-model-state" title={voice.status?.modelPath}>
              {describeSize(voice.status?.modelBytes ?? 0)}
            </span>
          )}
          {!voice.downloading && !present && (
            <button type="button" className="voice-download-button" onClick={voice.download}>
              Download
            </button>
          )}
        </div>
      </div>
      <p className="settings-note">
        {present
          ? "Hold the space bar for a second to dictate. Recording runs until you let go."
          : "Whisper runs on this machine. The model is about 142 MB and is only fetched when you ask for it."}
      </p>
    </>
  );
}
