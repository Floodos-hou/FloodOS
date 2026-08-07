// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenAgriOS Contributors

import * as THREE from 'three';

/**
 * A combine harvester built from primitives at real size (about 8 m long, header 4.4 m wide). It faces -z (north),
 * the origin is on the ground in the middle of the machine. The model is an illustration of the machine type; the
 * position and heading it is drawn with come from telemetry.
 */
export interface MachineModel {
  group: THREE.Group;
  /** call every frame; `moving` makes the reel turn */
  animate: (t: number, status: string, moving: boolean) => void;
  /** headlights on or off */
  setNight: (on: boolean) => void;
  dispose: () => void;
}

const STATUS_BEACON: Record<string, number> = { WORKING: 0xffb020, IDLE: 0x3ddc84, BREAKDOWN: 0xff3b30, MAINTENANCE: 0x4aa3ff };

export function buildMachine(label: string): MachineModel {
  const group = new THREE.Group();
  group.name = `machine:${label}`;
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const mat = (color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.25, ...extra });
    mats.push(m); return m;
  };
  const add = (g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = group) => {
    geos.push(g);
    const mesh = new THREE.Mesh(g, m); mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true;
    parent.add(mesh); return mesh;
  };
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, parent?: THREE.Object3D) => add(new THREE.BoxGeometry(w, h, d), m, x, y, z, parent);

  const green = mat(0x2e8b3d); const greenDark = mat(0x1f6a2c); const orange = mat(0xf28c1a); const rubber = mat(0x1c1e20, { roughness: 0.95, metalness: 0 });
  const steel = mat(0x8a9097, { metalness: 0.7, roughness: 0.35 });
  const glass = mat(0x9fd3ee, { roughness: 0.1, metalness: 0.5, transparent: true, opacity: 0.72 });
  const grain = mat(0xd9c15a, { roughness: 0.9, metalness: 0 });

  // crawler tracks: rounded belts with road wheels
  for (const x of [-1.5, 1.5]) {
    const belt = add(new THREE.CapsuleGeometry(0.55, 4.0, 6, 14), rubber, x, 0.6, 0.6); belt.rotation.x = Math.PI / 2; belt.scale.set(1.0, 1, 1.15);
    for (let i = 0; i < 5; i++) {
      const w = add(new THREE.CylinderGeometry(0.34, 0.34, 0.9, 14), steel, x, 0.55, -1.0 + i * 0.95); w.rotation.z = Math.PI / 2;
    }
  }
  // undercarriage and chassis
  box(3.4, 0.5, 5.0, greenDark, 0, 1.05, 0.6);
  box(3.2, 1.0, 5.4, green, 0, 1.7, 0.6);

  // grain tank behind the cab: sloped sides, grain visible through the top
  box(2.9, 1.5, 3.1, green, 0, 2.95, 1.9);
  const tankTop = box(2.5, 0.12, 2.7, grain, 0, 3.75, 1.9);
  tankTop.receiveShadow = true;
  const slopeL = box(0.18, 1.0, 3.1, green, -1.55, 3.55, 1.9); slopeL.rotation.z = 0.35;
  const slopeR = box(0.18, 1.0, 3.1, green, 1.55, 3.55, 1.9); slopeR.rotation.z = -0.35;
  // engine cover and exhaust
  box(2.6, 1.0, 1.6, orange, 0, 2.55, 3.5);
  add(new THREE.CylinderGeometry(0.14, 0.14, 1.4, 10), steel, 1.0, 3.7, 3.7);

  // cab: frame, glass, roof, mirrors
  box(2.1, 0.12, 2.0, greenDark, 0, 2.3, -1.2);
  box(1.9, 1.7, 1.8, glass, 0, 3.2, -1.2);
  for (const x of [-0.95, 0.95]) for (const z of [-2.05, -0.35]) box(0.1, 1.8, 0.1, greenDark, x, 3.2, z);
  box(2.2, 0.14, 2.1, orange, 0, 4.1, -1.2);
  for (const x of [-1.15, 1.15]) box(0.08, 0.45, 0.25, steel, x, 3.5, -2.0);
  box(1.0, 0.7, 0.9, mat(0x222629), 0, 2.85, -1.4); // seat

  // feeder house: slanted channel between the header and the body
  const feeder = box(1.8, 0.9, 2.2, greenDark, 0, 1.2, -2.8); feeder.rotation.x = -0.18;

  // header (cutting platform): floor, back wall, side dividers, cutter bar and auger
  box(4.4, 0.2, 1.7, orange, 0, 0.5, -4.2);
  box(4.4, 0.9, 0.14, orange, 0, 1.0, -3.4);
  for (const x of [-2.2, 2.2]) box(0.14, 0.9, 1.7, orange, x, 0.95, -4.2);
  for (let i = 0; i < 14; i++) { const t = add(new THREE.ConeGeometry(0.1, 0.5, 4), steel, -2.05 + i * 0.315, 0.52, -5.2); t.rotation.x = -Math.PI / 2; }
  for (const x of [-2.2, 2.2]) { const dv = add(new THREE.ConeGeometry(0.2, 1.1, 6), orange, x, 0.7, -5.35); dv.rotation.x = -Math.PI / 2; }

  // reel: a rotating drum with paddles
  const reel = new THREE.Group(); reel.position.set(0, 1.55, -4.3); group.add(reel);
  const hub = add(new THREE.CylinderGeometry(0.2, 0.2, 4.2, 10), steel, 0, 0, 0, reel); hub.rotation.z = Math.PI / 2;
  const paddleMat = mat(0x6a3d12);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    const pd = add(new THREE.BoxGeometry(4.2, 0.07, 0.34), paddleMat, 0, Math.sin(a) * 0.62, Math.cos(a) * 0.62, reel);
    pd.rotation.x = -a;
  }
  for (const x of [-2.1, 2.1]) box(0.1, 0.1, 1.5, steel, x, 1.55, -3.7); // reel arms

  // unloading auger: tube along the right side with a spout
  const tube = add(new THREE.CylinderGeometry(0.2, 0.2, 4.2, 10), orange, 1.7, 4.0, 0.6); tube.rotation.x = Math.PI / 2;
  const spout = add(new THREE.CylinderGeometry(0.24, 0.16, 0.5, 10), orange, 1.7, 3.9, -1.65);
  spout.rotation.x = 0.4;

  // headlights: two lamps and a spot light that throws a cone ahead of the header
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x444444, emissive: 0xfff2c0, emissiveIntensity: 0 }); mats.push(lampMat);
  for (const x of [-0.7, 0.7]) add(new THREE.BoxGeometry(0.4, 0.25, 0.15), lampMat, x, 4.0, -2.3);
  const spot = new THREE.SpotLight(0xfff2c0, 0, 70, 0.55, 0.6, 1.6);
  spot.position.set(0, 3.9, -2.4); spot.target.position.set(0, 0, -24); group.add(spot, spot.target);

  // beacon
  const beaconMat = new THREE.MeshStandardMaterial({ color: 0x333333, emissive: 0x000000, emissiveIntensity: 1.5 }); mats.push(beaconMat);
  const beacon = add(new THREE.SphereGeometry(0.25, 14, 10), beaconMat, 0, 4.45, -0.4);

  // smoke for breakdowns: a few rising puffs
  const puffGeo = new THREE.SphereGeometry(0.55, 10, 8); geos.push(puffGeo);
  const puffMat = new THREE.MeshBasicMaterial({ color: 0x555555, transparent: true, opacity: 0.5, depthWrite: false }); mats.push(puffMat);
  const puffs: THREE.Mesh[] = [];
  for (let i = 0; i < 5; i++) { const p = new THREE.Mesh(puffGeo, puffMat); p.visible = false; group.add(p); puffs.push(p); }

  const animate = (t: number, status: string, moving: boolean) => {
    const color = STATUS_BEACON[status] ?? 0x888888;
    beaconMat.color.setHex(color); beaconMat.emissive.setHex(color);
    const blink = status === 'BREAKDOWN' ? (Math.sin(t * 9) > 0 ? 1 : 0.1) : status === 'WORKING' ? 0.55 + 0.45 * Math.sin(t * 5) : 1;
    beaconMat.emissiveIntensity = 0.2 + 2 * blink;
    if (status === 'WORKING' && moving) reel.rotation.x = t * 4;
    const smoking = status === 'BREAKDOWN';
    puffs.forEach((p, i) => {
      p.visible = smoking;
      if (!smoking) return;
      const k = ((t * 0.35 + i / puffs.length) % 1);
      p.position.set(1.0 + 0.4 * Math.sin(t + i), 4.5 + k * 7, 3.7 + 0.3 * Math.cos(t * 0.7 + i));
      p.scale.setScalar(0.6 + k * 2.2);
    });
    if (smoking) puffMat.opacity = 0.45;
  };

  const setNight = (on: boolean) => { spot.intensity = on ? 900 : 0; lampMat.emissiveIntensity = on ? 3 : 0; };
  const dispose = () => { geos.forEach((g) => g.dispose()); mats.forEach((m) => m.dispose()); };
  return { group, animate, setNight, dispose };
}
