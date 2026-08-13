// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

export type UserRole =
  | 'REPORTER'
  | 'DISPATCHER'
  | 'FIELD_TEAM'
  | 'RESOURCE_MANAGER'
  | 'PLATFORM_ADMIN'
  // Legacy aliases for backward compatibility with twin3d
  | 'COORDINATOR'
  | 'FARMER'
  | 'OPERATOR'
  | 'MACHINE_OWNER'
  | 'REPAIR_TEAM';

export type FloodPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT' | 'CRITICAL' | string;

export type DispatchOrderStatus =
  | 'CONFIRMED'
  | 'DISPATCHED'
  | 'EN_ROUTE'
  | 'ON_SCENE'
  | 'IN_PROGRESS'
  | 'IMPACTED'
  | 'SUPERSEDED'
  | 'RESOLVED'
  | 'COMPLETED'
  | 'CANCELLED'
  | string;

export interface UserAccount {
  user_id: string;
  username: string;
  full_name: string;
  role: UserRole;
  organization_id: string;
  organization_name?: string;
  email?: string;
}

// ----------------------------------------------------------------------------
// FloodOS Core Domain Models
// ----------------------------------------------------------------------------

export interface FloodZone {
  zone_id: string;
  organization_id: string;
  name: string;
  risk_level: 'CRITICAL' | 'WARNING' | 'WATCH' | 'NORMAL' | string;
  water_level_cm?: number | null;
  water_level_source?: string;
  water_level_updated_at?: string;
  polygon: number[][][];
  center_lat: number;
  center_lng: number;
  data_origin: string;
  visibility?: 'FULL' | 'FOG_OF_WAR';
}

export interface RescueTeam {
  team_id: string;
  organization_id: string;
  lead_user_id: string;
  name: string;
  team_name?: string;
  leader_name?: string;
  specialty?: string;
  member_count: number;
  skills: string[];
  rating: number;
  status: 'AVAILABLE' | 'READY' | 'ON_MISSION' | 'STANDBY' | string;
}

export interface RescueVehicle {
  vehicle_id: string;
  organization_id: string;
  manager_user_id: string;
  name: string;
  vehicle_name?: string;
  vehicle_type: 'RESCUE_BOAT' | 'HIGH_CLEARANCE_TRUCK' | 'MOBILE_PUMP' | string;
  capacity_value: number;
  capacity_unit: string;
  status: 'IDLE' | 'AVAILABLE' | 'DISPATCHED' | 'WORKING' | 'BREAKDOWN' | 'MAINTENANCE' | 'OFFLINE' | string;
  fuel_pct: number;
  fuel_percent?: number;
  health_pct: number;
  health_percent?: number;
  current_lat: number;
  current_lng: number;
  assigned_team_id?: string;
  telemetry_updated_at?: string;
  telemetry_source?: 'SEED' | 'SIMULATOR' | 'DEVICE' | string;
  position_is_simulated?: boolean;
  visibility?: 'FULL' | 'FOG_OF_WAR' | 'PARTIAL';
}

export interface FloodReport {
  report_id: string;
  organization_id: string;
  zone_id: string;
  reporter_user_id: string;
  channel: string;
  lat: number;
  lng: number;
  latitude?: number;
  longitude?: number;
  depth_cm: number;
  flood_depth_cm?: number;
  depth_source?: string;
  need_type: 'EVACUATION' | 'MEDICAL' | 'FOOD_WATER' | 'PUMPING' | 'ROAD_BLOCKED' | string;
  people_affected: number;
  people_count?: number;
  description: string;
  notes?: string;
  address_hint?: string;
  reporter_name?: string;
  reporter_phone?: string;
  priority: FloodPriority;
  status: 'RECEIVED' | 'VERIFIED' | 'DISPATCHED' | 'IN_PROGRESS' | 'RESOLVED' | 'CANCELLED' | string;
  verified_by_user_id?: string | null;
  verification_note?: string | null;
  evidence_object_key?: string | null;
  bpmn_process_id?: string;
  correlation_id?: string;
  created_at: string;
  updated_at?: string;
}

