import './styles.css';
import { extract, FriendlyError, type Extraction, type PreviewPage } from './engine/extract';
import { parseDate } from './lib/dates';
import { itemsTable, receiptsTable, toCSV, toJSON, toTSV, toXLSX, type Doc } from './lib/export';
import { parseNumber } from './lib/money';
import { parseReceipt } from './lib/parse';
import type { FieldKey, ItemCell, LineItem, Receipt } from './lib/types';
import { itemsSum, validate } from './lib/validate';

const BASE = import.meta.env.BASE_URL;
const MAX_FILES = 20;
const LC_MID = 0.75;
const LC_LOW = 0.5;

// ------------------------------------------------------------------ samples ----

const SAMPLES = [
  { file: 'lv-veikals.png', type: 'image/png', title: 'Shop receipt', tag: 'PNG · Latvian · PVN' },
  { file: 'invoice-en.pdf', type: 'application/pdf', title: 'Studio invoice', tag: 'PDF · text layer' },
  { file: 'kafejnica-photo.jpg', type: 'image/jpeg', title: 'Café photo', tag: 'JPG · skewed, grainy' },
  { file: 'rekins-scan.pdf', type: 'application/pdf', title: 'Scanned rēķins', tag: 'PDF · scan → OCR' },
];

// -------------------------------------------------------------------- state ----

interface Job {
  id: number;
  name: string;
  file: File;
  status: 'queued' | 'reading' | 'done' | 'error';
  stage: string;
  progress: number | null;
  pages: PreviewPage[];
  extraction?: Extraction;
  receipt?: Receipt;
  error?: string;
  ms?: number;
}

const jobs: Job[] = [];
let selectedId = -1;
let nextId = 1;
let running = false;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const els = {
  file: $<HTMLInputElement>('file'),
  pick: $('pick'),
  drop: $('drop'),
  samples: $('samples'),
  docbar: $('docbar'),
  tabs: $('tabs'),
  exports: $('exports'),
  exportCount: $('export-count'),
  workspace: $('workspace'),
  announce: $('announce'),
};

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const selected = () => jobs.find((j) => j.id === selectedId);

// ------------------------------------------------------------------- intake ----

function addFiles(list: FileList | File[]) {
  const files = [...list].slice(0, MAX_FILES);
  if (!files.length) return;
  if (list.length > MAX_FILES) announce(`Only the first ${MAX_FILES} files were added.`);
  let first: Job | undefined;
  for (const file of files) {
    const job: Job = { id: nextId++, name: file.name || 'pasted-image.png', file, status: 'queued', stage: 'Waiting', progress: null, pages: [] };
    jobs.push(job);
    first ??= job;
  }
  if (first) selectedId = first.id;
  renderTabs();
  renderWorkspace();
  void pump();
}

async function pump() {
  if (running) return;
  running = true;
  try {
    for (let job = jobs.find((j) => j.status === 'queued'); job; job = jobs.find((j) => j.status === 'queued')) {
      await run(job);
    }
  } finally {
    running = false;
  }
}

async function run(job: Job) {
  job.status = 'reading';
  job.stage = 'Starting';
  renderTabs();
  if (job.id === selectedId) renderWorkspace();
  const t0 = performance.now();
  try {
    const ex = await extract(
      job.file,
      (stage, progress) => {
        job.stage = stage;
        job.progress = progress;
        updateProgress(job);
      },
      (pages) => {
        job.pages = pages;
        if (job.id === selectedId) renderWorkspace();
      },
    );
    job.extraction = ex;
    job.pages = ex.pages;
    job.receipt = parseReceipt(ex.lines);
    job.status = 'done';
    job.ms = performance.now() - t0;
    const r = job.receipt;
    const total = r.total.value !== null ? `, total ${r.total.value.toFixed(2)}${r.currency.value ? ' ' + r.currency.value : ''}` : '';
    announce(`Read ${job.name}: ${r.items.length} line item${r.items.length === 1 ? '' : 's'}${total}.`);
  } catch (e) {
    job.status = 'error';
    job.error =
      e instanceof FriendlyError
        ? e.message
        : 'Something went wrong while reading this file. If it is a photo, try a sharper, flatter shot; if the OCR engine failed to load, reload the page.';
    if (!(e instanceof FriendlyError)) console.error(e);
    announce(`Could not read ${job.name}.`);
  }
  renderTabs();
  updateExportBar();
  if (job.id === selectedId) renderWorkspace();
}

