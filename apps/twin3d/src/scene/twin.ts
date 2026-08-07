// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenAgriOS Contributors

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { DispatchAssignment, FieldPlot, HarvesterMachine } from '../../../web/src/types';
import { defaultBasemapConfig, loadBasemap, type BasemapResult, type Bounds } from '../geo/basemap';
import { bearingDeg, centroid, enu, longEdgeAxis, polygonArea, ringToLocal, splitByFraction, sunVector, yawForBearing, type Origin, type P } from '../geo/geo';
import { CROP_HEIGHT_M, cropState, readinessLabel, MACHINE_STATUS_LABEL } from './crop';
import { buildMachine, type MachineModel } from './machineModel';
import { skyFor } from './sky';
import { MachineTrack } from './tracker';

export type Pick = { type: 'field' | 'machine'; id: string };
export interface BasemapInfo { mode: 'loading' | 'satellite' | 'offline'; attribution: string; loaded: number; total: number; zoom: number }
export interface TwinInput { fields: FieldPlot[]; machines: HarvesterMachine[]; assignments: DispatchAssignment[]; hour: number }
export interface TwinHooks { onPick: (p: Pick | null) => void; onBasemap: (i: BasemapInfo) => void }

export interface TwinDebug {
  origin: Origin | null;
  basemap: BasemapInfo;
  machines: Array<{ id: string; x: number; z: number; headingDeg: number; status: string }>;
  fields: Array<{ id: string; areaM2: number; harvested: number }>;
  hidden: { fields: number; machines: number };
  drawCalls: number;
  layers: { detail: boolean; local: boolean };
  camera: { x: number; y: number; z: number; tx: number; ty: number; tz: number };
}

interface FieldEntry {
  group: THREE.Group; sig: string; pts: P[]; center: P; axis: P; outline: THREE.LineLoop; fence: THREE.Mesh;
  label: HTMLDivElement; radius: number; field: FieldPlot; harvested: number; blocked: boolean;
}

interface MachineEntry {
  model: MachineModel; track: MachineTrack; label: HTMLDivElement; ring: THREE.Mesh; machine: HarvesterMachine; moving: boolean;
}

const hasGeo = (lat: number, lng: number) => Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);

function cropTexture(base: string, row: string): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = base; g.fillRect(0, 0, 128, 128);
  g.fillStyle = row;
  for (let x = 0; x < 128; x += 16) g.fillRect(x, 0, 6, 128);
  for (let i = 0; i < 700; i++) { g.fillStyle = i % 2 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)'; g.fillRect(Math.random() * 128, Math.random() * 128, 2, 3); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.repeat.set(1 / 6, 1 / 6); t.anisotropy = 8;
  return t;
}

const toShape = (pts: P[]) => new THREE.Shape(pts.map((p) => new THREE.Vector2(p.x, -p.z)));

/** True-scale 3D scene of the farm: real field boundaries, harvesters at their telemetry position and inferred heading. */
export class Twin {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private sun = new THREE.DirectionalLight(0xffffff, 1);
  private hemi = new THREE.HemisphereLight(0xcfe8ff, 0x4a5a38, 0.8);
  private overlay: HTMLDivElement;
  private ground: THREE.Mesh | null = null;
  private detail: THREE.Mesh | null = null;
  private fieldsCenter = new THREE.Vector3();
  private fieldsExtent = 600;
  private far = false;
  private fields = new Map<string, FieldEntry>();
  private machines = new Map<string, MachineEntry>();
  private textures: Record<string, THREE.CanvasTexture>;
  private origin: Origin | null = null;
  private extent = 600;
  private selected: Pick | null = null;
  private followId: string | null = null;
  private fly: { fromT: THREE.Vector3; toT: THREE.Vector3; fromP: THREE.Vector3; toP: THREE.Vector3; t0: number; dur: number; machineId?: string } | null = null;
  private basemap: BasemapInfo = { mode: 'loading', attribution: '', loaded: 0, total: 0, zoom: 0 };
  private hidden = { fields: 0, machines: 0 };
  private raf = 0;
  private last = performance.now();
  private down: { x: number; y: number } | null = null;
  private ro: ResizeObserver;
  private disposed = false;
  private tmp = new THREE.Vector3();

  constructor(private container: HTMLElement, private hooks: TwinHooks) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', logarithmicDepthBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = 'block';

    this.overlay = document.createElement('div');
    this.overlay.className = 'tw-overlay';
    container.appendChild(this.overlay);

