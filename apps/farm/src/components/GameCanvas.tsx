// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenAgriOS Contributors

import React, { useEffect, useRef } from 'react';
import { FarmRenderer, type SceneInput } from '../game/renderer';

interface Props {
  scene: SceneInput | null;
  getHour: () => number;
  onRenderer: (r: FarmRenderer | null) => void;
  onPick: (pick: { type: 'field' | 'machine'; id: string } | null) => void;
}

/** Canvas host: resize handling, the animation loop, and pan / zoom / pinch / click input. */
export const GameCanvas: React.FC<Props> = ({ scene, getHour, onRenderer, onPick }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<FarmRenderer | null>(null);
  const hourRef = useRef(getHour);
  hourRef.current = getHour;
  const pickRef = useRef(onPick);
  pickRef.current = onPick;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const r = new FarmRenderer(canvas);
    renderer.current = r;
    onRenderer(r);

    const resize = () => r.resize(canvas.clientWidth, canvas.clientHeight, window.devicePixelRatio);
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    let raf = 0;
    const loop = (t: number) => {
      r.setHour(hourRef.current());
      r.frame(t);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    // pointer input: one finger/mouse drags, two fingers pinch, a short press picks
    const pointers = new Map<number, { x: number; y: number }>();
    let downAt: { x: number; y: number } | null = null;
    let moved = 0;
    let pinch = 0;
    const pos = (e: PointerEvent) => { const b = canvas.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
    const down = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, pos(e));
      if (pointers.size === 1) { downAt = pos(e); moved = 0; }
      if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
    };
    const move = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      const p = pos(e);
      pointers.set(e.pointerId, p);
      if (pointers.size === 1) { moved += Math.hypot(p.x - prev.x, p.y - prev.y); if (moved > 4) r.panBy(p.x - prev.x, p.y - prev.y); }
      else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch > 0) r.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / pinch);
        pinch = d; moved = 99;
      }
    };
    const up = (e: PointerEvent) => {
      const wasOne = pointers.size === 1;
      pointers.delete(e.pointerId);
      if (wasOne && downAt && moved <= 4) {
        const p = pos(e);
        const hit = r.pick(p.x, p.y);
        pickRef.current(hit);
        if (hit?.type === 'machine') r.setFollow(null);
      }
      if (pointers.size < 2) pinch = 0;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const b = canvas.getBoundingClientRect();
      r.zoomAt(e.clientX - b.left, e.clientY - b.top, Math.exp(-e.deltaY * 0.0012));
    };
    const dbl = (e: MouseEvent) => {
      const b = canvas.getBoundingClientRect();
      const hit = r.pick(e.clientX - b.left, e.clientY - b.top);
      if (hit?.type === 'field') r.focusField(hit.id);
      if (hit?.type === 'machine') r.focusMachine(hit.id);
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', wheel, { passive: false });
    canvas.addEventListener('dblclick', dbl);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('wheel', wheel);
      canvas.removeEventListener('dblclick', dbl);
      renderer.current = null;
      onRenderer(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (scene && renderer.current) renderer.current.setScene(scene);
  }, [scene]);

  return <canvas ref={ref} className="game-canvas" aria-label="Bản đồ nông trại" />;
};
