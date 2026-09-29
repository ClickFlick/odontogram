/**
 * Procedural generator for the default mouth model.
 *
 *   npx tsx model/generate.ts            # writes model/default.glb (+ model/raw.glb)
 *   npx tsx model/generate.ts --check    # also validates neighbour spacing
 *
 * The output is a glTF 2.0 binary with one node per tooth crown, named by FDI code
 * ("11".."48"), plus "gums_upper" and "gums_lower". Coordinates are millimetres, +Y up,
 * +Z towards the viewer (labial), the patient's right at -X. The occlusal plane is y = 0.
 * See docs/MODEL.md for the conventions and the parameters.
 */
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ARCHES,
  GUM_RESOLUTION,
  LOWER,
  TEMPLATES,
  TOOTH_RESOLUTION,
  UPPER,
  type ArchSpec,
  type ShapeTemplate,
  type ToothSpec,
} from './shapes.js';

const here = dirname(fileURLToPath(import.meta.url));

type Jaw = 'upper' | 'lower';

interface MeshData {
  name: string;
  positions: Float32Array;
  normals: Float32Array;
  /** Baked ambient-occlusion factor per vertex (0..1), stored as COLOR_0 grey. */
  ao?: Float32Array;
  indices: Uint32Array;
  material: number;
  extras?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------------------
// maths

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const spow = (x: number, e: number) => Math.sign(x) * Math.pow(Math.abs(x), e);
const deg = (d: number) => (d * Math.PI) / 180;

const cy0 = (phi: number) => Math.sin(phi);

/** Point on the unit superellipse |x|^n + |z|^n = 1 at parameter angle theta. */
function superellipse(theta: number, n: number): [number, number] {
  return [spow(Math.cos(theta), 2 / n), spow(Math.sin(theta), 2 / n)];
}

/** Closing factor towards the tip, see ShapeTemplate. */
function closing(t: number, [tc, p]: [number, number], floor = 0.03): number {
  if (t <= tc) return 1;
  const x = (t - tc) / (1 - tc);
  return Math.max(floor, Math.pow(Math.max(0, 1 - Math.pow(x, p)), 1 / p));
}

// ---------------------------------------------------------------------------------------
// arch curve

interface Frame {
  x: number;
  z: number;
  /** Unit tangent pointing distally (towards increasing |s|). */
  ux: number;
  uz: number;
  /** Unit outward (buccal/labial) normal. */
  nx: number;
  nz: number;
}

/**
 * Half of the arch (x >= 0), parametrised by arc length s from the midline. A quarter
 * ellipse for the anterior segment continued by a nearly straight, slightly flaring
 * posterior segment. Negative s mirrors to the other side.
 */
class Arch {
  private readonly pts: { s: number; x: number; z: number; tx: number; tz: number }[] = [];

  constructor(
    readonly spec: ArchSpec,
    minLength: number,
  ) {
    const a = spec.halfWidth;
    const b = spec.frontDepth;
    const N = 600;
    let s = 0;
    let px = 0;
    let pz = b;
    for (let i = 0; i <= N; i++) {
      const t = (i / N) * (Math.PI / 2);
      const x = a * Math.sin(t);
      const z = b * Math.cos(t);
      if (i > 0) s += Math.hypot(x - px, z - pz);
      // analytic tangent of the ellipse, direction of increasing t
      const tx = a * Math.cos(t);
      const tz = -b * Math.sin(t);
      const l = Math.hypot(tx, tz);
      this.pts.push({ s, x, z, tx: tx / l, tz: tz / l });
      px = x;
      pz = z;
    }
    // posterior segment: straight with a small lateral flare
    const dl = Math.hypot(spec.flare, 1);
    const dx = spec.flare / dl;
    const dz = -1 / dl;
    const step = 0.5;
    while (s < minLength + 5) {
      s += step;
      px += dx * step;
      pz += dz * step;
      this.pts.push({ s, x: px, z: pz, tx: dx, tz: dz });
    }
  }

