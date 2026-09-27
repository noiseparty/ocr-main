// Finding money in a line of receipt text.
//
// A printed amount always carries exactly two decimals. Requiring them is what keeps
// registration numbers, times, quantities ("0,456 kg") and volumes out of the totals.

export interface Amount {
  value: number;
  start: number;
  end: number;
  raw: string;
}

/**
 * OCR reads a zero as the letter O often enough to matter, but only ever inside a number.
 * Replace O/o only where it sits between digits or next to a decimal separator.
 */
export function repairDigits(line: string): string {
  return line
    .replace(/(?<=\d[.,]?)[oO](?=[\d.,]|\b)/g, '0')
    .replace(/(?<=[\s€$£])[oO](?=[.,]\d\d\b)/g, '0');
}

// thousands: "." "," "'" "’" NBSP and narrow NBSP; a plain space only when asked (see below).
const SEP_STRICT = "[.,'’  ]";
const SEP_LOOSE = "[.,'’   ]";

function amountRe(spaceThousands: boolean): RegExp {
  const sep = spaceThousands ? SEP_LOOSE : SEP_STRICT;
  return new RegExp(
    // not glued to a preceding number, or to a date like 28.09.2026
    `(?<![\\d.,])(-\\s?)?(\\d{1,3}(?:${sep}\\d{3})+|\\d+)[.,](\\d{2})` +
      // not followed by more digits, another ".dd" (a date), a percent or a unit of measure
      `(?![\\d]|[.,]\\d)(?!\\s?%)(?!\\s?(?:ml|cl|l|kg|gr|g)\\b)(-(?!\\d))?`,
    'gi',
  );
}

const RE_STRICT = amountRe(false);
const RE_LOOSE = amountRe(true);

/**
 * All two-decimal amounts in a line, left to right.
 *
 * `spaceThousands` lets "1 234,56" read as one number. It is off by default because on an
 * item line "Coffee 1 250,00" is far more often qty 1 and 250,00 than one thousand; the
 * parser turns it on only for summary lines (total, subtotal, VAT), where no quantity lives.
 */
export function findAmounts(line: string, opts: { spaceThousands?: boolean } = {}): Amount[] {
  const re = opts.spaceThousands ? RE_LOOSE : RE_STRICT;
  re.lastIndex = 0;
  const out: Amount[] = [];
  for (let m = re.exec(line); m; m = re.exec(line)) {
    const int = (m[2] ?? '').replace(/[^\d]/g, '');
    let value = Number(`${int}.${m[3]}`);
    if (m[1] || m[4]) value = -value;
    out.push({ value, start: m.index, end: m.index + m[0].length, raw: m[0] });
  }
  return out;
}

/**
 * Lenient parse of one typed number — used when a person edits a cell, and for quantities.
 * Accepts "12,50", "12.50", "1 234,56", "1.234,56", "1,234.56", "-3", "3,00-", "€ 4.20".
 * Returns null for anything that is not unambiguously a number.
 */
export function parseNumber(input: string): number | null {
  let s = input.trim().replace(/[€$£\s  ]|eur|usd|gbp/gi, '');
  if (!s) return null;
  let neg = false;
  if (s.endsWith('-')) {
    neg = true;
    s = s.slice(0, -1);
  }
  if (s.startsWith('-') || s.startsWith('−')) {
    neg = !neg;
    s = s.slice(1);
  }
  if (!/^[\d.,']+$/.test(s)) return null;
  s = s.replace(/'/g, '');
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  const dec = Math.max(lastDot, lastComma);
  let normalized: string;
  if (dec === -1) {
    normalized = s;
  } else {
    const decimals = s.length - dec - 1;
    const sepChar = s[dec]!;
    const otherSep = sepChar === '.' ? ',' : '.';
    const sameSepCount = s.split(sepChar).length - 1;
    // "1.234" or "1,234" with nothing else: a lone separator followed by exactly three
    // digits is a thousands group, unless it is a leading "0," (a weight, "0,456").
    if (!s.includes(otherSep) && sameSepCount === 1 && decimals === 3 && !/^0[.,]/.test(s)) {
      normalized = s.replace(sepChar, '');
    } else if (sameSepCount > 1) {
      // "1.234.567" — every one of them is a thousands separator
      normalized = s.split(sepChar).join('');
    } else {
      normalized = s.slice(0, dec).replace(/[.,]/g, '') + '.' + s.slice(dec + 1);
    }
  }
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}
