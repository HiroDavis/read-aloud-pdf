import { TextLayer } from "pdfjs-dist";
import type { ItemRef, LoadedPdf } from "./pdfDoc";
import { pageAtOffset } from "./pdfDoc";

interface RenderedPage {
  pageDiv: HTMLElement;
  textDivs: HTMLElement[];
}

const MAX_RENDERED_PAGES = 24;

/** Renders pages lazily, maps clicks to text offsets, and paints the reading highlight. */
export class PdfView {
  private pageDivs: HTMLElement[] = [];
  private cssScales: number[] = [];
  private rendered = new Map<number, RenderedPage>();
  private rendering = new Map<number, Promise<void>>();
  private visible = new Set<number>();
  private observer: IntersectionObserver;
  private highlightRange: { start: number; end: number } | null = null;

  constructor(
    private container: HTMLElement,
    private pagesEl: HTMLElement,
    private pdf: LoadedPdf,
    onWordClick: (charOffset: number) => void,
  ) {
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const idx = Number((entry.target as HTMLElement).dataset["page"]);
          if (entry.isIntersecting) {
            this.visible.add(idx);
            void this.renderPage(idx);
          } else {
            this.visible.delete(idx);
          }
        }
      },
      { root: container, rootMargin: "800px 0px" },
    );

    this.pagesEl.addEventListener("click", (event) => {
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) return; // user is selecting text
      const offset = this.offsetFromPoint(event.clientX, event.clientY);
      if (offset !== null) onWordClick(offset);
    });
  }

  async init(): Promise<void> {
    const targetWidth = Math.min(900, this.container.clientWidth - 48);
    for (let i = 0; i < this.pdf.doc.numPages; i++) {
      const page = await this.pdf.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const scale = targetWidth / base.width;
      this.cssScales.push(scale);

      const pageDiv = document.createElement("div");
      pageDiv.className = "page";
      pageDiv.dataset["page"] = String(i);
      pageDiv.style.width = `${base.width * scale}px`;
      pageDiv.style.height = `${base.height * scale}px`;
      // Custom properties the pdf.js text layer CSS expects.
      pageDiv.style.setProperty("--scale-factor", String(scale));
      pageDiv.style.setProperty("--user-unit", "1");
      pageDiv.style.setProperty(
        "--total-scale-factor",
        "calc(var(--scale-factor) * var(--user-unit))",
      );
      pageDiv.style.setProperty("--scale-round-x", "1px");
      pageDiv.style.setProperty("--scale-round-y", "1px");
      this.pagesEl.append(pageDiv);
      this.pageDivs.push(pageDiv);
      this.observer.observe(pageDiv);
    }
  }

  private async renderPage(pageIndex: number): Promise<void> {
    if (this.rendered.has(pageIndex)) return;
    const inFlight = this.rendering.get(pageIndex);
    if (inFlight) return inFlight;

    const task = this.doRenderPage(pageIndex).finally(() =>
      this.rendering.delete(pageIndex),
    );
    this.rendering.set(pageIndex, task);
    return task;
  }

  private async doRenderPage(pageIndex: number): Promise<void> {
    const pageDiv = this.pageDivs[pageIndex];
    const scale = this.cssScales[pageIndex];
    if (!pageDiv || scale === undefined) return;

    const page = await this.pdf.getPage(pageIndex);
    const dpr = window.devicePixelRatio || 1;
    const renderViewport = page.getViewport({ scale: scale * dpr });
    const cssViewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(renderViewport.width);
    canvas.height = Math.floor(renderViewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    await page.render({ canvas, canvasContext: ctx, viewport: renderViewport }).promise;

    const textContent = this.pdf.getTextContent(pageIndex);
    if (!textContent) return;
    const textLayerDiv = document.createElement("div");
    textLayerDiv.className = "textLayer";
    const textLayer = new TextLayer({
      textContentSource: textContent,
      container: textLayerDiv,
      viewport: cssViewport,
    });
    await textLayer.render();

    pageDiv.replaceChildren(canvas, textLayerDiv);
    this.rendered.set(pageIndex, { pageDiv, textDivs: textLayer.textDivs });
    this.evictFarPages(pageIndex);
    this.reapplyHighlight();
  }

  private evictFarPages(current: number): void {
    if (this.rendered.size <= MAX_RENDERED_PAGES) return;
    const candidates = [...this.rendered.keys()]
      .filter((i) => !this.visible.has(i))
      .sort((a, b) => Math.abs(b - current) - Math.abs(a - current));
    while (this.rendered.size > MAX_RENDERED_PAGES && candidates.length > 0) {
      const idx = candidates.shift()!;
      const entry = this.rendered.get(idx);
      if (!entry) continue;
      entry.pageDiv.replaceChildren();
      this.rendered.delete(idx);
    }
  }

  async ensureRendered(pageIndex: number): Promise<void> {
    await this.renderPage(pageIndex);
  }

  /** Map a click position to a character offset in the document text. */
  private offsetFromPoint(x: number, y: number): number | null {
    const range = document.caretRangeFromPoint(x, y);
    if (!range) return null;
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) return null;
    const span = node.parentElement;
    const item = this.itemForSpan(span);
    if (!item) return null;
    const local = Math.min(range.startOffset, item.charEnd - item.charStart);
    return item.charStart + local;
  }

  private itemForSpan(span: Element | null): ItemRef | null {
    if (!span) return null;
    const pageDiv = span.closest<HTMLElement>(".page");
    if (!pageDiv) return null;
    const pageIndex = Number(pageDiv.dataset["page"]);
    const entry = this.rendered.get(pageIndex);
    const pageInfo = this.pdf.pages[pageIndex];
    if (!entry || !pageInfo) return null;
    const itemIndex = entry.textDivs.indexOf(span as HTMLElement);
    if (itemIndex === -1) return null;
    return pageInfo.items[itemIndex] ?? null;
  }

  /** Highlight [start, end) using the CSS Custom Highlight API. */
  setHighlight(start: number, end: number): void {
    this.highlightRange = { start, end };
    this.reapplyHighlight();
  }

  clearHighlight(): void {
    this.highlightRange = null;
    CSS.highlights.delete("reading");
  }

  private reapplyHighlight(): void {
    if (!this.highlightRange) return;
    const { start, end } = this.highlightRange;
    const highlight = new Highlight();

    for (const pageInfo of this.pdf.pages) {
      if (pageInfo.charEnd <= start) continue;
      if (pageInfo.charStart >= end) break;
      const entry = this.rendered.get(pageInfo.pageIndex);
      if (!entry) continue;
      for (const item of pageInfo.items) {
        if (item.charEnd <= start || item.charStart >= end) continue;
        const span = entry.textDivs[item.itemIndex];
        const textNode = span?.firstChild;
        if (!textNode || textNode.nodeType !== Node.TEXT_NODE) continue;
        const len = textNode.textContent?.length ?? 0;
        const localStart = Math.max(0, Math.min(start - item.charStart, len));
        const localEnd = Math.max(0, Math.min(end - item.charStart, len));
        if (localStart >= localEnd) continue;
        const range = new Range();
        range.setStart(textNode, localStart);
        range.setEnd(textNode, localEnd);
        highlight.add(range);
      }
    }
    CSS.highlights.set("reading", highlight);
  }

  /** Scroll the given text offset into view (rendering its page if needed). */
  async scrollToOffset(offset: number): Promise<void> {
    const pageInfo = pageAtOffset(this.pdf.pages, offset);
    if (!pageInfo) return;
    await this.ensureRendered(pageInfo.pageIndex);
    const entry = this.rendered.get(pageInfo.pageIndex);
    if (!entry) return;
    const item =
      pageInfo.items.find((it) => it.charEnd > offset) ?? pageInfo.items.at(-1);
    const span = item ? entry.textDivs[item.itemIndex] : undefined;
    const target = span ?? entry.pageDiv;
    const rect = target.getBoundingClientRect();
    const containerRect = this.container.getBoundingClientRect();
    const margin = containerRect.height * 0.15;
    if (
      rect.top < containerRect.top + margin ||
      rect.bottom > containerRect.bottom - margin
    ) {
      target.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }
}
