import { describe, expect, it } from 'vitest';
import { findAmounts, parseNumber, repairDigits } from '../src/lib/money';

const values = (s: string, o?: { spaceThousands?: boolean }) => findAmounts(s, o).map((a) => a.value);

describe('findAmounts', () => {
  it('reads comma and dot decimals', () => {
    expect(values('Maize 1,89 A')).toEqual([1.89]);
    expect(values('Latte 3.50')).toEqual([3.5]);
  });

  it('reads thousands in either convention', () => {
    expect(values('Total 1,234.56')).toEqual([1234.56]);
    expect(values('Kopā 1.234,56')).toEqual([1234.56]);
    expect(values("CHF 1'234.50")).toEqual([1234.5]);
  });

  it('only groups on a plain space when asked', () => {
    expect(values('Kopā 1 234,56')).toEqual([234.56]);
    expect(values('Kopā 1 234,56', { spaceThousands: true })).toEqual([1234.56]);
  });

  it('reads leading and trailing minus signs', () => {
    expect(values('Atlaide -0,60')).toEqual([-0.6]);
    expect(values('Discount 3,00-')).toEqual([-3]);
  });

  it('ignores dates, times, percentages, weights and volumes', () => {
    expect(values('28.09.2026 14:32')).toEqual([]);
    expect(values('PVN 21.00%')).toEqual([]);
    expect(values('0,456 kg')).toEqual([]);
    expect(values('Cola 0.50L 1,20')).toEqual([1.2]);
    expect(values('Reg. nr 40003123456')).toEqual([]);
  });

  it('finds several amounts on one line, in order', () => {
    expect(values('A 21%   10,30   2,16   12,46')).toEqual([10.3, 2.16, 12.46]);
  });
});

describe('repairDigits', () => {
  it('turns an O inside a number into a zero', () => {
    expect(repairDigits('2 gab x O,99 1,98')).toBe('2 gab x 0,99 1,98');
    expect(repairDigits('TOTAL 1O.5O')).toBe('TOTAL 10.50');
  });
  it('leaves words alone', () => {
    expect(repairDigits('ORANGE JUICE')).toBe('ORANGE JUICE');
  });
});

describe('parseNumber', () => {
  it.each([
    ['12,50', 12.5],
    ['12.50', 12.5],
    ['1 234,56', 1234.56],
    ['1.234,56', 1234.56],
    ['1,234.56', 1234.56],
    ['1.234', 1234],
    ['0,456', 0.456],
    ['-3', -3],
    ['3,00-', -3],
    ['€ 4.20', 4.2],
    ['7', 7],
  ])('%s → %d', (input, expected) => {
    expect(parseNumber(input)).toBe(expected);
  });

  it.each(['', 'abc', '1,2,3x', '--'])('rejects %j', (input) => {
    expect(parseNumber(input)).toBeNull();
  });
});
