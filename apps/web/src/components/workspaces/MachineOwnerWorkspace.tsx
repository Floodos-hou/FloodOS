// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React from 'react';
import { HarvesterMachine, DispatchAssignment, MachineIncident } from '../../types';
import { Truck, Fuel, HeartPulse, Wrench } from 'lucide-react';
import { assignmentStatus, incidentStatus, incidentType, machineStatus } from '../../utils/labels';
import { formatLocalDateTime } from '../../utils/dateTime';

interface MachineOwnerWorkspaceProps {
  currentUserId: string;
  machines: HarvesterMachine[];
  assignments: DispatchAssignment[];
  incidents: MachineIncident[];
}

export const MachineOwnerWorkspace: React.FC<MachineOwnerWorkspaceProps> = ({
  currentUserId,
  machines,
  assignments,
  incidents,
}) => {
  const ownedMachines = machines.filter((m) => m.owner_user_id === currentUserId);

  return (
    <div className="space-y-6">

      {/* Owned Machines Cards */}
      {ownedMachines.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-slate-300 bg-white p-8 text-center text-slate-700">
          <h2 className="text-lg font-bold">Chưa có máy nào được gán cho tài khoản này</h2>
          <p className="mt-2 text-sm text-slate-600">Liên hệ quản trị HTX để kiểm tra hồ sơ chủ máy và quyền truy cập.</p>
        </div>
      ) : <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {ownedMachines.map((m) => {
          const machineAssignments = assignments.filter((a) => a.machine_id === m.machine_id);
          const machineIncidents = incidents.filter((i) => i.machine_id === m.machine_id);

          return (
            <div
              key={m.machine_id}
              className="bg-white rounded-xl shadow border border-slate-200 overflow-hidden flex flex-col"
            >
              {/* Card Header */}
              <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-start">
                <div className="flex items-center space-x-3">
                  <div className={`p-2.5 rounded-lg text-white ${
                    m.status === 'BREAKDOWN' ? 'bg-red-600 animate-pulse' : m.status === 'WORKING' ? 'bg-blue-600' : 'bg-emerald-600'
                  }`}>
                    <Truck className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-800 text-base">{m.name}</h3>
                    <div className="text-sm text-slate-500 font-mono">
                      Mã máy: {m.machine_id} | Dòng: {m.model}
                    </div>
                  </div>
                </div>

                <span
                  className={`px-2.5 py-1 rounded-full text-sm font-bold ${
                    m.status === 'BREAKDOWN'
                      ? 'bg-red-100 text-red-800'
                      : m.status === 'WORKING'
                      ? 'bg-blue-100 text-blue-800'
                      : 'bg-emerald-100 text-emerald-800'
                  }`}
                >
                  {machineStatus(m.status).text}
                </span>
              </div>

              {/* Registered machine indicators */}
              <div className="p-4 space-y-4 flex-1">
                <p className="text-xs text-slate-500">Thông số hồ sơ máy · bản ghi lúc {formatLocalDateTime(m.telemetry_updated_at)}</p>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                    <span className="text-sm text-slate-500 block">Gặt được khoảng:</span>
                    <span className="font-bold text-slate-800 text-sm">{m.capacity_ha_per_hr} ha/giờ</span>
                  </div>
                  <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                    <span className="text-sm text-slate-500 block">Thợ lái phụ trách:</span>
                    <span className="font-bold text-blue-700 text-sm">{m.assigned_operator_id}</span>
                  </div>
                </div>

                {/* Fuel & Health Gauges */}
                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between items-center text-sm mb-1">
                      <span className="text-slate-600 flex items-center">
                        <Fuel className="w-3.5 h-3.5 text-amber-500 mr-1" />
                        Dầu còn:
                      </span>
                      <span className="font-bold text-slate-800">{m.fuel_pct}%</span>
                    </div>
                    <div className="w-full bg-slate-200 rounded-full h-2">
                      <div
                        className="bg-amber-500 h-2 rounded-full"
                        style={{ width: `${m.fuel_pct}%` }}
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between items-center text-sm mb-1">
                      <span className="text-slate-600 flex items-center">
                        <HeartPulse className="w-3.5 h-3.5 text-emerald-500 mr-1" />
                        Độ bền của máy:
                      </span>
                      <span className="font-bold text-slate-800">{m.health_pct}%</span>
                    </div>
                    <div className="w-full bg-slate-200 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full ${m.health_pct < 70 ? 'bg-red-500' : 'bg-emerald-500'}`}
                        style={{ width: `${m.health_pct}%` }}
                      />
                    </div>
                  </div>
                </div>

                {/* Recent Incidents / Warnings */}
                {machineIncidents.length > 0 && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm space-y-1">
                    <div className="font-bold text-red-800 flex items-center">
                      <Wrench className="w-3.5 h-3.5 mr-1 text-red-600" />
                      Lịch sử sự cố gần nhất:
                    </div>
                    {machineIncidents.map((inc) => (
                      <div key={inc.incident_id} className="text-red-700 text-sm">
                        • {incidentType(inc.incident_type)} ({incidentStatus(inc.status).text}) - Dự kiến dừng: {inc.estimated_downtime_hours}h
                      </div>
                    ))}
                  </div>
                )}

                {/* Assigned Schedule */}
                <div className="pt-2 border-t border-slate-100">
                  <span className="text-sm font-bold text-slate-500 uppercase tracking-wider block mb-2">
                    Lịch phân công gần nhất:
                  </span>
                  {machineAssignments.length === 0 ? (
                    <div className="text-slate-400 text-sm italic">Máy này chưa có lịch làm việc</div>
                  ) : (
                    <div className="space-y-1 text-sm">
                      {machineAssignments.slice(0, 2).map((a) => (
                        <div key={a.assignment_id} className="flex justify-between items-center p-2 bg-slate-50 rounded">
                          <span className="font-medium text-slate-700">{a.field_name || a.field_id}</span>
                          <span className="font-mono text-sm text-slate-500">{assignmentStatus(a.status).text}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>}
    </div>
  );
};
