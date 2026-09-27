import { describe, expect, it } from 'vitest';
import { findDates, parseDate } from '../src/lib/dates';

describe('dates', () => {
  it.each([
    ['28.09.2026', '2026-09-28'],
    ['28.09.26', '2026-09-28'],
    ['28-09-2026', '2026-09-28'],
    ['2026-09-28', '2026-09-28'],
    ['2026.09.28', '2026-09-28'],
    ['03/04/2026', '2026-04-03'], // EU-first when ambiguous
    ['27/09/2026', '2026-09-27'],
    ['09/27/2026', '2026-09-27'], // US only when day-first is impossible
    ['12 Sep 2026', '2026-09-12'],
    ['12 September, 2026', '2026-09-12'],
    ['September 12, 2026', '2026-09-12'],
    ['Sep 12th 2026', '2026-09-12'],
    ['2026. gada 3. septembrī', '2026-09-03'],
    ['2026. g. 15. martā', '2026-03-15'],
    ['3. septembris 2026', '2026-09-03'],
    ['12. marts 2026', '2026-03-12'],
  ])('%s → %s', (input, iso) => {
    expect(parseDate(input)).toBe(iso);
  });

  it('rejects impossible dates', () => {
    expect(parseDate('31.02.2026')).toBeNull();
    expect(parseDate('45.13.2026')).toBeNull();
  });

  it('finds a date among other text, not the time beside it', () => {
    const hits = findDates('Datums: 28.09.2026 14:32  Kase 2');
    expect(hits.map((h) => h.iso)).toEqual(['2026-09-28']);
  });

  it('marks an ambiguous slash date as less certain', () => {
    const [amb] = findDates('03/04/2026');
    const [clear] = findDates('03.04.2026');
    expect(amb!.certainty).toBeLessThan(clear!.certainty);
  });
});
