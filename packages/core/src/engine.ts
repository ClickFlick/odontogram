/**
 * The three.js side of the viewer. This module is imported dynamically by `DentalViewer`
 * so consumers only download three.js (and the model) when a viewer is actually created.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { resolveModelName } from './model-naming.js';
import { isFdi, isUpper } from './numbering.js';
import type {
  Fdi,
  InteractionOptions,
  JawFilter,
  MissingMode,
  TeethStates,
  Theme,
  ToothState,
  ViewName,
} from './types.js';

export interface EngineHost {
  /** Element the canvas is appended to; sized by the consumer. */
  element: HTMLElement;
  onHover(fdi: Fdi | null): void;
  onPick(fdi: Fdi | null, pointer: { x: number; y: number }, double: boolean): void;
  /** Called whenever a frame was rendered (used for tests and debugging). */
  onFrame?(): void;
}

export interface LabelOptions {
  enabled: boolean;
  format(fdi: Fdi): string;
}

export interface Engine {
  load(source: string | ArrayBuffer): Promise<Fdi[]>;
  readonly teeth: readonly Fdi[];
  setTeeth(states: TeethStates, missingMode: MissingMode): void;
  setHover(fdi: Fdi | null): void;
  setSelected(fdi: Fdi | null, focus: boolean): void;
  setView(view: ViewName, animate: boolean): void;
  setJaw(jaw: JawFilter): void;
  setOpen(open: boolean, animate: boolean): void;
  setLabels(labels: LabelOptions): void;
  setTheme(theme: Theme): void;
  setInteraction(opts: InteractionOptions): void;
  /** Tooth under the given container-relative point, if any. */
  pick(x: number, y: number): Fdi | null;
  resize(): void;
  invalidate(): void;
  memory(): { geometries: number; textures: number };
  readonly frames: number;
  dispose(): void;
}

interface ToothEntry {
  fdi: Fdi;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  /** World-space centre of the crown. */
  center: THREE.Vector3;
  /** Unit vector pointing away from the arch (buccal/labial). */
  outward: THREE.Vector3;
  /** Half extents of the crown's bounding box. */
  halfSize: THREE.Vector3;
  own: THREE.MeshStandardMaterial | null;
  /** Back-face shell drawn slightly larger than the crown: the hover/selection outline. */
  outline: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> | null;
  state: ToothState | undefined;
  label: THREE.Sprite | null;
  badge: THREE.Sprite | null;
}

const VIEW_DURATION = 400;
const MAX_PIXEL_RATIO = 2;
const OPEN_ANGLE = THREE.MathUtils.degToRad(22);
const TAP_DISTANCE = 6;
const TAP_TIME = 600;
const DOUBLE_TAP_TIME = 350;

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function createEngine(host: EngineHost): Engine {
  return new ThreeEngine(host);
}

class ThreeEngine implements Engine {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly raycaster = new THREE.Raycaster();
  private readonly model = new THREE.Group();
  private readonly upper = new THREE.Group();
  private readonly lowerPivot = new THREE.Group();
  private readonly lower = new THREE.Group();
  private readonly labelsGroup = new THREE.Group();
  private readonly entries = new Map<Fdi, ToothEntry>();
  private readonly gums: THREE.Mesh[] = [];
  private toothMaterial: THREE.MeshStandardMaterial;
  private gumMaterial: THREE.MeshStandardMaterial;
  private environment: THREE.Texture;
  private theme: Theme | null = null;
  private missingMode: MissingMode = 'ghost';
  private hovered: Fdi | null = null;
  private selected: Fdi | null = null;
  private labels: LabelOptions = { enabled: false, format: (f) => f };
  private center = new THREE.Vector3();
  private fitDistance = 160;
  private hinge = new THREE.Vector3();
  private openAmount = 0;
  private readonly animations = new Set<(now: number) => boolean>();
  private rafId = 0;
  private visible = true;
  private disposed = false;
  private readonly resizeObserver: ResizeObserver | null;
  private readonly intersectionObserver: IntersectionObserver | null;
  private pointerDown: { x: number; y: number; t: number; id: number } | null = null;
  private lastTap: { fdi: Fdi | null; t: number } = { fdi: null, t: 0 };
  private hoverPending: { x: number; y: number } | null = null;
  readonly frames_ = { count: 0 };
  private pixelRatio = Math.min(
    typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
    MAX_PIXEL_RATIO,
  );
  private frameCost = 6;
  private lastFrameTime = 0;
  private lastAdapt = 0;
  private teethList: Fdi[] = [];