  frame(s: number): Frame {
    const a = Math.abs(s);
    const pts = this.pts;
    let lo = 0;
    let hi = pts.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (pts[mid]!.s <= a) lo = mid;
      else hi = mid;
    }
    const p0 = pts[lo]!;
    const p1 = pts[hi]!;
    const f = p1.s === p0.s ? 0 : clamp((a - p0.s) / (p1.s - p0.s), 0, 1);
    let x = p0.x + (p1.x - p0.x) * f;
    const z = p0.z + (p1.z - p0.z) * f;
    let tx = p0.tx + (p1.tx - p0.tx) * f;
    const tz = p0.tz + (p1.tz - p0.tz) * f;
    const l = Math.hypot(tx, tz);
    tx /= l;
    const tzn = tz / l;
    // outward normal for the +x side: rotate the tangent by -90° about y
    let nx = -tzn;
    const nz = tx;
    if (s < 0) {
      x = -x;
      tx = -tx;
      nx = -nx;
    }
    return { x, z, ux: tx, uz: tzn, nx, nz };
  }
}

// ---------------------------------------------------------------------------------------
// crowns

interface Canonical {
  /** (u, y, v) triples: u mesiodistal (+ distal), y height from the neck, v buccolingual (+ buccal). */
  positions: Float32Array;
  indices: Uint32Array;
  ao: Float32Array;
  tipY: number;
}

function cuspField(un: number, vn: number, tpl: ShapeTemplate): number {
  let y = 0;
  for (const c of tpl.cusps) {
    const d2 = (un - c.u) ** 2 + (vn - c.v) ** 2;
    y += c.height * Math.exp(-d2 / (2 * c.radius * c.radius));
  }
  if (tpl.fossa) {
    y -= tpl.fossa.depth * Math.exp(-(un * un + vn * vn) / (2 * tpl.fossa.radius ** 2));
  }
  return y;
}

/**
 * Lofts a crown from the neck to the tip. Rings are distributed by arc length of the
 * average profile so the shoulder and the occlusal table are sampled as finely as the
 * sides. The crown is closed with a fan to a central tip vertex.
 */
