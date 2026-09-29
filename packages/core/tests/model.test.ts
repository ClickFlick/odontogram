/**
 * Loads the generated model/default.glb with three's GLTFLoader (in Node) and checks the
 * naming convention, orientation and bounds documented in docs/MODEL.md.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { ALL_TEETH, isFdi, isUpper, side } from '../src/numbering.js';
import { resolveModelName } from '../src/model-naming.js';
import { checkModel, generateModel } from '../model/generate.js';

const here = dirname(fileURLToPath(import.meta.url));
const glbPath = join(here, '..', 'model', 'default.glb');

let meshes: Map<string, THREE.Mesh>;

beforeAll(async () => {
  const buf = readFileSync(glbPath);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.parseAsync(ab, '');
  gltf.scene.updateWorldMatrix(true, true);
  meshes = new Map();
  gltf.scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.set(resolveModelName(o), o as THREE.Mesh);
  });
});

function worldBox(mesh: THREE.Mesh): THREE.Box3 {
  mesh.geometry.computeBoundingBox();
  return mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld);
}

describe('default.glb', () => {
  it('is smaller than 500 kB', () => {
    expect(readFileSync(glbPath).byteLength).toBeLessThan(500 * 1024);
  });

  it('contains exactly the 32 permanent teeth, named by FDI code, plus two gum meshes', () => {
    const names = [...meshes.keys()].sort();
    const teeth = names.filter(isFdi);
    expect(teeth).toEqual([...ALL_TEETH].sort());
    expect(names.filter((n) => !isFdi(n)).sort()).toEqual(['gums_lower', 'gums_upper']);
  });

  it('is +Y up with the upper arch above the lower arch and the occlusal plane at y ≈ 0', () => {
    for (const fdi of ALL_TEETH) {
      const box = worldBox(meshes.get(fdi)!);
      if (isUpper(fdi)) {
        expect(box.min.y).toBeGreaterThanOrEqual(-0.05);
        expect(box.min.y).toBeLessThan(0.6);
        expect(box.max.y).toBeGreaterThan(5);
      } else {
        expect(box.max.y).toBeLessThanOrEqual(0.05);
        expect(box.max.y).toBeGreaterThan(-0.6);
        expect(box.min.y).toBeLessThan(-5);
      }
    }
    const upperGums = worldBox(meshes.get('gums_upper')!);
    const lowerGums = worldBox(meshes.get('gums_lower')!);
    expect(upperGums.min.y).toBeGreaterThan(0);
    expect(lowerGums.max.y).toBeLessThan(0);
  });

  it("puts the patient's right at -X and the incisors towards +Z", () => {
    for (const fdi of ALL_TEETH) {
      const c = worldBox(meshes.get(fdi)!).getCenter(new THREE.Vector3());
      if (side(fdi) === 'right') expect(c.x).toBeLessThan(0);
      else expect(c.x).toBeGreaterThan(0);
    }
    const incisor = worldBox(meshes.get('11')!).getCenter(new THREE.Vector3());
    const molar = worldBox(meshes.get('18')!).getCenter(new THREE.Vector3());
    expect(incisor.z).toBeGreaterThan(molar.z + 30);
  });

  it('is centred on the origin in x/z and fits a realistic mouth', () => {
    const all = new THREE.Box3();
    for (const m of meshes.values()) all.union(worldBox(m));
    const c = all.getCenter(new THREE.Vector3());
    const size = all.getSize(new THREE.Vector3());
    expect(Math.abs(c.x)).toBeLessThan(0.5);
    expect(Math.abs(c.z)).toBeLessThan(0.5);
    // inter-molar width plus gums, arch depth, two crowns + gums
    expect(size.x).toBeGreaterThan(55);
    expect(size.x).toBeLessThan(80);
    expect(size.z).toBeGreaterThan(45);
    expect(size.z).toBeLessThan(75);
    expect(size.y).toBeGreaterThan(30);
    expect(size.y).toBeLessThan(60);
  });

  it('has a crown height of about 10 mm for the upper central incisor', () => {
    const box = worldBox(meshes.get('11')!);
    const h = box.max.y - box.min.y;
    expect(h).toBeGreaterThan(9);
    expect(h).toBeLessThan(12);
  });

  it('has mirror-symmetric quadrants', () => {
    for (const p of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const a = worldBox(meshes.get(`1${p}`)!).getCenter(new THREE.Vector3());
      const b = worldBox(meshes.get(`2${p}`)!).getCenter(new THREE.Vector3());
      expect(Math.abs(a.x + b.x)).toBeLessThan(0.1);
      expect(Math.abs(a.z - b.z)).toBeLessThan(0.1);
      expect(Math.abs(a.y - b.y)).toBeLessThan(0.1);
    }
  });
});

describe('generator', () => {
  it('produces teeth that do not intersect their neighbours', () => {
    const model = generateModel();
    expect(model.teeth).toHaveLength(32);
    expect(checkModel(model)).toEqual([]);
  });
});
