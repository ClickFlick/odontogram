import type { Engine } from './engine.js';
import { resolveStrings } from './i18n.js';
import { ALL_TEETH, formatTooth, isFdi, neighbour, opposing } from './numbering.js';
import { DEFAULT_THEME, mergeTheme, readThemeFromCss } from './theme.js';
import type {
  DentalViewerOptions,
  Fdi,
  InteractionOptions,
  JawFilter,
  MissingMode,
  Numbering,
  SelectEvent,
  Strings,
  TeethStates,
  Theme,
  ToothState,
  ViewName,
  ViewerEvents,
  ViewerState,
} from './types.js';

type Handler<K extends keyof ViewerEvents> = (event: ViewerEvents[K]) => void;

const STYLE_ID = 'dental-3d-styles';
const CSS = `
.dental-3d{position:relative;display:block;width:100%;height:100%;min-height:120px;box-sizing:border-box}
.dental-3d__stage{position:absolute;inset:0;overflow:hidden;border-radius:inherit}
.dental-3d__stage:focus-visible{outline:2px solid var(--dental-selected,#2f7bf5);outline-offset:-2px}
.dental-3d__tooltip{position:absolute;pointer-events:none;z-index:2;padding:.3em .55em;border-radius:.4em;
  font:500 12px/1.3 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--dental-tooltip-text,#fff);
  background:var(--dental-tooltip-bg,rgba(15,23,42,.9));white-space:nowrap;transform:translate(-50%,calc(-100% - 12px));
  opacity:0;transition:opacity .12s}
.dental-3d__tooltip[data-visible]{opacity:1}
.dental-3d__status{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;
  font:13px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--dental-status-text,#64748b);text-align:center;padding:1em}
.dental-3d[data-state="ready"] .dental-3d__status{display:none}
.dental-3d__a11y{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);
  clip-path:inset(50%);white-space:nowrap;border:0;list-style:none}
`;

function ensureStyles(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  doc.head.appendChild(style);
}

/**
 * Framework-free interactive 3D dental chart.
 *
 * ```ts
 * const viewer = new DentalViewer({ container: document.querySelector('#chart')! });
 * viewer.on('select', (e) => console.log(e.fdi));
 * await viewer.ready;
 * viewer.setTeeth({ '36': { status: 'filling', badge: 3 } });
 * ```
 *
 * Call `dispose()` when the container is removed.
 */
export class DentalViewer {
  /** Resolves once the model is loaded and the first frame can be rendered. */
  readonly ready: Promise<void>;

  private engine: Engine | null = null;
  private state_: ViewerState = 'loading';
  private readonly root: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly tooltip: HTMLElement;
  private readonly status: HTMLElement;
  private readonly a11yList: HTMLUListElement;
  private readonly a11yButtons = new Map<Fdi, HTMLButtonElement>();
  private readonly handlers: { [K in keyof ViewerEvents]: Set<Handler<K>> } = {
    select: new Set(),
    hover: new Set(),
    ready: new Set(),
    error: new Set(),
  };

  private teeth: TeethStates = {};
  private selected_: Fdi | null = null;
  private hovered_: Fdi | null = null;
  private view_: ViewName = 'front';
  private jaw_: JawFilter = 'both';
  private open_ = false;
  private numbering_: Numbering = 'fdi';
  private labels_ = false;
  private missingMode_: MissingMode = 'ghost';
  private interaction_: InteractionOptions = {};
  private strings: Strings;
  private explicitTheme: Partial<Theme> | undefined;
  private theme_: Theme;
  private readonly useCssVars: boolean;
  private themeObserver: MutationObserver | null = null;
  private mediaQuery: MediaQueryList | null = null;
  private themeRefreshQueued = false;
  private loadedTeeth: Fdi[] = [];
  private disposed = false;

