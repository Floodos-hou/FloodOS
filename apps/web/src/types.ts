// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

export type UserRole = 'COORDINATOR' | 'FARMER' | 'OPERATOR' | 'MACHINE_OWNER' | 'REPAIR_TEAM' | 'PLATFORM_ADMIN';

export interface UserAccount {
  user_id: string;
  username: string;
  full_name: string;
  role: UserRole;
  organization_id: string;
  organization_name?: string;
  email?: string;
}

export interface FieldPlot {
  field_id: string;
  organization_id: string;
  owner_user_id: string;
  owner_name: string;
  name: string;
  hamlet: string;
  crop: string;
  area_ha: number;
  readiness_status: string;
  harvest_progress_pct: number;
  window_start: string;
  window_end: string;
  center_lat: number;
  center_lng: number;
  polygon: number[][][];
  visibility: 'FULL' | 'FOG_OF_WAR';
}

export interface HarvesterMachine {
  machine_id: string;
  organization_id: string;
  owner_user_id: string;
  name: string;
  machine_type: string;
  model: string;
  capacity_ha_per_hr: number;
  status: 'IDLE' | 'WORKING' | 'BREAKDOWN' | 'MAINTENANCE';
  fuel_pct: number;
  health_pct: number;
  current_lat: number;
  current_lng: number;
  assigned_operator_id: string;
  telemetry_updated_at: string;
  visibility: 'FULL' | 'FOG_OF_WAR' | 'PARTIAL';
}

export interface OperatorProfile {
  operator_id: string;
  user_id: string;
  organization_id: string;
  full_name: string;
  skills: string[];
  rating: number;
  status: string;
}

export interface ServiceRequest {
  request_id: string;
  organization_id: string;
  field_id: string;
  requester_user_id: string;
  area_ha: number;
  requested_start: string;
  requested_end: string;
  priority: string;
  status: 'SUBMITTED' | 'PENDING_SCHEDULE' | 'SCHEDULED' | 'IN_PROGRESS' | 'IMPACTED_BY_INCIDENT' | 'RESCHEDULED' | 'WAITING_ACCEPTANCE' | 'COMPLETED' | 'CANCELLED';
  bpmn_process_id: string;
  correlation_id: string;
  notes: string;
  created_at: string;
}

export interface DispatchAssignment {
  assignment_id: string;
  organization_id: string;
  request_id: string;
  field_id: string;
  machine_id: string;
  operator_id: string;
  start_time: string;
  end_time: string;
  status: 'CONFIRMED' | 'IN_PROGRESS' | 'IMPACTED' | 'SUPERSEDED' | 'COMPLETED' | 'CANCELLED';
  replaces_assignment_id?: string;
  superseded_by_assignment_id?: string;
  correlation_id: string;
  created_by_user_id: string;
  created_at: string;
  field_name?: string;
  field_area_ha?: number;
  field_hamlet?: string;
  machine_name?: string;
  operator_name?: string;
}

export interface CandidateRescueOption {
  option_id: string;
  machine_id: string;
  machine_name: string;
  operator_id: string;
  operator_name: string;
  distance_km: number;
  score: number;
  explanation: string;
  start_time: string;
  end_time: string;
}

export interface MachineIncident {
  incident_id: string;
  organization_id: string;
  machine_id: string;
  reporter_user_id: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  incident_type: string;
  description: string;
  estimated_downtime_hours: number;
  evidence_s3_key: string;
  evidence_s3_etag: string;
  repair_ticket_id: string;
  assigned_repair_user_id: string;
  status: 'OPEN_REPLANNING' | 'REPLAN_APPROVED' | 'UNDER_REPAIR' | 'RESOLVED';
  bpmn_process_id: string;
  impacted_assignment_ids: string[];
  candidate_options: CandidateRescueOption[];
  selected_option?: CandidateRescueOption;
  correlation_id: string;
  created_at: string;
}

export interface WorkAcceptance {
  acceptance_id: string;
  organization_id: string;
  assignment_id: string;
  farmer_user_id: string;
  area_ha_accepted: number;
  rating: number;
  notes: string;
  confirmed_at: string;
}

export interface BpmnProcessInstance {
  process_instance_id: string;
  organization_id: string;
  definition_key: string;
  business_key: string;
  current_step_id: string;
  current_step_name: string;
  candidate_group: string;
  status: 'ACTIVE' | 'COMPLETED';
  history: Array<{
    step: string;
    name: string;
    actor: string;
    role: string;
    ts: string;
  }>;
  updated_at: string;
  flowable_instance_id?: string;
}

export interface AuditRecord {
  seq_no: number;
  event_id: string;
  organization_id: string;
  correlation_id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  actor_user_id: string;
  actor_role: string;
  prev_hash: string;
  record_hash: string;
  http_status: number;
  created_at: string;
}

export interface TacticalState {
  auth_context: {
    user_id: string;
    username: string;
    full_name: string;
    role: UserRole;
    organization_id: string;
    organization_name: string;
    rls_policy?: string;
  };
  sim_clock: {
    id: number;
    sim_time: string;
    tick_count: number;
  };
  fields: FieldPlot[];
  machines: HarvesterMachine[];
  operators: OperatorProfile[];
  service_requests: ServiceRequest[];
  assignments: DispatchAssignment[];
  incidents: MachineIncident[];
  acceptances: WorkAcceptance[];
  bpmn_instances: BpmnProcessInstance[];
  audit_logs: AuditRecord[];
  audit_chain_proof: {
    chain_valid: boolean;
    total_blocks: number;
    latest_hash: string;
    algorithm: string;
  };
}
