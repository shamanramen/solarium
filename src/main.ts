/**
 * Solarium — orrery, sky map (from above), night sky (standing on Earth).
 */
import './ui.css';
import { CATALOG, type BodyId } from './catalog';
import { KINDS, findAspects, type Hit, type Kind } from './aspects';
import { addDays, positionsAt } from './positions';
import {
  DEFAULT_OBSERVER,
  PRESETS,
  horizonAt,
  type GeoObserver,
} from './horizon';
import { formatLon } from './zodiac';
import { createWorld, type ViewMode } from './world';

const SQUARE_SEED = '2020-01-20T12:00:00.000Z';

function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function boot(): void {
  const canvas = document.getElementById('viewport') as HTMLCanvasElement | null;
  const blocker = document.getElementById('no-webgl');
  if (!canvas) return;

  if (!hasWebGL()) {
    blocker?.removeAttribute('hidden');
    return;
  }

  const world = createWorld(canvas);
  const enabled = new Set<Kind>(KINDS.map((k) => k.kind));
  let when = new Date();
  let anchor = new Date(when);
  let selectedHit: Hit | null = null;
  let focusId: BodyId | null = null;
  let lastHits: Hit[] = [];
  let lastSamples = positionsAt(when);
  let observer: GeoObserver = { ...DEFAULT_OBSERVER };
  let viewMode: ViewMode = 'orrery';

  const whenInput = document.getElementById('when') as HTMLInputElement;
  const scrub = document.getElementById('scrub') as HTMLInputElement;
  const whenDisplay = document.getElementById('when-display')!;
  const switches = document.getElementById('aspect-switches')!;
  const hitsEl = document.getElementById('aspect-hits')!;
  const legend = document.getElementById('aspect-legend')!;
  const focusList = document.getElementById('focus-list')!;
  const focusDetail = document.getElementById('focus-detail')!;
  const aspectDetail = document.getElementById('aspect-detail')!;
  const frameLabel = document.getElementById('frame-label')!;
  const viewHint = document.getElementById('view-hint')!;
  const controlsHint = document.getElementById('controls-hint')!;
  const observerFields = document.getElementById('observer-fields')!;
  const obsLat = document.getElementById('obs-lat') as HTMLInputElement;
  const obsLon = document.getElementById('obs-lon') as HTMLInputElement;
  const obsReadout = document.getElementById('obs-readout')!;
  const placePresets = document.getElementById('place-presets')!;
  const btnOrrery = document.getElementById('view-orrery') as HTMLButtonElement;
  const btnSkymap = document.getElementById('view-skymap') as HTMLButtonElement;
  const btnNight = document.getElementById('view-night') as HTMLButtonElement;

  for (const p of PRESETS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'quiet';
    b.textContent = p.label;
    b.addEventListener('click', () => {
      observer = { ...p.observer };
      obsLat.value = String(observer.lat);
      obsLon.value = String(observer.lon);
      paint();
    });
    placePresets.append(b);
  }

  for (const body of CATALOG) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'focus-chip';
    btn.textContent = body.label;
    btn.dataset.id = body.id;
    btn.setAttribute('role', 'option');
    btn.addEventListener('click', () => setFocus(body.id));
    focusList.append(btn);
  }
  const clearFocus = document.createElement('button');
  clearFocus.type = 'button';
  clearFocus.className = 'focus-chip quiet';
  clearFocus.textContent = 'System';
  clearFocus.addEventListener('click', () => setFocus(null));
  focusList.prepend(clearFocus);

  for (const spec of KINDS) {
    const row = document.createElement('label');
    row.className = 'switch';
    row.style.setProperty('--chip', spec.color);

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = true;
    input.dataset.kind = spec.kind;
    input.setAttribute('aria-label', spec.label);

    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.style.background = spec.color;

    const name = document.createElement('span');
    name.textContent = spec.label;

    row.append(input, chip, name);
    switches.append(row);

    input.addEventListener('change', () => {
      if (input.checked) enabled.add(spec.kind);
      else enabled.delete(spec.kind);
      paint();
    });

    const li = document.createElement('li');
    const bar = document.createElement('span');
    bar.className = 'bar';
    bar.style.borderTopColor = spec.color;
    li.append(bar, document.createTextNode(spec.label));
    legend.append(li);
  }

  function setView(mode: ViewMode): void {
    viewMode = mode;
    world.setViewMode(mode);
    btnOrrery.classList.toggle('active', mode === 'orrery');
    btnSkymap.classList.toggle('active', mode === 'skymap');
    btnNight.classList.toggle('active', mode === 'night');
    btnOrrery.setAttribute('aria-pressed', String(mode === 'orrery'));
    btnSkymap.setAttribute('aria-pressed', String(mode === 'skymap'));
    btnNight.setAttribute('aria-pressed', String(mode === 'night'));

    observerFields.hidden = mode !== 'night';

    if (mode === 'night') {
      frameLabel.textContent = 'standing on Earth · local night sky · alt/az';
      viewHint.textContent =
        'Look around as if outside · drag to pan · scroll FOV · N/E/S/W on horizon';
      controlsHint.innerHTML =
        'Drag look · scroll FOV · click body · <span id="fps" class="mono">—</span>';
    } else if (mode === 'skymap') {
      frameLabel.textContent = 'from Earth · sky map · north ecliptic pole';
      viewHint.textContent =
        'Celestial sphere by true geo lon/lat · looking down from above';
      controlsHint.innerHTML =
        'Drag orbit · scroll zoom · click body · <span id="fps" class="mono">—</span>';
    } else {
      frameLabel.textContent = 'geocentric · aspects · readable scale';
      viewHint.textContent = 'Readable rings · top-down solar system';
      controlsHint.innerHTML =
        'Drag orbit · scroll zoom · click body · <span id="fps" class="mono">—</span>';
    }

    paint();
  }

  function setFocus(id: BodyId | null): void {
    focusId = id;
    world.focusBody(id);
    focusList.querySelectorAll<HTMLButtonElement>('.focus-chip').forEach((b) => {
      const isSystem = !b.dataset.id;
      b.classList.toggle('active', id === null ? isSystem : b.dataset.id === id);
    });
    updateFocusDetail();
  }

  function updateFocusDetail(): void {
    if (!focusId) {
      focusDetail.textContent =
        viewMode === 'night' ? 'Looking around the local sky' : 'Full system view';
      return;
    }
    if (viewMode === 'night') {
      const h = horizonAt(when, observer).find((x) => x.id === focusId);
      if (h) {
        focusDetail.textContent = `${h.label} · alt ${h.alt.toFixed(1)}° · az ${h.az.toFixed(1)}° · ${formatLon(h.lon)}`;
        return;
      }
    }
    const s = lastSamples.find((x) => x.id === focusId);
    if (!s) {
      const spec = CATALOG.find((b) => b.id === focusId);
      focusDetail.textContent = spec ? `${spec.label} · observer` : '—';
      return;
    }
    focusDetail.textContent = `${s.label} · ${formatLon(s.lon)} · ${s.distAu.toFixed(3)} AU`;
  }

  function showHitDetail(hit: Hit | null): void {
    selectedHit = hit;
    if (!hit) {
      aspectDetail.hidden = true;
      aspectDetail.textContent = '';
      return;
    }
    const kind = KINDS.find((k) => k.kind === hit.kind)!;
    aspectDetail.hidden = false;
    aspectDetail.innerHTML = `
      <strong>${hit.aLabel} ${kind.label.toLowerCase()} ${hit.bLabel}</strong>
      <span class="mono">${hit.orb.toFixed(2)}° orb · ${hit.motion} · sep ${hit.separation.toFixed(1)}°</span>
    `;
  }

  function setEnabledKinds(kinds: Kind[]): void {
    enabled.clear();
    for (const k of kinds) enabled.add(k);
    switches.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach((el) => {
      const k = el.dataset.kind as Kind;
      el.checked = enabled.has(k);
    });
    paint();
  }

  function readObserver(): void {
    const lat = Number(obsLat.value);
    const lon = Number(obsLon.value);
    if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
      observer = {
        lat: Math.max(-90, Math.min(90, lat)),
        lon: Math.max(-180, Math.min(180, lon)),
        heightM: observer.heightM,
      };
    }
  }

  function paint(): void {
    readObserver();
    lastSamples = positionsAt(when);
    const horizon = viewMode === 'night' ? horizonAt(when, observer) : [];
    world.place(lastSamples, horizon);
    lastHits = findAspects(lastSamples, enabled, when);
    world.drawAspects(lastHits, enabled);

    whenDisplay.textContent = when.toISOString().replace(/\.\d{3}Z$/, 'Z');
    if (document.activeElement !== whenInput) {
      whenInput.value = toLocalInput(when);
    }
    if (document.activeElement !== scrub) {
      const days = Math.round((when.getTime() - anchor.getTime()) / 86_400_000);
      scrub.value = String(Math.max(-365, Math.min(365, days)));
    }

    if (viewMode === 'night') {
      const up = horizon.filter((h) => h.aboveHorizon).length;
      obsReadout.textContent = `${observer.lat.toFixed(2)}°N  ${observer.lon.toFixed(2)}°E · ${up} bodies above horizon`;
    }

    hitsEl.replaceChildren();
    for (const hit of lastHits.slice(0, 28)) {
      const kind = KINDS.find((k) => k.kind === hit.kind)!;
      const li = document.createElement('li');
      li.tabIndex = 0;
      li.role = 'button';
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = kind.color;
      const pair = document.createElement('span');
      pair.className = 'pair';
      pair.textContent = `${hit.aLabel} ${kind.label.toLowerCase()} ${hit.bLabel}`;
      const orb = document.createElement('span');
      orb.className = 'orb';
      orb.textContent = `${hit.orb.toFixed(1)}° ${hit.motion[0]}`;
      li.append(dot, pair, orb);
      li.addEventListener('click', () => {
        showHitDetail(hit);
        setFocus(hit.aId as BodyId);
      });
      hitsEl.append(li);
    }

    if (selectedHit) {
      const still = lastHits.find(
        (h) =>
          h.kind === selectedHit!.kind &&
          h.aId === selectedHit!.aId &&
          h.bId === selectedHit!.bId,
      );
      showHitDetail(still ?? null);
    }

    updateFocusDetail();
  }

  function firstSquareDay(seed: Date): Date {
    const probe = new Date(seed);
    for (let i = 0; i < 400; i++) {
      const hits = findAspects(positionsAt(probe), new Set(['square']), probe);
      if (hits.length > 0) return new Date(probe);
      probe.setUTCDate(probe.getUTCDate() + 1);
    }
    return new Date(seed);
  }

  function setWhen(next: Date, resetAnchor = false): void {
    when = next;
    if (resetAnchor) {
      anchor = new Date(next);
      scrub.value = '0';
    }
    paint();
  }

  btnOrrery.addEventListener('click', () => setView('orrery'));
  btnSkymap.addEventListener('click', () => setView('skymap'));
  btnNight.addEventListener('click', () => setView('night'));

  obsLat.addEventListener('change', () => paint());
  obsLon.addEventListener('change', () => paint());

  document.getElementById('jump-now')!.addEventListener('click', () => {
    setWhen(new Date(), true);
  });

  document.getElementById('jump-squares')!.addEventListener('click', () => {
    setWhen(firstSquareDay(new Date(SQUARE_SEED)), true);
    setEnabledKinds(['square']);
  });

  document.getElementById('step-back-day')!.addEventListener('click', () => setWhen(addDays(when, -1)));
  document.getElementById('step-fwd-day')!.addEventListener('click', () => setWhen(addDays(when, 1)));
  document.getElementById('step-back-month')!.addEventListener('click', () => setWhen(addDays(when, -30)));
  document.getElementById('step-fwd-month')!.addEventListener('click', () => setWhen(addDays(when, 30)));

  document.getElementById('aspects-all')!.addEventListener('click', () =>
    setEnabledKinds(KINDS.map((k) => k.kind)),
  );
  document.getElementById('aspects-none')!.addEventListener('click', () => setEnabledKinds([]));
  document.getElementById('aspects-hard')!.addEventListener('click', () =>
    setEnabledKinds(['square', 'opposition', 'conjunction']),
  );
  document.getElementById('aspects-soft')!.addEventListener('click', () =>
    setEnabledKinds(['trine', 'sextile']),
  );

  scrub.addEventListener('input', () => {
    const days = Number(scrub.value);
    when = addDays(anchor, days);
    paint();
  });

  whenInput.addEventListener('change', () => {
    if (!whenInput.value) return;
    const next = new Date(whenInput.value);
    if (!Number.isNaN(next.getTime())) setWhen(next, true);
  });

  canvas.addEventListener('pointerdown', (e) => {
    const startX = e.clientX;
    const startY = e.clientY;
    const onUp = (up: PointerEvent) => {
      canvas.removeEventListener('pointerup', onUp);
      if (Math.hypot(up.clientX - startX, up.clientY - startY) > 6) return;
      const id = world.pick(up.clientX, up.clientY);
      if (id) setFocus(id);
    };
    canvas.addEventListener('pointerup', onUp);
  });

  window.addEventListener('resize', () => world.resize());
  paint();
  setFocus(null);

  function loop(): void {
    world.tick();
    const fps = document.getElementById('fps');
    if (fps) fps.textContent = `${world.fps()} fps`;
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  (window as unknown as { __solarium: unknown }).__solarium = {
    when: () => when,
    setWhen: (d: Date) => setWhen(d, true),
    samples: () => positionsAt(when),
    horizon: () => horizonAt(when, observer),
    hits: () => lastHits,
    view: () => world.getViewMode(),
    setView,
    observer: () => observer,
  };
}

boot();