  constructor(private readonly host: EngineHost) {
    const el = host.element;
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // no tone mapping: theme colours render as specified (lights are kept below clipping)
    this.renderer.toneMapping = THREE.NoToneMapping;
    const canvas = this.renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.touchAction = 'none';
    canvas.style.outline = 'none';
    el.appendChild(canvas);

    this.camera = new THREE.PerspectiveCamera(32, 1, 1, 3000);
    this.camera.position.set(0, 20, 180);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.rotateSpeed = 0.8;
    this.controls.minPolarAngle = 0.2;
    this.controls.maxPolarAngle = Math.PI - 0.2;
    this.controls.minDistance = 30;
    this.controls.maxDistance = 600;
    this.controls.addEventListener('change', () => this.invalidate());

    // soft white enamel and matte gums under studio image-based light; baked ambient
    // occlusion (vertex colours) gives depth between teeth without any runtime cost
    this.toothMaterial = new THREE.MeshStandardMaterial({
      color: 0xf3f1ea,
      roughness: 0.36,
      metalness: 0,
      envMapIntensity: 0.9,
    });
    this.gumMaterial = new THREE.MeshStandardMaterial({
      color: 0xc48f8c,
      roughness: 0.7,
      metalness: 0,
      envMapIntensity: 0.4,
    });

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environment = this.environment;
    this.scene.environmentIntensity = 0.65;
    const hemi = new THREE.HemisphereLight(0xffffff, 0x9aa3b2, 0.35);
    const key = new THREE.DirectionalLight(0xffffff, 0.8);
    key.position.set(60, 120, 150);
    const fill = new THREE.DirectionalLight(0xffffff, 0.25);
    fill.position.set(-90, -30, 120);
    this.scene.add(hemi, key, fill);

    this.lowerPivot.add(this.lower);
    this.model.add(this.upper, this.lowerPivot, this.labelsGroup);
    this.scene.add(this.model);

    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerCancel);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    canvas.addEventListener('webglcontextlost', this.onContextLost);

