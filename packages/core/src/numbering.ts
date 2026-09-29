import type { Fdi, Jaw, Quadrant, ToothType } from './types.js';

const QUADRANTS = [1, 2, 3, 4] as const;
const POSITIONS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

/** All 32 permanent teeth in FDI order: 11…18, 21…28, 31…38, 41…48. */
export const ALL_TEETH: readonly Fdi[] = QUADRANTS.flatMap((q) =>
  POSITIONS.map((p) => `${q}${p}` as Fdi),
);

const SET = new Set<string>(ALL_TEETH);

/** Type guard for FDI codes of permanent teeth. */
export function isFdi(value: unknown): value is Fdi {
  return typeof value === 'string' && SET.has(value);
}

/** Throws if `value` is not one of the 32 FDI codes. */
export function assertFdi(value: unknown): Fdi {
  if (!isFdi(value)) throw new RangeError(`Not an FDI tooth code: ${String(value)}`);
  return value;
}

export function quadrant(fdi: Fdi): Quadrant {
  return Number(fdi[0]) as Quadrant;
}

/** Position within the quadrant: 1 = central incisor … 8 = third molar. */
export function position(fdi: Fdi): 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 {
  return Number(fdi[1]) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
}

export function isUpper(fdi: Fdi): boolean {
  const q = quadrant(fdi);
  return q === 1 || q === 2;
}

export function isLower(fdi: Fdi): boolean {
  return !isUpper(fdi);
}

export function jaw(fdi: Fdi): Jaw {
  return isUpper(fdi) ? 'upper' : 'lower';
}

/** Patient's right (quadrants 1 and 4) or left (quadrants 2 and 3). */
export function side(fdi: Fdi): 'right' | 'left' {
  const q = quadrant(fdi);
  return q === 1 || q === 4 ? 'right' : 'left';
}

export function toothType(fdi: Fdi): ToothType {
  const p = position(fdi);
  if (p <= 2) return 'incisor';
  if (p === 3) return 'canine';
  if (p <= 5) return 'premolar';
  return 'molar';
}

/**
 * Universal (ADA) numbering: 1 = upper right third molar … 16 = upper left third molar,
 * 17 = lower left third molar … 32 = lower right third molar.
 */
export function toUniversal(fdi: Fdi): number {
  const q = quadrant(fdi);
  const p = position(fdi);
  switch (q) {
    case 1:
      return 9 - p;
    case 2:
      return 8 + p;
    case 3:
      return 25 - p;
    case 4:
      return 24 + p;
  }
}

export function fromUniversal(n: number): Fdi {
  if (!Number.isInteger(n) || n < 1 || n > 32) {
    throw new RangeError(`Universal tooth number out of range: ${n}`);
  }
  if (n <= 8) return `1${9 - n}` as Fdi;
  if (n <= 16) return `2${n - 8}` as Fdi;
  if (n <= 24) return `3${25 - n}` as Fdi;
  return `4${n - 24}` as Fdi;
}

/**
 * Palmer notation as text: the position number with a bracket showing the quadrant,
 * e.g. `┘1` for 11, `└1` for 21, `┐1` for 31, `┌1` for 41. The bracket sits on the side of
 * the midline as seen from the front (patient's right on the left of the glyph).
 */
export function toPalmer(fdi: Fdi): string {
  const p = position(fdi);
  switch (quadrant(fdi)) {
    case 1:
      return `${p}┘`;
    case 2:
      return `└${p}`;
    case 3:
      return `┌${p}`;
    case 4:
      return `${p}┐`;
  }
}

/** Palmer notation in the plain-text form commonly typed: `UR1`, `UL1`, `LL1`, `LR1`. */
export function toPalmerText(fdi: Fdi): string {
  const p = position(fdi);
  const q = quadrant(fdi);
  const prefix = q === 1 ? 'UR' : q === 2 ? 'UL' : q === 3 ? 'LL' : 'LR';
  return `${prefix}${p}`;
}

export function fromPalmerText(text: string): Fdi {
  const m = /^(UR|UL|LL|LR)([1-8])$/i.exec(text.trim());
  if (!m) throw new RangeError(`Not a Palmer tooth code: ${text}`);
  const q = { UR: 1, UL: 2, LL: 3, LR: 4 }[m[1]!.toUpperCase()]!;
  return `${q}${m[2]}` as Fdi;
}

/** Formats a tooth number in the given numbering system. */
export function formatTooth(fdi: Fdi, numbering: 'fdi' | 'universal' | 'palmer'): string {
  switch (numbering) {
    case 'fdi':
      return fdi;
    case 'universal':
      return String(toUniversal(fdi));
    case 'palmer':
      return toPalmer(fdi);
  }
}

/** Upper arch from the patient's right third molar to the left third molar. */
export const UPPER_ARCH: readonly Fdi[] = [
  ...[8, 7, 6, 5, 4, 3, 2, 1].map((p) => `1${p}` as Fdi),
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((p) => `2${p}` as Fdi),
];

/** Lower arch from the patient's right third molar to the left third molar. */
export const LOWER_ARCH: readonly Fdi[] = [
  ...[8, 7, 6, 5, 4, 3, 2, 1].map((p) => `4${p}` as Fdi),
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((p) => `3${p}` as Fdi),
];

/** Index 0..15 along the arch, from the patient's right to left. */
export function archIndex(fdi: Fdi): number {
  return (isUpper(fdi) ? UPPER_ARCH : LOWER_ARCH).indexOf(fdi);
}

/** Neighbour along the same arch (`+1` towards the patient's left), or null at the ends. */
export function neighbour(fdi: Fdi, direction: 1 | -1): Fdi | null {
  const arch = isUpper(fdi) ? UPPER_ARCH : LOWER_ARCH;
  return arch[arch.indexOf(fdi) + direction] ?? null;
}

/** The tooth in the same position on the opposing arch (antagonist). */
export function opposing(fdi: Fdi): Fdi {
  const arch = isUpper(fdi) ? LOWER_ARCH : UPPER_ARCH;
  return arch[archIndex(fdi)]!;
}
