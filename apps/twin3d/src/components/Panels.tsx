// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenAgriOS Contributors

import React from 'react';
import type { FieldPlot, HarvesterMachine } from '../../../web/src/types';
import { polygonArea, ringToLocal } from '../geo/geo';
import { MACHINE_STATUS_LABEL, areaConsistency, readinessLabel } from '../scene/crop';
import type { BasemapInfo } from '../scene/twin';

export interface FeedItem { id: number; tone: 'danger' | 'info' | 'success' | 'warn'; icon: string; text: string; at: string }

const age = (iso: string): string => {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 'không rõ';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  return s < 90 ? `${s} giây trước` : `${Math.round(s / 60)} phút trước`;
};

export const MachinePanel: React.FC<{ m: HarvesterMachine; following: boolean; onFollow: () => void; onFly: () => void; onClose: () => void }> = ({ m, following, onFollow, onFly, onClose }) => (
  <aside className="panel detail" aria-label="Chi tiết máy">
    <header><h3>{m.name}</h3><button className="x" onClick={onClose} aria-label="Đóng">×</button></header>
    <p className={`chip st-${m.status}`}>{MACHINE_STATUS_LABEL[m.status] ?? m.status}</p>
    <dl>
      <dt>Mã máy</dt><dd>{m.machine_id}</dd>
      <dt>Loại / model</dt><dd>{m.machine_type} {m.model}</dd>
      <dt>Công suất</dt><dd>{m.capacity_ha_per_hr} ha/giờ</dd>
      <dt>Nhiên liệu</dt><dd><span className="bar"><i style={{ width: `${Math.max(0, Math.min(100, m.fuel_pct))}%` }} /></span> {Math.round(m.fuel_pct)}%</dd>
      <dt>Độ khỏe</dt><dd><span className="bar"><i style={{ width: `${Math.max(0, Math.min(100, m.health_pct))}%` }} /></span> {Math.round(m.health_pct)}%</dd>
      <dt>Tọa độ</dt><dd>{m.current_lat.toFixed(5)}, {m.current_lng.toFixed(5)}</dd>
      <dt>Cập nhật</dt><dd>{age(m.telemetry_updated_at)}</dd>
    </dl>
    <div className="row">
      <button onClick={onFly}>Bay tới máy</button>
      <button className={following ? 'on' : ''} onClick={onFollow}>{following ? 'Đang bám theo' : 'Bám theo'}</button>
    </div>
  </aside>
);

export const FieldPanel: React.FC<{ f: FieldPlot; onFly: () => void; onClose: () => void }> = ({ f, onFly, onClose }) => {
  const ring = f.polygon?.[0];
  const drawnM2 = ring && ring.length >= 4 ? polygonArea(ringToLocal({ lat: f.center_lat, lng: f.center_lng }, ring)) : 0;
  const cons = areaConsistency(f.area_ha, drawnM2);
  return (
    <aside className="panel detail" aria-label="Chi tiết ruộng">
      <header><h3>{f.name}</h3><button className="x" onClick={onClose} aria-label="Đóng">×</button></header>
      <p className="chip">{readinessLabel(f.readiness_status)}</p>
      <dl>
        <dt>Chủ ruộng</dt><dd>{f.owner_name}</dd>
        <dt>Ấp</dt><dd>{f.hamlet}</dd>
        <dt>Cây trồng</dt><dd>{f.crop}</dd>
        <dt>Diện tích khai báo</dt><dd>{f.area_ha} ha</dd>
        <dt>Diện tích ranh giới</dt><dd>{(drawnM2 / 10_000).toFixed(2)} ha {cons.ok ? '' : '(lệch so với khai báo)'}</dd>
        <dt>Đã gặt</dt><dd><span className="bar"><i style={{ width: `${Math.max(0, Math.min(100, f.harvest_progress_pct))}%` }} /></span> {Math.round(f.harvest_progress_pct)}%</dd>
        <dt>Cửa sổ thu hoạch</dt><dd>{f.window_start?.slice(0, 10)} → {f.window_end?.slice(0, 10)}</dd>
      </dl>
      <div className="row"><button onClick={onFly}>Bay tới ruộng</button></div>
    </aside>
  );
};

export const Feed: React.FC<{ items: FeedItem[] }> = ({ items }) => (
  <section className="panel feed" aria-label="Sự kiện gần đây">
    <h4>Sự kiện</h4>
    {items.length === 0 && <p className="muted">Chưa có biến động trạng thái máy.</p>}
    <ul>{items.map((i) => <li key={i.id} className={i.tone}><span>{i.icon}</span><em>{i.at}</em> {i.text}</li>)}</ul>
  </section>
);

export const BasemapBadge: React.FC<{ info: BasemapInfo }> = ({ info }) => (
  <div className={`basemap ${info.mode}`} role="status">
    {info.mode === 'loading' && 'Đang tải bản đồ nền…'}
    {info.mode === 'satellite' && <>Bản đồ nền (zoom {info.zoom}, {info.loaded}/{info.total} ô). {info.attribution}</>}
    {info.mode === 'offline' && <>Chế độ ngoại tuyến: {info.attribution}. Ranh giới ruộng và vị trí máy vẫn là dữ liệu thật.</>}
  </div>
);