function announce(msg: string) {
  els.announce.textContent = msg;
}

// --------------------------------------------------------------------- tabs ----

function jobDot(j: Job): string {
  if (j.status === 'queued' || j.status === 'reading') return 'is-busy';
  if (j.status === 'error') return 'is-error';
  return j.receipt && validate(j.receipt).some((c) => c.level === 'warn') ? 'is-warn' : 'is-ok';
}

function jobMeta(j: Job): string {
  if (j.status === 'queued') return 'queued';
  if (j.status === 'reading') return j.progress !== null ? `${Math.round(j.progress * 100)}%` : '…';
  if (j.status === 'error') return 'failed';
  return `${j.receipt!.items.length} rows`;
}

function renderTabs() {
  els.docbar.hidden = jobs.length === 0;
  document.getElementById('tool')?.classList.toggle('has-docs', jobs.length > 0);
  els.tabs.innerHTML = jobs
    .map(
      (j) => `<button type="button" role="tab" class="tab" id="tab-${j.id}" data-job="${j.id}"
        aria-selected="${j.id === selectedId}" tabindex="${j.id === selectedId ? 0 : -1}" aria-controls="workspace">
        <span class="dot ${jobDot(j)}" aria-hidden="true"></span>
        <span class="tab-name">${esc(j.name)}</span>
        <span class="tab-meta mono">${jobMeta(j)}</span>
      </button>`,
    )
    .join('');
  updateExportBar();
}

els.tabs.addEventListener('click', (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>('[data-job]');
  if (!t) return;
  selectedId = Number(t.dataset.job);
  renderTabs();
  renderWorkspace();
});

els.tabs.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return;
  const i = jobs.findIndex((j) => j.id === selectedId);
  let n = i;
  if (e.key === 'ArrowRight') n = (i + 1) % jobs.length;
  if (e.key === 'ArrowLeft') n = (i - 1 + jobs.length) % jobs.length;
  if (e.key === 'Home') n = 0;
  if (e.key === 'End') n = jobs.length - 1;
  e.preventDefault();
  selectedId = jobs[n]!.id;
  renderTabs();
  renderWorkspace();
  document.getElementById(`tab-${selectedId}`)?.focus();
});

// ---------------------------------------------------------------- workspace ----

const FIELDS: Array<{ key: FieldKey; label: string; kind: 'text' | 'date' | 'money' | 'rate' | 'currency'; wide?: boolean }> = [
  { key: 'merchant', label: 'Merchant', kind: 'text', wide: true },
  { key: 'date', label: 'Date', kind: 'date' },
  { key: 'currency', label: 'Currency', kind: 'currency' },
  { key: 'subtotal', label: 'Subtotal', kind: 'money' },
  { key: 'vatRate', label: 'VAT %', kind: 'rate' },
  { key: 'vatAmount', label: 'VAT', kind: 'money' },
  { key: 'total', label: 'Total', kind: 'money' },
];

const fmtMoney = (n: number | null) => (n === null ? '' : n.toFixed(2));
const fmtQty = (n: number | null) => (n === null ? '' : String(Math.round(n * 1000) / 1000));

function lcClass(conf: number, hasValue: boolean): string {
  if (!hasValue) return '';
  if (conf < LC_LOW) return 'lc-low';
  if (conf < LC_MID) return 'lc-mid';
  return '';
}

function confLabel(conf: number, hasValue: boolean): string {
  if (!hasValue) return 'not found';
  if (conf >= 0.999) return 'exact';
  return `${Math.round(conf * 100)}%`;
}

function fieldDisplay(r: Receipt, key: FieldKey): string {
  const v = r[key].value;
  if (v === null) return '';
  if (key === 'subtotal' || key === 'vatAmount' || key === 'total') return fmtMoney(v as number);
  return String(v);
}

