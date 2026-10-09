# Voice input — investigation

> **Status: investigated, not built.** Nothing here has been implemented. This records
> what was found and what the options cost, so a direction can be chosen deliberately.

Written 2026-10-07 against `claude` 2.1.291 on Windows 11, with crate metadata read from
the crates.io API directly. Anything marked **Verified** was confirmed here; anything
marked **Unverified** is a claim from documentation that has not been tested on this
machine.

---

## 1. What Claude actually does

Claude Code's voice mode is not a local engine. It is a **first-party streaming service**,
and the client is a thin shell around it. **Verified** by reading the strings out of the
installed binary:

```
wss://<base>/api/ws/speech_to_text/voice_stream

  →  audio chunks:  linear16 PCM, 16 kHz
  →  {"type":"KeepAlive"}          … keep the socket open between utterances
  →  {"type":"CloseStream"}        … the user stopped; finalise what you have

  ←  TranscriptInterim             … partial text, replaced as it improves
  ←  TranscriptText                … final text
  ←  TranscriptEndpoint            … end of an utterance
  ←  TranscriptError
```

Connection parameters seen in the client: `endpointing_ms`, `utterance_end_ms`,
`forward_interims`, `use_conversation_engine`, `keyterms`, `x-app`. `VOICE_STREAM_BASE_URL`
overrides the host.

Capture is **native, not in the webview** — the CLI loads a bundled audio module exposing
`startNativeRecording`, `stopNativeRecording`, `microphoneAuthorizationStatus`. The webview
only ever sees text.