function buildCrown(spec: ToothSpec, tpl: ShapeTemplate): Canonical {
  const { segments: N, rings: M } = TOOTH_RESOLUTION;
  const au = spec.md / 2;
  const av = spec.bl / 2;
  const h = spec.height * tpl.tipHeight;
  const uFloor = spec.type === 'incisor' ? 0.78 : spec.type === 'canine' ? 0.22 : 0.05;
  const vFloor = spec.type === 'incisor' ? 0.14 : spec.type === 'canine' ? 0.22 : 0.05;

  const bulge = (t: number) => tpl.neck + (1 - tpl.neck) * smoothstep(0, tpl.bulgeAt, t);
  const neckV = tpl.neckV ?? tpl.neck;
  const bulgeV = (t: number) => neckV + (1 - neckV) * smoothstep(0, tpl.bulgeAtV ?? tpl.bulgeAt, t);
  const ru = (t: number) => bulge(t) * closing(t, tpl.closeU, uFloor);
  const rv = (t: number) => bulgeV(t) * closing(t, tpl.closeV, vFloor);

  // re-parametrise t by profile arc length
  const F = 2000;
  const abar = (au + av) / 2;
  const arc: number[] = [0];
  for (let i = 1; i <= F; i++) {
    const t0 = (i - 1) / F;
    const t1 = i / F;
    const r0 = (abar * (ru(t0) + rv(t0))) / 2;
    const r1 = (abar * (ru(t1) + rv(t1))) / 2;
    arc.push(arc[i - 1]! + Math.hypot(r1 - r0, h * (t1 - t0)));
  }
  const total = arc[F]!;
  const tAt = (j: number): number => {
    const target = (j / M) * total;
    let lo = 0;
    let hi = F;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (arc[mid]! <= target) lo = mid;
      else hi = mid;
    }
    const f = (target - arc[lo]!) / Math.max(1e-9, arc[hi]! - arc[lo]!);
    return (lo + f) / F;
  };

  const tan = Math.tan(deg(spec.tilt));
  const pos: number[] = [];
  const aoList: number[] = [];
  for (let j = 0; j < M; j++) {
    const t = j === 0 ? 0 : tAt(j);
    const su = ru(t);
    const sv = rv(t);
    const w = smoothstep(tpl.cuspStart, Math.min(1, tpl.cuspStart + 0.25), t);
    for (let i = 0; i < N; i++) {
      const theta = (i / N) * Math.PI * 2;
      const [x, z] = superellipse(theta, tpl.exponent);
      const u = au * x * su;
      const v = av * z * sv;
      const y = h * t + w * cuspField(u / au, v / av, tpl);
      pos.push(u, y, v + y * tan);
      // baked occlusion: darker towards the gum line and on the contact (mesial/distal) faces
      const gumline = 0.7 + 0.3 * smoothstep(0, 0.5, t);
      const contact = 1 - 0.28 * Math.pow(Math.abs(x), 3) * (1 - 0.6 * t);
      aoList.push(gumline * contact);
    }
  }
  const yTip = h + cuspField(0, 0, tpl);
  pos.push(0, yTip, yTip * tan);
  aoList.push(tpl.fossa ? 0.9 : 1);
  const center = M * N;

  const idx: number[] = [];
  for (let j = 0; j < M - 1; j++) {
    for (let i = 0; i < N; i++) {
      const a = j * N + i;
      const b = j * N + ((i + 1) % N);
      const c = (j + 1) * N + i;
      const d = (j + 1) * N + ((i + 1) % N);
      // outward-facing winding (counter-clockwise seen from outside)
      idx.push(a, c, b, b, c, d);
    }
  }
  for (let i = 0; i < N; i++) {
    const a = (M - 1) * N + i;
    const b = (M - 1) * N + ((i + 1) % N);
    idx.push(a, center, b);
  }

  const positions = new Float32Array(pos);
  const indices = new Uint32Array(idx);
  // Taubin smoothing (no shrinkage) removes any residual crease; the neck ring stays fixed
  taubinSmooth(positions, indices, 3, new Set(Array.from({ length: N }, (_, i) => i)));
  let tipY = -Infinity;
  for (let k = 1; k < positions.length; k += 3) tipY = Math.max(tipY, positions[k]!);
  return { positions, indices, ao: new Float32Array(aoList), tipY };
}

/** Taubin λ|μ smoothing over the vertex neighbourhood graph; `fixed` vertices do not move. */
function taubinSmooth(
  positions: Float32Array,
  indices: Uint32Array,
  iterations: number,
  fixed: Set<number>,
  lambda = 0.5,
  mu = -0.53,
): void {
  const n = positions.length / 3;
  const neighbours: number[][] = Array.from({ length: n }, () => []);
  const link = (a: number, b: number) => {
    if (!neighbours[a]!.includes(b)) neighbours[a]!.push(b);
  };
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = [indices[i]!, indices[i + 1]!, indices[i + 2]!];
    link(a, b);
    link(b, a);
    link(b, c);
    link(c, b);
    link(a, c);
    link(c, a);
  }
  const next = new Float32Array(positions.length);
  const step = (factor: number) => {
    next.set(positions);
    for (let v = 0; v < n; v++) {
      if (fixed.has(v)) continue;
      const nb = neighbours[v]!;
      if (nb.length === 0) continue;
      let x = 0;
      let y = 0;
      let z = 0;
      for (const w of nb) {
        x += positions[w * 3]!;
        y += positions[w * 3 + 1]!;
        z += positions[w * 3 + 2]!;
      }
      x /= nb.length;
      y /= nb.length;
      z /= nb.length;
      next[v * 3] = positions[v * 3]! + factor * (x - positions[v * 3]!);
      next[v * 3 + 1] = positions[v * 3 + 1]! + factor * (y - positions[v * 3 + 1]!);
      next[v * 3 + 2] = positions[v * 3 + 2]! + factor * (z - positions[v * 3 + 2]!);
    }
    positions.set(next);
  };
  for (let i = 0; i < iterations; i++) {
    step(lambda);
    step(mu);
  }
}