function renderWorkspace() {
  const job = selected();
  if (!job) {
    els.workspace.innerHTML = `<div class="empty" id="empty">
      <p class="display empty-title">Nothing read yet</p>
      <p>Pick a sample above, or drop your own receipt. The first photo takes a few seconds longer: the OCR engine and its English + Latvian models (about 7 MB) download once and are then cached.</p>
    </div>`;
    return;
  }

  const source = `<figure class="source" aria-label="Source document">
      <div class="source-head">
        <span class="k">Source</span>
        <span class="source-badges">${sourceBadges(job)}</span>
      </div>
      ${job.status === 'reading' || job.status === 'queued' ? progressHtml(job) : ''}
      <div class="pages" id="pages">
        ${
          job.pages.length
            ? job.pages
                .map(
                  (p, i) => `<div class="page" data-page="${i}">
                    <img src="${p.url}" width="${p.width}" height="${p.height}" alt="Page ${i + 1} of ${esc(job.name)}" />
                    <div class="overlay" style="transform: rotate(${p.rotation}rad)"><div class="hl"></div></div>
                    ${job.status === 'reading' ? '<div class="reading" aria-hidden="true"></div>' : ''}
                  </div>`,
                )
                .join('')
            : `<div class="empty" style="border:0;min-height:260px"><p>${job.status === 'error' ? 'No preview.' : 'Opening…'}</p></div>`
        }
      </div>
      ${job.extraction?.skippedPages ? `<p class="k">Only the first 5 pages were read; ${job.extraction.skippedPages} more were skipped.</p>` : ''}
    </figure>`;

  let data: string;
  if (job.status === 'error') {
    data = `<div class="data"><div class="error-box" role="alert">
        <p class="error-title">Could not read ${esc(job.name)}</p>
        <p>${esc(job.error ?? '')}</p>
        <p class="k">Nothing was sent anywhere — the failure happened in this browser.</p>
      </div></div>`;
  } else if (!job.receipt) {
    data = `<div class="data" aria-busy="true">
        <div class="data-head"><span class="label">Extracted</span></div>
        <div class="fields">${FIELDS.map((f) => `<div class="field${f.wide ? ' wide' : ''}"><label>${f.label}</label><div class="cell" style="color:var(--dim)">…</div></div>`).join('')}</div>
        <p class="k">Rows appear here as soon as the text is read.</p>
      </div>`;
  } else {
    data = dataHtml(job, job.receipt);
  }

  els.workspace.innerHTML = source + data;
  if (job.receipt) refreshChecks();
}

function sourceBadges(job: Job): string {
  const ex = job.extraction;
  if (!ex) return '';
  const method = { text: 'PDF text layer', ocr: 'OCR', mixed: 'Text layer + OCR' }[ex.method];
  const parts = [`<span class="badge">${method}</span>`];
  if (ex.ocrConfidence !== null) parts.push(`<span class="badge" title="Mean word confidence reported by Tesseract">OCR conf ${Math.round(ex.ocrConfidence * 100)}%</span>`);
  if (job.ms) parts.push(`<span class="badge">${(job.ms / 1000).toFixed(1)} s</span>`);
  return parts.join(' ');
}

function progressHtml(job: Job): string {
  const pct = job.progress === null ? null : Math.round(job.progress * 100);
  return `<div class="progress" id="progress" role="progressbar" aria-label="Reading ${esc(job.name)}"
      aria-valuemin="0" aria-valuemax="100" ${pct === null ? '' : `aria-valuenow="${pct}"`} aria-valuetext="${esc(job.stage)}">
      <div class="progress-row"><span class="progress-stage">${esc(job.status === 'queued' ? 'Waiting for the file ahead of it' : job.stage)}</span><span class="progress-pct mono">${pct === null ? '' : pct + '%'}</span></div>
      <div class="progress-track"><div class="progress-fill ${pct === null ? 'is-indeterminate' : ''}" style="width:${pct ?? 0}%"></div></div>
    </div>`;
}

