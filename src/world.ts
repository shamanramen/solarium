/**
 * Three.js world: Earth-centered geocentric theater, readable rings,
 * aspect chords, focus-on-body, aspect bloom.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CATALOG, type BodyId } from './catalog';
import { colorFor, type Hit, type Kind } from './aspects';
import type { Sample } from './positions';
import { planetMap, ringMap } from './materials';
import { formatLonShort } from './zodiac';

const D2R = Math.PI / 180;

export interface World {
  place(samples: Sample[]): void;
  drawAspects(hits: Hit[], enabled: ReadonlySet<Kind>): void;
  focusBody(id: BodyId | null): void;
  pick(clientX: number, clientY: number): BodyId | null;
  resize(): void;
  tick(): void;
  dispose(): void;
  fps(): number;
}

export function createWorld(canvas: HTMLCanvasElement): World {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#080a0e');
  scene.fog = new THREE.FogExp2('#080a0e', 0.0038);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 560);
  camera.position.set(0, 48, 105);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 10;
  controls.maxDistance = 260;
  controls.maxPolarAngle = Math.PI * 0.48;

  scene.add(new THREE.AmbientLight('#7a8aa0', 0.22));
  const key = new THREE.DirectionalLight('#fff2dc', 2.4);
  key.position.set(40, 22, 12);
  scene.add(key);
  const fill = new THREE.DirectionalLight('#5a7090', 0.28);
  fill.position.set(-28, 8, -18);
  scene.add(fill);
  const rim = new THREE.DirectionalLight('#c9a227', 0.12);
  rim.position.set(0, -20, 40);
  scene.add(rim);

  scene.add(starfield());
  scene.add(goldRing(98));
  for (const b of CATALOG) {
    if (b.ring > 0) scene.add(guideRing(b.ring));
  }

  const nodes = new Map<BodyId, THREE.Object3D>();
  const meshes = new Map<BodyId, THREE.Mesh>();
  const labels = new Map<BodyId, THREE.Sprite>();
  const anchors = new Map<string, THREE.Vector3>();
  const pickables: THREE.Object3D[] = [];

  for (const spec of CATALOG) {
    const group = new THREE.Group();
    group.name = spec.id;
    group.userData.bodyId = spec.id;

    const mat = new THREE.MeshStandardMaterial({
      map: planetMap(spec.color, spec.surface),
      roughness: spec.id === 'sun' ? 0.38 : 0.55,
      metalness: 0.05,
      emissive: spec.glow ? new THREE.Color(spec.glow) : new THREE.Color(0x000000),
      emissiveIntensity: spec.glow ? 0.9 : 0,
    });
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(spec.size, 48, 32), mat);
    sphere.userData.bodyId = spec.id;
    group.add(sphere);
    meshes.set(spec.id, sphere);
    pickables.push(sphere);

    if (spec.id === 'sun') {
      group.add(
        new THREE.Mesh(
          new THREE.SphereGeometry(spec.size * 1.35, 28, 20),
          new THREE.MeshBasicMaterial({
            color: '#f0a040',
            transparent: true,
            opacity: 0.13,
            depthWrite: false,
          }),
        ),
      );
    }

    if (spec.id === 'earth') {
      group.add(
        new THREE.Mesh(
          new THREE.SphereGeometry(spec.size * 1.09, 28, 20),
          new THREE.MeshBasicMaterial({
            color: '#6ab0e0',
            transparent: true,
            opacity: 0.15,
            depthWrite: false,
          }),
        ),
      );
    }

    if (spec.rings) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(spec.size * 1.4, spec.size * 2.35, 72),
        new THREE.MeshBasicMaterial({
          map: ringMap(),
          side: THREE.DoubleSide,
          transparent: true,
          depthWrite: false,
          opacity: 0.92,
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

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  let focusId: BodyId | null = null;
  let focusTarget = new THREE.Vector3(0, 0, 0);
  let frameCount = 0;
  let fpsSampleAt = performance.now();
  let fpsValue = 0;
  let bloom = 1;
  let bloomGoal = 1;

  function lonPoint(lonDeg: number, radius: number, latDeg: number): THREE.Vector3 {
    const a = lonDeg * D2R;
    return new THREE.Vector3(
      Math.cos(a) * radius,
      Math.sin(latDeg * D2R) * 3.2,
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
      if (el) {
        updateLabel(el, 'Earth');
        el.position.set(0, es.size + 1.2, 0);
      }
    }

    for (const s of samples) {
      const spec = CATALOG.find((b) => b.id === s.id);
      const node = nodes.get(s.id);
      if (!spec || !node) continue;
      const p = lonPoint(s.lon, spec.ring, s.lat);
      node.position.copy(p);
      anchors.set(s.id, p.clone());
      const lab = labels.get(s.id);
      if (lab) {
        updateLabel(lab, `${s.label}  ${formatLonShort(s.lon)}`);
        lab.position.set(p.x, p.y + spec.size + 1.2, p.z);
      }
      if (s.id === 'sun') key.position.copy(p).normalize().multiplyScalar(70);
      if (focusId === s.id) focusTarget.copy(p);
    }
  }

  function drawAspects(hits: Hit[], enabled: ReadonlySet<Kind>): void {
    while (aspectRoot.children.length) {
      const child = aspectRoot.children[0];
      aspectRoot.remove(child);
      if (child instanceof THREE.Line || child instanceof THREE.Mesh) {
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
      const baseOp = 0.32 + 0.58 * hit.tightness;
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([a, b]),
        new THREE.LineBasicMaterial({
          color,
          transparent: true,
          opacity: 0,
          depthWrite: false,
        }),
      );
      line.userData.baseOp = baseOp;
      aspectRoot.add(line);

      const mid = a.clone().lerp(b, 0.5);
      mid.y += 0.28;
      const bead = new THREE.Mesh(
        new THREE.SphereGeometry(0.17, 8, 8),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0 }),
      );
      bead.position.copy(mid);
      bead.userData.baseOp = baseOp * 0.95;
      aspectRoot.add(bead);
    }

    // bloom-in unless reduced motion
    bloom = reduced ? 1 : 0;
    bloomGoal = 1;
  }

  function focusBody(id: BodyId | null): void {
    focusId = id;
    if (!id) {
      focusTarget.set(0, 0, 0);
      return;
    }
    const node = nodes.get(id);
    if (node) focusTarget.copy(node.position);
  }

  function pick(clientX: number, clientY: number): BodyId | null {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(pickables, false);
    if (!hits.length) return null;
    const id = hits[0].object.userData.bodyId as BodyId | undefined;
    return id ?? null;
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
    const spin = reduced ? 0 : 1;
    for (const [id, node] of nodes) {
      node.rotation.y += (id === 'earth' ? 0.003 : id === 'moon' ? 0.004 : 0.0013) * spin;
    }

    // ease focus target
    if (focusId) {
      controls.target.lerp(focusTarget, reduced ? 1 : 0.08);
    }

    // aspect bloom (opacity only)
    if (bloom < bloomGoal) {
      bloom = Math.min(bloomGoal, bloom + (reduced ? 1 : 0.06));
    }
    for (const child of aspectRoot.children) {
      const base = (child.userData.baseOp as number) ?? 0.6;
      const mat = (child as THREE.Mesh | THREE.Line).material as THREE.Material & {
        opacity?: number;
      };
      if (mat && 'opacity' in mat) mat.opacity = base * bloom;
    }

    // highlight focused mesh (scale only — keep sun emissive intact)
    for (const [id, mesh] of meshes) {
      mesh.scale.setScalar(id === focusId ? 1.1 : 1);
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
  return { place, drawAspects, focusBody, pick, resize, tick, dispose, fps: () => fpsValue };
}

function starfield(): THREE.Points {
  const n = 2800;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const r = 190 + Math.random() * 140;
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
      size: 0.32,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.74,
      depthWrite: false,
    }),
  );
}

function guideRing(radius: number): THREE.Line {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 140; i++) {
    const a = (i / 140) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
  }
  return new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color: '#1a2432', transparent: true, opacity: 0.5 }),
  );
}

function goldRing(radius: number): THREE.Line {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 200; i++) {
    const a = (i / 200) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * radius, 0.02, Math.sin(a) * radius));
  }
  return new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color: '#c9a227', transparent: true, opacity: 0.18 }),
  );
}

function nameSprite(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 512, 64);
  ctx.font = '500 26px Outfit, system-ui, sans-serif';
  ctx.fillStyle = 'rgba(232, 228, 218, 0.9)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 32);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const spr = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.92 }),
  );
  spr.scale.set(10, 1.35, 1);
  spr.userData.canvas = canvas;
  spr.userData.ctx = ctx;
  spr.userData.tex = tex;
  return spr;
}

function updateLabel(sprite: THREE.Sprite, text: string): void {
  const canvas = sprite.userData.canvas as HTMLCanvasElement | undefined;
  const ctx = sprite.userData.ctx as CanvasRenderingContext2D | undefined;
  const tex = sprite.userData.tex as THREE.CanvasTexture | undefined;
  if (!canvas || !ctx || !tex) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = '500 26px Outfit, system-ui, sans-serif';
  ctx.fillStyle = 'rgba(232, 228, 218, 0.9)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  tex.needsUpdate = true;
}