Authentication is the user's **Claude.ai OAuth token** (`[voice_stream] No OAuth token
available`), and there is a managed-policy gate, `allow_voice_mode`.

### The user experience, precisely

Extracted from the binary rather than guessed, because this is the spec worth matching:

- **Two modes**, plus off. `hold` is the default: hold to talk, and releasing submits.
  `tap` starts on one tap and stops and submits on the next. An independent `autoSubmit`
  setting controls whether releasing submits in hold mode.
- **The interim transcript is written into the composer as you speak**, then replaced by
  the final version at each endpoint.
- **The caret is respected.** The text either side of the caret is captured when recording
  begins and the transcript is inserted between them, so text typed *after* the caret is
  never clobbered. If the composer was edited while dictating, the insert is abandoned
  outright (`input_diverged`) rather than fighting the user.
- **A smoothed audio level meter**, driven off the captured stream.
- **Warm-up before speech** (`voiceWarmingUp`) — the connection is established ahead of the
  first word, not on keypress.
- **Teardown on focus loss** ("Focus silence timeout — tearing down session").
- If the user stops while an interim has not been finalised, the client **promotes the
  interim to final** so the last words are not silently lost.

That last group is the difference between dictation that feels solid and dictation that
eats words. They are cheap to implement and worth copying deliberately.

### Why this cannot simply be reused

**Verified on this machine:**

```
/voice   →   "/voice isn't available in this environment."
```

`~/.claude.json` contains **no `oauthAccount`**, because this machine authenticates through
a gateway rather than Claude.ai. The CLI's own check is explicit: *"Voice mode requires a
Claude.ai account. Please run `/login` to sign in."*

So the reference implementation is not available to copy from, and "works like Claude" has
to mean **matching the behaviour**, not calling the same service. This is also the reason
the app must own its own capture and recognition.

---

## 2. The Web Speech API is not an option

The obvious free answer is the browser's own `SpeechRecognition`. It does not work here,
for three independent reasons:

1. **It is not a browser feature.** In Chromium it is a thin client to a remote Google
   service, so it requires network and contradicts the offline goal. MDN says so plainly:
   audio "is sent to a web service for recognition processing, so it won't work offline."
2. **There is no Linux implementation.** WebKitGTK does not implement it, and Tauri's
   `getUserMedia` audio path on Linux returns `NotAllowedError` even with a native
   permission handler installed ([tauri#15277](https://github.com/tauri-apps/tauri/issues/15277)).
3. **It regressed in WebView2.** [WebView2Feedback#5724](https://github.com/MicrosoftEdge/WebView2Feedback/issues/5724)
   (opened 2026-09-21, still open, marked *Blocking*) reports `webkitSpeechRecognition`
   failing with a JavaScript `network` error on Runtime 153, working on 152. A functioning
   feature that breaks across a runtime update is not a foundation.

WKWebView's support is **Unverified** — BCD has no `webview_macos` entry, and
[tauri#6208](https://github.com/tauri-apps/tauri/issues/6208) is an open macOS failure.

---

## 3. The decision that shapes everything

**Live partial words, or better accuracy?** There is no cheap option that gives both.

| | Streaming engine | Batch engine (Whisper) |
|---|---|---|
| Words appear while speaking | **Yes** — genuine incremental decoding | **No** — nothing until the audio ends |
| Accuracy | Good | **Best available** |
| CPU profile | Low and steady | Spiky: each partial is a full re-run |
| Interface | `feed()` per chunk | one `full()` at the end |

whisper.cpp has **no incremental API**. Its own real-time demonstration fakes it by
re-running full inference over a sliding window (`--step 500 --length 5000`), which is why
it is CPU-hungry. Reproducing Claude's live transcript means a streaming engine.

**This is a real choice, not a forced one**, because `hold` — Claude's own default — does
not strictly need partials: you can record while held and transcribe on release.

---

## 4. The options

Crate versions and licences below were read from the crates.io API during this
investigation. **All verified.**

| Engine | Crate | Licence | Streaming | Notes |
|---|---|---|---|---|
| **sherpa-onnx** | `sherpa-onnx` 1.13.8 | **Apache-2.0** | **Yes**, native | Updated 2026-09-11. Ships a `cpal` streaming-microphone example. Bundles Silero VAD. |
| **whisper.cpp** | `whisper-rs` 0.16.0 | **Unlicense** | No | Best accuracy. `large-v3-turbo-q5_0` is 547 MiB. Repo moved to Codeberg. |
| **Parakeet / Canary** | `parakeet-rs` 0.3.8 | MIT OR Apache-2.0 | Yes | Younger (117k downloads). Model terms are NVIDIA's, separately. |
| **Vosk** | `vosk` 0.3.1 | MIT | Yes | Crate **stale since 2024-10-27**. Some models are AGPL or LGPL — check per model. |
| **Windows speech** | `windows` 0.62.2 | MIT OR Apache-2.0 | Yes (hypotheses) | On-device, free, no model download. **Windows only.** |
| **macOS speech** | `objc2-speech` 0.3.2 | Zlib OR Apache-2.0 OR MIT | Yes | **macOS only.** Unsafe FFI and delegate plumbing. |
| **Cloud** | — | — | Yes (WebSocket) | AssemblyAI's free tier is 185 h pre-recorded + 333 h streaming, no card. **Not offline.** |
| **Web Speech API** | — | — | Yes | See §2. Ruled out. |
| **Moonshine** | no Rust crate | MIT | Yes | Usable *through* sherpa-onnx; no standalone Rust crate exists. |

Microphone capture is `cpal` 0.18.2 (Apache-2.0) — the de-facto standard, WASAPI on
Windows, CoreAudio on macOS, ALSA on Linux, and what sherpa-onnx's own example uses.

**There is no pure-Rust option.** Every credible engine is C++ FFI — ggml, onnxruntime, or
libvosk. That cost is unavoidable and should be budgeted for.

### Voice activity detection

Needed to find where an utterance ends. Two traps:

- The `silero-vad` crate is **GPL-2.0**. The Silero *model* is MIT, but that crate is not.
- `voice_activity_detector` declares a **"non-standard"** licence — read the text before
  shipping it.

`sherpa-onnx` bundles Silero and TEN VAD under **Apache-2.0**, which sidesteps both.
`webrtc-vad` 0.4.0 is MIT but last updated in 2019 — small and stable, fine for simple
gating. A plain RMS energy threshold needs no crate at all and is adequate for
push-to-talk, though it will not separate speech from keyboard clatter or music.

---

## 5. Recommendation

**`cpal` for capture, `sherpa-onnx` for recognition, behind a trait.**

> **Superseded in part — see §9.** Asked on 2026-10-09 whether it has to work offline
> answered "no", with hold-to-talk and no third party. That drops one of the five criteria
> below and removes the streaming requirement, which is enough to change the engine.

It is the only option that is simultaneously offline, cross-platform, natively streaming,
permissively licensed, and actively maintained — and its maintainers ship a
streaming-microphone example built on `cpal`, which removes most of the integration risk.

Putting it behind a trait matters more than it sounds: it is what would let a Windows-only
native backend be added later, or Whisper swapped in for accuracy, without rewriting the
front end.

**The cost, stated plainly:**

- onnxruntime is a large native dependency. The current release binary is **3.5 MB**; this
  would be the biggest thing in it by a wide margin, and the release profile is tuned for
  size (`opt-level = "s"`, `lto`, `strip`).
- A **model download on first run** — a streaming English model is on the order of
  100–300 MB.
- MSVC linking work for the FFI.
- Accuracy is good, not Whisper-class. That is the price of streaming.
- `panic = "abort"` is set for release. Most C++ FFI is fine with this, but it is worth
  knowing if something aborts unexpectedly.

**The cheaper first step worth considering.** The Windows-native route (`windows` crate →
`Windows.Media.SpeechRecognition`) is free, on-device, supports continuous dictation *and*
partial hypotheses, and needs **no model download and no C++ linking**. It is Windows-only
and therefore does not meet the cross-platform requirement, but behind the same trait it
would be a fast first win that a cross-platform backend slots in beside later. For a
Windows-first machine it is a materially better effort-to-value ratio than the table
position suggests.

**Cloud is the lowest-effort option and the one to be most careful about.** AssemblyAI's
free tier is genuinely usable without a card and gives real streaming, but dictation into a
coding assistant sends whatever you say — including code, paths and identifiers — to a
third party. For prompts typed at a developer, that is a privacy decision rather than a
technical one.

---

## 6. How it would fit terminice

Most of the machinery already exists:

```
cpal capture → f32 mono → 16 kHz (rubato) → VAD gate
   → sherpa-onnx OnlineRecognizer → tauri Channel → composer
