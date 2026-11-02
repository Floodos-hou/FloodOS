// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenAgriOS Contributors

/** Synthesised sound effects (Web Audio): no audio files, nothing to license. Off until the user turns it on. */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  enabled = false;

  async enable(): Promise<boolean> {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.2;
        this.master.connect(this.ctx.destination);
        this.engineOsc = this.ctx.createOscillator();
        this.engineOsc.type = 'sawtooth';
        this.engineOsc.frequency.value = 48;
        const lp = this.ctx.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 220;
        this.engineGain = this.ctx.createGain();
        this.engineGain.gain.value = 0;
        this.engineOsc.connect(lp).connect(this.engineGain).connect(this.master);
        this.engineOsc.start();
      }
      await this.ctx.resume();
      this.enabled = true;
      this.blip();
      return true;
    } catch {
      this.enabled = false;
      return false;
    }
  }

  disable() {
    this.enabled = false;
    if (this.engineGain) this.engineGain.gain.value = 0;
  }

  private tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.8, delay = 0, slideTo?: number) {
    if (!this.enabled || !this.ctx || !this.master) return;
    const t0 = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  blip() { this.tone(660, 0.09, 'triangle', 0.5); }
  chime() { this.tone(784, 0.16, 'sine', 0.6); this.tone(1175, 0.28, 'sine', 0.5, 0.1); }
  tada() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.55, i * 0.09)); }
  alarm() { for (let i = 0; i < 3; i++) { this.tone(880, 0.16, 'square', 0.35, i * 0.3); this.tone(660, 0.16, 'square', 0.35, i * 0.3 + 0.15); } }
  whoosh() { this.tone(300, 0.35, 'sawtooth', 0.25, 0, 1200); }

  /** Engine hum scaled by how many machines are working (0 = silent). */
  engine(workingMachines: number) {
    if (!this.enabled || !this.engineGain || !this.ctx) return;
    const level = Math.min(1, workingMachines / 3) * 0.16;
    this.engineGain.gain.setTargetAtTime(level, this.ctx.currentTime, 0.4);
    this.engineOsc?.frequency.setTargetAtTime(44 + workingMachines * 6, this.ctx.currentTime, 0.4);
  }
}