interface Placement {
  fdi: string;
  spec: ToothSpec;
  s: number;
  neckY: number;
  mesh: MeshData;
}

function placeTooth(
  canon: Canonical,
  arch: Arch,
  s: number,
  jaw: Jaw,
  fdi: string,
  spec: ToothSpec,
): Placement {
  const fr = arch.frame(s);
  const clearance = arch.spec.occlusalClearance;
  const src = canon.positions;
  const out = new Float32Array(src.length);
  const neckY = jaw === 'lower' ? -canon.tipY - clearance : canon.tipY + clearance;
  for (let k = 0; k < src.length; k += 3) {
    const u = src[k]!;
    const y = src[k + 1]!;
    const v = src[k + 2]!;
    out[k] = fr.x + u * fr.ux + v * fr.nx;
    out[k + 1] = jaw === 'lower' ? neckY + y : neckY - y;
    out[k + 2] = fr.z + u * fr.uz + v * fr.nz;
  }
  // the mirrored side (and upper jaw) flip handedness: make every crown face outwards
  const indices = new Uint32Array(canon.indices);
  fixWinding(out, indices);
  const quadrant = Number(fdi[0]);
  return {
    fdi,
    spec,
    s,
    neckY,
    mesh: {
      name: fdi,
      positions: out,
      normals: computeNormals(out, indices),
      ao: canon.ao,
      indices,
      material: 0,
      extras: { fdi, type: spec.type, jaw, quadrant, position: spec.position },
    },
  };
}

// ---------------------------------------------------------------------------------------
// gums

