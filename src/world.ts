/**
 * Three.js world:
 * - Orrery: readable rings by geocentric longitude
 * - Earth sky: bodies on the celestial sphere by true geo lon/lat
 *   (default camera: looking down from above the north ecliptic pole)
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CATALOG, type BodyId } from './catalog';
import { colorFor, type Hit, type Kind } from './aspects';
import type { Sample } from './positions';
import { planetMap, ringMap } from './materials';
import { formatLonShort } from './zodiac';

const D2R = Math.PI / 180;
/** Celestial sphere radius for Earth-sky mode. */
const SKY_R = 72;

export type ViewMode = 'orrery' | 'sky';

export interface World {
  place(samples: Sample[]): void;
  drawAspects(hits: Hit[], enabled: ReadonlySet<Kind>): void;
  setViewMode(mode: ViewMode): void;
  getViewMode(): ViewMode;
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

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 600);
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

  // Orrery guides
  const orreryGuides = new THREE.Group();
  orreryGuides.name = 'orreryGuides';
  orreryGuides.add(goldRing(98));
  for (const b of CATALOG) {
    if (b.ring > 0) orreryGuides.add(guideRing(b.ring));
  }
  scene.add(orreryGuides);

  // Sky guides: dome grid + ecliptic + zodiac ticks
  const skyGuides = new THREE.Group();
  skyGuides.name = 'skyGuides';
  skyGuides.visible = false;
  skyGuides.add(skyDome(SKY_R));
  skyGuides.add(goldRing(SKY_R));
  skyGuides.add(meridianRing(SKY_R));
  for (const tick of zodiacTicks(SKY_R)) skyGuides.add(tick);
  scene.add(skyGuides);

  const nodes = new Map<BodyId, THREE.Object3D>();
  const meshes = new Map<BodyId, THREE.Mesh>();
  const labels = new Map<BodyId, THREE.Sprite>();
  const anchors = new Map<string, THREE.Vector3>();
  const pickables: THREE.Object3D[] = [];
  /** Base mesh radius from catalog (for restore after sky scaling). */
  const baseSize = new Map<BodyId, number>();

  for (const spec of CATALOG) {
    const group = new THREE.Group();
    group.name = spec.id;
    group.userData.bodyId = spec.id;
    baseSize.set(spec.id, spec.size);

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
      ring.name = 'saturn-rings';
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

  let mode: ViewMode = 'orrery';
  let lastSamples: Sample[] = [];
  let lastHits: Hit[] = [];
  let lastEnabled: ReadonlySet<Kind> = new Set();
  let focusId: BodyId | null = null;
  let focusTarget = new THREE.Vector3(0, 0, 0);
  let frameCount = 0;
  let fpsSampleAt = performance.now();
  let fpsValue = 0;
  let bloom = 1;
  let bloomGoal = 1;

  /** Orrery layout: fake radius, real lon (lat lightly exaggerated). */
  function orreryPoint(lonDeg: number, radius: number, latDeg: number): THREE.Vector3 {
    const a = lonDeg * D2R;
    return new THREE.Vector3(
      Math.cos(a) * radius,
      Math.sin(latDeg * D2R) * 3.2,
      Math.sin(a) * radius,
    );
  }

  /** True geocentric direction on the celestial sphere. */
  function skyPoint(lonDeg: number, latDeg: number, radius = SKY_R): THREE.Vector3 {
    const lon = lonDeg * D2R;
    const lat = latDeg * D2R;
    const c = Math.cos(lat);
    return new THREE.Vector3(
      c * Math.cos(lon) * radius,
      Math.sin(lat) * radius,
      c * Math.sin(lon) * radius,
    );
  }

  function skyVisualSize(id: BodyId): number {
    // Angular exaggeration so outer planets remain readable on the dome.
    switch (id) {
      case 'sun':
        return 3.2;
      case 'moon':
        return 2.4;
      case 'jupiter':
        return 2.0;
      case 'saturn':
        return 1.85;
      case 'uranus':
      case 'neptune':
        return 1.35;
      case 'mars':
      case 'venus':
        return 1.15;
      case 'mercury':
      case 'pluto':
        return 0.95;
      default:
        return 1.2;
    }
  }

  function applyCameraForMode(): void {
    if (mode === 'sky') {
      // From above: north ecliptic pole looking down on the sky map
      camera.position.set(0.01, SKY_R * 1.9, 0.01);
      controls.target.set(0, 0, 0);
      controls.minDistance = 8;
      controls.maxDistance = SKY_R * 3.2;
      controls.maxPolarAngle = Math.PI; // free look
      controls.minPolarAngle = 0;
      camera.fov = 48;
      camera.updateProjectionMatrix();
      scene.fog = new THREE.FogExp2('#080a0e', 0.0022);
    } else {
      camera.position.set(0, 48, 105);
      controls.target.set(0, 0, 0);
      controls.minDistance = 10;
      controls.maxDistance = 260;
      controls.maxPolarAngle = Math.PI * 0.48;
      controls.minPolarAngle = 0;
      camera.fov = 42;
      camera.updateProjectionMatrix();
      scene.fog = new THREE.FogExp2('#080a0e', 0.0038);
    }
    controls.update();
  }

  function setViewMode(next: ViewMode): void {
    if (mode === next) return;
    mode = next;
    orreryGuides.visible = mode === 'orrery';
    skyGuides.visible = mode === 'sky';
    applyCameraForMode();
    if (lastSamples.length) place(lastSamples);
    if (lastHits.length || lastEnabled.size) drawAspects(lastHits, lastEnabled);
  }

  function place(samples: Sample[]): void {
    lastSamples = samples;
    anchors.clear();

    const earth = nodes.get('earth');
    const earthLab = labels.get('earth');

    if (mode === 'sky') {
      // Observer at center — hide Earth mesh; sky is outward directions
      if (earth) {
        earth.visible = false;
      }
      if (earthLab) earthLab.visible = false;

      for (const s of samples) {
        const node = nodes.get(s.id);
        const lab = labels.get(s.id);
        if (!node) continue;
        node.visible = true;
        const p = skyPoint(s.lon, s.lat);
        node.position.copy(p);
        anchors.set(s.id, p.clone());

        // Face mesh toward center so we see the "disk" of the planet
        node.lookAt(0, 0, 0);

        const vis = skyVisualSize(s.id);
        const base = baseSize.get(s.id) ?? 1;
        const scale = vis / base;
        node.scale.setScalar(scale);

        if (lab) {
          lab.visible = true;
          updateLabel(lab, `${s.label}  ${formatLonShort(s.lon)}`);
          // Offset label slightly outward from sphere
          const outward = p.clone().normalize().multiplyScalar(SKY_R + vis * 1.4 + 2);
          lab.position.copy(outward);
          lab.scale.set(12, 1.5, 1);
        }

        if (s.id === 'sun') {
          key.position.copy(p).normalize().multiplyScalar(90);
        }
        if (focusId === s.id) focusTarget.copy(p);
      }
      return;
    }

    // Orrery mode
    if (earth) {
      earth.visible = true;
      earth.position.set(0, 0, 0);
      earth.scale.setScalar(1);
      earth.rotation.set(0, earth.rotation.y, 0);
      anchors.set('earth', earth.position.clone());
    }
    if (earthLab) {
      earthLab.visible = true;
      updateLabel(earthLab, 'Earth');
      const es = CATALOG.find((b) => b.id === 'earth')!;
      earthLab.position.set(0, es.size + 1.2, 0);
      earthLab.scale.set(10, 1.35, 1);
    }

    for (const s of samples) {
      const spec = CATALOG.find((b) => b.id === s.id);
      const node = nodes.get(s.id);
      if (!spec || !node) continue;
      node.visible = true;
      node.scale.setScalar(1);
      // Reset lookAt from sky mode
      node.rotation.x = 0;
      node.rotation.z = 0;

      const p = orreryPoint(s.lon, spec.ring, s.lat);
      node.position.copy(p);
      anchors.set(s.id, p.clone());
      const lab = labels.get(s.id);
      if (lab) {
        lab.visible = true;
        updateLabel(lab, `${s.label}  ${formatLonShort(s.lon)}`);
        lab.position.set(p.x, p.y + spec.size + 1.2, p.z);
        lab.scale.set(10, 1.35, 1);
      }
      if (s.id === 'sun') key.position.copy(p).normalize().multiplyScalar(70);
      if (focusId === s.id) focusTarget.copy(p);
    }
  }

  function drawAspects(hits: Hit[], enabled: ReadonlySet<Kind>): void {
    lastHits = hits;
    lastEnabled = enabled;

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

      const pts =
        mode === 'sky' ? greatCircle(a, b, SKY_R, 40) : [a.clone(), b.clone()];

      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({
          color,
          transparent: true,
          opacity: 0,
          depthWrite: false,
        }),
      );
      line.userData.baseOp = baseOp;
      aspectRoot.add(line);

      const mid =
        mode === 'sky'
          ? greatCircle(a, b, SKY_R, 2)[1]
          : a.clone().lerp(b, 0.5).add(new THREE.Vector3(0, 0.28, 0));
      const bead = new THREE.Mesh(
        new THREE.SphereGeometry(mode === 'sky' ? 0.45 : 0.17, 8, 8),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0 }),
      );
      bead.position.copy(mid);
      bead.userData.baseOp = baseOp * 0.95;
      aspectRoot.add(bead);
    }

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
    if (node && node.visible) focusTarget.copy(node.position);
  }

  function pick(clientX: number, clientY: number): BodyId | null {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(pickables, false);
    if (!hits.length) return null;
    const id = hits[0].object.userData.bodyId as BodyId | undefined;
    if (!id) return null;
    const node = nodes.get(id);
    if (node && !node.visible) return null;
    return id;
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
    if (mode === 'orrery') {
      for (const [id, node] of nodes) {
        node.rotation.y += (id === 'earth' ? 0.003 : id === 'moon' ? 0.004 : 0.0013) * spin;
      }
    }

    if (focusId) {
      controls.target.lerp(focusTarget, reduced ? 1 : 0.08);
    }

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

    for (const [id, mesh] of meshes) {
      const boost = id === focusId ? 1.1 : 1;
      // node scale is set in place(); multiply mesh only for highlight in orrery
      if (mode === 'orrery') mesh.scale.setScalar(boost);
      else mesh.scale.setScalar(boost);
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
  return {
    place,
    drawAspects,
    setViewMode,
    getViewMode: () => mode,
    focusBody,
    pick,
    resize,
    tick,
    dispose,
    fps: () => fpsValue,
  };
}

/** Slerp along great circle on sphere of radius R. */
function greatCircle(a: THREE.Vector3, b: THREE.Vector3, R: number, segs: number): THREE.Vector3[] {
  const aN = a.clone().normalize();
  const bN = b.clone().normalize();
  let dot = aN.dot(bN);
  dot = Math.min(1, Math.max(-1, dot));
  const omega = Math.acos(dot);
  const pts: THREE.Vector3[] = [];

  if (omega < 1e-4) {
    pts.push(aN.multiplyScalar(R));
    return pts;
  }

  const sinO = Math.sin(omega);
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const p = aN
      .clone()
      .multiplyScalar(Math.sin((1 - t) * omega) / sinO)
      .add(bN.clone().multiplyScalar(Math.sin(t * omega) / sinO))
      .normalize()
      .multiplyScalar(R);
    pts.push(p);
  }
  return pts;
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
    new THREE.LineBasicMaterial({ color: '#c9a227', transparent: true, opacity: 0.22 }),
  );
}

