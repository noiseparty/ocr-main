import { describe, expect, it } from 'vitest';
import type { IncomingMessage } from 'node:http';
import { clientIp, TokenBuckets } from '../server/limits';

describe('TokenBuckets', () => {
  it('allows a burst, then asks the caller to wait', () => {
    const b = new TokenBuckets(3, 1);
    const t = 1_000_000;
    expect([b.take('a', t), b.take('a', t), b.take('a', t)]).toEqual([0, 0, 0]);
    expect(b.take('a', t)).toBe(1);
  });

  it('refills over time', () => {
    const b = new TokenBuckets(2, 2);
    const t = 1_000_000;
    b.take('a', t);
    b.take('a', t);
    expect(b.take('a', t)).toBeGreaterThan(0);
    expect(b.take('a', t + 600)).toBe(0);
  });

  it('keeps addresses apart', () => {
    const b = new TokenBuckets(1, 1);
    expect(b.take('a', 0)).toBe(0);
    expect(b.take('b', 0)).toBe(0);
    expect(b.take('a', 0)).toBe(1);
  });

  it('forgets idle addresses and stays bounded', () => {
    const b = new TokenBuckets(1, 1, 100);
    for (let i = 0; i < 100; i++) b.take(`ip${i}`, 0);
    b.take('late', 10);
    expect(b.size).toBeLessThanOrEqual(100);
    b.sweep(60_000);
    expect(b.size).toBe(0);
  });
});

describe('clientIp', () => {
  const req = (xff: string | undefined, socket = '10.0.0.9') =>
    ({ headers: xff === undefined ? {} : { 'x-forwarded-for': xff }, socket: { remoteAddress: socket } }) as unknown as IncomingMessage;

  it('takes the first X-Forwarded-For entry', () => {
    expect(clientIp(req('203.0.113.7, 10.0.0.1'))).toBe('203.0.113.7');
  });
  it('falls back to the socket', () => {
    expect(clientIp(req(undefined))).toBe('10.0.0.9');
    expect(clientIp(req(''))).toBe('10.0.0.9');
  });
});
