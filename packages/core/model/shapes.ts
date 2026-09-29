/**
 * Anatomy tables and tooth shape templates for the procedural model.
 *
 * Everything that changes how the mouth *looks* lives here so tweaking proportions is
 * cheap. Dimensions are millimetres, taken from published average adult crown
 * dimensions (Wheeler's / Ash & Nelson tables, rounded to 0.5 mm).
 */

export type ToothType = 'incisor' | 'canine' | 'premolar' | 'molar';

export interface ToothSpec {
  /** Position within the quadrant, 1 = central incisor … 8 = third molar. */
  position: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  type: ToothType;
  /** Mesiodistal crown width. */
  md: number;
  /** Buccolingual (labiolingual) crown width. */
  bl: number;
  /** Crown height from cervical line to incisal edge / cusp tip. */
  height: number;
  /** Labial inclination of the crown in degrees (tip leans outwards). */
  tilt: number;
}

/** Maxillary (upper) teeth, position 1..8. */
export const UPPER: ToothSpec[] = [
  { position: 1, type: 'incisor', md: 8.5, bl: 7.0, height: 10.5, tilt: 14 },
  { position: 2, type: 'incisor', md: 6.5, bl: 6.0, height: 9.0, tilt: 12 },
  { position: 3, type: 'canine', md: 7.5, bl: 8.0, height: 10.0, tilt: 8 },
  { position: 4, type: 'premolar', md: 7.0, bl: 9.0, height: 8.5, tilt: 3 },
  { position: 5, type: 'premolar', md: 6.5, bl: 9.0, height: 8.5, tilt: 2 },
  { position: 6, type: 'molar', md: 10.0, bl: 11.0, height: 7.5, tilt: 0 },
  { position: 7, type: 'molar', md: 9.0, bl: 11.0, height: 7.0, tilt: 0 },
  { position: 8, type: 'molar', md: 8.5, bl: 10.0, height: 6.5, tilt: 0 },
];

/** Mandibular (lower) teeth, position 1..8. */
export const LOWER: ToothSpec[] = [
  { position: 1, type: 'incisor', md: 5.0, bl: 6.0, height: 9.0, tilt: 6 },
  { position: 2, type: 'incisor', md: 5.5, bl: 6.5, height: 9.5, tilt: 5 },
  { position: 3, type: 'canine', md: 7.0, bl: 7.5, height: 11.0, tilt: 4 },
  { position: 4, type: 'premolar', md: 7.0, bl: 7.5, height: 8.5, tilt: 2 },
  { position: 5, type: 'premolar', md: 7.0, bl: 8.0, height: 8.0, tilt: 1 },
  { position: 6, type: 'molar', md: 11.0, bl: 10.5, height: 7.5, tilt: 0 },
  { position: 7, type: 'molar', md: 10.5, bl: 10.0, height: 7.0, tilt: 0 },
  { position: 8, type: 'molar', md: 10.0, bl: 9.5, height: 6.5, tilt: 0 },
];

/** A bump on the occlusal / incisal surface, in normalised footprint coordinates (-1..1). */
export interface Cusp {
  /** Mesiodistal offset (-1..1). */
  u: number;
  /** Buccolingual offset (-1..1, positive = buccal). */
  v: number;
  /** Height of the bump in mm. */
  height: number;
  /** Gaussian radius in normalised footprint units. */
  radius: number;
}

/**
 * How a crown is lofted from the neck (t = 0) to the tip (t = 1).
 *
 * The cross-section is a superellipse scaled by `neck` at the cervical line, widening to
 * 1 at `bulgeAt`, and then "closing" towards the tip independently along the two axes:
 * `close = (1 - ((t - tc) / (1 - tc)) ^ p) ^ (1 / p)` for t > tc. p = 1 is a cone,
 * p = 2 a dome, larger p a flat table with rounded shoulders. A chisel edge is simply a
 * buccolingual closing that starts early with a low exponent while the mesiodistal axis
 * stays wide.
 */
