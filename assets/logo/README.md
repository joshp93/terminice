# Logo

The terminice mark — a robot whose canopy is a terminal window and whose body is a
command line.

| File | What it is |
|---|---|
| `terminice-logo.png` | **The master.** 740×740, transparent background, artwork at 95% of the width. This is the file every icon is generated from. |
| `terminice-logo-source.png` | The original AI-generated download, kept unmodified. 1024×1024, and it carries a *Made with AI* watermark in the top-right corner, which is why it is not the master. |
| `terminice-logo-original.png` | The first terminice logo — a green `>` prompt with cursor lines — kept for posterity. Superseded, and not referenced by the build. |
| `terminice-logo-original.ico` | The same previous logo, as it was embedded in the Windows executable. |

## Regenerating the icons

`src-tauri/icons/` is generated, not hand-edited. To rebuild every platform's icons from
the master:

```bash
pnpm tauri icon assets/logo/terminice-logo.png
```

That writes the Windows `.ico` (16, 24, 32, 48, 64 and 256 px), the macOS `.icns`, the
PNG sizes Tauri's config names, the Microsoft Store tiles, and the Android and iOS sets.

### Why the master is cropped

The source image is 1024×1024 with the artwork occupying only 703×393 of it, and a
watermark at x 871–999, y 22–38. The master is a 740×740 crop centred on the artwork (at
511, 494): that clears the watermark and brings the mark to 95% of the frame width.

**On the framing.** The first attempt left the artwork at 80% of the width and the icon
read as small against its own padding; 95% is what the mark actually needs. The crop is
deliberately *not* scaled up — 703px is the true resolution of the artwork, so the crop
happens at 1:1 and every smaller icon is a clean downscale. Only the 1024px macOS entry
would be an enlargement, and the exact size there does not matter.

The background is genuinely transparent rather than white. It can be hard to tell, since
most viewers render transparency as white.
