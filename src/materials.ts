/** Canvas-generated surfaces — no network texture packs. */
import * as THREE from 'three';

function hash(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

function fbm(x: number, y: number): number {
  let v = 0;
  let a = 0.5;
  let f = 1;
  for (let i = 0; i < 6; i++) {
    v += a * hash(x * f, y * f);
    a *= 0.5;
    f *= 2.05;
  }
  return v;
}

function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export type SurfaceMode = 'rocky' | 'gas' | 'ice' | 'sun' | 'moon';

export function planetMap(hex: string, mode: SurfaceMode = 'rocky', size = 512): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const [br, bg, bb] = rgb(hex);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      let n = fbm(u * 7, v * 5);
      const i = (y * size + x) * 4;

      if (mode === 'gas') {
        n = 0.45 * n + 0.55 * (0.5 + 0.5 * Math.sin(v * Math.PI * 18 + n * 4));
      } else if (mode === 'ice') {
        n = 0.3 + 0.7 * n;
      } else if (mode === 'moon') {
        // crater-ish dark spots
        const crater = Math.max(0, 0.55 - fbm(u * 14, v * 14));
        n = 0.55 + 0.35 * n - crater * 0.35;
      } else if (mode === 'sun') {
        img.data[i] = Math.min(255, 205 + 50 * n);
        img.data[i + 1] = Math.min(255, 125 + 75 * n);
        img.data[i + 2] = Math.min(255, 30 + 45 * n);
        img.data[i + 3] = 255;
        continue;
      }

      // Earth-ish blue oceans when base is earth blue
      if (hex.toLowerCase() === '#3a6ea5') {
        const land = n > 0.52;
        if (land) {
          img.data[i] = 55 + 40 * n;
          img.data[i + 1] = 90 + 50 * n;
          img.data[i + 2] = 45 + 30 * n;
        } else {
          img.data[i] = 30 + 25 * n;
          img.data[i + 1] = 70 + 40 * n;
          img.data[i + 2] = 130 + 50 * n;
        }
        img.data[i + 3] = 255;
        continue;
      }

      const k = 0.58 + 0.52 * n;
      img.data[i] = Math.min(255, br * k);
      img.data[i + 1] = Math.min(255, bg * k);
      img.data[i + 2] = Math.min(255, bb * k);
      img.data[i + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function ringMap(size = 256): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const c = size / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = Math.hypot(x - c, y - c) / c;
      const i = (y * size + x) * 4;
      if (r < 0.54 || r > 0.98) {
        img.data[i + 3] = 0;
      } else {
        const band = 0.5 + 0.5 * Math.sin(r * 95);
        const gap = Math.abs(r - 0.78) < 0.02 ? 0.15 : 1;
        img.data[i] = 200;
        img.data[i + 1] = 188;
        img.data[i + 2] = 155;
        img.data[i + 3] = (0.28 + 0.52 * band) * 255 * gap;
      }
    }
  }

  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
