// Cross-checks. Run after parsing and again after every edit, so fixing a misread cell
// turns the warning green in front of the person who fixed it.

import { round2, sameMoney } from './text';
import type { Check, Receipt } from './types';

export function money(n: number, currency?: string | null): string {
  const s = n.toFixed(2);
  return currency ? `${s} ${currency}` : s;
}

export function itemsSum(r: Receipt): number {
  return round2(r.items.reduce((s, it) => s + (it.total ?? 0), 0));
}

export function validate(r: Receipt): Check[] {
  const checks: Check[] = [];
  const cur = r.currency.value;
  const total = r.total.value;
  const sub = r.subtotal.value;
  const vat = r.vatAmount.value;
  const rate = r.vatRate.value;

  if (!r.items.length) {
    checks.push({ id: 'items', level: 'warn', message: 'No line items found. Add rows by hand, or try a sharper image.' });
  } else {
    const sum = itemsSum(r);
    if (total === null) {
      checks.push({ id: 'items', level: 'info', message: `Line items add up to ${money(sum, cur)}. No total was found to check them against.` });
    } else if (sameMoney(sum, total, 0.02)) {
      checks.push({ id: 'items', level: 'ok', message: `Line items add up to the total, ${money(total, cur)}.` });
    } else if (sub !== null && sameMoney(sum, sub, 0.02)) {
      checks.push({ id: 'items', level: 'ok', message: `Line items add up to the subtotal, ${money(sub, cur)}, with VAT on top.` });
    } else {
      const diff = round2(total - sum);
      checks.push({
        id: 'items',
        level: 'warn',
        message: `Line items add up to ${money(sum, cur)}, but the total says ${money(total, cur)} — ${money(Math.abs(diff), cur)} ${diff > 0 ? 'unaccounted for' : 'too much'}. A row was probably misread or missed.`,
      });
    }
    const badRows = r.items.filter(
      (it) => it.qty !== null && it.unitPrice !== null && it.total !== null && !sameMoney(round2(it.qty * it.unitPrice), it.total, 0.011),
    ).length;
    if (badRows) {
      checks.push({
        id: 'rows',
        level: 'warn',
        message: `${badRows} row${badRows === 1 ? '' : 's'} where quantity × unit price does not equal the line total.`,
      });
    }
  }

  if (total === null) {
    checks.push({ id: 'total', level: 'warn', message: 'No total found. Fill it in to check the rest.' });
  }

  if (sub !== null && vat !== null && total !== null) {
    if (sameMoney(sub + vat, total, 0.02)) {
      checks.push({ id: 'vat-sum', level: 'ok', message: `Subtotal + VAT = total (${money(sub, cur)} + ${money(vat, cur)}).` });
    } else {
      checks.push({
        id: 'vat-sum',
        level: 'warn',
        message: `Subtotal + VAT is ${money(round2(sub + vat), cur)}, not the ${money(total, cur)} total.`,
      });
    }
  }

  if (rate !== null && vat !== null) {
    const base = sub ?? (total !== null ? total - vat : null);
    if (base !== null && base > 0) {
      const expected = round2((base * rate) / 100);
      // printed VAT is rounded per rate band, so allow a couple of cents
      if (Math.abs(expected - vat) <= Math.max(0.03, base * 0.0005)) {
        checks.push({ id: 'vat-rate', level: 'ok', message: `VAT is ${rate}% of ${money(base, cur)}, as stated.` });
      } else {
        checks.push({
          id: 'vat-rate',
          level: 'warn',
          message: `${rate}% of ${money(base, cur)} is ${money(expected, cur)}, but the VAT reads ${money(vat, cur)}.`,
        });
      }
    }
  } else if (vat !== null && rate === null && r.vatRate.confidence > 0) {
    checks.push({ id: 'vat-rate', level: 'info', message: 'Several VAT rates on this receipt; the VAT amount is their sum.' });
  }

  return checks;
}
