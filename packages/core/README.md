# @oozkul/dental-3d

Framework-free interactive 3D dental chart (odontogram) built on three.js. Every tooth is
clickable, takes a state (status, tint, badge) and reports selection. Teeth are addressed
by **FDI** code; labels can show FDI, Universal or Palmer.

**[Live demo](https://clickflick.github.io/odontogram/)** · [Angular wrapper](https://www.npmjs.com/package/@oozkul/dental-3d-angular) · [Repository](https://github.com/ClickFlick/odontogram)

```sh
npm install @oozkul/dental-3d three
```

`three` is a peer dependency (≥ 0.160) so you never end up with two copies.

## Usage

```ts
import { DentalViewer } from '@oozkul/dental-3d';

const viewer = new DentalViewer({
  container: document.querySelector('#chart')!, // give it a size in CSS
  labels: true,
  numbering: 'fdi',
});

viewer.on('select', ({ fdi, state }) => showHistory(fdi, state?.data));
viewer.on('hover', ({ fdi }) => {});
viewer.on('error', ({ error }) => console.error(error));

await viewer.ready;
viewer.setTeeth({
  '11': { status: 'crown' },
  '24': { status: 'missing' },
  '36': { status: 'filling', badge: 3, data: { visits: 3 } },
  '46': { tint: '#7c3aed' },
});

// later
viewer.dispose(); // frees GPU resources — call it when the container goes away
```

three.js and the model are imported **lazily** inside `DentalViewer`, so a page that never
creates a viewer never downloads them. The default model is bundled (≈ 290 kB, a separate
chunk in any bundler). Pass `modelUrl` to load your own glTF instead.

## Options

```ts
interface DentalViewerOptions {
  container: HTMLElement;
  modelUrl?: string; // glTF/GLB following the naming convention
  numbering?: 'fdi' | 'universal' | 'palmer';
  labels?: boolean; // tooth numbers as sprites
  theme?: Partial<Theme>; // explicit colours (win over CSS variables)
  cssVariables?: boolean; // read --dental-* from the container (default true)
  missingMode?: 'ghost' | 'hide';
  interaction?: { rotate?: boolean; zoom?: boolean; pan?: boolean };
  locale?: 'en' | 'ro' | Strings; // tooltip / screen-reader strings
  teeth?: TeethStates; // initial states
  view?: ViewName; // initial camera view
}
```

## Tooth state

```ts
interface ToothState {
  status?:
    | 'present'
    | 'missing'
    | 'implant'
    | 'crown'
    | 'filling'
    | 'root-canal'
    | 'bridge'
    | 'veneer'
    | 'extraction-planned'
    | 'attention';
  tint?: string; // any CSS colour; overrides the status colour
  badge?: string | number; // small pill next to the tooth
  disabled?: boolean; // not clickable / hoverable
  data?: unknown; // echoed back in events
}
```

## Methods

| Method                                                                                        | Notes                                                                               |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `ready: Promise<void>`                                                                        | Resolves when the model is loaded.                                                  |
| `setTeeth(states)` / `setTooth(fdi, s)`                                                       | Full replace (diffed) / single tooth (`null` clears).                               |
| `select(fdi, { focus? })`                                                                     | Programmatic selection; `focus` flies the camera to it.                             |
| `setView(view)`                                                                               | `front · left · right · upper-occlusal · lower-occlusal · reset`, animated ~400 ms. |
| `setJaw('both' \| 'upper' \| 'lower')`                                                        | Hides the other jaw.                                                                |
| `setOpen(boolean)`                                                                            | Animated mouth open/close.                                                          |
| `setNumbering` · `setLabels` · `setMissingMode` · `setTheme` · `setInteraction` · `setLocale` | Change options at runtime.                                                          |
| `on(event, handler): () => void`                                                              | `select · hover · ready · error`; returns an unsubscribe.                           |
| `resize()`                                                                                    | Normally automatic (ResizeObserver).                                                |
| `dispose()`                                                                                   | Releases everything.                                                                |
| `selected`, `hovered`, `state`, `theme`, `availableTeeth`                                     | Read-only getters.                                                                  |

`left`/`right` are the **patient's** sides, like FDI quadrants.

## Events

```ts
{ type: 'select', fdi: Fdi | null, state, pointer: { x, y } | null, source: 'pointer' | 'keyboard' | 'api' }
{ type: 'hover',  fdi: Fdi | null, state }
{ type: 'ready',  teeth: Fdi[] }
{ type: 'error',  error }
```

## Interaction

- Drag rotates, wheel/pinch zooms, right-drag pans (all switchable). Picking happens on pointer **up**, so drags never select. Double-click flies to the tooth.
- Keyboard (the canvas is focusable): `←`/`→` move along the arch, `↑`/`↓` jump to the opposing tooth, `Enter`/`Space` select, `Esc` clears, `1`–`5` switch views.
- Screen readers get a visually hidden list of buttons, one per tooth (`aria-pressed` for the selection).
- Rendering is on demand: nothing is drawn when nothing changed, and nothing at all while the container is off-screen or the tab is in the background.

## Theming

Set CSS custom properties on the container (or any ancestor); the viewer reads them and
re-reads when the document's `class`/`data-theme` changes or the OS colour scheme flips:

```css
.chart {
  --dental-tooth: #f2eee5;
  --dental-gums: #e39a99;
  --dental-hover: #5b9cff;
  --dental-selected: #2f7bf5;
  --dental-label: #334155;
  --dental-badge: #2f7bf5;
  --dental-badge-text: #fff;
  --dental-background: transparent;
  --dental-ghost-opacity: 0.18;
  --dental-status-crown: #d9b44a; /* one per status: missing, implant, crown, filling,
                                       root-canal, bridge, veneer, extraction-planned, attention */
  --dental-tooltip-bg: rgba(15, 23, 42, 0.9);
  --dental-tooltip-text: #fff;
}
```

The same keys exist on the `theme` option (`theme.statuses.crown`, …), which takes precedence.

## Helpers

`ALL_TEETH`, `UPPER_ARCH`, `LOWER_ARCH`, `isFdi`, `assertFdi`, `quadrant`, `position`, `isUpper`,
`isLower`, `jaw`, `side`, `toothType`, `toUniversal`, `fromUniversal`, `toPalmer`, `toPalmerText`,
`fromPalmerText`, `formatTooth`, `neighbour`, `opposing`, `toothName(fdi, locale)`, `STRINGS`,
`DEFAULT_THEME`, `readThemeFromCss`, `resolveModelName`, `toothCodeOf`.

## Custom models

Any glTF works as long as each tooth is a node named by its FDI code (`11`…`48`) and the gums
contain `gum` in their name. Scale in millimetres, +Y up, incisors towards +Z, patient's right
at −X. See [`docs/MODEL.md`](https://github.com/ClickFlick/odontogram/blob/main/docs/MODEL.md).

## License

MIT © ClickFlick
