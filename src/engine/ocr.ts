// Tesseract, entirely from our own origin. Every path tesseract.js would otherwise fetch
// from jsDelivr (worker, wasm core, language data) is pointed at /demo/ocr/vendor/, which
// scripts/copy-vendor.mjs fills at build time. The image goes to a Web Worker on this
// machine and nowhere else.

import Tesseract from 'tesseract.js';
import type { Fragment, Group } from '../lib/layout';

export interface OcrProgress {
  stage: string;
  /** 0..1 within the stage, or null if the stage has no measurable progress */
  progress: number | null;
}

export interface OcrResult {
  groups: Group[];
  /** mean word confidence, 0..1 */
  confidence: number;
  /** radians tesseract rotated the image by before reading it */
  rotation: number;
}

const vendor = (p: string) => new URL(`${import.meta.env.BASE_URL}vendor/tesseract/${p}`, location.href).href;

const STAGES: Record<string, string> = {
  'loading tesseract core': 'Loading the OCR engine',
  'initializing tesseract': 'Starting the OCR engine',
  'initialized tesseract': 'Starting the OCR engine',
  'loading language traineddata': 'Loading English + Latvian models',
  'loading language traineddata (from cache)': 'Loading English + Latvian models',
  'loaded language traineddata': 'Loading English + Latvian models',
  'initializing api': 'Preparing to read',
  'initialized api': 'Preparing to read',
  'recognizing text': 'Reading text',
};

let listener: ((p: OcrProgress) => void) | null = null;
let workerPromise: Promise<Tesseract.Worker> | null = null;

function getWorker(): Promise<Tesseract.Worker> {
  if (!workerPromise) {
    workerPromise = Tesseract.createWorker(['eng', 'lav'], Tesseract.OEM.LSTM_ONLY, {
      workerPath: vendor('worker.min.js'),
      corePath: vendor('core'),
      langPath: vendor('lang'),
      // Load the worker straight from its URL rather than via a blob: copy, so the page's
      // Content-Security-Policy can stay at worker-src 'self'.
      workerBlobURL: false,
      logger: (m) => listener?.({ stage: STAGES[m.status] ?? m.status, progress: Number.isFinite(m.progress) ? m.progress : null }),
      errorHandler: () => {},
    })
      .then(async (w) => {
        await w.setParameters({
          // One uniform block: keeps a receipt's price column on the same line as its
          // item. Automatic segmentation (PSM 3) split skewed receipts into a names block
          // and a prices block and then dropped the prices outright. Columns that genuinely
          // are separate are split again from geometry in lib/layout.ts.
          tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK,
          preserve_interword_spaces: '1',
        });
        return w;
      })
      .catch((e) => {
        workerPromise = null; // let the next file try again
        throw e;
      });
  }
  return workerPromise;
}

/** Warm the engine up (downloads core + models) without reading anything. */
export function preloadOcr(): void {
  getWorker().catch(() => {});
}

export async function recognize(
  image: HTMLCanvasElement,
  page: number,
  onProgress: (p: OcrProgress) => void,
): Promise<OcrResult> {
  listener = onProgress;
  try {
    const worker = await getWorker();
    const { data } = await worker.recognize(image, { rotateAuto: true }, { blocks: true, text: false });
    const W = image.width;
    const H = image.height;
    const groups: Group[] = [];
    let confSum = 0;
    let confN = 0;
    for (const block of data.blocks ?? []) {
      for (const para of block.paragraphs) {
        for (const line of para.lines) {
          const words: Fragment[] = line.words
            // below 30% a "word" is almost always texture read as text: a table edge, a shadow
            .filter((w) => w.text.trim() && w.confidence >= 30)
            .map((w) => ({
              text: w.text,
              conf: Math.max(0, Math.min(1, w.confidence / 100)),
              box: { x0: w.bbox.x0 / W, y0: w.bbox.y0 / H, x1: w.bbox.x1 / W, y1: w.bbox.y1 / H },
            }));
          for (const w of words) {
            confSum += w.conf;
            confN++;
          }
          if (words.length) groups.push({ page, words });
        }
      }
    }
    return { groups, confidence: confN ? confSum / confN : 0, rotation: data.rotateRadians ?? 0 };
  } finally {
    listener = null;
  }
}
