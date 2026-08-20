# Chrome Web Store listing — copy-paste pack

Everything below maps 1:1 to fields in the [developer dashboard](https://chrome.google.com/webstore/devconsole).
Upload `read-aloud-pdf-0.1.0.zip` (produced by `npm run build && npm run zip`).

## Store listing tab

**Title:** Read Aloud PDF (Kokoro)

**Summary (short description):**
> Read PDFs aloud with a natural AI voice that runs entirely on your machine. Click a word to start there. Free, offline, private.

**Detailed description:**
> Listen to any PDF with a genuinely natural voice — generated locally on your
> computer, not in the cloud.
>
> ▶ OPENING A PDF
> 1. Already viewing a PDF in Chrome? Just click the extension's toolbar icon
>    (pin it from the puzzle-piece menu for one-click access) — the document
>    opens in the reader automatically.
> 2. On any other page, clicking the icon opens the reader with an
>    "Open PDF" button — pick a file from your computer, or simply drag &
>    drop a PDF onto the window.
> 3. You can also right-click any link to a PDF and choose
>    "Read aloud with Kokoro."
>
> ▶ READING
> Click any word and it starts reading from that word, with a synchronized
> highlight that follows along. Or press Read to hear the whole document from
> the beginning. Space pauses; the arrow keys skip a sentence.
>
> ✔ Natural neural voice (Kokoro-82M) running 100% on-device via WebGPU
> ✔ Click any word to start reading from it
> ✔ Follow-along sentence highlighting with auto-scroll
> ✔ Speed control 0.5×–3× without chipmunk pitch
> ✔ 9 voices (US & British, male & female)
> ✔ Remembers your position in every document
> ✔ Built for large documents — instant start, low memory
> ✔ Reads password-protected PDFs (you enter the password)
> ✔ Keyboard shortcuts: Space = play/pause, ←/→ = skip sentence
>
> 🔒 PRIVATE BY DESIGN
> Your documents never leave your computer. There is no server, no account,
> no analytics, and no data collection of any kind. The voice model (~310 MB)
> is downloaded once from Hugging Face on first use and cached; after that the
> extension works fully offline.
>
> 💰 FREE FOREVER
> No subscription, no premium tier, no locked voices. Everything runs on your
> own hardware, so there is nothing to charge for.
>
> Requirements: a GPU with WebGPU support (any Apple Silicon Mac or recent
> PC) recommended; a slower CPU fallback is used otherwise. English voices.
> Scanned/image-only PDFs are not supported (no OCR yet).

**Category:** Accessibility
**Language:** English

**Graphic assets:**
- Store icon 128×128: `public/icons/icon128.png`
- Screenshot 1280×800: `store-assets/screenshot-1280x800.png`

## Privacy tab

**Single purpose description:**
> Reads PDF documents aloud using an on-device text-to-speech voice, with
> click-to-start, follow-along highlighting, and speed control.

**Permission justifications:**

- `contextMenus`:
  > Adds one right-click item on links ("Read aloud with Kokoro") so users can
  > send a linked PDF directly to the reader.

- Optional host permission `<all_urls>`:
  > Only requested if the user asks the reader to fetch a PDF by URL from a
  > site that does not allow cross-origin requests. Granted at runtime via a
  > visible button; never requested at install. Used solely to download that
  > PDF file for reading. Local files and CORS-enabled URLs work without it.

- **Remote code:** None. All executable code (including the ONNX WASM runtime
  and the espeak phonemizer) is packaged in the extension. The extension
  downloads only *data* at runtime: the Kokoro voice-model weights
  (~310 MB, one time) from huggingface.co, cached locally.

**Data usage declarations:** check **"This item does not collect user data"** —
no data is collected, transmitted, or sold. Documents are processed entirely
on-device.

## Distribution tab

- Visibility: **Unlisted** (installable by anyone with the link; not searchable)
- Regions: all

## After submission

- Review typically takes a few days; broad-permission flags are avoided since
  install-time permissions are only `contextMenus`.
- When approved, the dashboard shows the install link to share/bookmark.
- Future updates: bump `version` in `public/manifest.json`, `npm run build`,
  re-zip, upload — installed copies auto-update.
