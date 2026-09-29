import { describe, expect, it } from 'vitest';
import {
  ALL_TEETH,
  LOWER_ARCH,
  UPPER_ARCH,
  archIndex,
  assertFdi,
  formatTooth,
  fromPalmerText,
  fromUniversal,
  isFdi,
  isUpper,
  jaw,
  neighbour,
  opposing,
  quadrant,
  side,
  toPalmer,
  toPalmerText,
  toUniversal,
  toothType,
} from '../src/numbering.js';
import { STRINGS, toothName } from '../src/i18n.js';
import type { Fdi } from '../src/types.js';

describe('FDI helpers', () => {
  it('lists 32 unique permanent teeth', () => {
    expect(ALL_TEETH).toHaveLength(32);
    expect(new Set(ALL_TEETH).size).toBe(32);
    expect(ALL_TEETH[0]).toBe('11');
    expect(ALL_TEETH[31]).toBe('48');
  });

  it('validates codes', () => {
    expect(isFdi('11')).toBe(true);
    expect(isFdi('48')).toBe(true);
    expect(isFdi('19')).toBe(false);
    expect(isFdi('51')).toBe(false);
    expect(isFdi(11)).toBe(false);
    expect(() => assertFdi('99')).toThrow(RangeError);
  });

  it('knows quadrants, jaws and sides', () => {
    expect(quadrant('36')).toBe(3);
    expect(isUpper('16')).toBe(true);
    expect(isUpper('46')).toBe(false);
    expect(jaw('21')).toBe('upper');
    expect(jaw('31')).toBe('lower');
    expect(side('11')).toBe('right');
    expect(side('41')).toBe('right');
    expect(side('21')).toBe('left');
    expect(side('31')).toBe('left');
  });

  it('classifies tooth types', () => {
    expect(toothType('11')).toBe('incisor');
    expect(toothType('12')).toBe('incisor');
    expect(toothType('13')).toBe('canine');
    expect(toothType('14')).toBe('premolar');
    expect(toothType('15')).toBe('premolar');
    expect(toothType('16')).toBe('molar');
    expect(toothType('18')).toBe('molar');
  });
});

describe('Universal numbering', () => {
  it('maps the well-known anchors', () => {
    expect(toUniversal('18')).toBe(1);
    expect(toUniversal('11')).toBe(8);
    expect(toUniversal('21')).toBe(9);
    expect(toUniversal('28')).toBe(16);
    expect(toUniversal('38')).toBe(17);
    expect(toUniversal('31')).toBe(24);
    expect(toUniversal('41')).toBe(25);
    expect(toUniversal('48')).toBe(32);
  });

  it('round-trips every tooth', () => {
    const seen = new Set<number>();
    for (const fdi of ALL_TEETH) {
      const n = toUniversal(fdi);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(32);
      seen.add(n);
      expect(fromUniversal(n)).toBe(fdi);
    }
    expect(seen.size).toBe(32);
    expect(() => fromUniversal(0)).toThrow(RangeError);
    expect(() => fromUniversal(33)).toThrow(RangeError);
  });
});

describe('Palmer notation', () => {
  it('renders brackets on the correct side', () => {
    expect(toPalmer('11')).toBe('1┘');
    expect(toPalmer('21')).toBe('└1');
    expect(toPalmer('31')).toBe('┌1');
    expect(toPalmer('41')).toBe('1┐');
    expect(toPalmer('36')).toBe('┌6');
  });

  it('round-trips the text form', () => {
    expect(toPalmerText('11')).toBe('UR1');
    expect(toPalmerText('26')).toBe('UL6');
    expect(toPalmerText('36')).toBe('LL6');
    expect(toPalmerText('47')).toBe('LR7');
    for (const fdi of ALL_TEETH) expect(fromPalmerText(toPalmerText(fdi))).toBe(fdi);
    expect(fromPalmerText('ll6')).toBe('36');
    expect(() => fromPalmerText('XX1')).toThrow(RangeError);
  });

  it('formats in all systems', () => {
    expect(formatTooth('36', 'fdi')).toBe('36');
    expect(formatTooth('36', 'universal')).toBe('19');
    expect(formatTooth('36', 'palmer')).toBe('┌6');
  });
});

describe('arch navigation', () => {
  it("orders the arches from the patient's right to left", () => {
    expect(UPPER_ARCH[0]).toBe('18');
    expect(UPPER_ARCH[7]).toBe('11');
    expect(UPPER_ARCH[8]).toBe('21');
    expect(UPPER_ARCH[15]).toBe('28');
    expect(LOWER_ARCH[0]).toBe('48');
    expect(LOWER_ARCH[15]).toBe('38');
  });

  it('finds neighbours and antagonists', () => {
    expect(neighbour('11', 1)).toBe('21');
    expect(neighbour('11', -1)).toBe('12');
    expect(neighbour('18', -1)).toBeNull();
    expect(neighbour('28', 1)).toBeNull();
    expect(opposing('11')).toBe('41');
    expect(opposing('36')).toBe('26');
    expect(archIndex('11')).toBe(7);
    expect(archIndex('41')).toBe(7);
  });
});

describe('strings', () => {
  it('has a name and status label for every tooth in every locale', () => {
    for (const locale of ['en', 'ro'] as const) {
      const s = STRINGS[locale];
      for (const fdi of ALL_TEETH) expect(s.names[fdi as Fdi]).toBeTruthy();
      expect(Object.keys(s.statuses)).toHaveLength(10);
    }
    expect(toothName('11')).toBe('Upper right central incisor');
    expect(toothName('36', 'ro')).toBe('Primul molar inferior stânga');
    expect(toothName('36', 'de-DE')).toBe('Lower left first molar');
  });
});
