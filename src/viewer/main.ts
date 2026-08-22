import { loadPdf, type LoadedPdf, type PdfSource } from "./pdfDoc";
import { PdfView } from "./pdfView";
import { Reader, type ReaderState } from "./reader";
import {
  segmentSentences,
  sentenceIndexAt,
  snapToWordStart,
  type Sentence,
} from "./segment";
import { TtsEngine, type VoiceId } from "./tts";

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

const openBtn = $<HTMLButtonElement>("open-btn");
const fileInput = $<HTMLInputElement>("file-input");
const docTitle = $("doc-title");
const playBtn = $<HTMLButtonElement>("play-btn");
const prevBtn = $<HTMLButtonElement>("prev-btn");
const nextBtn = $<HTMLButtonElement>("next-btn");
const stopBtn = $<HTMLButtonElement>("stop-btn");
const speedInput = $<HTMLInputElement>("speed");
const speedValue = $("speed-value");
const voiceSelect = $<HTMLSelectElement>("voice");
const statusBar = $("status-bar");
const statusText = $("status-text");
const statusProgress = $<HTMLProgressElement>("status-progress");
const grantBtn = $<HTMLButtonElement>("grant-btn");
const container = $("viewer-container");
const versionEl = $("version");
const pagesEl = $("pages");
const dropHint = $("drop-hint");

const VOICES: Array<{ id: VoiceId; label: string }> = [
  { id: "af_heart", label: "Heart — US female (best)" },
  { id: "af_bella", label: "Bella — US female" },
  { id: "af_nicole", label: "Nicole — US female (soft)" },
  { id: "am_michael", label: "Michael — US male" },
  { id: "am_fenrir", label: "Fenrir — US male" },
  { id: "am_puck", label: "Puck — US male" },
  { id: "bf_emma", label: "Emma — British female" },
  { id: "bm_george", label: "George — British male" },
  { id: "bm_fable", label: "Fable — British male" },
];

let currentVoice: VoiceId =
  (localStorage.getItem("voice") as VoiceId | null) ?? "af_heart";
let speed = Number(localStorage.getItem("speed") ?? "1") || 1;

let pdf: LoadedPdf | null = null;
let view: PdfView | null = null;
let reader: Reader | null = null;
let sentences: Sentence[] = [];
let modelReady = false;

const engine = new TtsEngine();

function showStatus(message: string, percent: number | null = null): void {
  statusBar.hidden = false;
  statusText.textContent = message;
  statusProgress.hidden = percent === null;
  if (percent !== null) statusProgress.value = percent;
}

function hideStatus(): void {
  statusBar.hidden = true;
  grantBtn.hidden = true;
}

/** chrome.permissions exists only when running as an installed extension. */
function chromePermissions(): typeof chrome.permissions | null {
  return typeof chrome !== "undefined" && chrome.permissions
    ? chrome.permissions
    : null;
}

/**
 * Fetching PDFs from arbitrary sites needs the optional host permission.
 * Offer a one-click grant, then retry the same URL.
 */
async function offerHostPermission(url: string): Promise<boolean> {
  const permissions = chromePermissions();
  if (!permissions) return false;
  if (await permissions.contains({ origins: ["<all_urls>"] })) return false;
  showStatus("This PDF is on a website Chrome hasn't allowed the reader to reach yet.");
  grantBtn.hidden = false;
  grantBtn.onclick = async () => {
    const granted = await permissions.request({ origins: ["<all_urls>"] });
    if (granted) {
      grantBtn.hidden = true;
      void openPdf({ url });
    }
  };
  return true;
}

