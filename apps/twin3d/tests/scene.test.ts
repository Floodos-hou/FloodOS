// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MIN_MOVE_M, MachineTrack, SNAP_M } from '../src/scene/tracker.ts';
import { areaConsistency, cropState, readinessLabel } from '../src/scene/crop.ts';
import { hourFor, mixColor, skyFor } from '../src/scene/sky.ts';
import { tileUrl } from '../src/geo/basemap.ts';

const near = (a: number, b: number, eps: number, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} expected ${b} got ${a}`);
const run = (t: MachineTrack, seconds: number) => { for (let i = 0; i < seconds * 60; i++) t.step(1 / 60); };

test('a machine moving east heads east (compass 90) and arrives at the fix', () => {
  const t = new MachineTrack(0, 0, 0);
  assert.equal(t.setTarget(60, 0), true);
  run(t, 12);
  near(t.heading, 90, 0.5, 'heading'); near(t.x, 60, 0.5, 'x'); near(t.z, 0, 1e-6, 'z');
});

test('moving north-west gives bearing 315, and south gives 180', () => {
  const a = new MachineTrack(0, 0); a.setTarget(-30, -30); run(a, 10); near(a.heading, 315, 0.5);
  const b = new MachineTrack(0, 0); b.setTarget(0, 40); run(b, 10); near(b.heading, 180, 0.5);
});

test('jitter below the threshold does not change the heading', () => {
  const t = new MachineTrack(10, 10, 90);
  assert.equal(t.setTarget(10 + MIN_MOVE_M * 0.5, 10), false);
  run(t, 5); near(t.heading, 90, 1e-6);
});

test('the heading turns the short way across north', () => {
  const t = new MachineTrack(0, 0, 350);
  t.setTarget(3, -40); // slightly east of north (bearing about 4.3)
  for (let i = 0; i < 6; i++) t.step(1 / 60);
  assert.ok(t.heading > 340 || t.heading < 30, `still near north, got ${t.heading}`);
  assert.ok(!(t.heading > 100 && t.heading < 250), 'never swings through south');
});

test('a huge jump (reset or first fix) snaps without driving through the map', () => {
  const t = new MachineTrack(0, 0, 45);
  t.setTarget(SNAP_M + 500, 0);
  assert.equal(t.x, SNAP_M + 500);
  near(t.heading, 45, 1e-9, 'heading kept');
});

test('rest heading applies only when the machine is not moving', () => {
  const idle = new MachineTrack(0, 0, 0); idle.setRestHeading(270); run(idle, 8); near(idle.heading, 270, 0.5);
  const moving = new MachineTrack(0, 0, 0); moving.setTarget(50, 0); moving.setRestHeading(270); run(moving, 10); near(moving.heading, 90, 0.5);
});

test('step is stable for tiny, zero and huge frame times', () => {
  const t = new MachineTrack(0, 0); t.setTarget(20, 0);
  t.step(0); assert.equal(t.x, 0);
  t.step(5); assert.ok(t.x > 0 && t.x < 20, 'a long frame is clamped, no overshoot');
  t.step(-1); assert.ok(Number.isFinite(t.x));
});

test('crop state follows readiness and progress, and clamps bad progress', () => {
  assert.deepEqual(cropState('GROWING', 0), { stage: 'GROWING', harvested: 0, blocked: false });
  assert.deepEqual(cropState('READY_HARVEST', 0), { stage: 'RIPE', harvested: 0, blocked: false });
  assert.deepEqual(cropState('HARVESTING', 40), { stage: 'HARVESTING', harvested: 0.4, blocked: false });
  assert.deepEqual(cropState('HARVESTING', 100), { stage: 'HARVESTED', harvested: 1, blocked: false });
  assert.deepEqual(cropState('COMPLETED', 20), { stage: 'HARVESTED', harvested: 1, blocked: false });
  assert.deepEqual(cropState('IMPACTED', 35), { stage: 'HARVESTING', harvested: 0.35, blocked: true });
  assert.deepEqual(cropState('IMPACTED', 0), { stage: 'RIPE', harvested: 0, blocked: true });
  assert.equal(cropState('HARVESTING', 250).harvested, 1);
  assert.equal(cropState('HARVESTING', -5).harvested, 0);
  assert.equal(cropState('HARVESTING', Number.NaN).harvested, 0);
  assert.equal(cropState('???', 50).stage, 'GROWING');
});

test('labels fall back to the raw code when unknown', () => {
  assert.equal(readinessLabel('COMPLETED'), 'Đã gặt xong');
  assert.equal(readinessLabel('WEIRD'), 'WEIRD');
});

test('area consistency flags a boundary that does not match the declared area', () => {
  assert.equal(areaConsistency(2.5, 25_000).ok, true);
  assert.equal(areaConsistency(2.5, 49_000).ok, false, 'twice as big');
  assert.equal(areaConsistency(0, 10).ok, false);
  near(areaConsistency(2, 20_000).ratio, 1, 1e-12);
});

test('simulated hour is converted from UTC to Vietnam time; invalid input has a safe default', () => {
  near(hourFor('sim', '2026-11-02T01:30:00Z'), 8.5, 1e-9);
  near(hourFor('sim', '2026-11-02T20:00:00Z'), 3, 1e-9, 'wraps past midnight');
  assert.equal(hourFor('sim', undefined), 9);
  assert.equal(hourFor('sim', 'not a date'), 9);
  assert.equal(hourFor('noon', 'x'), 12);
  assert.ok(hourFor('night', undefined) > 18);
});

test('sky: night is dark and unlit, noon is bright and lit, dusk is warm', () => {
  const night = skyFor(23); const noon = skyFor(12); const dusk = skyFor(17.6);
  assert.equal(night.night, true); assert.equal(noon.night, false);
  assert.ok(night.sunIntensity > 0 && night.sunIntensity < 0.6, 'moonlight only');
  assert.equal(night.sunColor, 0x8fa8ff);
  assert.ok(noon.sunIntensity > 2 && noon.sunIntensity + noon.hemiIntensity > night.sunIntensity + night.hemiIntensity, 'noon is the brightest');
  assert.ok(night.hemiIntensity >= 2, 'dark but readable');
  assert.ok(dusk.sunIntensity > night.sunIntensity && dusk.sunIntensity < noon.sunIntensity);
  assert.equal(night.sky, 0x0a1228);
  assert.equal(noon.sky, 0x8ec9f0);
  assert.equal(mixColor(0x000000, 0xffffff, 0.5), 0x808080);
  assert.equal(mixColor(0x102030, 0x102030, 3), 0x102030, 'clamped');
});

test('tile URL template substitutes z/x/y', () => {
  assert.equal(tileUrl('https://t/{z}/{y}/{x}.jpg', 14, 12996, 7731), 'https://t/14/7731/12996.jpg');
});
