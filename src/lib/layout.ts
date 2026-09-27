// From positioned fragments of text to reading-order lines.
//
// Both extractors hand over fragments with boxes: pdf.js gives text runs, tesseract gives
// words grouped into its own lines. Neither grouping is what the parser needs. Tesseract's
// page segmentation happily cuts a table row into a "description" block and a "prices"
// block, and a PDF places "INVOICE" on the same baseline as the seller's name. So rows are
// rebuilt here from geometry alone: fragments that share a band of the page are one row,
// read left to right — and a row is split again where a wide gap separates two blocks of
// text that carry no money, because that is two columns of a header, not one line.

import { findAmounts } from './money';
import type { Box, SourceLine } from './types';

export interface Fragment {
  text: string;
  /** 0..1 */
  conf: number;
  /** page-fraction coordinates, 0..1, origin top-left */
  box: Box;
}

/** A run of fragments the extractor already knows belong together (a tesseract line). */
export interface Group {
  page: number;
  words: Fragment[];
}

interface Row {
  page: number;
  y0: number;
  y1: number;
  words: Fragment[];
}

const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

function union(boxes: Box[]): Box {
  return {
    x0: Math.min(...boxes.map((b) => b.x0)),
    y0: Math.min(...boxes.map((b) => b.y0)),
    x1: Math.max(...boxes.map((b) => b.x1)),
    y1: Math.max(...boxes.map((b) => b.y1)),
  };
}

/** Wider than this fraction of the page, a gap between money-free text is a column break. */
const COLUMN_GAP = 0.2;

export function buildLines(groups: Group[]): SourceLine[] {
  const rows: Row[] = [];
  const sorted = groups
    .filter((g) => g.words.some((w) => w.text.trim()))
    .map((g) => {
      const b = union(g.words.map((w) => w.box));
      return { ...g, y0: b.y0, y1: b.y1, x0: b.x0, x1: b.x1 };
    })
    .sort((a, b) => a.page - b.page || (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2);

  for (const g of sorted) {
    const h = g.y1 - g.y0;
    // Join the row this group overlaps by at least half of the shorter height, provided it
    // does not also overlap horizontally with what is already there (that would be the line
    // above or below, not a neighbour on the same line).
    let target: Row | undefined;
    for (let i = rows.length - 1; i >= 0 && i >= rows.length - 4; i--) {
      const r = rows[i]!;
      if (r.page !== g.page) continue;
      const v = overlap(r.y0, r.y1, g.y0, g.y1);
      if (v < 0.5 * Math.min(h, r.y1 - r.y0)) continue;
      const clash = r.words.some((w) => overlap(w.box.x0, w.box.x1, g.x0, g.x1) > 0.3 * (g.x1 - g.x0));
      if (clash) continue;
      target = r;
      break;
    }
    if (target) {
      target.words.push(...g.words);
      target.y0 = Math.min(target.y0, g.y0);
      target.y1 = Math.max(target.y1, g.y1);
    } else {
      rows.push({ page: g.page, y0: g.y0, y1: g.y1, words: [...g.words] });
    }
  }

  rows.sort((a, b) => a.page - b.page || (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2);

  const out: SourceLine[] = [];
  for (const row of rows) {
    const words = row.words.filter((w) => w.text.trim()).sort((a, b) => a.box.x0 - b.box.x0);
    const height = row.y1 - row.y0;
    let seg: Fragment[] = [];
    const segments: Fragment[][] = [];
    for (const w of words) {
      const prev = seg[seg.length - 1];
      if (prev) {
        const gap = w.box.x0 - prev.box.x1;
        const leftHasMoney = findAmounts(seg.map((s) => s.text).join(' ')).length > 0;
        if (gap > COLUMN_GAP && !leftHasMoney && !findAmounts(w.text).length && !rowHasMoneyAfter(words, w)) {
          segments.push(seg);
          seg = [];
        }
      }
      seg.push(w);
    }
    if (seg.length) segments.push(seg);

    for (const s of segments) {
      let text = '';
      s.forEach((w, i) => {
        if (i > 0) {
          const gap = w.box.x0 - s[i - 1]!.box.x1;
          // a gap wider than a line height is a column: keep it visible as a double space
          text += gap > height * 1.2 ? '   ' : ' ';
        }
        text += w.text.trim();
      });
      const chars = s.reduce((n, w) => n + w.text.length, 0) || 1;
      const conf = s.reduce((sum, w) => sum + w.conf * w.text.length, 0) / chars;
      out.push({ text, conf, page: row.page, box: union(s.map((w) => w.box)) });
    }
  }
  return out;
}

function rowHasMoneyAfter(words: Fragment[], from: Fragment): boolean {
  const i = words.indexOf(from);
  return findAmounts(words.slice(i).map((w) => w.text).join(' ')).length > 0;
}
