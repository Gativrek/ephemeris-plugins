import { describe, expect, it } from 'vitest';
import { nearest } from './figure';
import { fixed, linear, log } from './scale';

describe('the nearest sample', () => {
  it('binary-searches sorted positions and scans the rest', () => {
    const px = [0, 10, 20, 30, 40];
    expect(nearest(px, 14, true)).toBe(1);
    expect(nearest(px, 16, true)).toBe(2);
    expect(nearest(px, -5, true)).toBe(0);
    expect(nearest(px, 99, true)).toBe(4);
    expect(nearest([30, 0, 20], 22, false)).toBe(2);
  });
});

describe('scales', () => {
  it('round linear domains out to ticks; fixed ones keep the data range', () => {
    expect(linear(0.3, 9.2, 0, 100).domain).toEqual([0, 10]);
    expect(fixed(0.3, 9.2, 0, 100).domain).toEqual([0.3, 9.2]);
    expect(log(0.5, 300, 0, 100).domain).toEqual([0.1, 1000]);
  });
});
