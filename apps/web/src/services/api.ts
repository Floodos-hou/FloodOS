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
    return {
      ...raw,
      zones: raw.zones || [],
      vehicles: raw.vehicles || [],
      reports: raw.reports || [],
      orders: raw.orders || [],
      teams: raw.teams || [],
      incidents: raw.incidents || [],
      resolutions: raw.resolutions || [],
      shelters: raw.shelters || [],
      gauges: raw.gauges || [],
      bpmn_instances: raw.bpmn_instances || [],
      audit_logs: raw.audit_logs || [],
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
    const diagnosis = (payload.diagnosis || payload.notes || '').trim();
    if (!diagnosis) throw new Error('Cần ghi rõ kết quả kiểm tra, sửa chữa.');
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
  // AI Tactical Assistant (Summarize, Priority Classification, After-Action)
  // --------------------------------------------------------------------------
  async getReportAiSummary(token: string, reportId: string): Promise<{
    report_id: string;
    summary_text: string;
    current_status: string;
    timeline: string[];
    suggested_actions: string[];
    engine: string;
    generated_at: string;
  }> {
    return request(`/flood-reports/${reportId}/ai-summary`, {}, token);
  },

  async classifyPriority(token: string, payload: {
    description: string;
    depth_cm?: number;
    people_affected?: number;
    need_type?: string;
    location_hint?: string;
  }): Promise<{
    suggested_priority: 'CRITICAL' | 'URGENT' | 'HIGH' | 'NORMAL' | 'LOW';
    confidence: number;
    reasoning: string;
    key_factors: string[];
    engine: string;
    generated_at: string;
  }> {
    return request('/ai/classify-priority', {
      method: 'POST',
      body: JSON.stringify(payload),
    }, token);
  },

  async getAfterActionReport(token: string, reportId: string): Promise<{
    report_id: string;
    report_title: string;
    executive_summary: string;
    markdown_content: string;
    engine: string;
    generated_at: string;
  }> {
    return request(`/flood-reports/${reportId}/after-action-report`, {}, token);
  },
};
