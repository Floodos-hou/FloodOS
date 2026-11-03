// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { COLOR, gaugeSpec, markerClassName, markerInnerHtml, reportSpec, shelterSpec, vehicleSpec, type MarkerSpec } from './mapIcons';

/** Draws the same spec the map draws, so the legend always matches the markers. Markup is built from constants only. */
const Swatch: React.FC<{ spec: MarkerSpec }> = ({ spec }) => {
  const still = { ...spec, pulse: false };
  return (
    <span
      className={markerClassName(still, 'fo-static')}
      style={{ ['--pin' as string]: spec.color }}
      dangerouslySetInnerHTML={{ __html: markerInnerHtml(still) }}
    />
  );
};

const Item: React.FC<{ spec: MarkerSpec; text: string }> = ({ spec, text }) => (
  <li className="flex items-center gap-2"><Swatch spec={spec} /><span>{text}</span></li>
);

const Group: React.FC<{ title: string; hint?: string; children: React.ReactNode }> = ({ title, hint, children }) => (
  <section>
    <h4 className="eyebrow mb-1.5">{title}</h4>
    <ul className="space-y-1.5">{children}</ul>
    {hint && <p className="mt-1.5 text-[11px] leading-snug text-ink-3">{hint}</p>}
  </section>
);

const Line: React.FC<{ swatch: React.ReactNode; text: string }> = ({ swatch, text }) => (
  <li className="flex items-center gap-2"><span className="flex w-[26px] flex-none justify-center">{swatch}</span><span>{text}</span></li>
);

const zoneBox = (color: string) => <span className="block h-4 w-5 rounded-[2px] border-2 border-dashed" style={{ borderColor: color, background: `color-mix(in srgb, ${color} 22%, transparent)` }} />;

const needs = (need: string, status = 'IN_PROGRESS', priority = 'NORMAL') => reportSpec({ need_type: need, status, priority, depth_cm: null });

export const MapLegend: React.FC<{ defaultOpen?: boolean }> = ({ defaultOpen = true }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-line bg-sheet text-xs text-ink-2">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center justify-between px-3 py-2.5 text-left font-semibold text-ink hover:bg-sheet-2">
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>Chú thích</span>
          {!open && (
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1 font-normal text-ink-2">
              <span className="flex items-center gap-1"><Swatch spec={needs('EVACUATION', 'VERIFIED', 'URGENT')} /> Tin báo</span>
              <span className="flex items-center gap-1"><Swatch spec={vehicleSpec({ vehicle_type: 'RESCUE_BOAT', status: 'IDLE' })} /> Xe</span>
              <span className="flex items-center gap-1"><Swatch spec={shelterSpec({ capacity: 100, occupancy: 35 })} /> Điểm trú</span>
              <span className="flex items-center gap-1"><Swatch spec={gaugeSpec({ alert_state: 'WARNING', level_cm: 100 })} /> Trạm đo</span>
              <span className="text-ink-3">(bấm để xem đầy đủ)</span>
            </span>
          )}
        </span>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? '' : '-rotate-90'}`} aria-hidden="true" />
      </button>
      {open && (
        <div className="grid max-h-56 gap-x-6 gap-y-4 overflow-y-auto px-3 pb-3 pt-1" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
          <Group title="Tin báo ngập (tròn có vòng sáng)" hint="Hình bên trong là loại nhu cầu. Số bên cạnh là độ ngập (cm) do người báo ước lượng. Vòng nhấp nháy là khẩn cấp.">
            <Item spec={needs('EVACUATION')} text="Cần sơ tán" />
            <Item spec={needs('MEDICAL')} text="Cần cứu thương" />
            <Item spec={needs('FOOD_WATER')} text="Cần tiếp tế lương thực, nước" />
            <Item spec={needs('PUMPING')} text="Cần bơm tiêu úng" />
            <Item spec={needs('ROAD_BLOCKED')} text="Đường bị ngập, chặn" />
          </Group>

          <Group title="Màu của tin báo">
            <Item spec={needs('EVACUATION', 'VERIFIED', 'URGENT')} text="Khẩn cấp" />
            <Item spec={needs('EVACUATION', 'RECEIVED')} text="Mới gửi, chờ xác minh" />
            <Item spec={needs('EVACUATION', 'VERIFIED')} text="Đã xác minh / đang xử lý" />
            <Item spec={needs('EVACUATION', 'RESOLVED')} text="Đã xong hoặc đã từ chối" />
          </Group>

          <Group title="Phương tiện (tròn nhỏ)" hint="Hình trong vòng là loại xe; màu là tình trạng.">
            <Item spec={vehicleSpec({ vehicle_type: 'RESCUE_BOAT', status: 'IDLE' })} text="Xuồng cứu hộ, đang rảnh" />
            <Item spec={vehicleSpec({ vehicle_type: 'HIGH_CLEARANCE_TRUCK', status: 'WORKING' })} text="Xe gầm cao, đang làm nhiệm vụ" />
            <Item spec={vehicleSpec({ vehicle_type: 'MOBILE_PUMP', status: 'IDLE' })} text="Máy bơm di động" />
            <Item spec={vehicleSpec({ vehicle_type: 'RESCUE_BOAT', status: 'BREAKDOWN' })} text="Hỏng, không dùng được" />
            <Item spec={vehicleSpec({ vehicle_type: 'RESCUE_BOAT', status: 'MAINTENANCE' })} text="Đang bảo dưỡng" />
          </Group>

          <Group title="Điểm trú an toàn (tròn có thanh)" hint="Thanh dưới biểu tượng là mức đầy của điểm trú.">
            <Item spec={shelterSpec({ capacity: 100, occupancy: 35 })} text="Còn nhiều chỗ" />
            <Item spec={shelterSpec({ capacity: 100, occupancy: 88 })} text="Sắp đầy (từ 80%)" />
            <Item spec={shelterSpec({ capacity: 100, occupancy: 100 })} text="Đã đầy" />
          </Group>

          <Group title="Trạm đo mực nước (tròn rỗng)" hint="Hình thước đo; số bên cạnh là mực nước (cm).">
            <Item spec={gaugeSpec({ alert_state: 'NORMAL', level_cm: 40 })} text="Dưới mức báo động" />
            <Item spec={gaugeSpec({ alert_state: 'WATCH', level_cm: 80 })} text="Báo động 1" />
            <Item spec={gaugeSpec({ alert_state: 'WARNING', level_cm: 100 })} text="Báo động 2" />
            <Item spec={gaugeSpec({ alert_state: 'CRITICAL', level_cm: 130 })} text="Báo động 3" />
            <Item spec={gaugeSpec({ alert_state: 'UNKNOWN', level_cm: null })} text="Chưa có số liệu" />
          </Group>

          <Group title="Vùng và đường" hint="Vùng giám sát là dữ liệu thí điểm, không phải bản đồ ngập chính thức.">
            <Line swatch={zoneBox(COLOR.crit)} text="Vùng nguy hiểm" />
            <Line swatch={zoneBox(COLOR.warn)} text="Vùng cảnh báo" />
            <Line swatch={zoneBox(COLOR.watch)} text="Vùng theo dõi" />
            <Line swatch={zoneBox(COLOR.safe)} text="Vùng an toàn" />
            <Line swatch={<span className="block w-6 border-t-[3px] border-dashed border-ink" />} text="Đường chim bay tới xe thay thế" />
            <Line swatch={<span className="block w-6 border-t-2 border-river/60" />} text="Vệt di chuyển của xe" />
          </Group>
        </div>
      )}
    </div>
  );
};
