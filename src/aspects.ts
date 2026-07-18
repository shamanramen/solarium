/** Classical major aspects from ecliptic longitudes. Pure functions only. */

import type { Sample } from './positions';
import { positionsAt, addDays } from './positions';

export type Kind = 'conjunction' | 'sextile' | 'square' | 'trine' | 'opposition';
export type Motion = 'applying' | 'separating' | 'exact';

export interface KindSpec {
  kind: Kind;
  degrees: number;
  orb: number;
  label: string;
  color: string;
}

export const KINDS: KindSpec[] = [
  { kind: 'conjunction', degrees: 0, orb: 6, label: 'Conjunction', color: '#f0e4ce' },
  { kind: 'sextile', degrees: 60, orb: 6, label: 'Sextile', color: '#5cb8b0' },
  { kind: 'square', degrees: 90, orb: 6, label: 'Square', color: '#d4784a' },
  { kind: 'trine', degrees: 120, orb: 6, label: 'Trine', color: '#8fb86a' },
  { kind: 'opposition', degrees: 180, orb: 6, label: 'Opposition', color: '#8aa0b8' },
];

export interface Hit {
  kind: Kind;
  aId: string;
  bId: string;
  aLabel: string;
  bLabel: string;
  separation: number;
  orb: number;
  tightness: number;
  motion: Motion;
}

export function shortestArc(a: number, b: number): number {
  let d = Math.abs(a - b) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

function lonOf(samples: Sample[], id: string): number | null {
  const s = samples.find((x) => x.id === id);
  return s ? s.lon : null;
}

export function findAspects(
  samples: Sample[],
  enabled: ReadonlySet<Kind>,
  when?: Date,
): Hit[] {
  const active = KINDS.filter((k) => enabled.has(k.kind));
  const hits: Hit[] = [];
  const future = when ? positionsAt(addDays(when, 1)) : null;

  for (let i = 0; i < samples.length; i++) {
    for (let j = i + 1; j < samples.length; j++) {
      const a = samples[i];
      const b = samples[j];
      const sep = shortestArc(a.lon, b.lon);

      for (const spec of active) {
        const orb = Math.abs(sep - spec.degrees);
        if (orb <= spec.orb) {
          let motion: Motion = 'exact';
          if (future) {
            const fa = lonOf(future, a.id);
            const fb = lonOf(future, b.id);
            if (fa !== null && fb !== null) {
              const nextSep = shortestArc(fa, fb);
              const nextOrb = Math.abs(nextSep - spec.degrees);
              if (nextOrb < orb - 0.01) motion = 'applying';
              else if (nextOrb > orb + 0.01) motion = 'separating';
              else motion = 'exact';
            }
          }

          hits.push({
            kind: spec.kind,
            aId: a.id,
            bId: b.id,
            aLabel: a.label,
            bLabel: b.label,
            separation: sep,
            orb,
            tightness: 1 - orb / spec.orb,
            motion,
          });
        }
      }
    }
  }

  hits.sort((x, y) => x.orb - y.orb);
  return hits;
}

export function colorFor(kind: Kind): string {
  return KINDS.find((k) => k.kind === kind)?.color ?? '#ccc';
}
