# Logo

`terminice-logo.png` is the master. It is 512×512 with a transparent background and the
artwork at 92% of the frame width. Every icon is generated from it, and the empty chat
screen renders it.

| File | Purpose |
|---|---|
| `terminice-logo.png` | The master. Source for all icons and for the in-app mark. |
| `terminice-logo-source.png` | The original download. Nothing reads it. |
| `terminice-logo-original.png` | The previous logo. Nothing reads it. |
| `terminice-logo-original.ico` | The previous logo as it was embedded in the executable. |

## Regenerating the icons

`src-tauri/icons/` is generated, never hand-edited:

```bash
pnpm tauri icon assets/logo/terminice-logo.png
```

That writes 50 files: the Windows `.ico` at 16, 24, 32, 48, 64 and 256 px; the macOS
`.icns`; the PNG sizes `tauri.conf.json` names; the Microsoft Store tiles; and the Android
and iOS sets. Only the 1024 px `.icns` entry is an enlargement of the master — every other
size is a downscale.

`src-tauri/build.rs` watches these files, so a regenerated logo reaches the executable
without any further step. The icon is embedded at compile time, so a running process keeps
the old one until it restarts.

The background is transparent, not white. Most viewers render transparency as white, which
makes that easy to misread.
