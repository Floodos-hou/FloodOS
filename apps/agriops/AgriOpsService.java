// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenAgriOS Contributors

package org.openagrios.apps.agriops;

import org.openagrios.core.dataservices.*;
import org.openagrios.core.gateway.ZeroTrustGateway;
import org.openagrios.core.identity.KeycloakOidcEngine;
import org.openagrios.core.identity.KeycloakOidcEngine.AuthContext;
import org.openagrios.core.identity.KeycloakOidcEngine.Organization;
import org.openagrios.core.identity.KeycloakOidcEngine.UserAccount;
import org.openagrios.core.workflow.BpmnWorkflowEngine;
import org.openagrios.apps.agriops.AgriModels.*;
import org.openagrios.apps.agriops.AgriDataStore;

import java.time.Instant;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.*;

/**
 * Agricultural Mechanization Dispatch & Incident Recovery Service (AgriOps Application Module).
 * Orchestrates Tier-1 Core services (`org.openagrios.core.*`).
 */
public final class AgriOpsService {

    public record HttpResult(int status, Map<String, Object> body) {}

    private final AgriDataStore store;

    public AgriOpsService(AgriDataStore store) {
        this.store = store;
    }

    public AgriDataStore getStore() {
        return store;
    }

    private static String nowIso() {
        return Instant.now().truncatedTo(ChronoUnit.SECONDS).toString();
    }

    private static String shortUuid() {
        return UUID.randomUUID().toString().replace("-", "").substring(0, 4).toUpperCase(Locale.ROOT);
    }

    // ------------------------------------------------------------------------
    // 1. IAM / KEYCLOAK OIDC ACCOUNTS & LOGIN (Delegates to Tier 1 Core)
    // ------------------------------------------------------------------------
    public synchronized Map<String, Object> listDemoAccounts() {
        List<UserAccount> sorted = new ArrayList<>(store.usersByUsername.values());
        sorted.sort(Comparator.comparingInt((UserAccount u) -> switch (u.role()) {
            case "COORDINATOR" -> 1;
            case "FARMER" -> 2;
            case "OPERATOR" -> 3;
            case "MACHINE_OWNER" -> 4;
            case "REPAIR_TEAM" -> 5;
            default -> 6;
        }).thenComparing(UserAccount::username));

        List<Map<String, Object>> accounts = new ArrayList<>();
        for (UserAccount u : sorted) {
            Organization org = store.organizations.get(u.organizationId());
            accounts.add(u.toPublicMap(org != null ? org.name() : u.organizationId()));
        }

        Map<String, Object> res = new LinkedHashMap<>();
        res.put("realm", "openagrios");
        res.put("sso_provider", "Keycloak OIDC 24.0");
        res.put("accounts", accounts);
        return res;
    }

    public synchronized HttpResult loginOidc(Map<String, Object> body) {
        String username = String.valueOf(body.getOrDefault("username", "")).trim();
        String password = String.valueOf(body.getOrDefault("password", "")).trim();

        KeycloakOidcEngine.AuthMode currentMode = KeycloakOidcEngine.getActiveAuthMode();

        // --------------------------------------------------------------------
        // 1. KEYCLOAK PRODUCTION MODE: Must authenticate against real Keycloak OIDC
        //    NEVER fall back to mock accounts or mock tokens.
        // --------------------------------------------------------------------
        if (currentMode == KeycloakOidcEngine.AuthMode.KEYCLOAK_PRODUCTION) {
            String keycloakIssuer = System.getenv().getOrDefault("KEYCLOAK_ISSUER", "http://localhost:8080/realms/openagrios");
            Optional<Map<String, Object>> liveToken = KeycloakOidcEngine.tryLiveKeycloakLogin(
                    keycloakIssuer, "agriops-web", username, password
            );

            if (liveToken.isEmpty()) {
                Map<String, Object> err = new LinkedHashMap<>();
                err.put("error", "KEYCLOAK_LOGIN_FAILED");
                err.put("status", 401);
                err.put("message", "Chế độ KEYCLOAK_PRODUCTION: Đăng nhập OIDC thất bại (Sai username/password hoặc máy chủ Keycloak không phản hồi). Tuyệt đối không fallback sang mock token.");
                return new HttpResult(401, err);
            }

            String token = String.valueOf(liveToken.get().get("access_token"));
            Map<String, Object> decoded;
            try {
                decoded = KeycloakOidcEngine.verifyJwt(token);
            } catch (Exception ex) {
                Map<String, Object> err = new LinkedHashMap<>();
                err.put("error", "KEYCLOAK_INTROSPECTION_FAILED");
                err.put("status", 401);
                err.put("message", "Chế độ KEYCLOAK_PRODUCTION: Token phát hành từ Keycloak bị từ chối khi thẩm định: " + ex.getMessage());
                return new HttpResult(401, err);
            }

            String role = "FARMER";
            Object realmAccess = decoded.get("realm_access");
            if (realmAccess instanceof Map<?, ?> rm) {
                Object rolesObj = rm.get("roles");
                if (rolesObj instanceof List<?> roles && !roles.isEmpty()) {
                    role = String.valueOf(roles.get(0));
                }
            }
            String userId = String.valueOf(decoded.getOrDefault("sub", username));
            String orgId = String.valueOf(decoded.getOrDefault("organization_id", "HTX_CANTHO_01"));
            UserAccount liveUser = new UserAccount(userId, username, "******", String.valueOf(decoded.getOrDefault("name", username)), username + "@openagrios.vn", orgId, role);

            Map<String, Object> after = new LinkedHashMap<>();
            after.put("username", liveUser.username());
            after.put("role", liveUser.role());
            after.put("organization_id", liveUser.organizationId());
            after.put("auth_mode", "LIVE_KEYCLOAK_OIDC");

            store.auditLedger.appendRecord(
                    orgId,
                    "CORR-AUTH-" + liveUser.username().toUpperCase(Locale.ROOT),
                    "KeycloakSession",
                    liveUser.userId(),
                    "OIDC_SSO_LOGIN_SUCCESS",
                    liveUser.username(),
                    liveUser.role(),
                    null,
                    after,
                    200
            );

            Map<String, Object> res = new LinkedHashMap<>();
            res.put("access_token", token);
            res.put("token_type", "Bearer");
            res.put("expires_in", 3600);
            res.put("sso_issuer", keycloakIssuer);
            res.put("auth_mode", "LIVE_KEYCLOAK_OIDC");
            res.put("user", liveUser.toPublicMap(store.organizations.containsKey(orgId) ? store.organizations.get(orgId).name() : orgId));
            return new HttpResult(200, res);
        }

        // --------------------------------------------------------------------
        // 2. DEV MOCK STANDALONE MODE: Used exclusively for local offline testing/CI
        //    Issues HS256 tokens signed with process-ephemeral 256-bit key.
        // --------------------------------------------------------------------
        UserAccount user = store.usersByUsername.get(username);
        if (user == null || !user.password().equals(password)) {
            Map<String, Object> err = new LinkedHashMap<>();
            err.put("error", "INVALID_CREDENTIALS");
            err.put("message", "Đăng nhập thất bại: Sai tên đăng nhập hoặc mật khẩu trong bộ dữ liệu demo cục bộ.");
            return new HttpResult(401, err);
        }

        String token = KeycloakOidcEngine.issueDevMockJwt(user);
        Map<String, Object> decoded = KeycloakOidcEngine.verifyJwt(token);
        String authMode = "STANDALONE_DEV_MOCK";

        Map<String, Object> after = new LinkedHashMap<>();
        after.put("username", user.username());
        after.put("role", user.role());
        after.put("organization_id", user.organizationId());
        after.put("auth_mode", authMode);

        store.auditLedger.appendRecord(
                user.organizationId(),
                "CORR-AUTH-" + user.username().toUpperCase(Locale.ROOT),
                "KeycloakSession",
                user.userId(),
                "OIDC_SSO_LOGIN_SUCCESS",
                user.username(),
                user.role(),
                null,
                after,
                200
        );

        Map<String, Object> res = new LinkedHashMap<>();
        res.put("access_token", token);
        res.put("token_type", "Bearer");
        res.put("expires_in", 86400);
        res.put("sso_issuer", KeycloakOidcEngine.DEFAULT_ISSUER);
        res.put("auth_mode", authMode);
        res.put("user", user.toPublicMap(store.organizations.get(user.organizationId()) != null ? store.organizations.get(user.organizationId()).name() : user.organizationId()));
        return new HttpResult(200, res);
    }

