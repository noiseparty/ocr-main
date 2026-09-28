import { describe, expect, it } from 'vitest';
import { excelSerial, itemsTable, receiptsTable, toCSV, toJSON, toTSV, toXLSX } from '../src/lib/export';
import { parseReceipt } from '../src/lib/parse';
import { crc32 } from '../src/lib/zip';
import { EN_INVOICE, LV_RECEIPT, lines } from './fixtures';

const docs = [
  { name: 'receipt.png', receipt: parseReceipt(lines(LV_RECEIPT)) },
  { name: 'invoice.pdf', receipt: parseReceipt(lines(EN_INVOICE)) },
];

describe('tables', () => {
  it('combines every document into one sheet of line items', () => {
    const t = itemsTable(docs);
    expect(t.rows).toHaveLength(7 + 4);
    expect(t.rows[0]!.slice(0, 2)).toEqual(['receipt.png', 'SIA "Daugavas Bode"']);
  });
  it('summarises one row per document', () => {
    expect(receiptsTable(docs).rows.map((r) => r[9])).toEqual(['OK', 'OK']);
  });
});

describe('CSV / TSV', () => {
  it('quotes fields with commas and quotes', () => {
    const csv = toCSV(itemsTable(docs));
    expect(csv.split('\r\n')[0]).toBe('File,Merchant,Date,Currency,Description,Qty,Unit price,Line total');
    expect(csv).toContain('"SIA ""Daugavas Bode""",2026-09-28,EUR');
    expect(csv).toContain('"Piens 2,5% 1L",2,0.99,1.98');
  });
  it('defuses formula-looking text', () => {
    const t = { name: 'x', header: ['a'], rows: [['=HYPERLINK("x")'], ['-12.5'], ['@cmd'], ["-2+3+cmd|' /C calc'!A0"]], widths: [5] };
    expect(toCSV(t).split('\r\n').slice(1, 5)).toEqual([`"'=HYPERLINK(""x"")"`, '-12.5', "'@cmd", "'-2+3+cmd|' /C calc'!A0"]);
  });
  it('writes a TSV that pastes into a spreadsheet', () => {
    const tsv = toTSV(itemsTable(docs));
    expect(tsv.split('\n')[1]).toBe('receipt.png\tSIA "Daugavas Bode"\t2026-09-28\tEUR\tRudzu maize "Rīga"\t1\t1.89\t1.89');
  });
});

describe('JSON', () => {
  it('round-trips', () => {
    const j = JSON.parse(toJSON(docs));
    expect(j.documents[1].total).toBe(3061.3);
    expect(j.documents[1].items).toHaveLength(4);
  });
});

describe('XLSX', () => {
  it('computes Excel date serials', () => {
    expect(excelSerial('1900-03-01')).toBe(61);
    expect(excelSerial('2026-09-28')).toBe(46293);
  });

  it('writes a well-formed zip whose entries carry correct CRCs', () => {
    const bytes = toXLSX([itemsTable(docs), receiptsTable(docs)]);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const eocd = bytes.length - 22;
    expect(view.getUint32(eocd, true)).toBe(0x06054b50);
    const count = view.getUint16(eocd + 10, true);
    expect(count).toBe(7);
    let p = view.getUint32(eocd + 16, true);
    const names: string[] = [];
    for (let i = 0; i < count; i++) {
      expect(view.getUint32(p, true)).toBe(0x02014b50);
      const crc = view.getUint32(p + 16, true);
      const size = view.getUint32(p + 20, true);
      const nameLen = view.getUint16(p + 28, true);
      const offset = view.getUint32(p + 42, true);
      names.push(new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen)));
      const localNameLen = view.getUint16(offset + 26, true);
      const data = bytes.subarray(offset + 30 + localNameLen, offset + 30 + localNameLen + size);
      expect(crc32(data)).toBe(crc);
      p += 46 + nameLen;
    }
    expect(names).toContain('xl/worksheets/sheet2.xml');
    expect(new TextDecoder().decode(bytes)).toContain('<t xml:space="preserve">Rudzu maize &quot;Rīga&quot;</t>');
  });

  it('matches the reference CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
});