  constructor(private readonly options: DentalViewerOptions) {
    const container = options.container;
    if (!container) throw new Error('DentalViewer: options.container is required');
    const doc = container.ownerDocument;
    ensureStyles(doc);

    this.root = container;
    this.root.classList.add('dental-3d');
    this.root.dataset['state'] = 'loading';

    this.stage = doc.createElement('div');
    this.stage.className = 'dental-3d__stage';
    this.stage.tabIndex = 0;
    this.stage.setAttribute('role', 'application');

    this.tooltip = doc.createElement('div');
    this.tooltip.className = 'dental-3d__tooltip';
    this.tooltip.setAttribute('role', 'tooltip');

    this.status = doc.createElement('div');
    this.status.className = 'dental-3d__status';
    this.status.setAttribute('aria-live', 'polite');

    this.a11yList = doc.createElement('ul');
    this.a11yList.className = 'dental-3d__a11y';

    this.root.append(this.stage, this.tooltip, this.status, this.a11yList);

    this.strings = resolveStrings(options.locale);
    this.stage.setAttribute('aria-label', this.strings.teethList);
    this.a11yList.setAttribute('aria-label', this.strings.teethList);
    this.status.textContent = this.strings.loading;

    this.numbering_ = options.numbering ?? 'fdi';
    this.labels_ = options.labels ?? false;
    this.missingMode_ = options.missingMode ?? 'ghost';
    this.interaction_ = options.interaction ?? {};
    this.teeth = options.teeth ?? {};
    this.view_ = options.view ?? 'front';
    this.explicitTheme = options.theme;
    this.useCssVars = options.cssVariables ?? true;
    this.theme_ = this.computeTheme();

    this.stage.addEventListener('keydown', this.onKeyDown);
    this.stage.addEventListener('pointermove', this.onStagePointerMove);
    this.a11yList.addEventListener('click', this.onA11yClick);

    if (this.useCssVars) this.observeTheme(doc);

    this.ready = this.boot();
    // avoid unhandled rejection noise: errors are reported through the 'error' event
    this.ready.catch(() => undefined);
  }

  // -------------------------------------------------------------------------------------
  // public API

  get state(): ViewerState {
    return this.state_;
  }

  get selected(): Fdi | null {
    return this.selected_;
  }

  get hovered(): Fdi | null {
    return this.hovered_;
  }

  get theme(): Theme {
    return this.theme_;
  }

  /** FDI codes present in the loaded model (empty until ready). */
  get availableTeeth(): readonly Fdi[] {
    return this.loadedTeeth;
  }

  /** Replaces all tooth states (diffed internally). */
  setTeeth(states: TeethStates): void {
    this.teeth = { ...states };
    this.engine?.setTeeth(this.teeth, this.missingMode_);
    this.refreshA11y();
  }

  setTooth(fdi: Fdi, state: ToothState | null): void {
    const next = { ...this.teeth };
    if (state === null) delete next[fdi];
    else next[fdi] = state;
    this.setTeeth(next);
  }

  getTooth(fdi: Fdi): ToothState | undefined {
    return this.teeth[fdi];
  }

  /** Programmatic selection; `focus` flies the camera to the tooth. */
  select(fdi: Fdi | null, opts: { focus?: boolean } = {}): void {
    this.applySelection(fdi, 'api', null, opts.focus ?? false);
  }

  setView(view: ViewName): void {
    this.view_ = view;
    this.engine?.setView(view, true);
  }

  setJaw(jaw: JawFilter): void {
    this.jaw_ = jaw;
    this.engine?.setJaw(jaw);
  }

  get jaw(): JawFilter {
    return this.jaw_;
  }

  setOpen(open: boolean): void {
    this.open_ = open;
    this.engine?.setOpen(open, true);
  }

  get open(): boolean {
    return this.open_;
  }

  setNumbering(numbering: Numbering): void {
    this.numbering_ = numbering;
    this.engine?.setLabels(this.labelOptions());
    this.refreshA11y();
    if (this.hovered_) this.showTooltip(this.hovered_);
  }

  get numbering(): Numbering {
    return this.numbering_;
  }

  setLabels(labels: boolean): void {
    this.labels_ = labels;
    this.engine?.setLabels(this.labelOptions());
  }

  get labels(): boolean {
    return this.labels_;
  }

  setMissingMode(mode: MissingMode): void {
    this.missingMode_ = mode;
    this.engine?.setTeeth(this.teeth, mode);
  }

  setTheme(theme: Partial<Theme> | undefined): void {
    this.explicitTheme = theme;
    this.refreshTheme();
  }

