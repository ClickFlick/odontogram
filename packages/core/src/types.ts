/** Permanent teeth, FDI two-digit notation. */
export type Fdi =
  | '11'
  | '12'
  | '13'
  | '14'
  | '15'
  | '16'
  | '17'
  | '18'
  | '21'
  | '22'
  | '23'
  | '24'
  | '25'
  | '26'
  | '27'
  | '28'
  | '31'
  | '32'
  | '33'
  | '34'
  | '35'
  | '36'
  | '37'
  | '38'
  | '41'
  | '42'
  | '43'
  | '44'
  | '45'
  | '46'
  | '47'
  | '48';

export type Quadrant = 1 | 2 | 3 | 4;
export type Jaw = 'upper' | 'lower';
export type ToothType = 'incisor' | 'canine' | 'premolar' | 'molar';

export type ToothStatus =
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

export const TOOTH_STATUSES: readonly ToothStatus[] = [
  'present',
  'missing',
  'implant',
  'crown',
  'filling',
  'root-canal',
  'bridge',
  'veneer',
  'extraction-planned',
  'attention',
];

export interface ToothState {
  /** Drives material and visibility (`missing` is ghosted or hidden, see `missingMode`). */
  status?: ToothStatus;
  /** Any CSS colour; overrides the status colour. */
  tint?: string;
  /** Small label rendered next to the tooth (e.g. a visit count). */
  badge?: string | number;
  /** Not clickable, not hoverable, skipped by keyboard navigation. */
  disabled?: boolean;
  /** Consumer payload, echoed back in events. */
  data?: unknown;
}

export type TeethStates = Partial<Record<Fdi, ToothState>>;

export type Numbering = 'fdi' | 'universal' | 'palmer';
export type MissingMode = 'ghost' | 'hide';
export type ViewName = 'front' | 'left' | 'right' | 'upper-occlusal' | 'lower-occlusal' | 'reset';
export type JawFilter = 'both' | 'upper' | 'lower';

export interface Theme {
  /** Base enamel colour. */
  tooth: string;
  /** Gum colour. */
  gums: string;
  /** Emissive highlight for the hovered tooth. */
  hover: string;
  /** Emissive highlight for the selected tooth. */
  selected: string;
  /** Text colour of number labels. */
  label: string;
  /** Background of number labels (any CSS colour, may be translucent). */
  labelBackground: string;
  /** Background colour of badges. */
  badge: string;
  /** Text colour of badges. */
  badgeText: string;
  /** Scene background; `'transparent'` (default) shows the page behind the canvas. */
  background: string;
  /** Opacity of ghosted (missing) teeth, 0..1. */
  ghostOpacity: number;
  /** Colour per status; `present` uses `tooth`. */
  statuses: Record<Exclude<ToothStatus, 'present'>, string>;
}

export interface InteractionOptions {
  rotate?: boolean;
  zoom?: boolean;
  pan?: boolean;
}

/** Strings shown in tooltips and read by screen readers. */
export interface Strings {
  /** e.g. "Tooth" */
  tooth: string;
  /** Status labels. */
  statuses: Record<ToothStatus, string>;
  /** Tooth names by FDI code, e.g. "Upper right central incisor". */
  names: Record<Fdi, string>;
  /** Label of the hidden list of teeth for assistive technology. */
  teethList: string;
  /** Message shown while the model loads. */
  loading: string;
  /** Message shown when the model failed to load. */
  loadError: string;
}

export interface DentalViewerOptions {
  container: HTMLElement;
  /** URL of a glTF/GLB following the naming convention; defaults to the bundled model. */
  modelUrl?: string;
  /** Numbering system used for labels and tooltips. The API always uses FDI. */
  numbering?: Numbering;
  /** Render tooth numbers as sprites next to each tooth. */
  labels?: boolean;
  theme?: Partial<Theme>;
  /**
   * Read `--dental-*` CSS custom properties from the container and follow changes to the
   * document's theme (class/attribute changes on `<html>`, `prefers-color-scheme`).
   * Explicit `theme` values take precedence. Default `true`.
   */
  cssVariables?: boolean;
  missingMode?: MissingMode;
  interaction?: InteractionOptions;
  /** `'en'`, `'ro'`, or a full `Strings` object. */
  locale?: 'en' | 'ro' | string | Strings;
  /** Initial per-tooth states. */
  teeth?: TeethStates;
  /** Initial camera view. Default `'front'`. */
  view?: ViewName;
}

export interface SelectEvent {
  type: 'select';
  fdi: Fdi | null;
  state: ToothState | undefined;
  /** Pointer position relative to the container, if the selection came from a pointer. */
  pointer: { x: number; y: number } | null;
  /** What triggered the selection. */
  source: 'pointer' | 'keyboard' | 'api';
}

export interface HoverEvent {
  type: 'hover';
  fdi: Fdi | null;
  state: ToothState | undefined;
}

export interface ReadyEvent {
  type: 'ready';
  /** FDI codes found in the loaded model. */
  teeth: Fdi[];
}

export interface ErrorEvent {
  type: 'error';
  error: unknown;
}

export interface ViewerEvents {
  select: SelectEvent;
  hover: HoverEvent;
  ready: ReadyEvent;
  error: ErrorEvent;
}

export type ViewerState = 'loading' | 'ready' | 'error' | 'disposed';
