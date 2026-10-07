// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React from 'react';
import { X } from 'lucide-react';
import type { FloodReport, RescueVehicle, FloodZone, SafeShelter, GaugeStation, DispatchOrder, UserRole } from '../../types';
import { needType, vehicleType, zoneRisk, formatLocalDateTime } from '../../utils/labels';
import { reportStages } from '../../utils/caseFlow';
import { reportDepthCm, reportPeopleAffected } from '../../utils/workflowRules';
import { StatusBadge } from '../common/StatusBadge';
import { CaseRiver, GaugeRuler, ageText } from '../ui/kit';

export type MapSelection =
  | { type: 'report'; data: FloodReport }
  | { type: 'vehicle'; data: RescueVehicle }
  | { type: 'zone'; data: FloodZone }
  | { type: 'shelter'; data: SafeShelter }
  | { type: 'gauge'; data: GaugeStation };

export const selectionKey = (s: MapSelection): string => {
  switch (s.type) {
    case 'report': return `report:${s.data.report_id}`;
    case 'vehicle': return `vehicle:${s.data.vehicle_id}`;
    case 'zone': return `zone:${s.data.zone_id}`;
    case 'shelter': return `shelter:${s.data.shelter_id}`;
    case 'gauge': return `gauge:${s.data.station_id}`;
  }
};

interface MapDetailPanelProps {
  selection: MapSelection | null;
  onClose: () => void;
  currentUserRole: UserRole;
  orders: DispatchOrder[];
  zones?: FloodZone[];
  /** opens the dispatcher console on this report so the decision is made in the full form, never with defaults */
  onOpenVerifyModal?: (report: FloodReport) => void;
  onOpenDispatchModal?: (report: FloodReport) => void;
  onOpenIncidentModal?: (vehicle: RescueVehicle) => void;
}

const TITLE: Record<MapSelection['type'], string> = {
  report: 'Tin báo ngập', vehicle: 'Phương tiện', zone: 'Vùng giám sát', shelter: 'Điểm trú an toàn', gauge: 'Trạm đo mực nước',
};

const Row: React.FC<{ k: string; children: React.ReactNode }> = ({ k, children }) => (
  <div className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
    <dt className="text-ink-3">{k}</dt>
    <dd className="text-right font-medium text-ink">{children}</dd>
  </div>
);

const titleOf = (s: MapSelection): string => {
  switch (s.type) {
    case 'report': return s.data.address_hint || s.data.report_id;
    case 'zone': case 'shelter': case 'gauge': case 'vehicle': return s.data.name;
  }
};