    // ------------------------------------------------------------------------
    // 2. TACTICAL STATE WITH POSTGRESQL RLS & ROLE-BASED FOG OF WAR
    // ------------------------------------------------------------------------
    public synchronized Map<String, Object> getTacticalState(AuthContext auth) {
        String orgId = auth.organizationId();
        String role = auth.role();
        String userId = auth.userId();

        Organization org = store.organizations.get(orgId);
        String orgName = org != null ? org.name() : orgId;

        // 1. Fields with Role-Based Fog of War
        List<Map<String, Object>> fieldList = new ArrayList<>();
        Set<String> myFieldIds = new HashSet<>();
        for (FieldPlot f : store.fields.values()) {
            if (!TenantRlsContext.isSameTenant(auth, f.organizationId)) continue;
            if (f.ownerUserId.equals(userId)) {
                myFieldIds.add(f.fieldId);
            }
            String vis = TenantRlsContext.resolveFieldVisibility(auth, f.ownerUserId);
            fieldList.add(f.toMapWithVisibility(vis));
        }

        // 2. Machines with Role-Based Visibility
        String myOpId = "";
        for (OperatorProfile op : store.operators.values()) {
            if (op.userId().equals(userId)) {
                myOpId = op.operatorId();
                break;
            }
        }
        List<Map<String, Object>> machineList = new ArrayList<>();
        for (HarvesterMachine m : store.machines.values()) {
            if (!TenantRlsContext.isSameTenant(auth, m.organizationId)) continue;
            String vis = "FULL";
            if ("MACHINE_OWNER".equals(role) && !m.ownerUserId.equals(userId)) {
                vis = "FOG_OF_WAR";
            } else if ("OPERATOR".equals(role)) {
                vis = myOpId.equals(m.assignedOperatorId) ? "FULL" : "PARTIAL";
            }
            machineList.add(m.toMapWithVisibility(vis));
        }

        // 3. Operators
        List<Map<String, Object>> operatorList = new ArrayList<>();
        for (OperatorProfile op : store.operators.values()) {
            if (TenantRlsContext.isSameTenant(auth, op.organizationId())) {
                operatorList.add(op.toMap());
            }
        }

        // 4. Service Requests (RLS: FARMER only sees their own requests)
        List<Map<String, Object>> requestList = new ArrayList<>();
        for (ServiceRequest sr : store.serviceRequests.values()) {
            if (!TenantRlsContext.isSameTenant(auth, sr.organizationId)) continue;
            if ("FARMER".equals(role) && !sr.requesterUserId.equals(userId)) continue;
            requestList.add(sr.toMap());
        }

        // 5. Assignments
        List<DispatchAssignment> sortedAsg = new ArrayList<>(store.assignments.values());
        sortedAsg.sort(Comparator.comparing(a -> a.startTime));
        List<Map<String, Object>> assignmentList = new ArrayList<>();
        for (DispatchAssignment a : sortedAsg) {
            if (!TenantRlsContext.isSameTenant(auth, a.organizationId)) continue;
            if ("FARMER".equals(role) && !myFieldIds.contains(a.fieldId)) continue;
            FieldPlot f = store.fields.get(a.fieldId);
            HarvesterMachine m = store.machines.get(a.machineId);
            OperatorProfile o = store.operators.get(a.operatorId);
            assignmentList.add(a.toEnrichedMap(f, m, o));
        }

        // 6. Incidents
        List<Map<String, Object>> incidentList = new ArrayList<>();
        List<MachineIncident> allInc = new ArrayList<>(store.incidents.values());
        for (int i = allInc.size() - 1; i >= 0; i--) {
            MachineIncident inc = allInc.get(i);
            if (TenantRlsContext.isSameTenant(auth, inc.organizationId)) {
                incidentList.add(inc.toMap());
            }
        }

        // 7. Acceptances
        List<Map<String, Object>> acceptanceList = new ArrayList<>();
        List<WorkAcceptance> allAcc = new ArrayList<>(store.acceptances.values());
        for (int i = allAcc.size() - 1; i >= 0; i--) {
            WorkAcceptance acc = allAcc.get(i);
            if (TenantRlsContext.isSameTenant(auth, acc.organizationId())) {
                acceptanceList.add(acc.toMap());
            }
        }

        Map<String, Object> authCtxMap = new LinkedHashMap<>();
        authCtxMap.put("user_id", userId);
        authCtxMap.put("username", auth.username());
        authCtxMap.put("full_name", auth.fullName());
        authCtxMap.put("role", role);
        authCtxMap.put("organization_id", orgId);
        authCtxMap.put("organization_name", orgName);
        authCtxMap.put("rls_policy", TenantRlsContext.buildPostgresRlsPolicySql(auth));

        Map<String, Object> clockMap = new LinkedHashMap<>();
        clockMap.put("id", 1);
        clockMap.put("sim_time", store.simTime);
        clockMap.put("tick_count", store.tickCount);

        Map<String, Object> res = new LinkedHashMap<>();
        res.put("auth_context", authCtxMap);
        res.put("sim_clock", clockMap);
        res.put("fields", fieldList);
        res.put("machines", machineList);
        res.put("operators", operatorList);
        res.put("service_requests", requestList);
        res.put("assignments", assignmentList);
        res.put("incidents", incidentList);
        res.put("acceptances", acceptanceList);
        res.put("bpmn_instances", store.bpmnEngine.listByTenant(orgId));
        res.put("bpmn_definitions", store.bpmnEngine.getDefinitions());
        res.put("minio_objects", store.s3Storage.listByTenant(orgId));
        res.put("audit_logs", store.auditLedger.listRecentByTenant(orgId, 25));
        res.put("audit_chain_proof", store.auditLedger.verifyChainIntegrity());
        return res;
    }

