// SPDX-License-Identifier: Apache-2.0

// Copyright 2026 OpenAgriOS Contributors



package org.openagrios.apps.agriops;



import org.openagrios.apps.agriops.AgriModels.*;

import org.openagrios.core.dataservices.ImmutableAuditLedger;
import org.openagrios.core.dataservices.PostgreSqlDataService;

import org.openagrios.core.dataservices.SeaweedS3StorageService;

import org.openagrios.core.dataservices.SpatialMatchingEngine;

import org.openagrios.core.identity.KeycloakOidcEngine.Organization;

import org.openagrios.core.identity.KeycloakOidcEngine.UserAccount;

import org.openagrios.core.workflow.BpmnWorkflowEngine;



import java.util.*;



/**

 * Multi-Tenant Agricultural Mechanization Data Repository.

 * Manages domain state for cooperative organizations, fields, harvesters,

 * operators, service requests, dispatch assignments, incidents, and work acceptances.

 */

public final class AgriDataStore {



    public final Map<String, Organization> organizations = new LinkedHashMap<>();

    public final Map<String, UserAccount> usersByUsername = new LinkedHashMap<>();

    public final Map<String, FieldPlot> fields = new LinkedHashMap<>();

    public final Map<String, HarvesterMachine> machines = new LinkedHashMap<>();

    public final Map<String, OperatorProfile> operators = new LinkedHashMap<>();

    public final Map<String, ServiceRequest> serviceRequests = new LinkedHashMap<>();

    public final Map<String, DispatchAssignment> assignments = new LinkedHashMap<>();

    public final Map<String, MachineIncident> incidents = new LinkedHashMap<>();

    public final Map<String, WorkAcceptance> acceptances = new LinkedHashMap<>();



    public String simTime = "2026-11-20T09:15:00Z";

    public int tickCount = 0;



    public final ImmutableAuditLedger auditLedger;

    public final SeaweedS3StorageService s3Storage;

    public final BpmnWorkflowEngine bpmnEngine;
    public final PostgreSqlDataService postgreSqlDataService;



    public AgriDataStore(

            ImmutableAuditLedger auditLedger,

            SeaweedS3StorageService s3Storage,

            BpmnWorkflowEngine bpmnEngine

    ) {

        this.auditLedger = auditLedger;
        this.s3Storage = s3Storage;
        this.bpmnEngine = bpmnEngine;
        this.postgreSqlDataService = new PostgreSqlDataService();
        this.auditLedger.setPostgreSqlDataService(this.postgreSqlDataService);
        if (this.postgreSqlDataService.isConfigured() && this.postgreSqlDataService.isConnectionLive()) {
            this.postgreSqlDataService.initSchema();
            if (this.postgreSqlDataService.hasExistingData()) {
                loadFromDatabase();
            } else {
                resetAndSeed();
            }
        } else {
            resetAndSeed();
        }

    }



    /**

     * Storage Engine Execution Mode:

     * - Standalone / Dev / CI mode: In-memory repository with PostgreSQL RLS query compilation.

     * - Production container mode: Backed by PostgreSQL 16 with Row-Level Security (infra/db/schema.sql).

     */

        public String getStorageEngineMode() {
        if (postgreSqlDataService.isConfigured() && postgreSqlDataService.isConnectionLive()) {
            return "POSTGRESQL_16_JDBC_RLS (Active JDBC Pool: " + postgreSqlDataService.getDbUrl() + ", Status: CONNECTED, Driver: org.postgresql.Driver, RLS: ENFORCED)";
        }
        String configuredUrl = postgreSqlDataService.getDbUrl();
        if (!configuredUrl.isBlank()) {
            String strictMode = System.getenv("OPENAGRIOS_STORAGE_MODE");
            if ("POSTGRESQL_PRODUCTION".equalsIgnoreCase(strictMode)) {
                return "POSTGRESQL_16_JDBC_DISCONNECTED (CRITICAL: Database unreachable at " + configuredUrl + ")";
            }
            return "IN_MEMORY_MAP_WITH_POSTGRES_RLS_COMPILER (PostgreSQL unreachable: fallback active with compiled RLS)";
        }
        return "IN_MEMORY_MAP_WITH_POSTGRES_RLS_COMPILER (Standalone Development Mode: Zero-dependency in-memory store)";
    }