function buildGums(arch: Arch, teeth: Placement[], jaw: Jaw): MeshData {
  const spec = arch.spec;
  const side = teeth.filter((t) => t.s > 0).sort((a, b) => a.s - b.s);
  const last = side[side.length - 1]!;
  const distalEnd = last.s + last.spec.md / 2;
  const tail = 3.5;
  const sEnd = distalEnd + tail;
  const { segments: K, spacing } = GUM_RESOLUTION;
  const dir = jaw === 'lower' ? 1 : -1; // direction from gums towards the crowns

  // smooth per-arch-length profiles from the tooth table
  const sample = (s: number, pick: (t: Placement) => number): number => {
    const a = Math.abs(s);
    if (a <= side[0]!.s) return pick(side[0]!);
    if (a >= last.s) return pick(last);
    for (let i = 0; i < side.length - 1; i++) {
      const t0 = side[i]!;
      const t1 = side[i + 1]!;
      if (a >= t0.s && a <= t1.s) {
        const f = (a - t0.s) / (t1.s - t0.s);
        const w = 0.5 - 0.5 * Math.cos(Math.PI * f);
        return pick(t0) * (1 - w) + pick(t1) * w;
      }
    }
    return pick(last);
  };
  const cover = (s: number): number => {
    const a = Math.abs(s);
    const [lo, hi] = spec.gumCover;
    for (const t of side) {
      const half = t.spec.md / 2 + spec.gap / 2;
      if (Math.abs(a - t.s) <= half) {
        const phi = Math.abs(a - t.s) / half;
        // gentle papilla: a raised cosine bump centred on the contact point
        const w = smoothstep(0.35, 1, phi);
        return lo + (hi - lo) * w * w * (3 - 2 * w);
      }
    }
    return lo;
  };

  const pos: number[] = [];
  const gumAo: number[] = [];
  const rings = Math.ceil((2 * sEnd) / spacing);
  // the model is cut by a flat plane a fixed distance beyond the deepest neck, like a scan
  let deepest = 0;
  for (const t of side) deepest = Math.max(deepest, Math.abs(t.neckY));
  const yCut = -dir * (deepest + spec.gumHeight);
  for (let r = 0; r <= rings; r++) {
    const s = -sEnd + (2 * sEnd * r) / rings;
    const fr = arch.frame(s);
    const neck = sample(s, (t) => t.neckY);
    const bl = sample(s, (t) => t.spec.bl);
    // free gingiva hugs the crown just outside its cervical constriction, the alveolar
    // ridge below it flares outwards
    const wTop = (bl / 2) * 0.8 + spec.gumMargin;
    const wBottom = wTop + 1.3;
    const crest = neck + dir * spec.gumCover[0];
    const papilla = cover(s) - spec.gumCover[0];
    const height = Math.abs(crest - yCut);
    // taper the ridge behind the last molar (width only – the cut plane stays flat)
    const over = Math.abs(s) - distalEnd;
    const e = over <= 0 ? 1 : Math.max(0.15, Math.sqrt(Math.max(0, 1 - (over / tail) ** 2)));
    for (let k = 0; k < K; k++) {
      const phi = (k / K) * Math.PI * 2;
      // rounded profile: soft top (crest), squarer bottom (cut)
      const [cx, cy] = superellipse(phi, cy0(phi) >= 0 ? 2.2 : 5);
      const yn = (cy + 1) / 2; // 0 at the cut plane, 1 at the crest
      const w = wBottom + (wTop - wBottom) * smoothstep(0.35, 1, yn);
      const v = w * e * cx;
      const crestWeight = Math.max(0, cy) ** 2;
      const y = yCut + dir * height * yn + dir * papilla * crestWeight * e;
      pos.push(fr.x + v * fr.nx, y, fr.z + v * fr.nz);
      gumAo.push(1 - 0.25 * Math.max(0, cy) ** 3);
    }
  }
  const idx: number[] = [];
  for (let r = 0; r < rings; r++) {
    for (let k = 0; k < K; k++) {
      const a = r * K + k;
      const b = r * K + ((k + 1) % K);
      const c = (r + 1) * K + k;
      const d = (r + 1) * K + ((k + 1) % K);
      idx.push(a, b, c, b, d, c);
    }
  }
  // end caps
  const capCenter = (ring: number): number => {
    let x = 0;
    let y = 0;
    let z = 0;
    for (let k = 0; k < K; k++) {
      x += pos[(ring * K + k) * 3]!;
      y += pos[(ring * K + k) * 3 + 1]!;
      z += pos[(ring * K + k) * 3 + 2]!;
    }
    pos.push(x / K, y / K, z / K);
    gumAo.push(1);
    return pos.length / 3 - 1;
  };
  const c0 = capCenter(0);
  const c1 = capCenter(rings);
  for (let k = 0; k < K; k++) {
    idx.push(c0, (k + 1) % K, k);
    idx.push(c1, rings * K + k, rings * K + ((k + 1) % K));
  }

  const positions = new Float32Array(pos);
  const indices = new Uint32Array(idx);
  // make the winding face outwards regardless of sweep direction
  fixWinding(positions, indices);
  return {
    name: `gums_${jaw}`,
    positions,
    normals: computeNormals(positions, indices),
    ao: new Float32Array(gumAo),
    indices,
    material: 1,
    extras: { jaw },
  };
}

/** Flips every triangle if the mesh's faces point towards its centroid on average. */
function fixWinding(positions: Float32Array, indices: Uint32Array): void {
  let cx = 0;
  let cy = 0;
  let cz = 0;
  const nv = positions.length / 3;
  for (let i = 0; i < positions.length; i += 3) {
    cx += positions[i]!;
    cy += positions[i + 1]!;
    cz += positions[i + 2]!;
  }
  cx /= nv;
  cy /= nv;
  cz /= nv;
  let dot = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = [indices[i]! * 3, indices[i + 1]! * 3, indices[i + 2]! * 3];
    const abx = positions[b]! - positions[a]!;
    const aby = positions[b + 1]! - positions[a + 1]!;
    const abz = positions[b + 2]! - positions[a + 2]!;
    const acx = positions[c]! - positions[a]!;
    const acy = positions[c + 1]! - positions[a + 1]!;
    const acz = positions[c + 2]! - positions[a + 2]!;
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    const mx = (positions[a]! + positions[b]! + positions[c]!) / 3 - cx;
    const my = (positions[a + 1]! + positions[b + 1]! + positions[c + 1]!) / 3 - cy;
    const mz = (positions[a + 2]! + positions[b + 2]! + positions[c + 2]!) / 3 - cz;
    dot += nx * mx + ny * my + nz * mz;
  }
  if (dot < 0) {
    for (let i = 0; i < indices.length; i += 3) {
      const t = indices[i + 1]!;
      indices[i + 1] = indices[i + 2]!;
      indices[i + 2] = t;
    }
  }
}