    this.resizeObserver =
      typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.resize()) : null;
    this.resizeObserver?.observe(el);
    this.intersectionObserver =
      typeof IntersectionObserver === 'function'
        ? new IntersectionObserver((entries) => {
            const e = entries[entries.length - 1];
            if (!e) return;
            this.visible = e.isIntersecting;
            if (this.visible) this.invalidate();
            else this.cancelFrame();
          })
        : null;
    this.intersectionObserver?.observe(el);
    this.resize();
  }

  get teeth(): readonly Fdi[] {
    return this.teethList;
  }

  get frames(): number {
    return this.frames_.count;
  }

  // -------------------------------------------------------------------------------------
  // loading

  async load(source: string | ArrayBuffer): Promise<Fdi[]> {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const gltf =
      typeof source === 'string'
        ? await loader.loadAsync(source)
        : await loader.parseAsync(source, '');
    if (this.disposed) return [];

    const meshes: THREE.Mesh[] = [];
    gltf.scene.updateWorldMatrix(true, true);
    gltf.scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
    });

    const bbox = new THREE.Box3();
    let hasVertexColors = false;
    for (const src of meshes) {
      const name = resolveModelName(src);
      const geometry = bakeGeometry(src);
      const box =
        geometry.boundingBox ??
        new THREE.Box3().setFromBufferAttribute(
          geometry.getAttribute('position') as THREE.BufferAttribute,
        );
      const center = box.getCenter(new THREE.Vector3());
      const halfSize = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
      geometry.translate(-center.x, -center.y, -center.z);
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      bbox.expandByPoint(box.min).expandByPoint(box.max);

      if (geometry.hasAttribute('color')) hasVertexColors = true;
      if (isFdi(name)) {
        const mesh = new THREE.Mesh(geometry, this.toothMaterial);
        mesh.name = name;
        mesh.position.copy(center);
        (isUpper(name) ? this.upper : this.lower).add(mesh);
        this.entries.set(name, {
          fdi: name,
          mesh,
          center,
          outward: new THREE.Vector3(),
          halfSize,
          own: null,
          outline: null,
          state: undefined,
          label: null,
          badge: null,
        });
      } else {
        const mesh = new THREE.Mesh(geometry, this.gumMaterial);
        mesh.name = name;
        mesh.position.copy(center);
        const lowerish = /lower|mandib/i.test(name) || center.y < 0;
        (lowerish ? this.lower : this.upper).add(mesh);
        this.gums.push(mesh);
      }
    }
    // dispose the source scene's own materials (we use ours)
    gltf.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(m)) m.forEach((x) => x.dispose());
      else m?.dispose();
    });

    if (hasVertexColors) {
      this.toothMaterial.vertexColors = true;
      this.gumMaterial.vertexColors = true;
      this.toothMaterial.needsUpdate = true;
      this.gumMaterial.needsUpdate = true;
    }

    // arch centre for outward directions
    const archCenter = new THREE.Vector3();
    let n = 0;
    for (const e of this.entries.values()) {
      archCenter.x += e.center.x;
      archCenter.z += e.center.z;
      n++;
    }
    if (n) archCenter.divideScalar(n);
    for (const e of this.entries.values()) {
      e.outward.set(e.center.x - archCenter.x, 0, e.center.z - archCenter.z);
      if (e.outward.lengthSq() < 1e-6) e.outward.set(0, 0, 1);
      e.outward.normalize();
    }

    bbox.getCenter(this.center);
    const size = bbox.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z) / 2;
    this.fitDistance = (radius / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) * 1.05;
    this.camera.near = Math.max(0.5, this.fitDistance / 100);
    this.camera.far = this.fitDistance * 20;
    this.camera.updateProjectionMatrix();
    this.controls.minDistance = radius * 0.6;
    this.controls.maxDistance = this.fitDistance * 4;
    this.controls.target.copy(this.center);

    // jaw hinge: behind and above the occlusal plane (roughly the condyles)
    this.hinge.set(this.center.x, this.center.y + size.y * 0.9, bbox.min.z - size.z * 1.2);
    this.lowerPivot.position.copy(this.hinge);
    this.lower.position.copy(this.hinge).negate();

    this.teethList = [...this.entries.keys()].sort();
    this.applyTheme();
    this.rebuildLabels();
    this.setView('front', false);
    this.invalidate();
    return this.teethList;
  }

  // -------------------------------------------------------------------------------------
  // state

  setTeeth(states: TeethStates, missingMode: MissingMode): void {
    this.missingMode = missingMode;
    for (const e of this.entries.values()) {
      const next = states[e.fdi];
      const changed = !shallowEqualState(e.state, next);
      e.state = next;
      if (changed) {
        this.applyAppearance(e);
        this.updateBadge(e);
      }
    }
    this.invalidate();
  }

  setHover(fdi: Fdi | null): void {
    if (fdi === this.hovered) return;
    const prev = this.hovered;
    this.hovered = fdi;
    if (prev) this.applyAppearance(this.entries.get(prev));
    if (fdi) this.applyAppearance(this.entries.get(fdi));
    this.renderer.domElement.style.cursor = fdi ? 'pointer' : '';
    this.invalidate();
  }

  setSelected(fdi: Fdi | null, focus: boolean): void {
    const prev = this.selected;
    this.selected = fdi;
    if (prev && prev !== fdi) this.applyAppearance(this.entries.get(prev));
    if (fdi) this.applyAppearance(this.entries.get(fdi));
    if (fdi && focus) this.flyTo(fdi);
    this.invalidate();
  }

  setView(view: ViewName, animate: boolean): void {
    const c = this.center;
    const d = this.fitDistance;
    const pos = new THREE.Vector3();
    switch (view) {
      case 'front':
      case 'reset':
        pos.set(c.x, c.y + d * 0.1, c.z + d);
        break;
      case 'left':
        pos.set(c.x + d * 0.95, c.y + d * 0.08, c.z + d * 0.3);
        break;
      case 'right':
        pos.set(c.x - d * 0.95, c.y + d * 0.08, c.z + d * 0.3);
        break;
      case 'upper-occlusal':
        pos.set(c.x, c.y - d * 0.95, c.z + d * 0.3);
        break;
      case 'lower-occlusal':
        pos.set(c.x, c.y + d * 0.95, c.z + d * 0.3);
        break;
    }
    this.moveCamera(pos, c.clone(), animate);
  }

  setJaw(jaw: JawFilter): void {
    this.upper.visible = jaw !== 'lower';
    this.lowerPivot.visible = jaw !== 'upper';
    for (const e of this.entries.values()) this.updateLabelVisibility(e);
    this.invalidate();
  }

  setOpen(open: boolean, animate: boolean): void {
    const target = open ? 1 : 0;
    if (!animate) {
      this.openAmount = target;
      this.lowerPivot.rotation.x = OPEN_ANGLE * target;
      this.syncLabels();
      this.invalidate();
      return;
    }
    const from = this.openAmount;
    const start = performance.now();
    this.animations.add((now) => {
      const t = Math.min(1, (now - start) / VIEW_DURATION);
      this.openAmount = from + (target - from) * easeInOut(t);
      this.lowerPivot.rotation.x = OPEN_ANGLE * this.openAmount;
      this.syncLabels();
      return t < 1;
    });
    this.invalidate();
  }

  setLabels(labels: LabelOptions): void {
    this.labels = labels;
    this.rebuildLabels();
    this.invalidate();
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
    this.applyTheme();
    this.rebuildLabels();
    this.invalidate();
  }

  setInteraction(opts: InteractionOptions): void {
    this.controls.enableRotate = opts.rotate ?? true;
    this.controls.enableZoom = opts.zoom ?? true;
    this.controls.enablePan = opts.pan ?? true;
  }

  pick(x: number, y: number): Fdi | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const ndc = new THREE.Vector2((x / rect.width) * 2 - 1, -(y / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const targets: THREE.Object3D[] = [];
    for (const e of this.entries.values()) {
      if (!e.mesh.visible || e.state?.disabled) continue;
      if (!isJawVisible(e.fdi, this.upper.visible, this.lowerPivot.visible)) continue;
      targets.push(e.mesh);
    }
    const hits = this.raycaster.intersectObjects(targets, false);
    const first = hits[0];
    if (!first) return null;
    return isFdi(first.object.name) ? first.object.name : null;
  }

  resize(): void {
    if (this.disposed) return;
    this.pixelRatio = Math.min(
      this.pixelRatio,
      Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO),
    );
    this.applySize();
    this.invalidate();
  }

  invalidate(): void {
    if (this.disposed || !this.visible || this.rafId) return;
    this.rafId = requestAnimationFrame(this.frame);
  }

  memory(): { geometries: number; textures: number } {
    const m = this.renderer.info.memory;
    return { geometries: m.geometries, textures: m.textures };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelFrame();
    this.resizeObserver?.disconnect();
    this.intersectionObserver?.disconnect();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('pointercancel', this.onPointerCancel);
    canvas.removeEventListener('pointerleave', this.onPointerLeave);
    canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.controls.dispose();
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      const mats = Array.isArray(mat) ? mat : mat ? [mat] : [];
      for (const m of mats) {
        const map = (m as THREE.SpriteMaterial).map;
        if (map) map.dispose();
        m.dispose();
      }
    });
    this.toothMaterial.dispose();
    this.gumMaterial.dispose();
    this.environment.dispose();
    this.scene.environment = null;
    this.entries.clear();
    this.gums.length = 0;
    this.renderer.renderLists.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    canvas.remove();
  }

  // -------------------------------------------------------------------------------------
  // appearance

  private applyTheme(): void {
    const theme = this.theme;
    if (!theme) return;
    this.toothMaterial.color.set(theme.tooth);
    this.gumMaterial.color.set(theme.gums);
    if (theme.background === 'transparent' || !theme.background) {
      this.renderer.setClearColor(0x000000, 0);
    } else {
      this.renderer.setClearColor(new THREE.Color(theme.background), 1);
    }
    for (const e of this.entries.values()) this.applyAppearance(e);
  }

  private applyAppearance(e: ToothEntry | undefined): void {
    if (!e) return;
    const theme = this.theme;
    const state = e.state;
    const status = state?.status ?? 'present';
    const missing = status === 'missing';
    const hidden = missing && this.missingMode === 'hide';
    e.mesh.visible = !hidden;
    this.updateLabelVisibility(e);

    const hovered = this.hovered === e.fdi && !state?.disabled;
    const selected = this.selected === e.fdi;
    this.updateOutline(e, selected ? 'selected' : hovered ? 'hover' : null);

    const tint = state?.tint;
    const statusColor =
      theme && status !== 'present' ? theme.statuses[status as keyof Theme['statuses']] : null;
    const needsOwn = Boolean(tint || statusColor || missing || state?.disabled);

    if (!needsOwn) {
      if (e.own) {
        e.own.dispose();
        e.own = null;
      }
      e.mesh.material = this.toothMaterial;
      e.mesh.renderOrder = 0;
      return;
    }
    if (!e.own) e.own = this.toothMaterial.clone();
    const m = e.own;
    m.vertexColors = this.toothMaterial.vertexColors;
    m.color.copy(this.toothMaterial.color);
    // status tints keep a little enamel in them so they sit naturally next to white teeth
    if (statusColor) m.color.set(statusColor).lerp(this.toothMaterial.color, 0.15);
    if (tint) m.color.set(tint);
    if (missing) {
      m.transparent = true;
      m.opacity = theme?.ghostOpacity ?? 0.16;
      m.depthWrite = false;
      e.mesh.renderOrder = 2;
    } else {
      m.transparent = false;
      m.opacity = 1;
      m.depthWrite = true;
      e.mesh.renderOrder = 0;
    }
    if (state?.disabled && !missing) m.color.lerp(new THREE.Color(0x9ca3af), 0.45);
    m.needsUpdate = true;
    e.mesh.material = m;
  }

  private updateOutline(e: ToothEntry, kind: 'hover' | 'selected' | null): void {
    if (!kind) {
      if (e.outline) e.outline.visible = false;
      return;
    }
    if (!e.outline) {
      const mat = new THREE.MeshBasicMaterial({ side: THREE.BackSide, toneMapped: false });
      e.outline = new THREE.Mesh(e.mesh.geometry, mat);
      e.outline.renderOrder = -1;
      e.mesh.add(e.outline);
    }
    const theme = this.theme;
    e.outline.visible = e.mesh.visible;
    e.outline.material.color.set(
      kind === 'selected' ? (theme?.selected ?? '#2563eb') : (theme?.hover ?? '#60a5fa'),
    );
    // constant-ish thickness: grow by ~0.45 mm (selected) / 0.3 mm (hover)
    const grow = kind === 'selected' ? 0.35 : 0.22;
    const r = Math.max(e.halfSize.x, e.halfSize.y, e.halfSize.z);
    e.outline.scale.setScalar(1 + grow / r);
  }

  private updateLabelVisibility(e: ToothEntry): void {
    const jawVisible = isJawVisible(e.fdi, this.upper.visible, this.lowerPivot.visible);
    if (e.label) e.label.visible = jawVisible && e.mesh.visible;
    if (e.badge) e.badge.visible = jawVisible && e.mesh.visible;
  }

  private rebuildLabels(): void {
    for (const e of this.entries.values()) {
      if (e.label) {
        disposeSprite(e.label);
        e.label = null;
      }
      if (this.labels.enabled && this.theme) {
        const sprite = makeTextSprite(this.labels.format(e.fdi), {
          color: this.theme.label,
          background: this.theme.labelBackground || null,
          fontSize: 44,
          heightMm: 1.7,
          depthTest: true,
        });
        e.label = sprite;
        this.labelsGroup.add(sprite);
      }
      this.updateBadge(e);
      this.updateLabelVisibility(e);
    }
    this.syncLabels();
  }

  private updateBadge(e: ToothEntry): void {
    if (e.badge) {
      disposeSprite(e.badge);
      e.badge = null;
    }
    const badge = e.state?.badge;
    if (badge === undefined || badge === null || badge === '' || !this.theme) return;
    const sprite = makeTextSprite(String(badge), {
      color: this.theme.badgeText,
      background: this.theme.badge,
      fontSize: 40,
      heightMm: 1.6,
      depthTest: true,
    });
    e.badge = sprite;
    this.labelsGroup.add(sprite);
    this.updateLabelVisibility(e);
    this.syncLabels();
  }

  /** Positions label/badge sprites next to their teeth (follows the jaw when opening). */
  private syncLabels(): void {
    const tmp = new THREE.Vector3();
    this.lowerPivot.updateMatrixWorld(true);
    for (const e of this.entries.values()) {
      if (!e.label && !e.badge) continue;
      const up = isUpper(e.fdi) ? 1 : -1;
      const radial = Math.max(e.halfSize.x, e.halfSize.z) + 1.4;
      if (e.label) {
        tmp.copy(e.center).addScaledVector(e.outward, radial);
        tmp.y -= up * e.halfSize.y * 0.35;
        this.toWorld(e, tmp);
        e.label.position.copy(tmp);
      }
      if (e.badge) {
        // same anchor as the label; the sprite's centre offset floats it above the label in
        // screen space from every camera angle
        tmp.copy(e.center).addScaledVector(e.outward, radial);
        tmp.y -= up * e.halfSize.y * 0.35;
        this.toWorld(e, tmp);
        e.badge.position.copy(tmp);
        e.badge.center.set(0.5, e.label ? -0.75 : 0.5);
      }
    }
  }

  private toWorld(e: ToothEntry, v: THREE.Vector3): void {
    if (!isUpper(e.fdi)) {
      // lower teeth live under the hinge pivot
      this.lower.localToWorld(v);
      this.model.worldToLocal(v);
    }
  }

  // -------------------------------------------------------------------------------------
  // camera

  private moveCamera(position: THREE.Vector3, target: THREE.Vector3, animate: boolean): void {
    if (!animate) {
      this.camera.position.copy(position);
      this.controls.target.copy(target);
      this.controls.update();
      this.invalidate();
      return;
    }
    const p0 = this.camera.position.clone();
    const t0 = this.controls.target.clone();
    const start = performance.now();
    this.animations.add((now) => {
      const t = Math.min(1, (now - start) / VIEW_DURATION);
      const k = easeInOut(t);
      this.camera.position.lerpVectors(p0, position, k);
      this.controls.target.lerpVectors(t0, target, k);
      return t < 1;
    });
    this.invalidate();
  }

  private flyTo(fdi: Fdi): void {
    const e = this.entries.get(fdi);
    if (!e) return;
    const target = e.center.clone();
    this.toWorld(e, target);
    const dir = e.outward.clone();
    dir.y += isUpper(fdi) ? -0.35 : 0.35;
    dir.normalize();
    const position = target.clone().addScaledVector(dir, this.fitDistance * 0.42);
    this.moveCamera(position, target, true);
  }

  // -------------------------------------------------------------------------------------
  // render loop

  private readonly frame = (now: number): void => {
    this.rafId = 0;
    if (this.disposed) return;
    let again = false;
    for (const a of this.animations) {
      if (a(now)) again = true;
      else this.animations.delete(a);
    }
    if (this.controls.update()) again = true;
    if (this.hoverPending) {
      const { x, y } = this.hoverPending;
      this.hoverPending = null;
      const fdi = this.pick(x, y);
      if (fdi !== this.hovered) this.host.onHover(fdi);
    }
    const t0 = performance.now();
    this.renderer.render(this.scene, this.camera);
    this.frames_.count++;
    this.host.onFrame?.();
    if (again) this.adaptResolution(performance.now() - t0, now);
    else this.lastFrameTime = 0;
    if (again && this.visible) this.rafId = requestAnimationFrame(this.frame);
  };

  /**
   * Keeps interaction smooth on weak GPUs: while the camera moves, slow frames lower the
   * pixel ratio in steps (down to 1); consistently fast frames raise it back to the cap.
   */
  private adaptResolution(renderMs: number, now: number): void {
    // the rAF delta is the honest measure of jank (GPU work is asynchronous to render())
    const delta = this.lastFrameTime ? now - this.lastFrameTime : 16.7;
    this.lastFrameTime = now;
    const cost = Math.max(renderMs, delta - 16.7);
    this.frameCost = this.frameCost * 0.8 + cost * 0.2;
    if (now - this.lastAdapt < 500) return;
    const cap = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    let next = this.pixelRatio;
    if (this.frameCost > 12 && this.pixelRatio > 1) next = Math.max(1, this.pixelRatio - 0.25);
    else if (this.frameCost < 3 && this.pixelRatio < cap)
      next = Math.min(cap, this.pixelRatio + 0.25);
    if (next !== this.pixelRatio) {
      this.pixelRatio = next;
      this.lastAdapt = now;
      this.frameCost = 6;
      this.applySize();
    }
  }

  private applySize(): void {
    const el = this.host.element;
    const w = Math.max(1, el.clientWidth);
    const h = Math.max(1, el.clientHeight);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private cancelFrame(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  // -------------------------------------------------------------------------------------
  // pointer

  private local(ev: PointerEvent): { x: number; y: number } {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  }

  private readonly onPointerDown = (ev: PointerEvent): void => {
    if (this.pointerDown) return; // second finger: pinch/rotate, never a tap
    const p = this.local(ev);
    this.pointerDown = { ...p, t: performance.now(), id: ev.pointerId };
  };

  private readonly onPointerMove = (ev: PointerEvent): void => {
    if (ev.pointerType === 'touch') return;
    // while dragging the camera, hover would only flicker
    if (this.pointerDown) return;
    this.hoverPending = this.local(ev);
    if (!this.rafId) this.rafId = requestAnimationFrame(this.hoverFrame);
  };

  /** Resolves a pending hover without rendering unless the hovered tooth changed. */
  private readonly hoverFrame = (now: number): void => {
    this.rafId = 0;
    if (this.disposed) return;
    if (this.hoverPending) {
      const { x, y } = this.hoverPending;
      this.hoverPending = null;
      const fdi = this.pick(x, y);
      if (fdi !== this.hovered) this.host.onHover(fdi);
    }
    if (this.animations.size) this.frame(now);
  };

  private readonly onPointerUp = (ev: PointerEvent): void => {
    const down = this.pointerDown;
    if (!down || down.id !== ev.pointerId) return;
    this.pointerDown = null;
    const p = this.local(ev);
    const dist = Math.hypot(p.x - down.x, p.y - down.y);
    const dt = performance.now() - down.t;
    if (dist > TAP_DISTANCE || dt > TAP_TIME) return;
    const fdi = this.pick(p.x, p.y);
    const now = performance.now();
    const double =
      fdi !== null && this.lastTap.fdi === fdi && now - this.lastTap.t < DOUBLE_TAP_TIME;
    this.lastTap = { fdi, t: double ? 0 : now };
    this.host.onPick(fdi, p, double);
  };

  private readonly onPointerCancel = (ev: PointerEvent): void => {
    if (this.pointerDown?.id === ev.pointerId) this.pointerDown = null;
  };

  private readonly onPointerLeave = (): void => {
    this.hoverPending = null;
    this.host.onHover(null);
  };

  private readonly onContextLost = (ev: Event): void => {
    ev.preventDefault();
  };
}

// -----------------------------------------------------------------------------------------
// helpers

function isJawVisible(fdi: Fdi, upperVisible: boolean, lowerVisible: boolean): boolean {
  return isUpper(fdi) ? upperVisible : lowerVisible;
}

function shallowEqualState(a: ToothState | undefined, b: ToothState | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.status === b.status &&
    a.tint === b.tint &&
    a.badge === b.badge &&
    a.disabled === b.disabled &&
    a.data === b.data
  );
}

