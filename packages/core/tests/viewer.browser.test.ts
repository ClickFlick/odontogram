/**
 * Runs in headless Chromium (software WebGL) through @vitest/browser-playwright.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { DentalViewer } from '../src/index.js';
import type { Fdi, SelectEvent } from '../src/index.js';

const viewers: DentalViewer[] = [];
const containers: HTMLElement[] = [];

function makeContainer(): HTMLElement {
  const el = document.createElement('div');
  el.style.width = '640px';
  el.style.height = '420px';
  document.body.appendChild(el);
  containers.push(el);
  return el;
}

function create(opts: Partial<ConstructorParameters<typeof DentalViewer>[0]> = {}): DentalViewer {
  const viewer = new DentalViewer({ container: makeContainer(), ...opts });
  viewers.push(viewer);
  return viewer;
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

afterEach(() => {
  for (const v of viewers) v.dispose();
  viewers.length = 0;
  for (const c of containers) c.remove();
  containers.length = 0;
});

describe('DentalViewer', () => {
  it('loads the bundled model and reports 32 teeth', async () => {
    const viewer = create();
    const ready = new Promise<Fdi[]>((resolve) => viewer.on('ready', (e) => resolve(e.teeth)));
    await viewer.ready;
    expect(viewer.state).toBe('ready');
    expect(await ready).toHaveLength(32);
    expect(viewer.availableTeeth).toContain('11');
    expect(viewer.availableTeeth).toContain('48');
    expect(containers[0]!.dataset['state']).toBe('ready');
  });

  it('renders on demand and then goes idle', async () => {
    const viewer = create();
    await viewer.ready;
    // let the initial resize / label work settle
    await new Promise((r) => setTimeout(r, 300));
    await nextFrame();
    const before = viewer.debug.frames();
    expect(before).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 300));
    expect(viewer.debug.frames()).toBe(before);
    // any state change renders again, exactly once
    viewer.setTeeth({ '11': { status: 'crown' } });
    await nextFrame();
    await nextFrame();
    expect(viewer.debug.frames()).toBe(before + 1);
  });

  it('selects programmatically and emits select events', async () => {
    const viewer = create();
    await viewer.ready;
    const events: SelectEvent[] = [];
    viewer.on('select', (e) => events.push(e));
    viewer.setTeeth({ '36': { status: 'filling', badge: 3, data: { visits: 3 } } });
    viewer.select('36');
    expect(viewer.selected).toBe('36');
    expect(events).toHaveLength(1);
    expect(events[0]!.fdi).toBe('36');
    expect(events[0]!.source).toBe('api');
    expect(events[0]!.state?.data).toEqual({ visits: 3 });
    viewer.select(null);
    expect(events[1]!.fdi).toBeNull();
  });

  it('picks every tooth from a view where it is visible', async () => {
    const viewer = create({ view: 'front' });
    await viewer.ready;
    viewer.setJaw('upper');
    viewer.setView('upper-occlusal');
    await new Promise((r) => setTimeout(r, 600));
    await nextFrame();
    // scan the canvas and collect the teeth hit
    const el = containers[0]!;
    const found = new Set<Fdi>();
    for (let y = 10; y < el.clientHeight; y += 8) {
      for (let x = 10; x < el.clientWidth; x += 8) {
        const fdi = viewer.debug.pick(x, y);
        if (fdi) found.add(fdi);
      }
    }
    const upper = [...found].filter((f) => f.startsWith('1') || f.startsWith('2'));
    expect(upper.length).toBe(16);
    expect([...found].every((f) => f.startsWith('1') || f.startsWith('2'))).toBe(true);
  });

  it('ignores disabled teeth and hides missing ones in hide mode', async () => {
    const viewer = create({ missingMode: 'hide' });
    await viewer.ready;
    viewer.setTeeth({ '11': { disabled: true }, '21': { status: 'missing' } });
    const events: SelectEvent[] = [];
    viewer.on('select', (e) => events.push(e));
    viewer.select('11');
    expect(viewer.selected).toBeNull();
    expect(events).toHaveLength(0);
    viewer.setView('front');
    await new Promise((r) => setTimeout(r, 600));
    await nextFrame();
    const el = containers[0]!;
    const found = new Set<Fdi>();
    for (let y = 10; y < el.clientHeight; y += 6) {
      for (let x = 10; x < el.clientWidth; x += 6) {
        const fdi = viewer.debug.pick(x, y);
        if (fdi) found.add(fdi);
      }
    }
    expect(found.has('21')).toBe(false);
    expect(found.has('11')).toBe(false); // disabled
    expect(found.has('12')).toBe(true);
  });

  it('exposes a hidden list of buttons for assistive technology', async () => {
    const viewer = create({ teeth: { '46': { status: 'crown' } } });
    await viewer.ready;
    const el = containers[0]!;
    const buttons = el.querySelectorAll<HTMLButtonElement>('.dental-3d__a11y button');
    expect(buttons).toHaveLength(32);
    const b46 = [...buttons].find((b) => b.dataset['fdi'] === '46')!;
    expect(b46.textContent).toContain('Tooth 46');
    expect(b46.textContent).toContain('Lower right first molar');
    expect(b46.textContent).toContain('Crown');
    expect(b46.getAttribute('aria-pressed')).toBe('false');
    b46.click();
    expect(viewer.selected).toBe('46');
    expect(b46.getAttribute('aria-pressed')).toBe('true');
  });

  it('navigates with the keyboard', async () => {
    const viewer = create();
    await viewer.ready;
    const el = containers[0]!;
    const stage = el.querySelector<HTMLElement>('.dental-3d__stage')!;
    const key = (k: string) =>
      stage.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    key('ArrowRight');
    expect(viewer.hovered).toBe('11');
    key('ArrowRight');
    expect(viewer.hovered).toBe('21');
    key('ArrowDown');
    expect(viewer.hovered).toBe('31');
    key('Enter');
    expect(viewer.selected).toBe('31');
    key('Escape');
    expect(viewer.selected).toBeNull();
  });

  it('follows CSS custom properties', async () => {
    const container = makeContainer();
    container.style.setProperty('--dental-tooth', '#ff0000');
    container.style.setProperty('--dental-status-crown', 'rgb(0, 255, 0)');
    const viewer = new DentalViewer({ container });
    viewers.push(viewer);
    await viewer.ready;
    expect(viewer.theme.tooth).toBe('#ff0000');
    expect(viewer.theme.statuses.crown).toBe('rgb(0, 255, 0)');
    expect(viewer.theme.gums).toBe('#e39a99');
  });

  it('frees GPU resources on dispose and survives 20 create/dispose cycles', async () => {
    for (let i = 0; i < 20; i++) {
      const container = makeContainer();
      const viewer = new DentalViewer({ container, labels: true, teeth: { '11': { badge: i } } });
      await viewer.ready;
      await nextFrame();
      const mem = viewer.debug.memory();
      expect(mem.geometries).toBeGreaterThan(30);
      expect(mem.textures).toBeGreaterThan(0);
      viewer.dispose();
      expect(viewer.state).toBe('disposed');
      expect(container.querySelector('canvas')).toBeNull();
      container.remove();
    }
  });
});
