/** Sentence segmentation over the extracted document text, preserving offsets. */

export interface Sentence {
  start: number;
  end: number;
}

/** Kokoro degrades past ~510 phoneme tokens; keep chunks comfortably short. */
const MAX_CHUNK = 280;

export function segmentSentences(text: string): Sentence[] {
  const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
  const out: Sentence[] = [];

  for (const seg of segmenter.segment(text)) {
    let start = seg.index;
    let end = seg.index + seg.segment.length;
    // Trim whitespace off both ends, keeping offsets in sync.
    while (start < end && /\s/.test(text[start]!)) start++;
    while (end > start && /\s/.test(text[end - 1]!)) end--;
    if (start >= end) continue;

    // Split oversized "sentences" (tables, headings without periods) at
    // whitespace so each chunk stays within the model's comfortable range.
    while (end - start > MAX_CHUNK) {
      let cut = -1;
      for (let i = start + MAX_CHUNK; i > start + MAX_CHUNK / 2; i--) {
        if (/\s/.test(text[i]!)) {
          cut = i;
          break;
        }
      }
      if (cut === -1) cut = start + MAX_CHUNK;
      pushIfReadable(out, text, start, cut);
      start = cut;
      while (start < end && /\s/.test(text[start]!)) start++;
    }
    pushIfReadable(out, text, start, end);
  }
  return out;
}

function pushIfReadable(out: Sentence[], text: string, start: number, end: number): void {
  if (end > start && /[\p{L}\p{N}]/u.test(text.slice(start, end))) {
    out.push({ start, end });
  }
}

/** Text actually sent to the TTS engine: de-hyphenate line breaks, collapse whitespace. */
export function ttsTextFor(text: string, s: Sentence, fromOffset?: number): string {
  const start = fromOffset !== undefined ? Math.max(s.start, fromOffset) : s.start;
  return text
    .slice(start, s.end)
    .replace(/([\p{Ll}])-\n\s*/gu, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** Index of the sentence containing offset, or the next one after it. */
export function sentenceIndexAt(sentences: Sentence[], offset: number): number {
  let lo = 0;
  let hi = sentences.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = sentences[mid]!;
    if (offset < s.start) hi = mid - 1;
    else if (offset >= s.end) lo = mid + 1;
    else return mid;
  }
  return Math.min(lo, sentences.length - 1);
}

/** Snap an offset back to the start of the word it falls inside. */
export function snapToWordStart(text: string, offset: number): number {
  let i = Math.max(0, Math.min(offset, text.length - 1));
  if (/\s/.test(text[i] ?? " ")) return i;
  while (i > 0 && !/\s/.test(text[i - 1]!)) i--;
  return i;
}
