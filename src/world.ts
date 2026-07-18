/**
 * Three.js world — three view modes:
 * 1. orrery  — readable rings by geocentric longitude
 * 2. skymap  — celestial sphere, look down from north ecliptic pole
 * 3. night   — standing on Earth, look around the real local sky (alt/az)
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CATALOG, type BodyId } from './catalog';
import { colorFor, type Hit, type Kind } from './aspects';
import type { Sample } from './positions';
import type { HorizonSample } from './horizon';
import { planetMap, ringMap } from './materials';
import { formatLonShort } from './zodiac';

const D2R = Math.PI / 180;
const SKY_R = 72;
const NIGHT_R = 80;

export type ViewMode = 'orrery' | 'skymap' | 'night';

export interface World {
  place(samples: Sample[], horizon?: HorizonSample[]): void;
  drawAspects(hits: Hit[], enabled: ReadonlySet<Kind>): void;
  setViewMode(mode: ViewMode): void;
  getViewMode(): ViewMode;
  focusBody(id: BodyId | null): void;
  pick(clientX: number, clientY: number): BodyId | null;
  /** Night-sky look angles (yaw around vertical, pitch up/down). */
  getLook(): { yaw: number; pitch: number };
  setLook(yaw: number, pitch: number): void;
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

  const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 600);
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

  // Soft up-light for night sky (milky ambient)
  const nightHemi = new THREE.HemisphereLight('#1a2438', '#050608', 0.35);
  nightHemi.visible = false;
  scene.add(nightHemi);

  scene.add(starfield());

  // Orrery guides
  const orreryGuides = new THREE.Group();
  orreryGuides.add(goldRing(98));
  for (const b of CATALOG) {
    if (b.ring > 0) orreryGuides.add(guideRing(b.ring));
  }
  scene.add(orreryGuides);

  // Sky-map guides (ecliptic sphere)
  const skymapGuides = new THREE.Group();
  skymapGuides.visible = false;
  skymapGuides.add(skyDome(SKY_R));
  skymapGuides.add(goldRing(SKY_R));
  for (const tick of zodiacTicks(SKY_R)) skymapGuides.add(tick);
  scene.add(skymapGuides);

  // Night-sky guides (local horizon)
  const nightGuides = new THREE.Group();
  nightGuides.visible = false;
  nightGuides.add(groundDisc(NIGHT_R * 1.2));
  nightGuides.add(horizonRing(NIGHT_R));
  nightGuides.add(cardinalLabels(NIGHT_R));
  nightGuides.add(altitudeArcs(NIGHT_R));
  scene.add(nightGuides);

  const nodes = new Map<BodyId, THREE.Object3D>();
  const meshes = new Map<BodyId, THREE.Mesh>();
  const labels = new Map<BodyId, THREE.Sprite>();
  const anchors = new Map<string, THREE.Vector3>();
  const pickables: THREE.Object3D[] = [];
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
      group.add(ring);
    }

    if (spec.ring === 0) group.position.set(0, 0, 0);
    else group.position.set(spec.ring, 0, 0);

    scene.add(group);
    nodes.set(spec.id, group);

    const spr = nameSprite(spec.label);
    scene.add(spr);
    labels.set(spec.id, spr);
  }

  const aspectRoot = new THREE.Group();
  scene.add(aspectRoot);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  let mode: ViewMode = 'orrery';
  let lastSamples: Sample[] = [];
  let lastHorizon: HorizonSample[] = [];
  let lastHits: Hit[] = [];
  let lastEnabled: ReadonlySet<Kind> = new Set();
  let focusId: BodyId | null = null;
  let focusTarget = new THREE.Vector3(0, 0, 0);
  let frameCount = 0;
  let fpsSampleAt = performance.now();
  let fpsValue = 0;
  let bloom = 1;
  let bloomGoal = 1;

  // Night-sky first-person look (yaw around Y, pitch around X)
  let lookYaw = 0; // 0 = looking north (−Z)
  let lookPitch = 0.35; // slightly up

  function orreryPoint(lonDeg: number, radius: number, latDeg: number): THREE.Vector3 {
    const a = lonDeg * D2R;
    return new THREE.Vector3(
      Math.cos(a) * radius,
      Math.sin(latDeg * D2R) * 3.2,
      Math.sin(a) * radius,
    );
  }

  /** Ecliptic sphere (skymap). */
  function eclipticSkyPoint(lonDeg: number, latDeg: number, radius = SKY_R): THREE.Vector3 {
    const lon = lonDeg * D2R;
    const lat = latDeg * D2R;
    const c = Math.cos(lat);
    return new THREE.Vector3(
      c * Math.cos(lon) * radius,
      Math.sin(lat) * radius,
      c * Math.sin(lon) * radius,
    );
  }

  /**
   * Local sky: az clockwise from north, alt from horizon.
   * +Y = zenith, −Z = north, +X = east.
   */
  function horizontalPoint(azDeg: number, altDeg: number, radius = NIGHT_R): THREE.Vector3 {
    const az = azDeg * D2R;
    const alt = altDeg * D2R;
    const c = Math.cos(alt);
    return new THREE.Vector3(
      Math.sin(az) * c * radius,
      Math.sin(alt) * radius,
      -Math.cos(az) * c * radius,
    );
  }

  function skyVisualSize(id: BodyId, night = false): number {
    const bump = night ? 1.15 : 1;
    switch (id) {
      case 'sun':
        return 3.4 * bump;
      case 'moon':
        return 2.6 * bump;
      case 'jupiter':
        return 2.1 * bump;
      case 'saturn':
        return 1.9 * bump;
      case 'uranus':
      case 'neptune':
        return 1.4 * bump;
      case 'mars':
      case 'venus':
        return 1.2 * bump;
      default:
        return 1.0 * bump;
    }
  }

  function applyCameraForMode(): void {
    nightHemi.visible = mode === 'night';
    key.intensity = mode === 'night' ? 0.35 : 2.4;
    fill.intensity = mode === 'night' ? 0.12 : 0.28;
    rim.visible = mode !== 'night';

    if (mode === 'night') {
      controls.enabled = false;
      camera.fov = 72;
      camera.near = 0.05;
      camera.far = 400;
      camera.updateProjectionMatrix();
      camera.position.set(0, 1.65, 0);
      camera.rotation.order = 'YXZ';
      applyNightLook();
      scene.fog = new THREE.FogExp2('#06080c', 0.0015);
      scene.background = new THREE.Color('#05070b');
    } else if (mode === 'skymap') {
      controls.enabled = true;
      camera.position.set(0.01, SKY_R * 1.9, 0.01);
      controls.target.set(0, 0, 0);
      controls.minDistance = 8;
      controls.maxDistance = SKY_R * 3.2;
      controls.maxPolarAngle = Math.PI;
      controls.minPolarAngle = 0;
      camera.fov = 48;
      camera.near = 0.1;
      camera.far = 600;
      camera.updateProjectionMatrix();
      camera.rotation.set(0, 0, 0);
      scene.fog = new THREE.FogExp2('#080a0e', 0.0022);
      scene.background = new THREE.Color('#080a0e');
    } else {
      controls.enabled = true;
      camera.position.set(0, 48, 105);
      controls.target.set(0, 0, 0);
      controls.minDistance = 10;
      controls.maxDistance = 260;
      controls.maxPolarAngle = Math.PI * 0.48;
      controls.minPolarAngle = 0;
      camera.fov = 42;
      camera.near = 0.1;
      camera.far = 600;
      camera.updateProjectionMatrix();
      camera.rotation.set(0, 0, 0);
      scene.fog = new THREE.FogExp2('#080a0e', 0.0038);
      scene.background = new THREE.Color('#080a0e');
    }
    controls.update();
  }

  function applyNightLook(): void {
    // Clamp pitch: can look a bit below horizon, not behind head
    lookPitch = Math.max(-0.15, Math.min(Math.PI / 2 - 0.05, lookPitch));
    camera.position.set(0, 1.65, 0);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = lookYaw;
    camera.rotation.x = lookPitch;
    camera.rotation.z = 0;
  }

  function setViewMode(next: ViewMode): void {
    if (mode === next) return;
    mode = next;
    orreryGuides.visible = mode === 'orrery';
    skymapGuides.visible = mode === 'skymap';
    nightGuides.visible = mode === 'night';
    applyCameraForMode();
    if (lastSamples.length) place(lastSamples, lastHorizon);
    if (lastHits.length || lastEnabled.size) drawAspects(lastHits, lastEnabled);
  }

  function place(samples: Sample[], horizon: HorizonSample[] = []): void {
    lastSamples = samples;
    lastHorizon = horizon;
    anchors.clear();

    const earth = nodes.get('earth');
    const earthLab = labels.get('earth');

    if (mode === 'night') {
      if (earth) earth.visible = false;
      if (earthLab) earthLab.visible = false;

      // Hide all first, then show horizon samples
      for (const [, node] of nodes) {
        if (node.name !== 'earth') node.visible = false;
      }
      for (const [, lab] of labels) lab.visible = false;

      for (const h of horizon) {
        const node = nodes.get(h.id);
        const lab = labels.get(h.id);
        if (!node) continue;

        // Dim / hide bodies well below horizon
        if (h.alt < -8) {
          node.visible = false;
          if (lab) lab.visible = false;
          continue;
        }

        node.visible = true;
        const p = horizontalPoint(h.az, h.alt);
        node.position.copy(p);
        anchors.set(h.id, p.clone());
        node.lookAt(0, 1.65, 0);

        const vis = skyVisualSize(h.id, true);
        const base = baseSize.get(h.id) ?? 1;
        node.scale.setScalar(vis / base);

        // Fade near/below horizon
        const mat = meshes.get(h.id)?.material as THREE.MeshStandardMaterial | undefined;
        if (mat) {
          mat.transparent = h.alt < 5;
          mat.opacity = h.alt < 0 ? 0.25 : h.alt < 5 ? 0.55 + h.alt * 0.09 : 1;
        }

        if (lab) {
          lab.visible = true;
          const status = h.aboveHorizon ? '' : ' (set)';
          updateLabel(lab, `${h.label}  ${formatLonShort(h.lon)}${status}`);
          const outward = p.clone().normalize().multiplyScalar(NIGHT_R + vis * 1.5 + 3);
          lab.position.copy(outward);
          lab.scale.set(14, 1.6, 1);
        }

        if (h.id === 'sun') {
          key.position.copy(p).normalize().multiplyScalar(40);
          key.intensity = h.aboveHorizon ? 1.2 : 0.2;
        }
        if (focusId === h.id) focusTarget.copy(p);
      }
      return;
    }

    // Restore materials opacity for non-night
    for (const [, mesh] of meshes) {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.transparent = false;
      mat.opacity = 1;
    }

    if (mode === 'skymap') {
      if (earth) earth.visible = false;
      if (earthLab) earthLab.visible = false;

      for (const s of samples) {
        const node = nodes.get(s.id);
        const lab = labels.get(s.id);
        if (!node) continue;
        node.visible = true;
        const p = eclipticSkyPoint(s.lon, s.lat);
        node.position.copy(p);
        anchors.set(s.id, p.clone());
        node.lookAt(0, 0, 0);

        const vis = skyVisualSize(s.id);
        const base = baseSize.get(s.id) ?? 1;
        node.scale.setScalar(vis / base);

        if (lab) {
          lab.visible = true;
          updateLabel(lab, `${s.label}  ${formatLonShort(s.lon)}`);
          lab.position.copy(p.clone().normalize().multiplyScalar(SKY_R + vis * 1.4 + 2));
          lab.scale.set(12, 1.5, 1);
        }
        if (s.id === 'sun') key.position.copy(p).normalize().multiplyScalar(90);
        if (focusId === s.id) focusTarget.copy(p);
      }
      return;
    }

    // Orrery
    if (earth) {
      earth.visible = true;
      earth.position.set(0, 0, 0);
      earth.scale.setScalar(1);
      earth.rotation.x = 0;
      earth.rotation.z = 0;
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

    const sphereR = mode === 'night' ? NIGHT_R : mode === 'skymap' ? SKY_R : 0;

    for (const hit of hits) {
      if (!enabled.has(hit.kind)) continue;
      const a = anchors.get(hit.aId);
      const b = anchors.get(hit.bId);
      if (!a || !b) continue;

      const color = new THREE.Color(colorFor(hit.kind));
      const baseOp = 0.32 + 0.58 * hit.tightness;

      const pts =
        sphereR > 0 ? greatCircle(a, b, sphereR, 40) : [a.clone(), b.clone()];

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
        sphereR > 0
          ? greatCircle(a, b, sphereR, 2)[1]
          : a.clone().lerp(b, 0.5).add(new THREE.Vector3(0, 0.28, 0));
      const bead = new THREE.Mesh(
        new THREE.SphereGeometry(sphereR > 0 ? 0.5 : 0.17, 8, 8),
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
    if (node && node.visible) {
      focusTarget.copy(node.position);
      if (mode === 'night') {
        // Point look toward body
        const dir = node.position.clone().sub(new THREE.Vector3(0, 1.65, 0)).normalize();
        lookYaw = Math.atan2(dir.x, -dir.z);
        lookPitch = Math.asin(Math.max(-0.15, Math.min(0.99, dir.y)));
        applyNightLook();
      }
    }
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

  // Night-sky drag-to-look
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  canvas.addEventListener('pointerdown', (e) => {
    if (mode !== 'night') return;
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (mode !== 'night' || !dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    lookYaw -= dx * 0.0045;
    lookPitch -= dy * 0.0045;
    applyNightLook();
  });
  canvas.addEventListener('pointerup', (e) => {
    if (mode !== 'night') return;
    dragging = false;
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  });
  canvas.addEventListener(
    'wheel',
    (e) => {
      if (mode !== 'night') return;
      e.preventDefault();
      camera.fov = Math.max(35, Math.min(100, camera.fov + e.deltaY * 0.03));
      camera.updateProjectionMatrix();
    },
    { passive: false },
  );

  function tick(): void {
    const spin = reduced ? 0 : 1;
    if (mode === 'orrery') {
      for (const [id, node] of nodes) {
        node.rotation.y += (id === 'earth' ? 0.003 : id === 'moon' ? 0.004 : 0.0013) * spin;
      }
    }

    if (focusId && mode !== 'night') {
      controls.target.lerp(focusTarget, reduced ? 1 : 0.08);
    }

    if (mode === 'night') {
      applyNightLook();
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
      mesh.scale.setScalar(id === focusId ? 1.1 : 1);
    }

    if (mode !== 'night') controls.update();
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
    getLook: () => ({ yaw: lookYaw, pitch: lookPitch }),
    setLook: (yaw, pitch) => {
      lookYaw = yaw;
      lookPitch = pitch;
      if (mode === 'night') applyNightLook();
    },
    resize,
    tick,
    dispose,
    fps: () => fpsValue,
  };
}

function greatCircle(a: THREE.Vector3, b: THREE.Vector3, R: number, segs: number): THREE.Vector3[] {
  const aN = a.clone().normalize();
  const bN = b.clone().normalize();
  let dot = Math.min(1, Math.max(-1, aN.dot(bN)));
  const omega = Math.acos(dot);
  const pts: THREE.Vector3[] = [];
  if (omega < 1e-4) {
    pts.push(aN.multiplyScalar(R));
    return pts;
  }
  const sinO = Math.sin(omega);
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    pts.push(
      aN
        .clone()
        .multiplyScalar(Math.sin((1 - t) * omega) / sinO)
        .add(bN.clone().multiplyScalar(Math.sin(t * omega) / sinO))
        .normalize()
        .multiplyScalar(R),
    );
  }
  return pts;
}

function starfield(): THREE.Points {
  const n = 3200;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const r = 200 + Math.random() * 150;
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
      size: 0.3,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.78,
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

function skyDome(R: number): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.LineBasicMaterial({ color: '#1e2a3a', transparent: true, opacity: 0.35 });
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
  for (let lon = 0; lon < 360; lon += 30) {
    const pts: THREE.Vector3[] = [];
    const L = lon * D2R;
    for (let i = 0; i <= 64; i++) {
      const lat = (-90 + (180 * i) / 64) * D2R;
      const c = Math.cos(lat);
      pts.push(new THREE.Vector3(c * Math.cos(L) * R, Math.sin(lat) * R, c * Math.sin(L) * R));
    }
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat.clone()));
  }
  return g;
}

function groundDisc(R: number): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.CircleGeometry(R, 64),
    new THREE.MeshBasicMaterial({
      color: '#040506',
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.92,
    }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -0.05;
  return mesh;
}

function horizonRing(R: number): THREE.Line {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 180; i++) {
    const a = (i / 180) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.sin(a) * R, 0.02, -Math.cos(a) * R));
  }
  return new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color: '#c9a227', transparent: true, opacity: 0.45 }),
  );
}