/**
 * Returns a float32 copy of the mesh geometry with its world transform baked in. Handles
 * quantised (int16/int8) attributes produced by KHR_mesh_quantization.
 */
function bakeGeometry(mesh: THREE.Mesh): THREE.BufferGeometry {
  const src = mesh.geometry;
  const geometry = new THREE.BufferGeometry();
  const pos = toFloatAttribute(src.getAttribute('position') as THREE.BufferAttribute);
  geometry.setAttribute('position', pos);
  const nrm = src.getAttribute('normal') as THREE.BufferAttribute | undefined;
  if (nrm) geometry.setAttribute('normal', toFloatAttribute(nrm));
  const col = src.getAttribute('color') as THREE.BufferAttribute | undefined;
  if (col) geometry.setAttribute('color', toFloatAttribute(col, 3));
  if (src.index) geometry.setIndex(src.index.clone());
  geometry.applyMatrix4(mesh.matrixWorld);
  if (!nrm) geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  return geometry;
}

function toFloatAttribute(attr: THREE.BufferAttribute, itemSize?: number): THREE.BufferAttribute {
  const size = Math.min(attr.itemSize, itemSize ?? attr.itemSize);
  const out = new Float32Array(attr.count * size);
  for (let i = 0; i < attr.count; i++) {
    out[i * size] = attr.getX(i);
    if (size > 1) out[i * size + 1] = attr.getY(i);
    if (size > 2) out[i * size + 2] = attr.getZ(i);
    if (size > 3) out[i * size + 3] = attr.getW(i);
  }
  return new THREE.BufferAttribute(out, size);
}

