// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import type { TacticalState, UserAccount, CandidateRescueOption } from '../types';
import { requestJson } from './http';
export { ApiError } from './http';

// In browser, always use relative '/api/v1' so requests are proxied by Nginx/Vite without CORS or PNA issues
const isExplicitRemote = typeof window !== 'undefined' && 
  import.meta.env.VITE_API_GATEWAY_URL && 
  !import.meta.env.VITE_API_GATEWAY_URL.includes('localhost') && 
  !import.meta.env.VITE_API_GATEWAY_URL.includes('127.0.0.1');

const API_BASE = (typeof window !== 'undefined' && !isExplicitRemote)
  ? '/api/v1'
  : (import.meta.env.VITE_API_GATEWAY_URL ? `${import.meta.env.VITE_API_GATEWAY_URL}/api/v1` : '/api/v1');

async function request<T>(
  path: string,
  options: RequestInit = {},
  token?: string | null
): Promise<T> {
  return requestJson<T>(API_BASE, path, options, token);
}

export const api = {
  // --------------------------------------------------------------------------
  // Public Discovery & Demo Accounts
  // --------------------------------------------------------------------------
  async getDemoAccounts(): Promise<{ accounts: UserAccount[] }> {
    return request<{ accounts: UserAccount[] }>('/auth/accounts');
  },

  // --------------------------------------------------------------------------
  // PKCE OAuth 2.0 / OIDC Flow (RFC 7636)
  // --------------------------------------------------------------------------
  async initPkceSession(redirectUri: string, codeChallenge: string, state: string): Promise<{
    authorization_url: string;
    code_challenge: string;
    state: string;
    client_id: string;
  }> {
    const params = new URLSearchParams({ redirect_uri: redirectUri, code_challenge: codeChallenge, state });
    return request(`/auth/pkce/authorize-url?${params.toString()}`);
  },

  async acquirePkceAuthCode(payload: {
    username: string;
    password: string;
    code_challenge: string;
    state?: string;
    redirect_uri?: string;
    client_id?: string;
  }): Promise<{ code: string; state?: string; client_id: string }> {
    return request('/auth/pkce/authorize-code', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async exchangePkceToken(payload: {
    code: string;
    code_verifier: string;
    redirect_uri?: string;
    state?: string;
    client_id?: string;
    username?: string;
  }): Promise<{
    access_token: string;
    id_token?: string;
    token_type: string;
    expires_in: number;
    user: UserAccount;
  }> {
    return request('/auth/pkce/token', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async loginWithCredentials(username: string, password: string): Promise<{
    access_token: string;
    id_token?: string;
    token_type: string;
    expires_in: number;
    user: UserAccount;
  }> {
    return request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  },

  async getUserInfo(token: string): Promise<{ authenticated: boolean; user: UserAccount }> {
    return request('/auth/userinfo', {}, token);
  },

  // --------------------------------------------------------------------------
  // Tactical State (GET /api/v1/state)
  // --------------------------------------------------------------------------
  async getTacticalState(token: string): Promise<TacticalState> {
    const raw = await request<any>('/state', {}, token);
    // Enrich with backwards-compatibility aliases so apps/twin3d functions cleanly
    const zones = raw.zones || [];
    const vehicles = raw.vehicles || [];
    const reports = raw.reports || [];
    const orders = raw.orders || [];
    const teams = raw.teams || [];

    const fields = zones.map((z: any) => ({
      field_id: z.zone_id,
      organization_id: z.organization_id,
      owner_user_id: '',
      owner_name: z.name,
      name: z.name,
      hamlet: 'Địa bàn Hà Nội',
      crop: 'Vùng ngập lụt',
      area_ha: z.polygon && z.polygon[0] ? 1.0 : 0.5,
      readiness_status: z.risk_level === 'CRITICAL' ? 'HARVESTING' : 'GROWING',
      harvest_progress_pct: z.risk_level === 'CRITICAL' ? 80 : 20,
      window_start: '',
      window_end: '',
      center_lat: z.center_lat,
      center_lng: z.center_lng,
      polygon: z.polygon || [],
      visibility: z.visibility || 'FULL',
    }));

    const machines = vehicles.map((v: any) => ({
      machine_id: v.vehicle_id,
      organization_id: v.organization_id,
      owner_user_id: v.manager_user_id,
      name: v.name,
      machine_type: v.vehicle_type,
      model: v.vehicle_type,
      capacity_ha_per_hr: v.capacity_value,
      status: v.status || 'IDLE',
      fuel_pct: v.fuel_pct || 80,
      health_pct: v.health_pct || 95,
      current_lat: v.current_lat,
      current_lng: v.current_lng,
      assigned_operator_id: v.assigned_team_id || '',
      telemetry_updated_at: v.telemetry_updated_at || '',
      visibility: v.visibility || 'FULL',
    }));

    const service_requests = reports.map((r: any) => ({
      request_id: r.report_id,
      organization_id: r.organization_id,
      field_id: r.zone_id,
      requester_user_id: r.reporter_user_id,
      area_ha: 1.0,
      requested_start: r.created_at,
      requested_end: '',
      priority: r.priority,
      status: r.status,
      bpmn_process_id: r.bpmn_process_id,
      correlation_id: r.correlation_id,
      notes: r.description,
      created_at: r.created_at,
    }));

    const assignments = orders.map((o: any) => ({
      assignment_id: o.order_id,
      organization_id: o.organization_id,
      request_id: o.report_id,
      field_id: o.zone_id,
      machine_id: o.vehicle_id,
      operator_id: o.team_id,
      start_time: o.start_time,
      end_time: o.end_time,
      status: o.status,
      replaces_assignment_id: o.replaces_order_id,
      superseded_by_assignment_id: o.superseded_by_order_id,
      correlation_id: o.correlation_id,
      created_by_user_id: o.created_by,
      created_at: o.created_at,
      field_name: o.zone_name,
      machine_name: o.vehicle_name,
      operator_name: o.team_name,
    }));

    const operators = teams.map((t: any) => ({
      operator_id: t.team_id,
      user_id: t.lead_user_id,
      organization_id: t.organization_id,
      full_name: t.name,
      skills: t.skills || [],
      rating: t.rating || 5,
      status: t.status || 'AVAILABLE',
    }));

    return {
      ...raw,
      zones,
      vehicles,
      reports,
      orders,
      teams,
      incidents: raw.incidents || [],
      resolutions: raw.resolutions || [],
      shelters: raw.shelters || [],
      gauges: raw.gauges || [],
      bpmn_instances: raw.bpmn_instances || [],
      audit_logs: raw.audit_logs || [],
      fields,
      machines,
      service_requests,
      assignments,
      operators,
      acceptances: [],
    };
  },

  // --------------------------------------------------------------------------
  // NGSI-LD Digital Twin
  // --------------------------------------------------------------------------
  async getDigitalTwin(token: string): Promise<{ entities: any[] }> {
    return request<{ entities: any[] }>('/digital-twin/entities', {}, token);
  },

  // --------------------------------------------------------------------------
  // FloodOS Core Endpoints
  // --------------------------------------------------------------------------
  async createFloodReport(
    token: string,
    payload: {
      lat: number;
      lng: number;
      depth_cm: number;
      need_type: string;
      people_affected: number;
      description: string;
      zone_id?: string;
      evidence_filename?: string;
      evidence_data_url?: string;
    }
  ) {
    return request<{
      ok: boolean;
      report_id: string;
      zone_id: string;
      zone_match: string;
      bpmn_process_id: string;
      correlation_id: string;
      audit?: any;
    }>('/flood-reports', {
      method: 'POST',
      body: JSON.stringify(payload),
    }, token);
  },

  async verifyFloodReport(
    token: string,
    reportId: string,
    payload: {
      decision?: 'VERIFIED' | 'REJECTED';
      action?: 'VERIFIED' | 'REJECTED';
      priority?: string;
      note?: string;
      verification_note?: string;
    }
  ) {
    const decision = (payload.decision || payload.action || 'VERIFIED').toUpperCase();
    const body: Record<string, any> = { decision };
    if (decision === 'VERIFIED') {
      body.priority = (payload.priority || 'NORMAL').toUpperCase();
    }
    const note = payload.note ?? payload.verification_note;
    if (note !== undefined && note !== null) {
      body.note = note;
    }
    return request(`/flood-reports/${reportId}/verify`, {
      method: 'POST',
      body: JSON.stringify(body),
    }, token);
  },

  async createDispatchOrder(
    token: string,
    payload: {
      report_id: string;
      vehicle_id: string;
      team_id: string;
      start_time: string;
      end_time: string;
    }
  ) {
    return request<{
      ok: boolean;
      order_id: string;
      bpmn_process_id?: string;
      correlation_id: string;
      order: any;
      audit?: any;
    }>('/dispatch-orders', {
      method: 'POST',
      body: JSON.stringify(payload),
    }, token);
  },

  async updateOrderStatus(
    token: string,
    orderId: string,
    payload: {
      status: 'IN_PROGRESS' | 'COMPLETED';
      progress_pct?: number;
      note?: string;
      outcome?: 'RESOLVED' | 'PARTIAL' | 'UNRESOLVED' | string;
      final_depth_cm?: number;
      evidence_filename?: string;
      evidence_data_url?: string;
    }
  ) {
    const body: Record<string, any> = {
      status: payload.status,
      progress_pct: payload.status === 'COMPLETED' ? 100 : (payload.progress_pct ?? 50),
    };
    if (payload.note) body.note = payload.note;
    if (payload.status === 'COMPLETED') {
      body.outcome = (payload.outcome || 'RESOLVED').toUpperCase();
      if (payload.final_depth_cm !== undefined) body.final_depth_cm = payload.final_depth_cm;
      if (payload.evidence_data_url) {
        body.evidence_data_url = payload.evidence_data_url;
        body.evidence_filename = payload.evidence_filename;
      }
    }
    return request(`/dispatch-orders/${orderId}/status`, {
      method: 'POST',
      body: JSON.stringify(body),
    }, token);
  },

  async reportFieldIncident(
    token: string,
    payload: {
      vehicle_id: string;
      severity: string;
      incident_type: string;
      description: string;
      estimated_downtime_hours: number;
      evidence_filename?: string;
      evidence_data_url?: string;
    }
  ) {
    return request<{
      ok: boolean;
      incident_id: string;
      bpmn_process_id: string;
      impacted_order_ids: string[];
      candidate_options: CandidateRescueOption[];
      no_feasible_option?: boolean;
      audit?: any;
    }>('/field-incidents', {
      method: 'POST',
      body: JSON.stringify(payload),
    }, token);
  },

  async approveReplan(
    token: string,
    incidentId: string,
    payload: {
      option_id: string;
    }
  ) {
    return request(`/field-incidents/${incidentId}/approve-replan`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }, token);
  },

  async updateRepairTicket(
    token: string,
    incidentId: string,
    payload: {
      diagnosis?: string;
      is_resolved?: boolean;
      action?: 'IN_PROGRESS' | 'RESOLVED' | string;
      notes?: string;
    }
  ) {
    const isResolved = payload.is_resolved !== undefined
      ? payload.is_resolved
      : (payload.action === 'RESOLVED');
    const diagnosis = payload.diagnosis || payload.notes || 'Đã kiểm tra và xử lý kỹ thuật phương tiện.';
    const body = {
      diagnosis,
      is_resolved: isResolved,
    };
    return request(`/field-incidents/${incidentId}/repair-ticket`, {
      method: 'POST',
      body: JSON.stringify(body),
    }, token);
  },

  async confirmResolution(
    token: string,
    payload: {
      resolution_id?: string;
      decision: 'CONFIRMED' | 'DISPUTED';
      notes?: string;
      assignment_id?: string; // legacy fallback
    }
  ) {
    const resolutionId = payload.resolution_id || (payload.assignment_id ? `RES-${payload.assignment_id}` : '');
    const body: Record<string, any> = {
      resolution_id: resolutionId,
      decision: payload.decision,
    };
    if (payload.notes) body.notes = payload.notes;
    return request('/resolutions', {
      method: 'POST',
      body: JSON.stringify(body),
    }, token);
  },

  async updateShelterOccupancy(
    token: string,
    shelterId: string,
    payload: {
      occupancy: number;
    }
  ) {
    return request(`/shelters/${shelterId}/occupancy`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }, token);
  },

  async verifyAuditChain(token: string) {
    return request('/audit/verify', {}, token);
  },

  async getLineage(token: string, correlationId: string) {
    return request<any>(`/audit/lineage/${correlationId}`, {}, token);
  },

  async simReset(token: string) {
    return request('/sim/reset', { method: 'POST', body: '{}' }, token);
  },

  async simTick(token: string) {
    // Stub for UI simulation clock tick
    return { ok: true };
  },

  // --------------------------------------------------------------------------
  // Backward-compatibility wrappers for legacy code & twin3d
  // --------------------------------------------------------------------------
  async createRequest(
    token: string,
    payload: {
      field_id: string;
      requested_start: string;
      requested_end: string;
      priority: string;
      notes: string;
    }
  ) {
    return this.createFloodReport(token, {
      lat: 20.9662,
      lng: 105.8714,
      depth_cm: 50,
      need_type: 'EVACUATION',
      people_affected: 4,
      description: payload.notes || 'Cần hỗ trợ ngập lụt',
      zone_id: payload.field_id,
    });
  },

  async dispatchAssignment(
    token: string,
    payload: {
      request_id: string;
      field_id?: string;
      machine_id: string;
      operator_id: string;
      start_time: string;
      end_time: string;
    }
  ) {
    return this.createDispatchOrder(token, {
      report_id: payload.request_id,
      vehicle_id: payload.machine_id,
      team_id: payload.operator_id,
      start_time: payload.start_time,
      end_time: payload.end_time,
    });
  },

  async updateAssignmentStatus(
    token: string,
    asgId: string,
    payload: { status: 'IN_PROGRESS' | 'COMPLETED'; progress_pct?: number; note?: string }
  ) {
    return this.updateOrderStatus(token, asgId, {
      status: payload.status,
      progress_pct: payload.progress_pct,
      outcome: 'COMPLETED',
      final_depth_cm: 10,
    });
  },

  async reportIncident(
    token: string,
    payload: {
      machine_id: string;
      severity: string;
      incident_type: string;
      description: string;
      estimated_downtime_hours: number;
      evidence_filename?: string;
      evidence_data_url?: string;
    }
  ) {
    return this.reportFieldIncident(token, {
      vehicle_id: payload.machine_id,
      severity: payload.severity,
      incident_type: payload.incident_type || 'PROPELLER_FOULED',
      description: payload.description,
      estimated_downtime_hours: payload.estimated_downtime_hours,
      evidence_filename: payload.evidence_filename,
      evidence_data_url: payload.evidence_data_url,
    });
  },

  async updateRepair(
    token: string,
    incidentId: string,
    payload: { diagnosis?: string; is_resolved?: boolean }
  ) {
    return this.updateRepairTicket(token, incidentId, {
      action: payload.is_resolved ? 'RESOLVED' : 'IN_PROGRESS',
      notes: payload.diagnosis || 'Đã sửa chữa',
    });
  },

  async confirmAcceptance(
    token: string,
    payload: {
      assignment_id: string;
      action?: string;
      rating?: number;
      notes?: string;
    }
  ) {
    return this.confirmResolution(token, {
      decision: 'CONFIRMED',
      notes: payload.notes || 'Xác nhận an toàn',
      assignment_id: payload.assignment_id,
    });
  },
};
