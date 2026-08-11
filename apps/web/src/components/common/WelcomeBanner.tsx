// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React from 'react';
import type { TacticalState, UserAccount } from '../../types';
import { callName, greeting, orgLabel, roleLabel } from '../../utils/labels';
import { FloodOsLogo } from './FloodOsLogo';

interface Stat { icon: string; value: number | string; label: string; tone?: 'alert' }

const INTRO: Record<string, string> = {
  FARMER: 'Theo dõi ruộng của bác và gọi máy gặt ngay tại đây.',
  COORDINATOR: 'Xếp lịch máy gặt cho xã viên và xử lý khi có máy hỏng.',
  OPERATOR: 'Xem ca làm việc hôm nay và báo cáo khi máy gặp sự cố.',
  MACHINE_OWNER: 'Theo dõi tình trạng và lịch làm việc của máy nhà mình.',
  REPAIR_TEAM: 'Xem các máy đang chờ sửa và cập nhật tiến độ.',
  PLATFORM_ADMIN: 'Giám sát toàn bộ hệ thống.',
};

function buildStats(role: string, s: TacticalState, userId: string): Stat[] {
  const openIncidents = s.incidents.filter((i) => i.status !== 'RESOLVED').length;
  const waiting = s.service_requests.filter((r) => r.status === 'SUBMITTED' || (r.status as string) === 'PENDING_SCHEDULE').length;
  const working = s.machines.filter((m) => m.status === 'WORKING').length;
  switch (role) {
    case 'FARMER':
      return [
        { icon: '🌾', value: s.fields.length, label: 'thửa ruộng của tôi' },
        { icon: '📋', value: s.service_requests.filter((r) => r.status !== 'COMPLETED' && (r.status as string) !== 'CANCELLED').length, label: 'yêu cầu đang theo dõi' },
        { icon: '🚜', value: s.assignments.filter((a) => a.status === 'IN_PROGRESS').length, label: 'máy đang gặt giúp tôi' },
      ];
    case 'COORDINATOR':
      return [
        { icon: '⏳', value: waiting, label: 'yêu cầu chờ xếp lịch' },
        { icon: '🚜', value: working, label: 'máy đang làm việc' },
        { icon: '⚠️', value: openIncidents, label: 'sự cố đang xử lý', tone: openIncidents ? 'alert' : undefined },
      ];
    case 'OPERATOR': {
      const me = s.operators.find((o) => o.user_id === userId);
      const mine = me ? s.assignments.filter((a) => a.operator_id === me.operator_id && a.status !== 'SUPERSEDED') : [];
      return [
        { icon: '📅', value: mine.length, label: 'ca được giao' },
        { icon: '🚜', value: mine.filter((a) => a.status === 'IN_PROGRESS').length, label: 'ca đang làm' },
        { icon: '✅', value: mine.filter((a) => a.status === 'COMPLETED').length, label: 'ca đã xong' },
      ];
    }
    case 'MACHINE_OWNER': {
      const own = s.machines.filter((m) => m.owner_user_id === userId);
      const broken = own.filter((m) => m.status === 'BREAKDOWN').length;
      return [
        { icon: '🚜', value: own.length, label: 'máy của tôi' },
        { icon: '🟢', value: own.filter((m) => m.status === 'WORKING' || m.status === 'IDLE').length, label: 'máy hoạt động tốt' },
        { icon: '🔴', value: broken, label: 'máy đang hỏng', tone: broken ? 'alert' : undefined },
      ];
    }
    case 'REPAIR_TEAM':
      return [
        { icon: '🛠️', value: s.incidents.filter((i) => i.status === 'UNDER_REPAIR' || i.status === 'REPLAN_APPROVED').length, label: 'máy đang sửa' },
        { icon: '⚠️', value: s.incidents.filter((i) => i.status === 'OPEN_REPLANNING').length, label: 'sự cố mới', tone: 'alert' },
        { icon: '✅', value: s.incidents.filter((i) => i.status === 'RESOLVED').length, label: 'đã khắc phục' },
      ];
    default:
      return [
        { icon: '🌾', value: s.fields.length, label: 'thửa ruộng' },
        { icon: '🚜', value: s.machines.length, label: 'máy' },
        { icon: '⚠️', value: openIncidents, label: 'sự cố' },
      ];
  }
}

export const WelcomeBanner: React.FC<{ user: UserAccount; state: TacticalState | null }> = ({ user, state }) => {
  const stats = state ? buildStats(user.role, state, user.user_id) : [];
  return (
    <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-800 via-emerald-700 to-emerald-600 text-white shadow-xl ring-1 ring-emerald-900/20">
      {/* Decorative Brand Logo Watermark */}
      <div className="pointer-events-none absolute -bottom-10 -right-10 opacity-10 select-none" aria-hidden="true">
        <FloodOsLogo size={220} />
      </div>
      <div className="relative z-10 flex flex-col gap-6 p-6 sm:p-8 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="text-lg font-semibold text-amber-200">{greeting()} 👋</p>
          <h1 className="mt-1 break-words text-3xl font-bold sm:text-4xl">{callName(user.full_name)}</h1>
          <p className="mt-2 text-lg text-emerald-50">{INTRO[user.role] ?? ''}</p>
          <p className="mt-3 inline-flex flex-wrap items-center gap-2 text-base text-emerald-100">
            <span className="rounded-full bg-white/15 px-3 py-1 font-semibold">{roleLabel(user.role)}</span>
            <span className="rounded-full bg-white/15 px-3 py-1">{orgLabel(state?.auth_context?.organization_name || user.organization_name, user.organization_id)}</span>
          </p>
        </div>
        {stats.length > 0 && (
          <ul className="grid grid-cols-3 gap-3 sm:gap-4">
            {stats.map((st) => (
              <li key={st.label} className={`min-w-[6.5rem] rounded-2xl p-4 text-center shadow-md ${st.tone === 'alert' ? 'bg-red-50 text-red-900 ring-2 ring-red-400' : 'bg-white text-emerald-950'}`}>
                <div className="text-2xl" aria-hidden="true">{st.icon}</div>
                <div className="font-display text-4xl font-bold leading-tight">{st.value}</div>
                <div className="mt-1 text-sm font-semibold leading-snug">{st.label}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
};
