import type { Theme, ToothStatus } from './types.js';

export const DEFAULT_THEME: Theme = {
  tooth: '#f2eee5',
  gums: '#e39a99',
  hover: '#5b9cff',
  selected: '#2f7bf5',
  label: '#334155',
  badge: '#2f7bf5',
  badgeText: '#ffffff',
  background: 'transparent',
  ghostOpacity: 0.18,
  statuses: {
    missing: '#f2eee5',
    implant: '#8fa4b8',
    crown: '#d9b44a',
    filling: '#a9b3bd',
    'root-canal': '#b388d9',
    bridge: '#c8a76b',
    veneer: '#e6dcff',
    'extraction-planned': '#e26060',
    attention: '#f2a33a',
  },
};

/** Maps a theme key to the CSS custom property that overrides it. */
export const THEME_CSS_VARS: Record<Exclude<keyof Theme, 'statuses'>, string> = {
  tooth: '--dental-tooth',
  gums: '--dental-gums',
  hover: '--dental-hover',
  selected: '--dental-selected',
  label: '--dental-label',
  badge: '--dental-badge',
  badgeText: '--dental-badge-text',
  background: '--dental-background',
  ghostOpacity: '--dental-ghost-opacity',
};

export function statusCssVar(status: Exclude<ToothStatus, 'present'>): string {
  return `--dental-status-${status}`;
}

/** Deep-merges a partial theme onto a base theme. */
export function mergeTheme(base: Theme, ...overrides: (Partial<Theme> | undefined)[]): Theme {
  const out: Theme = { ...base, statuses: { ...base.statuses } };
  for (const o of overrides) {
    if (!o) continue;
    for (const [k, v] of Object.entries(o)) {
      if (v === undefined) continue;
      if (k === 'statuses') Object.assign(out.statuses, v as Theme['statuses']);
      else (out as unknown as Record<string, unknown>)[k] = v;
    }
  }
  return out;
}

/**
 * Reads `--dental-*` custom properties from the computed style of `element`. Only
 * properties that are set are returned, so the result can be merged over defaults.
 */
export function readThemeFromCss(element: Element): Partial<Theme> {
  if (typeof getComputedStyle !== 'function') return {};
  const cs = getComputedStyle(element);
  const out: Partial<Theme> = {};
  for (const [key, cssVar] of Object.entries(THEME_CSS_VARS) as [
    keyof typeof THEME_CSS_VARS,
    string,
  ][]) {
    const raw = cs.getPropertyValue(cssVar).trim();
    if (!raw) continue;
    if (key === 'ghostOpacity') {
      const n = Number.parseFloat(raw);
      if (!Number.isNaN(n)) out.ghostOpacity = n;
    } else {
      out[key] = raw;
    }
  }
  const statuses: Partial<Theme['statuses']> = {};
  let any = false;
  for (const status of Object.keys(DEFAULT_THEME.statuses) as (keyof Theme['statuses'])[]) {
    const raw = cs.getPropertyValue(statusCssVar(status)).trim();
    if (raw) {
      statuses[status] = raw;
      any = true;
    }
  }
  if (any) out.statuses = statuses as Theme['statuses'];
  return out;
}
