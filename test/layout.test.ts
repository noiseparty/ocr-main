import { describe, expect, it } from 'vitest';
import { buildLines, type Fragment, type Group } from '../src/lib/layout';

// A word at (x, y) on a 1x1 page, 0.02 tall, 0.012 per character.
const word = (text: string, x: number, y: number, conf = 1): Fragment => ({
  text,
  conf,
  box: { x0: x, y0: y, x1: x + text.length * 0.012, y1: y + 0.02 },
});
const group = (...words: Fragment[]): Group => ({ page: 0, words });

describe('buildLines', () => {
  it('re-joins a table row that segmentation cut into two blocks', () => {
    const lines = buildLines([
      group(word('Priedes', 0.05, 0.3), word('dēlis', 0.15, 0.3)),
      group(word('Skrūves', 0.05, 0.33)),
      // the prices came back as a separate block, listed after all the descriptions
      group(word('126,00', 0.8, 0.301)),
      group(word('23,40', 0.8, 0.331)),
    ]);
    expect(lines.map((l) => l.text)).toEqual(['Priedes dēlis   126,00', 'Skrūves   23,40']);
  });

  it('splits two header columns that share a baseline', () => {
    const lines = buildLines([
      group(word('Northwind', 0.05, 0.05), word('Studio', 0.18, 0.05)),
      group(word('INVOICE', 0.8, 0.05)),
    ]);
    expect(lines.map((l) => l.text)).toEqual(['Northwind Studio', 'INVOICE']);
  });

  it('keeps a label and its figure together however far apart', () => {
    const lines = buildLines([group(word('Subtotal', 0.5, 0.7)), group(word('2,530.00', 0.85, 0.7))]);
    expect(lines.map((l) => l.text)).toEqual(['Subtotal   2,530.00']);
  });

  it('does not merge a line with the one below it', () => {
    const lines = buildLines([group(word('One', 0.1, 0.1)), group(word('Two', 0.1, 0.125))]);
    expect(lines).toHaveLength(2);
  });

  it('orders rows top to bottom and pages in sequence', () => {
    const lines = buildLines([
      { page: 1, words: [word('second-page', 0.1, 0.1)] },
      { page: 0, words: [word('bottom', 0.1, 0.9)] },
      { page: 0, words: [word('top', 0.1, 0.1)] },
    ]);
    expect(lines.map((l) => l.text)).toEqual(['top', 'bottom', 'second-page']);
  });

  it('weights confidence by characters and unions the boxes', () => {
    const [line] = buildLines([group(word('aaaa', 0.1, 0.1, 1), word('b', 0.2, 0.1, 0))]);
    expect(line!.conf).toBeCloseTo(0.8);
    expect(line!.box!.x0).toBeCloseTo(0.1);
    expect(line!.box!.x1).toBeCloseTo(0.212);
  });
});