    // ------------------------------------------------------------------------
    // 3. ETSI NGSI-LD DIGITAL TWIN ENTITIES
    // ------------------------------------------------------------------------
    public synchronized Map<String, Object> getDigitalTwinEntities(AuthContext auth) {
        List<Map<String, Object>> entities = new ArrayList<>();
        for (HarvesterMachine m : store.machines.values()) {
            if (!TenantRlsContext.isSameTenant(auth, m.organizationId)) continue;
            Map<String, Map<String, Object>> props = new LinkedHashMap<>();
            props.put("organizationId", NgsiLdTwinMapper.toProperty(m.organizationId, null, null));
            props.put("name", NgsiLdTwinMapper.toProperty(m.name, null, null));
            props.put("status", NgsiLdTwinMapper.toProperty(m.status, null, m.telemetryUpdatedAt));
            props.put("capacityHaPerHr", NgsiLdTwinMapper.toProperty(m.capacityHaPerHr, "HAR", null));
            props.put("fuelLevel", NgsiLdTwinMapper.toProperty(m.fuelPct, "P1", null));
            props.put("healthIndex", NgsiLdTwinMapper.toProperty(m.healthPct, "P1", null));

            entities.add(NgsiLdTwinMapper.toNgsiLdEntity(
                    "HarvesterMachine", m.machineId, props, m.currentLng, m.currentLat
            ));
        }
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("protocol", "ETSI NGSI-LD v1");
        res.put("tenant", auth.organizationId());
        res.put("entities", entities);
        return res;
    }

    // ------------------------------------------------------------------------
    // 4. CREATE SERVICE REQUEST (Role: FARMER or COORDINATOR)
    // ------------------------------------------------------------------------
    public synchronized HttpResult createServiceRequest(AuthContext auth, Map<String, Object> body) {
        String fieldId = String.valueOf(body.getOrDefault("field_id", "F07"));
        Map<String, Object> rbacErr = ZeroTrustGateway.enforceRbacPolicy(
                store.auditLedger, auth, List.of("FARMER", "COORDINATOR"),
                "CREATE_SERVICE_REQUEST", "ServiceRequest", fieldId
        );
        if (rbacErr != null) return new HttpResult(403, rbacErr);

        String reqStart = String.valueOf(body.getOrDefault("requested_start", "2026-11-21T13:00:00Z"));
        String reqEnd = String.valueOf(body.getOrDefault("requested_end", "2026-11-21T17:00:00Z"));
        String notes = String.valueOf(body.getOrDefault("notes", "Yêu cầu gặt lúa chín đúng khung giờ"));

        FieldPlot field = store.fields.get(fieldId);
        if (field == null || !TenantRlsContext.isSameTenant(auth, field.organizationId)) {
            return new HttpResult(404, Map.of(
                    "error", "FIELD_NOT_FOUND",
                    "message", "Không tìm thấy vùng " + fieldId + " trong tổ chức của bạn."
            ));
        }

        if ("FARMER".equals(auth.role()) && !field.ownerUserId.equals(auth.userId())) {
            var audit = store.auditLedger.appendRecord(
                    auth.organizationId(), "CORR-RLS-" + fieldId,
                    "Field", fieldId, "RLS_BLOCKED_FOREIGN_FIELD_REQUEST",
                    auth.username(), auth.role(),
                    Map.of("field_owner", field.ownerUserId),
                    Map.of("attempted_by", auth.userId()),
                    403
            );
            Map<String, Object> err = new LinkedHashMap<>();
            err.put("error", "RLS_OWNERSHIP_VIOLATION");
            err.put("message", "Chặn bởi Row-Level Security (RLS): Nông hộ '" + auth.username() + "' không được phép đặt lịch trên vùng '" + fieldId + "' thuộc sở hữu của hộ khác!");
            err.put("audit_event", audit.toSummaryMap());
            return new HttpResult(403, err);
        }

        String reqId = "REQ-" + shortUuid();
        String prcId = "PRC-" + reqId;
        String corrId = "CORR-" + fieldId + "-" + shortUuid();
        String ts = nowIso();

        ServiceRequest sr = new ServiceRequest(
                reqId, auth.organizationId(), fieldId, auth.userId(),
                field.areaHa, reqStart, reqEnd, "HIGH", "PENDING_SCHEDULE",
                prcId, corrId, notes, ts
        );
        store.serviceRequests.put(reqId, sr);

        store.bpmnEngine.startInstance(
                prcId, auth.organizationId(), "service_request_lifecycle", reqId,
                "taskCoordinatorSchedule", "Điều phối viên kiểm tra xung đột & ghép cặp Máy - Người", "COORDINATOR",
                List.of(BpmnWorkflowEngine.makeStepHistory(
                        "startRequest", "Nông hộ " + auth.username() + " tạo yêu cầu " + reqId,
                        auth.username(), auth.role(), ts
                )),
                ts
        );

        Map<String, Object> after = new LinkedHashMap<>();
        after.put("request_id", reqId);
        after.put("field_id", fieldId);
        after.put("area_ha", field.areaHa);
        after.put("status", "PENDING_SCHEDULE");

        var audit = store.auditLedger.appendRecord(
                auth.organizationId(), corrId, "ServiceRequest", reqId,
                "CREATE_SERVICE_REQUEST", auth.username(), auth.role(), null, after, 200
        );

        Map<String, Object> res = new LinkedHashMap<>();
        res.put("ok", true);
        res.put("request_id", reqId);
        res.put("bpmn_process_id", prcId);
        res.put("correlation_id", corrId);
        res.put("audit", audit.toSummaryMap());
        return new HttpResult(201, res);
    }

