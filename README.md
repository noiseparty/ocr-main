# Receipt Reader — Cosmic demo 01

Receipts and invoices to spreadsheet rows. Drop a PDF or a photo, or pick one of four
samples, and get the merchant, date, currency, subtotal, VAT, total and every line item,
cross-checked against each other. Every cell can be edited. Export goes to XLSX, CSV or
JSON, or you can copy TSV to paste into Sheets or Excel. Several files at once end up in
one combined sheet.

Live at `https://www.skabene.id.lv/demo/ocr/`.

**Everything runs in the browser.** PDFs with a text layer are read by pdf.js. Scans and
photos are read by Tesseract (WebAssembly, LSTM, English + Latvian models). All of these
files are served from this app's own origin, and nothing comes from a CDN. The server
serves static files and a health check. It has no upload endpoint, so a document cannot
reach it. There are no AI or LLM calls and no analytics.

## How it works

| Step | Where |
|---|---|
| Read: pdf.js text layer, or render the page and run tesseract.js on it | `src/engine/` |
| Rebuild rows from word geometry (re-join split tables, split header columns) | `src/lib/layout.ts` |
| Deterministic parse: totals block first, then the item lines above it | `src/lib/parse.ts`, `money.ts`, `dates.ts` |
| Cross-checks: items vs total, subtotal + VAT vs total, VAT vs rate | `src/lib/validate.ts` |
| Export: CSV / TSV / JSON / XLSX (a ~100-line writer, stored zip) | `src/lib/export.ts`, `zip.ts` |
| Server: `node:http`, static files + `/healthz`, per-IP token bucket, in-flight cap | `server/` |

The parser handles EU-first dates (`28.09.2026`, `2026. gada 3. septembrī`, `12 Sep 2026`,
US only when day-first is impossible), comma or dot decimals, thousands in either
convention, `2 x 1,50`, `2 gab`, `0,845 kg x 1,49 EUR/kg`, trailing column tables,
two-line items, discounts, unlabelled VAT table rows and PVN/VAT registration numbers.
Each field gets a confidence value. Agreement between independent readings raises it, and
low-confidence cells are highlighted in the UI.

## Run locally

Requires Node 22 and pnpm 10.

```bash
pnpm install
pnpm dev            # http://localhost:5173/demo/ocr/  (proxies /theme.css to the live site)
pnpm test           # vitest: parser, dates, money, layout, exports, rate limiter
pnpm typecheck
```

## Build and run the production server

```bash
pnpm build                          # copies vendor runtimes, typechecks, bundles, compiles the server
PORT=3101 node build/server/index.js
# http://127.0.0.1:3101/demo/ocr/   (GET / redirects there; /demo/ocr/healthz → "ok")

pnpm e2e                            # optional: drives an installed Edge/Chrome through all four samples
```

`pnpm e2e` (`scripts/e2e.mjs`) needs the server running. It reads all four samples, checks
the fields it extracts, edits a cell, exports, and fails if any request leaves the origin.
Screenshots go to `test-results/`.

`/theme.css` comes from the portfolio shell on the same origin in production. When run
standalone it returns 404, and the page falls back to its own tokens.

## Samples

`public/samples/` is committed. Regenerate it with `pnpm samples`
(`scripts/make-samples.mjs`, @napi-rs/canvas, and the Windows fonts Consolas and Arial; set
`FONT_DIR` elsewhere). There are four samples: a Latvian shop receipt (PNG), an English
invoice (born-digital PDF with a text layer), a café receipt photographed skewed and grainy
(JPG), and a Latvian invoice scanned to an image-only PDF. All businesses and numbers are
invented.

## Deploy (VPS)

```bash
docker compose up -d --build        # builds, publishes 127.0.0.1:3101 only
```

- The image has two stages. The final stage holds no `node_modules`, only `dist/` (about
  23 MB, mostly the OCR core and models) and the compiled server. It runs as `node`,
  read-only, with a healthcheck on `/demo/ocr/healthz`.
- Caddy must pass the full path through, with no prefix stripping, and must sit outside
  `forward_auth`. For example, add this inside the `www.skabene.id.lv` block, before the
  shell's catch-all:

  ```
  handle /demo/ocr/* {
      reverse_proxy 127.0.0.1:3101
  }
  ```

  The rate limiter keys on the first `X-Forwarded-For` entry. The www block already strips
  client-supplied values, so that entry is the real remote address.
- The port is published on loopback only. Never use `"3101:3101"`, because Docker bypasses
  ufw.
