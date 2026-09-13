// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React from 'react';
import type { TacticalState, UserAccount } from '../../types';
import { greeting, orgLabel, roleLabel } from '../../utils/labels';
import { AlertCircle, Waves, Radio, ShieldCheck, Clock, Ship, Home, Wrench, AlertTriangle, FileText } from 'lucide-react';

interface Stat {
  icon: React.ComponentType<{ className?: string }>;
  value: number | string;
  label: string;
  tone?: 'alert' | 'good' | 'warn';
}

const INTRO: Record<string, string> = {
  REPORTER: 'Theo dõi tình hình ngập lụt khu vực dân cư, gửi tin báo khẩn cấp và tra cứu các điểm sơ tán an toàn.',
  DISPATCHER: 'Tiếp nhận tin báo, xác minh mức độ khẩn cấp, điều động xuồng cứu hộ & trạm bơm, giải quyết xung đột lịch GiST.',
  FIELD_TEAM: 'Nhận lệnh tác chiến cơ động, cập nhật tiến độ hiện trường và báo cáo ngay khi phương tiện gặp sự cố đứt gãy.',
  RESOURCE_MANAGER: 'Giám sát mức sẵn sàng của phương tiện (xuồng, xe gầm cao, trạm bơm), xử lý phiếu sửa chữa và quản lý sức chứa điểm trú.',
  PLATFORM_ADMIN: 'Giám sát toàn diện hệ thống, kiểm chứng chuỗi băm mật mã SHA-256 và chính sách bảo mật cấp hàng (RLS).',
};

function buildStats(role: string, s: TacticalState, userId: string): Stat[] {
  const reports = s.reports || [];
  const orders = s.orders || [];
  const vehicles = s.vehicles || [];
  const incidents = s.incidents || [];
  const shelters = s.shelters || [];
  const gauges = s.gauges || [];

  const openIncidents = incidents.filter((i) => i.status !== 'RESOLVED').length;
  const pendingReports = reports.filter((r) => r.status === 'RECEIVED' || r.status === 'VERIFIED').length;
  const activeOrders = orders.filter((o) => o.status === 'IN_PROGRESS').length;
  const warnGauges = gauges.filter((g) => g.alert_state === 'WARNING' || g.alert_state === 'CRITICAL').length;

  switch (role) {
    case 'REPORTER':
    case 'FARMER':
      return [
        { icon: FileText, value: reports.length, label: 'Tin báo của tôi' },
        { icon: Ship, value: orders.filter((o) => o.status === 'IN_PROGRESS').length, label: 'Đội đang hỗ trợ', tone: 'good' },
        { icon: Home, value: shelters.filter((sh) => sh.status === 'OPEN').length, label: 'Điểm trú an toàn' },
      ];
    case 'DISPATCHER':
    case 'COORDINATOR':
      return [
        { icon: Clock, value: pendingReports, label: 'Chờ thẩm định', tone: pendingReports ? 'warn' : undefined },
        { icon: Ship, value: activeOrders, label: 'Ca đang cơ động', tone: 'good' },
        { icon: AlertTriangle, value: openIncidents, label: 'Sự cố phương tiện', tone: openIncidents ? 'alert' : undefined },
        { icon: Waves, value: warnGauges, label: 'Trạm đo báo động', tone: warnGauges ? 'alert' : undefined },
      ];
    case 'FIELD_TEAM':
    case 'OPERATOR':
      return [
        { icon: FileText, value: orders.length, label: 'Lệnh phân công' },
        { icon: Ship, value: activeOrders, label: 'Ca đang triển khai', tone: 'good' },
        { icon: AlertTriangle, value: openIncidents, label: 'Sự cố ghi nhận', tone: openIncidents ? 'alert' : undefined },
      ];
    case 'RESOURCE_MANAGER':
    case 'MACHINE_OWNER':
    case 'REPAIR_TEAM':
      return [
        { icon: Ship, value: vehicles.length, label: 'Tổng phương tiện' },
        { icon: Wrench, value: openIncidents, label: 'Phiếu sửa chữa', tone: openIncidents ? 'alert' : undefined },
        { icon: Home, value: shelters.length, label: 'Điểm sơ tán' },
      ];
    default:
      return [
        { icon: FileText, value: reports.length, label: 'Tổng tin báo' },
        { icon: Ship, value: vehicles.length, label: 'Phương tiện tác chiến' },
        { icon: ShieldCheck, value: s.chain_proof?.total_blocks || s.audit_chain_proof?.total_blocks || 0, label: 'Khối SHA-256', tone: 'good' },
      ];
  }
}

export const WelcomeBanner: React.FC<{ user: UserAccount; state: TacticalState }> = ({ user, state }) => {
  const stats = buildStats(user.role, state, user.user_id);
  const intro = INTRO[user.role] || 'Hệ thống điều phối ứng phó ngập lụt và phục hồi đứt gãy FloodOS.';

  return (
    <section
      aria-label="Thông tin chỉ huy"
      className="relative overflow-hidden rounded-2xl bg-slate-900 border border-slate-800 p-5 text-white shadow-xl"
    >
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
        <div className="max-w-xl">
          <div className="inline-flex items-center gap-2 rounded-lg bg-sky-950/80 px-2.5 py-1 text-xs font-mono font-semibold text-sky-300 border border-sky-800/60">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-400"></span>
            <span>{roleLabel(user.role)}</span>
            <span>·</span>
            <span>{orgLabel(state.auth_context?.organization_name, user.organization_id)}</span>
          </div>

          <h1 className="mt-2 text-xl sm:text-2xl font-bold tracking-tight text-white">
            {greeting(user.full_name, user.username)}
          </h1>
          <p className="mt-1 text-xs sm:text-sm leading-relaxed text-slate-300">
            {intro}
          </p>

          <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-400">
            <AlertCircle className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
            <span>Khu vực giám sát thí điểm: <strong>Hà Nội</strong> (Hoàng Mai, Đống Đa, Thanh Trì, Nam Từ Liêm, Tây Hồ).</span>
          </div>
        </div>

        {/* Tactical Status Counters */}
        <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
          {stats.map((s, idx) => {
            const Icon = s.icon;
            const isAlert = s.tone === 'alert';
            const isGood = s.tone === 'good';
            const isWarn = s.tone === 'warn';
            return (
              <div
                key={idx}
                className={`min-w-[110px] sm:min-w-[125px] rounded-xl p-3 border shadow-sm transition ${
                  isAlert
                    ? 'bg-red-950/60 border-red-500/50 text-red-200 ring-1 ring-red-500/30'
                    : isWarn
                    ? 'bg-amber-950/60 border-amber-500/50 text-amber-200'
                    : isGood
                    ? 'bg-sky-950/60 border-sky-500/50 text-sky-200'
                    : 'bg-slate-800/80 border-slate-700/80 text-slate-200'
                }`}
              >
                <div className="flex items-center justify-between">
                  <Icon className={`h-4 w-4 ${isAlert ? 'text-red-400' : isWarn ? 'text-amber-400' : isGood ? 'text-cyan-400' : 'text-slate-400'}`} />
                  <span className="font-mono text-xl font-black tabular-nums">{s.value}</span>
                </div>
                <div className="mt-1 text-[11px] font-medium text-slate-300 leading-tight">
                  {s.label}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
