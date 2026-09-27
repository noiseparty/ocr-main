// The receipt parser: lines of text in, structured fields out. Deterministic — no model,
// no network — so the same input always gives the same rows, and every rule is a test.
//
// The shape of a receipt or invoice is nearly universal: a header (who, when), a body of
// item lines that each end in money, then a summary (subtotal, VAT, total) and a footer
// (payment, thanks). The parser finds that summary first, because its labels are the most
// reliable anchors on the page, and reads items only from the body above it.

import { findDates } from './dates';
import { findAmounts, repairDigits } from './money';
import { clamp01, collapseSpaces, fold, letterCount, round2, round3, sameMoney } from './text';
import type { Field, LineItem, Receipt, SourceLine } from './types';

// ---------------------------------------------------------------- vocabulary ----
// All matched against fold()ed text: lowercase, diacritics stripped.

const RE_REGISTRATION =
  /(reg\.?\s*(nr|no|number|kods)|registr|pvn\s*(reg|maks|nr|kods|numurs)|vat\s*(reg|no\b|number|id|nr)|nodokl\w*\s*maks|\blv\s?\d{11}\b|\b\d{11}\b|tax\s*id|\biban\b|\bswift\b|\bbic\b)/;
const RE_SUBTOTAL =
  /(sub\s?-?\s?total|starpsumma|bez\s*pvn|excl\.?(uding)?\s*(vat|pvn|tax)|before\s*(tax|vat)|net\s*(amount|total)|^\s*net\b|\bneto\b|summa\s*bez)/;
const RE_VAT_WORD = /\b(pvn|vat|tax|nodoklis|nodokla|nodoklu)\b/;
const RE_VAT_INCL = /(incl|ar\s*pvn|ieskaitot|with\s*(vat|tax)|including)/;
const RE_TOTAL_STRONG =
  /(kopa\s*apmaksai|summa\s*apmaksai|\bapmaksai\b|\bsamaksai\b|amount\s*due|balance\s*due|grand\s*total|total\s*due|total\s*to\s*pay|\bto\s*pay\b|kopa\s*ar\s*pvn|summa\s*ar\s*pvn|total\s*incl)/;
const RE_TOTAL = /\b(kopa|total|kopsumma|summa|pavisam|kopeja)\b/;
const RE_NOISE =
  /\b(karte|kartes|card|visa|mastercard|maestro|debit|credit|cash|skaidra|skaidri|skaidra nauda|izdots|atlikums|change|tender|paid|samaksats|apmaksats|terminal|termin\w*|auth\w*|approval|trans\w*|kvits|ceks|kase|kasieris|cashier|operator|tel|phone|www|http|paldies|thank|bank\w*|konts|account|order|pasut\w*|due\s*date|apmaksas|payment|klients|customer|lojal\w*|bonus\w*|punkti|points|saglabajiet|pirkuma|purchase)\b/;
const RE_DISCOUNT = /\b(atlaide|discount|rabate|akcija|nolaide|coupon|kupons|promo)\b/;
const RE_ADDRESS =
  /\b(iela|gatve|bulvaris|prospekts|laukums|street|st\.|road|rd\.|avenue|ave\.?|lane|lv-\d{4}|lv\s?\d{4}|riga|latvia|latvija|novads|pagasts)\b/;
const RE_DOC_WORD =
  /^(invoice|tax invoice|receipt|rekins|kvits|ceks|pavadzime|faktura|bill|sales receipt|cash receipt|nr\.?|no\.?)\b/;
const RE_COMPANY = /(\bsia\b|\bas\b|\bik\b|\bltd\b|\bllc\b|\bgmbh\b|\binc\b|\boü\b|\bou\b|\buab\b|\boy\b|\bab\b|\bplc\b|\bco\.)/;
const RE_BUYER = /\b(bill\s*to|billed\s*to|customer|client|pircejs|sanemejs|maksatajs|ship\s*to|to:)\b/;
const RE_SELLER = /\b(from|seller|supplier|pardevejs|piegadatajs|izsniedzejs)\b\s*:?\s*/;
const RE_DATE_LABEL = /\b(date|datums|dated|issued|izrakstits|izrakstisanas|laiks|time)\b/;
const RE_DATE_BAD = /\b(due|termins|lidz|apmaksat lidz|valid|deriga|expires|period|delivery|piegades)\b/;