    public synchronized void resetAndSeed() {

        organizations.clear();

        usersByUsername.clear();

        fields.clear();

        machines.clear();

        operators.clear();

        serviceRequests.clear();

        assignments.clear();

        incidents.clear();

        acceptances.clear();

        auditLedger.clear();

        s3Storage.clear();

        bpmnEngine.clearInstances();



        simTime = "2026-11-20T09:15:00Z";

        tickCount = 0;



        // 1. Cooperative Organizations

        addOrg(new Organization("HTX_CANTHO_01", "HTX Nông nghiệp Số Thới Lai — Cần Thơ", "COOPERATIVE", "Cần Thơ", "ACTIVE"));

        addOrg(new Organization("HTX_SOCTRANG_02", "HTX Lúa Chất lượng cao Mỹ Xuyên — Sóc Trăng", "COOPERATIVE", "Sóc Trăng", "ACTIVE"));



        // 2. Realm Users

        addUser(new UserAccount("usr_farmer_ba", "farmer_ba", "123456", "Bác Ba Nguyễn Văn", "farmer_ba@htxcantho01.vn", "HTX_CANTHO_01", "FARMER"));

        addUser(new UserAccount("usr_farmer_tam", "farmer_tam", "123456", "Chú Tám Lê Văn", "farmer_tam@htxcantho01.vn", "HTX_CANTHO_01", "FARMER"));

        addUser(new UserAccount("usr_coord_01", "coord_htx01", "123456", "Chị Lan (Điều phối viên HTX Cần Thơ 01)", "coord_htx01@htxcantho01.vn", "HTX_CANTHO_01", "COORDINATOR"));

        addUser(new UserAccount("usr_op_minh", "op_minh", "123456", "Anh Minh (Lái máy M01)", "op_minh@htxcantho01.vn", "HTX_CANTHO_01", "OPERATOR"));

        addUser(new UserAccount("usr_op_nam", "op_nam", "123456", "Anh Nam (Lái máy M02 - Cứu viện)", "op_nam@htxcantho01.vn", "HTX_CANTHO_01", "OPERATOR"));

        addUser(new UserAccount("usr_op_hai", "op_hai", "123456", "Anh Hải (Lái máy M03)", "op_hai@htxcantho01.vn", "HTX_CANTHO_01", "OPERATOR"));

        addUser(new UserAccount("usr_op_son", "op_son", "123456", "Anh Sơn (Lái máy M04)", "op_son@htxcantho01.vn", "HTX_CANTHO_01", "OPERATOR"));

        addUser(new UserAccount("usr_owner_tu", "owner_tu", "123456", "Chú Tư Võ Văn (Chủ máy M01, M02)", "owner_tu@htxcantho01.vn", "HTX_CANTHO_01", "MACHINE_OWNER"));

        addUser(new UserAccount("usr_repair_01", "repair_01", "123456", "Đội Sửa chữa Cơ khí R01", "repair_01@htxcantho01.vn", "HTX_CANTHO_01", "REPAIR_TEAM"));

        addUser(new UserAccount("usr_coord_02", "coord_htx02", "123456", "Anh Hùng (Điều phối viên HTX Sóc Trăng 02)", "coord_htx02@htxsoctrang02.vn", "HTX_SOCTRANG_02", "COORDINATOR"));



        // 3. Field Plots

        addField("F01", "HTX_CANTHO_01", "usr_farmer_ba", "Bác Ba Nguyễn Văn", "Cánh đồng F01 - Ấp Thới Thuận A", "Ấp Thới Thuận A", "Lúa Đông Xuân OM18", 2.4, "HARVESTING", 45.0, "2026-11-20T07:00:00Z", "2026-11-20T12:00:00Z", 10.0645, 105.5580);

        addField("F02", "HTX_CANTHO_01", "usr_farmer_tam", "Chú Tám Lê Văn", "Cánh đồng F02 - Ấp Thới Thuận B", "Ấp Thới Thuận B", "Lúa Đài Thơm 8", 3.1, "HARVESTING", 60.0, "2026-11-20T07:30:00Z", "2026-11-20T12:30:00Z", 10.0725, 105.5740);

        addField("F03", "HTX_CANTHO_01", "usr_farmer_ba", "Bác Ba Nguyễn Văn", "Cánh đồng F03 - Kênh Xáng Ô Môn", "Kênh Xáng Ô Môn", "Lúa Đông Xuân OM18", 2.2, "SCHEDULED", 0.0, "2026-11-20T13:00:00Z", "2026-11-20T17:00:00Z", 10.0560, 105.5685);

        addField("F04", "HTX_CANTHO_01", "usr_farmer_tam", "Chú Tám Lê Văn", "Cánh đồng F04 - Ấp Định Khánh", "Ấp Định Khánh", "Lúa ST25", 2.8, "READY_HARVEST", 0.0, "2026-11-20T13:00:00Z", "2026-11-20T18:00:00Z", 10.0805, 105.5610);

        addField("F05", "HTX_CANTHO_01", "usr_farmer_tam", "Chú Tám Lê Văn", "Cánh đồng F05 - Ấp Trường Khương", "Ấp Trường Khương", "Lúa Đông Xuân OM18", 1.9, "SCHEDULED", 0.0, "2026-11-21T07:00:00Z", "2026-11-21T11:30:00Z", 10.0495, 105.5520);

        addField("F06", "HTX_CANTHO_01", "usr_farmer_tam", "Chú Tám Lê Văn", "Cánh đồng F06 - Kinh Đứng", "Kinh Đứng", "Lúa Đài Thơm 8", 3.5, "SCHEDULED", 0.0, "2026-11-20T08:00:00Z", "2026-11-20T17:30:00Z", 10.0780, 105.5880);

        addField("F07", "HTX_CANTHO_01", "usr_farmer_ba", "Bác Ba Nguyễn Văn", "Cánh đồng F07 - Gò Tháp Mười", "Gò Tháp Mười", "Lúa Đông Xuân OM18", 2.0, "READY_HARVEST", 0.0, "2026-11-21T13:00:00Z", "2026-11-21T17:00:00Z", 10.0525, 105.5825);

        addField("F08", "HTX_CANTHO_01", "usr_farmer_tam", "Chú Tám Lê Văn", "Cánh đồng F08 - Bờ Bắc Thới Lai", "Bờ Bắc Thới Lai", "Lúa OM5451", 2.6, "COMPLETED", 100.0, "2026-11-19T07:00:00Z", "2026-11-19T15:00:00Z", 10.0850, 105.5470);

        addField("F09", "HTX_CANTHO_01", "usr_farmer_tam", "Chú Tám Lê Văn", "Cánh đồng F09 - Lung Ngọc Hoàng", "Lung Ngọc Hoàng", "Lúa OM18", 2.3, "GROWING", 0.0, "2026-11-23T07:00:00Z", "2026-11-24T17:00:00Z", 10.0450, 105.5650);

        addField("F10", "HTX_CANTHO_01", "usr_farmer_tam", "Chú Tám Lê Văn", "Cánh đồng F10 - Trạm Bơm Đông Hiệp", "Đông Hiệp", "Lúa Đài Thơm 8", 1.8, "READY_HARVEST", 0.0, "2026-11-21T07:30:00Z", "2026-11-21T12:00:00Z", 10.0675, 105.5920);

        addField("F_ST01", "HTX_SOCTRANG_02", "usr_coord_02", "HTX Mỹ Xuyên", "Cánh đồng ST01 - Mỹ Xuyên A", "Mỹ Xuyên", "Lúa ST25 Đặc sản", 4.2, "HARVESTING", 50.0, "2026-11-20T07:00:00Z", "2026-11-20T17:00:00Z", 9.5620, 105.9410);



        // 4. Combine Harvester Fleet

        String tsNow = "2026-11-20T09:15:00Z";

        addMachine(new HarvesterMachine("M01", "HTX_CANTHO_01", "usr_owner_tu", "Máy Gặt Kubota M01 (Chủ lực)", "COMBINE_HARVESTER", "Kubota DC-70 Plus", 0.65, "WORKING", 78.0, 96.0, 10.0645, 105.5580, "OP-01", tsNow));

        addMachine(new HarvesterMachine("M02", "HTX_CANTHO_01", "usr_owner_tu", "Máy Gặt Yanmar M02 (Cơ động)", "COMBINE_HARVESTER", "Yanmar AW82V", 0.72, "IDLE", 88.0, 99.0, 10.0680, 105.5715, "OP-02", tsNow));

        addMachine(new HarvesterMachine("M03", "HTX_CANTHO_01", "usr_coord_01", "Máy Gặt Kubota M03 (HTX)", "COMBINE_HARVESTER", "Kubota DC-93", 0.80, "WORKING", 64.0, 92.0, 10.0780, 105.5880, "OP-03", tsNow));

        addMachine(new HarvesterMachine("M04", "HTX_CANTHO_01", "usr_coord_01", "Máy Gặt Kubota M04 (Dự phòng)", "COMBINE_HARVESTER", "Kubota DC-60", 0.55, "MAINTENANCE", 40.0, 60.0, 10.0610, 105.5490, "OP-04", tsNow));

        addMachine(new HarvesterMachine("M_ST01", "HTX_SOCTRANG_02", "usr_coord_02", "Máy Gặt Sóc Trăng ST-01", "COMBINE_HARVESTER", "Kubota DC-70", 0.65, "WORKING", 85.0, 95.0, 9.5620, 105.9410, null, tsNow));



        // 5. Certified Operators

        addOperator(new OperatorProfile("OP-01", "usr_op_minh", "HTX_CANTHO_01", "Anh Minh (Lái chính M01)", List.of("COMBINE_HARVESTER", "HEAVY_MUD"), 4.9, "ON_SHIFT"));

        addOperator(new OperatorProfile("OP-02", "usr_op_nam", "HTX_CANTHO_01", "Anh Nam (Lái chính M02 - Cứu viện)", List.of("COMBINE_HARVESTER", "FAST_HARVEST"), 4.95, "AVAILABLE"));

        addOperator(new OperatorProfile("OP-03", "usr_op_hai", "HTX_CANTHO_01", "Anh Hải (Lái chính M03)", List.of("COMBINE_HARVESTER"), 4.7, "ON_SHIFT"));

        addOperator(new OperatorProfile("OP-04", "usr_op_son", "HTX_CANTHO_01", "Anh Sơn (Lái phụ M04)", List.of("COMBINE_HARVESTER"), 4.6, "OFF_DUTY"));



        // 6. Service Requests & Scheduled Shifts

        addRequest(new ServiceRequest("REQ-01", "HTX_CANTHO_01", "F01", "usr_farmer_ba", 2.4, "2026-11-20T07:00:00Z", "2026-11-20T12:00:00Z", "HIGH", "IN_PROGRESS", "PRC-REQ-01", "CORR-F01-2026", "Thu hoạch ca sáng tại Ấp Thới Thuận A", "2026-11-19T08:00:00Z"));

        addRequest(new ServiceRequest("REQ-02", "HTX_CANTHO_01", "F02", "usr_farmer_tam", 3.1, "2026-11-20T07:30:00Z", "2026-11-20T12:00:00Z", "NORMAL", "IN_PROGRESS", "PRC-REQ-02", "CORR-F02-2026", "Thu hoạch lúa Đài Thơm 8", "2026-11-19T08:30:00Z"));

        addRequest(new ServiceRequest("REQ-03", "HTX_CANTHO_01", "F03", "usr_farmer_ba", 2.2, "2026-11-20T13:00:00Z", "2026-11-20T17:00:00Z", "URGENT", "SCHEDULED", "PRC-REQ-03", "CORR-GOLDEN-F03", "Lúa chín rộ sát kênh Xáng Ô Môn, cần gặt đúng chiều 20/11", "2026-11-19T09:00:00Z"));

        addRequest(new ServiceRequest("REQ-04", "HTX_CANTHO_01", "F04", "usr_farmer_tam", 2.8, "2026-11-20T13:00:00Z", "2026-11-20T17:30:00Z", "HIGH", "PENDING_SCHEDULE", "PRC-REQ-04", "CORR-F04-2026", "Chờ điều phối máy ca chiều", "2026-11-19T10:00:00Z"));

        addRequest(new ServiceRequest("REQ-05", "HTX_CANTHO_01", "F05", "usr_farmer_tam", 1.9, "2026-11-21T07:00:00Z", "2026-11-21T11:30:00Z", "NORMAL", "SCHEDULED", "PRC-REQ-05", "CORR-F05-2026", "Lịch gặt sáng ngày 21/11", "2026-11-19T10:30:00Z"));

        addRequest(new ServiceRequest("REQ-06", "HTX_CANTHO_01", "F06", "usr_farmer_tam", 3.5, "2026-11-20T08:00:00Z", "2026-11-20T17:30:00Z", "HIGH", "IN_PROGRESS", "PRC-REQ-06", "CORR-F06-2026", "Cánh đồng lớn Kinh Đứng chạy nguyên ngày", "2026-11-19T11:00:00Z"));

        addRequest(new ServiceRequest("REQ-07", "HTX_CANTHO_01", "F07", "usr_farmer_ba", 2.0, "2026-11-21T13:00:00Z", "2026-11-21T17:00:00Z", "NORMAL", "PENDING_SCHEDULE", "PRC-REQ-07", "CORR-F07-2026", "Ruộng Bác Ba đợt 2 tại Gò Tháp Mười", "2026-11-19T14:00:00Z"));



        addAssignment(new DispatchAssignment("ASG-101", "HTX_CANTHO_01", "REQ-01", "F01", "M01", "OP-01", "2026-11-20T07:00:00Z", "2026-11-20T12:00:00Z", "IN_PROGRESS", null, null, "CORR-F01-2026", "usr_coord_01", "2026-11-19T15:00:00Z"));

        addAssignment(new DispatchAssignment("ASG-102", "HTX_CANTHO_01", "REQ-03", "F03", "M01", "OP-01", "2026-11-20T13:00:00Z", "2026-11-20T17:00:00Z", "CONFIRMED", null, null, "CORR-GOLDEN-F03", "usr_coord_01", "2026-11-19T15:10:00Z"));

        addAssignment(new DispatchAssignment("ASG-103", "HTX_CANTHO_01", "REQ-05", "F05", "M01", "OP-01", "2026-11-21T07:00:00Z", "2026-11-21T11:30:00Z", "CONFIRMED", null, null, "CORR-F05-2026", "usr_coord_01", "2026-11-19T15:20:00Z"));

        addAssignment(new DispatchAssignment("ASG-104", "HTX_CANTHO_01", "REQ-06", "F06", "M03", "OP-03", "2026-11-20T08:00:00Z", "2026-11-20T17:30:00Z", "IN_PROGRESS", null, null, "CORR-F06-2026", "usr_coord_01", "2026-11-19T15:30:00Z"));



        // 7. Active BPMN Process Instance for REQ-03

        bpmnEngine.startInstance(

                "PRC-REQ-03", "HTX_CANTHO_01", "service_request_lifecycle", "REQ-03",

                "taskOperatorExecute", "Người vận hành thực hiện ca gặt & cập nhật tiến độ", "OPERATOR",

                List.of(

                        BpmnWorkflowEngine.makeStepHistory("startRequest", "Nông hộ Bác Ba gửi yêu cầu REQ-03 (2.2 ha)", "farmer_ba", "FARMER", "2026-11-19T09:00:00Z"),

                        BpmnWorkflowEngine.makeStepHistory("taskCoordinatorSchedule", "Điều phối viên Chị Lan ghép cặp M01 + OP-01 (ASG-102)", "coord_htx01", "COORDINATOR", "2026-11-19T15:10:00Z")

                ),

                tsNow

        );



        // 8. Initial Audit Ledger Entries for REQ-03 / ASG-102

        Map<String, Object> reqAfter = new LinkedHashMap<>();

        reqAfter.put("request_id", "REQ-03");

        reqAfter.put("field_id", "F03");

        reqAfter.put("area_ha", 2.2);

        reqAfter.put("window", "13:00-17:00 20/11");

        auditLedger.appendRecord(

                "HTX_CANTHO_01", "CORR-GOLDEN-F03", "ServiceRequest", "REQ-03",

                "CREATE_SERVICE_REQUEST", "farmer_ba", "FARMER", null, reqAfter, 200

        );



        Map<String, Object> asgBefore = new LinkedHashMap<>();

        asgBefore.put("status", "PENDING_SCHEDULE");

        Map<String, Object> asgAfter = new LinkedHashMap<>();

        asgAfter.put("assignment_id", "ASG-102");

        asgAfter.put("machine_id", "M01");

        asgAfter.put("operator_id", "OP-01");

        asgAfter.put("status", "CONFIRMED");

        asgAfter.put("window", "13:00-17:00 20/11");

        auditLedger.appendRecord(
                "HTX_CANTHO_01", "CORR-GOLDEN-F03", "Assignment", "ASG-102",
                "CONFIRM_INITIAL_SCHEDULE", "coord_htx01", "COORDINATOR", asgBefore, asgAfter, 200
        );

        // If PostgreSQL is live, synchronize seeded state to PostgreSQL
        if (postgreSqlDataService.isConnectionLive()) {
            for (Organization o : organizations.values()) {
                postgreSqlDataService.syncOrganization(o.organizationId(), o.name(), o.orgType(), o.province(), o.status());
            }
            for (UserAccount u : usersByUsername.values()) {
                postgreSqlDataService.syncUser(u.userId(), u.username(), u.fullName(), u.organizationId(), u.role(), "", "ACTIVE");
            }
            for (FieldPlot f : fields.values()) {
                String polyJson = f.polygon != null ? org.openagrios.core.dataservices.JsonCodec.toCanonicalJson(java.util.Map.of("type", "Polygon", "coordinates", f.polygon)) : "{}";
                postgreSqlDataService.syncField(f.organizationId, "COORDINATOR", f.fieldId, f.ownerUserId, f.name, f.hamlet, f.crop, f.areaHa, f.readinessStatus, f.harvestProgressPct, f.windowStart, f.windowEnd, f.centerLat, f.centerLng, polyJson);
            }
            for (HarvesterMachine m : machines.values()) {
                postgreSqlDataService.syncMachine(m.organizationId, "COORDINATOR", m.machineId, m.ownerUserId, m.name, m.machineType, m.model, m.capacityHaPerHr, m.status, m.fuelPct, m.healthPct, m.currentLat, m.currentLng);
            }
            for (OperatorProfile op : operators.values()) {
                postgreSqlDataService.syncOperator(op.organizationId(), "COORDINATOR", op.operatorId(), op.userId(), op.fullName(), op.rating(), op.status());
            }
            for (ServiceRequest r : serviceRequests.values()) {
                postgreSqlDataService.syncServiceRequest(r.organizationId, "COORDINATOR", r.requestId, r.fieldId, r.requesterUserId, r.areaHa, r.requestedStart, r.requestedEnd, r.priority, r.status, r.bpmnProcessId, r.correlationId, r.notes);
            }
            for (DispatchAssignment a : assignments.values()) {
                postgreSqlDataService.syncAssignment(a.organizationId, "COORDINATOR", a.assignmentId, a.requestId, a.fieldId, a.machineId, a.operatorId, a.startTime, a.endTime, a.status, a.replacesAssignmentId, a.supersededByAssignmentId, null, a.correlationId, a.createdBy);
            }
        }
    }



