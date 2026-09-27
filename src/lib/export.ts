// Every document the visitor has read, flattened into rows, then serialised four ways:
// CSV, JSON, XLSX and a TSV for pasting straight into Sheets or Excel.

import { validate, itemsSum } from './validate';
import type { Receipt } from './types';
import { zip } from './zip';

export interface Doc {
  name: string;
  receipt: Receipt;
}

type Cell = string | number | null | { date: string } | { money: number };
type Row = Cell[];

export interface Table {
  name: string;
  header: string[];
  rows: Row[];
  /** column widths, in characters */
  widths: number[];
}

const date = (iso: string | null): Cell => (iso ? { date: iso } : null);
const cash = (n: number | null): Cell => (n === null ? null : { money: n });

export function itemsTable(docs: Doc[]): Table {
  const rows: Row[] = [];
  for (const d of docs) {
    const r = d.receipt;
    for (const it of r.items) {
      rows.push([d.name, r.merchant.value, date(r.date.value), r.currency.value, it.description, it.qty, cash(it.unitPrice), cash(it.total)]);
    }
  }
  return {
    name: 'Line items',
    header: ['File', 'Merchant', 'Date', 'Currency', 'Description', 'Qty', 'Unit price', 'Line total'],
    rows,
    widths: [22, 26, 12, 9, 36, 7, 11, 11],
  };
}

export function receiptsTable(docs: Doc[]): Table {
  return {
    name: 'Receipts',
    header: ['File', 'Merchant', 'Date', 'Currency', 'Subtotal', 'VAT %', 'VAT', 'Total', 'Items sum', 'Checks'],
    rows: docs.map((d) => {
      const r = d.receipt;
      const warnings = validate(r).filter((c) => c.level === 'warn');
      return [
        d.name,
        r.merchant.value,
        date(r.date.value),
        r.currency.value,
        cash(r.subtotal.value),
        r.vatRate.value,
        cash(r.vatAmount.value),
        cash(r.total.value),
        cash(itemsSum(r)),
        warnings.length ? warnings.map((w) => w.message).join(' ') : 'OK',
      ];
    }),
    widths: [22, 26, 12, 9, 11, 7, 10, 11, 11, 60],
  };
}

function plain(c: Cell): string {
  if (c === null) return '';
  if (typeof c === 'number') return String(c);
  if (typeof c === 'string') return c;
  if ('date' in c) return c.date;
  return c.money.toFixed(2);
}

/**
 * A text cell that starts with = + - @ is a formula to a spreadsheet. OCR output is
 * untrusted text, so neutralise it the way OWASP suggests: a leading apostrophe.
 */
function safeText(s: string): string {
  return /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
}

function csvField(c: Cell, sep: string): string {
  const s = typeof c === 'string' ? safeText(c) : plain(c);
  return s.includes(sep) || /["\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(t: Table): string {
  const lines = [t.header, ...t.rows].map((row) => row.map((c) => csvField(c, ',')).join(','));
  return lines.join('\r\n') + '\r\n';
}

/** Tab-separated, for the clipboard. Tabs and newlines inside a cell become spaces. */
export function toTSV(t: Table): string {
  return [t.header, ...t.rows]
    .map((row) => row.map((c) => (typeof c === 'string' ? safeText(c) : plain(c)).replace(/[\t\r\n]+/g, ' ')).join('\t'))
    .join('\n');
}

export function toJSON(docs: Doc[]): string {
  return JSON.stringify(
    {
      generator: 'Receipt Reader — Cosmic demo',
      documents: docs.map((d) => {
        const r = d.receipt;
        return {
          file: d.name,
          merchant: r.merchant.value,
          date: r.date.value,
          currency: r.currency.value,
          subtotal: r.subtotal.value,
          vatRate: r.vatRate.value,
          vatAmount: r.vatAmount.value,
          total: r.total.value,
          items: r.items.map((it) => ({
            description: it.description,
            qty: it.qty,
            unitPrice: it.unitPrice,
            total: it.total,
          })),
          confidence: {
            merchant: r.merchant.confidence,
            date: r.date.confidence,
            currency: r.currency.confidence,
            subtotal: r.subtotal.confidence,
            vatRate: r.vatRate.confidence,
            vatAmount: r.vatAmount.confidence,
            total: r.total.confidence,
          },
          checks: validate(r).map(({ level, message }) => ({ level, message })),
        };
      }),
    },
    null,
    2,
  );
}

// ---------------------------------------------------------------- xlsx ----

const xmlEsc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // XML 1.0 forbids most control characters; OCR can produce them
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

function colName(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** Days since 1899-12-30, Excel's epoch (it keeps Lotus's phantom 29 Feb 1900). */
export function excelSerial(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000);
}

// style ids in styles.xml below: 0 default, 1 header, 2 date, 3 money
function cellXml(c: Cell, ref: string): string {
  if (c === null) return '';
  if (typeof c === 'number') return `<c r="${ref}"><v>${c}</v></c>`;
  if (typeof c === 'string') return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(c)}</t></is></c>`;
  if ('date' in c) return `<c r="${ref}" s="2"><v>${excelSerial(c.date)}</v></c>`;
  return `<c r="${ref}" s="3"><v>${c.money}</v></c>`;
}

function sheetXml(t: Table): string {
  const cols = t.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
  const head = `<row r="1">${t.header
    .map((h, i) => `<c r="${colName(i)}1" t="inlineStr" s="1"><is><t>${xmlEsc(h)}</t></is></c>`)
    .join('')}</row>`;
  const body = t.rows
    .map((row, ri) => `<row r="${ri + 2}">${row.map((c, ci) => cellXml(c, `${colName(ci)}${ri + 2}`)).join('')}</row>`)
    .join('');
  const last = `${colName(t.header.length - 1)}${t.rows.length + 1}`;
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    `<cols>${cols}</cols><sheetData>${head}${body}</sheetData>` +
    `<autoFilter ref="A1:${last}"/>` +
    '</worksheet>'
  );
}

const STYLES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/><numFmt numFmtId="165" formatCode="#,##0.00"/></numFmts>' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="4">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '</cellXfs></styleSheet>';

export function toXLSX(tables: Table[]): Uint8Array {
  const sheets = tables.map((t, i) => ({ t, id: i + 1, name: xmlEsc(t.name.slice(0, 31)) }));
  return zip([
    {
      name: '[Content_Types].xml',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        sheets
          .map((s) => `<Override PartName="/xl/worksheets/sheet${s.id}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
          .join('') +
        '</Types>',
    },
    {
      name: '_rels/.rels',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>',
    },
    {
      name: 'xl/workbook.xml',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        `<sheets>${sheets.map((s) => `<sheet name="${s.name}" sheetId="${s.id}" r:id="rId${s.id}"/>`).join('')}</sheets>` +
        `<definedNames>${sheets
          .map((s) => `<definedName name="_xlnm._FilterDatabase" localSheetId="${s.id - 1}" hidden="1">'${s.name}'!$A$1:$${colName(s.t.header.length - 1)}$${s.t.rows.length + 1}</definedName>`)
          .join('')}</definedNames>` +
        '</workbook>',
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        sheets
          .map((s) => `<Relationship Id="rId${s.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${s.id}.xml"/>`)
          .join('') +
        `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        '</Relationships>',
    },
    { name: 'xl/styles.xml', data: STYLES },
    ...sheets.map((s) => ({ name: `xl/worksheets/sheet${s.id}.xml`, data: sheetXml(s.t) })),
  ]);
}