export const MapDetailPanel: React.FC<MapDetailPanelProps> = ({
  selection, onClose, currentUserRole, orders, zones = [], onOpenVerifyModal, onOpenDispatchModal, onOpenIncidentModal,
}) => {
  if (!selection) return null;
  const isDispatcher = currentUserRole === 'DISPATCHER' || currentUserRole === 'PLATFORM_ADMIN';

  return (
    <section className="panel flex h-full flex-col overflow-hidden" aria-label={`Chi tiết: ${TITLE[selection.type]}`}>
      <div className="panel-head">
        <div className="min-w-0">
          <div className="eyebrow">{TITLE[selection.type]}</div>
          <h3 className="truncate text-base">{titleOf(selection)}</h3>
        </div>
        <button type="button" onClick={onClose} className="btn btn-ghost !min-h-8 !px-2" aria-label="Đóng chi tiết">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {selection.type === 'report' && (() => {
          const r = selection.data;
          const zone = zones.find((z) => z.zone_id === r.zone_id);
          const order = orders.find((o) => o.report_id === r.report_id && o.status !== 'SUPERSEDED' && o.status !== 'CANCELLED');
          return (
            <>
              <div className="flex flex-wrap gap-1.5">
                <StatusBadge status={r.status} type="report" />
                <StatusBadge status={r.priority} type="priority" />
              </div>
              <CaseRiver stages={reportStages(r.status)} />
              <dl className="rule-y">
                <Row k="Nhu cầu">{needType(r.need_type).text}</Row>
                <Row k="Độ ngập báo cáo">{reportDepthCm(r)} cm <span className="text-xs text-ink-3">(người báo ước lượng)</span></Row>
                <Row k="Người cần hỗ trợ">{reportPeopleAffected(r)} người</Row>
                <Row k="Khu vực">{zone?.name ?? 'Chưa gán khu vực'}</Row>
                <Row k="Gửi lúc">{formatLocalDateTime(r.created_at)} <span className="text-xs text-ink-3">({ageText(r.created_at)})</span></Row>
                {(r.reporter_name || r.reporter_phone) && <Row k="Người báo">{[r.reporter_name, r.reporter_phone].filter(Boolean).join(' · ')}</Row>}
              </dl>
              {(r.description || r.notes) && <p className="rounded border border-line bg-sheet-2 p-2.5 text-sm">{r.description || r.notes}</p>}
              {r.verification_note && <p className="text-xs text-ink-2"><span className="font-semibold">Ghi chú xác minh:</span> {r.verification_note}</p>}
              {order && (
                <div className="rounded border border-line p-2.5 text-sm">
                  <div className="eyebrow mb-1">Lệnh điều phối</div>
                  <div>{order.vehicle_name ?? order.vehicle_id} · {order.team_name ?? order.team_id}</div>
                  <div className="mt-1 flex items-center gap-2"><StatusBadge status={order.status} type="order" /><span className="num text-xs text-ink-3">{order.progress_pct}%</span></div>
                </div>
              )}
              {isDispatcher && r.status === 'RECEIVED' && onOpenVerifyModal && (
                <button type="button" className="btn btn-primary w-full" onClick={() => onOpenVerifyModal(r)}>Mở thẩm định tin báo</button>
              )}
              {isDispatcher && r.status === 'VERIFIED' && onOpenDispatchModal && (
                <button type="button" className="btn btn-primary w-full" onClick={() => onOpenDispatchModal(r)}>Mở lệnh điều phối</button>
              )}
            </>
          );
        })()}

        {selection.type === 'vehicle' && (() => {
          const v = selection.data;
          const fuel = v.fuel_pct ?? v.fuel_percent;
          const health = v.health_pct ?? v.health_percent;
          const order = orders.find((o) => o.vehicle_id === v.vehicle_id && (o.status === 'CONFIRMED' || o.status === 'IN_PROGRESS'));
          return (
            <>
              <div className="flex flex-wrap gap-1.5"><StatusBadge status={v.status} type="vehicle" /></div>
              <dl className="rule-y">
                <Row k="Loại">{vehicleType(v.vehicle_type)}</Row>
                <Row k="Sức chứa">{v.capacity_value} {v.capacity_unit}</Row>
                <Row k="Nhiên liệu">{fuel == null ? 'Chưa có dữ liệu' : `${Math.round(fuel)}%`}</Row>
                <Row k="Tình trạng kỹ thuật">{health == null ? 'Chưa có dữ liệu' : `${Math.round(health)}%`}</Row>
                <Row k="Nguồn vị trí">{v.telemetry_source ?? 'Chưa rõ'}{v.position_is_simulated ? ' (mô phỏng)' : ''}</Row>
                <Row k="Cập nhật">{ageText(v.telemetry_updated_at) ?? 'Chưa có bản ghi'}</Row>
              </dl>
              {order && <p className="text-sm">Đang gắn với lệnh <span className="font-semibold">{order.order_id}</span> ({order.progress_pct}%).</p>}
              {currentUserRole === 'FIELD_TEAM' && onOpenIncidentModal && v.status !== 'BREAKDOWN' && (
                <button type="button" className="btn btn-danger w-full" onClick={() => onOpenIncidentModal(v)}>Báo sự cố phương tiện</button>
              )}
            </>
          );
        })()}

        {selection.type === 'zone' && (() => {
          const z = selection.data;
          return (
            <>
              <div className="flex flex-wrap gap-1.5"><span className={`chip ${zoneRisk(z.risk_level).tone === 'bad' ? 'chip-bad' : zoneRisk(z.risk_level).tone === 'warn' ? 'chip-warn' : zoneRisk(z.risk_level).tone === 'watch' ? 'chip-watch' : 'chip-good'}`}>{zoneRisk(z.risk_level).text}</span></div>
              <GaugeRuler level={z.water_level_cm} source={z.water_level_source} />
              <dl className="rule-y">
                <Row k="Cập nhật mực nước">{ageText(z.water_level_updated_at) ?? 'Chưa có bản ghi'}</Row>
                <Row k="Nguồn dữ liệu vùng">{z.data_origin}</Row>
              </dl>
              <p className="text-xs text-ink-3">Ranh giới vùng là dữ liệu thí điểm do hệ thống nạp sẵn, không phải bản đồ ngập chính thức.</p>
            </>
          );
        })()}

        {selection.type === 'shelter' && (() => {
          const s = selection.data;
          const occ = s.occupancy ?? s.current_occupancy ?? 0;
          const pct = s.capacity > 0 ? Math.min(100, Math.round((occ / s.capacity) * 100)) : 0;
          return (
            <>
              <div className="flex flex-wrap gap-1.5"><StatusBadge status={s.status === 'ACTIVE' ? 'OPEN' : s.status} type="shelter" /></div>
              <div>
                <div className="flex items-baseline justify-between"><span className="num text-lg font-bold">{occ}/{s.capacity}</span><span className="eyebrow">{s.occupancy_source}</span></div>
                <div className="mt-1 h-2 rounded-sm bg-sheet-2 ring-1 ring-line"><div className={`h-full rounded-sm ${pct >= 100 ? 'bg-crit' : pct >= 80 ? 'bg-warn' : 'bg-safe'}`} style={{ width: `${pct}%` }} /></div>
              </div>
              <dl className="rule-y">
                {s.address && <Row k="Địa chỉ">{s.address}</Row>}
                {s.contact_phone && <Row k="Liên hệ">{s.contact_phone}</Row>}
                <Row k="Cập nhật">{ageText(s.updated_at) ?? 'Chưa có bản ghi'}</Row>
              </dl>
            </>
          );
        })()}

        {selection.type === 'gauge' && (() => {
          const g = selection.data;
          const level = g.level_cm ?? g.water_level_cm;
          return (
            <>
              <div className="flex flex-wrap gap-1.5"><StatusBadge status={g.alert_state} type="gauge" /></div>
              <GaugeRuler level={level} warn={g.warn_level_cm ?? g.warning_level_cm} crit={g.critical_level_cm} source={g.source} />
              <dl className="rule-y">
                {g.river_stream && <Row k="Sông / kênh">{g.river_stream}</Row>}
                <Row k="Ngưỡng cảnh báo">{g.warn_level_cm ?? g.warning_level_cm} cm</Row>
                <Row k="Ngưỡng nguy hiểm">{g.critical_level_cm} cm</Row>
                <Row k="Số đo gần nhất">{ageText(g.level_updated_at ?? g.last_telemetry_at) ?? 'Chưa có bản ghi'}</Row>
                {g.battery_pct != null && <Row k="Pin cảm biến">{g.battery_pct}%</Row>}
              </dl>
              {g.is_simulated && <p className="text-xs text-ink-3">Đây là trạm mô phỏng; chưa có cảm biến hay nguồn quan trắc chính thức.</p>}
            </>
          );
        })()}
      </div>
    </section>
  );
};
