# Logo

The terminice mark — a robot whose head is a terminal window and whose body is a command
line, in the app's own orange and green.

| File | What it is |
|---|---|
| `terminice-logo.png` | **The master.** 512×512, transparent background, artwork at 92% of the width. Every icon is generated from this, and the empty chat screen renders it too. |
| `terminice-logo-source.png` | The original AI-generated download, kept unmodified. An earlier, outlined version of the mark, and the only file carrying the *Made with AI* watermark. Historical — nothing reads it. |
| `terminice-logo-original.png` | The first terminice logo — a green `>` prompt with cursor lines — kept for posterity. Superseded, and not referenced by the build. |
| `terminice-logo-original.ico` | The same previous logo, as it was embedded in the Windows executable. |

## Regenerating the icons

`src-tauri/icons/` is generated, not hand-edited. To rebuild every platform's icons from
the master:

```bash
pnpm tauri icon assets/logo/terminice-logo.png
```

That writes the Windows `.ico` (16, 24, 32, 48, 64 and 256 px), the macOS `.icns`, the
PNG sizes Tauri's config names, the Microsoft Store tiles, and the Android and iOS sets —
50 files in all.

## Where it came from

The mark was drawn at 1024×1024, where the artwork occupied only 703×393 of the frame and
a *Made with AI* watermark sat in the top-right corner. The first working master was
therefore a crop of that: 740×740 centred on the artwork, which cleared the watermark and
brought the mark to 95% of the frame width.

That master has since been replaced by a redrawn version supplied directly, which is what
`terminice-logo.png` is now. It is 512×512 and needs no cropping.

Note the two differences from the artwork before it, in case either is a surprise: the
heavy black outlines are gone, and the source resolution is 512 rather than 740. The
second means the 1024 px macOS `.icns` entry is an enlargement, and every other size is a
downscale. If a larger original turns up, drop it in and regenerate — nothing else needs
to change.

The background is genuinely transparent rather than white. It can be hard to tell, since
most viewers render transparency as white.