function startModelLoad(): void {
  if (modelReady) return;
  void engine
    .load((p) => {
      if (p.done) {
        modelReady = true;
        showStatus(
          `Voice ready (${engine.device === "webgpu" ? "GPU" : "CPU"} mode)`,
        );
        setTimeout(() => {
          if (statusText.textContent?.startsWith("Voice ready")) hideStatus();
        }, 2500);
      } else {
        showStatus(p.message, p.percent);
      }
    })
    .catch((err: unknown) => {
      showStatus(
        `Could not load the voice model: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
}

function setControlsEnabled(enabled: boolean): void {
  playBtn.disabled = !enabled;
  prevBtn.disabled = !enabled;
  nextBtn.disabled = !enabled;
  stopBtn.disabled = !enabled;
}

function onReaderState(state: ReaderState): void {
  playBtn.textContent =
    state === "playing" ? "⏸ Pause" : state === "generating" ? "⏳…" : "▶️ Read";
}

function onSentenceChange(index: number | null): void {
  if (!view || !pdf) return;
  if (index === null) {
    view.clearHighlight();
    return;
  }
  const s = sentences[index];
  if (!s) return;
  view.setHighlight(s.start, s.end);
  void view.scrollToOffset(s.start);
  localStorage.setItem(`pos:${pdf.fingerprint}`, String(index));
}

async function openPdf(source: PdfSource): Promise<void> {
  try {
    reader?.stop();
    showStatus("Loading PDF…");
    const loaded = await loadPdf(source, (msg) => showStatus(msg));
    pdf = loaded;
    document.title = `${loaded.title} — Read Aloud PDF`;
    docTitle.textContent = loaded.title;
    dropHint.hidden = true;
    pagesEl.replaceChildren();

    sentences = segmentSentences(loaded.fullText);
    if (sentences.length === 0) {
      showStatus(
        "No readable text found — this PDF looks like a scan. OCR isn't supported yet.",
      );
    } else {
      hideStatus();
    }

    view = new PdfView(container, pagesEl, loaded, (charOffset) => {
      if (!reader || !pdf) return;
      const wordStart = snapToWordStart(pdf.fullText, charOffset);
      const index = sentenceIndexAt(sentences, wordStart);
      void reader.playFrom(index, wordStart);
    });
    await view.init();

    reader = new Reader(
      (text, skip) => engine.synthesize(text, currentVoice, skip),
      sentences,
      loaded.fullText,
      {
        onState: onReaderState,
        onSentence: onSentenceChange,
        onError: (message) => showStatus(`Speech error: ${message}`),
      },
    );
    reader.setSpeed(speed);
    setControlsEnabled(sentences.length > 0);

    // Start fetching the voice model right away so it's warm by first play.
    startModelLoad();

    // ?pos=N deep-links a sentence (shareable position); otherwise fall back
    // to wherever the user last stopped in this document.
    const urlPos = Number(new URLSearchParams(location.search).get("pos"));
    const saved = Number(
      localStorage.getItem(`pos:${loaded.fingerprint}`) ?? "-1",
    );
    const start =
      Number.isInteger(urlPos) && urlPos >= 0 && urlPos < sentences.length
        ? urlPos
        : saved;
    if (start > 0 && start < sentences.length) {
      reader.index = start;
      const s = sentences[start];
      if (s) {
        view.setHighlight(s.start, s.end);
        void view.scrollToOffset(s.start);
      }
      showStatus("Resuming where you left off — press Read to continue.");
    }
  } catch (err) {
    if ("url" in source && (await offerHostPermission(source.url))) return;
    showStatus(
      `Could not open PDF: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// The manifest Chrome actually loaded is the ground truth for which build is
// running; outside the extension (vite dev) there is no manifest.
versionEl.textContent =
  typeof chrome !== "undefined" && chrome.runtime?.getManifest
    ? `v${chrome.runtime.getManifest().version}`
    : "dev";

// --- Toolbar wiring ---

openBtn.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  const data = await file.arrayBuffer();
  void openPdf({ data, name: file.name });
});

playBtn.addEventListener("click", () => {
  if (!reader) return;
  if (reader.state === "idle") {
    void reader.playFrom(Math.max(0, reader.index));
  } else {
    reader.toggle();
  }
});
prevBtn.addEventListener("click", () => reader?.prev());
nextBtn.addEventListener("click", () => reader?.next());
stopBtn.addEventListener("click", () => reader?.stop());

speedInput.value = String(speed);
speedValue.textContent = `${speed.toFixed(1)}×`;
speedInput.addEventListener("input", () => {
  speed = Number(speedInput.value);
  speedValue.textContent = `${speed.toFixed(1)}×`;
  localStorage.setItem("speed", String(speed));
  reader?.setSpeed(speed);
});

for (const v of VOICES) {
  const option = document.createElement("option");
  option.value = v.id;
  option.textContent = v.label;
  voiceSelect.append(option);
}
voiceSelect.value = currentVoice;
if (voiceSelect.value !== currentVoice) {
  // Saved voice no longer offered; fall back to the default.
  currentVoice = "af_heart";
  voiceSelect.value = currentVoice;
}
voiceSelect.addEventListener("change", () => {
  currentVoice = voiceSelect.value as VoiceId;
  localStorage.setItem("voice", currentVoice);
  reader?.invalidateCache();
});

// --- Keyboard shortcuts ---

document.addEventListener("keydown", (event) => {
  const target = event.target as HTMLElement;
  if (target.matches("input, select, textarea")) return;
  if (event.code === "Space") {
    event.preventDefault();
    playBtn.click();
  } else if (event.code === "ArrowRight") {
    reader?.next();
  } else if (event.code === "ArrowLeft") {
    reader?.prev();
  }
});

// --- Drag & drop ---

document.addEventListener("dragover", (event) => event.preventDefault());
document.addEventListener("drop", async (event) => {
  event.preventDefault();
  const file = event.dataTransfer?.files[0];
  if (!file || !/\.pdf$/i.test(file.name)) return;
  const data = await file.arrayBuffer();
  void openPdf({ data, name: file.name });
});

// --- ?file= URL parameter (context menu / toolbar entry points) ---

const fileParam = new URLSearchParams(location.search).get("file");
if (fileParam) {
  void openPdf({ url: fileParam });
}

// Debug handle for automated testing; not part of the UI surface.
(window as unknown as Record<string, unknown>)["__app"] = {
  get pdf() {
    return pdf;
  },
  get reader() {
    return reader;
  },
  get view() {
    return view;
  },
  get sentences() {
    return sentences;
  },
  get modelReady() {
    return modelReady;
  },
};