    // ------------------------------------------------------------------------
    // 5. DISPATCH MACHINE ASSIGNMENT (Role: COORDINATOR ONLY)
    // ------------------------------------------------------------------------
    public synchronized HttpResult dispatchAssignment(AuthContext auth, Map<String, Object> body) {
        String machineId = String.valueOf(body.getOrDefault("machine_id", "M01"));
        Map<String, Object> rbacErr = ZeroTrustGateway.enforceRbacPolicy(
                store.auditLedger, auth, List.of("COORDINATOR"),
                "DISPATCH_MACHINE_ASSIGNMENT", "Assignment", machineId
        );
        if (rbacErr != null) return new HttpResult(403, rbacErr);

        String reqId = String.valueOf(body.getOrDefault("request_id", "REQ-04"));
        String operatorId = String.valueOf(body.getOrDefault("operator_id", "OP-01"));
        String startTime = String.valueOf(body.getOrDefault("start_time", "2026-11-20T08:00:00Z"));
        String endTime = String.valueOf(body.getOrDefault("end_time", "2026-11-20T11:30:00Z"));
        String orgId = auth.organizationId();

        ServiceRequest reqRow = store.serviceRequests.get(reqId);
        if (reqRow == null || !TenantRlsContext.isSameTenant(auth, reqRow.organizationId)) {
            return new HttpResult(404, Map.of("error", "REQUEST_NOT_FOUND", "message", "Không tìm thấy yêu cầu " + reqId + "."));
        }

        HarvesterMachine machine = store.machines.get(machineId);
        boolean machineExists = (machine != null && TenantRlsContext.isSameTenant(auth, machine.organizationId));
        String machineStatus = machineExists ? machine.status : "MISSING";

        Map<String, Object> conflict = ScheduleConflictEngine.checkConflict(
                orgId, machineId, machineStatus, machineExists,
                operatorId, startTime, endTime, null,
                new ArrayList<>(store.assignments.values())
        );

        if (conflict != null) {
            Map<String, Object> before = new LinkedHashMap<>();
            before.put("requested_machine", machineId);
            before.put("requested_operator", operatorId);
            before.put("window", startTime + " -> " + endTime);

            var audit = store.auditLedger.appendRecord(
                orgId, reqRow.correlationId, "Assignment", "CONFLICT-" + machineId,
                "CONFLICT_BLOCKED_" + conflict.get("code"),
                auth.username(), auth.role(), before, conflict, 409
            );

            Map<String, Object> err = new LinkedHashMap<>();
            err.put("error", conflict.get("code"));
            err.put("status", 409);
            err.put("message", conflict.get("message"));
            err.put("conflict_details", conflict);
            err.put("audit_event", audit.toSummaryMap());
            return new HttpResult(409, err);
        }

        String asgId = "ASG-" + shortUuid();
        String ts = nowIso();
        DispatchAssignment asg = new DispatchAssignment(
                asgId, orgId, reqId, reqRow.fieldId, machineId, operatorId,
                startTime, endTime, "CONFIRMED", null, null,
                reqRow.correlationId, auth.userId(), ts
        );
        store.assignments.put(asgId, asg);

        String oldReqStatus = reqRow.status;
        reqRow.status = "SCHEDULED";
        FieldPlot f = store.fields.get(reqRow.fieldId);
        if (f != null && "READY_HARVEST".equals(f.readinessStatus)) {
            f.readinessStatus = "SCHEDULED";
        }

        Map<String, Object> after = new LinkedHashMap<>();
        after.put("assignment_id", asgId);
        after.put("field_id", reqRow.fieldId);
        after.put("machine_id", machineId);
        after.put("operator_id", operatorId);
        after.put("window", startTime + " -> " + endTime);
        after.put("status", "CONFIRMED");

        var audit = store.auditLedger.appendRecord(
                orgId, reqRow.correlationId, "Assignment", asgId,
                "CONFIRM_SCHEDULE_ASSIGNMENT", auth.username(), auth.role(),
                Map.of("request_status", oldReqStatus), after, 200
        );

        Map<String, Object> res = new LinkedHashMap<>();
        res.put("ok", true);
        res.put("assignment_id", asgId);
        res.put("audit", audit.toSummaryMap());
        return new HttpResult(201, res);
    }