function cardinalLabels(R: number): THREE.Group {
  const g = new THREE.Group();
  const marks: [string, number][] = [
    ['N', 0],
    ['E', 90],
    ['S', 180],
    ['W', 270],
  ];
  for (const [name, az] of marks) {
    const a = az * D2R;
    const spr = nameSprite(name);
    spr.position.set(Math.sin(a) * R * 0.92, 1.2, -Math.cos(a) * R * 0.92);
    spr.scale.set(8, 1.4, 1);
    g.add(spr);
  }
  return g;
}

function altitudeArcs(R: number): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.LineBasicMaterial({ color: '#1a2838', transparent: true, opacity: 0.4 });
  // Meridian N-S through zenith
  const meridian: THREE.Vector3[] = [];
  for (let i = 0; i <= 64; i++) {
    const alt = (-5 + (95 * i) / 64) * D2R;
    meridian.push(new THREE.Vector3(0, Math.sin(alt) * R, -Math.cos(alt) * R));
  }
  g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(meridian), mat));
  // 30° / 60° altitude rings
  for (const altDeg of [30, 60]) {
    const pts: THREE.Vector3[] = [];
    const alt = altDeg * D2R;
    const y = Math.sin(alt) * R;
    const rr = Math.cos(alt) * R;
    for (let i = 0; i <= 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.sin(a) * rr, y, -Math.cos(a) * rr));
    }
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat.clone()));
  }
  return g;
}

function zodiacTicks(R: number): THREE.Object3D[] {
  const signs = ['♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐', '♑', '♒', '♓'];
  const out: THREE.Object3D[] = [];
  for (let i = 0; i < 12; i++) {
    const lon = i * 30 + 15;
    const a = lon * D2R;
    const spr = nameSprite(signs[i]);
    spr.position.set(Math.cos(a) * R, 0.5, Math.sin(a) * R);
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
