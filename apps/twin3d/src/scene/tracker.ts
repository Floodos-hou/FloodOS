// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenAgriOS Contributors

import { bearingDeg, lerpAngle } from '../geo/geo.ts';

/** Moves smaller than this are GPS jitter, not a change of heading. */
export const MIN_MOVE_M = 1.0;
/** A jump larger than this (simulation reset, first fix) is shown immediately instead of being driven through. */
export const SNAP_M = 1500;
const POS_TAU_S = 1.6;
const HEADING_TAU_S = 0.45;

/**
 * Smooths a machine between telemetry fixes (which arrive every few seconds) and infers its heading from the direction
 * of the last real movement. The platform does not report a heading, so this is explicit inference, not a measurement.
 */
export class MachineTrack {
  x: number; z: number;
  /** compass bearing, 0 = north */
  heading: number;
  speedMps = 0;
  private tx: number; private tz: number; private targetHeading: number;

  constructor(x: number, z: number, heading = 0) {
    this.x = this.tx = x; this.z = this.tz = z;
    this.heading = this.targetHeading = ((heading % 360) + 360) % 360;
  }

  /** Feeds a new telemetry fix. Returns true when the machine was judged to have moved. */
  setTarget(x: number, z: number): boolean {
    const dx = x - this.tx; const dz = z - this.tz;
    const d = Math.hypot(dx, dz);
    if (d > SNAP_M) { this.x = this.tx = x; this.z = this.tz = z; this.speedMps = 0; return false; }
    if (d < MIN_MOVE_M) return false;
    this.targetHeading = bearingDeg(dx, dz);
    this.tx = x; this.tz = z;
    return true;
  }

  /** Orientation to use while the machine has not moved yet (for example along the rows of the field it works in). */
  setRestHeading(h: number): void {
    if (this.speedMps < 0.05 && Math.hypot(this.tx - this.x, this.tz - this.z) < MIN_MOVE_M) {
      this.targetHeading = ((h % 360) + 360) % 360;
    }
  }

  step(dtSec: number): void {
    const dt = Math.max(0, Math.min(dtSec, 0.25));
    const kp = 1 - Math.exp(-dt / POS_TAU_S);
    const px = this.x; const pz = this.z;
    this.x += (this.tx - this.x) * kp;
    this.z += (this.tz - this.z) * kp;
    this.heading = lerpAngle(this.heading, this.targetHeading, 1 - Math.exp(-dt / HEADING_TAU_S));
    this.speedMps = dt > 0 ? Math.hypot(this.x - px, this.z - pz) / dt : 0;
  }
}
