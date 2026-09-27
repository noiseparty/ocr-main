/** Fractions of the page, 0..1, so the overlay is independent of display size. */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** One line of text as the extractor saw it. */
export interface SourceLine {
  text: string;
  /** 0..1. The PDF text layer is exact and reports 1; OCR reports its own confidence. */
  conf: number;
  page: number;
  box?: Box;
}

export interface Field<T> {
  value: T | null;
  /** 0..1. 1 also means "a person typed this". */
  confidence: number;
  /** Index into the source lines, for highlighting where it came from. */
  line?: number;
}

export type ItemCell = 'description' | 'qty' | 'unitPrice' | 'total';

export interface LineItem {
  description: string;
  qty: number | null;
  unitPrice: number | null;
  total: number | null;
  conf: Record<ItemCell, number>;
  line?: number;
}

export interface Receipt {
  merchant: Field<string>;
  date: Field<string>;
  currency: Field<string>;
  subtotal: Field<number>;
  vatRate: Field<number>;
  vatAmount: Field<number>;
  total: Field<number>;
  items: LineItem[];
}

export type CheckLevel = 'ok' | 'warn' | 'info';

export interface Check {
  id: string;
  level: CheckLevel;
  message: string;
}

export const FIELD_KEYS = [
  'merchant',
  'date',
  'currency',
  'subtotal',
  'vatRate',
  'vatAmount',
  'total',
] as const;
export type FieldKey = (typeof FIELD_KEYS)[number];
