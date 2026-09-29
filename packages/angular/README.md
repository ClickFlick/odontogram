# @oozkul/dental-3d-angular

Angular standalone component wrapping [`@oozkul/dental-3d`](https://www.npmjs.com/package/@oozkul/dental-3d):
an interactive 3D dental chart (odontogram) with clickable teeth, per-tooth status and FDI /
Universal / Palmer numbering. Signal inputs, outputs, `OnPush`, zoneless-friendly.

**[Live demo](https://clickflick.github.io/odontogram/)** · [Repository](https://github.com/ClickFlick/odontogram)

```sh
npm install @oozkul/dental-3d-angular @oozkul/dental-3d three
```

Requires Angular ≥ 21.

## Usage

```ts
import { Component, signal } from '@angular/core';
import { Dental3dComponent, type Fdi, type TeethStates } from '@oozkul/dental-3d-angular';

@Component({
  selector: 'app-teeth',
  imports: [Dental3dComponent],
  template: `
    <dental-3d
      class="chart"
      [teeth]="teeth()"
      [selected]="selected()"
      numbering="fdi"
      [labels]="true"
      missingMode="ghost"
      (selectedChange)="selected.set($event)"
      (hoverChange)="hovered.set($event)"
      (ready)="onReady()"
    />
  `,
  styles: `
    .chart {
      height: 480px;
      --dental-selected: var(--primary);
    }
  `,
})
export class TeethComponent {
  teeth = signal<TeethStates>({ '36': { status: 'filling', badge: 3 } });
  selected = signal<Fdi | null>(null);
  hovered = signal<Fdi | null>(null);
  onReady() {}
}
```

The host is `display: block; position: relative` and has no size of its own — set a height.
Toolbar buttons (views, jaw, open/close) are intentionally not part of the component: grab the
viewer via `dentalViewer` and call `setView`, `setJaw`, `setOpen`, `select(fdi, { focus: true })`.

```ts
@ViewChild(Dental3dComponent) chart!: Dental3dComponent;
front() { this.chart.dentalViewer?.setView('front'); }
```

## Inputs

| Input          | Type                               | Default   |
| -------------- | ---------------------------------- | --------- |
| `teeth`        | `TeethStates`                      | `{}`      |
| `selected`     | `Fdi \| null`                      | `null`    |
| `numbering`    | `'fdi' \| 'universal' \| 'palmer'` | `'fdi'`   |
| `labels`       | `boolean`                          | `false`   |
| `missingMode`  | `'ghost' \| 'hide'`                | `'ghost'` |
| `view`         | `ViewName`                         | `'front'` |
| `jaw`          | `'both' \| 'upper' \| 'lower'`     | `'both'`  |
| `open`         | `boolean`                          | `false`   |
| `theme`        | `Partial<Theme>`                   | –         |
| `interaction`  | `{ rotate?, zoom?, pan? }`         | `{}`      |
| `locale`       | `'en' \| 'ro' \| Strings`          | `'en'`    |
| `modelUrl`     | `string`                           | bundled   |
| `cssVariables` | `boolean`                          | `true`    |

## Outputs

| Output           | Payload                                           |
| ---------------- | ------------------------------------------------- |
| `selectedChange` | `Fdi \| null`                                     |
| `select`         | `SelectEvent` (with `state`, `pointer`, `source`) |
| `hoverChange`    | `Fdi \| null`                                     |
| `hover`          | `HoverEvent`                                      |
| `ready`          | `ReadyEvent` (`teeth: Fdi[]`)                     |
| `error`          | `unknown`                                         |

The `data-state` attribute on the host is `loading`, `ready` or `error` — style a skeleton with
`dental-3d[data-state="loading"]`.

## Theming

The component reads `--dental-*` CSS custom properties from its host, so map your design tokens
once in the component stylesheet:

```css
dental-3d {
  --dental-selected: var(--primary);
  --dental-badge: var(--primary);
  --dental-label: var(--foreground);
}
```

Full list of variables and the core API in the
[core README](https://www.npmjs.com/package/@oozkul/dental-3d).

## License

MIT © ClickFlick