// ---------------------------------------------------------------------------------------
// normals

function computeNormals(positions: Float32Array, indices: Uint32Array): Float32Array {
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i]! * 3;
    const b = indices[i + 1]! * 3;
    const c = indices[i + 2]! * 3;
    const abx = positions[b]! - positions[a]!;
    const aby = positions[b + 1]! - positions[a + 1]!;
    const abz = positions[b + 2]! - positions[a + 2]!;
    const acx = positions[c]! - positions[a]!;
    const acy = positions[c + 1]! - positions[a + 1]!;
    const acz = positions[c + 2]! - positions[a + 2]!;
    // area-weighted face normal
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    if (nx * nx + ny * ny + nz * nz < 1e-14) continue;
    for (const k of [a, b, c]) {
      normals[k]! += nx;
      normals[k + 1]! += ny;
      normals[k + 2]! += nz;
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const l = Math.hypot(normals[i]!, normals[i + 1]!, normals[i + 2]!) || 1;
    normals[i]! /= l;
    normals[i + 1]! /= l;
    normals[i + 2]! /= l;
  }
  return normals;
}

// ---------------------------------------------------------------------------------------
// glb writer (minimal glTF 2.0 binary, no external deps)

function writeGlb(meshes: MeshData[]): Uint8Array {
  const bin: Uint8Array[] = [];
  let offset = 0;
  const bufferViews: Record<string, unknown>[] = [];
  const accessors: Record<string, unknown>[] = [];
  const pushView = (data: Uint8Array, target: number): number => {
    const padded = (data.byteLength + 3) & ~3;
    const chunk = new Uint8Array(padded);
    chunk.set(data);
    bin.push(chunk);
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: data.byteLength, target });
    offset += padded;
    return bufferViews.length - 1;
  };

  const gltfMeshes: Record<string, unknown>[] = [];
  const nodes: Record<string, unknown>[] = [];
  for (const m of meshes) {
    const vcount = m.positions.length / 3;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < m.positions.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k]!, m.positions[i + k]!);
        max[k] = Math.max(max[k]!, m.positions[i + k]!);
      }
    }
    const posView = pushView(
      new Uint8Array(m.positions.buffer, m.positions.byteOffset, m.positions.byteLength),
      34962,
    );
    accessors.push({
      bufferView: posView,
      componentType: 5126,
      count: vcount,
      type: 'VEC3',
      min,
      max,
    });
    const posAcc = accessors.length - 1;
    const nrmView = pushView(
      new Uint8Array(m.normals.buffer, m.normals.byteOffset, m.normals.byteLength),
      34962,
    );
    accessors.push({ bufferView: nrmView, componentType: 5126, count: vcount, type: 'VEC3' });
    const nrmAcc = accessors.length - 1;
    let colorAcc = -1;
    if (m.ao) {
      const rgb = new Uint8Array(vcount * 4); // 4 bytes per vertex keeps the stride aligned
      for (let i = 0; i < vcount; i++) {
        const c = Math.round(Math.min(1, Math.max(0, m.ao[i]!)) * 255);
        rgb[i * 4] = c;
        rgb[i * 4 + 1] = c;
        rgb[i * 4 + 2] = c;
        rgb[i * 4 + 3] = 255;
      }
      const colView = pushView(rgb, 34962);
      bufferViews[colView]!['byteStride'] = 4;
      accessors.push({
        bufferView: colView,
        componentType: 5121,
        normalized: true,
        count: vcount,
        type: 'VEC4',
      });
      colorAcc = accessors.length - 1;
    }
    const useShort = vcount <= 65535;
    const idxData = useShort ? Uint16Array.from(m.indices) : m.indices;
    const idxView = pushView(
      new Uint8Array(idxData.buffer, idxData.byteOffset, idxData.byteLength),
      34963,
    );
    accessors.push({
      bufferView: idxView,
      componentType: useShort ? 5123 : 5125,
      count: m.indices.length,
      type: 'SCALAR',
    });
    const idxAcc = accessors.length - 1;
    gltfMeshes.push({
      name: m.name,
      primitives: [
        {
          attributes: {
            POSITION: posAcc,
            NORMAL: nrmAcc,
            ...(colorAcc >= 0 ? { COLOR_0: colorAcc } : {}),
          },
          indices: idxAcc,
          material: m.material,
          mode: 4,
        },
      ],
    });
    nodes.push({
      name: m.name,
      mesh: gltfMeshes.length - 1,
      ...(m.extras ? { extras: m.extras } : {}),
    });
  }

  const json = {
    asset: {
      version: '2.0',
      generator: '@oozkul/dental-3d model/generate.ts',
      copyright: 'MIT (c) ClickFlick',
    },
    scene: 0,
    scenes: [{ name: 'mouth', nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes: gltfMeshes,
    materials: [
      {
        name: 'tooth',
        pbrMetallicRoughness: {
          baseColorFactor: [0.96, 0.94, 0.89, 1],
          metallicFactor: 0,
          roughnessFactor: 0.35,
        },
      },
      {
        name: 'gums',
        pbrMetallicRoughness: {
          baseColorFactor: [0.91, 0.56, 0.58, 1],
          metallicFactor: 0,
          roughnessFactor: 0.6,
        },
      },
    ],
    accessors,
    bufferViews,
    buffers: [{ byteLength: offset }],
  };

  const enc = new TextEncoder();
  let jsonBytes = enc.encode(JSON.stringify(json));
  const jsonPadded = (jsonBytes.byteLength + 3) & ~3;
  if (jsonPadded !== jsonBytes.byteLength) {
    const p = new Uint8Array(jsonPadded).fill(0x20);
    p.set(jsonBytes);
    jsonBytes = p;
  }
  const total = 12 + 8 + jsonBytes.byteLength + 8 + offset;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); // glTF
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBytes.byteLength, true);
  dv.setUint32(16, 0x4e4f534a, true); // JSON
  out.set(jsonBytes, 20);
  let p = 20 + jsonBytes.byteLength;
  dv.setUint32(p, offset, true);
  dv.setUint32(p + 4, 0x004e4942, true); // BIN
  p += 8;
  for (const c of bin) {
    out.set(c, p);
    p += c.byteLength;
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// assembly

export interface GeneratedModel {
  meshes: MeshData[];
  teeth: Placement[];
}

export function generateModel(): GeneratedModel {
  const meshes: MeshData[] = [];
  const teeth: Placement[] = [];
  const jaws: { jaw: Jaw; specs: ToothSpec[]; arch: ArchSpec; quadrants: [number, number] }[] = [
    // quadrant on the +x side (patient's left) first, then the mirrored -x side
    { jaw: 'upper', specs: UPPER, arch: ARCHES.upper, quadrants: [2, 1] },
    { jaw: 'lower', specs: LOWER, arch: ARCHES.lower, quadrants: [3, 4] },
  ];
  for (const { jaw, specs, arch: archSpec, quadrants } of jaws) {
    const half = specs.reduce((acc, t) => acc + t.md + archSpec.gap, 0);
    const arch = new Arch(archSpec, half + 6);
    const placed: Placement[] = [];
    for (const spec of specs) {
      const canon = buildCrown(spec, TEMPLATES[spec.type]);
      let s = archSpec.gap / 2;
      for (const prev of specs) {
        if (prev.position >= spec.position) break;
        s += prev.md + archSpec.gap;
      }
      s += spec.md / 2;
      const [qPos, qNeg] = quadrants;
      placed.push(placeTooth(canon, arch, s, jaw, `${qPos}${spec.position}`, spec));
      placed.push(placeTooth(canon, arch, -s, jaw, `${qNeg}${spec.position}`, spec));
    }
    for (const t of placed) {
      teeth.push(t);
      meshes.push(t.mesh);
    }
    meshes.push(buildGums(arch, placed, jaw));
  }

  // centre in x/z; y is already the occlusal plane
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const m of meshes) {
    for (let i = 0; i < m.positions.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k]!, m.positions[i + k]!);
        max[k] = Math.max(max[k]!, m.positions[i + k]!);
      }
    }
  }
  const cx = (min[0]! + max[0]!) / 2;
  const cz = (min[2]! + max[2]!) / 2;
  for (const m of meshes) {
    for (let i = 0; i < m.positions.length; i += 3) {
      m.positions[i]! -= cx;
      m.positions[i + 2]! -= cz;
    }
  }
  // order: teeth by FDI, then gums
  meshes.sort((a, b) => a.name.localeCompare(b.name));
  return { meshes, teeth };
}

