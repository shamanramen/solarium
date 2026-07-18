/**
 * Geocentric ecliptic longitudes at instant t.
 * Client-only via astronomy-engine — no backend.
 */
import * as Astro from 'astronomy-engine';
import { ASPECT_BODIES, type BodyId } from './catalog';

export interface Sample {
  id: BodyId;
  label: string;
  /** degrees [0, 360) */
  lon: number;
  lat: number;
  distAu: number;
  frame: 'geocentric';
}

const ENG: Record<string, Astro.Body> = {
  Sun: Astro.Body.Sun,
  Mercury: Astro.Body.Mercury,
  Venus: Astro.Body.Venus,
  Mars: Astro.Body.Mars,
  Jupiter: Astro.Body.Jupiter,
  Saturn: Astro.Body.Saturn,
  Uranus: Astro.Body.Uranus,
  Neptune: Astro.Body.Neptune,
};

function wrap360(deg: number): number {
  const x = deg % 360;
  return x < 0 ? x + 360 : x;
}

export function positionsAt(when: Date): Sample[] {
  const t = Astro.MakeTime(when);
  const out: Sample[] = [];

  for (const body of ASPECT_BODIES) {
    if (!body.eng) continue;
    const engBody = ENG[body.eng];
    if (engBody === undefined) continue;

    const vec = Astro.GeoVector(engBody, t, true);
    const ecl = Astro.Ecliptic(vec);
    out.push({
      id: body.id,
      label: body.label,
      lon: wrap360(ecl.elon),
      lat: ecl.elat,
      distAu: vec.Length(),
      frame: 'geocentric',
    });
  }

  return out;
}