    // ------------------------------------------------------------------------
    // 6. REPORT MACHINE BREAKDOWN INCIDENT
    // ------------------------------------------------------------------------
    public synchronized HttpResult reportMachineIncident(AuthContext auth, Map<String, Object> body) {
        String machineId = String.valueOf(body.getOrDefault("machine_id", "M01"));
        Map<String, Object> rbacErr = ZeroTrustGateway.enforceRbacPolicy(
                store.auditLedger, auth, List.of("OPERATOR", "COORDINATOR"),
                "REPORT_MACHINE_INCIDENT", "Machine", machineId
        );
        if (rbacErr != null) return new HttpResult(403, rbacErr);

        String severity = String.valueOf(body.getOrDefault("severity", "CRITICAL"));
        String incType = String.valueOf(body.getOrDefault("incident_type", "Đứt dây curoa buồng đập & Kẹt trục cuốn"));
        String description = String.valueOf(body.getOrDefault("description", "Máy M01 gặp sự cố cơ khí tại cánh đồng F01, cần dừng máy 24h để thay dây curoa và ổ bi."));
        double downtimeHrs = body.get("estimated_downtime_hours") instanceof Number n ? n.doubleValue() : 24.0;
        String evidenceFilename = String.valueOf(body.getOrDefault("evidence_filename", "minh_chung_dut_day_curoa_M01.jpg"));
        String evidenceDataUrl = String.valueOf(body.getOrDefault("evidence_data_url", ""));
        boolean forceNoOption = Boolean.TRUE.equals(body.get("force_no_option"));

        String orgId = auth.organizationId();
        HarvesterMachine machine = store.machines.get(machineId);
        if (machine == null || !TenantRlsContext.isSameTenant(auth, machine.organizationId)) {
            return new HttpResult(404, Map.of("error", "MACHINE_NOT_FOUND", "message", "Không tìm thấy máy " + machineId + "."));
        }

        String incId = "M01".equals(machineId) ? "INC-2026-001" : "INC-" + shortUuid();
        String repId = "M01".equals(machineId) ? "REP-2026-001" : "REP-" + shortUuid();
        String prcId = "PRC-" + incId;
        String ts = nowIso();

        // 6.1. Store Evidence in SeaweedFS/S3 Object Storage (Tier 1 Core)
        var s3Obj = store.s3Storage.putEvidenceObject(
                orgId, "openagrios-evidence", "incidents", incId,
                evidenceFilename, "image/jpeg", 284612L, auth.username(), evidenceDataUrl, ts
        );

        // 6.2. Update Machine Digital Twin State -> BREAKDOWN
        Map<String, Object> beforeM = new LinkedHashMap<>();
        beforeM.put("machine_id", machineId);
        beforeM.put("status", machine.status);
        beforeM.put("health_pct", machine.healthPct);

        machine.status = "BREAKDOWN";
        machine.healthPct = 22.0;
        machine.telemetryUpdatedAt = ts;

        // 6.3. Identify Impacted Confirmed Assignments of M01
        List<DispatchAssignment> impactedRows = new ArrayList<>();
        for (DispatchAssignment a : store.assignments.values()) {
            if (a.organizationId.equals(orgId) && a.machineId.equals(machineId) && "CONFIRMED".equals(a.status)) {
                impactedRows.add(a);
            }
        }
        impactedRows.sort(Comparator.comparing(a -> a.startTime));

        List<String> impactedIds = new ArrayList<>();
        for (DispatchAssignment imp : impactedRows) {
            impactedIds.add(imp.assignmentId);
            imp.status = "IMPACTED";
            ServiceRequest sr = store.serviceRequests.get(imp.requestId);
            if (sr != null) sr.status = "IMPACTED_BY_INCIDENT";
            FieldPlot fp = store.fields.get(imp.fieldId);
            if (fp != null) fp.readinessStatus = "IMPACTED";
        }

        // 6.4. Run Spatial Rescue Matching Engine to score Rescue Candidates
        String primaryCorrId = !impactedRows.isEmpty() ? impactedRows.get(0).correlationId : "CORR-" + incId;
        List<Map<String, Object>> allCandidates = new ArrayList<>();
        for (DispatchAssignment imp : impactedRows) {
            allCandidates.addAll(computeRescueCandidatesForShift(orgId, imp, forceNoOption));
        }

        MachineIncident incident = new MachineIncident(
                incId, orgId, machineId, auth.userId(), severity, incType, description,
                downtimeHrs, s3Obj.objectKey(), s3Obj.etag(), repId, "usr_repair_01",
                "OPEN_REPLANNING", prcId, impactedIds, allCandidates, null, primaryCorrId, ts
        );
        store.incidents.put(incId, incident);

        // 6.5. Start Tier 1 BPMN 2.0 incident_replan_workflow
        store.bpmnEngine.startInstance(
                prcId, orgId, "incident_replan_workflow", incId,
                "taskCoordinatorApproveReplan", "Điều phối viên HTX phê duyệt phương án máy cứu viện thay thế", "COORDINATOR",
                List.of(
                        BpmnWorkflowEngine.makeStepHistory("startIncident", "Người vận hành " + auth.username() + " báo hỏng máy " + machineId + " kèm minh chứng S3", auth.username(), auth.role(), ts),
                        BpmnWorkflowEngine.makeStepHistory("serviceImpactAnalysis", "Rule Engine khoanh vùng " + impactedIds.size() + " ca đứt gãy (" + String.join(", ", impactedIds) + ") & đề xuất " + allCandidates.size() + " phương án cứu viện", "SYSTEM_INTELLIGENCE", "CORE_ENGINE", ts)
                ),
                ts
        );

        Map<String, Object> afterM = new LinkedHashMap<>();
        afterM.put("incident_id", incId);
        afterM.put("machine_id", machineId);
        afterM.put("new_machine_status", "BREAKDOWN");
        afterM.put("minio_object_key", s3Obj.objectKey());
        afterM.put("minio_etag", s3Obj.etag());
        afterM.put("repair_ticket_id", repId);
        afterM.put("impacted_assignments", impactedIds);
        afterM.put("candidate_rescue_count", allCandidates.size());
        afterM.put("top_candidate", !allCandidates.isEmpty() ? allCandidates.get(0).get("option_id") : "NO_FEASIBLE_OPTION");

        var audit = store.auditLedger.appendRecord(
                orgId, primaryCorrId, "Incident", incId,
                "REPORT_BREAKDOWN_AND_IMPACT_SCAN", auth.username(), auth.role(),
                beforeM, afterM, 200
        );

        Map<String, Object> res = new LinkedHashMap<>();
        res.put("ok", true);
        res.put("incident_id", incId);
        res.put("repair_ticket_id", repId);
        res.put("minio_evidence", Map.of("object_key", s3Obj.objectKey(), "etag", s3Obj.etag()));
        res.put("impacted_assignment_ids", impactedIds);
        res.put("candidate_options", allCandidates);
        res.put("no_feasible_option", allCandidates.isEmpty());
        res.put("audit", audit.toSummaryMap());
        return new HttpResult(201, res);
    }

