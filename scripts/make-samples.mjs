// Generates the four sample documents shipped in public/samples/. Run with `pnpm samples`.
//
// The outputs are committed, so neither the Docker build nor CI needs this script (or
// @napi-rs/canvas). It is kept so the samples can be regenerated and so it is obvious they
// are synthetic: every business, number and address in them is invented.
//
// Fonts come from the Windows font directory (Consolas for till receipts, Arial — which is
// metric-compatible with Helvetica — for the invoices). Point FONT_DIR elsewhere on other
// systems; any monospace + Helvetica-metric sans with Latvian glyphs will do.

import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'public', 'samples');
mkdirSync(OUT, { recursive: true });

const FONT_DIR = process.env.FONT_DIR ?? 'C:/Windows/Fonts';
GlobalFonts.registerFromPath(join(FONT_DIR, 'consola.ttf'), 'Mono');
GlobalFonts.registerFromPath(join(FONT_DIR, 'consolab.ttf'), 'MonoBold');
GlobalFonts.registerFromPath(join(FONT_DIR, 'arial.ttf'), 'Sans');
GlobalFonts.registerFromPath(join(FONT_DIR, 'arialbd.ttf'), 'SansBold');

// Deterministic noise, so regenerating does not churn the committed binaries.
let seed = 20260928;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

// ------------------------------------------------------------------ till receipts ----

const W = 34; // characters per line on an 80 mm roll
const lr = (l, r) => l + ' '.repeat(Math.max(1, W - l.length - r.length)) + r;
const center = (s) => ' '.repeat(Math.max(0, Math.floor((W - s.length) / 2))) + s;
const rule = '-'.repeat(W);

const LV_RECEIPT = [
  { t: center('SIA "Daugavas Bode"'), bold: true },
  center('Brīvības iela 88, Rīga, LV-1001'),
  center('PVN reģ. Nr. LV40003123456'),
  '',
  lr('Kase 2', 'Čeks Nr. 004821'),
  lr('28.09.2026', '14:32'),
  rule,
  lr('Rudzu maize "Rīga"', '1,89 A'),
  'Piens 2,5% 1L',
  lr('  2 gab x 0,99', '1,98 A'),
  'Banāni',
  lr('  0,845 kg x 1,49 EUR/kg', '1,26 A'),
  lr('Kafija malta 250g', '4,59 A'),
  lr('Siers Holandes 1 gab 3,29', '3,29 A'),
  lr('Atlaide Kafija', '-0,60 A'),
  lr('Maisiņš', '0,05 A'),
  rule,
  { t: lr('KOPĀ EUR', '12,46'), bold: true },
  lr('Samaksāts: Karte', '12,46'),
  rule,
  'PVN     Bez PVN   PVN   Ar PVN',
  'A 21%   10,30     2,16  12,46',
  rule,
  center('Paldies par pirkumu!'),
];

const CAFE_RECEIPT = [
  { t: center('KAFEJNICA ZIEDONIS'), bold: true },
  center('Ziedoņa dārzs, Rīga'),
  '',
  lr('27/09/2026   09:41', 'Galds 4'),
  rule,
  lr('2 Flat white', '7.00'),
  lr('1 Croissant', '2.80'),
  lr('Cardamom bun 2 x 3.20', '6.40'),
  lr('Orange juice 0.3L', '3.50'),
  lr('Water still', '1.90'),
  rule,
  { t: lr('TOTAL EUR', '21.60'), bold: true },
  lr('incl. VAT 21%', '3.75'),
  lr('CARD', '21.60'),
  rule,
  center('Thank you, see you soon!'),
];

