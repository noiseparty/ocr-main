// pdf.js, self-hosted. Reads the text layer when the PDF has one (exact, instant) and
// renders the page for OCR when it does not (a scan saved as PDF).

import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { Fragment, Group } from '../lib/layout';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const vendor = (p: string) => new URL(`${import.meta.env.BASE_URL}vendor/pdfjs/${p}`, location.href).href;

export const MAX_PAGES = 5;

export interface PdfPage {
  index: number;
  /** rendered for display (and for OCR when there is no text layer) */
  canvas: HTMLCanvasElement;
  /** text-layer fragments; empty when the page is an image */
  groups: Group[];
  hasText: boolean;
}

export interface PdfResult {
  pages: PdfPage[];
  totalPages: number;
}

export class PdfPasswordError extends Error {}

/** A page with fewer printable characters than this is a scan with, at most, a stray label. */
const MIN_TEXT_CHARS = 25;

export async function readPdf(data: ArrayBuffer): Promise<PdfResult> {
  let doc: pdfjs.PDFDocumentProxy;
  const task = pdfjs.getDocument({
      data: new Uint8Array(data),
      standardFontDataUrl: vendor('standard_fonts/'),
      cMapUrl: vendor('cmaps/'),
      cMapPacked: true,
      wasmUrl: vendor('wasm/'),
      iccUrl: vendor('iccs/'),
      // no scripting, no forms: this is a reader, not a viewer
      enableXfa: false,
    });
  try {
    doc = await task.promise;
  } catch (e) {
    if (e instanceof Error && e.name === 'PasswordException') throw new PdfPasswordError('password');
    throw e;
  }

  const pages: PdfPage[] = [];
  const count = Math.min(doc.numPages, MAX_PAGES);
  for (let i = 1; i <= count; i++) {
    const page = await doc.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();

    const words: Fragment[] = [];
    let chars = 0;
    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue;
      const [, , c, d, e, f] = item.transform as number[];
      const h = Math.hypot(c ?? 0, d ?? 0) || item.height || 10;
      // corners in PDF space (origin bottom-left), then into the viewport (origin top-left)
      const [ax, ay] = base.convertToViewportPoint(e!, f! - h * 0.22);
      const [bx, by] = base.convertToViewportPoint(e! + item.width, f! + h * 0.8);
      words.push({
        text: item.str,
        conf: 1,
        box: {
          x0: Math.min(ax!, bx!) / base.width,
          x1: Math.max(ax!, bx!) / base.width,
          y0: Math.min(ay!, by!) / base.height,
          y1: Math.max(ay!, by!) / base.height,
        },
      });
      chars += item.str.replace(/\s/g, '').length;
    }
    const hasText = chars >= MIN_TEXT_CHARS;

    // Scans are rendered at ~216 dpi, which puts 10 pt type at the ~30 px cap height
    // tesseract reads best. Text pages only need to look sharp on screen.
    const target = hasText ? 1400 : 1800;
    const scale = Math.min(4, Math.max(1, target / base.width));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvas, viewport, background: '#ffffff' }).promise;

    // one group per text run: pdf.js runs are already line fragments
    pages.push({ index: i - 1, canvas, groups: hasText ? words.map((w) => ({ page: i - 1, words: [w] })) : [], hasText });
    page.cleanup();
  }
  const totalPages = doc.numPages;
  await task.destroy();
  return { pages, totalPages };
}
