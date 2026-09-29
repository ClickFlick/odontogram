import { ALL_TEETH, position, quadrant } from './numbering.js';
import type { Fdi, Strings, ToothStatus } from './types.js';

const POSITION_EN = [
  'central incisor',
  'lateral incisor',
  'canine',
  'first premolar',
  'second premolar',
  'first molar',
  'second molar',
  'third molar',
];
const QUADRANT_EN = ['upper right', 'upper left', 'lower left', 'lower right'];

const POSITION_RO = [
  'incisiv central',
  'incisiv lateral',
  'canin',
  'primul premolar',
  'al doilea premolar',
  'primul molar',
  'al doilea molar',
  'al treilea molar',
];
const QUADRANT_RO = ['superior dreapta', 'superior stânga', 'inferior stânga', 'inferior dreapta'];

function names(
  quadrants: string[],
  positions: string[],
  join: (q: string, p: string) => string,
): Record<Fdi, string> {
  const out = {} as Record<Fdi, string>;
  for (const fdi of ALL_TEETH) {
    const q = quadrants[quadrant(fdi) - 1]!;
    const p = positions[position(fdi) - 1]!;
    const s = join(q, p);
    out[fdi] = s.charAt(0).toUpperCase() + s.slice(1);
  }
  return out;
}

const STATUS_EN: Record<ToothStatus, string> = {
  present: 'Present',
  missing: 'Missing',
  implant: 'Implant',
  crown: 'Crown',
  filling: 'Filling',
  'root-canal': 'Root canal',
  bridge: 'Bridge',
  veneer: 'Veneer',
  'extraction-planned': 'Extraction planned',
  attention: 'Needs attention',
};

const STATUS_RO: Record<ToothStatus, string> = {
  present: 'Prezent',
  missing: 'Lipsă',
  implant: 'Implant',
  crown: 'Coroană',
  filling: 'Obturație',
  'root-canal': 'Tratament de canal',
  bridge: 'Punte',
  veneer: 'Fațetă',
  'extraction-planned': 'Extracție planificată',
  attention: 'Necesită atenție',
};

export const STRINGS: Record<'en' | 'ro', Strings> = {
  en: {
    tooth: 'Tooth',
    statuses: STATUS_EN,
    names: names(QUADRANT_EN, POSITION_EN, (q, p) => `${q} ${p}`),
    teethList: 'Teeth',
    loading: 'Loading 3D model…',
    loadError: 'The 3D model could not be loaded.',
  },
  ro: {
    tooth: 'Dinte',
    statuses: STATUS_RO,
    names: names(QUADRANT_RO, POSITION_RO, (q, p) => `${p} ${q}`),
    teethList: 'Dinți',
    loading: 'Se încarcă modelul 3D…',
    loadError: 'Modelul 3D nu a putut fi încărcat.',
  },
};

/** Resolves a locale option to a `Strings` object; unknown locales fall back to English. */
export function resolveStrings(locale: DentalLocale | undefined): Strings {
  if (locale && typeof locale === 'object') return locale;
  const key = (locale ?? 'en').toLowerCase().split('-')[0];
  return key === 'ro' ? STRINGS.ro : STRINGS.en;
}

export type DentalLocale = 'en' | 'ro' | string | Strings;

/** Human-readable tooth name, e.g. "Upper right central incisor". */
export function toothName(fdi: Fdi, locale: DentalLocale = 'en'): string {
  return resolveStrings(locale).names[fdi];
}