function drawTill(lines, { size = 22, pad = 28, ink = '#1b1b1b', paper = '#fbfaf6' } = {}) {
  const lh = Math.round(size * 1.38);
  const probe = createCanvas(10, 10).getContext('2d');
  probe.font = `${size}px Mono`;
  const cw = probe.measureText('M').width;
  const w = Math.ceil(cw * W + pad * 2);
  const h = lines.length * lh + pad * 2 + 20;
  const c = createCanvas(w, h);
  const g = c.getContext('2d');
  g.fillStyle = paper;
  g.fillRect(0, 0, w, h);
  g.textBaseline = 'top';
  lines.forEach((ln, i) => {
    const o = typeof ln === 'string' ? { t: ln } : ln;
    g.font = `${size}px ${o.bold ? 'MonoBold' : 'Mono'}`;
    g.fillStyle = ink;
    g.fillText(o.t, pad, pad + i * lh);
  });
  // a torn-off zigzag at the bottom edge
  g.fillStyle = paper;
  return c;
}

// ---------------------------------------------------------------- page layouts ----
// One layout, two renderers: a canvas (for scans and thumbnails) and a real PDF text layer.

const A4 = { w: 595, h: 842 };

function measure(text, size, bold) {
  const g = createCanvas(10, 10).getContext('2d');
  g.font = `${size}px ${bold ? 'SansBold' : 'Sans'}`;
  return g.measureText(text).width;
}

/** ops: {text,x,y,size,bold,align} | {rule:[x1,y1,x2,y2]} | {band:[x,y,w,h], gray} — y from top */
function text(t, x, y, size = 9.5, opts = {}) {
  return { text: t, x, y, size, bold: !!opts.bold, align: opts.align ?? 'left' };
}

const EN_INVOICE = (() => {
  const ops = [];
  const R = 545;
  ops.push(text('Northwind Studio SIA', 50, 70, 18, { bold: true }));
  ops.push(text('INVOICE', R, 70, 22, { bold: true, align: 'right' }));
  ops.push(text('Elizabetes iela 21, Riga, LV-1010', 50, 92));
  ops.push(text('VAT reg. no. LV40103999999', 50, 106));
  ops.push(text('hello@northwind.example', 50, 120));
  ops.push(text('Invoice number: INV-2026-0142', R, 100, 9.5, { align: 'right' }));
  ops.push(text('Invoice date: 12 Sep 2026', R, 114, 9.5, { align: 'right' }));
  ops.push(text('Due date: 12 Oct 2026', R, 128, 9.5, { align: 'right' }));
  ops.push(text('Bill to:', 50, 172, 9.5, { bold: true }));
  ops.push(text('Baltic Freight SIA', 50, 188, 11));
  ops.push(text('Krasta iela 42, Riga, LV-1003', 50, 202));
  ops.push({ band: [50, 240, 495, 22], gray: 0.92 });
  const cols = [
    ['Description', 58, 'left'],
    ['Qty', 360, 'right'],
    ['Unit price', 450, 'right'],
    ['Amount', 537, 'right'],
  ];
  for (const [t, x, align] of cols) ops.push(text(t, x, 255, 9.5, { bold: true, align }));
  const rows = [
    ['Brand workshop (half day)', '1', '850.00', '850.00'],
    ['Landing page design', '1', '1,200.00', '1,200.00'],
    ['Illustration set', '6', '45.00', '270.00'],
    ['Copy editing (hours)', '3.5', '60.00', '210.00'],
  ];
  rows.forEach((r, i) => {
    const y = 288 + i * 24;
    r.forEach((t, j) => ops.push(text(t, cols[j][1], y, 10, { align: cols[j][2] })));
    ops.push({ rule: [50, y + 9, 545, y + 9], gray: 0.85 });
  });
  const sy = 400;
  ops.push(text('Subtotal', 380, sy, 10));
  ops.push(text('2,530.00', 537, sy, 10, { align: 'right' }));
  ops.push(text('VAT 21%', 380, sy + 18, 10));
  ops.push(text('531.30', 537, sy + 18, 10, { align: 'right' }));
  ops.push({ rule: [380, sy + 27, 545, sy + 27], gray: 0.2 });
  ops.push(text('Total due (EUR)', 380, sy + 44, 11.5, { bold: true }));
  ops.push(text('€3,061.30', 537, sy + 44, 11.5, { bold: true, align: 'right' }));
  ops.push(text('Payment: bank transfer to IBAN LV12HABA0551234567890 within 30 days.', 50, 760, 8.5));
  ops.push(text('Thank you for your business.', 50, 774, 8.5));
  return ops;
})();

