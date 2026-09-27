import { describe, expect, it } from 'vitest';
import { classify, parseItemLine, parseReceipt } from '../src/lib/parse';
import { validate } from '../src/lib/validate';
import { CAFE_RECEIPT, EN_INVOICE, LV_INVOICE, LV_RECEIPT, lines } from './fixtures';

const LC_MID_UI = 0.75; // below this the UI marks a cell "check this"
const simple = (r: ReturnType<typeof parseReceipt>) =>
  r.items.map((it) => [it.description, it.qty, it.unitPrice, it.total]);

describe('parseItemLine', () => {
  it.each([
    ['Rudzu maize 1,89 A', ['Rudzu maize', 1, 1.89, 1.89]],
    ['Maize 2 x 1,50 3,00', ['Maize', 2, 1.5, 3]],
    ['Piens 2 gab x 0,99 1,98', ['Piens', 2, 0.99, 1.98]],
    ['Ābols 3 gab 1,20 3,60', ['Ābols', 3, 1.2, 3.6]],
    ['Banāni 0,845 kg x 1,49 EUR/kg 1,26', ['Banāni', 0.845, 1.49, 1.26]],
    ['Web design   10   45.00   450.00', ['Web design', 10, 45, 450]],
    ['1 Web design 10 45.00 450.00', ['Web design', 10, 45, 450]],
    ['2 Croissant 3,00', ['Croissant', 2, 1.5, 3]],
    ['Maize 1,50 3,00', ['Maize', 2, 1.5, 3]],
    ['Tea 3 @ 2.50 7.50', ['Tea', 3, 2.5, 7.5]],
    ['Copy editing (hours)   3.5   60.00   210.00', ['Copy editing (hours)', 3.5, 60, 210]],
    ['Skrūves 4x50 (200 gab)   3   iep.   7,80   23,40', ['Skrūves 4x50 (200 gab)', 3, 7.8, 23.4]],
    ['Cola 0.50L 1,20', ['Cola 0.50L', 1, 1.2, 1.2]],
    ['Pica Margherita 30 8.55', ['Pica Margherita 30', 1, 8.55, 8.55]],
  ])('%s', (line, [description, qty, unitPrice, total]) => {
    const p = parseItemLine(line)!;
    expect(p).not.toBeNull();
    expect([p.description, p.qty, p.unitPrice, p.total]).toEqual([description, qty, unitPrice, total]);
  });

  it('returns a quantity-only line with an empty description', () => {
    const p = parseItemLine('  2 gab x 0,99   1,98 A')!;
    expect(p.description).toBe('');
    expect(p.qty).toBe(2);
  });

  it('flags a line whose arithmetic does not close', () => {
    expect(parseItemLine('Widget 3 x 2,00 7,00')!.consistent).toBe(false);
  });

  it('ignores lines without money', () => {
    expect(parseItemLine('Piens 2,5% 1L')).toBeNull();
    expect(parseItemLine('Kase 2 Čeks Nr. 004821')).toBeNull();
  });
});

describe('classify', () => {
  it.each([
    ['KOPĀ EUR 12,46', 'total'],
    ['KOPA EUR 12.46', 'total'],
    ['Kopā apmaksai EUR 211,02', 'total'],
    ['Total incl. VAT 24.00', 'total'],
    ['Subtotal 2,530.00', 'subtotal'],
    ['Kopā bez PVN 174,40', 'subtotal'],
    ['VAT 21% 531.30', 'vat'],
    ['incl. VAT 21% 3.75', 'vat'],
    ['t.sk. PVN 21% 2,16', 'vat'],
    ['PVN reģ. Nr. LV40003123456', 'registration'],
    ['VAT No. GB123456789', 'registration'],
    ['Samaksāts: Karte 12,46', 'noise'],
    ['PVN     Bez PVN   PVN   Ar PVN', 'other'],
  ])('%s → %s', (line, kind) => {
    expect(classify(line).kind).toBe(kind);
  });
});

describe('parseReceipt — Latvian shop receipt', () => {
  const r = parseReceipt(lines(LV_RECEIPT));
  it('reads the header', () => {
    expect(r.merchant.value).toBe('SIA "Daugavas Bode"');
    expect(r.date.value).toBe('2026-09-28');
    expect(r.currency.value).toBe('EUR');
  });
  it('reads every item, joining two-line items and signing the discount', () => {
    expect(simple(r)).toEqual([
      ['Rudzu maize "Rīga"', 1, 1.89, 1.89],
      ['Piens 2,5% 1L', 2, 0.99, 1.98],
      ['Banāni', 0.845, 1.49, 1.26],
      ['Kafija malta 250g', 1, 4.59, 4.59],
      ['Siers Holandes', 1, 3.29, 3.29],
      ['Atlaide Kafija', 1, -0.6, -0.6],
      ['Maisiņš', 1, 0.05, 0.05],
    ]);
  });
  it('reads the summary and the unlabelled VAT table row', () => {
    expect(r.total.value).toBe(12.46);
    expect(r.vatRate.value).toBe(21);
    expect(r.vatAmount.value).toBe(2.16);
    expect(r.subtotal.value).toBe(10.3);
  });
  it('passes every cross-check', () => {
    expect(validate(r).filter((c) => c.level === 'warn')).toEqual([]);
  });
  it('is confident where the numbers agree', () => {
    expect(r.total.confidence).toBeGreaterThanOrEqual(0.9);
  });
});

