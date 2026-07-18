/** Canvas-generated surfaces — no network, no third-party texture packs. */
import * as THREE from 'three';

function hash(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

function fbm(x: number, y: number): number {
  let v = 0;
  let a = 0.5;
  let f = 1;
  for (let i = 0; i < 5; i++) {
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

export function planetMap(
  hex: string,
  mode: 'rocky' | 'gas' | 'ice' | 'sun' = 'rocky',
  size = 512,
): THREE.CanvasTexture {
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

      if (mode === 'gas') {
        n = 0.5 * n + 0.5 * (0.5 + 0.5 * Math.sin(v * Math.PI * 16 + n * 4));
      } else if (mode === 'ice') {
        n = 0.35 + 0.65 * n;
      } else if (mode === 'sun') {
        n = 0.55 + 0.45 * n;
      }

      const k = 0.62 + 0.48 * n;
      const i = (y * size + x) * 4;
      if (mode === 'sun') {
        img.data[i] = Math.min(255, 210 + 45 * n);
        img.data[i + 1] = Math.min(255, 130 + 70 * n);
        img.data[i + 2] = Math.min(255, 35 + 40 * n);
      } else {
        img.data[i] = Math.min(255, br * k);
        img.data[i + 1] = Math.min(255, bg * k);
        img.data[i + 2] = Math.min(255, bb * k);
      }
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
        const band = 0.5 + 0.5 * Math.sin(r * 90);
        img.data[i] = 200;
        img.data[i + 1] = 188;
        img.data[i + 2] = 155;
        img.data[i + 3] = (0.3 + 0.5 * band) * 255;
      }
    }
  }

  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