    private void addOrg(Organization o) { organizations.put(o.organizationId(), o); }

    private void addUser(UserAccount u) { usersByUsername.put(u.username(), u); }

    private void addField(

            String id, String orgId, String ownerId, String ownerName, String name, String hamlet,

            String crop, double areaHa, String status, double prog, String wStart, String wEnd, double lat, double lng

    ) {

        fields.put(id, new FieldPlot(

                id, orgId, ownerId, ownerName, name, hamlet, crop, areaHa, status, prog, wStart, wEnd,

                lat, lng, SpatialMatchingEngine.makeGeoJsonPolygon(lat, lng, 0.0028, 0.0036)

        ));

    }

    private void addMachine(HarvesterMachine m) { machines.put(m.machineId, m); }

    private void addOperator(OperatorProfile o) { operators.put(o.operatorId(), o); }

    private void addRequest(ServiceRequest r) { serviceRequests.put(r.requestId, r); }

    private void addAssignment(DispatchAssignment a) { assignments.put(a.assignmentId, a); }

    // ========================================================================
    // PERSISTENT DATA MUTATORS (SYNCHRONIZES IN-MEMORY MAP + POSTGRESQL 16 JDBC)
    // ========================================================================

    private static volatile String storageModeOverrideForTesting = null;

    public static void setStorageModeForTesting(String mode) {
        storageModeOverrideForTesting = mode;
    }