type Kind = 'total' | 'subtotal' | 'vat' | 'registration' | 'noise' | 'other';

interface Classified {
  kind: Kind;
  /** Only for totals: 3 = "amount due"-grade wording, 2 = "total", 1 = bare "summa". */
  priority: number;
}

export function classify(text: string): Classified {
  const f = fold(text);
  if (RE_REGISTRATION.test(f)) return { kind: 'registration', priority: 0 };
  // The header row of a VAT table ("PVN  Bez PVN  PVN  Ar PVN") names every column and
  // holds no figures; read as a label it would steal the first row's number.
  if ((f.match(/\b(pvn|vat)\b/g) ?? []).length >= 2 && !/\d/.test(f)) return { kind: 'other', priority: 0 };
  if (RE_SUBTOTAL.test(f)) return { kind: 'subtotal', priority: 0 };
  if (RE_VAT_WORD.test(f)) {
    // "Total incl. VAT" is a total; "incl. VAT 21%  3,75" and "t.sk. PVN" are the VAT.
    const isTotal = RE_VAT_INCL.test(f) && (RE_TOTAL_STRONG.test(f) || RE_TOTAL.test(f));
    if (!isTotal) return { kind: 'vat', priority: 0 };
  }
  if (RE_TOTAL_STRONG.test(f)) return { kind: 'total', priority: 3 };
  if (RE_TOTAL.test(f)) {
    const word = f.match(RE_TOTAL)?.[1];
    return { kind: 'total', priority: word === 'summa' || word === 'kopsumma' ? 1 : 2 };
  }
  if (RE_NOISE.test(f)) return { kind: 'noise', priority: 0 };
  return { kind: 'other', priority: 0 };
}

// ---------------------------------------------------------------- item lines ----

/** "2 x 1,50", "2 gab x 1,50", "0,456 kg x 3,99 EUR/kg", "3 @ 4.00" */
const RE_QTY_X =
  /(?<![\d.,])(\d{1,4}(?:[.,]\d{1,3})?)\s*(?:gab\.?|gb\.?|pcs\.?|pc\.?|vnt\.?|vien\.?|kg|gr?|l)?\s*[x×х*@]\s*(?:eur\s*|€\s*)?(\d{1,6}[.,]\d{2,3})(?![\d])(?!\s?(?:l|ml|kg|g)\b)(?:\s*(?:eur|€)?\s*\/\s*(?:kg|gab|l|pc|gb)\.?)?/i;
/** "2 gab 1,50" — a counted unit with no multiplication sign */
const RE_QTY_UNIT = /(?<![\d.,])(\d{1,4}(?:[.,]\d{1,3})?)\s*(?:gab|gb|pcs|pc|vnt|vien)\.?(?=\s|$)/i;

export interface ParsedItemLine {
  description: string;
  qty: number | null;
  unitPrice: number | null;
  total: number | null;
  explicit: { qty: boolean; unitPrice: boolean; total: boolean };
  /** qty*unit = total, as printed */
  consistent: boolean;
}

const qtyNum = (s: string): number => Number(s.replace(',', '.'));

