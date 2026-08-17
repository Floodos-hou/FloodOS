// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import { sunPosition } from '../geo/geo.ts';

export type HourMode = 'sim' | 'noon' | 'dusk' | 'night';

/** Hour of day used for the lighting: the simulated clock by default, or a fixed time chosen for the demo. */
export function hourFor(mode: HourMode, simTimeIso: string | undefined): number {
  switch (mode) {
    case 'noon': return 12;
    case 'dusk': return 17.4;
    case 'night': return 22;
    default: {
      if (!simTimeIso) return 9;
      const d = new Date(simTimeIso);
      if (Number.isNaN(d.getTime())) return 9;
      // the simulated clock is in UTC; Vietnam is UTC+7
      return (d.getUTCHours() + 7 + d.getUTCMinutes() / 60) % 24;
    }
  }
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const channels = (c: number) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
const pack = (r: number, g: number, b: number) => (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);

export function mixColor(a: number, b: number, t: number): number {
  const x = channels(a); const y = channels(b); const k = Math.max(0, Math.min(1, t));
  return pack(mix(x[0], y[0], k), mix(x[1], y[1], k), mix(x[2], y[2], k));
}

export interface SkyLook { sky: number; fog: number; sunIntensity: number; hemiIntensity: number; hemiSky: number; sunColor: number; elevationDeg: number; azimuthDeg: number; night: boolean }

/** Sky and light for the hour: night is dark blue, low sun is warm, high sun is white. */
export function skyFor(hour: number): SkyLook {
  const { azimuthDeg, elevationDeg } = sunPosition(hour);
  const day = 0x8ec9f0; const dawn = 0xf0a868; const night = 0x0a1228;
  let sky: number;
  if (elevationDeg <= -6) sky = night;
  else if (elevationDeg < 0) sky = mixColor(night, dawn, (elevationDeg + 6) / 6);
  else if (elevationDeg < 20) sky = mixColor(dawn, day, elevationDeg / 20);
  else sky = day;
  const above = Math.max(0, Math.min(1, elevationDeg / 25));
  const lit = elevationDeg > 0;
  // below the horizon the same directional light stands in for dim moonlight so the scene stays readable
  const sunColor = lit ? mixColor(0xffb36b, 0xfff4e0, above) : 0x8fa8ff;
  return {
    sky, fog: sky, elevationDeg, azimuthDeg, sunColor, night: elevationDeg < 4,
    sunIntensity: lit ? 0.45 + 2.2 * Math.min(1, elevationDeg / 40) : 0.45,
    // three.js lights are in physical units (radiance = albedo * intensity / pi), so ambient light needs roughly pi times more;
    // ambient is stronger at night to make up for the missing sun, the total light is still lowest at night
    hemiIntensity: 3.2 - 0.8 * Math.max(0, Math.min(1, (elevationDeg + 6) / 40)),
    hemiSky: mixColor(0x4a5f95, 0xcfe8ff, (elevationDeg + 6) / 30),
  };
}