    public static void resetStorageModeForTesting() {
        storageModeOverrideForTesting = null;
    }

    public boolean isProductionStorage() {
        if (storageModeOverrideForTesting != null) {
            return "POSTGRESQL_PRODUCTION".equalsIgnoreCase(storageModeOverrideForTesting);
        }
        String mode = System.getenv("OPENAGRIOS_STORAGE_MODE");
        String authMode = System.getenv("OPENAGRIOS_AUTH_MODE");
        return "POSTGRESQL_PRODUCTION".equalsIgnoreCase(mode)
                || "KEYCLOAK_PRODUCTION".equalsIgnoreCase(authMode);
    }

    public synchronized boolean persistField(FieldPlot f, String role) {
        return persistField(f, role, null);
    }

    public synchronized boolean persistField(FieldPlot f, String role, String userId) {
        if (isProductionStorage()) {
            if (!postgreSqlDataService.isConnectionLive()) {
                throw new IllegalStateException("PostgreSQL is unavailable in POSTGRESQL_PRODUCTION mode (connection is not live). Fail-fast enforced to prevent silent in-memory data drift.");
            }
            String polyJson = f.polygon != null ? org.openagrios.core.dataservices.JsonCodec.toCanonicalJson(java.util.Map.of("type", "Polygon", "coordinates", f.polygon)) : "{}";
            boolean synced = postgreSqlDataService.syncField(
                    f.organizationId, role, userId != null ? userId : f.ownerUserId, f.fieldId, f.ownerUserId, f.name, f.hamlet, f.crop,
                    f.areaHa, f.readinessStatus, f.harvestProgressPct, f.windowStart, f.windowEnd,
                    f.centerLat, f.centerLng, polyJson
            );
            if (!synced) {
                throw new IllegalStateException("Failed to persist field " + f.fieldId + " to PostgreSQL in POSTGRESQL_PRODUCTION mode. In-memory state unchanged.");
            }
            fields.put(f.fieldId, f);
            return true;
        }

        // DEV_MOCK_STANDALONE MODE:
        fields.put(f.fieldId, f);
        if (postgreSqlDataService.isConnectionLive()) {
            String polyJson = f.polygon != null ? org.openagrios.core.dataservices.JsonCodec.toCanonicalJson(java.util.Map.of("type", "Polygon", "coordinates", f.polygon)) : "{}";
            postgreSqlDataService.syncField(
                    f.organizationId, role, userId != null ? userId : f.ownerUserId, f.fieldId, f.ownerUserId, f.name, f.hamlet, f.crop,
                    f.areaHa, f.readinessStatus, f.harvestProgressPct, f.windowStart, f.windowEnd,
                    f.centerLat, f.centerLng, polyJson
            );
        }
        return true;
    }

