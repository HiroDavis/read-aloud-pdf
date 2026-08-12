import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type {
  PDFDocumentProxy,
  PDFPageProxy,
  TextContent,
  TextItem,
} from "pdfjs-dist/types/src/display/api";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** A text item's location within the concatenated document text. */
export interface ItemRef {
  pageIndex: number;
  /** Index into the page's getTextContent().items / TextLayer.textDivs. */
  itemIndex: number;
  charStart: number;
  charEnd: number;
}

export interface PageTextInfo {
  pageIndex: number;
  charStart: number;
  charEnd: number;
  items: ItemRef[];
}

export interface LoadedPdf {
  doc: PDFDocumentProxy;
  fingerprint: string;
  title: string;
  fullText: string;
  pages: PageTextInfo[];
  /** getPage is 1-based in pdf.js; this caches proxies by 0-based index. */
  getPage(pageIndex: number): Promise<PDFPageProxy>;
  /** The exact TextContent used for extraction — items align with ItemRef.itemIndex. */
  getTextContent(pageIndex: number): TextContent | null;
}

export type PdfSource = { data: ArrayBuffer; name: string } | { url: string };

function isTextItem(item: unknown): item is TextItem {
  return typeof (item as TextItem).str === "string";
}

export async function loadPdf(
  source: PdfSource,
  onProgress?: (message: string) => void,
): Promise<LoadedPdf> {
  const params =
    "data" in source ? { data: source.data } : { url: source.url };
  const loadingTask = pdfjs.getDocument(params);
  loadingTask.onPassword = (
    callback: (password: string) => void,
    reason: number,
  ) => {
    const message =
      reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD
        ? "Incorrect password. Try again:"
        : "This PDF is password-protected. Password:";
    const password = window.prompt(message);
    if (password === null) throw new Error("Password entry cancelled");
    callback(password);
  };
  const doc = await loadingTask.promise;

  const pages: PageTextInfo[] = [];
  const contentByPage: TextContent[] = [];
  const pageProxies = new Map<number, PDFPageProxy>();
  let fullText = "";

  for (let p = 0; p < doc.numPages; p++) {
    if (p % 10 === 0) {
      onProgress?.(`Extracting text… page ${p + 1} of ${doc.numPages}`);
      // Let the UI paint between batches of pages.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const page = await doc.getPage(p + 1);
    pageProxies.set(p, page);
    const content = await page.getTextContent();
    const items = content.items.filter(isTextItem);
    contentByPage.push(content);

    if (p > 0) fullText += "\n\n";
    const charStart = fullText.length;
    const refs: ItemRef[] = [];
    let prev: TextItem | null = null;

    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      if (prev !== null) {
        const fontH = Math.hypot(item.transform[2], item.transform[3]) || 10;
        const sameLine =
          Math.abs(item.transform[5] - prev.transform[5]) < fontH * 0.4;
        const lastChar = fullText.at(-1) ?? "";
        if (!sameLine) {
          if (lastChar !== "\n") fullText += "\n";
        } else {
          const gap = item.transform[4] - (prev.transform[4] + prev.width);
          if (gap > fontH * 0.2 && !/\s/.test(lastChar)) fullText += " ";
        }
      }
      const start = fullText.length;
      fullText += item.str;
      refs.push({
        pageIndex: p,
        itemIndex: i,
        charStart: start,
        charEnd: fullText.length,
      });
      if (item.hasEOL && fullText.at(-1) !== "\n") fullText += "\n";
      prev = item;
    }

    pages.push({ pageIndex: p, charStart, charEnd: fullText.length, items: refs });
  }

  const metadata = await doc.getMetadata().catch(() => null);
  const info = metadata?.info as { Title?: string } | undefined;
  const title =
    info?.Title ||
    ("data" in source ? source.name : source.url.split("/").pop() ?? "PDF");

  return {
    doc,
    fingerprint: doc.fingerprints[0] ?? "unknown",
    title,
    fullText,
    pages,
    async getPage(pageIndex: number): Promise<PDFPageProxy> {
      let page = pageProxies.get(pageIndex);
      if (!page) {
        page = await doc.getPage(pageIndex + 1);
        pageProxies.set(pageIndex, page);
      }
      return page;
    },
    getTextContent(pageIndex: number): TextContent | null {
      return contentByPage[pageIndex] ?? null;
    },
  };
}

/** Find the page containing a character offset (binary search). */
export function pageAtOffset(pages: PageTextInfo[], offset: number): PageTextInfo | null {
  let lo = 0;
  let hi = pages.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const page = pages[mid]!;
    if (offset < page.charStart) hi = mid - 1;
    else if (offset >= page.charEnd) lo = mid + 1;
    else return page;
  }
  return pages[Math.min(lo, pages.length - 1)] ?? null;
}