function updateProgress(job: Job) {
  const tab = els.tabs.querySelector(`[data-job="${job.id}"] .tab-meta`);
  if (tab) tab.textContent = jobMeta(job);
  if (job.id !== selectedId) return;
  const bar = document.getElementById('progress');
  if (!bar) return;
  const pct = job.progress === null ? null : Math.round(job.progress * 100);
  bar.querySelector('.progress-stage')!.textContent = job.stage;
  bar.querySelector('.progress-pct')!.textContent = pct === null ? '' : `${pct}%`;
  bar.setAttribute('aria-valuetext', job.stage);
  if (pct === null) bar.removeAttribute('aria-valuenow');
  else bar.setAttribute('aria-valuenow', String(pct));
  const fill = bar.querySelector<HTMLElement>('.progress-fill')!;
  fill.classList.toggle('is-indeterminate', pct === null);
  fill.style.width = `${pct ?? 0}%`;
}

function dataHtml(job: Job, r: Receipt): string {
  const fields = FIELDS.map((f) => {
    const fld = r[f.key];
    const has = fld.value !== null;
    const cls = `${lcClass(fld.confidence, has)} ${f.key === 'total' && !has ? 'lc-low' : ''}`;
    const num = f.kind === 'money' || f.kind === 'rate';
    const placeholder = { text: 'not found', date: 'yyyy-mm-dd', money: '0.00', rate: '21', currency: 'EUR' }[f.kind];
    return `<div class="field${f.wide ? ' wide' : ''}">
        <label for="f-${f.key}">${f.label}<span class="conf" id="c-${f.key}">${confLabel(fld.confidence, has)}</span></label>
        <input class="cell ${num ? 'num' : ''} ${cls}" id="f-${f.key}" data-field="${f.key}" ${fld.line !== undefined ? `data-line="${fld.line}"` : ''}
          value="${esc(fieldDisplay(r, f.key))}" placeholder="${placeholder}" autocomplete="off" spellcheck="false"
          ${num ? 'inputmode="decimal"' : ''} />
      </div>`;
  }).join('');

  const rows = r.items.map((it, i) => itemRowHtml(it, i)).join('');
  return `<div class="data">
      <div class="data-head">
        <span class="label">Extracted — edit anything</span>
        <span class="legend" aria-label="Legend"><span><i class="sw-mid"></i>check this</span><span><i class="sw-low"></i>likely wrong</span></span>
      </div>
      <div class="fields">${fields}</div>
      <ul class="checks" id="checks" aria-live="polite"></ul>
      <div>
        <div class="items-wrap">
          <table class="items" aria-label="Line items">
            <thead><tr>
              <th class="col-n" scope="col">#</th>
              <th scope="col">Description</th>
              <th class="col-qty num" scope="col">Qty</th>
              <th class="col-money num" scope="col">Unit price</th>
              <th class="col-money num" scope="col">Line total</th>
              <th class="col-x" scope="col"><span class="sr-only">Remove</span></th>
            </tr></thead>
            <tbody id="rows">${rows || `<tr><td colspan="6" class="items-empty">No line items found. Add them by hand below.</td></tr>`}</tbody>
            <tfoot><tr>
              <td></td><td class="k">Items sum</td><td></td><td></td>
              <td class="sum mono" id="items-sum">${itemsSum(r).toFixed(2)}</td><td></td>
            </tr></tfoot>
          </table>
        </div>
        <div class="items-actions">
          <button type="button" class="btn btn-quiet" id="add-row">+ Add row</button>
        </div>
      </div>
      <details class="raw">
        <summary>What the reader saw (${job.extraction?.lines.length ?? 0} lines)</summary>
        <pre>${esc((job.extraction?.lines ?? []).map((l) => l.text).join('\n'))}</pre>
      </details>
    </div>`;
}

function itemRowHtml(it: LineItem, i: number): string {
  const cell = (key: ItemCell, value: string, num: boolean, label: string) =>
    `<input class="cell ${num ? 'num' : ''} ${lcClass(it.conf[key], value !== '')}" data-row="${i}" data-cell="${key}"
      ${it.line !== undefined ? `data-line="${it.line}"` : ''} value="${esc(value)}" aria-label="${label}, row ${i + 1}"
      autocomplete="off" spellcheck="false" ${num ? 'inputmode="decimal"' : ''} />`;
  return `<tr data-row="${i}">
      <td class="col-n mono">${i + 1}</td>
      <td>${cell('description', it.description, false, 'Description')}</td>
      <td class="col-qty">${cell('qty', fmtQty(it.qty), true, 'Quantity')}</td>
      <td class="col-money">${cell('unitPrice', fmtMoney(it.unitPrice), true, 'Unit price')}</td>
      <td class="col-money">${cell('total', fmtMoney(it.total), true, 'Line total')}</td>
      <td class="col-x"><button type="button" class="row-del" data-del="${i}" aria-label="Remove row ${i + 1}">×</button></td>
    </tr>`;
}