    public synchronized boolean persistMachine(HarvesterMachine m, String role) {
        return persistMachine(m, role, null);
    }

    public synchronized boolean persistMachine(HarvesterMachine m, String role, String userId) {
        if (isProductionStorage()) {
            if (!postgreSqlDataService.isConnectionLive()) {
                throw new IllegalStateException("PostgreSQL is unavailable in POSTGRESQL_PRODUCTION mode (connection is not live). Fail-fast enforced to prevent silent in-memory data drift.");
            }
            boolean synced = postgreSqlDataService.syncMachine(m.organizationId, role, userId != null ? userId : m.ownerUserId, m.machineId, m.ownerUserId, m.name, m.machineType, m.model, m.capacityHaPerHr, m.status, m.fuelPct, m.healthPct, m.currentLat, m.currentLng);
            if (!synced) {
                throw new IllegalStateException("Failed to persist machine " + m.machineId + " to PostgreSQL in POSTGRESQL_PRODUCTION mode. In-memory state unchanged.");
            }
            machines.put(m.machineId, m);
            return true;
        }

        // DEV_MOCK_STANDALONE MODE:
        machines.put(m.machineId, m);
        if (postgreSqlDataService.isConnectionLive()) {
            postgreSqlDataService.syncMachine(m.organizationId, role, userId != null ? userId : m.ownerUserId, m.machineId, m.ownerUserId, m.name, m.machineType, m.model, m.capacityHaPerHr, m.status, m.fuelPct, m.healthPct, m.currentLat, m.currentLng);
        }
        return true;
    }

    public synchronized boolean persistServiceRequest(ServiceRequest r, String role) {
        return persistServiceRequest(r, role, null);
    }

    public synchronized boolean persistServiceRequest(ServiceRequest r, String role, String userId) {
        if (isProductionStorage()) {
            if (!postgreSqlDataService.isConnectionLive()) {
                throw new IllegalStateException("PostgreSQL is unavailable in POSTGRESQL_PRODUCTION mode (connection is not live). Fail-fast enforced to prevent silent in-memory data drift.");
            }
            boolean synced = postgreSqlDataService.syncServiceRequest(r.organizationId, role, userId != null ? userId : r.requesterUserId, r.requestId, r.fieldId, r.requesterUserId, r.areaHa, r.requestedStart, r.requestedEnd, r.priority, r.status, r.bpmnProcessId, r.correlationId, r.notes);
            if (!synced) {
                throw new IllegalStateException("Failed to persist service request " + r.requestId + " to PostgreSQL in POSTGRESQL_PRODUCTION mode. In-memory state unchanged.");
            }
            serviceRequests.put(r.requestId, r);
            return true;
        }

        // DEV_MOCK_STANDALONE MODE:
        serviceRequests.put(r.requestId, r);
        if (postgreSqlDataService.isConnectionLive()) {
            postgreSqlDataService.syncServiceRequest(r.organizationId, role, userId != null ? userId : r.requesterUserId, r.requestId, r.fieldId, r.requesterUserId, r.areaHa, r.requestedStart, r.requestedEnd, r.priority, r.status, r.bpmnProcessId, r.correlationId, r.notes);
        }
        return true;
    }

    public synchronized boolean persistAssignment(DispatchAssignment a, String role) {
        return persistAssignment(a, role, null);
    }

    public synchronized boolean persistAssignment(DispatchAssignment a, String role, String userId) {
        if (isProductionStorage()) {
            if (!postgreSqlDataService.isConnectionLive()) {
                throw new IllegalStateException("PostgreSQL is unavailable in POSTGRESQL_PRODUCTION mode (connection is not live). Fail-fast enforced to prevent silent in-memory data drift.");
            }
            boolean synced = postgreSqlDataService.syncAssignment(a.organizationId, role, userId != null ? userId : a.createdBy, a.assignmentId, a.requestId, a.fieldId, a.machineId, a.operatorId, a.startTime, a.endTime, a.status, a.replacesAssignmentId, a.supersededByAssignmentId, null, a.correlationId, a.createdBy);
            if (!synced) {
                throw new IllegalStateException("Failed to persist assignment " + a.assignmentId + " to PostgreSQL in POSTGRESQL_PRODUCTION mode. In-memory state unchanged.");
            }
            assignments.put(a.assignmentId, a);
            return true;
        }

        // DEV_MOCK_STANDALONE MODE:
        assignments.put(a.assignmentId, a);
        if (postgreSqlDataService.isConnectionLive()) {
            postgreSqlDataService.syncAssignment(a.organizationId, role, userId != null ? userId : a.createdBy, a.assignmentId, a.requestId, a.fieldId, a.machineId, a.operatorId, a.startTime, a.endTime, a.status, a.replacesAssignmentId, a.supersededByAssignmentId, null, a.correlationId, a.createdBy);
        }
        return true;
    }

    public synchronized boolean persistIncident(MachineIncident inc, String role) {
        return persistIncident(inc, role, null);
    }