```

- **Streaming partials.** The app already streams over `tauri::ipc::Channel<ClaudeEvent>`.
  A `Channel<VoiceEvent>` is the same pattern; nothing new has to be invented.
- **Insertion.** `replaceRange` already exists on the composer handle — it was added for
  `@` file mentions. That is exactly the primitive dictation needs.
- **Settings.** Follows the existing `~/.config/terminice-settings.json` pattern: mode
  (`hold` / `tap` / `off`), language, auto-submit.
- **New surface.** `src-tauri/src/voice.rs`, a `useVoice` hook, and a microphone button
  beside the fast-mode flame.

Suggested shape, mirroring how `claude.rs` is organised:

| Piece | Responsibility |
|---|---|
| `voice.rs` | Device selection, capture, resampling, the engine trait |
| `engines/` | One module per backend, behind `SpeechEngine` |
| `Channel<VoiceEvent>` | `interim`, `final`, `level`, `error`, `ready` |
| `useVoice.ts` | Mode state machine, caret capture and restore |

---

## 7. Traps

- **Windows 11 muting the microphone is a silent failure.** With
  *Settings → Privacy & security → Microphone → Let desktop apps access your microphone*
  off, `cpal` opens the stream successfully and delivers **all zeros**. Detect silent
  buffers and say so, or it looks broken with no error anywhere.
- **macOS needs `NSMicrophoneUsageDescription`** in the bundle's `Info.plist` regardless of
  whether capture is JS or Rust. There is a known Tauri issue
  ([#9928](https://github.com/tauri-apps/tauri/issues/9928)) where a **signed** build stops
  prompting even with that key present. Unsigned dev builds work; signing is where it
  breaks.
- **Linux and PipeWire/PulseAudio.** When either is running it holds the ALSA `default`
  device, so a second stream opening it through the ALSA host fails with `DeviceBusy`. Use
  cpal's `pipewire`/`pulseaudio` features.
- **Set the buffer size explicitly.** `BufferSize::Default` uses the system default, which
  is fine for transcription but poor for a responsive level meter. `Fixed(1024)` is a
  sensible starting point.
- **Do not put the partial transcript through the composer's undo history.** Interims
  replace each other; pushing each one into CodeMirror's history would make Ctrl+Z useless.

---

## 8. Unverified

- Whether the **sherpa-onnx Rust crate** exposes GPU provider flags. The capability exists
  upstream in onnxruntime; the crate's build features were not confirmed.
- Whether **WKWebView** supports `webkitSpeechRecognition`. Moot while the Web Speech API
  is ruled out, but recorded in case that changes.
- Whether `Windows.Media.SpeechRecognition` needs a capability declaration for an unsigned
  Win32 binary on the target Windows build.
- Exact ONNX model sizes for Moonshine.
- The `voice_activity_detector` licence text.

Each of these is a single test, not a blocker.

---

## 9. Revisited 2026-10-09 — what changes if it need not work offline

Three constraints were relaxed, and one was added:

| | Before | Now |
|---|---|---|
| Works with no network | Required | **Not required** — online is fine |
| Nothing leaves the machine | Preferred (privacy) | **Required** — no third party, explicitly |
| Live partial transcript | Open question | **Not required** — hold-to-talk only |
| Binary size | Tuned for it (`opt-level = "s"`, `strip`) | Several MB is fine |

**"Online only" and "no third party" together still mean local inference.** They are not in
conflict, but they are easy to conflate: relaxing "offline" does not open the door to a
cloud recogniser, because a cloud recogniser *is* the third party. It does mean the model
can be fetched on first use rather than bundled, and that the feature may be unavailable
without a network as long as it says so.

### What that does to the five criteria

§5 chose sherpa-onnx because it was the only engine that was *simultaneously* offline,
cross-platform, natively streaming, permissively licensed and actively maintained. Two of
those five no longer bind:

- **Offline** — dropped. Whisper, sherpa-onnx and Vosk are all local anyway, so this
  criterion was doing no work beyond excluding cloud, which "no third party" excludes
  harder.
- **Natively streaming** — dropped, and this is the one that matters. Streaming was the
  whole reason to prefer a streaming engine: it is what produces words while you speak.
  Hold-to-talk gives the utterance a beginning and an end, so the transcript is only
  needed once, and a batch engine is not merely adequate but a *better fit* — the whole
  clip is available to the decoder, including its end, which is exactly what makes Whisper
  as accurate as it is.

The three that remain — local, permissive, maintained, cross-platform — are met by both
whisper.cpp and sherpa-onnx.

### Revised recommendation: `cpal` + `whisper-rs`, behind the same trait

`whisper-rs` 0.16.0 (Unlicense) is the Rust binding for whisper.cpp. Under hold-to-talk it
is the better fit than sherpa-onnx, on four counts:

1. **Accuracy.** Best available, and the batch model is the reason. `small.en` or
   `base.en` is well beyond anything streaming at the same model size.
2. **Punctuation and casing come free.** Whisper emits a punctuated, capitalised sentence.
   Streaming zipformer output is unpunctuated lowercase unless a second punctuation model
   is added — which is a second model, a second dependency, and its own latency.
3. **No streaming state machine.** One call per utterance. The `feed()`/endpoint/VAD
   machinery in §4 and §6 collapses to "buffer while held, decode on release".
4. **The traps shrink.** VAD was needed to find where an utterance ends (§4); the key-up
   is that answer, so the Silero/`voice_activity_detector` licence problem stops being
   relevant for the core path. A plain RMS threshold is enough to warn "nothing was
   captured" — and it is still worth having, because of the all-zeros failure in §7.

**What it costs that sherpa-onnx does not:**

- **Latency after release, not before.** Nothing appears until you let go, and then the
  whole clip is decoded. For a five-second utterance with `base.en` on CPU, expect roughly
  0.5–2 s. That is fine for prompts and bad for anything that wants to feel live. If that
  wait turns out to be the thing that makes the feature feel wrong, streaming is the fix
  and sherpa-onnx is still the answer.
- **A bigger model file.** `tiny.en` ≈ 75 MB, `base.en` ≈ 142 MB, `small.en` ≈ 466 MB,
  against 100–300 MB for a streaming English zipformer. Size was declared acceptable.
- **A CPU spike per utterance** rather than a steady trickle, which matters if a turn is
  running at the same time.
- whisper.cpp is C++ FFI, like every other option here — see §4's note. `whisper-rs` adds
  a build step (`cmake`) and links ggml.

**sherpa-onnx is not wasted if Whisper is chosen.** It also runs Whisper models through
onnxruntime, so it is the one dependency that keeps both doors open: swapping between a
Whisper model and a streaming zipformer would be a model path and a constructor, not a
second engine. If the streaming door is genuinely closed, `whisper-rs` is the more direct
route and the smaller dependency.

**Whisper's 30-second window is not a problem for hold-to-talk, but it is a bound.** The
encoder is fed a 30 s mel frame regardless, so a two-word utterance costs about as much as
a sentence. `--length`/`--step` chunking is what whisper.cpp's own real-time demo uses and
is not needed here. A clip longer than 30 s would need splitting; capping the hold at 30 s
is simpler and honest.

### The Windows-native option gets better, with one caveat

§5 closed with `Windows.Media.SpeechRecognition` as the cheap first win: on-device, free,
no model download, no C++ linking, and it produces partial hypotheses. Hold-to-talk makes
it *more* attractive, not less — and "online only" was never what blocked it.

**The caveat is the exact one that matters here.** `SpeechRecognizer` is documented to use
the on-device recogniser, but Windows also has an *Online speech recognition* setting
(Settings → Privacy & security → Speech) and it is **Unverified** whether a
`SpeechRecognizer` with a dictation grammar can reach the cloud when that setting is on.
If it can, audio leaves the machine and the "no third party" constraint is broken by a
user-level Windows setting that the app cannot see. That has to be tested before this
route is chosen, and the test is: turn the setting on, disable the network, and see
whether recognition still works. It is a single test, but it is the deciding one for this
option rather than a footnote.

### Unchanged

- **`cpal` for capture.** Nothing about the new constraints touches it, and
  `whisper-rs`'s own examples and every crate in the ecosystem feed it from cpal.
- **The trait.** See §5. Which engine is behind it is now a live choice rather than a
  settled one, which is the whole reason for the abstraction.
- **Everything in §7.** The all-zeros microphone failure is caught by a silence check
  rather than by VAD now, and the rest is untouched.
- **The composer integration in §6**, minus the interim path: one `replaceRange` at the
  end of the utterance instead of a stream of them. The caret capture and the
  `input_diverged` abandonment are still worth copying — they matter more with one insert
  than with many, because there is no chance to correct a misplaced one.