    private List<Map<String, Object>> computeRescueCandidatesForShift(
            String orgId,
            DispatchAssignment impactedAsg,
            boolean forceNoOption
    ) {
        if (forceNoOption) return List.of();
        FieldPlot field = store.fields.get(impactedAsg.fieldId);
        if (field == null || !field.organizationId.equals(orgId)) return List.of();

        List<OperatorProfile> orgOps = new ArrayList<>();
        for (OperatorProfile op : store.operators.values()) {
            if (op.organizationId().equals(orgId)) orgOps.add(op);
        }
        if (orgOps.isEmpty()) return List.of();

        List<Map<String, Object>> candidates = new ArrayList<>();
        List<DispatchAssignment> allAsg = new ArrayList<>(store.assignments.values());

        for (HarvesterMachine m : store.machines.values()) {
            if (!m.organizationId.equals(orgId)) continue;
            if (m.machineId.equals(impactedAsg.machineId)) continue;
            if ("BREAKDOWN".equals(m.status) || "MAINTENANCE".equals(m.status)) continue;

            OperatorProfile op = orgOps.get(0);
            for (OperatorProfile o : orgOps) {
                if (o.operatorId().equals(m.assignedOperatorId)) {
                    op = o;
                    break;
                }
            }

            Map<String, Object> conflict = ScheduleConflictEngine.checkConflict(
                    orgId, m.machineId, m.status, true,
                    op.operatorId(), impactedAsg.startTime, impactedAsg.endTime,
                    impactedAsg.assignmentId, allAsg
            );
            if (conflict != null) continue;

            double distKm = SpatialMatchingEngine.spatialDistanceKm(
                    m.currentLat, m.currentLng, field.centerLat, field.centerLng
            );
            double estHours = Math.round((field.areaHa / m.capacityHaPerHr) * 10.0) / 10.0;
            double totalScore = SpatialMatchingEngine.computeMultiCriteriaScore(
                    distKm, m.capacityHaPerHr, op.rating()
            );

            String winStr = impactedAsg.startTime.substring(11, 16) + "–" + impactedAsg.endTime.substring(11, 16);
            int moveMins = Math.max(8, (int) (distKm * 7));
            List<String> explanations = List.of(
                    "Trạng thái sẵn sàng: " + m.name + " và lái máy " + op.fullName() + " hoàn toàn rảnh trong khung " + winStr + ".",
                    "Khoảng cách không gian (PostGIS ST_Distance): Cách " + field.name + " " + distKm + " km (thời gian cơ động ~" + moveMins + " phút).",
                    "Năng lực thiết bị: Công suất " + m.capacityHaPerHr + " ha/giờ, dự kiến hoàn thành " + field.areaHa + " ha trong " + estHours + " giờ.",
                    "Kỹ năng vận hành: " + op.fullName() + " đạt " + op.rating() + "/5.0 sao, có chứng chỉ " + op.skills() + "."
            );

            Map<String, Object> cand = new LinkedHashMap<>();
            cand.put("option_id", "OPT-" + m.machineId + "-" + op.operatorId() + "-" + impactedAsg.assignmentId);
            cand.put("for_assignment_id", impactedAsg.assignmentId);
            cand.put("for_request_id", impactedAsg.requestId);
            cand.put("field_id", impactedAsg.fieldId);
            cand.put("field_name", field.name);
            cand.put("machine_id", m.machineId);
            cand.put("machine_name", m.name);
            cand.put("operator_id", op.operatorId());
            cand.put("operator_name", op.fullName());
            cand.put("distance_km", distKm);
            cand.put("estimated_duration_hrs", estHours);
            cand.put("score", totalScore);
            cand.put("from_lat", m.currentLat);
            cand.put("from_lng", m.currentLng);
            cand.put("to_lat", field.centerLat);
            cand.put("to_lng", field.centerLng);
            cand.put("start_time", impactedAsg.startTime);
            cand.put("end_time", impactedAsg.endTime);
            cand.put("explanations", explanations);
            candidates.add(cand);
        }

        candidates.sort((a, b) -> Double.compare(
                ((Number) b.get("score")).doubleValue(),
                ((Number) a.get("score")).doubleValue()
        ));
        return candidates;
    }