    public synchronized boolean persistIncident(MachineIncident inc, String role, String userId) {
        if (isProductionStorage()) {
            if (!postgreSqlDataService.isConnectionLive()) {
                throw new IllegalStateException("PostgreSQL is unavailable in POSTGRESQL_PRODUCTION mode (connection is not live). Fail-fast enforced to prevent silent in-memory data drift.");
            }
            boolean synced = postgreSqlDataService.syncIncident(inc.organizationId, role, userId != null ? userId : inc.reportedByUserId, inc.incidentId, inc.machineId, inc.reportedByUserId, inc.severity, inc.incidentType, inc.description, inc.estimatedDowntimeHours, inc.evidenceObjectKey, inc.evidenceEtag, inc.repairTicketId, inc.assignedRepairUserId, inc.status, inc.bpmnProcessId, inc.correlationId);
            if (!synced) {
                throw new IllegalStateException("Failed to persist incident " + inc.incidentId + " to PostgreSQL in POSTGRESQL_PRODUCTION mode. In-memory state unchanged.");
            }
            incidents.put(inc.incidentId, inc);
            return true;
        }

        // DEV_MOCK_STANDALONE MODE:
        incidents.put(inc.incidentId, inc);
        if (postgreSqlDataService.isConnectionLive()) {
            postgreSqlDataService.syncIncident(inc.organizationId, role, userId != null ? userId : inc.reportedByUserId, inc.incidentId, inc.machineId, inc.reportedByUserId, inc.severity, inc.incidentType, inc.description, inc.estimatedDowntimeHours, inc.evidenceObjectKey, inc.evidenceEtag, inc.repairTicketId, inc.assignedRepairUserId, inc.status, inc.bpmnProcessId, inc.correlationId);
        }
        return true;
    }

    public synchronized boolean persistWorkAcceptance(WorkAcceptance acc, String role) {
        return persistWorkAcceptance(acc, role, null);
    }

    public synchronized boolean persistWorkAcceptance(WorkAcceptance acc, String role, String userId) {
        if (isProductionStorage()) {
            if (!postgreSqlDataService.isConnectionLive()) {
                throw new IllegalStateException("PostgreSQL is unavailable in POSTGRESQL_PRODUCTION mode (connection is not live). Fail-fast enforced to prevent silent in-memory data drift.");
            }
            boolean synced = postgreSqlDataService.syncWorkAcceptance(acc.organizationId(), role, userId != null ? userId : (acc.farmerConfirmedBy() != null ? acc.farmerConfirmedBy() : acc.operatorSubmittedBy()), acc.acceptanceId(), acc.assignmentId(), acc.requestId(), acc.completedAreaHa(), acc.evidenceObjectKey(), acc.operatorSubmittedBy(), acc.farmerConfirmedBy(), acc.confirmationStatus(), acc.notes(), acc.correlationId());
            if (!synced) {
                throw new IllegalStateException("Failed to persist work acceptance " + acc.acceptanceId() + " to PostgreSQL in POSTGRESQL_PRODUCTION mode. In-memory state unchanged.");
            }
            acceptances.put(acc.acceptanceId(), acc);
            return true;
        }

        // DEV_MOCK_STANDALONE MODE:
        acceptances.put(acc.acceptanceId(), acc);
        if (postgreSqlDataService.isConnectionLive()) {
            postgreSqlDataService.syncWorkAcceptance(acc.organizationId(), role, userId != null ? userId : (acc.farmerConfirmedBy() != null ? acc.farmerConfirmedBy() : acc.operatorSubmittedBy()), acc.acceptanceId(), acc.assignmentId(), acc.requestId(), acc.completedAreaHa(), acc.evidenceObjectKey(), acc.operatorSubmittedBy(), acc.farmerConfirmedBy(), acc.confirmationStatus(), acc.notes(), acc.correlationId());
        }
        return true;
    }

    public synchronized List<Map<String, Object>> queryDatabaseOperatorsWithRls(String orgId, String role) {
        return postgreSqlDataService.queryWithRls(orgId, role, "operators");
    }

    public synchronized List<Map<String, Object>> queryDatabaseAcceptancesWithRls(String orgId, String role) {
        return queryDatabaseAcceptancesWithRls(orgId, role, null);
    }

    public synchronized List<Map<String, Object>> queryDatabaseAcceptancesWithRls(String orgId, String role, String userId) {
        return postgreSqlDataService.queryWithRls(orgId, role, userId, "work_acceptances");
    }

    public synchronized List<Map<String, Object>> queryDatabaseFieldsWithRls(String orgId, String role) {
        return queryDatabaseFieldsWithRls(orgId, role, null);
    }

    public synchronized List<Map<String, Object>> queryDatabaseFieldsWithRls(String orgId, String role, String userId) {
        return postgreSqlDataService.queryWithRls(orgId, role, userId, "fields");
    }

    public synchronized List<Map<String, Object>> queryDatabaseServiceRequestsWithRls(String orgId, String role) {
        return queryDatabaseServiceRequestsWithRls(orgId, role, null);
    }

    public synchronized List<Map<String, Object>> queryDatabaseServiceRequestsWithRls(String orgId, String role, String userId) {
        return postgreSqlDataService.queryWithRls(orgId, role, userId, "service_requests");
    }

    public synchronized List<Map<String, Object>> queryDatabaseAssignmentsWithRls(String orgId, String role) {
        return queryDatabaseAssignmentsWithRls(orgId, role, null);
    }

    public synchronized List<Map<String, Object>> queryDatabaseAssignmentsWithRls(String orgId, String role, String userId) {
        return postgreSqlDataService.queryWithRls(orgId, role, userId, "assignments");
    }

    public synchronized List<Map<String, Object>> queryDatabaseIncidentsWithRls(String orgId, String role) {
        return queryDatabaseIncidentsWithRls(orgId, role, null);
    }

    public synchronized List<Map<String, Object>> queryDatabaseIncidentsWithRls(String orgId, String role, String userId) {
        return postgreSqlDataService.queryWithRls(orgId, role, userId, "incidents");
    }

