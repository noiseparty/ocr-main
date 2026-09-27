// Dates as receipts print them. EU-first: 03/04/2026 is the 3rd of April unless the
// numbers make that impossible, because this is a Riga demo and most of its input is.

import { fold } from './text';

export interface DateHit {
  iso: string;
  start: number;
  end: number;
  /** 0..1 — how sure the format itself is, before any label context. */
  certainty: number;
}

// Matched against folded text, so Latvian months arrive without their diacritics. Prefix
// matching handles the inflections: marts / martā / marta, septembris / septembrī.
const MONTHS: Array<[RegExp, number]> = [
  [/^(jan|janv)/, 1],
  [/^(feb|febr)/, 2],
  [/^(mar|mart)/, 3],
  [/^apr/, 4],
  [/^(may|maij)/, 5],
  [/^(jun)/, 6],
  [/^(jul)/, 7],
  [/^aug/, 8],
  [/^sep/, 9],
  [/^(oct|okt)/, 10],
  [/^nov/, 11],
  [/^dec/, 12],
];

function monthFromWord(w: string): number | null {
  const f = fold(w);
  if (f.length < 3) return null;
  for (const [re, n] of MONTHS) if (re.test(f)) return n;
  return null;
}

function expandYear(y: number): number {
  if (y >= 100) return y;
  return y + 2000; // receipts are recent; a two-digit year is 20xx
}

export function isoDate(y: number, m: number, d: number): string | null {
  if (y < 1990 || y > 2099 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const MONTH_WORD = '([A-Za-zĀ-žāčēģīķļņšūž]{3,12})\\.?';

const PATTERNS: Array<{ re: RegExp; build: (m: RegExpExecArray) => { iso: string | null; certainty: number } }> = [
  // 2026-09-28, 2026.09.28, 2026/09/28
  {
    re: /(?<!\d)(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?!\d)/g,
    build: (m) => ({ iso: isoDate(+m[1]!, +m[2]!, +m[3]!), certainty: 0.95 }),
  },
  // 28.09.2026, 28-09-2026, 28/09/2026, 28.09.26 — and US 09/28/2026 when forced
  {
    re: /(?<![\d.,])(\d{1,2})([-./])(\d{1,2})\2(\d{4}|\d{2})(?![\d]|[.,]\d)/g,
    build: (m) => {
      const a = +m[1]!;
      const b = +m[3]!;
      const y = expandYear(+m[4]!);
      const sep = m[2];
      const shortYear = m[4]!.length === 2 ? 0.1 : 0;
      if (a > 12 || sep !== '/') {
        // day first: unambiguous, or dotted/dashed (which is European by convention)
        return { iso: isoDate(y, b, a), certainty: (sep === '.' ? 0.95 : 0.85) - shortYear };
      }
      if (b > 12) return { iso: isoDate(y, a, b), certainty: 0.85 - shortYear }; // must be US
      return { iso: isoDate(y, b, a), certainty: 0.65 - shortYear }; // ambiguous: EU-first
    },
  },
  // Latvian formal: "2026. gada 3. septembris"
  {
    re: new RegExp(`(\\d{4})\\.?\\s*g(?:ada|\\.)?\\s+(\\d{1,2})\\.?\\s*${MONTH_WORD}`, 'gi'),
    build: (m) => {
      const mo = monthFromWord(m[3]!);
      return { iso: mo ? isoDate(+m[1]!, mo, +m[2]!) : null, certainty: 0.95 };
    },
  },
  // 12 Sep 2026, 12. septembris 2026, 12 September, 2026
  {
    re: new RegExp(`(?<!\\d)(\\d{1,2})\\.?\\s+${MONTH_WORD},?\\s+(\\d{4})(?!\\d)`, 'gi'),
    build: (m) => {
      const mo = monthFromWord(m[2]!);
      return { iso: mo ? isoDate(+m[3]!, mo, +m[1]!) : null, certainty: 0.9 };
    },
  },
  // Sep 12, 2026 / September 12 2026
  {
    re: new RegExp(`${MONTH_WORD}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})(?!\\d)`, 'gi'),
    build: (m) => {
      const mo = monthFromWord(m[1]!);
      return { iso: mo ? isoDate(+m[3]!, mo, +m[2]!) : null, certainty: 0.9 };
    },
  },
];

/** Every date in a line, in order of position. Overlapping matches keep the surest. */
export function findDates(line: string): DateHit[] {
  const hits: DateHit[] = [];
  for (const p of PATTERNS) {
    p.re.lastIndex = 0;
    for (let m = p.re.exec(line); m; m = p.re.exec(line)) {
      const { iso, certainty } = p.build(m);
      if (iso) hits.push({ iso, start: m.index, end: m.index + m[0].length, certainty });
    }
  }
  hits.sort((a, b) => a.start - b.start || b.certainty - a.certainty);
  const out: DateHit[] = [];
  for (const h of hits) {
    const prev = out[out.length - 1];
    if (prev && h.start < prev.end) {
      if (h.certainty > prev.certainty) out[out.length - 1] = h;
      continue;
    }
    out.push(h);
  }
  return out;
}

/** Parse a whole cell a person typed into. */
export function parseDate(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  const hit = findDates(s)[0];
  return hit ? hit.iso : null;
}