    // ------------------------------------------------------------------------
    // 7. APPROVE RESCUE RE-PLAN ON BPMN (Role: COORDINATOR ONLY)
    // ------------------------------------------------------------------------
    public synchronized HttpResult approveRescueReplan(AuthContext auth, String incId, Map<String, Object> body) {
        Map<String, Object> rbacErr = ZeroTrustGateway.enforceRbacPolicy(
                store.auditLedger, auth, List.of("COORDINATOR"),
                "APPROVE_BPMN_RESCUE_REPLAN", "Incident", incId
        );
        if (rbacErr != null) return new HttpResult(403, rbacErr);

        MachineIncident inc = store.incidents.get(incId);
        if (inc == null || !TenantRlsContext.isSameTenant(auth, inc.organizationId)) {
            return new HttpResult(404, Map.of("error", "INCIDENT_NOT_FOUND", "message", "Không tìm thấy sự cố " + incId + "."));
        }

        if (inc.candidateOptions.isEmpty()) {
            return new HttpResult(422, Map.of(
                    "error", "NO_FEASIBLE_OPTION_AVAILABLE",
                    "message", "Hiện chưa có phương án máy thay thế thỏa mãn ràng buộc khung giờ. Vui lòng đề xuất lùi khung giờ thu hoạch!"
            ));
        }

        String optionId = body.get("option_id") != null ? String.valueOf(body.get("option_id")) : null;
        Map<String, Object> chosen = inc.candidateOptions.get(0);
        if (optionId != null) {
            for (Map<String, Object> c : inc.candidateOptions) {
                if (optionId.equals(c.get("option_id"))) {
                    chosen = c;
                    break;
                }
            }
        }

        String oldAsgId = String.valueOf(chosen.get("for_assignment_id"));
        String newAsgId = oldAsgId + "-R1";
        String ts = nowIso();
        String orgId = auth.organizationId();

        DispatchAssignment oldAsg = store.assignments.get(oldAsgId);
        if (oldAsg != null) {
            oldAsg.status = "SUPERSEDED";
            oldAsg.supersededByAssignmentId = newAsgId;
        }

        DispatchAssignment newAsg = new DispatchAssignment(
                newAsgId, orgId,
                String.valueOf(chosen.get("for_request_id")),
                String.valueOf(chosen.get("field_id")),
                String.valueOf(chosen.get("machine_id")),
                String.valueOf(chosen.get("operator_id")),
                String.valueOf(chosen.get("start_time")),
                String.valueOf(chosen.get("end_time")),
                "CONFIRMED", oldAsgId, null,
                inc.correlationId, auth.userId(), ts
        );
        store.assignments.put(newAsgId, newAsg);

        ServiceRequest sr = store.serviceRequests.get(newAsg.requestId);
        if (sr != null) sr.status = "RESCHEDULED";
        FieldPlot fp = store.fields.get(newAsg.fieldId);
        if (fp != null) fp.readinessStatus = "SCHEDULED";
        HarvesterMachine rescueM = store.machines.get(newAsg.machineId);
        if (rescueM != null) {
            rescueM.status = "MOVING";
            rescueM.telemetryUpdatedAt = ts;
        }

        inc.status = "REPLAN_APPROVED";
        inc.selectedOption = chosen;

        // Advance Tier 1 BPMN Instance
        store.bpmnEngine.advanceInstance(
                inc.bpmnProcessId,
                BpmnWorkflowEngine.makeStepHistory(
                        "taskCoordinatorApproveReplan",
                        "Điều phối viên " + auth.username() + " phê duyệt điều động " + chosen.get("machine_id") + " (" + chosen.get("operator_name") + ") thay thế cho " + oldAsgId,
                        auth.username(), auth.role(), ts
                ),
                "taskFarmerConfirmNewSchedule",
                "Nông hộ nhận thông báo & nghiệm thu ca thay thế",
                "FARMER",
                ts
        );

        Map<String, Object> before = new LinkedHashMap<>();
        before.put("superseded_assignment_id", oldAsgId);
        before.put("broken_machine_id", inc.machineId);
        before.put("status", "IMPACTED");

        Map<String, Object> after = new LinkedHashMap<>();
        after.put("new_assignment_id", newAsgId);
        after.put("replaces_assignment_id", oldAsgId);
        after.put("rescue_machine_id", chosen.get("machine_id"));
        after.put("rescue_operator_id", chosen.get("operator_id"));
        after.put("distance_km", chosen.get("distance_km"));
        after.put("match_score", chosen.get("score"));
        after.put("status", "CONFIRMED");

        var audit = store.auditLedger.appendRecord(
                orgId, inc.correlationId, "Assignment", newAsgId,
                "APPROVE_BPMN_RESCUE_REPLACEMENT", auth.username(), auth.role(),
                before, after, 200
        );

        Map<String, Object> res = new LinkedHashMap<>();
        res.put("ok", true);
        res.put("superseded_assignment_id", oldAsgId);
        res.put("new_assignment_id", newAsgId);
        res.put("selected_option", chosen);
        res.put("audit", audit.toSummaryMap());
        return new HttpResult(200, res);
    }

    // ------------------------------------------------------------------------
    // 8. REPAIR TEAM UPDATE TICKET (Role: REPAIR_TEAM or COORDINATOR)
    // ------------------------------------------------------------------------
    public synchronized HttpResult updateRepairTicket(AuthContext auth, String incId, Map<String, Object> body) {
        Map<String, Object> rbacErr = ZeroTrustGateway.enforceRbacPolicy(
                store.auditLedger, auth, List.of("REPAIR_TEAM", "COORDINATOR"),
                "COMPLETE_REPAIR_TICKET", "Incident", incId
        );
        if (rbacErr != null) return new HttpResult(403, rbacErr);

        MachineIncident inc = store.incidents.get(incId);
        if (inc == null || !TenantRlsContext.isSameTenant(auth, inc.organizationId)) {
            return new HttpResult(404, Map.of("error", "INCIDENT_NOT_FOUND"));
        }

        String diagnosis = String.valueOf(body.getOrDefault("diagnosis", "Đã thay mới dây curoa buồng đập Bando & căn chỉnh cụm puly"));
        String oldStatus = inc.status;
        inc.status = "UNDER_REPAIR";

        Map<String, Object> after = new LinkedHashMap<>();
        after.put("repair_ticket_id", inc.repairTicketId);
        after.put("status", "UNDER_REPAIR");
        after.put("diagnosis", diagnosis);

        var audit = store.auditLedger.appendRecord(
                auth.organizationId(), inc.correlationId, "RepairTicket", inc.repairTicketId,
                "REPAIR_TEAM_DIAGNOSIS_UPDATED", auth.username(), auth.role(),
                Map.of("status", oldStatus), after, 200
        );

        return new HttpResult(200, Map.of("ok", true, "audit", audit.toSummaryMap()));
    }