const LV_INVOICE = (() => {
  const ops = [];
  const R = 545;
  ops.push(text('SIA "Kurzemes Koks"', 50, 70, 17, { bold: true }));
  ops.push(text('Reģ. Nr. 40003987654, PVN Nr. LV40003987654', 50, 90));
  ops.push(text('Rūpniecības iela 5, Ventspils, LV-3601', 50, 104));
  ops.push(text('RĒĶINS Nr. KK-2026/0917', 50, 150, 15, { bold: true }));
  ops.push(text('Ventspilī, 2026. gada 3. septembrī', 50, 170, 10));
  ops.push(text('Pircējs: SIA "Baltic Freight"', 50, 200, 10));
  ops.push(text('Krasta iela 42, Rīga, LV-1003', 50, 214, 10));
  ops.push({ rule: [50, 244, 545, 244], gray: 0.2 });
  const cols = [
    ['Nosaukums', 52, 'left'],
    ['Daudz.', 330, 'right'],
    ['Mērv.', 375, 'right'],
    ['Cena', 450, 'right'],
    ['Summa', 540, 'right'],
  ];
  for (const [t, x, align] of cols) ops.push(text(t, x, 258, 10, { bold: true, align }));
  ops.push({ rule: [50, 266, 545, 266], gray: 0.2 });
  const rows = [
    ['Priedes dēlis 25x100', '40', 'gab', '3,15', '126,00'],
    ['Skrūves 4x50 (200 gab)', '3', 'iep.', '7,80', '23,40'],
    ['Piegāde', '1', 'gab.', '25,00', '25,00'],
  ];
  rows.forEach((r, i) => r.forEach((t, j) => ops.push(text(t, cols[j][1], 286 + i * 22, 10.5, { align: cols[j][2] }))));
  ops.push({ rule: [50, 346, 545, 346], gray: 0.2 });
  ops.push(text('Kopā bez PVN', 360, 366, 10.5));
  ops.push(text('174,40', 540, 366, 10.5, { align: 'right' }));
  ops.push(text('PVN 21%', 360, 386, 10.5));
  ops.push(text('36,62', 540, 386, 10.5, { align: 'right' }));
  ops.push(text('Kopā apmaksai EUR', 360, 410, 11.5, { bold: true }));
  ops.push(text('211,02', 540, 410, 11.5, { bold: true, align: 'right' }));
  ops.push(text('Apmaksāt līdz: 17.09.2026', 50, 470, 10));
  ops.push(text('Rēķins sagatavots elektroniski un derīgs bez paraksta.', 50, 488, 9));
  return ops;
})();

function drawPage(ops, scale, { paper = '#ffffff', ink = '#141414' } = {}) {
  const c = createCanvas(Math.round(A4.w * scale), Math.round(A4.h * scale));
  const g = c.getContext('2d');
  g.fillStyle = paper;
  g.fillRect(0, 0, c.width, c.height);
  g.scale(scale, scale);
  for (const op of ops) {
    if (op.band) {
      const v = Math.round(op.gray * 255);
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(...op.band);
    } else if (op.rule) {
      const v = Math.round(op.gray * 255);
      g.strokeStyle = `rgb(${v},${v},${v})`;
      g.lineWidth = 0.6;
      g.beginPath();
      g.moveTo(op.rule[0], op.rule[1]);
      g.lineTo(op.rule[2], op.rule[3]);
      g.stroke();
    } else {
      g.font = `${op.size}px ${op.bold ? 'SansBold' : 'Sans'}`;
      g.fillStyle = ink;
      g.textBaseline = 'alphabetic';
      const w = g.measureText(op.text).width;
      g.fillText(op.text, op.align === 'right' ? op.x - w : op.x, op.y);
    }
  }
  return c;
}

// ------------------------------------------------------------------ PDF writer ----