export interface ShapeTemplate {
  /** Superellipse exponent of the cross-section (2 = ellipse, higher = squarer). */
  exponent: number;
  /** Radial scale at the neck relative to the widest point. */
  neck: number;
  /** t at which the crown reaches full width (mesiodistal). */
  bulgeAt: number;
  /** Optional separate neck scale / bulge position for the buccolingual axis. */
  neckV?: number;
  bulgeAtV?: number;
  /** [tc, p] closing of the mesiodistal half-width. */
  closeU: [number, number];
  /** [tc, p] closing of the buccolingual half-width. */
  closeV: [number, number];
  /** Cusp bumps. */
  cusps: Cusp[];
  /** Central depression (fossa). */
  fossa?: { depth: number; radius: number };
  /** t from which the cusp field starts to act (blended in with a smoothstep to 1). */
  cuspStart: number;
  /** Height of the tip region as fraction of crown height that the loft itself covers. */
  tipHeight: number;
}

export const TEMPLATES: Record<ToothType, ShapeTemplate> = {
  incisor: {
    exponent: 2.6,
    neck: 0.68,
    bulgeAt: 0.72,
    neckV: 0.92,
    bulgeAtV: 0.2,
    closeU: [0.82, 2.4],
    closeV: [0.42, 1.7],
    cusps: [],
    cuspStart: 1,
    tipHeight: 1,
  },
  canine: {
    exponent: 2.4,
    neck: 0.72,
    bulgeAt: 0.58,
    neckV: 0.9,
    bulgeAtV: 0.3,
    closeU: [0.52, 1.8],
    closeV: [0.5, 1.7],
    cusps: [{ u: 0, v: 0.05, height: 0.5, radius: 0.5 }],
    cuspStart: 0.7,
    tipHeight: 0.96,
  },
  premolar: {
    exponent: 2.6,
    neck: 0.78,
    bulgeAt: 0.6,
    closeU: [0.64, 2.6],
    closeV: [0.64, 2.6],
    cusps: [
      { u: 0, v: 0.42, height: 1.0, radius: 0.34 },
      { u: 0, v: -0.42, height: 0.8, radius: 0.34 },
    ],
    fossa: { depth: 0.55, radius: 0.24 },
    cuspStart: 0.6,
    tipHeight: 0.9,
  },
  molar: {
    exponent: 2.8,
    neck: 0.8,
    bulgeAt: 0.55,
    closeU: [0.66, 2.8],
    closeV: [0.66, 2.8],
    cusps: [
      { u: -0.45, v: 0.45, height: 0.95, radius: 0.3 },
      { u: 0.45, v: 0.45, height: 0.85, radius: 0.3 },
      { u: -0.45, v: -0.45, height: 0.85, radius: 0.3 },
      { u: 0.45, v: -0.45, height: 0.75, radius: 0.3 },
    ],
    fossa: { depth: 0.7, radius: 0.32 },
    cuspStart: 0.62,
    tipHeight: 0.9,
  },
};

export interface ArchSpec {
  /** Half of the arch width at the canine/premolar corner (mm). */
  halfWidth: number;
  /** Depth of the curved anterior segment (mm). */
  frontDepth: number;
  /** Lateral flare of the posterior segment (dx per mm of arch length). */
  flare: number;
  /** Interproximal gap between neighbouring crowns (mm). */
  gap: number;
  /** Vertical extent of the gums away from the crowns (mm). */
  gumHeight: number;
  /** Extra half-width of the gum ridge beyond bl/2 (mm). */
  gumMargin: number;
  /** How far the gum overlaps the crown at the tooth centre / between teeth (mm). */
  gumCover: [number, number];
  /** Vertical clearance of the tips from the occlusal plane (mm). */
  occlusalClearance: number;
}

export const ARCHES: { upper: ArchSpec; lower: ArchSpec } = {
  upper: {
    halfWidth: 28.5,
    frontDepth: 30,
    flare: 0.1,
    gap: 0.5,
    gumHeight: 3.5,
    gumMargin: 0.35,
    gumCover: [0.5, 1.2],
    occlusalClearance: 0.4,
  },
  lower: {
    halfWidth: 26.5,
    frontDepth: 26,
    flare: 0.1,
    gap: 0.5,
    gumHeight: 3.5,
    gumMargin: 0.35,
    gumCover: [0.5, 1.2],
    occlusalClearance: 0.4,
  },
};

/** Tessellation of each crown: segments around × rings from neck to tip. */
export const TOOTH_RESOLUTION = { segments: 36, rings: 22 };
/** Tessellation of the gums: points around the tube × ring spacing along the arch (mm). */
export const GUM_RESOLUTION = { segments: 28, spacing: 0.8 };
