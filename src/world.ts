/**
 * Three.js world: Earth-centered geocentric theater, readable rings,
 * aspect chords between bodies.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CATALOG, type BodyId } from './catalog';
import { colorFor, type Hit, type Kind } from './aspects';
import type { Sample } from './positions';
import { planetMap, ringMap } from './materials';

const D2R = Math.PI / 180;

export interface World {
  place(samples: Sample[]): void;
  drawAspects(hits: Hit[], enabled: ReadonlySet<Kind>): void;
  resize(): void;
  tick(): void;
  dispose(): void;
  fps(): number;
}

export function createWorld(canvas: HTMLCanvasElement): World {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0a0c10');
  scene.fog = new THREE.FogExp2('#0a0c10', 0.0042);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 500);
  camera.position.set(0, 52, 98);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 14;
  controls.maxDistance = 220;
  controls.maxPolarAngle = Math.PI * 0.48;

  scene.add(new THREE.AmbientLight('#8a9ab0', 0.3));
  const key = new THREE.DirectionalLight('#fff2dc', 2.15);
  key.position.set(40, 22, 12);
  scene.add(key);
  const fill = new THREE.DirectionalLight('#6a80a0', 0.22);
  fill.position.set(-28, 8, -18);
  scene.add(fill);

  scene.add(starfield());
  scene.add(goldRing(90));
  for (const b of CATALOG) {
    if (b.ring > 0) scene.add(guideRing(b.ring));
  }

  const nodes = new Map<BodyId, THREE.Object3D>();
  const labels = new Map<BodyId, THREE.Sprite>();
  const anchors = new Map<string, THREE.Vector3>();

  for (const spec of CATALOG) {
    const group = new THREE.Group();
    group.name = spec.id;

    const mode =
      spec.id === 'sun'
        ? 'sun'
        : spec.id === 'jupiter' || spec.id === 'saturn'
          ? 'gas'
          : spec.id === 'uranus' || spec.id === 'neptune'
            ? 'ice'
            : 'rocky';

    const mat = new THREE.MeshStandardMaterial({
      map: planetMap(spec.color, mode),
      roughness: spec.id === 'sun' ? 0.4 : 0.58,
      metalness: 0.06,
      emissive: spec.glow ? new THREE.Color(spec.glow) : new THREE.Color(0x000000),
      emissiveIntensity: spec.glow ? 0.85 : 0,
    });
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(spec.size, 44, 30), mat);
    group.add(sphere);

    if (spec.id === 'sun') {
      group.add(
        new THREE.Mesh(
          new THREE.SphereGeometry(spec.size * 1.32, 28, 20),
          new THREE.MeshBasicMaterial({
            color: '#f0a040',
            transparent: true,
            opacity: 0.12,
            depthWrite: false,
          }),
        ),
      );
    }

    if (spec.id === 'earth') {
      group.add(
        new THREE.Mesh(
          new THREE.SphereGeometry(spec.size * 1.08, 28, 20),
          new THREE.MeshBasicMaterial({
            color: '#6ab0e0',
            transparent: true,
            opacity: 0.14,
            depthWrite: false,
          }),
        ),
      );
    }

    if (spec.rings) {
      const geo = new THREE.RingGeometry(spec.size * 1.4, spec.size * 2.3, 64);
      const ring = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({
          map: ringMap(),
          side: THREE.DoubleSide,
          transparent: true,
          depthWrite: false,
          opacity: 0.9,
        }),
      );
      ring.rotation.x = Math.PI / 2.12;
      group.add(ring);
    }

    if (spec.ring === 0) group.position.set(0, 0, 0);
    else group.position.set(spec.ring, 0, 0);

    scene.add(group);
    nodes.set(spec.id, group);

    const spr = nameSprite(spec.label);
    spr.position.set(group.position.x, spec.size + 1.15, group.position.z);
    scene.add(spr);
    labels.set(spec.id, spr);
  }

  const aspectRoot = new THREE.Group();
  scene.add(aspectRoot);

  let frameCount = 0;
  let fpsSampleAt = performance.now();
  let fpsValue = 0;

  function lonPoint(lonDeg: number, radius: number, latDeg: number): THREE.Vector3 {
    const a = lonDeg * D2R;
    return new THREE.Vector3(
      Math.cos(a) * radius,
      Math.sin(latDeg * D2R) * 3,
      Math.sin(a) * radius,
    );
  }

  function place(samples: Sample[]): void {
    anchors.clear();

    const earth = nodes.get('earth');
    if (earth) {
      earth.position.set(0, 0, 0);
      anchors.set('earth', earth.position.clone());
      const el = labels.get('earth');
      const es = CATALOG.find((b) => b.id === 'earth')!;
      if (el) el.position.set(0, es.size + 1.15, 0);
    }

    for (const s of samples) {
      const spec = CATALOG.find((b) => b.id === s.id);
      const node = nodes.get(s.id);
      if (!spec || !node) continue;
      const p = lonPoint(s.lon, spec.ring, s.lat);
      node.position.copy(p);
      anchors.set(s.id, p.clone());
      const lab = labels.get(s.id);
      if (lab) lab.position.set(p.x, p.y + spec.size + 1.15, p.z);
      if (s.id === 'sun') key.position.copy(p).normalize().multiplyScalar(60);
    }
  }

  function drawAspects(hits: Hit[], enabled: ReadonlySet<Kind>): void {
    while (aspectRoot.children.length) {
      const child = aspectRoot.children[0];
      aspectRoot.remove(child);
      if (child instanceof THREE.Line) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      } else if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    }

    for (const hit of hits) {
      if (!enabled.has(hit.kind)) continue;
      const a = anchors.get(hit.aId);
      const b = anchors.get(hit.bId);
      if (!a || !b) continue;

      const color = new THREE.Color(colorFor(hit.kind));
      const opacity = 0.35 + 0.55 * hit.tightness;
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([a, b]),
        new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }),
      );
      aspectRoot.add(line);

      const mid = a.clone().lerp(b, 0.5);
      mid.y += 0.25;
      const bead = new THREE.Mesh(
        new THREE.SphereGeometry(0.16, 8, 8),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: opacity * 0.9 }),
      );
      bead.position.copy(mid);
      aspectRoot.add(bead);
    }
  }

  function resize(): void {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }

  function tick(): void {
    for (const [id, node] of nodes) {
      node.rotation.y += id === 'earth' ? 0.003 : 0.0014;
    }
    controls.update();
    renderer.render(scene, camera);
    frameCount++;
    const now = performance.now();
    if (now - fpsSampleAt >= 500) {
      fpsValue = Math.round((frameCount * 1000) / (now - fpsSampleAt));
      frameCount = 0;
      fpsSampleAt = now;
    }
  }

  function dispose(): void {
    controls.dispose();
    renderer.dispose();
  }

  resize();
  return { place, drawAspects, resize, tick, dispose, fps: () => fpsValue };
}

function starfield(): THREE.Points {
  const n = 2400;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const r = 170 + Math.random() * 130;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    pos[i * 3 + 2] = r * Math.cos(phi);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      color: '#c8d0dc',
      size: 0.34,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    }),
  );
}

function guideRing(radius: number): THREE.Line {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 128; i++) {
    const a = (i / 128) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
  }
  return new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color: '#1c2634', transparent: true, opacity: 0.55 }),
  );
}

function goldRing(radius: number): THREE.Line {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 180; i++) {
    const a = (i / 180) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * radius, 0.02, Math.sin(a) * radius));
  }
  return new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color: '#c9a227', transparent: true, opacity: 0.2 }),
  );
}

function nameSprite(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 256, 64);
  ctx.font = '500 28px Outfit, system-ui, sans-serif';
  ctx.fillStyle = 'rgba(232, 228, 218, 0.88)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 32);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const spr = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.9 }),
  );
  spr.scale.set(6, 1.5, 1);
  return spr;
}
