import { fakeVoice } from "@test/fakeVoice";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { VoiceSetting } from "./VoiceSetting";

const MODEL = {
  modelPath: "C:\\Users\\demo\\.config\\terminice\\ggml-base.en.bin",
  modelPresent: true,
  modelBytes: 147_951_465,
};

function renderSetting(overrides: Parameters<typeof fakeVoice>[0] = {}, enabled = false) {
  const onEnabledChange = vi.fn();
  const view = render(
    <VoiceSetting
      enabled={enabled}
      onEnabledChange={onEnabledChange}
      voice={fakeVoice(overrides)}
    />,
  );
  return { onEnabledChange, ...view };
}

describe("VoiceSetting", () => {
  it("shows dictation as off, which is where it starts", () => {
    renderSetting();

    expect(screen.getByRole("button", { name: "Off" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Hold space" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("turns it on when the reader asks for it", async () => {
    const user = userEvent.setup();
    const { onEnabledChange } = renderSetting();

    await user.click(screen.getByRole("button", { name: "Hold space" }));

    expect(onEnabledChange).toHaveBeenCalledWith(true);
  });

  it("turns it back off again", async () => {
    const user = userEvent.setup();
    const { onEnabledChange } = renderSetting({}, true);

    await user.click(screen.getByRole("button", { name: "Off" }));

    expect(onEnabledChange).toHaveBeenCalledWith(false);
  });
});

describe("the speech model", () => {
  it("offers to fetch it when it is not there", () => {
    renderSetting();

    expect(screen.getByRole("button", { name: "Download" })).toBeInTheDocument();
  });

  it("says nothing was downloaded when the backend has never heard of it", () => {
    renderSetting({ status: null });

    expect(screen.getByRole("button", { name: "Download" })).toBeInTheDocument();
  });

  it("fetches it only when the button is pressed", async () => {
    const user = userEvent.setup();
    const voice = fakeVoice();
    render(<VoiceSetting enabled={false} onEnabledChange={vi.fn()} voice={voice} />);

    expect(voice.download).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Download" }));

    expect(voice.download).toHaveBeenCalledTimes(1);
  });

  it("shows how big it is once it has arrived", () => {
    renderSetting({ status: MODEL });

    expect(screen.getByText("141 MB on disk")).toHaveAttribute("title", MODEL.modelPath);
  });

  it("stops offering a download it already has", () => {
    renderSetting({ status: MODEL });

    expect(screen.queryByRole("button", { name: "Download" })).toBeNull();
  });

  it("shows how far a download has got", () => {
    renderSetting({
      status: { ...MODEL, modelPresent: false },
      downloading: true,
      downloadProgress: 0.25,
    });

    expect(
      screen.getByRole("progressbar", { name: "Downloading the speech model" }),
    ).toHaveAttribute("aria-valuenow", "25");
  });

  it("explains the hold once there is something to hold for", () => {
    renderSetting({ status: MODEL });

    expect(screen.getByText(/Hold the space bar for a second/)).toBeInTheDocument();
  });

  it("says where the model comes from before it has been fetched", () => {
    renderSetting();

    expect(screen.getByText(/runs on this machine/)).toBeInTheDocument();
  });
});

describe("a download with no size to show", () => {
  const fetching = (overrides: Parameters<typeof fakeVoice>[0] = {}) =>
    renderSetting({ status: { ...MODEL, modelPresent: false }, downloading: true, ...overrides });

  it("sweeps rather than claiming a fraction it does not have", () => {
    fetching();

    const bar = screen.getByRole("progressbar", { name: "Downloading the speech model" });
    expect(bar).toHaveClass("indeterminate");
    expect(bar).not.toHaveAttribute("aria-valuenow");
  });

  /// The button used to come back the moment a size-less progress arrived,
  /// which offered to start a second download of the same model.
  it("does not offer to start over while it is still running", () => {
    fetching();

    expect(screen.queryByRole("button", { name: "Download" })).toBeNull();
  });

  it("shows the fraction once there is one", () => {
    fetching({ downloadProgress: 0.25 });

    const bar = screen.getByRole("progressbar", { name: "Downloading the speech model" });
    expect(bar).not.toHaveClass("indeterminate");
    expect(bar).toHaveAttribute("aria-valuenow", "25");
  });
});
