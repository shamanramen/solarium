/** Body catalog: Sun, Moon, planets through Pluto. Earth is geocentric observer. */

export type BodyId =
  | 'sun'
  | 'moon'
  | 'mercury'
  | 'venus'
  | 'earth'
  | 'mars'
  | 'jupiter'
  | 'saturn'
  | 'uranus'
  | 'neptune'
  | 'pluto';

export interface BodySpec {
  id: BodyId;
  label: string;
  /** astronomy-engine name; null = observer (Earth). */
  eng: string | null;
  /** Scene orbit radius (readable, not AU). */
  ring: number;
  /** Mesh radius. */
  size: number;
  color: string;
  glow?: string;
  rings?: boolean;
  /** Participate in aspect math. */
  aspect: boolean;
  surface: 'rocky' | 'gas' | 'ice' | 'sun' | 'moon';
}

/**
 * Layout: Earth at center (observer). Bodies sit on readable rings;
 * angle = geocentric ecliptic longitude.
 */
export const CATALOG: BodySpec[] = [
  { id: 'earth', label: 'Earth', eng: null, ring: 0, size: 1.15, color: '#3a6ea5', aspect: false, surface: 'rocky' },
  { id: 'moon', label: 'Moon', eng: 'Moon', ring: 7.5, size: 0.42, color: '#c8c2b4', aspect: true, surface: 'moon' },
  { id: 'sun', label: 'Sun', eng: 'Sun', ring: 15, size: 2.4, color: '#efb15c', glow: '#e08a28', aspect: true, surface: 'sun' },
  { id: 'mercury', label: 'Mercury', eng: 'Mercury', ring: 22, size: 0.52, color: '#9a9088', aspect: true, surface: 'rocky' },
  { id: 'venus', label: 'Venus', eng: 'Venus', ring: 28, size: 0.92, color: '#d2b48c', aspect: true, surface: 'rocky' },
  { id: 'mars', label: 'Mars', eng: 'Mars', ring: 36, size: 0.68, color: '#c45a3c', aspect: true, surface: 'rocky' },
  { id: 'jupiter', label: 'Jupiter', eng: 'Jupiter', ring: 50, size: 2.1, color: '#c4a67a', aspect: true, surface: 'gas' },
  { id: 'saturn', label: 'Saturn', eng: 'Saturn', ring: 62, size: 1.85, color: '#d4c48e', rings: true, aspect: true, surface: 'gas' },
  { id: 'uranus', label: 'Uranus', eng: 'Uranus', ring: 74, size: 1.32, color: '#7bc4c4', aspect: true, surface: 'ice' },
  { id: 'neptune', label: 'Neptune', eng: 'Neptune', ring: 86, size: 1.28, color: '#4169b0', aspect: true, surface: 'ice' },
  { id: 'pluto', label: 'Pluto', eng: 'Pluto', ring: 96, size: 0.38, color: '#b89a82', aspect: true, surface: 'ice' },
];

export const ASPECT_BODIES = CATALOG.filter((b) => b.aspect);
