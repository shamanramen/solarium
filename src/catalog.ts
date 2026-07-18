/** Body catalog for the skeleton: Sun + 8 planets. Earth is the geocentric observer. */

export type BodyId =
  | 'sun'
  | 'mercury'
  | 'venus'
  | 'earth'
  | 'mars'
  | 'jupiter'
  | 'saturn'
  | 'uranus'
  | 'neptune';

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
}

export const CATALOG: BodySpec[] = [
  { id: 'earth', label: 'Earth', eng: null, ring: 0, size: 1.1, color: '#3a6ea5', aspect: false },
  { id: 'sun', label: 'Sun', eng: 'Sun', ring: 14, size: 2.35, color: '#efb15c', glow: '#e08a28', aspect: true },
  { id: 'mercury', label: 'Mercury', eng: 'Mercury', ring: 20, size: 0.52, color: '#9a9088', aspect: true },
  { id: 'venus', label: 'Venus', eng: 'Venus', ring: 26, size: 0.92, color: '#d2b48c', aspect: true },
  { id: 'mars', label: 'Mars', eng: 'Mars', ring: 34, size: 0.68, color: '#c45a3c', aspect: true },
  { id: 'jupiter', label: 'Jupiter', eng: 'Jupiter', ring: 48, size: 2.05, color: '#c4a67a', aspect: true },
  { id: 'saturn', label: 'Saturn', eng: 'Saturn', ring: 60, size: 1.8, color: '#d4c48e', rings: true, aspect: true },
  { id: 'uranus', label: 'Uranus', eng: 'Uranus', ring: 72, size: 1.3, color: '#7bc4c4', aspect: true },
  { id: 'neptune', label: 'Neptune', eng: 'Neptune', ring: 84, size: 1.25, color: '#4169b0', aspect: true },
];

export const ASPECT_BODIES = CATALOG.filter((b) => b.aspect);