/** Faint latitude/longitude grid on the celestial sphere. */
function skyDome(R: number): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.LineBasicMaterial({
    color: '#1e2a3a',
    transparent: true,
    opacity: 0.35,
  });

  // parallels (latitude)
  for (const lat of [-60, -30, 0, 30, 60]) {
    const pts: THREE.Vector3[] = [];
    const latR = lat * D2R;
    const y = Math.sin(latR) * R;
    const rr = Math.cos(latR) * R;
    for (let i = 0; i <= 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * rr, y, Math.sin(a) * rr));
    }
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
  }

  // meridians every 30°
  for (let lon = 0; lon < 360; lon += 30) {
    const pts: THREE.Vector3[] = [];
    const L = lon * D2R;
    for (let i = 0; i <= 64; i++) {
      const lat = (-90 + (180 * i) / 64) * D2R;
      const c = Math.cos(lat);
      pts.push(
        new THREE.Vector3(c * Math.cos(L) * R, Math.sin(lat) * R, c * Math.sin(L) * R),
      );
    }
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat.clone()));
  }

  return g;
}

/** 0° / 90° / 180° / 270° meridians slightly brighter. */
function meridianRing(R: number): THREE.Line {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 64; i++) {
    const lat = (-90 + (180 * i) / 64) * D2R;
    pts.push(new THREE.Vector3(0, Math.sin(lat) * R, Math.cos(lat) * R));
  }
  return new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color: '#2a3a50', transparent: true, opacity: 0.45 }),
  );
}

function zodiacTicks(R: number): THREE.Object3D[] {
  const signs = ['♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐', '♑', '♒', '♓'];
  const out: THREE.Object3D[] = [];
  for (let i = 0; i < 12; i++) {
    const lon = i * 30 + 15; // mid-sign
    const a = lon * D2R;
    const p = new THREE.Vector3(Math.cos(a) * R, 0.5, Math.sin(a) * R);
    const spr = nameSprite(signs[i]);
    spr.position.copy(p);
    spr.scale.set(5, 1.2, 1);
    out.push(spr);
  }
  return out;
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
