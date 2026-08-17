// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React from 'react';
import type { TacticalState, UserAccount } from '../../types';
import { callName, greeting, orgLabel, roleLabel } from '../../utils/labels';
import { FloodOsLogo } from './FloodOsLogo';
import { AlertCircle, Waves, Radio, ShieldCheck, MapPin } from 'lucide-react';

interface Stat {
  icon: string;
  value: number | string;
  label: string;
  tone?: 'alert' | 'good' | 'warn';
}

const INTRO: Record<string, string> = {
  REPORTER: 'Theo dõi tình hình ngập tại khu vực của bạn, gửi tin báo khẩn cấp và nhận hỗ trợ kịp thời.',
  DISPATCHER: 'Tiếp nhận tin báo, xác minh mức độ khẩn cấp, điều động xuồng cứu hộ & trạm bơm, phê duyệt chi viện khi có sự cố.',
  FIELD_TEAM: 'Nhận lệnh tác chiến, cập nhật tiến độ xử lý hiện trường và báo cáo ngay khi phương tiện gặp trục trặc.',
  RESOURCE_MANAGER: 'Theo dõi tình trạng phương tiện (xuồng, máy bơm), tiếp nhận phiếu sửa chữa và quản lý các điểm sơ tán an toàn.',
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
        { icon: '📢', value: reports.length, label: 'tin báo của tôi' },
        { icon: '🚤', value: orders.filter((o) => o.status === 'IN_PROGRESS').length, label: 'đội đang hỗ trợ tôi', tone: 'good' },
        { icon: '🏠', value: shelters.filter((sh) => sh.status === 'OPEN').length, label: 'điểm trú an toàn gần đây' },
      ];
    case 'DISPATCHER':
    case 'COORDINATOR':
      return [
        { icon: '⏳', value: pendingReports, label: 'tin chờ xử lý', tone: pendingReports ? 'warn' : undefined },
        { icon: '🚤', value: activeOrders, label: 'ca cứu hộ đang chạy', tone: 'good' },
        { icon: '⚠️', value: openIncidents, label: 'sự cố phương tiện', tone: openIncidents ? 'alert' : undefined },
        { icon: '🌊', value: warnGauges, label: 'trạm đo báo động', tone: warnGauges ? 'alert' : undefined },
      ];
    case 'FIELD_TEAM':
    case 'OPERATOR':
      return [
        { icon: '📋', value: orders.length, label: 'lệnh được giao' },
        { icon: '🚤', value: activeOrders, label: 'ca đang triển khai', tone: 'good' },
        { icon: '⚠️', value: openIncidents, label: 'sự cố đội gặp phải', tone: openIncidents ? 'alert' : undefined },
      ];
    case 'RESOURCE_MANAGER':
    case 'MACHINE_OWNER':
    case 'REPAIR_TEAM':
      return [
        { icon: '🚤', value: vehicles.length, label: 'tổng số phương tiện' },
        { icon: '🛠️', value: openIncidents, label: 'phương tiện cần sửa', tone: openIncidents ? 'alert' : undefined },
        { icon: '🏠', value: shelters.length, label: 'điểm sơ tán an toàn' },
      ];
    default:
      return [
        { icon: '📢', value: reports.length, label: 'tổng số tin báo' },
        { icon: '🚤', value: vehicles.length, label: 'phương tiện tác chiến' },
        { icon: '🔐', value: s.chain_proof?.total_blocks || s.audit_chain_proof?.total_blocks || 0, label: 'khối kiểm toán SHA-256', tone: 'good' },
      ];
  }
}

export const WelcomeBanner: React.FC<{ user: UserAccount; state: TacticalState }> = ({ user, state }) => {
  const stats = buildStats(user.role, state, user.user_id);
  const intro = INTRO[user.role] || 'Chào mừng bạn đến với Trung tâm Tác chiến FloodOS.';

  return (
    <section
      aria-label="Thông tin tổng quan người dùng"
      className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-sky-950 to-blue-950 p-6 text-white shadow-xl border border-sky-800/50"
    >
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="max-w-2xl">
          <div className="inline-flex items-center gap-2 rounded-full bg-cyan-500/10 px-3 py-1 text-xs font-semibold text-cyan-300 ring-1 ring-cyan-500/30">
            <span>{roleLabel(user.role)}</span>
            <span>·</span>
            <span>{orgLabel(state.auth_context?.organization_name, user.organization_id)}</span>
          </div>

          <h1 className="mt-3 text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
            {greeting(user.full_name, user.username)}
          </h1>
          <p className="mt-1 text-sm sm:text-base leading-relaxed text-slate-300 font-medium">
            {intro}
          </p>

          {/* Transparent Simulation Notice */}
          <div className="mt-3.5 flex items-start gap-2 rounded-xl bg-slate-800/80 p-3 border border-sky-800/40 text-xs text-sky-200">
            <AlertCircle className="h-4 w-4 text-cyan-400 shrink-0 mt-0.5" />
            <div>
              <strong>Minh bạch dữ liệu:</strong> {state.data_notice || 'Dữ liệu demo là mô phỏng: vị trí xe phát từ simulator, trạm đo mực nước mô phỏng, cự ly cứu viện là đường chim bay (Haversine) — không phải tuyến đường thực tế.'}
            </div>
          </div>
        </div>

        {/* Quick Stats Grid */}
        <div className="flex flex-wrap gap-3 sm:gap-4">
          {stats.map((s, idx) => {
            const isAlert = s.tone === 'alert';
            const isGood = s.tone === 'good';
            const isWarn = s.tone === 'warn';
            return (
              <div
                key={idx}
                className={`min-w-[130px] rounded-2xl p-4 shadow-md backdrop-blur border transition ${
                  isAlert
                    ? 'bg-red-950/70 border-red-500/50 text-red-100 ring-2 ring-red-500/30 animate-pulse'
                    : isWarn
                    ? 'bg-amber-950/70 border-amber-500/50 text-amber-100'
                    : isGood
                    ? 'bg-cyan-950/70 border-cyan-500/50 text-cyan-100'
                    : 'bg-slate-800/70 border-slate-700/60 text-slate-100'
                }`}
              >
                <div className="flex items-center justify-between text-xl">
                  <span>{s.icon}</span>
                </div>
                <div className="mt-2 text-2xl font-black tabular-nums tracking-tight">
                  {s.value}
                </div>
                <div className="mt-0.5 text-xs text-slate-300 font-medium">
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
