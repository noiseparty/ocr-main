// Small text helpers shared by the parser modules. Pure, no DOM.

const FOLD: Record<string, string> = {
  ā: 'a', č: 'c', ē: 'e', ģ: 'g', ī: 'i', ķ: 'k', ļ: 'l', ņ: 'n', š: 's', ū: 'u', ž: 'z',
  ō: 'o', ŗ: 'r', ä: 'a', ö: 'o', ü: 'u', õ: 'o', ą: 'a', ę: 'e', ė: 'e', į: 'i', ų: 'u',
  ł: 'l', ó: 'o', ś: 's', ź: 'z', ż: 'z', ć: 'c', ń: 'n', é: 'e', è: 'e', à: 'a', ß: 'ss',
};

/**
 * Lowercase and strip diacritics, so keyword matching survives both Latvian spelling
 * ("kopā") and OCR that dropped the macron ("KOPA").
 */
export function fold(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\u0000-\u007f]/g, (c) => FOLD[c] ?? c.normalize('NFD').replace(/[̀-ͯ]/g, ''));
}

export function letterCount(s: string): number {
  const m = s.match(/\p{L}/gu);
  return m ? m.length : 0;
}

export function collapseSpaces(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function round3(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000;
}

/** Money equality to within a cent, which is all a printed receipt can promise. */
export function sameMoney(a: number, b: number, tol = 0.011): boolean {
  return Math.abs(a - b) <= tol;
}

export function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