export interface DispatchOrder {
  order_id: string;
  organization_id: string;
  report_id: string;
  zone_id: string;
  vehicle_id: string;
  team_id: string;
  start_time: string;
  end_time: string;
  status: DispatchOrderStatus;
  progress_pct: number;
  replaces_order_id?: string | null;
  superseded_by_order_id?: string | null;
  correlation_id: string;
  created_by?: string;
  created_at: string;
  updated_at?: string;
  dispatched_at?: string;
  notes?: string;
  // Enriched fields from backend
  zone_name?: string;
  zone_lat?: number;
  zone_lng?: number;
  vehicle_name?: string;
  vehicle_lat?: number;
  vehicle_lng?: number;
  vehicle_position_is_simulated?: boolean;
  team_name?: string;
}

export interface CandidateRescueOption {
  option_id: string;
  vehicle_id: string;
  replacement_vehicle_id?: string;
  vehicle_name?: string;
  team_id: string;
  team_name?: string;
  distance_km: number;
  distance_kind?: string;
  suitability: number;
  capacity_fit: number;
  score: number;
  rank?: number;
  eta_minutes?: number;
  reason?: string;
  position_is_simulated?: boolean;
  explanations?: string[];
  explanation?: string;
  operator_name?: string;
  machine_name?: string;
  operator_id?: string;
  machine_id?: string;
  capacity_ha_per_hr?: number;
  operator_rating?: number;
  start_time?: string;
  end_time?: string;
}

export interface FieldIncident {
  incident_id: string;
  organization_id: string;
  vehicle_id: string;
  reported_by_user_id: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | string;
  incident_type: 'PROPELLER_FOULED' | 'ENGINE_OVERHEAT' | 'ENGINE_FAILURE' | 'PUMP_CLOGGED' | 'HULL_DAMAGE' | 'ROAD_IMPASSABLE' | string;
  description: string;
  estimated_downtime_hours: number;
  evidence_object_key?: string | null;
  evidence_etag?: string | null;
  repair_ticket_id?: string | null;
  assigned_repair_user_id?: string | null;
  status: 'OPEN_REPLANNING' | 'REPORTED' | 'IN_PROGRESS' | 'REPLAN_APPROVED' | 'UNDER_REPAIR' | 'RESOLVED' | string;
  bpmn_process_id?: string;
  impacted_order_ids?: string[];
  candidate_options?: CandidateRescueOption[];
  replan_candidates?: CandidateRescueOption[];
  selected_option?: CandidateRescueOption | null;
  correlation_id: string;
  created_at: string;
  reported_at?: string;
  location?: { lat: number; lng: number };
  // legacy aliases
  machine_id?: string;
  reported_by_operator_id?: string;
  impacted_assignment_ids?: string[];
  selected_option_id?: string;
  evidence_s3_key?: string;
}

export interface ReportResolution {
  resolution_id: string;
  organization_id: string;
  report_id: string;
  order_id: string;
  outcome: string;
  final_depth_cm?: number | null;
  evidence_object_key?: string | null;
  field_submitted_by?: string;
  confirmed_by?: string | null;
  confirmation_status: 'PENDING' | 'CONFIRMED' | 'DISPUTED' | string;
  notes?: string;
  correlation_id: string;
  confirmed_at?: string | null;
  created_at: string;
}

export interface SafeShelter {
  shelter_id: string;
  organization_id: string;
  name: string;
  shelter_name?: string;
  address?: string;
  capacity: number;
  occupancy: number;
  current_occupancy?: number;
  occupancy_source: string;
  lat: number;
  lng: number;
  status: 'OPEN' | 'ACTIVE' | 'FULL' | 'CLOSED' | string;
  contact_phone?: string;
  updated_at: string;
}

