import { type Sentence, ttsTextFor } from "./segment";

export type ReaderState = "idle" | "generating" | "playing" | "paused";

export interface ReaderCallbacks {
  onState(state: ReaderState): void;
  /** null = nothing highlighted (stopped / finished). */
  onSentence(index: number | null): void;
  onError(message: string): void;
}

// Generation is serialized and can run slower than playback (especially on
// short sentences and high speeds), so keep a deep buffer: while a long
// sentence plays, the engine works ahead and builds headroom.
const LOOKAHEAD = 8;

export class Reader {
  private audio = new Audio();
  // Route playback through one persistent AudioContext so the output pipeline
  // (Bluetooth especially) stays warm across clip boundaries — a fresh sink
  // per clip re-primes AirPods and adds a fixed pause per sentence.
  private ctx = new AudioContext();
  private srcNode: MediaElementAudioSourceNode;
  private cache = new Map<number, Promise<Blob>>();
  private currentUrl: string | null = null;
  private epoch = 0;
  private prefetching = false;
  index = -1;
  state: ReaderState = "idle";

  private endedAt = 0;

  constructor(
    private synthesize: (text: string, skip?: () => boolean) => Promise<Blob>,
    private sentences: Sentence[],
    private fullText: string,
    private cb: ReaderCallbacks,
  ) {
    this.srcNode = this.ctx.createMediaElementSource(this.audio);
    this.srcNode.connect(this.ctx.destination);
    this.audio.preservesPitch = true;
    this.audio.addEventListener("ended", () => {
      this.endedAt = performance.now();
      void this.playFrom(this.index + 1);
    });
    // Boundary gap meter: wall-clock silence between clips, visible in the
    // console so a listener's install can be diagnosed in the field.
    this.audio.addEventListener("playing", () => {
      if (this.endedAt > 0) {
        console.log(
          `[read-aloud] sentence ${this.index}: boundary gap ${Math.round(performance.now() - this.endedAt)}ms`,
        );
        this.endedAt = 0;
      }
    });
    this.audio.addEventListener("error", () => {
      if (this.state === "playing") this.cb.onError("Audio playback failed.");
    });
  }

  get length(): number {
    return this.sentences.length;
  }

  setSpeed(speed: number): void {
    this.audio.playbackRate = speed;
    this.audio.defaultPlaybackRate = speed;
  }

  /** Call when the voice changes: cached audio is for the old voice. */
  invalidateCache(): void {
    this.cache.clear();
  }

  private setState(state: ReaderState): void {
    this.state = state;
    this.cb.onState(state);
  }

  private textFor(index: number, fromOffset?: number): string {
    const s = this.sentences[index];
    return s ? ttsTextFor(this.fullText, s, fromOffset) : "";
  }

  /** Start reading at sentence `index`; optionally mid-sentence at `fromOffset`. */
  async playFrom(index: number, fromOffset?: number): Promise<void> {
    const ep = ++this.epoch;
    // Autoplay policy starts the context suspended; the first playFrom runs in
    // a user-gesture context, which is what resume() needs.
    if (this.ctx.state === "suspended") void this.ctx.resume();
    this.audio.pause();

    // Skip past sentences with nothing readable.
    while (index < this.sentences.length && this.textFor(index) === "") index++;
    if (index >= this.sentences.length) {
      this.stop();
      return;
    }

    this.index = index;
    this.cb.onSentence(index);
    this.setState("generating");

    try {
      // A mid-sentence start is a one-off — generate it directly, uncached.
      const blobPromise =
        fromOffset !== undefined
          ? this.synthesize(this.textFor(index, fromOffset))
          : this.ensureCached(index);
      // Queue the lookahead behind the current sentence right away so the
      // engine rolls straight into it instead of idling until playback starts.
      this.prefetch();
      const blob = await blobPromise;
      if (ep !== this.epoch) return;

      if (this.currentUrl) URL.revokeObjectURL(this.currentUrl);
      this.currentUrl = URL.createObjectURL(blob);
      this.audio.src = this.currentUrl;
      this.audio.playbackRate = this.audio.defaultPlaybackRate;
      await this.audio.play();
      if (ep !== this.epoch) return;
      this.setState("playing");
    } catch (err) {
      if (ep !== this.epoch) return;
      this.setState("idle");
      this.cb.onError(err instanceof Error ? err.message : String(err));
    }
  }

  private ensureCached(index: number): Promise<Blob> {
    let promise = this.cache.get(index);
    if (!promise) {
      // Evicted from the cache (jump, voice change) means no longer wanted.
      promise = this.synthesize(this.textFor(index), () => this.cache.get(index) !== promise);
      this.cache.set(index, promise);
      promise.catch(() => this.cache.delete(index));
    }
    return promise;
  }

  private prefetch(): void {
    if (this.prefetching) return;
    this.prefetching = true;
    try {
      for (let i = this.index + 1; i <= this.index + LOOKAHEAD; i++) {
        if (i >= this.sentences.length) break;
        if (this.textFor(i) !== "") void this.ensureCached(i).catch(() => {});
      }
      // Drop entries far outside the reading window.
      for (const key of this.cache.keys()) {
        if (key < this.index - 1 || key > this.index + LOOKAHEAD + 1) {
          this.cache.delete(key);
        }
      }
    } finally {
      this.prefetching = false;
    }
  }

  toggle(): void {
    if (this.state === "playing") {
      this.audio.pause();
      this.setState("paused");
    } else if (this.state === "paused") {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      void this.audio.play().then(() => this.setState("playing"));
    }
  }

  next(): void {
    if (this.index >= 0) void this.playFrom(this.index + 1);
  }

  prev(): void {
    if (this.index > 0) void this.playFrom(this.index - 1);
  }

  stop(): void {
    this.epoch++;
    this.endedAt = 0;
    this.audio.pause();
    this.audio.removeAttribute("src");
    if (this.currentUrl) {
      URL.revokeObjectURL(this.currentUrl);
      this.currentUrl = null;
    }
    this.setState("idle");
    this.cb.onSentence(null);
  }
}
