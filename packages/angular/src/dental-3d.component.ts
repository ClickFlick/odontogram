import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  NgZone,
  afterNextRender,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import {
  DentalViewer,
  type DentalViewerOptions,
  type Fdi,
  type HoverEvent,
  type InteractionOptions,
  type JawFilter,
  type MissingMode,
  type Numbering,
  type ReadyEvent,
  type SelectEvent,
  type Strings,
  type TeethStates,
  type Theme,
  type ViewName,
} from '@oozkul/dental-3d';

/**
 * Interactive 3D dental chart.
 *
 * ```html
 * <dental-3d
 *   [teeth]="teeth()"
 *   [selected]="selectedTooth()"
 *   numbering="fdi"
 *   [labels]="true"
 *   (selectedChange)="onSelect($event)"
 * />
 * ```
 *
 * The host is `display:block; position:relative` – give it a size. Colours follow the
 * `--dental-*` CSS custom properties on the host (see the core README), so the chart follows
 * your light/dark theme without any JavaScript.
 */
@Component({
  selector: 'dental-3d',
  standalone: true,
  template: '',
  styles: ':host{display:block;position:relative;min-height:120px}',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-state]': 'state()',
  },
})
export class Dental3dComponent {
  /** Per-tooth states, keyed by FDI code. */
  readonly teeth = input<TeethStates>({});
  /** Selected tooth (two-way friendly: `[(selected)]`). */
  readonly selected = input<Fdi | null>(null);
  readonly numbering = input<Numbering>('fdi');
  readonly labels = input<boolean>(false);
  readonly missingMode = input<MissingMode>('ghost');
  readonly view = input<ViewName>('front');
  readonly jaw = input<JawFilter>('both');
  readonly open = input<boolean>(false);
  /** Explicit theme overrides; CSS variables on the host are read automatically. */
  readonly theme = input<Partial<Theme> | undefined>(undefined);
  readonly interaction = input<InteractionOptions>({});
  readonly locale = input<'en' | 'ro' | string | Strings>('en');
  /** URL of a custom model following the naming convention; defaults to the bundled one. */
  readonly modelUrl = input<string | undefined>(undefined);
  /** Whether to read `--dental-*` CSS custom properties from the host. */
  readonly cssVariables = input<boolean>(true);

  /** Emits the FDI code (or null) whenever the selection changes, from any source. */
  readonly selectedChange = output<Fdi | null>();
  /** Full selection event, including the tooth state and the pointer position. */
  readonly select = output<SelectEvent>();
  readonly hoverChange = output<Fdi | null>();
  readonly hover = output<HoverEvent>();
  readonly ready = output<ReadyEvent>();
  readonly error = output<unknown>();

  /** `'loading' | 'ready' | 'error' | 'disposed'`, mirrored to the `data-state` attribute. */
  readonly state = signal<'loading' | 'ready' | 'error' | 'disposed'>('loading');

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly zone = inject(NgZone);
  private readonly viewer = signal<DentalViewer | null>(null);
  private lastEmittedSelection: Fdi | null | undefined = undefined;

  constructor() {
    const destroyRef = inject(DestroyRef);

    afterNextRender(() => {
      const viewer = this.zone.runOutsideAngular(
        () =>
          new DentalViewer({
            container: this.host.nativeElement,
            teeth: untracked(this.teeth),
            numbering: untracked(this.numbering),
            labels: untracked(this.labels),
            missingMode: untracked(this.missingMode),
            view: untracked(this.view),
            theme: untracked(this.theme),
            interaction: untracked(this.interaction),
            locale: untracked(this.locale) as DentalViewerOptions['locale'],
            modelUrl: untracked(this.modelUrl),
            cssVariables: untracked(this.cssVariables),
          }),
      );
      viewer.on('select', (e) => {
        this.zone.run(() => {
          if (e.fdi !== this.lastEmittedSelection) {
            this.lastEmittedSelection = e.fdi;
            this.selectedChange.emit(e.fdi);
          }
          this.select.emit(e);
        });
      });
      viewer.on('hover', (e) => {
        this.zone.run(() => {
          this.hoverChange.emit(e.fdi);
          this.hover.emit(e);
        });
      });
      viewer.on('ready', (e) => {
        this.zone.run(() => {
          this.state.set('ready');
          const sel = untracked(this.selected);
          if (sel) viewer.select(sel);
          viewer.setJaw(untracked(this.jaw));
          viewer.setOpen(untracked(this.open));
          this.ready.emit(e);
        });
      });
      viewer.on('error', (e) => {
        this.zone.run(() => {
          this.state.set('error');
          this.error.emit(e.error);
        });
      });
      this.viewer.set(viewer);
    });

    // push input changes into the viewer
    const sync = <T>(read: () => T, apply: (viewer: DentalViewer, value: T) => void) => {
      effect(() => {
        const viewer = this.viewer();
        const value = read();
        if (!viewer) return;
        untracked(() => this.zone.runOutsideAngular(() => apply(viewer, value)));
      });
    };
    sync(this.teeth, (v, teeth) => v.setTeeth(teeth));
    sync(this.numbering, (v, n) => v.setNumbering(n));
    sync(this.labels, (v, on) => v.setLabels(on));
    sync(this.missingMode, (v, m) => v.setMissingMode(m));
    sync(this.view, (v, view) => v.setView(view));
    sync(this.jaw, (v, jaw) => v.setJaw(jaw));
    sync(this.open, (v, open) => v.setOpen(open));
    sync(this.theme, (v, theme) => v.setTheme(theme));
    sync(this.interaction, (v, i) => v.setInteraction(i));
    sync(this.locale, (v, l) => v.setLocale(l as DentalViewerOptions['locale']));
    sync(this.selected, (v, fdi) => {
      if (v.selected !== fdi) {
        this.lastEmittedSelection = fdi;
        v.select(fdi);
      }
    });

    destroyRef.onDestroy(() => {
      const viewer = this.viewer();
      viewer?.dispose();
      this.viewer.set(null);
      this.state.set('disposed');
    });
  }

  /** The underlying viewer, for anything the inputs do not cover (camera views, focus…). */
  get dentalViewer(): DentalViewer | null {
    return this.viewer();
  }
}