export interface GaugeStation {
  station_id: string;
  organization_id: string;
  zone_id: string;
  name: string;
  station_name?: string;
  river_stream?: string;
  lat: number;
  lng: number;
  warn_level_cm: number;
  warning_level_cm?: number;
  critical_level_cm: number;
  level_cm?: number | null;
  water_level_cm?: number | null;
  battery_pct?: number;
  last_telemetry_at?: string;
  level_updated_at?: string | null;
  alert_state: 'NORMAL' | 'WATCH' | 'WARNING' | 'CRITICAL' | 'DANGER' | 'UNKNOWN' | string;
  source: string;
  is_simulated?: boolean;
}

export interface BpmnProcessInstance {
  process_instance_id: string;
  definition_key: string;
  business_key: string;
  current_task_name: string;
  current_step_name?: string;
  current_step_definition_id?: string;
  candidate_group: string;
  status: 'ACTIVE' | 'COMPLETED' | string;
  started_at: string;
  variables: Record<string, any>;
}

export interface AuditRecord {
  seq_no: number;
  event_id: string;
  organization_id: string;
  actor_user_id: string;
  actor_role: string;
  action: string;
  entity_type: string;
  entity_id: string;
  correlation_id: string;
  prev_hash: string;
  record_hash: string;
  created_at: string;
  http_status?: number;
  details?: any;
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
  server_time: string;
  data_notice?: string;
  zones: FloodZone[];
  reports: FloodReport[];
  orders: DispatchOrder[];
  teams: RescueTeam[];
  vehicles: RescueVehicle[];
  incidents: FieldIncident[];
  resolutions: ReportResolution[];
  shelters: SafeShelter[];
  gauges: GaugeStation[];
  bpmn_instances: BpmnProcessInstance[];
  audit_logs: AuditRecord[];
  chain_proof?: {
    chain_valid: boolean;
    total_blocks: number;
    latest_hash: string;
    algorithm: string;
  };
  audit_chain_proof?: {
    chain_valid: boolean;
    total_blocks: number;
    latest_hash: string;
    algorithm: string;
  };
  sim_clock?: {
    sim_time: string;
    tick_step_seconds: number;
    is_running: boolean;
  };
  // Backwards compatibility aliases for apps/twin3d
  fields: FieldPlot[];
  machines: HarvesterMachine[];
  service_requests: ServiceRequest[];
  assignments: DispatchAssignment[];
  operators: OperatorProfile[];
  acceptances: any[];
}

// ----------------------------------------------------------------------------
// Backwards Compatibility Aliases (retained for apps/twin3d)
// ----------------------------------------------------------------------------

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
  visibility?: 'FULL' | 'FOG_OF_WAR';
}

export interface HarvesterMachine {
  machine_id: string;
  organization_id: string;
  owner_user_id: string;
  assigned_operator_id?: string;
  name: string;
  model: string;
  machine_type?: string;
  capacity_ha_per_hr: number;
  fuel_pct: number;
  health_pct: number;
  current_lat: number;
  current_lng: number;
  status: string;
  assigned_team_id?: string;
  telemetry_updated_at?: string;
  visibility?: 'FULL' | 'FOG_OF_WAR' | 'PARTIAL';
}

export interface ServiceRequest {
  request_id: string;
  field_id: string;
  farmer_user_id: string;
  requester_user_id?: string;
  area_ha?: number;
  organization_id: string;
  requested_start: string;
  requested_end: string;
  priority: string;
  notes: string;
  status: string;
  created_at: string;
  field_name?: string;
}

export interface DispatchAssignment {
  assignment_id: string;
  request_id: string;
  field_id: string;
  machine_id: string;
  operator_id: string;
  start_time: string;
  end_time: string;
  status: string;
  replaces_assignment_id?: string | null;
  superseded_by_assignment_id?: string | null;
  correlation_id: string;
  created_by_user_id?: string;
  created_at: string;
  field_name?: string;
  machine_name?: string;
  operator_name?: string;
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

export interface MachineIncident extends FieldIncident {}
export interface HarvestAcceptance extends ReportResolution {
  assignment_id?: string;
}
export interface WorkAcceptance extends ReportResolution {
  assignment_id?: string;
}
