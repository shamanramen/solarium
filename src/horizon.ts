/**
 * Local horizontal sky (alt/az) for an observer standing on Earth.
 * Uses astronomy-engine Equator + Horizon.
 */
import * as Astro from 'astronomy-engine';
import { ASPECT_BODIES, type BodyId } from './catalog';

export interface GeoObserver {
  /** Degrees north. */
  lat: number;
  /** Degrees east (west negative). */
  lon: number;
  /** Meters above sea level. */
  heightM: number;
}

export interface HorizonSample {
  id: BodyId;
  label: string;
  /** Altitude degrees (−90..+90). 0 = horizon, +90 = zenith. */
  alt: number;
  /** Azimuth degrees, clockwise from north (0=N, 90=E, 180=S, 270=W). */
  az: number;
  /** Geocentric ecliptic lon (for labels / aspects). */
  lon: number;
  lat: number;
  distAu: number;
  aboveHorizon: boolean;
}

const ENG: Record<string, Astro.Body> = {
  Sun: Astro.Body.Sun,
  Moon: Astro.Body.Moon,
  Mercury: Astro.Body.Mercury,
  Venus: Astro.Body.Venus,
  Mars: Astro.Body.Mars,
  Jupiter: Astro.Body.Jupiter,
  Saturn: Astro.Body.Saturn,
  Uranus: Astro.Body.Uranus,
  Neptune: Astro.Body.Neptune,
  Pluto: Astro.Body.Pluto,
};

function wrap360(deg: number): number {
  const x = deg % 360;
  return x < 0 ? x + 360 : x;
}

/** Default: Austin, TX (Chad-adjacent). */
export const DEFAULT_OBSERVER: GeoObserver = {
  lat: 30.27,
  lon: -97.74,
  heightM: 150,
};

export const PRESETS: { id: string; label: string; observer: GeoObserver }[] = [
  { id: 'austin', label: 'Austin', observer: { lat: 30.27, lon: -97.74, heightM: 150 } },
  { id: 'nyc', label: 'New York', observer: { lat: 40.71, lon: -74.01, heightM: 10 } },
  { id: 'london', label: 'London', observer: { lat: 51.51, lon: -0.13, heightM: 20 } },
  { id: 'tokyo', label: 'Tokyo', observer: { lat: 35.68, lon: 139.69, heightM: 40 } },
  { id: 'sydney', label: 'Sydney', observer: { lat: -33.87, lon: 151.21, heightM: 20 } },
];

/**
 * Horizontal positions for aspectable bodies as seen by `observer` at `when`.
 */
export function horizonAt(when: Date, observer: GeoObserver): HorizonSample[] {
  const t = Astro.MakeTime(when);
  const obs = new Astro.Observer(observer.lat, observer.lon, observer.heightM);
  const out: HorizonSample[] = [];

  for (const body of ASPECT_BODIES) {
    if (!body.eng) continue;
    const engBody = ENG[body.eng];
    if (engBody === undefined) continue;

    // ofdate=true, aberration=true — apparent place for the sky
    const eq = Astro.Equator(engBody, t, obs, true, true);
    const hor = Astro.Horizon(t, obs, eq.ra, eq.dec, 'normal');

    const vec = Astro.GeoVector(engBody, t, true);
    const ecl = Astro.Ecliptic(vec);

    out.push({
      id: body.id,
      label: body.label,
      alt: hor.altitude,
      az: hor.azimuth,
      lon: wrap360(ecl.elon),
      lat: ecl.elat,
      distAu: vec.Length(),
      aboveHorizon: hor.altitude > -0.5,
    });
  }

  return out;
}
