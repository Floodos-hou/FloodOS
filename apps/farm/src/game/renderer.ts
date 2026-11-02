// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenAgriOS Contributors

/**
 * Canvas renderer of the farm game: procedural, asset-free artwork (no third-party images, so nothing to license).
 * Everything that moves or changes colour is driven by real data passed in through {@link FarmRenderer.setScene};
 * only decoration (trees, clouds, windmill, fireflies) is cosmetic.
 */
import { approach, cropState, hash01, seedFromString, skyTint, type CropState } from './crops.ts';
import { fitCamera, headingFromDelta, type World, type WorldField } from './world.ts';

export interface FieldView {
  id: string;
  label: string;
  crop: string;
  readiness: string;
  progress: number;
  mine: boolean;
  quest: 'alert' | 'todo' | 'active' | 'waiting' | 'done' | null;
}

export interface MachineView {
  id: string;
  x: number;
  y: number;
  status: string;
  fuel: number;
  /** field the machine is currently assigned to (drives the harvest effects), if any */
  fieldId?: string;
  /** true for a replacement machine sent to cover a broken one */
  rescuing?: boolean;
}

export interface SceneInput {
  world: World;
  fields: FieldView[];
  machines: MachineView[];
  hour: number;
  selected: { type: 'field' | 'machine'; id: string } | null;
}

type Pick = { type: 'field' | 'machine'; id: string } | null;

interface Sprite {
  x: number; y: number; tx: number; ty: number;
  heading: number; status: string; fuel: number; fieldId?: string; rescuing: boolean;
  shake: number; spin: number; label: string;
}

interface Particle {
  kind: 'dust' | 'chaff' | 'smoke' | 'spark' | 'confetti' | 'ring' | 'text' | 'firefly' | 'leaf';
  x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string; text?: string; rot?: number;
}

const MAX_PARTICLES = 900;
const TAU = Math.PI * 2;