function cleanDescription(s: string): string {
  return collapseSpaces(s)
    .replace(/^[\s\-–—*•#.:]+/, '')
    .replace(/[\s\-–—*•:.,x×@]+$/i, '')
    .replace(/\s+(eur|€)$/i, '')
    .trim();
}

type Num = { value: number; money: boolean; int: boolean; raw: string };

function numToken(tok: string): Num | null {
  const t = tok.replace(/^[€$£]|[€$£]$/g, '');
  const money = /^-?\d{1,3}(?:[.,']\d{3})*[.,]\d{2}-?$|^-?\d+[.,]\d{2}-?$/.test(t);
  const int = /^\d{1,5}$/.test(t);
  const qtyish = /^\d{1,4}[.,]\d{1,3}$/.test(t);
  if (!money && !int && !qtyish) return null;
  let value: number;
  if (money) {
    const a = findAmounts(t)[0];
    if (!a) return null;
    value = a.value;
  } else {
    value = qtyNum(t);
  }
  return { value, money, int, raw: tok };
}

function viaMultiplication(text: string): ParsedItemLine | null {
  // "Maize 2 x 1,50 3,00", "0,456 kg x 3,99 EUR/kg 1,82"
  const mx = RE_QTY_X.exec(text);
  if (!mx) return null;
  const qty = qtyNum(mx[1]!);
  const unitPrice = qtyNum(mx[2]!);
  const amts = findAmounts(text.slice(mx.index + mx[0].length));
  const printedTotal = amts.length ? amts[amts.length - 1]!.value : null;
  const total = printedTotal ?? round2(qty * unitPrice);
  return {
    description: cleanDescription(text.slice(0, mx.index)),
    qty,
    unitPrice,
    total,
    explicit: { qty: true, unitPrice: true, total: printedTotal !== null },
    consistent: sameMoney(round2(qty * unitPrice), total, 0.011),
  };
}

function viaCountedUnit(text: string): ParsedItemLine | null {
  // "Ābols 3 gab 1,20 3,60" — a counted unit with no multiplication sign
  const mu = RE_QTY_UNIT.exec(text);
  if (!mu) return null;
  const qty = qtyNum(mu[1]!);
  const amts = findAmounts(text.slice(mu.index + mu[0].length));
  const description = cleanDescription(text.slice(0, mu.index));
  if (amts.length >= 2) {
    const unitPrice = amts[0]!.value;
    const total = amts[amts.length - 1]!.value;
    return {
      description,
      qty,
      unitPrice,
      total,
      explicit: { qty: true, unitPrice: true, total: true },
      consistent: sameMoney(round2(qty * unitPrice), total, 0.011),
    };
  }
  if (amts.length === 1 && qty > 0) {
    const total = amts[0]!.value;
    const unit = round2(total / qty);
    const exact = sameMoney(unit * qty, total);
    return {
      description,
      qty,
      unitPrice: exact ? unit : null,
      total,
      explicit: { qty: true, unitPrice: false, total: true },
      consistent: exact,
    };
  }
  return null;
}

/** Units of measure that sit between a quantity and a price column. */
const RE_UOM = /^(eur|€|x|×|gab\.?|gb\.?|iep\.?|pcs\.?|pc\.?|kg|m|m2|m3|l|h|st\.?|stk\.?|vnt\.?|kompl\.?|pac\.?|hrs?|hours?|mērv\.?)$/i;

function viaColumns(text: string): ParsedItemLine | null {
  // "Web design   10   45.00   450.00" — numbers read right to left off the end
  const tokens = text.trim().split(/\s+/);
  // a VAT class letter or a star after the price ("3,00 A") is not part of the description
  while (tokens.length && /^([A-D]|\*|[A-D]\*|eur|€)$/i.test(tokens[tokens.length - 1]!)) tokens.pop();
  const nums: Num[] = [];
  while (tokens.length) {
    const last = tokens[tokens.length - 1]!;
    if (nums.length && RE_UOM.test(last)) {
      tokens.pop();
      continue;
    }
    const n = numToken(last);
    if (!n) break;
    nums.unshift(n);
    tokens.pop();
    if (nums.length === 4) break;
  }
  const lastNum = nums[nums.length - 1];
  if (!lastNum || !lastNum.money) return null;

  let description = tokens.join(' ');
  let qty: number | null = 1;
  let unitPrice: number | null = lastNum.value;
  const total = lastNum.value;
  const explicit = { qty: false, unitPrice: false, total: true };
  let consistent = true;

  const tail = nums.slice(-3);
  if (nums.length > tail.length) description = `${description} ${nums[0]!.raw}`.trim();
  if (tail.length === 3) {
    const [a, b, c] = tail as [Num, Num, Num];
    // qty, unit, total — or unit, qty, total; the integer is the quantity
    const qFirst = a.int || !b.int;
    qty = qFirst ? a.value : b.value;
    unitPrice = qFirst ? b.value : a.value;
    explicit.qty = explicit.unitPrice = true;
    consistent = sameMoney(round2(a.value * b.value), c.value);
  } else if (tail.length === 2) {
    const [a, b] = tail as [Num, Num];
    const unit = a.value > 0 ? round2(b.value / a.value) : NaN;
    if (a.int && a.value >= 1 && a.value <= 99 && sameMoney(unit * a.value, b.value)) {
      qty = a.value;
      unitPrice = unit;
      explicit.qty = true;
    } else if (a.money && a.value > 0) {
      const r = b.value / a.value;
      const whole = Math.round(r);
      unitPrice = a.value;
      explicit.unitPrice = true;
      if (whole >= 1 && Math.abs(r - whole) < 0.01) {
        qty = whole;
      } else {
        qty = round3(r);
        consistent = sameMoney(round2(qty * a.value), b.value);
      }
    } else {
      description = `${description} ${a.raw}`.trim();
    }
  }

  // A leading small integer with a single price is a quantity ("2 Croissant 3,00");
  // with more columns it is a row number ("1 Web design 10 45.00 450.00").
  const lead = /^(\d{1,2})[.)]?\s+(?=\p{L})/u.exec(description);
  if (lead) {
    if (tail.length === 1) {
      const q = Number(lead[1]);
      const unit = q > 0 ? round2(total / q) : NaN;
      if (q > 0 && sameMoney(unit * q, total)) {
        qty = q;
        unitPrice = unit;
        explicit.qty = true;
      }
    }
    description = description.slice(lead[0].length);
  }

  return { description: cleanDescription(description), qty, unitPrice, total, explicit, consistent };
}

/**
 * Parse one line of the item body. Returns null when the line holds no money at its end.
 * A line that is only a quantity ("2 x 1,29   2,58") comes back with an empty description,
 * and the caller glues it to the description line above it.
 *
 * Three readers each take a view of the line; the first whose arithmetic closes
 * (qty × unit = total, all three printed) wins. "Skrūves 4x50 (200 gab) 3 iep. 7,80 23,40"
 * is why: the counted-unit reader sees 200 pieces, the column reader sees 3 packs, and
 * only one of those multiplies out.
 */
export function parseItemLine(raw: string): ParsedItemLine | null {
  const text = repairDigits(raw);
  const views = [viaMultiplication(text), viaColumns(text), viaCountedUnit(text)].filter(
    (v): v is ParsedItemLine => v !== null,
  );
  return (
    views.find((v) => v.consistent && v.explicit.qty && v.explicit.unitPrice && v.explicit.total) ??
    views.find((v) => v.consistent) ??
    views[0] ??
    null
  );
}

// ---------------------------------------------------------------- the parser ----

interface Candidate<T> {
  value: T;
  confidence: number;
  line: number;
}

const field = <T>(c: Candidate<T> | null | undefined): Field<T> =>
  c
    ? { value: c.value, confidence: clamp01(c.confidence), line: c.line >= 0 ? c.line : undefined }
    : { value: null, confidence: 0 };

function lastAmount(text: string): number | null {
  const a = findAmounts(repairDigits(text), { spaceThousands: true });
  return a.length ? a[a.length - 1]!.value : null;
}

/** Amounts on a line other than percentages, with space-grouped thousands allowed. */
function summaryAmounts(text: string): number[] {
  return findAmounts(repairDigits(text), { spaceThousands: true }).map((a) => a.value);
}

function percentOf(text: string): number | null {
  const m = /(\d{1,2}(?:[.,]\d{1,2})?)\s*%/.exec(text);
  if (!m) return null;
  const r = qtyNum(m[1]!);
  return r > 0 && r < 100 ? r : null;
}

/** On a VAT line with several amounts, the VAT is the one that is rate% of another. */
function pickVat(amounts: number[], rate: number | null): { vat: number; net?: number; gross?: number } | null {
  if (!amounts.length) return null;
  if (amounts.length === 1) return { vat: amounts[0]! };
  if (rate !== null) {
    for (const v of amounts) {
      for (const base of amounts) {
        if (base === v) continue;
        if (sameMoney(round2((base * rate) / 100), v, 0.02)) {
          const gross = amounts.find((g) => sameMoney(g, base + v, 0.02));
          return { vat: v, net: base, gross };
        }
        if (sameMoney(round2((base * rate) / (100 + rate)), v, 0.02)) {
          return { vat: v, gross: base, net: amounts.find((n) => sameMoney(n + v, base, 0.02)) };
        }
      }
    }
  }
  return { vat: Math.min(...amounts.filter((a) => a > 0)) };
}

export function parseReceipt(lines: SourceLine[]): Receipt {
  const L = lines.map((l) => ({ ...l, text: collapseSpaces(l.text.replace(/\t/g, '  ')) }));
  const cls = L.map((l) => classify(l.text));
  const conf = (i: number) => L[i]?.conf ?? 1;

  // ---- body: item lines above the first summary line that follows an item
  const items: LineItem[] = [];
  let bodyEnd = L.length;
  let pendingDesc: { text: string; line: number } | null = null;
  for (let i = 0; i < L.length; i++) {
    const { text } = L[i]!;
    const c = cls[i]!;
    const isSummary = c.kind === 'total' || c.kind === 'subtotal' || c.kind === 'vat';
    if (isSummary) {
      if (items.length) {
        bodyEnd = i;
        break;
      }
      pendingDesc = null;
      continue;
    }
    if (c.kind === 'registration' || c.kind === 'noise') {
      pendingDesc = null;
      continue;
    }
    if (findDates(text).length && !findAmounts(text).length) continue;
    const p = parseItemLine(text);
    if (!p) {
      pendingDesc = letterCount(text) >= 3 ? { text, line: i } : null;
      continue;
    }
    let description = p.description;
    let line = i;
    let descConf = conf(i);
    if (letterCount(description) < 2) {
      if (!pendingDesc) continue; // a stray number with no name — not an item
      description = cleanDescription(pendingDesc.text);
      line = pendingDesc.line;
      descConf = Math.min(conf(pendingDesc.line), conf(i));
    }
    pendingDesc = null;
    let total = p.total;
    if (total !== null && total > 0 && RE_DISCOUNT.test(fold(description))) total = -total;

    const ocr = conf(i);
    const arith = p.consistent ? 1 : 0.45;
    items.push({
      description,
      qty: p.qty,
      unitPrice: total !== null && total < 0 && p.unitPrice !== null ? -Math.abs(p.unitPrice) : p.unitPrice,
      total,
      conf: {
        description: clamp01(descConf * (letterCount(description) >= 3 ? 1 : 0.6)),
        qty: clamp01((p.explicit.qty ? ocr : 0.8) * arith),
        unitPrice: clamp01((p.explicit.unitPrice ? ocr : p.unitPrice === null ? 0.3 : 0.75) * arith),
        total: clamp01(p.explicit.total ? ocr : 0.5),
      },
      line,
    });
  }

  // ---- summary
  const totals: Candidate<number>[] = [];
  const subtotals: Candidate<number>[] = [];
  const vats: Array<{ rate: number | null; amount: number; net?: number; gross?: number; line: number; labelled: boolean }> = [];

  const valueFor = (i: number): { v: number; line: number } | null => {
    const own = lastAmount(L[i]!.text);
    if (own !== null) return { v: own, line: i };
    // label on one line, figure on the next: only if the next line is (nearly) just a number
    const next = L[i + 1];
    if (next && letterCount(next.text) <= 3) {
      const v = lastAmount(next.text);
      if (v !== null) return { v, line: i + 1 };
    }
    return null;
  };

  for (let i = 0; i < L.length; i++) {
    const c = cls[i]!;
    const text = L[i]!.text;
    if (c.kind === 'total') {
      const r = valueFor(i);
      if (r) totals.push({ value: r.v, confidence: [0, 0.7, 0.85, 0.95][c.priority]! * conf(r.line), line: r.line });
    } else if (c.kind === 'subtotal') {
      const r = valueFor(i);
      if (r) subtotals.push({ value: r.v, confidence: 0.85 * conf(r.line), line: r.line });
    } else if (c.kind === 'vat') {
      const rate = percentOf(text);
      let amounts = summaryAmounts(text);
      let line = i;
      if (!amounts.length) {
        const next = L[i + 1];
        if (next && letterCount(next.text) <= 3) {
          amounts = summaryAmounts(next.text);
          line = i + 1;
        }
      }
      const picked = pickVat(amounts, rate);
      if (picked) vats.push({ rate, amount: picked.vat, net: picked.net, gross: picked.gross, line, labelled: true });
      else if (rate !== null) vats.push({ rate, amount: NaN, line, labelled: true });
    } else if (i >= bodyEnd && c.kind === 'other') {
      // An unlabelled row of a VAT table: "A 21,00%  12,29  2,58  14,87"
      const rate = percentOf(text);
      const amounts = summaryAmounts(text);
      if (rate !== null && amounts.length >= 2) {
        const picked = pickVat(amounts, rate);
        if (picked && picked.net !== undefined) {
          vats.push({ rate, amount: picked.vat, net: picked.net, gross: picked.gross, line: i, labelled: false });
        }
      }
    }
  }

  // Fill a rate-only VAT line ("PVN 21%") from a sibling that has the amount.
  const rated = vats.find((v) => v.rate !== null && !Number.isNaN(v.amount));
  const rateOnly = vats.find((v) => v.rate !== null && Number.isNaN(v.amount));
  const unrated = vats.find((v) => v.rate === null && !Number.isNaN(v.amount));
  if (rateOnly && !rated && unrated) unrated.rate = rateOnly.rate;

  // Distinct VAT amounts by rate; a receipt often states the same VAT twice (a summary
  // line and a table row), so identical (rate, amount) pairs count once.
  const vatByKey = new Map<string, (typeof vats)[number]>();
  for (const v of vats) {
    if (Number.isNaN(v.amount)) continue;
    const key = `${v.rate ?? '?'}|${v.amount.toFixed(2)}`;
    const prev = vatByKey.get(key);
    if (!prev || (!prev.labelled && v.labelled) || (prev.net === undefined && v.net !== undefined)) vatByKey.set(key, v);
  }
  let vatList = [...vatByKey.values()];
  // An unrated "Total VAT" line next to rated rows restates their sum: keep the rows.
  if (vatList.some((v) => v.rate !== null)) {
    const rows = vatList.filter((v) => v.rate !== null);
    const rowSum = round2(rows.reduce((s, v) => s + v.amount, 0));
    vatList = vatList.filter((v) => v.rate !== null || !sameMoney(v.amount, rowSum, 0.02));
  }
  const rates = [...new Set(vatList.map((v) => v.rate).filter((r): r is number => r !== null))];

  let vatAmount: Field<number> = { value: null, confidence: 0 };
  let vatRate: Field<number> = { value: null, confidence: 0 };
  if (vatList.length) {
    const sum = round2(vatList.reduce((s, v) => s + v.amount, 0));
    const first = vatList[0]!;
    const minConf = Math.min(...vatList.map((v) => conf(v.line)));
    const corroborated = vatList.every((v) => v.net !== undefined);
    vatAmount = { value: sum, confidence: clamp01((corroborated ? 0.95 : 0.8) * minConf), line: first.line };
  }
  const rateSource = vats.find((v) => v.rate !== null);
  if (rates.length === 1 && rateSource) {
    vatRate = { value: rates[0]!, confidence: clamp01(0.9 * conf(rateSource.line)), line: rateSource.line };
  } else if (rates.length > 1 && rateSource) {
    // Mixed rates: there is no single rate to report. Leave it empty and say so in checks.
    vatRate = { value: null, confidence: 0.4, line: rateSource.line };
  }

  // Subtotal fallback: the net column of a VAT table.
  if (!subtotals.length && vatList.length && vatList.every((v) => v.net !== undefined)) {
    subtotals.push({
      value: round2(vatList.reduce((s, v) => s + (v.net ?? 0), 0)),
      confidence: 0.7 * conf(vatList[0]!.line),
      line: vatList[0]!.line,
    });
  }

  // ---- total: highest-priority label, then the larger figure
  totals.sort((a, b) => b.confidence - a.confidence || b.value - a.value);
  let total = totals[0] ?? null;
  const itemsSum = round2(items.reduce((s, it) => s + (it.total ?? 0), 0));
  if (totals.length > 1) {
    // Prefer a labelled total the rest of the receipt agrees with.
    const agreeing = totals.find(
      (t) =>
        sameMoney(t.value, itemsSum, 0.02) ||
        (vatAmount.value !== null && subtotals[0] && sameMoney(t.value, subtotals[0].value + vatAmount.value, 0.02)),
    );
    if (agreeing && agreeing.confidence >= (total?.confidence ?? 0) - 0.15) total = agreeing;
  }
  if (!total) {
    const gross = vatList.find((v) => v.gross !== undefined)?.gross;
    if (gross !== undefined) {
      total = { value: gross, confidence: 0.6, line: vatList[0]!.line };
    } else {
      // Last resort: the largest amount anywhere. Usually right, never certain.
      let best: Candidate<number> | null = null;
      for (let i = 0; i < L.length; i++) {
        if (cls[i]!.kind === 'noise' || cls[i]!.kind === 'registration') continue;
        for (const v of summaryAmounts(L[i]!.text)) {
          if (!best || v > best.value) best = { value: v, confidence: 0.35 * conf(i), line: i };
        }
      }
      total = best;
    }
  }

  let subtotal = subtotals.sort((a, b) => b.confidence - a.confidence)[0] ?? null;
  let subtotalDerived = false;
  // Net from total - VAT when the receipt does not print it — marked as derived.
  if (!subtotal && total && vatAmount.value !== null && vatAmount.value < total.value) {
    subtotal = { value: round2(total.value - vatAmount.value), confidence: 0.5, line: total.line };
    subtotalDerived = true;
  }

  // ---- agreement between independent readings is the strongest evidence there is
  if (total && items.length) {
    const matchesTotal = sameMoney(itemsSum, total.value, 0.02);
    const matchesSub = subtotal ? sameMoney(itemsSum, subtotal.value, 0.02) : false;
    if (matchesTotal || matchesSub) {
      for (const it of items) {
        it.conf.total = Math.max(it.conf.total, 0.9);
        if (it.qty !== null && it.unitPrice !== null && it.total !== null && sameMoney(it.qty * it.unitPrice, it.total, 0.011)) {
          it.conf.qty = Math.max(it.conf.qty, 0.85);
          it.conf.unitPrice = Math.max(it.conf.unitPrice, 0.85);
        }
      }
      if (matchesTotal) total = { ...total, confidence: Math.max(total.confidence, 0.95) };
      if (matchesSub && subtotal) subtotal = { ...subtotal, confidence: Math.max(subtotal.confidence, 0.95) };
    }
  }
  if (total && subtotal && !subtotalDerived && vatAmount.value !== null && sameMoney(subtotal.value + vatAmount.value, total.value, 0.02)) {
    total = { ...total, confidence: Math.max(total.confidence, 0.95) };
    subtotal = { ...subtotal, confidence: Math.max(subtotal.confidence, 0.9) };
    vatAmount = { ...vatAmount, confidence: Math.max(vatAmount.confidence, 0.9) };
  }
  // VAT that is exactly its stated rate of the net is corroborated by arithmetic. A net we
  // derived ourselves stays marked "check this": it was never printed.
  if (vatRate.value !== null && vatAmount.value !== null && total) {
    const base = subtotal ? subtotal.value : total.value - vatAmount.value;
    if (base > 0 && Math.abs(round2((base * vatRate.value) / 100) - vatAmount.value) <= Math.max(0.03, base * 0.0005)) {
      vatAmount = { ...vatAmount, confidence: Math.max(vatAmount.confidence, 0.9) };
      vatRate = { ...vatRate, confidence: Math.max(vatRate.confidence, 0.9) };
      if (subtotal && subtotalDerived) subtotal = { ...subtotal, confidence: 0.7 };
    }
  }

  return {
    merchant: field(findMerchant(L, cls)),
    date: field(findDate(L)),
    currency: field(findCurrency(L)),
    subtotal: field(subtotal),
    vatRate,
    vatAmount,
    total: field(total),
    items,
  };
}

// ---------------------------------------------------------------- header fields ----

function findMerchant(L: SourceLine[], cls: Classified[]): Candidate<string> | null {
  let best: Candidate<string> | null = null;
  let buyerUntil = -1;
  const limit = Math.min(L.length, 12);
  for (let i = 0; i < limit; i++) {
    const raw = L[i]!.text;
    const f = fold(raw);
    if (RE_BUYER.test(f)) {
      buyerUntil = i + 3;
      continue;
    }
    if (i <= buyerUntil) continue;
    let text = raw;
    let score = 0.55;
    const seller = RE_SELLER.exec(f);
    if (seller && seller.index === 0) {
      text = raw.slice(seller[0].length).trim();
      score += 0.3;
      if (letterCount(text) < 3) {
        // "Seller:" alone; the name is on the next line
        const next = L[i + 1];
        if (next) {
          text = next.text;
          i++;
        }
      }
    }
    const ff = fold(text);
    if (letterCount(text) < 3) continue;
    if (findAmounts(text).length || findDates(text).length) continue;
    if (cls[i]!.kind === 'registration' || cls[i]!.kind === 'noise') continue;
    if (RE_ADDRESS.test(ff) || RE_DOC_WORD.test(ff.trim()) || /@|https?:|www\./.test(ff)) continue;
    const letters = letterCount(text);
    const digits = (text.match(/\d/g) ?? []).length;
    if (digits > letters) continue;
    if (RE_COMPANY.test(ff)) score += 0.3;
    if (text === text.toUpperCase()) score += 0.05;
    score -= i * 0.04;
    if (i === 0) score += 0.15; // the name heads the page more often than not
    const candidate = { value: collapseSpaces(text), confidence: score * (L[i]!.conf ?? 1), line: i };
    if (!best || candidate.confidence > best.confidence) best = candidate;
  }
  if (best) best.confidence = Math.min(best.confidence, 0.95);
  return best;
}

function findDate(L: SourceLine[]): Candidate<string> | null {
  let best: Candidate<string> | null = null;
  for (let i = 0; i < L.length; i++) {
    const f = fold(L[i]!.text);
    for (const hit of findDates(L[i]!.text)) {
      let score = hit.certainty;
      if (RE_DATE_LABEL.test(f)) score += 0.04;
      if (RE_DATE_BAD.test(f)) score -= 0.35;
      score -= i * 0.002; // the issue date sits near the top
      const cand = { value: hit.iso, confidence: Math.min(0.97, score) * (L[i]!.conf ?? 1), line: i };
      if (!best || cand.confidence > best.confidence) best = cand;
    }
  }
  return best;
}

const CURRENCIES: Array<[string, RegExp]> = [
  ['EUR', /€|\beur\b|\beuro?s?\b/g],
  ['USD', /\$|\busd\b/g],
  ['GBP', /£|\bgbp\b/g],
  ['SEK', /\bsek\b/g],
  ['NOK', /\bnok\b/g],
  ['DKK', /\bdkk\b/g],
  ['PLN', /\bpln\b|\bzl\b/g],
  ['CHF', /\bchf\b/g],
];

function findCurrency(L: SourceLine[]): Candidate<string> | null {
  const counts = new Map<string, { n: number; line: number }>();
  L.forEach((l, i) => {
    const f = fold(l.text);
    for (const [code, re] of CURRENCIES) {
      const n = (f.match(re) ?? []).length;
      if (n) {
        const prev = counts.get(code);
        counts.set(code, { n: (prev?.n ?? 0) + n, line: prev?.line ?? i });
      }
    }
  });
  const ranked = [...counts.entries()].sort((a, b) => b[1].n - a[1].n);
  const top = ranked[0];
  if (top) {
    const second = ranked[1]?.[1].n ?? 0;
    const margin = top[1].n - second;
    return { value: top[0], confidence: Math.min(0.97, 0.78 + 0.08 * margin), line: top[1].line };
  }
  // No symbol anywhere: Latvian vocabulary still pins it to the euro, softly.
  const all = fold(L.map((l) => l.text).join(' '));
  if (/\b(pvn|kopa|gab|riga|sia)\b/.test(all)) return { value: 'EUR', confidence: 0.45, line: -1 };
  return null;
}