    // ------------------------------------------------------------------------
    // 9. CONFIRM ACCEPTANCE & SEAL LEDGER
    // ------------------------------------------------------------------------
    public synchronized HttpResult confirmAcceptance(AuthContext auth, Map<String, Object> body) {
        String asgId = String.valueOf(body.getOrDefault("assignment_id", "ASG-102-R1"));
        Map<String, Object> rbacErr = ZeroTrustGateway.enforceRbacPolicy(
                store.auditLedger, auth, List.of("FARMER", "OPERATOR", "COORDINATOR"),
                "SUBMIT_OR_CONFIRM_ACCEPTANCE", "Acceptance", asgId
        );
        if (rbacErr != null) return new HttpResult(403, rbacErr);

        String notes = String.valueOf(body.getOrDefault("notes", "Đã thu hoạch sạch 2.2 ha tại Kênh Xáng Ô Môn, lúa đóng bao đầy đủ."));
        String orgId = auth.organizationId();

        DispatchAssignment asg = store.assignments.get(asgId);
        if (asg == null || !TenantRlsContext.isSameTenant(auth, asg.organizationId)) {
            return new HttpResult(404, Map.of("error", "ASSIGNMENT_NOT_FOUND", "message", "Không tìm thấy ca " + asgId + "."));
        }

        if ("OPERATOR".equals(auth.role()) && "FARMER_CONFIRM".equals(body.get("action"))) {
            var audit = store.auditLedger.appendRecord(
                    orgId, asg.correlationId, "Acceptance", asgId,
                    "RBAC_BLOCKED_SELF_ACCEPTANCE", auth.username(), auth.role(),
                    Map.of("assignment_id", asgId),
                    Map.of("error", "Người vận hành không được phép tự phê duyệt nghiệm thu thay Nông hộ!"),
                    403
            );
            Map<String, Object> err = new LinkedHashMap<>();
            err.put("error", "RBAC_SELF_ACCEPTANCE_FORBIDDEN");
            err.put("message", "Chặn phân quyền (403): Người vận hành không được tự phê duyệt nghiệm thu thay cho Nông hộ!");
            err.put("audit_event", audit.toSummaryMap());
            return new HttpResult(403, err);
        }

        FieldPlot field = store.fields.get(asg.fieldId);
        String ts = nowIso();
        String accId = "ACC-" + asgId;
        String fname = "bien_ban_nghiem_thu_" + asg.fieldId + ".jpg";

        var s3Obj = store.s3Storage.putEvidenceObject(
                orgId, "openagrios-evidence", "acceptances", accId,
                fname, "image/jpeg", 312400L, auth.username(), "", ts
        );

        double prevProgress = field != null ? field.harvestProgressPct : 0.0;
        double areaHa = field != null ? field.areaHa : 2.2;

        HarvesterMachine m = store.machines.get(asg.machineId);
        if (m != null && field != null) {
            m.currentLat = field.centerLat;
            m.currentLng = field.centerLng;
            m.status = "IDLE";
            m.fuelPct = 74.0;
            m.telemetryUpdatedAt = ts;
        }
        if (field != null) {
            field.readinessStatus = "COMPLETED";
            field.harvestProgressPct = 100.0;
        }
        asg.status = "COMPLETED";
        ServiceRequest sr = store.serviceRequests.get(asg.requestId);
        if (sr != null) sr.status = "COMPLETED";

        WorkAcceptance acc = new WorkAcceptance(
                accId, orgId, asgId, asg.requestId, areaHa,
                s3Obj.objectKey(), "op_nam", auth.username(), "CONFIRMED",
                notes, asg.correlationId, ts, ts
        );
        store.acceptances.put(accId, acc);

        store.bpmnEngine.completeActiveTenantInstances(
                orgId, "endReplan", "Đã nghiệm thu & Đóng băng Sổ cái Audit SHA-256", ts
        );

        Map<String, Object> before = new LinkedHashMap<>();
        before.put("assignment_id", asgId);
        before.put("harvest_progress_pct", prevProgress);

        Map<String, Object> after = new LinkedHashMap<>();
        after.put("acceptance_id", accId);
        after.put("assignment_id", asgId);
        after.put("field_id", asg.fieldId);
        after.put("completed_area_ha", areaHa);
        after.put("minio_evidence", s3Obj.objectKey());
        after.put("confirmation_status", "CONFIRMED");
        after.put("ledger_sealed", true);

        var audit = store.auditLedger.appendRecord(
                orgId, asg.correlationId, "WorkAcceptance", accId,
                "CONFIRM_ACCEPTANCE_AND_SEAL_LEDGER", auth.username(), auth.role(),
                before, after, 200
        );

        Map<String, Object> res = new LinkedHashMap<>();
        res.put("ok", true);
        res.put("acceptance_id", accId);
        res.put("minio_object_key", s3Obj.objectKey());
        res.put("audit", audit.toSummaryMap());
        return new HttpResult(200, res);
    }

    // ------------------------------------------------------------------------
    // 10. SIMULATION CLOCK TICK
    // ------------------------------------------------------------------------
    public synchronized Map<String, Object> tickSimulation(AuthContext auth) {
        store.tickCount += 1;
        ZonedDateTime baseDt = ZonedDateTime.parse("2026-11-20T09:15:00Z").plusMinutes(30L * store.tickCount);
        store.simTime = baseDt.format(DateTimeFormatter.ISO_INSTANT);

        for (DispatchAssignment a : store.assignments.values()) {
            if (!TenantRlsContext.isSameTenant(auth, a.organizationId)) continue;
            if (!("IN_PROGRESS".equals(a.status) || "CONFIRMED".equals(a.status))) continue;

            HarvesterMachine m = store.machines.get(a.machineId);
            FieldPlot f = store.fields.get(a.fieldId);
            if (m == null || f == null) continue;
            if ("BREAKDOWN".equals(m.status) || "MAINTENANCE".equals(m.status)) continue;

            m.currentLat = Math.round((m.currentLat + (f.centerLat - m.currentLat) * 0.45) * 1_000_000.0) / 1_000_000.0;
            m.currentLng = Math.round((m.currentLng + (f.centerLng - m.currentLng) * 0.45) * 1_000_000.0) / 1_000_000.0;
            m.status = "WORKING";
            m.fuelPct = Math.max(15.0, m.fuelPct - 3.0);
            m.telemetryUpdatedAt = store.simTime;

            f.readinessStatus = "HARVESTING";
            f.harvestProgressPct = Math.min(95.0, Math.round((f.harvestProgressPct + 20.0) * 10.0) / 10.0);
        }

        Map<String, Object> res = new LinkedHashMap<>();
        res.put("ok", true);
        res.put("sim_time", store.simTime);
        res.put("tick_count", store.tickCount);
        return res;
    }
}