/** Smallest distance between any two vertices of two meshes (brute force). */
function minVertexDistance(a: Float32Array, b: Float32Array): number {
  let best = Infinity;
  for (let i = 0; i < a.length; i += 3) {
    const ax = a[i]!;
    const ay = a[i + 1]!;
    const az = a[i + 2]!;
    for (let j = 0; j < b.length; j += 3) {
      const dx = ax - b[j]!;
      const dy = ay - b[j + 1]!;
      const dz = az - b[j + 2]!;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < best) best = d;
    }
  }
  return Math.sqrt(best);
}

export function checkModel(model: GeneratedModel): string[] {
  const problems: string[] = [];
  const byFdi = new Map(model.teeth.map((t) => [t.fdi, t]));
  const archOrder = (q1: number, q2: number) => [
    ...[8, 7, 6, 5, 4, 3, 2, 1].map((p) => `${q1}${p}`),
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((p) => `${q2}${p}`),
  ];
  for (const order of [archOrder(1, 2), archOrder(4, 3)]) {
    for (let i = 0; i < order.length - 1; i++) {
      const a = byFdi.get(order[i]!)!;
      const b = byFdi.get(order[i + 1]!)!;
      const d = minVertexDistance(a.mesh.positions, b.mesh.positions);
      if (d < 0.05)
        problems.push(
          `teeth ${a.fdi} and ${b.fdi} touch/intersect (min distance ${d.toFixed(3)} mm)`,
        );
    }
  }
  return problems;
}