interface SpriteStyle {
  color: string;
  background: string | null;
  fontSize: number;
  heightMm: number;
  /** Depth-tested sprites disappear behind geometry, which keeps labels uncluttered. */
  depthTest: boolean;
}

function makeTextSprite(text: string, style: SpriteStyle): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const font = `500 ${style.fontSize}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  let width = 64;
  if (ctx) {
    ctx.font = font;
    width = Math.ceil(ctx.measureText(text).width);
  }
  const padX = style.background ? style.fontSize * 0.5 : 4;
  const h = Math.ceil(style.fontSize * 1.4);
  const w = Math.max(h, width + padX * 2);
  canvas.width = w;
  canvas.height = h;
  if (ctx) {
    ctx.clearRect(0, 0, w, h);
    if (style.background) {
      ctx.fillStyle = style.background;
      roundRect(ctx, 0, 0, w, h, h / 2);
      ctx.fill();
    } else {
      // soft halo so labels stay readable over teeth and gums
      ctx.font = font;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = style.fontSize * 0.18;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineJoin = 'round';
      ctx.strokeText(text, w / 2, h / 2 + 1);
    }
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = style.color;
    ctx.fillText(text, w / 2, h / 2 + 1);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: style.depthTest,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.renderOrder = style.depthTest ? 5 : 10;
  sprite.scale.set((style.heightMm * w) / h, style.heightMm, 1);
  return sprite;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function disposeSprite(sprite: THREE.Sprite): void {
  sprite.removeFromParent();
  sprite.material.map?.dispose();
  sprite.material.dispose();
}