describe('parseReceipt — English invoice', () => {
  const r = parseReceipt(lines(EN_INVOICE));
  it('reads the seller, not the customer', () => {
    expect(r.merchant.value).toBe('Northwind Studio SIA');
  });
  it('takes the issue date over the due date', () => {
    expect(r.date.value).toBe('2026-09-12');
  });
  it('reads the table', () => {
    expect(simple(r)).toEqual([
      ['Brand workshop (half day)', 1, 850, 850],
      ['Landing page design', 1, 1200, 1200],
      ['Illustration set', 6, 45, 270],
      ['Copy editing (hours)', 3.5, 60, 210],
    ]);
  });
  it('reads the summary', () => {
    expect([r.subtotal.value, r.vatRate.value, r.vatAmount.value, r.total.value]).toEqual([2530, 21, 531.3, 3061.3]);
    expect(r.currency.value).toBe('EUR');
  });
  it('knows items add up to the subtotal, with VAT on top', () => {
    const items = validate(r).find((c) => c.id === 'items')!;
    expect(items.level).toBe('ok');
    expect(items.message).toMatch(/subtotal/);
  });
});

describe('parseReceipt — café receipt', () => {
  const r = parseReceipt(lines(CAFE_RECEIPT, 0.9));
  it('reads it', () => {
    expect(r.merchant.value).toBe('KAFEJNICA ZIEDONIS');
    expect(r.date.value).toBe('2026-09-27');
    expect(simple(r)).toEqual([
      ['Flat white', 2, 3.5, 7],
      ['Croissant', 1, 2.8, 2.8],
      ['Cardamom bun', 2, 3.2, 6.4],
      ['Orange juice 0.3L', 1, 3.5, 3.5],
      ['Water still', 1, 1.9, 1.9],
    ]);
    expect([r.total.value, r.vatRate.value, r.vatAmount.value]).toEqual([21.6, 21, 3.75]);
  });
  it('derives the net amount when only VAT-inclusive prices are printed', () => {
    expect(r.subtotal.value).toBe(17.85);
    expect(r.subtotal.confidence).toBeLessThan(LC_MID_UI);
  });
});

describe('parseReceipt — Latvian invoice', () => {
  const r = parseReceipt(lines(LV_INVOICE));
  it('reads it', () => {
    expect(r.merchant.value).toBe('SIA "Kurzemes Koks"');
    expect(r.date.value).toBe('2026-09-03');
    expect(simple(r)).toEqual([
      ['Priedes dēlis 25x100', 40, 3.15, 126],
      ['Skrūves 4x50 (200 gab)', 3, 7.8, 23.4],
      ['Piegāde', 1, 25, 25],
    ]);
    expect([r.subtotal.value, r.vatRate.value, r.vatAmount.value, r.total.value]).toEqual([174.4, 21, 36.62, 211.02]);
    expect(validate(r).filter((c) => c.level === 'warn')).toEqual([]);
  });
});

describe('parseReceipt — degraded OCR', () => {
  it('survives missing diacritics, O-for-zero and dot decimals', () => {
    const noisy = LV_RECEIPT.replace('KOPĀ', 'KOPA').replace('0,99', 'O,99').replace(/,(\d\d)/g, '.$1');
    const r = parseReceipt(lines(noisy, 0.7));
    expect(r.total.value).toBe(12.46);
    expect(r.items).toHaveLength(7);
  });

  it('flags a misread line item against the total', () => {
    const r = parseReceipt(lines(LV_RECEIPT.replace('4,59 A', '4,39 A')));
    const check = validate(r).find((c) => c.id === 'items')!;
    expect(check.level).toBe('warn');
    expect(check.message).toMatch(/0\.20/);
  });

  it('falls back to the largest amount, with low confidence, when nothing is labelled', () => {
    const r = parseReceipt(lines('Corner Shop\nBread 1.20\nMilk 0.99\n5.00'));
    expect(r.total.value).toBe(5);
    expect(r.total.confidence).toBeLessThan(0.5);
  });

  it('returns empty fields rather than guessing on empty input', () => {
    const r = parseReceipt([]);
    expect(r.total.value).toBeNull();
    expect(r.items).toEqual([]);
    expect(validate(r).some((c) => c.level === 'warn')).toBe(true);
  });

  it('carries the OCR confidence into the cells', () => {
    const r = parseReceipt(lines(CAFE_RECEIPT, 0.4));
    expect(r.merchant.confidence).toBeLessThan(0.5);
  });
});