async function main(): Promise<void> {
  const check = process.argv.includes('--check');
  const t0 = performance.now();
  const model = generateModel();
  const raw = writeGlb(model.meshes);
  const rawPath = join(here, 'raw.glb');
  const outPath = join(here, 'default.glb');
  writeFileSync(rawPath, raw);

  const { pack } = await import('gltfpack');
  const log = await pack(
    ['-i', rawPath, '-o', outPath, '-cc', '-kn', '-km', '-ke', '-vp', '14', '-vn', '8'],
    {
      read: (p) => new Uint8Array(readFileSync(p)),
      write: (p, data) => writeFileSync(p, data),
    },
  );
  if (log.trim()) console.log(log.trim());

  let verts = 0;
  let tris = 0;
  for (const m of model.meshes) {
    verts += m.positions.length / 3;
    tris += m.indices.length / 3;
  }
  console.log(
    `generated ${model.meshes.length} meshes (${verts} vertices, ${tris} triangles) in ${(performance.now() - t0).toFixed(0)} ms`,
  );
  console.log(`raw.glb     ${(raw.byteLength / 1024).toFixed(1)} kB`);
  console.log(`default.glb ${(statSync(outPath).size / 1024).toFixed(1)} kB`);

  if (check) {
    const problems = checkModel(model);
    if (problems.length) {
      for (const p of problems) console.error(`✗ ${p}`);
      process.exitCode = 1;
    } else {
      console.log('✓ no neighbouring teeth intersect');
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