  /**
   * Re-reads the `--dental-*` CSS variables. Called automatically when the document, body or
   * container change class/style attributes; call it yourself after changing variables on
   * another ancestor or through a stylesheet swap.
   */
  refreshTheme(): void {
    this.theme_ = this.computeTheme();
    this.engine?.setTheme(this.theme_);
  }

  setInteraction(opts: InteractionOptions): void {
    this.interaction_ = opts;
    this.engine?.setInteraction(opts);
  }

  setLocale(locale: DentalViewerOptions['locale']): void {
    this.strings = resolveStrings(locale);
    this.stage.setAttribute('aria-label', this.strings.teethList);
    this.a11yList.setAttribute('aria-label', this.strings.teethList);
    if (this.state_ === 'loading') this.status.textContent = this.strings.loading;
    if (this.state_ === 'error') this.status.textContent = this.strings.loadError;
    this.refreshA11y();
  }

  /** Formats a tooth for display in the current numbering system. */
  format(fdi: Fdi): string {
    return formatTooth(fdi, this.numbering_);
  }

  on<K extends keyof ViewerEvents>(event: K, handler: Handler<K>): () => void {
    const set = this.handlers[event] as Set<Handler<K>>;
    set.add(handler);
    return () => {
      set.delete(handler);
    };
  }

  /** Recomputes the canvas size; normally handled automatically by a ResizeObserver. */
  resize(): void {
    this.engine?.resize();
  }

  /** Frees GPU resources, observers and DOM. The viewer cannot be reused afterwards. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.state_ = 'disposed';
    this.engine?.dispose();
    this.engine = null;
    this.themeObserver?.disconnect();
    this.mediaQuery?.removeEventListener('change', this.onMediaChange);
    this.stage.removeEventListener('keydown', this.onKeyDown);
    this.stage.removeEventListener('pointermove', this.onStagePointerMove);
    this.a11yList.removeEventListener('click', this.onA11yClick);
    this.stage.remove();
    this.tooltip.remove();
    this.status.remove();
    this.a11yList.remove();
    this.root.classList.remove('dental-3d');
    delete this.root.dataset['state'];
    for (const set of Object.values(this.handlers)) set.clear();
  }

  /** Internals exposed for tests and debugging; not part of the stable API. */
  get debug(): {
    memory(): { geometries: number; textures: number };
    frames(): number;
    pick(x: number, y: number): Fdi | null;
  } {
    return {
      memory: () => this.engine?.memory() ?? { geometries: 0, textures: 0 },
      frames: () => this.engine?.frames ?? 0,
      pick: (x, y) => this.engine?.pick(x, y) ?? null,
    };
  }

  // -------------------------------------------------------------------------------------
  // boot

  private async boot(): Promise<void> {
    try {
      const { createEngine } = await import('./engine.js');
      if (this.disposed) return;
      const engine = createEngine({
        element: this.stage,
        onHover: (fdi) => this.applyHover(fdi),
        onPick: (fdi, pointer, double) => this.applySelection(fdi, 'pointer', pointer, double),
      });
      this.engine = engine;
      engine.setTheme(this.theme_);
      engine.setInteraction(this.interaction_);
      const source = this.options.modelUrl ?? (await loadDefaultModel());
      if (this.disposed) {
        engine.dispose();
        return;
      }
      this.loadedTeeth = await engine.load(source);
      if (this.disposed) {
        engine.dispose();
        return;
      }
      engine.setTeeth(this.teeth, this.missingMode_);
      engine.setLabels(this.labelOptions());
      engine.setJaw(this.jaw_);
      engine.setOpen(this.open_, false);
      engine.setView(this.view_, false);
      if (this.selected_) engine.setSelected(this.selected_, false);
      this.buildA11y();
      this.state_ = 'ready';
      this.root.dataset['state'] = 'ready';
      this.emit('ready', { type: 'ready', teeth: [...this.loadedTeeth] });
    } catch (error) {
      if (this.disposed) return;
      this.state_ = 'error';
      this.root.dataset['state'] = 'error';
      this.status.textContent = this.strings.loadError;
      this.emit('error', { type: 'error', error });
      throw error;
    }
  }

