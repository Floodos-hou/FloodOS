// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenAgriOS Contributors

package org.openagrios.apps.agriops;

import org.openagrios.apps.agriops.AgriModels.*;
import org.openagrios.core.dataservices.ImmutableAuditLedger;
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

    public AgriDataStore(
            ImmutableAuditLedger auditLedger,
            SeaweedS3StorageService s3Storage,
            BpmnWorkflowEngine bpmnEngine
    ) {
        this.auditLedger = auditLedger;
        this.s3Storage = s3Storage;
        this.bpmnEngine = bpmnEngine;
        resetAndSeed();
    }

    /**
     * Storage Engine Execution Mode:
     * - Standalone / Dev / CI mode: In-memory repository with PostgreSQL RLS query compilation.
     * - Production container mode: Backed by PostgreSQL 16 with Row-Level Security (infra/db/schema.sql).
     */
    public String getStorageEngineMode() {
        String dbUrl = System.getenv("DATABASE_URL");
        return (dbUrl != null && !dbUrl.isBlank())
                ? "POSTGRESQL_16_JDBC_RLS (Active JDBC Pool: " + dbUrl + ")"
                : "IN_MEMORY_MAP_WITH_POSTGRES_RLS_COMPILER (Development Mode: RLS SQL generated)";
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
}
