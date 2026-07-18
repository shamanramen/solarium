import { describe, expect, it } from 'vitest';
import { findAspects, shortestArc } from './aspects';
import type { Sample } from './positions';

function s(id: string, label: string, lon: number): Sample {
  return {
    id: id as Sample['id'],
    label,
    lon,
    lat: 0,
    distAu: 1,
    frame: 'geocentric',
  };
}

describe('shortestArc', () => {
  it('wraps across 0°', () => {
    expect(shortestArc(350, 10)).toBeCloseTo(20);
  });
  it('caps at 180', () => {
    expect(shortestArc(0, 180)).toBeCloseTo(180);
  });
});

describe('findAspects', () => {
  it('detects a perfect square', () => {
    const hits = findAspects(
      [s('mars', 'Mars', 10), s('saturn', 'Saturn', 100)],
      new Set(['square']),
    );
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('square');
    expect(hits[0].orb).toBeCloseTo(0);
  });

  it('respects orb and filter', () => {
    const pair = [s('mars', 'Mars', 0), s('saturn', 'Saturn', 90)];
    expect(findAspects(pair, new Set(['trine']))).toHaveLength(0);
    expect(findAspects(pair, new Set(['square']))).toHaveLength(1);
  });

  it('detects trine', () => {
    const hits = findAspects(
      [s('sun', 'Sun', 0), s('jupiter', 'Jupiter', 120)],
      new Set(['trine']),
    );
    expect(hits).toHaveLength(1);
  });
});