  private labelOptions() {
    return { enabled: this.labels_, format: (fdi: Fdi) => formatTooth(fdi, this.numbering_) };
  }

  private emit<K extends keyof ViewerEvents>(event: K, payload: ViewerEvents[K]): void {
    for (const h of this.handlers[event] as Set<Handler<K>>) {
      try {
        h(payload);
      } catch (err) {
        console.error(err);
      }
    }
  }

  // -------------------------------------------------------------------------------------
  // selection & hover

  private applySelection(
    fdi: Fdi | null,
    source: SelectEvent['source'],
    pointer: { x: number; y: number } | null,
    focus: boolean,
  ): void {
    if (
      fdi &&
      (this.teeth[fdi]?.disabled || (this.loadedTeeth.length && !this.loadedTeeth.includes(fdi)))
    ) {
      return;
    }
    const changed = fdi !== this.selected_;
    this.selected_ = fdi;
    this.engine?.setSelected(fdi, focus);
    if (changed) {
      for (const [code, btn] of this.a11yButtons) {
        btn.setAttribute('aria-pressed', String(code === fdi));
      }
    }
    if (changed || focus || source === 'pointer') {
      this.emit('select', {
        type: 'select',
        fdi,
        state: fdi ? this.teeth[fdi] : undefined,
        pointer,
        source,
      });
    }
  }

  private applyHover(fdi: Fdi | null): void {
    if (fdi && this.teeth[fdi]?.disabled) fdi = null;
    if (fdi === this.hovered_) return;
    this.hovered_ = fdi;
    this.engine?.setHover(fdi);
    if (fdi) this.showTooltip(fdi);
    else this.hideTooltip();
    this.emit('hover', { type: 'hover', fdi, state: fdi ? this.teeth[fdi] : undefined });
  }

  private describe(fdi: Fdi): string {
    const status = this.teeth[fdi]?.status;
    const parts = [
      `${this.strings.tooth} ${formatTooth(fdi, this.numbering_)}`,
      this.strings.names[fdi],
    ];
    if (status && status !== 'present') parts.push(this.strings.statuses[status]);
    return parts.join(' · ');
  }

  private showTooltip(fdi: Fdi): void {
    this.tooltip.textContent = this.describe(fdi);
    this.tooltip.dataset['visible'] = '';
  }

  private hideTooltip(): void {
    delete this.tooltip.dataset['visible'];
  }

  private readonly onStagePointerMove = (ev: PointerEvent): void => {
    if (ev.pointerType === 'touch') return;
    const rect = this.root.getBoundingClientRect();
    this.tooltip.style.left = `${ev.clientX - rect.left}px`;
    this.tooltip.style.top = `${ev.clientY - rect.top}px`;
  };

  // -------------------------------------------------------------------------------------
  // keyboard

  private readonly onKeyDown = (ev: KeyboardEvent): void => {
    if (ev.defaultPrevented || ev.altKey || ev.ctrlKey || ev.metaKey) return;
    const current = this.hovered_ ?? this.selected_;
    const move = (next: Fdi | null) => {
      if (!next) return;
      // skip disabled / absent teeth
      let candidate: Fdi | null = next;
      let guard = 0;
      while (
        candidate &&
        (this.teeth[candidate]?.disabled || !this.isLoaded(candidate)) &&
        guard++ < 16
      ) {
        const dir = ev.key === 'ArrowLeft' ? -1 : 1;
        candidate = neighbour(candidate, dir);
      }
      if (candidate) this.applyHover(candidate);
    };
    switch (ev.key) {
      case 'ArrowLeft':
      case 'ArrowRight': {
        ev.preventDefault();
        const dir = ev.key === 'ArrowLeft' ? -1 : 1;
        if (!current) {
          move(dir === 1 ? '11' : '21');
        } else {
          move(neighbour(current, dir));
        }
        break;
      }
      case 'ArrowUp':
      case 'ArrowDown': {
        ev.preventDefault();
        if (!current) move(ev.key === 'ArrowUp' ? '11' : '41');
        else move(opposing(current));
        break;
      }
      case 'Enter':
      case ' ': {
        if (!this.hovered_) return;
        ev.preventDefault();
        this.applySelection(this.hovered_, 'keyboard', null, false);
        break;
      }
      case 'Escape': {
        ev.preventDefault();
        if (this.selected_) this.applySelection(null, 'keyboard', null, false);
        else this.applyHover(null);
        break;
      }
      case '1':
      case '2':
      case '3':
      case '4':
      case '5': {
        ev.preventDefault();
        const views: ViewName[] = ['front', 'left', 'right', 'upper-occlusal', 'lower-occlusal'];
        this.setView(views[Number(ev.key) - 1]!);
        break;
      }
      default:
        return;
    }
  };

