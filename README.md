# Read Aloud PDF (Kokoro)

A Chrome extension that reads PDFs aloud with a natural AI voice that runs
**entirely on your machine**. No subscription, no cloud, no account — the voice
model (Kokoro-82M) downloads once (~310 MB) and then works offline.

- **Click any word** in the PDF to start reading from it, or press **Read** for
  the whole document
- **Follow-along highlight** with auto-scroll
- **Speed control** 0.5×–3× (pitch-preserved), 9 curated voices
- **Remembers your position** per document — reopen and continue
- Built for **large documents**: pages render lazily, audio is generated
  sentence-by-sentence with a read-ahead buffer
- Handles standard **password-protected PDFs** (prompts for the password)

## Install

```bash
npm install
npm run build
```

Then in Chrome: `chrome://extensions` → enable **Developer mode** → **Load
unpacked** → select the `dist/` folder.

Click the extension icon to open the reader, then open a PDF file (or drop one
in). You can also right-click any PDF link → **Read aloud with Kokoro**.

First playback triggers the one-time voice model download. With a GPU
(WebGPU — any Apple Silicon Mac), generation is faster than real time; without
one it falls back to a smaller CPU model.

## What it can't do

- **FileOpen-DRM documents** (e.g. UL standards opened in Acrobat) are
  decrypted only inside Acrobat's plugin — a browser extension cannot open
  them, and this project deliberately does not try to bypass DRM. For those,
  use Acrobat's built-in *View → Read Out Loud*, or a future screen-reading
  companion app.
- **Scanned PDFs** (no text layer) — OCR is not implemented yet.

## Development

```bash
npm run dev        # vite dev server; open /viewer.html?file=<pdf-url>
npm run typecheck  # tsc --noEmit
npm run build      # typecheck + production build into dist/
```

Architecture (all in `src/viewer/`):

- `pdfDoc.ts` — pdf.js loading + text extraction; concatenates every text item
  into one document string, recording each item's character range (this
  mapping powers click-to-word and highlighting)
- `segment.ts` — sentence segmentation (`Intl.Segmenter`) over a
  newline-flattened copy so PDF line breaks don't split sentences; long
  "sentences" (tables) are chunked at ~280 chars
- `pdfView.ts` — lazy page rendering (IntersectionObserver, LRU eviction),
  text layer, CSS Custom Highlight API painting, click → char offset mapping
- `tts.ts` — Kokoro via kokoro-js: WebGPU (fp32) with WASM (q8) fallback,
  serialized generation queue, WAV encoding
- `reader.ts` — playback state machine: sentence queue, 2-sentence
  read-ahead cache, pause/resume/skip, speed

Build quirks (see `vite.config.ts` / `scripts/copy-ort.mjs`):

- ONNX runtime WASM is copied to `public/ort/` — MV3 forbids loading code
  from CDNs
- `phonemizer` (emscripten espeak build) breaks when bundled by rollup; it is
  marked external and shipped as the stock file at `public/phonemizer.js`
