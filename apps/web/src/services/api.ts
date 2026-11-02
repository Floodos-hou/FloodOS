// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenAgriOS Contributors

import { TacticalState, UserAccount } from '../types';

const API_BASE = import.meta.env.VITE_API_GATEWAY_URL 
  ? `${import.meta.env.VITE_API_GATEWAY_URL}/api/v1`
  : '/api/v1';

export class ApiError extends Error {
  status: number;
  code: string;
  details?: any;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: any
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  token?: string | null
): Promise<T> {
  const url = `${API_BASE}${path}`;
  const headers = new Headers(options.headers || {});
  
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(url, { ...options, headers });
  
  if (!response.ok) {
    let errorData: any = {};
    try {
      errorData = await response.json();
    } catch {
      errorData = { message: response.statusText };
    }
    throw new ApiError(
      response.status,
      errorData.error || `HTTP_${response.status}`,
      errorData.message || 'Lỗi khi gọi API hệ thống',
      errorData
    );
  }

  return response.json();
}

export const api = {
  // Public Discovery & Demo Accounts
  async getDemoAccounts(): Promise<{ accounts: UserAccount[] }> {
    return request<{ accounts: UserAccount[] }>('/auth/accounts');
  },

  // PKCE OAuth 2.0 / OIDC Flow (RFC 7636)
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

  // Tactical State with PostgreSQL RLS
  async getTacticalState(token: string): Promise<TacticalState> {
    return request<TacticalState>('/state', {}, token);
  },

  // NGSI-LD digital twin: live machine positions fed by MQTT telemetry (roles with fleet access only)
  async getDigitalTwin(token: string): Promise<{ entities: any[] }> {
    return request<{ entities: any[] }>('/digital-twin/entities', {}, token);
  },

  // Service Request (FARMER / COORDINATOR)
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
    return request('/requests', {
      method: 'POST',
      body: JSON.stringify(payload),
    }, token);
  },

  // Dispatch Assignment (COORDINATOR)
  async dispatchAssignment(
    token: string,
    payload: {
      request_id: string;
      field_id: string;
      machine_id: string;
      operator_id: string;
      start_time: string;
      end_time: string;
    }
  ) {
    return request('/assignments', {
      method: 'POST',
      body: JSON.stringify(payload),
    }, token);
  },

  // Update Assignment Status (OPERATOR / COORDINATOR)
  async updateAssignmentStatus(
    token: string,
    asgId: string,
    payload: {
      status: 'IN_PROGRESS' | 'COMPLETED';
      progress_pct?: number;
      note?: string;
    }
  ) {
    return request(`/assignments/${asgId}/status`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }, token);
  },

  // Report Machine Incident (OPERATOR / COORDINATOR)
  async reportIncident(
    token: string,
    payload: {
      machine_id: string;
      severity: string;
      incident_type: string;
      description: string;
      estimated_downtime_hours: number;
      evidence_filename: string;
      evidence_data_url?: string;
    }
  ) {
    return request('/incidents', {
      method: 'POST',
      body: JSON.stringify(payload),
    }, token);
  },

  // Approve BPMN Rescue Replan (COORDINATOR)
  async approveReplan(
    token: string,
    incidentId: string,
    payload: { option_id: string }
  ) {
    return request(`/incidents/${incidentId}/approve-replan`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }, token);
  },

  // Update Repair Ticket (REPAIR_TEAM)
  async updateRepair(
    token: string,
    incidentId: string,
    payload: {
      status?: string;
      diagnosis: string;
      estimated_downtime_hours?: number;
      is_resolved?: boolean;
    }
  ) {
    return request(`/incidents/${incidentId}/repair`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }, token);
  },

  // Confirm Work Acceptance (FARMER / COORDINATOR)
  async confirmAcceptance(
    token: string,
    payload: {
      assignment_id: string;
      action: 'FARMER_CONFIRM';
      rating?: number;
      notes?: string;
    }
  ) {
    return request('/acceptances', {
      method: 'POST',
      body: JSON.stringify(payload),
    }, token);
  },

  // Audit Lineage Trace
  async getLineage(token: string, correlationId: string) {
    return request(`/audit/lineage/${correlationId}`, {}, token);
  },

  // Verify Audit Chain Integrity
  async verifyAuditChain(token: string) {
    return request('/audit/verify', {}, token);
  },

  // Simulation Clock Tick & Reset
  async simTick(token: string) {
    return request('/sim/tick', { method: 'POST', body: '{}' }, token);
  },

  async simReset(token: string) {
    return request('/sim/reset', { method: 'POST', body: '{}' }, token);
  },
};
