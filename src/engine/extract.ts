// File in, positioned lines out. Decides per page between the PDF text layer and OCR.
// The heavy libraries are imported on first use, so the page itself stays small.

import { buildLines, type Group } from '../lib/layout';
import type { SourceLine } from '../lib/types';

export interface PreviewPage {
  url: string;
  width: number;
  height: number;
  /** radians; the overlay is turned by this to sit on a deskewed reading */
  rotation: number;
}

export interface Extraction {
  pages: PreviewPage[];
  lines: SourceLine[];
  method: 'text' | 'ocr' | 'mixed';
  /** mean OCR word confidence, when OCR ran */
  ocrConfidence: number | null;
  /** pages beyond the limit that were not read */
  skippedPages: number;
}

export type ProgressFn = (stage: string, progress: number | null) => void;

/** Errors a visitor should read as-is: they explain what to do next. */
export class FriendlyError extends Error {}

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
const OCR_MAX_SIDE = 2400;
const OCR_MIN_WIDTH = 1100;

async function sniff(file: File): Promise<'pdf' | 'image' | 'heic' | 'unknown'> {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const ascii = String.fromCharCode(...head);
  if (ascii.startsWith('%PDF')) return 'pdf';
  if (ascii.slice(4, 12).match(/ftyp(heic|heix|hevc|mif1|msf1|heif)/)) return 'heic';
  if (file.type.startsWith('image/')) return 'image';
  if (/^\x89PNG|^\xff\xd8\xff|^GIF8|^RIFF|^BM/.test(ascii)) return 'image';
  return 'unknown';
}

function toBlobUrl(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(URL.createObjectURL(b)) : reject(new Error('toBlob failed'))), 'image/jpeg', 0.9),
  );
}

/** Scale into the range tesseract reads best: small photos up, huge scans down. */
function ocrCanvas(src: CanvasImageSource, w: number, h: number): HTMLCanvasElement {
  let scale = 1;
  if (Math.max(w, h) > OCR_MAX_SIDE) scale = OCR_MAX_SIDE / Math.max(w, h);
  else if (w < OCR_MIN_WIDTH) scale = Math.min(2, OCR_MIN_WIDTH / w);
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

export async function extract(
  file: File,
  onProgress: ProgressFn,
  onPreview: (pages: PreviewPage[]) => void = () => {},
): Promise<Extraction> {
  if (file.size > MAX_FILE_BYTES) {
    throw new FriendlyError(`That file is ${(file.size / 1048576).toFixed(0)} MB. The limit is 25 MB — export a smaller PDF or photo.`);
  }
  const kind = await sniff(file);
  if (kind === 'heic') {
    throw new FriendlyError('HEIC photos (the iPhone default) cannot be opened by this browser. Share it as JPEG, or take a screenshot of it.');
  }
  if (kind === 'unknown') {
    throw new FriendlyError('This is not a PDF or an image. Try a PDF, JPG, PNG or WEBP.');
  }

  if (kind === 'pdf') {
    onProgress('Opening PDF', null);
    const { readPdf, PdfPasswordError, MAX_PAGES } = await import('./pdf');
    let result;
    try {
      result = await readPdf(await file.arrayBuffer());
    } catch (e) {
      if (e instanceof PdfPasswordError) throw new FriendlyError('This PDF is password-protected. Remove the password and try again.');
      throw new FriendlyError('This PDF could not be opened. It may be damaged, or use a feature this reader does not support.');
    }
    const groups: Group[] = [];
    const pages: PreviewPage[] = [];
    let usedOcr = false;
    let usedText = false;
    let confSum = 0;
    let confN = 0;
    for (const p of result.pages) {
      const shown: PreviewPage = { url: await toBlobUrl(p.canvas), width: p.canvas.width, height: p.canvas.height, rotation: 0 };
      pages.push(shown);
      // show the page before OCR starts on it: reading a scan takes seconds
      onPreview([...pages]);
      if (p.hasText) {
        usedText = true;
        groups.push(...p.groups);
      } else {
        usedOcr = true;
        const { recognize } = await import('./ocr');
        const label = result.pages.length > 1 ? ` (page ${p.index + 1})` : '';
        const r = await recognize(p.canvas, p.index, ({ stage, progress }) => onProgress(stage + label, progress));
        groups.push(...r.groups);
        shown.rotation = r.rotation;
        confSum += r.confidence;
        confN++;
      }
    }
    onPreview([...pages]);
    return {
      pages,
      lines: buildLines(groups),
      method: usedOcr && usedText ? 'mixed' : usedOcr ? 'ocr' : 'text',
      ocrConfidence: confN ? confSum / confN : null,
      skippedPages: Math.max(0, result.totalPages - MAX_PAGES),
    };
  }

  // an image
  onProgress('Opening image', null);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new FriendlyError('This image could not be decoded. Try saving it as JPG or PNG.');
  }
  const canvas = ocrCanvas(bitmap, bitmap.width, bitmap.height);
  const preview: PreviewPage = { url: URL.createObjectURL(file), width: bitmap.width, height: bitmap.height, rotation: 0 };
  bitmap.close();
  onPreview([preview]);
  const { recognize } = await import('./ocr');
  const r = await recognize(canvas, 0, ({ stage, progress }) => onProgress(stage, progress));
  preview.rotation = r.rotation;
  return {
    pages: [preview],
    lines: buildLines(r.groups),
    method: 'ocr',
    ocrConfidence: r.confidence,
    skippedPages: 0,
  };
}
