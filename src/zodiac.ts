/** Tropical longitude formatting for HUD. */

const SIGNS = [
  'Aries',
  'Taurus',
  'Gemini',
  'Cancer',
  'Leo',
  'Virgo',
  'Libra',
  'Scorpio',
  'Sagittarius',
  'Capricorn',
  'Aquarius',
  'Pisces',
] as const;

const GLYPHS = ['♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐', '♑', '♒', '♓'] as const;

export function formatLon(lon: number): string {
  const x = ((lon % 360) + 360) % 360;
  const sign = Math.floor(x / 30);
  const deg = x - sign * 30;
  const d = Math.floor(deg);
  const m = Math.floor((deg - d) * 60);
  return `${d}°${String(m).padStart(2, '0')}′ ${SIGNS[sign]}`;
}

export function formatLonShort(lon: number): string {
  const x = ((lon % 360) + 360) % 360;
  const sign = Math.floor(x / 30);
  const deg = x - sign * 30;
  return `${deg.toFixed(1)}° ${GLYPHS[sign]}`;
}