export class FarmRenderer {
  private ctx: CanvasRenderingContext2D;
  private w = 1; private h = 1; private dpr = 1;
  private cam = { x: 0, y: 0, zoom: 0.4 };
  private target = { x: 0, y: 0, zoom: 0.4 };
  private fitZoom = 0.4;
  private scene: SceneInput | null = null;
  private sprites = new Map<string, Sprite>();
  private shownProgress = new Map<string, number>();
  private particles: Particle[] = [];
  private time = 0;
  private last = 0;
  private followId: string | null = null;
  private ground: CanvasPattern | null = null;
  private decor: { trees: { x: number; y: number; r: number; hue: number }[]; bushes: { x: number; y: number; r: number }[]; flowers: { x: number; y: number; c: string }[]; roads: { x: number; y: number }[][]; rocks: { x: number; y: number; r: number }[] } | null = null;
  private decorKey = '';
  private firstFit = true;
  onSelect: ((p: Pick) => void) | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available');
    this.ctx = ctx;
  }

  // ------------------------------------------------------------------ public API
  resize(cssW: number, cssH: number, dpr: number) {
    this.dpr = Math.min(2, dpr || 1);
    this.w = Math.max(1, cssW);
    this.h = Math.max(1, cssH);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    if (this.scene) this.refit(false);
  }

  setScene(scene: SceneInput) {
    const keyBefore = this.decorKey;
    this.scene = scene;
    const key = scene.world.fields.map((f) => `${f.id}:${Math.round(f.x)}:${Math.round(f.y)}`).join('|');
    if (key !== keyBefore) {
      this.buildDecor();
      this.refit(this.firstFit);
      this.firstFit = false;
    }
    const seen = new Set<string>();
    for (const m of scene.machines) {
      seen.add(m.id);
      const s = this.sprites.get(m.id);
      if (!s) {
        this.sprites.set(m.id, { x: m.x, y: m.y, tx: m.x, ty: m.y, heading: 0, status: m.status, fuel: m.fuel, fieldId: m.fieldId, rescuing: !!m.rescuing, shake: 0, spin: 0, label: m.id });
        continue;
      }
      if (s.status !== m.status) this.onStatusChange(s, m);
      s.tx = m.x; s.ty = m.y; s.status = m.status; s.fuel = m.fuel; s.fieldId = m.fieldId; s.rescuing = !!m.rescuing;
    }
    for (const id of this.sprites.keys()) if (!seen.has(id)) this.sprites.delete(id); // deleting while iterating a Map is safe

    for (const f of scene.fields) {
      const wf = scene.world.fields.find((x) => x.id === f.id);
      const prev = this.shownProgress.get(f.id);
      if (prev === undefined) {
        this.shownProgress.set(f.id, cropState(f.readiness, f.progress).harvested);
      } else if (wf) {
        const next = cropState(f.readiness, f.progress).harvested;
        if (next - prev > 0.004) {
          this.float(wf.x - wf.w / 2 + wf.w * next, wf.y - wf.h / 2 - 6, `+${Math.round((next - prev) * 100)}%`, '#fde047');
        }
        if (next >= 1 && prev < 0.999) this.celebrate(wf.x, wf.y);
      }
    }
  }

  /** Time of day can change every frame (cosmetic day/night loop) without rebuilding the scene. */
  setHour(hour: number) { if (this.scene) this.scene.hour = hour; }

  setFollow(id: string | null) { this.followId = id; }
  getFollow() { return this.followId; }

  fit() { this.followId = null; this.refit(true); }

  focus(x: number, y: number, zoom?: number) {
    this.followId = null;
    this.target.x = x; this.target.y = y;
    if (zoom) this.target.zoom = Math.max(this.fitZoom * 0.8, Math.min(2.4, zoom));
  }

  focusMachine(id: string) {
    const s = this.sprites.get(id);
    if (s) { this.focus(s.x, s.y, Math.max(this.target.zoom, 0.9)); this.followId = id; }
  }

  focusField(id: string) {
    const f = this.scene?.world.fields.find((x) => x.id === id);
    if (f) this.focus(f.x, f.y, Math.max(this.target.zoom, 0.8));
  }

  panBy(dxScreen: number, dyScreen: number) {
    this.followId = null;
    this.cam.x -= dxScreen / this.cam.zoom; this.cam.y -= dyScreen / this.cam.zoom;
    this.target.x = this.cam.x; this.target.y = this.cam.y;
  }

  zoomAt(px: number, py: number, factor: number) {
    const before = this.toWorld(px, py, this.target);
    this.target.zoom = Math.max(this.fitZoom * 0.8, Math.min(2.4, this.target.zoom * factor));
    this.target.x = before.x - (px - this.w / 2) / this.target.zoom;
    this.target.y = before.y - (py - this.h / 2) / this.target.zoom;
    this.followId = null;
  }

  ripple(x: number, y: number, color = '#ffffff') {
    this.spawn({ kind: 'ring', x, y, vx: 0, vy: 0, life: 0, max: 0.7, size: 12, color });
  }

  float(x: number, y: number, text: string, color = '#ffffff') {
    this.spawn({ kind: 'text', x, y, vx: 0, vy: -38, life: 0, max: 1.6, size: 22, color, text });
  }

  celebrate(x: number, y: number) {
    const colors = ['#facc15', '#f97316', '#22c55e', '#38bdf8', '#e879f9', '#ffffff'];
    for (let i = 0; i < 70; i++) {
      const a = Math.random() * TAU; const v = 90 + Math.random() * 230;
      this.spawn({ kind: 'confetti', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 120, life: 0, max: 1.6 + Math.random(), size: 5 + Math.random() * 5, color: colors[i % colors.length], rot: Math.random() * TAU });
    }
    this.ripple(x, y, '#facc15');
  }

  pick(sx: number, sy: number): Pick {
    if (!this.scene) return null;
    const p = this.toWorld(sx, sy, this.cam);
    const s = this.spriteScale();
    for (const [id, sp] of this.sprites) {
      if (Math.hypot(sp.x - p.x, sp.y - p.y) < 46 * s) return { type: 'machine', id };
    }
    for (const f of this.scene.world.fields) {
      if (Math.abs(p.x - f.x) < f.w / 2 + 12 && Math.abs(p.y - f.y) < f.h / 2 + 12) return { type: 'field', id: f.id };
    }
    return null;
  }

  screenOfWorld(x: number, y: number) {
    return { x: (x - this.cam.x) * this.cam.zoom + this.w / 2, y: (y - this.cam.y) * this.cam.zoom + this.h / 2 };
  }

  machinePosition(id: string) { const s = this.sprites.get(id); return s ? { x: s.x, y: s.y } : null; }

  // ------------------------------------------------------------------ frame loop
  frame(nowMs: number) {
    const dt = this.last ? Math.min(0.05, (nowMs - this.last) / 1000) : 0.016;
    this.last = nowMs;
    this.time += dt;
    this.update(dt);
    this.draw();
  }

  private spriteScale() { return Math.max(1, 0.5 / this.cam.zoom); }

  private toWorld(sx: number, sy: number, cam: { x: number; y: number; zoom: number }) {
    return { x: (sx - this.w / 2) / cam.zoom + cam.x, y: (sy - this.h / 2) / cam.zoom + cam.y };
  }

  private refit(snap: boolean) {
    if (!this.scene) return;
    // keep the world clear of the HUD: top bar always, quest panel on the right (wide) or at the bottom (narrow)
    const wide = this.w > 900;
    const c = fitCamera(this.scene.world.bounds, this.w, this.h, wide ? { top: 92, right: 370, bottom: 24, left: 24 } : { top: 130, right: 12, bottom: 170, left: 12 });
    this.fitZoom = c.zoom;
    this.target = { ...c };
    if (snap) this.cam = { ...c };
  }

  private spawn(p: Particle) {
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
    this.particles.push(p);
  }

  private onStatusChange(s: Sprite, m: MachineView) {
    if (m.status === 'BREAKDOWN') {
      s.shake = 1.2;
      for (let i = 0; i < 26; i++) {
        const a = Math.random() * TAU;
        this.spawn({ kind: 'spark', x: s.x, y: s.y, vx: Math.cos(a) * (60 + Math.random() * 160), vy: Math.sin(a) * (60 + Math.random() * 160) - 40, life: 0, max: 0.7 + Math.random() * 0.5, size: 3 + Math.random() * 3, color: i % 2 ? '#fbbf24' : '#f97316' });
      }
      this.ripple(s.x, s.y, '#ef4444');
    } else if (s.status === 'BREAKDOWN' || s.status === 'MAINTENANCE') {
      this.celebrate(s.x, s.y);
    } else if (m.status === 'WORKING') {
      this.ripple(s.x, s.y, '#fde047');
    }
  }

  private update(dt: number) {
    // camera
    if (this.followId) {
      const s = this.sprites.get(this.followId);
      if (s) { this.target.x = s.x; this.target.y = s.y; }
    }
    const k = 1 - Math.exp(-dt * 7);
    this.cam.x += (this.target.x - this.cam.x) * k;
    this.cam.y += (this.target.y - this.cam.y) * k;
    this.cam.zoom += (this.target.zoom - this.cam.zoom) * k;

    // crop progress glides towards the real value
    if (this.scene) {
      for (const f of this.scene.fields) {
        const cur = this.shownProgress.get(f.id) ?? 0;
        this.shownProgress.set(f.id, approach(cur, cropState(f.readiness, f.progress).harvested, dt, 1.4));
      }
    }

    // machines glide, turn and emit particles
    for (const s of this.sprites.values()) {
      const dx = s.tx - s.x; const dy = s.ty - s.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 700) { s.x = s.tx; s.y = s.ty; } // teleports (reset) snap
      else {
        const k2 = 1 - Math.exp(-dt * 2.4);
        s.x += dx * k2; s.y += dy * k2;
      }
      const speed = dist * 2.4; // units per second
      if (speed > 6) {
        const want = headingFromDelta(dx, dy);
        let d = ((want - s.heading + 540) % 360) - 180;
        s.heading = (s.heading + d * (1 - Math.exp(-dt * 6)) + 360) % 360;
        if (Math.random() < dt * 14) {
          const back = (s.heading + 180) * Math.PI / 180;
          this.spawn({ kind: 'dust', x: s.x + Math.sin(back) * 26, y: s.y - Math.cos(back) * 26, vx: (Math.random() - 0.5) * 24, vy: -8 - Math.random() * 14, life: 0, max: 0.9, size: 9 + Math.random() * 8, color: 'rgba(196,164,108,0.55)' });
        }
      }
      const working = s.status === 'WORKING';
      s.spin += dt * (working ? 9 : s.status === 'MOVING' ? 3 : 0);
      s.shake = Math.max(0, s.shake - dt);
      if (working && Math.random() < dt * 10) {
        const f = this.scene?.world.fields.find((x) => x.id === s.fieldId);
        const hx = f ? f.x - f.w / 2 + f.w * (this.shownProgress.get(f.id) ?? 0) : s.x;
        const hy = f ? f.y + (Math.random() - 0.5) * f.h : s.y;
        this.spawn({ kind: 'chaff', x: hx, y: hy, vx: 30 + Math.random() * 50, vy: -30 - Math.random() * 60, life: 0, max: 1.0, size: 3 + Math.random() * 2.5, color: Math.random() < 0.5 ? '#fde68a' : '#f59e0b' });
      }
      if (s.status === 'BREAKDOWN' && Math.random() < dt * 9) {
        this.spawn({ kind: 'smoke', x: s.x + (Math.random() - 0.5) * 14, y: s.y - 8, vx: 10 + Math.random() * 16, vy: -28 - Math.random() * 24, life: 0, max: 2.2, size: 12 + Math.random() * 9, color: 'rgba(55,55,60,0.7)' });
      }
    }

    // ambient: leaves drift, fireflies at night
    const night = 1 - (skyTint(this.scene?.hour ?? 12)[0] - 58) / 197;
    if (this.scene && night > 0.5 && this.particles.filter((p) => p.kind === 'firefly').length < 36 && Math.random() < dt * 8) {
      const b = this.scene.world.bounds;
      this.spawn({ kind: 'firefly', x: b.minX + Math.random() * (b.maxX - b.minX), y: b.minY + Math.random() * (b.maxY - b.minY), vx: (Math.random() - 0.5) * 18, vy: (Math.random() - 0.5) * 18, life: 0, max: 7 + Math.random() * 5, size: 3, color: '#fef08a' });
    }

    // particles
    const kept: Particle[] = [];
    for (const p of this.particles) {
      p.life += dt;
      if (p.life >= p.max) continue;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.kind === 'confetti') { p.vy += 380 * dt; p.vx *= 0.99; p.rot = (p.rot ?? 0) + dt * 9; }
      else if (p.kind === 'spark') p.vy += 260 * dt;
      else if (p.kind === 'chaff') p.vy += 90 * dt;
      else if (p.kind === 'firefly') { p.vx += (Math.random() - 0.5) * 30 * dt; p.vy += (Math.random() - 0.5) * 30 * dt; }
      kept.push(p);
    }
    this.particles = kept;
  }

  // ------------------------------------------------------------------ drawing
  private draw() {
    const ctx = this.ctx;
    const scene = this.scene;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.fillStyle = '#6faa4f';
    ctx.fillRect(0, 0, this.w, this.h);
    if (!scene) return;

    ctx.save();
    ctx.translate(this.w / 2, this.h / 2);
    ctx.scale(this.cam.zoom, this.cam.zoom);
    ctx.translate(-this.cam.x, -this.cam.y);

    this.drawGround(ctx, scene);
    this.drawRiver(ctx, scene);
    this.drawRoads(ctx);
    this.drawFarmstead(ctx, scene);
    this.drawDecor(ctx, scene, false);
    for (const wf of scene.world.fields) {
      const fv = scene.fields.find((f) => f.id === wf.id);
      if (fv) this.drawField(ctx, wf, fv, scene);
    }
    this.drawRescuePaths(ctx, scene);
    this.drawDecor(ctx, scene, true);
    this.drawParticles(ctx, 'under');
    const s = this.spriteScale();
    const night = this.nightness();
    for (const [id, sp] of this.sprites) this.drawMachine(ctx, sp, id, s, night);
    this.drawParticles(ctx, 'over');
    this.drawCloudShadows(ctx, scene);
    ctx.restore();

    this.drawTint(ctx, scene);
    this.drawLights(ctx, scene, night);
    this.drawLabels(ctx, scene);
    this.drawVignette(ctx);
  }

  private nightness() { return 1 - (skyTint(this.scene?.hour ?? 12)[0] - 58) / 197; }

  private visibleRect() {
    const hw = this.w / 2 / this.cam.zoom; const hh = this.h / 2 / this.cam.zoom;
    return { x0: this.cam.x - hw, y0: this.cam.y - hh, x1: this.cam.x + hw, y1: this.cam.y + hh };
  }

  private makeGround(): CanvasPattern | null {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    if (!g) return null;
    g.fillStyle = '#74b455';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 38; i++) {
      const x = hash01(i * 3 + 1) * 256; const y = hash01(i * 3 + 2) * 256; const r = 18 + hash01(i * 3 + 3) * 40;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      const light = i % 2 === 0;
      gr.addColorStop(0, light ? 'rgba(150,210,100,0.35)' : 'rgba(60,130,60,0.28)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      for (const ox of [-256, 0, 256]) for (const oy of [-256, 0, 256]) { g.save(); g.translate(ox, oy); g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); g.restore(); }
    }
    g.strokeStyle = 'rgba(40,110,45,0.55)'; g.lineWidth = 1.4; g.lineCap = 'round';
    for (let i = 0; i < 360; i++) {
      const x = hash01(i * 5 + 11) * 256; const y = hash01(i * 5 + 12) * 256; const l = 3 + hash01(i * 5 + 13) * 5; const a = -1.57 + (hash01(i * 5 + 14) - 0.5) * 0.9;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
    return this.ctx.createPattern(c, 'repeat');
  }

  private drawGround(ctx: CanvasRenderingContext2D, scene: SceneInput) {
    if (!this.ground) this.ground = this.makeGround();
    const v = this.visibleRect();
    ctx.fillStyle = this.ground ?? '#74b455';
    ctx.fillRect(v.x0 - 10, v.y0 - 10, v.x1 - v.x0 + 20, v.y1 - v.y0 + 20);
    void scene;
  }

  private riverY(x: number, base: number) { return base + Math.sin(x * 0.006 + 1.3) * 34 + Math.sin(x * 0.017) * 11; }

  private drawRiver(ctx: CanvasRenderingContext2D, scene: SceneInput) {
    const b = scene.world.bounds;
    const base = b.maxY - 130;
    const x0 = b.minX - 400; const x1 = b.maxX + 400;
    const band = (width: number, style: string | CanvasGradient) => {
      ctx.beginPath();
      for (let x = x0; x <= x1; x += 24) { const y = this.riverY(x, base); if (x === x0) ctx.moveTo(x, y - width / 2); else ctx.lineTo(x, y - width / 2); }
      for (let x = x1; x >= x0; x -= 24) ctx.lineTo(x, this.riverY(x, base) + width / 2);
      ctx.closePath(); ctx.fillStyle = style; ctx.fill();
    };
    band(98, 'rgba(115,170,70,1)');
    band(88, '#d7c28a');
    const g = ctx.createLinearGradient(0, base - 40, 0, base + 40);
    g.addColorStop(0, '#5ec6e8'); g.addColorStop(1, '#2d8fc4');
    band(70, g);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    for (let i = 0; i < 70; i++) {
      const x = x0 + ((i * 97 + this.time * 26 * (1 + (i % 3) * 0.3)) % (x1 - x0));
      const y = this.riverY(x, base) + (hash01(i + 7) - 0.5) * 44;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 12 + hash01(i) * 12, y + Math.sin(this.time * 2 + i) * 1.5); ctx.stroke();
    }
  }

  private buildDecor() {
    const scene = this.scene;
    if (!scene) return;
    const b = scene.world.bounds;
    const fields = scene.world.fields;
    this.decorKey = fields.map((f) => `${f.id}:${Math.round(f.x)}:${Math.round(f.y)}`).join('|');
    const seed = seedFromString(this.decorKey);

    // dirt roads: nearest-neighbour chain between field centres, plus one to the farmstead
    const farm = { x: b.minX + 230, y: b.minY + 200 };
    const nodes = [farm, ...fields.map((f) => ({ x: f.x, y: f.y }))];
    const roads: { x: number; y: number }[][] = [];
    const left = nodes.slice(1);
    let cur = farm;
    while (left.length) {
      left.sort((a, c) => Math.hypot(a.x - cur.x, a.y - cur.y) - Math.hypot(c.x - cur.x, c.y - cur.y));
      const nxt = left.shift()!;
      const mx = (cur.x + nxt.x) / 2 + (hash01(seed + roads.length * 7) - 0.5) * 120;
      const my = (cur.y + nxt.y) / 2 + (hash01(seed + roads.length * 7 + 1) - 0.5) * 120;
      const pts: { x: number; y: number }[] = [];
      for (let t = 0; t <= 1.0001; t += 0.05) {
        pts.push({ x: (1 - t) * (1 - t) * cur.x + 2 * (1 - t) * t * mx + t * t * nxt.x, y: (1 - t) * (1 - t) * cur.y + 2 * (1 - t) * t * my + t * t * nxt.y });
      }
      roads.push(pts);
      cur = nxt;
    }
    const nearRoad = (x: number, y: number, d: number) => roads.some((r) => r.some((p) => Math.hypot(p.x - x, p.y - y) < d));
    const onField = (x: number, y: number, pad: number) => fields.some((f) => Math.abs(x - f.x) < f.w / 2 + pad && Math.abs(y - f.y) < f.h / 2 + pad);
    const nearFarm = (x: number, y: number) => Math.hypot(x - farm.x, y - farm.y) < 230;
    const inRiver = (x: number, y: number) => Math.abs(y - this.riverY(x, b.maxY - 130)) < 70;

    const trees: { x: number; y: number; r: number; hue: number }[] = [];
    const bushes: { x: number; y: number; r: number }[] = [];
    const flowers: { x: number; y: number; c: string }[] = [];
    const rocks: { x: number; y: number; r: number }[] = [];
    const W = b.maxX - b.minX; const H = b.maxY - b.minY;
    for (let i = 0; i < 520; i++) {
      const x = b.minX - 200 + hash01(seed + i * 4) * (W + 400);
      const y = b.minY - 200 + hash01(seed + i * 4 + 1) * (H + 400);
      if (onField(x, y, 46) || nearRoad(x, y, 46) || nearFarm(x, y) || inRiver(x, y)) continue;
      const kind = hash01(seed + i * 4 + 2);
      if (kind < 0.34 && trees.length < 110) trees.push({ x, y, r: 26 + hash01(seed + i * 4 + 3) * 24, hue: hash01(seed + i) });
      else if (kind < 0.55) bushes.push({ x, y, r: 10 + hash01(seed + i * 4 + 3) * 10 });
      else if (kind < 0.9) flowers.push({ x, y, c: ['#fff', '#fde047', '#f9a8d4', '#fca5a5'][i % 4] });
      else rocks.push({ x, y, r: 8 + hash01(seed + i) * 10 });
    }
    trees.sort((a, c) => a.y - c.y);
    this.decor = { trees, bushes, flowers, roads, rocks };
  }

  private drawRoads(ctx: CanvasRenderingContext2D) {
    if (!this.decor) return;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const [width, color] of [[56, 'rgba(120,90,50,0.55)'], [46, '#c9a66b'], [30, '#d8b98a']] as const) {
      ctx.strokeStyle = color; ctx.lineWidth = width;
      for (const r of this.decor.roads) {
        ctx.beginPath();
        r.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.stroke();
      }
    }
  }

  private drawFarmstead(ctx: CanvasRenderingContext2D, scene: SceneInput) {
    const b = scene.world.bounds;
    const x = b.minX + 230; const y = b.minY + 200;
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.beginPath(); ctx.ellipse(10, 78, 120, 26, 0, 0, TAU); ctx.fill();
    // barn
    ctx.fillStyle = '#b3342b'; ctx.fillRect(-84, -10, 130, 78);
    ctx.fillStyle = '#8f261f'; ctx.beginPath(); ctx.moveTo(-96, -10); ctx.lineTo(-19, -62); ctx.lineTo(58, -10); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#7a1f1a'; ctx.beginPath(); ctx.moveTo(-96, -10); ctx.lineTo(-19, -62); ctx.lineTo(-19, -10); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#f5f1e6'; ctx.fillRect(-56, 22, 60, 46);
    ctx.strokeStyle = '#b3342b'; ctx.lineWidth = 5; ctx.strokeRect(-56, 22, 60, 46);
    ctx.beginPath(); ctx.moveTo(-56, 22); ctx.lineTo(4, 68); ctx.moveTo(4, 22); ctx.lineTo(-56, 68); ctx.stroke();
    ctx.fillStyle = '#f9e9a8'; ctx.fillRect(-79, 4, 16, 18); ctx.fillRect(16, 4, 16, 18);
    // silo
    ctx.fillStyle = '#c9ced6'; ctx.fillRect(66, -34, 36, 102);
    ctx.fillStyle = '#9aa3b0'; ctx.beginPath(); ctx.ellipse(84, -34, 18, 12, 0, Math.PI, TAU); ctx.fill();
    for (let i = 0; i < 5; i++) { ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(66, -20 + i * 20, 36, 3); }
    // windmill
    ctx.translate(-150, 30);
    ctx.fillStyle = '#e8dcc4'; ctx.beginPath(); ctx.moveTo(-18, 48); ctx.lineTo(-10, -40); ctx.lineTo(10, -40); ctx.lineTo(18, 48); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#9a6b3c'; ctx.beginPath(); ctx.moveTo(-14, -40); ctx.lineTo(0, -62); ctx.lineTo(14, -40); ctx.closePath(); ctx.fill();
    ctx.translate(0, -40); ctx.rotate(this.time * 0.9);
    for (let i = 0; i < 4; i++) { ctx.rotate(Math.PI / 2); ctx.fillStyle = '#fafafa'; ctx.fillRect(2, -5, 70, 10); ctx.fillStyle = '#d4d4d8'; ctx.fillRect(2, -5, 70, 3); }
    ctx.fillStyle = '#6b4a2a'; ctx.beginPath(); ctx.arc(0, 0, 7, 0, TAU); ctx.fill();
    ctx.restore();
  }

  private drawDecor(ctx: CanvasRenderingContext2D, scene: SceneInput, canopy: boolean) {
    const d = this.decor;
    if (!d) return;
    const v = this.visibleRect();
    const inView = (x: number, y: number, m: number) => x > v.x0 - m && x < v.x1 + m && y > v.y0 - m && y < v.y1 + m;
    if (!canopy) {
      for (const f of d.flowers) {
        if (!inView(f.x, f.y, 10)) continue;
        ctx.fillStyle = f.c; ctx.beginPath(); ctx.arc(f.x, f.y, 2.4, 0, TAU); ctx.fill();
      }
      for (const r of d.rocks) {
        if (!inView(r.x, r.y, 20)) continue;
        ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.beginPath(); ctx.ellipse(r.x + 3, r.y + 5, r.r, r.r * 0.55, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#9ca3af'; ctx.beginPath(); ctx.ellipse(r.x, r.y, r.r, r.r * 0.75, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#d1d5db'; ctx.beginPath(); ctx.ellipse(r.x - r.r * 0.25, r.y - r.r * 0.25, r.r * 0.4, r.r * 0.3, 0, 0, TAU); ctx.fill();
      }
      for (const b of d.bushes) {
        if (!inView(b.x, b.y, 30)) continue;
        ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.beginPath(); ctx.ellipse(b.x + 3, b.y + b.r * 0.8, b.r * 1.1, b.r * 0.5, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#3f8f46'; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.arc(b.x + b.r * 0.7, b.y + 2, b.r * 0.75, 0, TAU); ctx.arc(b.x - b.r * 0.7, b.y + 3, b.r * 0.7, 0, TAU); ctx.fill();
        ctx.fillStyle = '#58b05d'; ctx.beginPath(); ctx.arc(b.x - 2, b.y - b.r * 0.35, b.r * 0.55, 0, TAU); ctx.fill();
      }
    } else {
      for (const t of d.trees) {
        if (!inView(t.x, t.y, t.r * 2)) continue;
        const sway = Math.sin(this.time * 1.2 + t.x * 0.02) * 2.2;
        ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.beginPath(); ctx.ellipse(t.x + 8, t.y + t.r * 0.9, t.r * 1.0, t.r * 0.45, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#6b4a2a'; ctx.fillRect(t.x - 4, t.y, 8, t.r * 0.9);
        const base = t.hue < 0.5 ? ['#2f7d3b', '#3f9a4a', '#5cb860'] : ['#3a8a43', '#4faa55', '#79c96e'];
        ctx.fillStyle = base[0]; ctx.beginPath(); ctx.arc(t.x + sway, t.y - t.r * 0.35, t.r, 0, TAU); ctx.fill();
        ctx.fillStyle = base[1]; ctx.beginPath(); ctx.arc(t.x + sway - t.r * 0.18, t.y - t.r * 0.55, t.r * 0.78, 0, TAU); ctx.fill();
        ctx.fillStyle = base[2]; ctx.beginPath(); ctx.arc(t.x + sway - t.r * 0.3, t.y - t.r * 0.72, t.r * 0.4, 0, TAU); ctx.fill();
      }
    }
    void scene;
  }

  private drawField(ctx: CanvasRenderingContext2D, wf: WorldField, fv: FieldView, scene: SceneInput) {
    const v = this.visibleRect();
    if (wf.x + wf.w / 2 < v.x0 - 40 || wf.x - wf.w / 2 > v.x1 + 40 || wf.y + wf.h / 2 < v.y0 - 40 || wf.y - wf.h / 2 > v.y1 + 40) return;
    const st: CropState = cropState(fv.readiness, fv.progress);
    const shown = this.shownProgress.get(fv.id) ?? st.harvested;
    const L = wf.x - wf.w / 2; const T = wf.y - wf.h / 2;
    const sel = scene.selected?.type === 'field' && scene.selected.id === fv.id;

    // raised soil bed with shadow
    ctx.fillStyle = 'rgba(0,0,0,0.24)';
    this.round(ctx, L - 6, T + 8, wf.w + 12, wf.h + 12, 20); ctx.fill();
    ctx.fillStyle = '#7d5230';
    this.round(ctx, L - 12, T - 12, wf.w + 24, wf.h + 24, 20); ctx.fill();
    ctx.fillStyle = '#a56f3f';
    this.round(ctx, L - 5, T - 5, wf.w + 10, wf.h + 10, 15); ctx.fill();
    ctx.save();
    this.round(ctx, L, T, wf.w, wf.h, 12); ctx.clip();
    ctx.fillStyle = '#93602f'; ctx.fillRect(L, T, wf.w, wf.h);

    const rowW = 15;
    const rows = Math.max(4, Math.floor(wf.w / rowW));
    const step = wf.w / rows;
    const greens = ['#3fa34d', '#58b95d']; const golds = ['#d9a521', '#f0c64a'];
    const swayAmp = st.stage === 'RIPE' || st.stage === 'HARVESTING' ? 3.4 : 2.2;
    const cropPath = [new Path2D(), new Path2D()];
    const stubble = new Path2D();
    const furrow = new Path2D();
    for (let r = 0; r < rows; r++) {
      const x = L + (r + 0.5) * step;
      const harvestedRow = (x - L) / wf.w < shown;
      if (harvestedRow) {
        for (let y = T + 8; y < T + wf.h - 4; y += 9) { stubble.moveTo(x - 3, y); stubble.lineTo(x + 3, y + 2); }
        furrow.rect(x - 1, T, 2, wf.h);
        continue;
      }
      const nearEdge = (x - L) / wf.w - shown;
      for (let y = T + 9, i = 0; y < T + wf.h - 3; y += 11, i++) {
        const sway = Math.sin(this.time * 1.9 + x * 0.045 + y * 0.03) * swayAmp * (nearEdge < 0.05 && st.stage === 'HARVESTING' ? 1.8 : 1);
        const p = cropPath[(r + i) % 2];
        p.moveTo(x, y + 6);
        p.quadraticCurveTo(x - 6, y - 2, x + sway, y - 8);
        p.quadraticCurveTo(x + 6, y - 2, x, y + 6);
      }
    }
    const ripe = st.stage === 'RIPE' || st.stage === 'HARVESTING' || st.stage === 'HARVESTED';
    ctx.fillStyle = ripe ? golds[0] : greens[0]; ctx.fill(cropPath[0]);
    ctx.fillStyle = ripe ? golds[1] : greens[1]; ctx.fill(cropPath[1]);
    ctx.fillStyle = 'rgba(70,40,15,0.35)'; ctx.fill(furrow);
    ctx.strokeStyle = '#d8bd86'; ctx.lineWidth = 1.6; ctx.stroke(stubble);

    // harvest edge: a glowing line where the machine is cutting
    if (st.stage === 'HARVESTING' && shown < 0.999) {
      const ex = L + wf.w * shown;
      const g = ctx.createLinearGradient(ex - 18, 0, ex + 18, 0);
      g.addColorStop(0, 'rgba(253,224,71,0)'); g.addColorStop(0.5, 'rgba(253,224,71,0.45)'); g.addColorStop(1, 'rgba(253,224,71,0)');
      ctx.fillStyle = g; ctx.fillRect(ex - 18, T, 36, wf.h);
    }
    ctx.restore();

    if (st.stage === 'HARVESTED') {
      for (let i = 0; i < 4; i++) {
        const bx = L + 26 + i * (wf.w - 52) / 3; const by = T + wf.h - 26 - (i % 2) * 8;
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(bx + 3, by + 6, 17, 9, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#e3bf55'; ctx.beginPath(); ctx.arc(bx, by, 15, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#b8902b'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(bx, by, 10, 0.4, 5.2); ctx.stroke(); ctx.beginPath(); ctx.arc(bx, by, 5, 0.4, 5); ctx.stroke();
      }
    }
    if (st.blocked) {
      ctx.save();
      ctx.fillStyle = `rgba(239,68,68,${0.1 + 0.08 * Math.sin(this.time * 5)})`;
      this.round(ctx, L, T, wf.w, wf.h, 12); ctx.fill();
      ctx.restore();
    }
    if (sel) {
      ctx.save();
      ctx.strokeStyle = `rgba(255,255,255,${0.75 + 0.25 * Math.sin(this.time * 6)})`; ctx.lineWidth = 6; ctx.setLineDash([22, 12]); ctx.lineDashOffset = -this.time * 40;
      this.round(ctx, L - 18, T - 18, wf.w + 36, wf.h + 36, 24); ctx.stroke();
      ctx.restore();
    }
  }

  private round(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  private drawRescuePaths(ctx: CanvasRenderingContext2D, scene: SceneInput) {
    for (const sp of this.sprites.values()) {
      if (!sp.rescuing || !sp.fieldId) continue;
      const f = scene.world.fields.find((x) => x.id === sp.fieldId);
      if (!f) continue;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(52,211,153,0.35)'; ctx.lineWidth = 18; ctx.beginPath(); ctx.moveTo(sp.x, sp.y); ctx.lineTo(f.x, f.y); ctx.stroke();
      ctx.strokeStyle = '#10b981'; ctx.lineWidth = 7; ctx.setLineDash([16, 14]); ctx.lineDashOffset = -this.time * 70;
      ctx.beginPath(); ctx.moveTo(sp.x, sp.y); ctx.lineTo(f.x, f.y); ctx.stroke();
      ctx.setLineDash([]);
      const pr = (this.time * 1.1) % 1;
      ctx.strokeStyle = `rgba(16,185,129,${1 - pr})`; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(f.x, f.y, 40 + pr * 120, 0, TAU); ctx.stroke();
      const pr2 = (this.time * 1.1 + 0.5) % 1;
      ctx.strokeStyle = `rgba(16,185,129,${1 - pr2})`; ctx.beginPath(); ctx.arc(f.x, f.y, 40 + pr2 * 120, 0, TAU); ctx.stroke();
      ctx.restore();
    }
  }

  private drawMachine(ctx: CanvasRenderingContext2D, sp: Sprite, id: string, s: number, night: number) {
    const v = this.visibleRect();
    if (sp.x < v.x0 - 120 || sp.x > v.x1 + 120 || sp.y < v.y0 - 120 || sp.y > v.y1 + 120) return;
    const broken = sp.status === 'BREAKDOWN';
    const working = sp.status === 'WORKING';
    const jitter = sp.shake > 0 ? Math.sin(this.time * 70) * 3 * sp.shake : working ? Math.sin(this.time * 38) * 0.9 : 0;
    const sel = this.scene?.selected?.type === 'machine' && this.scene.selected.id === id;
    ctx.save();
    ctx.translate(sp.x + jitter, sp.y);
    ctx.scale(s, s);
    if (sel) {
      ctx.strokeStyle = `rgba(255,255,255,${0.7 + 0.3 * Math.sin(this.time * 7)})`; ctx.lineWidth = 4; ctx.setLineDash([10, 8]); ctx.lineDashOffset = -this.time * 30;
      ctx.beginPath(); ctx.arc(0, 0, 52, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.beginPath(); ctx.ellipse(8, 16, 38, 30, 0, 0, TAU); ctx.fill();
    ctx.rotate((sp.heading * Math.PI) / 180);

    // wheels
    ctx.fillStyle = '#23262b';
    for (const [wx, wy, ww, wh] of [[-26, 12, 11, 22], [15, 12, 11, 22], [-24, -16, 9, 16], [15, -16, 9, 16]] as const) { this.round(ctx, wx, wy - wh / 2, ww, wh, 4); ctx.fill(); }
    // cutter bar + reel
    ctx.fillStyle = '#b9c0c9'; this.round(ctx, -34, -42, 68, 14, 5); ctx.fill();
    ctx.fillStyle = '#8b939d'; ctx.fillRect(-34, -30, 68, 3);
    for (let i = 0; i < 9; i++) {
      const rx = -30 + i * 7.5;
      const ph = Math.sin(sp.spin + i * 0.9);
      ctx.fillStyle = ph > 0 ? '#f2b705' : '#c98f00';
      ctx.fillRect(rx, -50 + ph * 4, 5, 18);
    }
    // body
    const g = ctx.createLinearGradient(-20, -20, 20, 30);
    g.addColorStop(0, broken ? '#8a8f98' : '#ff9a4a'); g.addColorStop(1, broken ? '#5b6068' : '#e0560c');
    ctx.fillStyle = g; this.round(ctx, -20, -26, 40, 58, 9); ctx.fill();
    ctx.fillStyle = broken ? '#6b7078' : '#c24a08'; this.round(ctx, -17, 6, 34, 24, 6); ctx.fill();     // grain tank
    ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.fillRect(-14, 10, 28, 3);
    // cabin
    const cg = ctx.createLinearGradient(-13, -22, 13, -4);
    cg.addColorStop(0, '#cfeefc'); cg.addColorStop(1, '#6db8dc');
    ctx.fillStyle = cg; this.round(ctx, -14, -24, 28, 24, 6); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.beginPath(); ctx.moveTo(-10, -22); ctx.lineTo(-2, -22); ctx.lineTo(-10, -10); ctx.closePath(); ctx.fill();
    // beacon
    const blink = broken ? Math.sin(this.time * 12) > 0 : working ? Math.sin(this.time * 4) > 0.2 : false;
    ctx.fillStyle = blink ? (broken ? '#ef4444' : '#fbbf24') : '#7a5a14'; ctx.beginPath(); ctx.arc(0, -2, 4, 0, TAU); ctx.fill();
    ctx.restore();

    if (night > 0.25 && (working || sp.status === 'MOVING')) {
      void 0; // headlights are painted in the additive light pass
    }
  }

  private drawParticles(ctx: CanvasRenderingContext2D, layer: 'under' | 'over') {
    for (const p of this.particles) {
      const under = p.kind === 'dust' || p.kind === 'smoke';
      if ((layer === 'under') !== under) continue;
      const t = p.life / p.max;
      ctx.save();
      switch (p.kind) {
        case 'dust': case 'smoke':
          ctx.globalAlpha = (1 - t) * 0.8; ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.6 + t * 1.2), 0, TAU); ctx.fill(); break;
        case 'chaff':
          ctx.globalAlpha = 1 - t; ctx.fillStyle = p.color; ctx.fillRect(p.x, p.y, p.size, p.size * 0.5); break;
        case 'spark':
          ctx.globalAlpha = 1 - t; ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1 - t * 0.5), 0, TAU); ctx.fill(); break;
        case 'confetti':
          ctx.globalAlpha = Math.min(1, (1 - t) * 2); ctx.translate(p.x, p.y); ctx.rotate(p.rot ?? 0); ctx.fillStyle = p.color; ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2); break;
        case 'ring':
          ctx.globalAlpha = 1 - t; ctx.strokeStyle = p.color; ctx.lineWidth = 5 * (1 - t) + 1; ctx.beginPath(); ctx.arc(p.x, p.y, p.size + t * 110, 0, TAU); ctx.stroke(); break;
        case 'firefly': {
          const a = Math.sin(t * Math.PI);
          ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a * (0.55 + 0.45 * Math.sin(this.time * 6 + p.x)); ctx.fillStyle = p.color;
          ctx.beginPath(); ctx.arc(p.x, p.y, 3.2, 0, TAU); ctx.fill();
          const gg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 16); gg.addColorStop(0, 'rgba(254,240,138,0.5)'); gg.addColorStop(1, 'rgba(254,240,138,0)');
          ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(p.x, p.y, 16, 0, TAU); ctx.fill(); break;
        }
        case 'text':
          ctx.globalAlpha = Math.min(1, (1 - t) * 2.2); ctx.font = `800 ${p.size / Math.max(0.35, this.cam.zoom * 1.6)}px system-ui, sans-serif`;
          ctx.textAlign = 'center'; ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.strokeText(p.text ?? '', p.x, p.y); ctx.fillStyle = p.color; ctx.fillText(p.text ?? '', p.x, p.y); break;
        default: break;
      }
      ctx.restore();
    }
  }

  private drawCloudShadows(ctx: CanvasRenderingContext2D, scene: SceneInput) {
    const b = scene.world.bounds;
    const span = b.maxX - b.minX + 1200;
    ctx.save();
    ctx.fillStyle = 'rgba(20,40,20,0.10)';
    for (let i = 0; i < 6; i++) {
      const x = b.minX - 600 + ((hash01(i * 9) * span + this.time * (14 + i * 3)) % span);
      const y = b.minY + hash01(i * 9 + 1) * (b.maxY - b.minY);
      const r = 150 + hash01(i * 9 + 2) * 150;
      ctx.beginPath(); ctx.ellipse(x, y, r * 1.6, r * 0.8, 0.2, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(x + r * 0.9, y + r * 0.2, r, r * 0.6, 0.1, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  private drawTint(ctx: CanvasRenderingContext2D, scene: SceneInput) {
    const [r, g, b] = skyTint(scene.hour);
    if (r === 255 && g === 255 && b === 255) return;
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.restore();
  }

  private drawLights(ctx: CanvasRenderingContext2D, scene: SceneInput, night: number) {
    if (night < 0.2) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const a = Math.min(1, night * 1.3);
    for (const sp of this.sprites.values()) {
      const p = this.screenOfWorld(sp.x, sp.y);
      const z = this.cam.zoom * this.spriteScale();
      if (sp.status === 'WORKING' || sp.status === 'MOVING') {
        const rad = 150 * z;
        const gg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rad);
        gg.addColorStop(0, `rgba(255,226,140,${0.55 * a})`); gg.addColorStop(1, 'rgba(255,226,140,0)');
        ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(p.x, p.y, rad, 0, TAU); ctx.fill();
        // headlight cone
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate((sp.heading * Math.PI) / 180);
        const cone = ctx.createLinearGradient(0, 0, 0, -260 * z);
        cone.addColorStop(0, `rgba(255,244,190,${0.7 * a})`); cone.addColorStop(1, 'rgba(255,244,190,0)');
        ctx.fillStyle = cone; ctx.beginPath(); ctx.moveTo(-10 * z, -40 * z); ctx.lineTo(-90 * z, -260 * z); ctx.lineTo(90 * z, -260 * z); ctx.lineTo(10 * z, -40 * z); ctx.closePath(); ctx.fill();
        ctx.restore();
      } else if (sp.status === 'BREAKDOWN') {
        const rad = 90 * z * (0.8 + 0.2 * Math.sin(this.time * 10));
        const gg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rad);
        gg.addColorStop(0, `rgba(255,70,60,${0.5 * a})`); gg.addColorStop(1, 'rgba(255,70,60,0)');
        ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(p.x, p.y, rad, 0, TAU); ctx.fill();
      }
    }
    const b = scene.world.bounds;
    for (const [wx, wy] of [[b.minX + 230 - 62, b.minY + 200 + 8], [b.minX + 230 + 24, b.minY + 200 + 8]] as const) {
      const p = this.screenOfWorld(wx + 8, wy + 9); const rad = 70 * this.cam.zoom;
      const gg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rad);
      gg.addColorStop(0, `rgba(255,214,120,${0.7 * a})`); gg.addColorStop(1, 'rgba(255,214,120,0)');
      ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(p.x, p.y, rad, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  private drawVignette(ctx: CanvasRenderingContext2D) {
    const g = ctx.createRadialGradient(this.w / 2, this.h / 2, Math.min(this.w, this.h) * 0.45, this.w / 2, this.h / 2, Math.max(this.w, this.h) * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(10,30,10,0.35)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, this.w, this.h);
  }

  /** Screen-space overlays: field banners, machine tags and "something to do" bubbles. */
  private drawLabels(ctx: CanvasRenderingContext2D, scene: SceneInput) {
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const z = this.cam.zoom;
    const compact = z < 0.28;
    for (const wf of scene.world.fields) {
      const fv = scene.fields.find((f) => f.id === wf.id);
      if (!fv) continue;
      const p = this.screenOfWorld(wf.x, wf.y - wf.h / 2 - 28 / Math.max(z, 0.3));
      if (p.x < -200 || p.x > this.w + 200 || p.y < -100 || p.y > this.h + 100) continue;
      const st = cropState(fv.readiness, fv.progress);
      const shown = this.shownProgress.get(fv.id) ?? st.harvested;
      const bw = compact ? 96 : 150; const bh = compact ? 30 : 44;
      ctx.fillStyle = 'rgba(0,0,0,0.28)'; this.round(ctx, p.x - bw / 2 + 2, p.y - bh / 2 + 4, bw, bh, 12); ctx.fill();
      ctx.fillStyle = fv.mine ? '#fffbe6' : 'rgba(255,255,255,0.92)'; this.round(ctx, p.x - bw / 2, p.y - bh / 2, bw, bh, 12); ctx.fill();
      ctx.strokeStyle = st.blocked ? '#ef4444' : fv.mine ? '#f59e0b' : '#9ca3af'; ctx.lineWidth = 2.5; ctx.stroke();
      ctx.fillStyle = '#1f2937'; ctx.font = `800 ${compact ? 13 : 15}px system-ui, sans-serif`;
      ctx.fillText(`🌾 ${fv.label}`, p.x, p.y - (compact ? 0 : 8));
      if (!compact) {
        ctx.fillStyle = '#e5e7eb'; this.round(ctx, p.x - 62, p.y + 8, 124, 9, 4.5); ctx.fill();
        ctx.fillStyle = st.blocked ? '#ef4444' : '#22c55e'; this.round(ctx, p.x - 62, p.y + 8, Math.max(9, 124 * shown), 9, 4.5); ctx.fill();
      }
      if (fv.quest === 'todo' || fv.quest === 'alert') {
        const bounce = Math.abs(Math.sin(this.time * 4)) * 10;
        ctx.font = '30px system-ui, "Segoe UI Emoji", sans-serif';
        ctx.fillText(fv.quest === 'alert' ? '⚠️' : '📣', p.x + bw / 2 - 6, p.y - bh / 2 - 16 - bounce);
      } else if (fv.quest === 'done') {
        ctx.font = '24px system-ui, "Segoe UI Emoji", sans-serif';
        ctx.fillText('⭐', p.x + bw / 2 - 6, p.y - bh / 2 - 8);
      }
    }
    const s = this.spriteScale();
    for (const [id, sp] of this.sprites) {
      const p = this.screenOfWorld(sp.x, sp.y - 58 * s);
      if (p.x < -100 || p.x > this.w + 100 || p.y < -60 || p.y > this.h + 60) continue;
      const color = sp.status === 'BREAKDOWN' ? '#ef4444' : sp.status === 'WORKING' ? '#f59e0b' : sp.status === 'MAINTENANCE' ? '#64748b' : sp.rescuing ? '#10b981' : '#22c55e';
      const text = sp.status === 'BREAKDOWN' ? `${id} · SỰ CỐ` : sp.rescuing ? `${id} · CỨU VIỆN` : id;
      ctx.font = '800 13px system-ui, sans-serif';
      const tw = ctx.measureText(text).width + 24;
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; this.round(ctx, p.x - tw / 2 + 1, p.y - 11, tw, 24, 12); ctx.fill();
      ctx.fillStyle = color; this.round(ctx, p.x - tw / 2, p.y - 13, tw, 24, 12); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillText(text, p.x, p.y - 1);
      if (sp.status === 'BREAKDOWN') {
        ctx.font = '26px system-ui, "Segoe UI Emoji", sans-serif';
        ctx.fillText('🔧', p.x, p.y - 30 - Math.abs(Math.sin(this.time * 5)) * 6);
      } else if (sp.fuel < 25) {
        ctx.font = '20px system-ui, "Segoe UI Emoji", sans-serif';
        ctx.fillText('⛽', p.x + tw / 2 + 12, p.y);
      }
    }
    ctx.restore();
  }
}