  private isLoaded(fdi: Fdi): boolean {
    return this.loadedTeeth.length === 0 || this.loadedTeeth.includes(fdi);
  }

  // -------------------------------------------------------------------------------------
  // accessibility list

  private buildA11y(): void {
    this.a11yList.textContent = '';
    this.a11yButtons.clear();
    const doc = this.root.ownerDocument;
    const codes = this.loadedTeeth.length ? this.loadedTeeth : ALL_TEETH;
    for (const fdi of codes) {
      const li = doc.createElement('li');
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.dataset['fdi'] = fdi;
      li.appendChild(btn);
      this.a11yList.appendChild(li);
      this.a11yButtons.set(fdi, btn);
    }
    this.refreshA11y();
  }

  private refreshA11y(): void {
    for (const [fdi, btn] of this.a11yButtons) {
      btn.textContent = this.describe(fdi);
      btn.setAttribute('aria-pressed', String(fdi === this.selected_));
      btn.disabled = Boolean(this.teeth[fdi]?.disabled);
    }
  }

  private readonly onA11yClick = (ev: Event): void => {
    const btn = (ev.target as HTMLElement).closest('button');
    const fdi = btn?.dataset['fdi'];
    if (!isFdi(fdi)) return;
    this.applySelection(this.selected_ === fdi ? null : fdi, 'keyboard', null, false);
  };

  // -------------------------------------------------------------------------------------
  // theme

  private computeTheme(): Theme {
    const fromCss = this.useCssVars ? readThemeFromCss(this.root) : undefined;
    return mergeTheme(DEFAULT_THEME, fromCss, this.explicitTheme);
  }

  private observeTheme(doc: Document): void {
    if (typeof MutationObserver === 'function') {
      this.themeObserver = new MutationObserver(() => this.queueThemeRefresh());
      const opts = {
        attributes: true,
        attributeFilter: ['class', 'style', 'data-theme', 'data-mode', 'color-scheme'],
      };
      this.themeObserver.observe(doc.documentElement, opts);
      if (doc.body) this.themeObserver.observe(doc.body, opts);
      // variables are often set on the container itself (or toggled via its class)
      this.themeObserver.observe(this.root, opts);
      if (this.root.parentElement && this.root.parentElement !== doc.body) {
        this.themeObserver.observe(this.root.parentElement, opts);
      }
    }
    if (typeof matchMedia === 'function') {
      this.mediaQuery = matchMedia('(prefers-color-scheme: dark)');
      this.mediaQuery.addEventListener('change', this.onMediaChange);
    }
  }

  private readonly onMediaChange = (): void => this.queueThemeRefresh();

  private queueThemeRefresh(): void {
    if (this.themeRefreshQueued || this.disposed) return;
    this.themeRefreshQueued = true;
    // a macrotask: lets the style recalculation settle and coalesces bursts of mutations
    setTimeout(() => {
      this.themeRefreshQueued = false;
      if (this.disposed) return;
      const next = this.computeTheme();
      if (JSON.stringify(next) !== JSON.stringify(this.theme_)) {
        this.theme_ = next;
        this.engine?.setTheme(next);
      }
    }, 0);
  }
}

/** Decodes the bundled default model (lazy chunk) into an ArrayBuffer. */
export async function loadDefaultModel(): Promise<ArrayBuffer> {
  const { DEFAULT_MODEL_BASE64 } = await import('./model/default-model.generated.js');
  return base64ToArrayBuffer(DEFAULT_MODEL_BASE64);
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  }
  // Node without atob (very old) – Buffer fallback
  const buf = (
    globalThis as unknown as { Buffer: { from(s: string, e: string): Uint8Array } }
  ).Buffer.from(b64, 'base64');
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}