function refreshChecks() {
  const job = selected();
  const r = job?.receipt;
  if (!r) return;
  const ul = document.getElementById('checks');
  if (ul) {
    const icon = { ok: '✓', warn: '!', info: 'i' };
    ul.innerHTML = validate(r)
      .map((c) => `<li class="check ${c.level}"><span class="check-i mono" aria-hidden="true">${icon[c.level]}</span><span>${esc(c.message)}</span></li>`)
      .join('');
  }
  const sum = document.getElementById('items-sum');
  if (sum) sum.textContent = itemsSum(r).toFixed(2);
  const dot = els.tabs.querySelector(`[data-job="${job!.id}"] .dot`);
  if (dot) dot.className = `dot ${jobDot(job!)}`;
  const meta = els.tabs.querySelector(`[data-job="${job!.id}"] .tab-meta`);
  if (meta) meta.textContent = jobMeta(job!);
  updateExportBar();
}

// ------------------------------------------------------------------ editing ----

/** Parse what a person typed. undefined = not valid (yet); null = deliberately empty. */
function parseField(key: FieldKey, raw: string): string | number | null | undefined {
  const s = raw.trim();
  if (!s) return null;
  switch (key) {
    case 'merchant':
      return s;
    case 'date':
      return parseDate(s) ?? undefined;
    case 'currency':
      return /^[a-z]{3}$/i.test(s) ? s.toUpperCase() : s === '€' ? 'EUR' : s === '$' ? 'USD' : s === '£' ? 'GBP' : undefined;
    case 'vatRate': {
      const n = parseNumber(s.replace('%', ''));
      return n !== null && n >= 0 && n < 100 ? n : undefined;
    }
    default: {
      const n = parseNumber(s);
      return n === null ? undefined : Math.round(n * 100) / 100;
    }
  }
}

function parseCell(key: ItemCell, raw: string): string | number | null | undefined {
  const s = raw.trim();
  if (key === 'description') return s;
  if (!s) return null;
  const n = parseNumber(s);
  if (n === null) return undefined;
  return key === 'qty' ? Math.round(n * 1000) / 1000 : Math.round(n * 100) / 100;
}

els.workspace.addEventListener('input', (e) => {
  const input = e.target as HTMLInputElement;
  const r = selected()?.receipt;
  if (!r || !(input instanceof HTMLInputElement)) return;
  if (input.dataset.field) {
    const key = input.dataset.field as FieldKey;
    const v = parseField(key, input.value);
    input.classList.toggle('is-bad', v === undefined);
    if (v === undefined) return;
    (r[key] as { value: unknown; confidence: number }).value = v;
    r[key].confidence = 1;
    input.classList.remove('lc-mid', 'lc-low');
    const c = document.getElementById(`c-${key}`);
    if (c) c.textContent = v === null ? 'not found' : 'edited';
  } else if (input.dataset.cell) {
    const i = Number(input.dataset.row);
    const key = input.dataset.cell as ItemCell;
    const it = r.items[i];
    if (!it) return;
    const v = parseCell(key, input.value);
    input.classList.toggle('is-bad', v === undefined);
    if (v === undefined) return;
    (it as unknown as Record<string, unknown>)[key] = v;
    it.conf[key] = 1;
    input.classList.remove('lc-mid', 'lc-low');
  }
  refreshChecks();
});

// Normalise the display once the person leaves the cell: "12,5" becomes "12.50".
els.workspace.addEventListener('change', (e) => {
  const input = e.target as HTMLInputElement;
  const r = selected()?.receipt;
  if (!r || !(input instanceof HTMLInputElement) || input.classList.contains('is-bad')) return;
  if (input.dataset.field) input.value = fieldDisplay(r, input.dataset.field as FieldKey);
  if (input.dataset.cell) {
    const it = r.items[Number(input.dataset.row)];
    if (!it) return;
    const key = input.dataset.cell as ItemCell;
    input.value = key === 'description' ? it.description : key === 'qty' ? fmtQty(it.qty) : fmtMoney(it[key]);
  }
});