const WIN_ANSI = { '€': 0x80, '–': 0x96, '—': 0x97, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94 };

function pdfString(s) {
  const bytes = [];
  for (const ch of s) {
    const code = WIN_ANSI[ch] ?? ch.charCodeAt(0);
    if (code > 255) throw new Error(`not in WinAnsiEncoding: ${ch}`);
    if (code === 0x28 || code === 0x29 || code === 0x5c) bytes.push(0x5c);
    bytes.push(code);
  }
  return Buffer.from(bytes);
}

function buildPdf({ title, content, image }) {
  const objs = [];
  const add = (body) => {
    objs.push(body);
    return objs.length;
  };
  const catalog = add(null);
  const pages = add(null);
  const page = add(null);
  const f1 = add(Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'));
  const f2 = add(Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'));
  let im = 0;
  if (image) {
    im = add(
      Buffer.concat([
        Buffer.from(
          `<< /Type /XObject /Subtype /Image /Width ${image.w} /Height ${image.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.jpeg.length} >>\nstream\n`,
        ),
        image.jpeg,
        Buffer.from('\nendstream'),
      ]),
    );
  }
  const stream = add(Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`), content, Buffer.from('\nendstream')]));
  const info = add(Buffer.concat([Buffer.from('<< /Title ('), pdfString(title), Buffer.from(') /Producer (Cosmic sample generator) >>')]));
  objs[catalog - 1] = Buffer.from(`<< /Type /Catalog /Pages ${pages} 0 R >>`);
  objs[pages - 1] = Buffer.from(`<< /Type /Pages /Kids [${page} 0 R] /Count 1 >>`);
  objs[page - 1] = Buffer.from(
    `<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 ${A4.w} ${A4.h}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >>${
      im ? ` /XObject << /Im1 ${im} 0 R >>` : ''
    } >> /Contents ${stream} 0 R >>`,
  );

  const parts = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
  let offset = parts[0].length;
  const offsets = [];
  objs.forEach((body, i) => {
    offsets.push(offset);
    const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), body, Buffer.from('\nendobj\n')]);
    parts.push(chunk);
    offset += chunk.length;
  });
  const xref =
    `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` +
    offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('') +
    `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${offset}\n%%EOF\n`;
  parts.push(Buffer.from(xref));
  return Buffer.concat(parts);
}

function textLayerContent(ops) {
  const chunks = [];
  const fmt = (n) => (Math.round(n * 100) / 100).toString();
  for (const op of ops) {
    if (op.band) {
      const [x, y, w, h] = op.band;
      chunks.push(Buffer.from(`q ${op.gray} g ${fmt(x)} ${fmt(A4.h - y - h)} ${fmt(w)} ${fmt(h)} re f Q\n`));
    } else if (op.rule) {
      const [x1, y1, x2, y2] = op.rule;
      chunks.push(Buffer.from(`q ${op.gray} G 0.6 w ${fmt(x1)} ${fmt(A4.h - y1)} m ${fmt(x2)} ${fmt(A4.h - y2)} l S Q\n`));
    } else {
      const w = measure(op.text, op.size, op.bold);
      const x = op.align === 'right' ? op.x - w : op.x;
      chunks.push(
        Buffer.concat([
          Buffer.from(`BT /${op.bold ? 'F2' : 'F1'} ${op.size} Tf 1 0 0 1 ${fmt(x)} ${fmt(A4.h - op.y)} Tm (`),
          pdfString(op.text),
          Buffer.from(') Tj ET\n'),
        ]),
      );
    }
  }
  return Buffer.concat(chunks);
}

// ------------------------------------------------------------------ degradation ----

function addNoise(canvas, amount, specks = 0) {
  const g = canvas.getContext('2d');
  const img = g.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rand() - 0.5) * amount;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  g.fillStyle = 'rgba(40,40,40,0.55)';
  for (let i = 0; i < specks; i++) {
    const r = rand() * 1.4 + 0.3;
    g.beginPath();
    g.arc(rand() * canvas.width, rand() * canvas.height, r, 0, Math.PI * 2);
    g.fill();
  }
}

async function thumb(src, name, width = 240) {
  const h = Math.round((src.height / src.width) * width);
  const c = createCanvas(width, Math.min(h, Math.round(width * 1.45)));
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(src, 0, 0, width, h);
  writeFileSync(join(OUT, `${name}.thumb.jpg`), await c.encode('jpeg', 82));
}

// ------------------------------------------------------------------ outputs ----

async function main() {
  // 1. Latvian shop receipt: a clean PNG, as a phone's "scan document" mode would give.
  const lv = drawTill(LV_RECEIPT);
  writeFileSync(join(OUT, 'lv-veikals.png'), await lv.encode('png'));
  await thumb(lv, 'lv-veikals');

  // 2. English invoice: a born-digital PDF with a real text layer — no OCR needed.
  writeFileSync(
    join(OUT, 'invoice-en.pdf'),
    buildPdf({ title: 'Invoice INV-2026-0142 (sample)', content: textLayerContent(EN_INVOICE) }),
  );
  await thumb(drawPage(EN_INVOICE, 1.2), 'invoice-en');

  // 3. Café receipt photographed on a table: rotated, unevenly lit, grainy.
  const cafe = drawTill(CAFE_RECEIPT, { size: 22, paper: '#f6f2e8', ink: '#2a2622' });
  const pw = 900;
  const ph = Math.round(cafe.height * 1.25);
  const photo = createCanvas(pw, ph);
  const pg = photo.getContext('2d');
  const table = pg.createLinearGradient(0, 0, pw, ph);
  table.addColorStop(0, '#5b4a3c');
  table.addColorStop(1, '#3a2e25');
  pg.fillStyle = table;
  pg.fillRect(0, 0, pw, ph);
  pg.save();
  pg.translate(pw / 2, ph / 2);
  pg.rotate((-2.6 * Math.PI) / 180);
  pg.shadowColor = 'rgba(0,0,0,0.45)';
  pg.shadowBlur = 24;
  pg.shadowOffsetY = 8;
  pg.drawImage(cafe, -cafe.width / 2, -cafe.height / 2);
  pg.restore();
  const light = pg.createRadialGradient(pw * 0.3, ph * 0.2, 50, pw * 0.5, ph * 0.5, pw);
  light.addColorStop(0, 'rgba(255,245,220,0.10)');
  light.addColorStop(1, 'rgba(0,0,0,0.28)');
  pg.fillStyle = light;
  pg.fillRect(0, 0, pw, ph);
  addNoise(photo, 26);
  writeFileSync(join(OUT, 'kafejnica-photo.jpg'), await photo.encode('jpeg', 84));
  await thumb(photo, 'kafejnica-photo');

  // 4. Latvian invoice, printed and scanned: an image-only PDF with no text layer at all,
  //    so the app has to render the page and run OCR on it.
  const scale = 150 / 72;
  const page = drawPage(LV_INVOICE, scale, { paper: '#f3f1ea', ink: '#202020' });
  const tilted = createCanvas(page.width, page.height);
  const tg = tilted.getContext('2d');
  tg.fillStyle = '#f3f1ea';
  tg.fillRect(0, 0, page.width, page.height);
  tg.translate(page.width / 2, page.height / 2);
  tg.rotate((0.5 * Math.PI) / 180);
  tg.drawImage(page, -page.width / 2, -page.height / 2);
  addNoise(tilted, 18, 260);
  const jpeg = await tilted.encode('jpeg', 78);
  const content = Buffer.from(`q ${A4.w} 0 0 ${A4.h} 0 0 cm /Im1 Do Q\n`);
  writeFileSync(
    join(OUT, 'rekins-scan.pdf'),
    buildPdf({ title: 'Rekins KK-2026/0917 (scanned sample)', content, image: { jpeg, w: tilted.width, h: tilted.height } }),
  );
  await thumb(tilted, 'rekins-scan');

  console.log('samples written to', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