    /**
     * Cold-start rehydration: restores domain entities and audit ledger
     * directly from PostgreSQL 16 (Single Source of Truth).
     */
    public synchronized boolean loadFromDatabase() {
        if (!postgreSqlDataService.isConnectionLive()) {
            return false;
        }

        organizations.clear();
        usersByUsername.clear();
        fields.clear();
        machines.clear();
        operators.clear();
        serviceRequests.clear();
        assignments.clear();
        incidents.clear();
        acceptances.clear();
        auditLedger.clear();

        // 1. Organizations
        List<Map<String, Object>> orgRows = postgreSqlDataService.queryAll("organizations");
        for (Map<String, Object> r : orgRows) {
            String orgId = String.valueOf(r.get("organization_id"));
            String name = String.valueOf(r.get("name"));
            String type = String.valueOf(r.get("org_type"));
            String province = r.get("province") != null ? String.valueOf(r.get("province")) : "Cần Thơ";
            String status = r.get("status") != null ? String.valueOf(r.get("status")) : "ACTIVE";
            addOrg(new Organization(orgId, name, type, province, status));
        }

        // 2. Users
        List<Map<String, Object>> userRows = postgreSqlDataService.queryAll("users");
        for (Map<String, Object> r : userRows) {
            String userId = String.valueOf(r.get("user_id"));
            String username = String.valueOf(r.get("username"));
            String fullName = String.valueOf(r.get("full_name"));
            String orgId = String.valueOf(r.get("organization_id"));
            String role = String.valueOf(r.get("role"));
            String email = username + "@openagrios.vn";
            addUser(new UserAccount(userId, username, "123456", fullName, email, orgId, role));
        }

        // 3. Fields
        List<Map<String, Object>> fieldRows = postgreSqlDataService.queryAll("fields");
        for (Map<String, Object> r : fieldRows) {
            String fId = String.valueOf(r.get("field_id"));
            String orgId = String.valueOf(r.get("organization_id"));
            String ownerId = String.valueOf(r.get("owner_user_id"));
            String name = String.valueOf(r.get("name"));
            String hamlet = r.get("hamlet") != null ? String.valueOf(r.get("hamlet")) : "";
            String crop = r.get("crop") != null ? String.valueOf(r.get("crop")) : "Lúa OM18";
            double area = r.get("area_ha") instanceof Number n ? n.doubleValue() : 2.0;
            String status = r.get("readiness_status") != null ? String.valueOf(r.get("readiness_status")) : "READY_HARVEST";
            double prog = r.get("harvest_progress_pct") instanceof Number n ? n.doubleValue() : 0.0;
            String wStart = r.get("window_start") != null ? String.valueOf(r.get("window_start")) : "2026-11-20T07:00:00Z";
            String wEnd = r.get("window_end") != null ? String.valueOf(r.get("window_end")) : "2026-11-20T17:00:00Z";
            double lat = r.get("center_lat") instanceof Number n ? n.doubleValue() : 10.06;
            double lng = r.get("center_lng") instanceof Number n ? n.doubleValue() : 105.55;

            String ownerName = ownerId;
            for (UserAccount u : usersByUsername.values()) {
                if (u.userId().equals(ownerId)) {
                    ownerName = u.fullName();
                    break;
                }
            }
            List<List<List<Double>>> poly = SpatialMatchingEngine.makeGeoJsonPolygon(lat, lng, 0.0028, 0.0036);
            fields.put(fId, new FieldPlot(fId, orgId, ownerId, ownerName, name, hamlet, crop, area, status, prog, wStart, wEnd, lat, lng, poly));
        }

        // 4. Machines
        List<Map<String, Object>> machineRows = postgreSqlDataService.queryAll("machines");
        for (Map<String, Object> r : machineRows) {
            String mId = String.valueOf(r.get("machine_id"));
            String orgId = String.valueOf(r.get("organization_id"));
            String ownerId = String.valueOf(r.get("owner_user_id"));
            String name = String.valueOf(r.get("name"));
            String type = r.get("machine_type") != null ? String.valueOf(r.get("machine_type")) : "COMBINE_HARVESTER";
            String model = r.get("model") != null ? String.valueOf(r.get("model")) : "Kubota DC-70 Plus";
            double cap = r.get("capacity_ha_per_hr") instanceof Number n ? n.doubleValue() : 0.65;
            String status = r.get("status") != null ? String.valueOf(r.get("status")) : "IDLE";
            double fuel = r.get("fuel_pct") instanceof Number n ? n.doubleValue() : 100.0;
            double health = r.get("health_pct") instanceof Number n ? n.doubleValue() : 100.0;
            double lat = r.get("current_lat") instanceof Number n ? n.doubleValue() : 10.06;
            double lng = r.get("current_lng") instanceof Number n ? n.doubleValue() : 105.55;
            String opId = r.get("assigned_operator_id") != null ? String.valueOf(r.get("assigned_operator_id")) : null;
            String telem = r.get("telemetry_updated_at") != null ? String.valueOf(r.get("telemetry_updated_at")) : simTime;
            machines.put(mId, new HarvesterMachine(mId, orgId, ownerId, name, type, model, cap, status, fuel, health, lat, lng, opId, telem));
        }

        // 5. Operators
        List<Map<String, Object>> opRows = postgreSqlDataService.queryAll("operators");
        for (Map<String, Object> r : opRows) {
            String opId = String.valueOf(r.get("operator_id"));
            String uId = String.valueOf(r.get("user_id"));
            String orgId = String.valueOf(r.get("organization_id"));
            String fName = String.valueOf(r.get("full_name"));
            double rating = r.get("rating") instanceof Number n ? n.doubleValue() : 4.8;
            String status = r.get("status") != null ? String.valueOf(r.get("status")) : "AVAILABLE";
            operators.put(opId, new OperatorProfile(opId, uId, orgId, fName, List.of("COMBINE_HARVESTER"), rating, status));
        }

        // 6. Service Requests
        List<Map<String, Object>> reqRows = postgreSqlDataService.queryAll("service_requests");
        for (Map<String, Object> r : reqRows) {
            String reqId = String.valueOf(r.get("request_id"));
            String orgId = String.valueOf(r.get("organization_id"));
            String fId = String.valueOf(r.get("field_id"));
            String reqUser = String.valueOf(r.get("requester_user_id"));
            double area = r.get("area_ha") instanceof Number n ? n.doubleValue() : 2.0;
            String reqStart = String.valueOf(r.get("requested_start"));
            String reqEnd = String.valueOf(r.get("requested_end"));
            String priority = r.get("priority") != null ? String.valueOf(r.get("priority")) : "NORMAL";
            String status = r.get("status") != null ? String.valueOf(r.get("status")) : "PENDING_SCHEDULE";
            String bpmnId = r.get("bpmn_process_id") != null ? String.valueOf(r.get("bpmn_process_id")) : null;
            String corrId = r.get("correlation_id") != null ? String.valueOf(r.get("correlation_id")) : "CORR-" + reqId;
            String notes = r.get("notes") != null ? String.valueOf(r.get("notes")) : "";
            String created = r.get("created_at") != null ? String.valueOf(r.get("created_at")) : simTime;
            serviceRequests.put(reqId, new ServiceRequest(reqId, orgId, fId, reqUser, area, reqStart, reqEnd, priority, status, bpmnId, corrId, notes, created));
        }

        // 7. Assignments
        List<Map<String, Object>> asgRows = postgreSqlDataService.queryAll("assignments");
        for (Map<String, Object> r : asgRows) {
            String asgId = String.valueOf(r.get("assignment_id"));
            String orgId = String.valueOf(r.get("organization_id"));
            String reqId = String.valueOf(r.get("request_id"));
            String fId = String.valueOf(r.get("field_id"));
            String mId = String.valueOf(r.get("machine_id"));
            String opId = String.valueOf(r.get("operator_id"));
            String sTime = String.valueOf(r.get("start_time"));
            String eTime = String.valueOf(r.get("end_time"));
            String status = r.get("status") != null ? String.valueOf(r.get("status")) : "CONFIRMED";
            String replaces = r.get("replaces_assignment_id") != null ? String.valueOf(r.get("replaces_assignment_id")) : null;
            String superseded = r.get("superseded_by_assignment_id") != null ? String.valueOf(r.get("superseded_by_assignment_id")) : null;
            String corrId = r.get("correlation_id") != null ? String.valueOf(r.get("correlation_id")) : "CORR-" + asgId;
            String createdBy = r.get("created_by") != null ? String.valueOf(r.get("created_by")) : "usr_coord_01";
            String created = r.get("created_at") != null ? String.valueOf(r.get("created_at")) : simTime;
            assignments.put(asgId, new DispatchAssignment(asgId, orgId, reqId, fId, mId, opId, sTime, eTime, status, replaces, superseded, corrId, createdBy, created));
        }

        // 8. Incidents
        List<Map<String, Object>> incRows = postgreSqlDataService.queryAll("incidents");
        for (Map<String, Object> r : incRows) {
            String incId = String.valueOf(r.get("incident_id"));
            String orgId = String.valueOf(r.get("organization_id"));
            String mId = String.valueOf(r.get("machine_id"));
            String repUser = String.valueOf(r.get("reported_by_user_id"));
            String sev = r.get("severity") != null ? String.valueOf(r.get("severity")) : "HIGH";
            String incType = r.get("incident_type") != null ? String.valueOf(r.get("incident_type")) : "BREAKDOWN";
            String desc = r.get("description") != null ? String.valueOf(r.get("description")) : "";
            double down = r.get("estimated_downtime_hours") instanceof Number n ? n.doubleValue() : 24.0;
            String objKey = r.get("evidence_object_key") != null ? String.valueOf(r.get("evidence_object_key")) : null;
            String etag = r.get("evidence_etag") != null ? String.valueOf(r.get("evidence_etag")) : null;
            String ticket = String.valueOf(r.get("repair_ticket_id"));
            String repTech = r.get("assigned_repair_user_id") != null ? String.valueOf(r.get("assigned_repair_user_id")) : null;
            String status = r.get("status") != null ? String.valueOf(r.get("status")) : "OPEN_REPLANNING";
            String bpmnId = r.get("bpmn_process_id") != null ? String.valueOf(r.get("bpmn_process_id")) : null;
            String corrId = r.get("correlation_id") != null ? String.valueOf(r.get("correlation_id")) : "CORR-" + incId;
            String created = r.get("created_at") != null ? String.valueOf(r.get("created_at")) : simTime;
            incidents.put(incId, new MachineIncident(incId, orgId, mId, repUser, sev, incType, desc, down, objKey, etag, ticket, repTech, status, bpmnId, List.of(), List.of(), null, corrId, created));
        }

        // 9. Work Acceptances
        List<Map<String, Object>> accRows = postgreSqlDataService.queryAll("work_acceptances");
        for (Map<String, Object> r : accRows) {
            String accId = String.valueOf(r.get("acceptance_id"));
            String orgId = String.valueOf(r.get("organization_id"));
            String asgId = String.valueOf(r.get("assignment_id"));
            String reqId = String.valueOf(r.get("request_id"));
            double compArea = r.get("completed_area_ha") instanceof Number n ? n.doubleValue() : 0.0;
            String objKey = r.get("evidence_object_key") != null ? String.valueOf(r.get("evidence_object_key")) : null;
            String opSub = String.valueOf(r.get("operator_submitted_by"));
            String farmConf = r.get("farmer_confirmed_by") != null ? String.valueOf(r.get("farmer_confirmed_by")) : null;
            String confStatus = r.get("confirmation_status") != null ? String.valueOf(r.get("confirmation_status")) : "PENDING_FARMER";
            String notes = r.get("notes") != null ? String.valueOf(r.get("notes")) : "";
            String corrId = r.get("correlation_id") != null ? String.valueOf(r.get("correlation_id")) : "CORR-" + accId;
            String confAt = r.get("confirmed_at") != null ? String.valueOf(r.get("confirmed_at")) : null;
            String created = r.get("created_at") != null ? String.valueOf(r.get("created_at")) : simTime;
            acceptances.put(accId, new WorkAcceptance(accId, orgId, asgId, reqId, compArea, objKey, opSub, farmConf, confStatus, notes, corrId, confAt, created));
        }

        // 10. Audit Records
        List<Map<String, Object>> auditRows = postgreSqlDataService.queryAll("audit_records");
        List<ImmutableAuditLedger.AuditRecord> recs = new ArrayList<>();
        for (Map<String, Object> r : auditRows) {
            int seq = r.get("seq_no") instanceof Number n ? n.intValue() : recs.size() + 1;
            String evtId = String.valueOf(r.get("event_id"));
            String orgId = String.valueOf(r.get("organization_id"));
            String corrId = String.valueOf(r.get("correlation_id"));
            String entType = String.valueOf(r.get("entity_type"));
            String entId = String.valueOf(r.get("entity_id"));
            String action = String.valueOf(r.get("action"));
            String actUser = String.valueOf(r.get("actor_user_id"));
            String actRole = String.valueOf(r.get("actor_role"));
            int gwStatus = 200;
            String bJson = r.get("before_state") != null ? String.valueOf(r.get("before_state")) : "{}";
            String aJson = r.get("after_state") != null ? String.valueOf(r.get("after_state")) : "{}";
            Map<String, Object> bMap = org.openagrios.core.dataservices.JsonCodec.parseObject(bJson);
            Map<String, Object> aMap = org.openagrios.core.dataservices.JsonCodec.parseObject(aJson);
            String prevH = String.valueOf(r.get("prev_hash"));
            String recH = String.valueOf(r.get("record_hash"));
            String created = String.valueOf(r.get("created_at"));
            recs.add(new ImmutableAuditLedger.AuditRecord(seq, evtId, orgId, corrId, entType, entId, action, actUser, actRole, gwStatus, bMap, aMap, bJson, aJson, prevH, recH, created));
        }
        auditLedger.rehydrateLedger(recs);

        return true;
    }
}