    this.camera = new THREE.PerspectiveCamera(50, 1, 1, 200_000);
    this.camera.position.set(0, 400, 600);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.49; this.controls.minDistance = 6;
    this.controls.screenSpacePanning = false;

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    const sc = this.sun.shadow.camera; sc.left = -260; sc.right = 260; sc.top = 260; sc.bottom = -260; sc.near = 1; sc.far = 1600;
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.6;
    this.scene.add(this.sun, this.sun.target, this.hemi);

    this.textures = {
      growing: cropTexture('#5f9a35', '#4f8a2b'),
      ripe: cropTexture('#d2b04a', '#bd9a37'),
      stubble: cropTexture('#a99a62', '#8f8250'),
    };

    const outer = new THREE.Mesh(new THREE.PlaneGeometry(160_000, 160_000), new THREE.MeshLambertMaterial({ color: 0x5d7a45 }));
    outer.rotation.x = -Math.PI / 2; outer.position.y = -0.4; outer.receiveShadow = false;
    outer.renderOrder = -10; (outer.material as THREE.Material).depthWrite = false; // always drawn first, never fights the ground
    this.scene.add(outer);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
    this.setHour(9);

    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointerup', this.onUp);
    this.raf = requestAnimationFrame(this.loop);
  }

  // ------------------------------------------------------------------ public API
  update(input: TwinInput): void {
    if (this.disposed) return;
    const located = input.fields.filter((f) => this.fieldRing(f)) ;
    const mach = input.machines.filter((m) => hasGeo(m.current_lat, m.current_lng));
    this.hidden = { fields: input.fields.length - located.length, machines: input.machines.length - mach.length };
    if (!this.origin && (located.length || mach.length)) this.initWorld(located, mach);
    if (!this.origin) return;

    this.setHour(input.hour);
    const seen = new Set<string>();
    for (const f of located) { seen.add(f.field_id); this.syncField(f); }
    for (const [id, e] of this.fields) if (!seen.has(id)) { this.removeField(id, e); }

    const active = new Map<string, DispatchAssignment>();
    for (const a of input.assignments) if (a.status === 'IN_PROGRESS' || a.status === 'CONFIRMED') active.set(a.machine_id, a);
    const mseen = new Set<string>();
    for (const m of mach) { mseen.add(m.machine_id); this.syncMachine(m, active.get(m.machine_id)); }
    for (const [id, e] of this.machines) if (!mseen.has(id)) { this.removeMachine(id, e); }
    this.refreshLabels();
    if (this.pending) {
      const p = this.pending;
      if (p.type === 'machine' ? this.machines.has(p.id) : this.fields.has(p.id)) {
        this.pending = null;
        this.loadLocalDetail(p);
        this.flyTo(p); this.snapFly();
        if (p.type === 'machine') this.followId = p.id;
      }
    }
  }

  /** A sharp mosaic of the ground around the focused object (the wide layers are too coarse at close range). */
  private loadLocalDetail(p: Pick): void {
    const o = this.origin; if (!o) return;
    const c = p.type === 'machine' ? this.machines.get(p.id)?.track : this.fields.get(p.id)?.center;
    if (!c) return;
    const r = 450;
    void loadBasemap(o, { minX: c.x - r, maxX: c.x + r, minZ: c.z - r, maxZ: c.z + r }, { ...defaultBasemapConfig(), maxTiles: 16 }).then((res) => {
      if (this.disposed || res.mode !== 'satellite') return;
      if (this.local) { this.scene.remove(this.local); this.local.geometry.dispose(); (this.local.material as THREE.Material).dispose(); }
      this.local = this.mosaicMesh(res, 0.1, -3);
      this.scene.add(this.local);
    });
  }
  private local: THREE.Mesh | null = null;

  /** Aim the camera at an object as soon as it exists in the scene (used when the view is opened on a chosen object). */
  focusWhenReady(p: Pick): void { this.pending = p; this.select(p); }
  private pending: Pick | null = null;

  setHour(hour: number): void {
    const look = skyFor(hour);
    this.scene.background = new THREE.Color(look.sky);
    this.scene.fog = new THREE.Fog(look.fog, this.extent * 2.5, this.extent * 14);
    this.sun.color.setHex(look.sunColor); this.sun.intensity = look.sunIntensity;
    this.hemi.intensity = look.hemiIntensity; this.hemi.color.setHex(look.hemiSky); this.night = look.night;
    const v = sunVector(look.azimuthDeg, Math.max(look.elevationDeg, 4));
    this.sunDir = new THREE.Vector3(v.x, v.y, v.z);
    this.renderer.toneMappingExposure = look.elevationDeg < 0 ? 0.65 : 1.0;
  }
  private sunDir = new THREE.Vector3(0.3, 0.9, 0.3);
  private night = false;

  select(p: Pick | null): void {
    this.selected = p;
    for (const [id, e] of this.fields) this.styleField(id, e);
    for (const [id, e] of this.machines) e.ring.visible = p?.type === 'machine' && p.id === id;
    this.refreshLabels();
  }

  follow(id: string | null): void { this.followId = id; if (id) this.flyTo({ type: 'machine', id }); }
  isFollowing(): string | null { return this.followId; }

  flyTo(p: Pick): void {
    let target: THREE.Vector3; let dist: number;
    if (p.type === 'machine') {
      const e = this.machines.get(p.id); if (!e) return;
      target = new THREE.Vector3(e.track.x, 2, e.track.z); dist = 38;
    } else {
      const e = this.fields.get(p.id); if (!e) return;
      target = new THREE.Vector3(e.center.x, 0, e.center.z); dist = Math.max(150, e.radius * 3.2);
    }
    this.startFly(target, new THREE.Vector3(target.x, target.y + dist * 0.62, target.z + dist * 0.78), p.type === 'machine' ? p.id : undefined);
  }

  overview(): void {
    if (!this.origin) return;
    const t = this.fieldsCenter.clone();
    const d = Math.max(450, this.fieldsExtent * 1.1);
    this.startFly(t, new THREE.Vector3(t.x, d * 0.8, t.z + d));
  }

  debug(): TwinDebug {
    return {
      camera: { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z, tx: this.controls.target.x, ty: this.controls.target.y, tz: this.controls.target.z },
      layers: { detail: !!this.detail, local: !!this.local },
      origin: this.origin, basemap: this.basemap, hidden: this.hidden, drawCalls: this.renderer.info.render.calls,
      machines: [...this.machines].map(([id, e]) => ({ id, x: e.track.x, z: e.track.z, headingDeg: e.track.heading, status: e.machine.status })),
      fields: [...this.fields].map(([id, e]) => ({ id, areaM2: polygonArea(e.pts), harvested: e.harvested })),
    };
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.onDown); el.removeEventListener('pointerup', this.onUp);
    this.controls.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose();
    });
    Object.values(this.textures).forEach((t) => t.dispose());
    this.renderer.dispose();
    this.renderer.domElement.remove(); this.overlay.remove();
  }

  // ------------------------------------------------------------------ world setup
  private fieldRing(f: FieldPlot): number[][] | null {
    const ring = f.polygon?.[0];
    return f.visibility !== 'FOG_OF_WAR' && ring && ring.length >= 4 ? ring : null;
  }

  private initWorld(fields: FieldPlot[], machines: HarvesterMachine[]): void {
    const fieldLL: Array<[number, number]> = [];
    for (const f of fields) for (const [lng, lat] of this.fieldRing(f)!) fieldLL.push([lat, lng]);
    const allLL = [...fieldLL, ...machines.map((m): [number, number] => [m.current_lat, m.current_lng])];
    const base = fieldLL.length ? fieldLL : allLL;
    const lats = base.map((p) => p[0]); const lngs = base.map((p) => p[1]);
    this.origin = { lat: (Math.min(...lats) + Math.max(...lats)) / 2, lng: (Math.min(...lngs) + Math.max(...lngs)) / 2 };
    const o = this.origin;
    const box = (ll: Array<[number, number]>) => {
      const pts = ll.map(([lat, lng]) => enu(o, lat, lng));
      const xs = pts.map((p) => p.x); const zs = pts.map((p) => p.z);
      return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
    };
    const fb = box(base); const ab = box(allLL);
    this.fieldsExtent = Math.max(300, Math.hypot(fb.maxX - fb.minX, fb.maxZ - fb.minZ));
    this.fieldsCenter.set((fb.minX + fb.maxX) / 2, 0, (fb.minZ + fb.maxZ) / 2);
    this.extent = Math.max(600, Math.hypot(ab.maxX - ab.minX, ab.maxZ - ab.minZ));
    this.controls.maxDistance = this.extent * 4;

    const grow = (b: Bounds, pad: number): Bounds => ({ minX: b.minX - pad, maxX: b.maxX + pad, minZ: b.minZ - pad, maxZ: b.maxZ + pad });
    const wide = grow(ab, Math.max(1500, this.extent * 0.25));
    const near = grow(fb, Math.max(500, this.fieldsExtent * 0.5));

    // plain surface straight away, replaced when the satellite mosaic (or the offline fallback) is ready
    const placeholder = new THREE.Mesh(new THREE.PlaneGeometry(wide.maxX - wide.minX, wide.maxZ - wide.minZ), new THREE.MeshLambertMaterial({ color: 0x66854d, depthWrite: false }));
    placeholder.renderOrder = -5;
    placeholder.rotation.x = -Math.PI / 2; placeholder.position.set((wide.minX + wide.maxX) / 2, 0, (wide.minZ + wide.maxZ) / 2); placeholder.receiveShadow = true;
    this.ground = placeholder; this.scene.add(placeholder);
    this.hooks.onBasemap(this.basemap);
    const cfg = defaultBasemapConfig();
    // two layers: a wide mosaic for the whole area and a sharper one around the fields (each within its own tile budget)
    void loadBasemap(o, wide, { ...cfg, maxTiles: 64 }).then((r) => { if (!this.disposed) this.applyBasemap(r); });
    void loadBasemap(o, near, { ...cfg, maxTiles: 36 }).then((r) => { if (!this.disposed && r.mode === 'satellite') this.applyDetail(r); });
    this.overview();
    this.snapFly();
  }

  private applyDetail(r: BasemapResult): void {
    if (this.detail) { this.scene.remove(this.detail); this.detail.geometry.dispose(); (this.detail.material as THREE.Material).dispose(); }
    this.detail = this.mosaicMesh(r, 0.08, -4);
    this.scene.add(this.detail);
  }

  /** Ground layers do not write depth and are drawn in `order` (the depth buffer is logarithmic, which ignores polygon offset), so sharper layers always paint over coarser ones and everything else sits on top. */
  private mosaicMesh(r: BasemapResult, y: number, order: number): THREE.Mesh {
    const tex = new THREE.CanvasTexture(r.canvas);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const w = r.se.x - r.nw.x; const d = r.se.z - r.nw.z;
    const mat = new THREE.MeshLambertMaterial({ map: tex, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
    mesh.rotation.x = -Math.PI / 2; mesh.position.set(r.nw.x + w / 2, y, r.nw.z + d / 2); mesh.receiveShadow = true; mesh.renderOrder = order;
    return mesh;
  }

  private applyBasemap(r: BasemapResult): void {
    if (this.ground) { this.scene.remove(this.ground); this.ground.geometry.dispose(); (this.ground.material as THREE.Material).dispose(); }
    this.ground = this.mosaicMesh(r, 0.02, -5);
    this.scene.add(this.ground);
    this.basemap = { mode: r.mode, attribution: r.attribution, loaded: r.loaded, total: r.total, zoom: r.zoom };
    this.hooks.onBasemap(this.basemap);
  }

  // ------------------------------------------------------------------ fields
  private syncField(f: FieldPlot): void {
    const sig = `${f.readiness_status}|${Math.round(f.harvest_progress_pct)}|${f.polygon[0].length}`;
    const old = this.fields.get(f.field_id);
    if (old && old.sig === sig) { old.field = f; return; }
    if (old) this.removeField(f.field_id, old);

    const pts = ringToLocal(this.origin!, f.polygon[0]);
    const crop = cropState(f.readiness_status, f.harvest_progress_pct);
    const axis = longEdgeAxis(pts);
    const { low, high } = splitByFraction(pts, crop.harvested, axis);
    const group = new THREE.Group(); group.name = `field:${f.field_id}`;
    const standingTex = crop.stage === 'GROWING' ? this.textures.growing : this.textures.ripe;

    const addMesh = (poly: P[], height: number, tex: THREE.CanvasTexture, y: number) => {
      if (poly.length < 3 || polygonArea(poly) < 1) return;
      const geo = height > 0.3
        ? new THREE.ExtrudeGeometry(toShape(poly), { depth: height, bevelEnabled: false })
        : new THREE.ShapeGeometry(toShape(poly));
      geo.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 }));
      mesh.position.y = y; mesh.receiveShadow = true; mesh.castShadow = height > 0.3;
      mesh.userData.fieldId = f.field_id;
      group.add(mesh);
    };
    addMesh(high, CROP_HEIGHT_M, standingTex, 0.14);
    addMesh(low, 0, this.textures.stubble, 0.16);

    const outline = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(p.x, 1.0, p.z))),
      new THREE.LineBasicMaterial({ color: 0xffe28a })
    );
    group.add(outline);

    const fenceGeo = new THREE.BufferGeometry();
    const verts: number[] = []; const H = 9;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]; const b = pts[(i + 1) % pts.length];
      verts.push(a.x, 0, a.z, b.x, 0, b.z, b.x, H, b.z, a.x, 0, a.z, b.x, H, b.z, a.x, H, a.z);
    }
    fenceGeo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    const fence = new THREE.Mesh(fenceGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
    fence.userData.fieldId = f.field_id; group.add(fence);

    this.scene.add(group);
    const center = centroid(pts);
    const radius = Math.max(...pts.map((p) => Math.hypot(p.x - center.x, p.z - center.z)));
    const label = this.makeLabel('field');
    const entry: FieldEntry = { group, sig, pts, center, axis, outline, fence, label, radius, field: f, harvested: crop.harvested, blocked: crop.blocked };
    this.fields.set(f.field_id, entry);
    this.styleField(f.field_id, entry);
  }

  private styleField(id: string, e: FieldEntry): void {
    const sel = this.selected?.type === 'field' && this.selected.id === id;
    (e.outline.material as THREE.LineBasicMaterial).color.setHex(sel ? 0xffffff : e.blocked ? 0xff5a4d : 0xffe28a);
    const fm = e.fence.material as THREE.MeshBasicMaterial;
    fm.opacity = sel ? 0.22 : e.blocked ? 0.16 : 0.0;
    fm.color.setHex(e.blocked ? 0xff4b3e : 0xffffff);
  }

  private removeField(id: string, e: FieldEntry): void {
    this.scene.remove(e.group);
    e.group.traverse((o) => {
      const m = o as THREE.Mesh; m.geometry?.dispose();
      const mat = m.material as THREE.Material | undefined; mat?.dispose();
    });
    e.label.remove(); this.fields.delete(id);
  }

  // ------------------------------------------------------------------ machines
  private syncMachine(m: HarvesterMachine, assignment: DispatchAssignment | undefined): void {
    const p = enu(this.origin!, m.current_lat, m.current_lng);
    let e = this.machines.get(m.machine_id);
    if (!e) {
      const model = buildMachine(m.machine_id);
      model.group.userData.machineId = m.machine_id;
      this.scene.add(model.group);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(5.6, 6.3, 48).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false })
      );
      ring.position.y = 0.3; ring.visible = false; model.group.add(ring);
      e = { model, track: new MachineTrack(p.x, p.z), label: this.makeLabel('machine'), ring, machine: m, moving: false };
      this.machines.set(m.machine_id, e);
    }
    e.machine = m;
    e.moving = e.track.setTarget(p.x, p.z) || e.moving;
    const field = assignment ? this.fields.get(assignment.field_id) : undefined;
    if (field) e.track.setRestHeading(bearingDeg(field.axis.x, field.axis.z));
  }

  private removeMachine(id: string, e: MachineEntry): void {
    this.scene.remove(e.model.group); e.model.dispose(); e.label.remove(); this.machines.delete(id);
    if (this.followId === id) this.followId = null;
  }

  // ------------------------------------------------------------------ labels
  private makeLabel(kind: 'field' | 'machine'): HTMLDivElement {
    const d = document.createElement('div'); d.className = `tw-label tw-${kind}`; this.overlay.appendChild(d); return d;
  }

  private refreshLabels(): void {
    for (const [id, e] of this.fields) {
      const sel = this.selected?.type === 'field' && this.selected.id === id;
      e.label.textContent = this.far ? `${id} · ${Math.round(e.field.harvest_progress_pct)}%` : `${e.field.name} · ${Math.round(e.field.harvest_progress_pct)}%`;
      e.label.className = `tw-label tw-field${sel ? ' sel' : ''}${e.blocked ? ' bad' : ''}`;
      e.label.title = readinessLabel(e.field.readiness_status);
    }
    for (const [id, e] of this.machines) {
      const sel = this.selected?.type === 'machine' && this.selected.id === id;
      e.label.textContent = this.far ? id : `${e.machine.name} · ${MACHINE_STATUS_LABEL[e.machine.status] ?? e.machine.status}`;
      e.label.className = `tw-label tw-machine st-${e.machine.status}${sel ? ' sel' : ''}`;
    }
  }

  private placeLabels(): void {
    const w = this.container.clientWidth; const h = this.container.clientHeight;
    const put = (el: HTMLDivElement, x: number, y: number, z: number) => {
      this.tmp.set(x, y, z).project(this.camera);
      const visible = this.tmp.z < 1 && this.tmp.z > -1 && Math.abs(this.tmp.x) < 1.1 && Math.abs(this.tmp.y) < 1.1;
      el.style.display = visible ? 'block' : 'none';
      if (visible) el.style.transform = `translate(-50%, -100%) translate(${((this.tmp.x + 1) / 2) * w}px, ${((1 - this.tmp.y) / 2) * h}px)`;
    };
    for (const e of this.fields.values()) put(e.label, e.center.x, 14, e.center.z);
    for (const e of this.machines.values()) put(e.label, e.track.x, 9, e.track.z);
  }

  // ------------------------------------------------------------------ camera
  private startFly(toT: THREE.Vector3, toP: THREE.Vector3, machineId?: string): void {
    this.fly = { fromT: this.controls.target.clone(), toT, fromP: this.camera.position.clone(), toP, t0: performance.now(), dur: 1500, machineId };
  }

  private snapFly(): void {
    if (!this.fly) return;
    this.controls.target.copy(this.fly.toT); this.camera.position.copy(this.fly.toP); this.fly = null; this.controls.update();
  }

  private onDown = (e: PointerEvent) => { this.down = { x: e.clientX, y: e.clientY }; };
  private onUp = (e: PointerEvent) => {
    if (!this.down || Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 5) { this.down = null; return; }
    this.down = null;
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, this.camera);
    const targets: THREE.Object3D[] = [];
    for (const m of this.machines.values()) targets.push(m.model.group);
    for (const f of this.fields.values()) targets.push(f.group);
    const hits = ray.intersectObjects(targets, true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o) {
        if (o.userData.machineId) { this.hooks.onPick({ type: 'machine', id: o.userData.machineId }); return; }
        if (o.userData.fieldId) { this.hooks.onPick({ type: 'field', id: o.userData.fieldId }); return; }
        o = o.parent;
      }
    }
    this.hooks.onPick(null);
  };

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth); const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%'; this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------ frame
  private loop = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    if (document.hidden) { this.last = now; return; }
    const dt = (now - this.last) / 1000; this.last = now;
    const t = now / 1000;

    for (const e of this.machines.values()) {
      const px = e.track.x; const pz = e.track.z;
      e.track.step(dt);
      const g = e.model.group;
      g.position.set(e.track.x, 0, e.track.z);
      g.rotation.y = yawForBearing(e.track.heading);
      e.moving = e.track.speedMps > 0.15;
      e.model.setNight(this.night);
      e.model.animate(t, e.machine.status, e.moving || e.machine.status === 'WORKING');
      if (this.followId && e.machine.machine_id === this.followId) {
        const dx = e.track.x - px; const dz = e.track.z - pz;
        this.controls.target.x += dx; this.controls.target.z += dz; this.camera.position.x += dx; this.camera.position.z += dz;
      }
    }

    if (this.fly) {
      // a machine keeps moving while the camera flies to it: aim at where it is now, not where it was
      const tr = this.fly.machineId ? this.machines.get(this.fly.machineId)?.track : undefined;
      if (tr) { this.fly.toT.set(tr.x, 2, tr.z); this.fly.toP.set(tr.x, 24, tr.z + 34); }
      const k = Math.min(1, (performance.now() - this.fly.t0) / this.fly.dur);
      const s = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      this.controls.target.lerpVectors(this.fly.fromT, this.fly.toT, s);
      this.camera.position.lerpVectors(this.fly.fromP, this.fly.toP, s);
      if (k >= 1) this.fly = null;
    }
    this.controls.update();

    // the shadow window follows what the camera looks at, so shadows stay sharp at any zoom
    const tg = this.controls.target;
    const reach = Math.min(300, Math.max(60, this.camera.position.distanceTo(tg) * 0.9));
    const sc = this.sun.shadow.camera; sc.left = -reach; sc.right = reach; sc.top = reach; sc.bottom = -reach; sc.updateProjectionMatrix();
    this.sun.position.copy(tg).addScaledVector(this.sunDir, 700); this.sun.target.position.copy(tg);

    const far = this.camera.position.distanceTo(tg) > 1100;
    if (far !== this.far) { this.far = far; this.refreshLabels(); }
    this.placeLabels();
    this.renderer.render(this.scene, this.camera);
  };
}
