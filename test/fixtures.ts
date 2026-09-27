// The text of the four shipped samples, as a perfect reader would see it. The sample
// generator (scripts/make-samples.mjs) renders these same documents, so a regression here
// is a regression on the demo page.

import type { SourceLine } from '../src/lib/types';

export const lines = (text: string, conf = 1): SourceLine[] =>
  text
    .split('\n')
    .map((t) => t.trimEnd())
    .filter((t) => t.trim().length > 0)
    .map((t) => ({ text: t, conf, page: 0 }));

export const LV_RECEIPT = `
SIA "Daugavas Bode"
Brīvības iela 88, Rīga, LV-1001
PVN reģ. Nr. LV40003123456
Kase 2          Čeks Nr. 004821
28.09.2026                 14:32
--------------------------------
Rudzu maize "Rīga"        1,89 A
Piens 2,5% 1L
  2 gab x 0,99            1,98 A
Banāni
  0,845 kg x 1,49 EUR/kg  1,26 A
Kafija malta 250g         4,59 A
Siers Holandes 1 gab 3,29 3,29 A
Atlaide Kafija           -0,60 A
Maisiņš                   0,05 A
--------------------------------
KOPĀ EUR                 12,46
Samaksāts: Karte         12,46
--------------------------------
PVN     Bez PVN   PVN   Ar PVN
A 21%   10,30     2,16  12,46
--------------------------------
     Paldies par pirkumu!
`;

export const EN_INVOICE = `
Northwind Studio SIA
Elizabetes iela 21, Riga, LV-1010
VAT reg. no. LV40103999999
INVOICE
Invoice number: INV-2026-0142
Invoice date: 12 Sep 2026
Due date: 12 Oct 2026
Bill to:
Baltic Freight SIA
Krasta iela 42, Riga, LV-1003
Description   Qty   Unit price   Amount
Brand workshop (half day)   1   850.00   850.00
Landing page design   1   1,200.00   1,200.00
Illustration set   6   45.00   270.00
Copy editing (hours)   3.5   60.00   210.00
Subtotal   2,530.00
VAT 21%   531.30
Total due (EUR)   €3,061.30
Payment: bank transfer to IBAN LV12HABA0551234567890
`;

export const CAFE_RECEIPT = `
KAFEJNICA ZIEDONIS
Ziedoņa dārzs, Rīga
27/09/2026   09:41   Galds 4
2 Flat white           7.00
1 Croissant            2.80
Cardamom bun 2 x 3.20  6.40
Orange juice 0.3L      3.50
Water still            1.90
TOTAL EUR             21.60
incl. VAT 21%          3.75
CARD                  21.60
Thank you, see you soon!
`;

export const LV_INVOICE = `
SIA "Kurzemes Koks"
Reģ. Nr. 40003987654, PVN Nr. LV40003987654
Rūpniecības iela 5, Ventspils, LV-3601
RĒĶINS Nr. KK-2026/0917
Ventspilī, 2026. gada 3. septembrī
Pircējs: SIA "Baltic Freight"
Nosaukums   Daudz.   Mērv.   Cena   Summa
Priedes dēlis 25x100   40   gab   3,15   126,00
Skrūves 4x50 (200 gab)   3   iep.   7,80   23,40
Piegāde   1   gab.   25,00   25,00
Kopā bez PVN   174,40
PVN 21%   36,62
Kopā apmaksai EUR   211,02
Apmaksāt līdz: 17.09.2026
`;
