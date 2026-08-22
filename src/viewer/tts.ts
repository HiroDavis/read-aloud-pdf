import { KokoroTTS, env, type GenerateOptions } from "kokoro-js";

export type VoiceId = NonNullable<GenerateOptions["voice"]>;

export interface TtsProgress {
  message: string;
  /** 0–100 while downloading, null when indeterminate. */
  percent: number | null;
  done: boolean;
}

interface ProgressEvent {
  status: string;
  file?: string;
  progress?: number;
  loaded?: number;
  total?: number;
}

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

// Kokoro pads generous silence around each clip; trim it so back-to-back
// sentences flow, keeping just enough tail for a natural pause.
const HEAD_PAD_S = 0.03;
const TAIL_PAD_S = 0.15;

function trimSilence(samples: Float32Array, sampleRate: number): Float32Array {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]!);
    if (a > peak) peak = a;
  }
  const threshold = Math.max(0.003, peak * 0.01);
  let first = 0;
  while (first < samples.length && Math.abs(samples[first]!) < threshold) first++;
  if (first >= samples.length) return samples;
  let last = samples.length - 1;
  while (last > first && Math.abs(samples[last]!) < threshold) last--;
  const start = Math.max(0, first - Math.round(HEAD_PAD_S * sampleRate));
  const end = Math.min(samples.length, last + 1 + Math.round(TAIL_PAD_S * sampleRate));
  return samples.subarray(start, end);
}

function wavBlob(samples: Float32Array, sampleRate: number): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buf);
  const writeString = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let o = 44;
  for (let i = 0; i < samples.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: "audio/wav" });
}

export class TtsEngine {
  private loadPromise: Promise<KokoroTTS> | null = null;
  /** The model is not reentrant — serialize all generate() calls. */
  private queue: Promise<unknown> = Promise.resolve();
  device: "webgpu" | "wasm" = "wasm";

  load(onProgress?: (p: TtsProgress) => void): Promise<KokoroTTS> {
    this.loadPromise ??= this.doLoad(onProgress);
    return this.loadPromise;
  }

  private async doLoad(onProgress?: (p: TtsProgress) => void): Promise<KokoroTTS> {
    // MV3 forbids loading code from the network: point the ONNX runtime at the
    // WASM files bundled with the extension.
    env.wasmPaths = new URL("ort/", document.baseURI).href;

    const gpu = (navigator as Navigator & {
      gpu?: { requestAdapter(): Promise<unknown | null> };
    }).gpu;
    if (gpu) {
      try {
        if (await gpu.requestAdapter()) this.device = "webgpu";
      } catch {
        // fall through to wasm
      }
    }
    // fp32 is the known-good dtype on WebGPU; q8 keeps the CPU path usable.
    const dtype = this.device === "webgpu" ? "fp32" : "q8";

    const loaded = new Map<string, number>();
    const totals = new Map<string, number>();
    const tts = await KokoroTTS.from_pretrained(MODEL_ID, {
      dtype,
      device: this.device,
      progress_callback: (event: ProgressEvent) => {
        if (!onProgress) return;
        if (event.status === "progress" && event.file) {
          loaded.set(event.file, event.loaded ?? 0);
          totals.set(event.file, event.total ?? 0);
          const sumLoaded = [...loaded.values()].reduce((a, b) => a + b, 0);
          const sumTotal = [...totals.values()].reduce((a, b) => a + b, 0);
          const mb = (n: number) => (n / 1024 / 1024).toFixed(0);
          onProgress({
            message: `Downloading voice model… ${mb(sumLoaded)} / ${mb(sumTotal)} MB (one time only)`,
            percent: sumTotal > 0 ? (sumLoaded / sumTotal) * 100 : null,
            done: false,
          });
        } else if (event.status === "ready") {
          onProgress({ message: "Voice ready", percent: 100, done: true });
        }
      },
    });
    onProgress?.({ message: "Voice ready", percent: 100, done: true });
    return tts;
  }

  /**
   * `skip` is checked when the job reaches the front of the queue: a queued
   * generation that is no longer wanted (jump, voice change) rejects instead
   * of tying up the engine.
   */
  synthesize(text: string, voice: VoiceId, skip?: () => boolean): Promise<Blob> {
    const run = async (): Promise<Blob> => {
      if (skip?.()) throw new Error("no longer needed");
      const tts = await this.load();
      const audio = await tts.generate(text, { voice });
      const samples = trimSilence(audio.audio as Float32Array, audio.sampling_rate);
      return wavBlob(samples, audio.sampling_rate);
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result;
  }
}