els.workspace.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  const job = selected();
  const r = job?.receipt;
  if (!r) return;
  const del = t.closest<HTMLElement>('[data-del]');
  if (del) {
    r.items.splice(Number(del.dataset.del), 1);
    rerenderData(job!);
    const rows = document.querySelectorAll<HTMLElement>('.row-del');
    (rows[Math.min(Number(del.dataset.del), rows.length - 1)] ?? document.getElementById('add-row'))?.focus();
    return;
  }
  if (t.closest('#add-row')) {
    r.items.push({ description: '', qty: 1, unitPrice: null, total: null, conf: { description: 1, qty: 1, unitPrice: 1, total: 1 } });
    rerenderData(job!);
    document.querySelector<HTMLInputElement>(`[data-row="${r.items.length - 1}"][data-cell="description"]`)?.focus();
  }
});

function rerenderData(job: Job) {
  const data = els.workspace.querySelector('.data');
  if (!data || !job.receipt) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = dataHtml(job, job.receipt);
  data.replaceWith(tmp.firstElementChild!);
  refreshChecks();
}

// ---------------------------------------------------- source highlighting ----

function highlight(lineIdx: number | null) {
  const job = selected();
  const pagesEl = document.getElementById('pages');
  if (!job?.extraction || !pagesEl) return;
  pagesEl.querySelectorAll('.hl.on').forEach((h) => h.classList.remove('on'));
  if (lineIdx === null) return;
  const line = job.extraction.lines[lineIdx];
  if (!line?.box) return;
  const page = pagesEl.querySelector<HTMLElement>(`.page[data-page="${line.page}"]`);
  const hl = page?.querySelector<HTMLElement>('.hl');
  if (!page || !hl) return;
  const pad = 0.004;
  Object.assign(hl.style, {
    left: `${(line.box.x0 - pad) * 100}%`,
    top: `${(line.box.y0 - pad) * 100}%`,
    width: `${(line.box.x1 - line.box.x0 + 2 * pad) * 100}%`,
    height: `${(line.box.y1 - line.box.y0 + 2 * pad) * 100}%`,
  });
  hl.classList.add('on');
  // bring it into view inside the scrolling source column, without moving the page
  const top = page.offsetTop + line.box.y0 * page.offsetHeight;
  const bottom = page.offsetTop + line.box.y1 * page.offsetHeight;
  if (top < pagesEl.scrollTop || bottom > pagesEl.scrollTop + pagesEl.clientHeight) {
    pagesEl.scrollTo({ top: Math.max(0, top - pagesEl.clientHeight / 3), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
}

const lineOf = (t: EventTarget | null) => {
  const el = (t as HTMLElement | null)?.closest?.('[data-line]') as HTMLElement | null;
  return el ? Number(el.dataset.line) : null;
};
els.workspace.addEventListener('focusin', (e) => highlight(lineOf(e.target)));
els.workspace.addEventListener('focusout', () => highlight(null));
els.workspace.addEventListener('mouseover', (e) => {
  if (document.activeElement?.closest?.('.data [data-line]')) return;
  highlight(lineOf(e.target));
});
els.workspace.addEventListener('mouseleave', () => {
  if (!document.activeElement?.closest?.('.data [data-line]')) highlight(null);
});

// ------------------------------------------------------------------- export ----

function doneDocs(): Doc[] {
  return jobs.filter((j) => j.status === 'done' && j.receipt).map((j) => ({ name: j.name, receipt: j.receipt! }));
}

function updateExportBar() {
  const docs = doneDocs();
  const rows = docs.reduce((n, d) => n + d.receipt.items.length, 0);
  els.exportCount.textContent = docs.length ? `${docs.length} doc${docs.length === 1 ? '' : 's'} · ${rows} rows` : 'nothing to export yet';
  els.exports.querySelectorAll('button').forEach((b) => ((b as HTMLButtonElement).disabled = docs.length === 0));
}

function download(data: BlobPart, type: string, name: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

els.exports.addEventListener('click', async (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-export]');
  if (!btn || btn.disabled) return;
  const docs = doneDocs();
  if (!docs.length) return;
  const stamp = new Date().toISOString().slice(0, 10);
  const kind = btn.dataset.export;
  if (kind === 'csv') download(toCSV(itemsTable(docs)), 'text/csv;charset=utf-8', `receipts-${stamp}.csv`);
  if (kind === 'json') download(toJSON(docs), 'application/json', `receipts-${stamp}.json`);
  if (kind === 'xlsx')
    download(
      toXLSX([itemsTable(docs), receiptsTable(docs)]) as Uint8Array<ArrayBuffer>,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      `receipts-${stamp}.xlsx`,
    );
  if (kind === 'tsv') {
    const t = itemsTable(docs);
    const ok = await copyText(toTSV(t));
    const label = btn.textContent;
    btn.textContent = ok ? `Copied ${t.rows.length} rows` : 'Copy failed';
    announce(ok ? `Copied ${t.rows.length} rows. Paste into Google Sheets or Excel.` : 'Copying to the clipboard failed.');
    setTimeout(() => (btn.textContent = label), 1800);
  }
});

// -------------------------------------------------------------- wiring up ----

els.samples.innerHTML = SAMPLES.map(
  (s, i) => `<li><button type="button" class="sample" data-sample="${i}" aria-label="Try sample: ${s.title}, ${s.tag}">
      <span class="sample-thumb"><span class="sample-n">${String(i + 1).padStart(2, '0')}</span>
        <img src="${BASE}samples/${s.file.replace(/\.\w+$/, '')}.thumb.jpg" alt="" width="240" height="180" loading="lazy" /></span>
      <span class="sample-t">${s.title}</span>
      <span class="sample-k">${s.tag}</span>
    </button></li>`,
).join('');

els.samples.addEventListener('click', async (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-sample]');
  if (!btn) return;
  const s = SAMPLES[Number(btn.dataset.sample)]!;
  const existing = jobs.find((j) => j.name === s.file && j.status !== 'error');
  if (existing) {
    selectedId = existing.id;
    renderTabs();
    renderWorkspace();
    return;
  }
  btn.setAttribute('aria-busy', 'true');
  try {
    const res = await fetch(`${BASE}samples/${s.file}`);
    if (!res.ok) throw new Error(String(res.status));
    addFiles([new File([await res.blob()], s.file, { type: s.type })]);
  } catch {
    announce('The sample could not be loaded. Check your connection and try again.');
  } finally {
    btn.removeAttribute('aria-busy');
  }
});

els.pick.addEventListener('click', () => els.file.click());
els.file.addEventListener('change', () => {
  if (els.file.files) addFiles(els.file.files);
  els.file.value = '';
});

// The whole window is a drop target; the zone lights up to say so.
let dragDepth = 0;
const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files');
window.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  dragDepth++;
  els.drop.classList.add('is-over');
});
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) els.drop.classList.remove('is-over');
});
window.addEventListener('dragover', (e) => {
  if (hasFiles(e)) e.preventDefault();
});
window.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  els.drop.classList.remove('is-over');
  if (e.dataTransfer?.files.length) addFiles(e.dataTransfer.files);
});

window.addEventListener('paste', (e) => {
  const target = e.target as HTMLElement;
  if (target.closest('input, textarea')) return;
  const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/') || f.type === 'application/pdf');
  if (files.length) addFiles(files);
});

// Start fetching the OCR engine the moment someone shows intent to use it, so the first
// photo does not wait on 7 MB it could have been downloading already.
let warmed = false;
const warm = () => {
  if (warmed) return;
  warmed = true;
  void import('./engine/ocr').then((m) => m.preloadOcr());
};
els.drop.addEventListener('pointerenter', warm, { once: true });
els.drop.addEventListener('focusin', warm, { once: true });
els.samples.querySelectorAll('[data-sample="0"], [data-sample="2"], [data-sample="3"]').forEach((b) => {
  b.addEventListener('pointerenter', warm, { once: true });
  b.addEventListener('focus', warm, { once: true });
});

updateExportBar();
