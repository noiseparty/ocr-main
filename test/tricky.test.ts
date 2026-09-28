// Receipts written to break the parser: dotted-thousands comma decimals, discounts in all
// three spellings (leading minus, trailing minus, a discount line that mentions a loyalty
// card), and a two-rate VAT table. Each one was checked by hand to add up.

import { describe, expect, it } from 'vitest';
import { parseReceipt } from '../src/lib/parse';
import { validate } from '../src/lib/validate';
import { lines } from './fixtures';

const simple = (r: ReturnType<typeof parseReceipt>) =>
  r.items.map((it) => [it.description, it.qty, it.unitPrice, it.total]);
const warnings = (r: ReturnType<typeof parseReceipt>) => validate(r).filter((c) => c.level === 'warn');

// 1 049,00 + 29,90 + 19,50 = 1 098,40; 21% = 230,66; 1 329,06
export const COMMA_INVOICE = `
SIA "Rīgas Tehnika"
Reģ. Nr. 40003111222
Rēķins Nr. RT-118
Datums: 05.08.2026
Nosaukums   Daudz.   Cena   Summa
Klēpjdators Lenovo   1   1.049,00   1.049,00
Pele bezvadu   2   14,95   29,90
USB-C kabelis 2 m   3 gab x 6,50   19,50
Kopā bez PVN   1.098,40
PVN 21%   230,66
Kopā apmaksai   1.329,06 EUR
`;

// 3,56 - 0,71 + 2,19 + 2,49 + 7,99 - 1,20 + 1,68 = 16,00; VAT inside = 16/1.21*0.21 = 2,78
export const DISCOUNT_RECEIPT = `
LIELVEIKALS ZVAIGZNE
Čeks 00912    12.07.2026 18:05
Jogurts 4 gab x 0,89        3,56
Atlaide -20%               -0,71
Ābolu sula 1L               2,19
Sviests 82% 200g            2,49
Kafija 500g                 7,99
Atlaide ar lojalitātes karti 1,20-
Tomāti 0,512 kg x 3,29      1,68
KOPĀ                       16,00
t.sk. PVN 21%               2,78
Samaksāts ar karti         16,00
`;

// A: 3,10 + 6,90 = 10,00 gross → 8,26 + 1,74.  B: 8,40 + 5,60 = 14,00 → 12,50 + 1,50.
export const TWO_RATE_RECEIPT = `
SIA "Mājas Aptieka"
Reģ. Nr. 40003555777
Tērbatas iela 14, Rīga
2026-06-30 11:20
Vitamīns C 500mg 2 x 4,20   8,40 B
Plāksteri                   3,10 A
Ibuprofēns 200mg            5,60 B
Roku krēms                  6,90 A
KOPĀ EUR                   24,00
PVN      Bez PVN   PVN    Ar PVN
A 21%     8,26     1,74   10,00
B 12%    12,50     1,50   14,00
PVN kopā           3,24
`;

describe('comma decimals with dotted thousands', () => {
  const r = parseReceipt(lines(COMMA_INVOICE));
  it('reads header and totals', () => {
    expect(r.merchant.value).toBe('SIA "Rīgas Tehnika"');
    expect(r.date.value).toBe('2026-08-05');
    expect(r.currency.value).toBe('EUR');
    expect(r.subtotal.value).toBe(1098.4);
    expect(r.vatRate.value).toBe(21);
    expect(r.vatAmount.value).toBe(230.66);
    expect(r.total.value).toBe(1329.06);
  });
  it('reads the items', () => {
    expect(simple(r)).toEqual([
      ['Klēpjdators Lenovo', 1, 1049, 1049],
      ['Pele bezvadu', 2, 14.95, 29.9],
      ['USB-C kabelis 2 m', 3, 6.5, 19.5],
    ]);
  });
  it('passes every cross-check', () => expect(warnings(r)).toEqual([]));
});

describe('discounts and negative lines', () => {
  const r = parseReceipt(lines(DISCOUNT_RECEIPT));
  it('keeps every discount as a negative row, including one that mentions a card', () => {
    expect(simple(r)).toEqual([
      ['Jogurts', 4, 0.89, 3.56],
      ['Atlaide -20%', 1, -0.71, -0.71],
      ['Ābolu sula 1L', 1, 2.19, 2.19],
      ['Sviests 82% 200g', 1, 2.49, 2.49],
      ['Kafija 500g', 1, 7.99, 7.99],
      ['Atlaide ar lojalitātes karti', 1, -1.2, -1.2],
      ['Tomāti', 0.512, 3.29, 1.68],
    ]);
  });
  it('reads the totals', () => {
    expect(r.merchant.value).toBe('LIELVEIKALS ZVAIGZNE');
    expect(r.date.value).toBe('2026-07-12');
    expect(r.total.value).toBe(16);
    expect(r.vatAmount.value).toBe(2.78);
    expect(r.vatRate.value).toBe(21);
  });
  it('passes every cross-check', () => expect(warnings(r)).toEqual([]));
});

describe('two VAT rates', () => {
  const r = parseReceipt(lines(TWO_RATE_RECEIPT));
  it('sums the VAT across rates and reports no single rate', () => {
    expect(r.vatAmount.value).toBe(3.24);
    expect(r.vatRate.value).toBeNull();
    expect(r.subtotal.value).toBe(20.76);
    expect(r.total.value).toBe(24);
  });
  it('reads header and items', () => {
    expect(r.merchant.value).toBe('SIA "Mājas Aptieka"');
    expect(r.date.value).toBe('2026-06-30');
    expect(simple(r)).toEqual([
      ['Vitamīns C 500mg', 2, 4.2, 8.4],
      ['Plāksteri', 1, 3.1, 3.1],
      ['Ibuprofēns 200mg', 1, 5.6, 5.6],
      ['Roku krēms', 1, 6.9, 6.9],
    ]);
  });
  it('passes every cross-check', () => expect(warnings(r)).toEqual([]));
});

describe('a description that is also a unit word', () => {
  it('keeps "Hours" as the description rather than eating it as a unit', async () => {
    const { parseItemLine } = await import('../src/lib/parse');
    const p = parseItemLine('Hours 7,5 40,00 300,00')!;
    expect([p.description, p.qty, p.unitPrice, p.total]).toEqual(['Hours', 7.5, 40, 300]);
  });
});
