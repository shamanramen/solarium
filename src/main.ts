/**
 * Solarium — fresh walking skeleton entry.
 * Live sky positions + major aspect chords. No natal, no VR, no Asteria merge.
 */
import './ui.css';
import { KINDS, findAspects, type Kind } from './aspects';
import { positionsAt } from './positions';
import { createWorld } from './world';

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

  const whenInput = document.getElementById('when') as HTMLInputElement;
  const whenDisplay = document.getElementById('when-display')!;
  const switches = document.getElementById('aspect-switches')!;
  const hitsEl = document.getElementById('aspect-hits')!;
  const legend = document.getElementById('aspect-legend')!;
  const fpsEl = document.getElementById('fps')!;

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

  function paint(): void {
    const samples = positionsAt(when);
    world.place(samples);
    const hits = findAspects(samples, enabled);
    world.drawAspects(hits, enabled);

    whenDisplay.textContent = when.toISOString().replace('.000Z', 'Z');
    if (document.activeElement !== whenInput) {
      whenInput.value = toLocalInput(when);
    }

    hitsEl.replaceChildren();
    for (const hit of hits.slice(0, 24)) {
      const kind = KINDS.find((k) => k.kind === hit.kind)!;
      const li = document.createElement('li');
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = kind.color;
      const pair = document.createElement('span');
      pair.className = 'pair';
      pair.textContent = `${hit.aLabel} ${kind.label.toLowerCase()} ${hit.bLabel}`;
      const orb = document.createElement('span');
      orb.className = 'orb';
      orb.textContent = `${hit.orb.toFixed(1)}°`;
      li.append(dot, pair, orb);
      hitsEl.append(li);
    }
  }

  function firstSquareDay(seed: Date): Date {
    const probe = new Date(seed);
    for (let i = 0; i < 400; i++) {
      const hits = findAspects(positionsAt(probe), new Set(['square']));
      if (hits.length > 0) return new Date(probe);
      probe.setUTCDate(probe.getUTCDate() + 1);
    }
    return new Date(seed);
  }

  document.getElementById('jump-now')!.addEventListener('click', () => {
    when = new Date();
    paint();
  });

  document.getElementById('jump-squares')!.addEventListener('click', () => {
    when = firstSquareDay(new Date(SQUARE_SEED));
    enabled.clear();
    enabled.add('square');
    switches.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach((el) => {
      el.checked = el.dataset.kind === 'square';
    });
    paint();
  });

  whenInput.addEventListener('change', () => {
    if (!whenInput.value) return;
    const next = new Date(whenInput.value);
    if (!Number.isNaN(next.getTime())) {
      when = next;
      paint();
    }
  });

  window.addEventListener('resize', () => world.resize());
  paint();

  function loop(): void {
    world.tick();
    fpsEl.textContent = `${world.fps()} fps`;
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  (window as unknown as { __solarium: unknown }).__solarium = {
    when: () => when,
    setWhen: (d: Date) => {
      when = d;
      paint();
    },
    samples: () => positionsAt(when),
  };
}

boot();
