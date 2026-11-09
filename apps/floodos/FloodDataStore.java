// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

package org.floodos.apps.floodos;

import org.floodos.apps.floodos.FloodModels.*;
import org.floodos.core.dataservices.AnalyticsLakeClient;
import org.floodos.core.dataservices.EventBusPublisher;
import org.floodos.core.dataservices.ImmutableAuditLedger;
import org.floodos.core.dataservices.JsonCodec;
import org.floodos.core.dataservices.MalwareScanner;
import org.floodos.core.dataservices.PostgreSqlDataService;
import org.floodos.core.dataservices.SeaweedS3StorageService;
import org.floodos.core.dataservices.SpatialMatchingEngine;
import org.floodos.core.identity.KeycloakOidcEngine.Organization;
import org.floodos.core.identity.KeycloakOidcEngine.UserAccount;
import org.floodos.core.workflow.BpmnWorkflowEngine;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Multi-tenant state of FloodOS: an in-memory working set that is written through to PostgreSQL.
 *
 * <p>Storage rules:
 * <ul>
 *   <li>With a database configured, the schema from infra/db/schema.sql must exist (fail-fast otherwise).</li>
 *   <li>In production a failed write throws and the working set is rebuilt from the database, so memory never drifts
 *       from the stored truth.</li>
 *   <li>Without a database (unit tests, local development) the store runs purely in memory.</li>
 * </ul>
 *
 * <p>All seed data below is SIMULATED demo data for one pilot area. Names are fictional; coordinates are illustrative
 * points inside Hanoi and do not describe any real flooded place. Nothing here is an official observation.
 */
public final class FloodDataStore {

    public static final String PILOT_ORG = "ORG_HN_PILOT_01";
    public static final String CONTROL_ORG = "ORG_HN_PILOT_02";
    public static final String PROCESS_REPORT = "flood_report_lifecycle";
    public static final String PROCESS_INCIDENT = "dispatch_replan_workflow";

    public final Map<String, Organization> organizations = new LinkedHashMap<>();
    public final Map<String, UserAccount> usersByUsername = new LinkedHashMap<>();
    public final Map<String, FloodZone> zones = new LinkedHashMap<>();
    public final Map<String, RescueTeam> teams = new LinkedHashMap<>();
    public final Map<String, RescueVehicle> vehicles = new LinkedHashMap<>();
    public final Map<String, FloodReport> reports = new LinkedHashMap<>();
    public final Map<String, DispatchOrder> orders = new LinkedHashMap<>();
    public final Map<String, FieldIncident> incidents = new LinkedHashMap<>();
    public final Map<String, ReportResolution> resolutions = new LinkedHashMap<>();
    public final Map<String, SafeShelter> shelters = new LinkedHashMap<>();
    public final Map<String, GaugeStation> gauges = new LinkedHashMap<>();

    public final ImmutableAuditLedger auditLedger;
    public final SeaweedS3StorageService s3Storage;
    public final BpmnWorkflowEngine bpmnEngine;
    public final PostgreSqlDataService postgreSqlDataService;
    public final FloodRepository repository;
    public final EventBusPublisher eventBus = EventBusPublisher.fromEnvironment();
    public final AnalyticsLakeClient analyticsLake = new AnalyticsLakeClient();
    public final AiAssistantClient aiAssistant = new AiAssistantClient();
    /** Malware gate for client uploads (ClamAV). Replaceable so tests can inject a scanner against a fake daemon. */
    public MalwareScanner malwareScanner = MalwareScanner.fromEnvironment();

    private final boolean databaseBacked;

    /** Analytics queries the lake archiver serves for this application (see services/lake-archiver). */
    public static final List<String> ANALYTICS_QUERIES = List.of("asset-utilization", "water-level-summary");

    public FloodDataStore(ImmutableAuditLedger auditLedger, SeaweedS3StorageService s3Storage, BpmnWorkflowEngine bpmnEngine) {
        FloodRoles.register();
        this.auditLedger = auditLedger;
        this.s3Storage = s3Storage;
        this.bpmnEngine = bpmnEngine;
        this.postgreSqlDataService = new PostgreSqlDataService();
        this.repository = new FloodRepository(postgreSqlDataService);
        this.auditLedger.setPostgreSqlDataService(postgreSqlDataService);
        this.auditLedger.setEventBus(eventBus);
        this.analyticsLake.registerQueries(ANALYTICS_QUERIES);
        // Flowable holds the process definitions from the first second (required in production, best effort in development).
        this.bpmnEngine.deployAllDefinitions(BpmnWorkflowEngine.isFlowableProduction());

        if (postgreSqlDataService.isConfigured() && isProductionStorage()) {
            waitForDatabaseAndSchema();
        }
        this.databaseBacked = postgreSqlDataService.isConfigured() && postgreSqlDataService.isConnectionLive();
        if (databaseBacked) {
            requireSchema();
            if (repository.hasData()) {
                loadFromDatabase();
            } else {
                resetAndSeed();
            }
        } else {
            resetAndSeed();
        }
    }

    // ------------------------------------------------------------------------
    // Storage mode
    // ------------------------------------------------------------------------

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
        return "POSTGRESQL_PRODUCTION".equalsIgnoreCase(System.getenv("FLOODOS_STORAGE_MODE"))
                || "KEYCLOAK_PRODUCTION".equalsIgnoreCase(System.getenv("FLOODOS_AUTH_MODE"));
    }

    public boolean isDatabaseBacked() {
        return databaseBacked;
    }

    public String getStorageEngineMode() {
        if (databaseBacked) {
            return "POSTGRESQL_16_JDBC_RLS (" + postgreSqlDataService.getDbUrl() + ", CONNECTED, RLS ENFORCED)";
        }
        if (postgreSqlDataService.isConfigured()) {
            return "IN_MEMORY (PostgreSQL configured at " + postgreSqlDataService.getDbUrl() + " but unreachable: development fallback)";
        }
        return "IN_MEMORY (no database configured: development / unit-test mode)";
    }

    /** Production waits (bounded) for PostgreSQL and for the schema script to finish, then gives up loudly. */
    private void waitForDatabaseAndSchema() {
        int attempts = 45;
        for (int i = 1; i <= attempts; i++) {
            if (postgreSqlDataService.isConnectionLive()
                    && postgreSqlDataService.missingTables(FloodRepository.requiredTables()).isEmpty()) {
                return;
            }
            try {
                Thread.sleep(2000);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            }
        }
        List<String> missing = postgreSqlDataService.isConnectionLive()
                ? postgreSqlDataService.missingTables(FloodRepository.requiredTables()) : List.of("(database unreachable)");
        throw new IllegalStateException("POSTGRESQL_PRODUCTION: database or schema not ready after " + attempts * 2
                + "s. Missing: " + missing + ". infra/db/schema.sql is applied by the postgres container on start.");
    }

    private void requireSchema() {
        List<String> missing = postgreSqlDataService.missingTables(FloodRepository.requiredTables());
        if (!missing.isEmpty()) {
            throw new IllegalStateException("The database schema is incomplete, missing tables " + missing
                    + ". Apply infra/db/schema.sql (the postgres container does it on every start).");
        }
    }

    // ------------------------------------------------------------------------
    // Persistence
    // ------------------------------------------------------------------------

    /**
     * Writes the entities in ONE transaction under the caller's RLS context, then publishes them to the working set.
     * In production a failed write rebuilds the working set from the database and throws.
     */
    public synchronized void commit(String orgId, String role, String userId, Object... entities) {
        if (databaseBacked) {
            try {
                repository.saveAll(orgId, role, userId, entities);
            } catch (RuntimeException e) {
                if (isProductionStorage()) {
                    try {
                        loadFromDatabase();
                    } catch (RuntimeException reloadFailure) {
                        System.err.println("[STORE] reload after failed write also failed: " + reloadFailure.getMessage());
                    }
                    throw new IllegalStateException("Persisting to PostgreSQL failed; changes were discarded: " + e.getMessage(), e);
                }
                System.err.println("[STORE] write-through to PostgreSQL failed (development mode, kept in memory): " + e.getMessage());
            }
        }
        for (Object e : entities) publish(e);
    }

    private void publish(Object e) {
        if (e instanceof FloodZone z) zones.put(z.zoneId, z);
        else if (e instanceof RescueTeam t) teams.put(t.teamId(), t);
        else if (e instanceof RescueVehicle v) vehicles.put(v.vehicleId, v);
        else if (e instanceof FloodReport r) reports.put(r.reportId, r);
        else if (e instanceof DispatchOrder o) orders.put(o.orderId, o);
        else if (e instanceof FieldIncident i) incidents.put(i.incidentId, i);
        else if (e instanceof ReportResolution r) resolutions.put(r.resolutionId, r);
        else if (e instanceof SafeShelter s) shelters.put(s.shelterId, s);
        else if (e instanceof GaugeStation g) gauges.put(g.stationId, g);
    }

    private void clearWorkingSet() {
        organizations.clear();
        usersByUsername.clear();
        zones.clear();
        teams.clear();
        vehicles.clear();
        reports.clear();
        orders.clear();
        incidents.clear();
        resolutions.clear();
        shelters.clear();
        gauges.clear();
    }

    /** Cold start from PostgreSQL (the single source of truth): working set, workflow mirror and audit ledger. */
    public synchronized boolean loadFromDatabase() {
        clearWorkingSet();
        bpmnEngine.clearInstances();
        auditLedger.clear();

        for (Map<String, Object> r : postgreSqlDataService.queryAll("organizations")) {
            organizations.put(String.valueOf(r.get("organization_id")), new Organization(
                    String.valueOf(r.get("organization_id")), String.valueOf(r.get("name")), String.valueOf(r.get("org_type")),
                    r.get("province") != null ? String.valueOf(r.get("province")) : "Hà Nội",
                    r.get("status") != null ? String.valueOf(r.get("status")) : "ACTIVE"));
        }
        for (Map<String, Object> r : postgreSqlDataService.queryAll("users")) {
            String username = String.valueOf(r.get("username"));
            String role = String.valueOf(r.get("role"));
            if (!FloodRoles.ALL.contains(role)) continue; // a user left over from an older application: not loaded
            usersByUsername.put(username, new UserAccount(String.valueOf(r.get("user_id")), username,
                    seedPassword(username), String.valueOf(r.get("full_name")), username + EMAIL_DOMAIN,
                    String.valueOf(r.get("organization_id")), role));
        }
        FloodRepository.Snapshot snap = repository.loadAll();
        for (FloodZone z : snap.zones()) zones.put(z.zoneId, z);
        for (RescueTeam t : snap.teams()) teams.put(t.teamId(), t);
        for (RescueVehicle v : snap.vehicles()) vehicles.put(v.vehicleId, v);
        for (FloodReport r : snap.reports()) reports.put(r.reportId, r);
        for (DispatchOrder o : snap.orders()) orders.put(o.orderId, o);
        for (FieldIncident i : snap.incidents()) incidents.put(i.incidentId, i);
        for (ReportResolution r : snap.resolutions()) resolutions.put(r.resolutionId, r);
        for (SafeShelter s : snap.shelters()) shelters.put(s.shelterId, s);
        for (GaugeStation g : snap.gauges()) gauges.put(g.stationId, g);

        rebuildWorkflowMirror();
        rehydrateAuditLedger();
        return true;
    }

    private void rehydrateAuditLedger() {
        // Restore only the newest ledger epoch (an independent chain from genesis) with the exact hashed material, so
        // GET /audit/verify still passes after a restart. Rows without an epoch predate this format and stay as
        // unverifiable history.
        List<Map<String, Object>> auditRows = postgreSqlDataService.queryAll("audit_records");
        String liveEpoch = null;
        for (Map<String, Object> r : auditRows) {
            if (r.get("ledger_epoch") != null) liveEpoch = String.valueOf(r.get("ledger_epoch"));
        }
        List<ImmutableAuditLedger.AuditRecord> recs = new ArrayList<>();
        for (Map<String, Object> r : auditRows) {
            if (liveEpoch == null || !liveEpoch.equals(String.valueOf(r.get("ledger_epoch")))) continue;
            int seq = r.get("ledger_seq") instanceof Number n ? n.intValue() : recs.size() + 1;
            String bJson = r.get("before_canonical") != null ? String.valueOf(r.get("before_canonical")) : "{}";
            String aJson = r.get("after_canonical") != null ? String.valueOf(r.get("after_canonical")) : "{}";
            recs.add(new ImmutableAuditLedger.AuditRecord(
                    seq,
                    String.valueOf(r.get("event_id")),
                    String.valueOf(r.get("organization_id")),
                    String.valueOf(r.get("correlation_id")),
                    String.valueOf(r.get("entity_type")),
                    String.valueOf(r.get("entity_id")),
                    String.valueOf(r.get("action")),
                    String.valueOf(r.get("actor_user_id")),
                    String.valueOf(r.get("actor_role")),
                    r.get("gateway_status") instanceof Number g ? g.intValue() : 200,
                    JsonCodec.parseObject(bJson),
                    JsonCodec.parseObject(aJson),
                    bJson, aJson,
                    String.valueOf(r.get("prev_hash")),
                    String.valueOf(r.get("record_hash")),
                    r.get("ledger_ts") != null ? String.valueOf(r.get("ledger_ts")) : String.valueOf(r.get("created_at"))
            ));
        }
        recs.sort(java.util.Comparator.comparingInt(ImmutableAuditLedger.AuditRecord::seqNo));
        auditLedger.rehydrateLedger(recs, liveEpoch);
    }

    // ------------------------------------------------------------------------
    // Workflow mirror
    // ------------------------------------------------------------------------

    /** Where a report sits in flood_report_lifecycle for each status: {stepId, stepName, candidateGroup}. */
    public static String[] reportStep(String status) {
        return switch (status) {
            case "RECEIVED" -> new String[]{"taskDispatcherVerify", "Điều phối viên xác minh tin báo và xếp mức ưu tiên", FloodRoles.DISPATCHER};
            case "VERIFIED" -> new String[]{"taskDispatcherDispatch", "Điều phối viên ghép đội và phương tiện, kiểm tra xung đột lịch", FloodRoles.DISPATCHER};
            case "DISPATCHED", "IN_PROGRESS", "IMPACTED", "RESCHEDULED" -> new String[]{"taskFieldTeamExecute", "Đội hiện trường xử lý và cập nhật tiến độ", FloodRoles.FIELD_TEAM};
            case "AWAITING_CONFIRMATION" -> new String[]{"taskReporterConfirm", "Người báo tin (hoặc điều phối viên) xác nhận đã xử lý xong", FloodRoles.REPORTER};
            case "RESOLVED" -> new String[]{"endResolved", "Đóng vụ việc và niêm phong sổ cái SHA-256", "COMPLETED"};
            case "REJECTED" -> new String[]{"endRejected", "Từ chối tin báo, lưu dấu kiểm toán", "COMPLETED"};
            default -> throw new IllegalArgumentException("Unknown report status " + status);
        };
    }

    /** Where an incident sits in dispatch_replan_workflow for each status. */
    public static String[] incidentStep(String status) {
        return switch (status) {
            case "OPEN_REPLANNING" -> new String[]{"taskDispatcherApproveReplan", "Điều phối viên phê duyệt phương án thay thế", FloodRoles.DISPATCHER};
            case "REPLAN_APPROVED" -> new String[]{"taskFieldTeamAcknowledge", "Đội thay thế nhận lệnh và xuất phát", FloodRoles.FIELD_TEAM};
            case "UNDER_REPAIR" -> new String[]{"taskResourceManagerRepair", "Quản lý nguồn lực tiếp nhận phiếu sửa chữa và khắc phục phương tiện", FloodRoles.RESOURCE_MANAGER};
            case "RESOLVED" -> new String[]{"endRepair", "Hoàn tất phiếu sửa chữa", "COMPLETED"};
            default -> throw new IllegalArgumentException("Unknown incident status " + status);
        };
    }

    /** Rebuilds the local workflow state mirror from the business rows (nothing is started in Flowable). */
    private void rebuildWorkflowMirror() {
        for (FloodReport r : reports.values()) {
            String[] step = reportStep(r.status);
            boolean done = "COMPLETED".equals(step[2]);
            List<Map<String, Object>> history = List.of(BpmnWorkflowEngine.makeStepHistory(
                    "startReport", "Khôi phục từ cơ sở dữ liệu: tin báo " + r.reportId + " ở trạng thái " + r.status,
                    "SYSTEM", "PLATFORM_ADMIN", r.updatedAt != null ? r.updatedAt : r.createdAt));
            bpmnEngine.restoreInstance(r.bpmnProcessId != null ? r.bpmnProcessId : "PRC-" + r.reportId, r.organizationId,
                    PROCESS_REPORT, r.reportId, step[0], step[1], step[2], done, history, r.updatedAt != null ? r.updatedAt : r.createdAt);
        }
        for (FieldIncident i : incidents.values()) {
            String[] step = incidentStep(i.status);
            boolean done = "COMPLETED".equals(step[2]);
            List<Map<String, Object>> history = List.of(BpmnWorkflowEngine.makeStepHistory(
                    "startIncident", "Khôi phục từ cơ sở dữ liệu: sự cố " + i.incidentId + " ở trạng thái " + i.status,
                    "SYSTEM", "PLATFORM_ADMIN", i.createdAt));
            bpmnEngine.restoreInstance(i.bpmnProcessId != null ? i.bpmnProcessId : "PRC-" + i.incidentId, i.organizationId,
                    PROCESS_INCIDENT, i.incidentId, step[0], step[1], step[2], done, history, i.createdAt);
        }
    }

    // ------------------------------------------------------------------------
    // Seed (SIMULATED demo data)
    // ------------------------------------------------------------------------

    private static final String EMAIL_DOMAIN = "@floodos.example";
    private static final String DEMO_PASSWORD = "123456";

    private static String seedPassword(String username) {
        return DEMO_PASSWORD;
    }

    private static String iso(Instant t) {
        return t.truncatedTo(ChronoUnit.SECONDS).toString();
    }

    /** Clears business activity and re-creates the demo data set. The audit ledger starts a new epoch. */
    public synchronized void resetAndSeed() {
        if (databaseBacked) {
            try {
                repository.deleteTransactional();
            } catch (RuntimeException e) {
                if (isProductionStorage()) {
                    throw new IllegalStateException("Could not clear transactional data in PostgreSQL during reset (fail-fast): " + e.getMessage(), e);
                }
                System.err.println("[STORE] could not clear transactional data: " + e.getMessage());
            }
        }
        clearWorkingSet();
        auditLedger.clear();
        s3Storage.clear();
        bpmnEngine.clearInstances();

        Instant base = Instant.now().truncatedTo(ChronoUnit.HOURS);
        String now = iso(Instant.now());

        organizations.put(PILOT_ORG, new Organization(PILOT_ORG,
                "Ban chỉ huy phòng chống thiên tai địa bàn thí điểm Hà Nội (dữ liệu mô phỏng)", "LOCAL_COMMAND", "Hà Nội", "ACTIVE"));
        organizations.put(CONTROL_ORG, new Organization(CONTROL_ORG,
                "Đơn vị đối chứng để kiểm thử cô lập tenant (dữ liệu mô phỏng)", "LOCAL_COMMAND", "Hà Nội", "ACTIVE"));

        addUser("reporter_lan", "Chị Lan (người dân báo tin)", PILOT_ORG, FloodRoles.REPORTER);
        addUser("reporter_hung", "Anh Hùng (người dân báo tin)", PILOT_ORG, FloodRoles.REPORTER);
        addUser("dispatcher_hoa", "Chị Hoa (điều phối viên)", PILOT_ORG, FloodRoles.DISPATCHER);
        addUser("team_binh", "Anh Bình (đội trưởng đội xuồng cứu hộ 01)", PILOT_ORG, FloodRoles.FIELD_TEAM);
        addUser("team_cuong", "Anh Cường (đội trưởng đội cơ động 02)", PILOT_ORG, FloodRoles.FIELD_TEAM);
        addUser("team_dung", "Anh Dũng (đội trưởng đội bơm tiêu úng 03)", PILOT_ORG, FloodRoles.FIELD_TEAM);
        addUser("resource_giang", "Chị Giang (quản lý nguồn lực)", PILOT_ORG, FloodRoles.RESOURCE_MANAGER);
        addUser("platform_admin", "Quản trị nền tảng", PILOT_ORG, FloodRoles.PLATFORM_ADMIN);
        addUser("reporter_mai", "Chị Mai (người dân, đơn vị đối chứng)", CONTROL_ORG, FloodRoles.REPORTER);
        addUser("dispatcher_tuan", "Anh Tuấn (điều phối viên, đơn vị đối chứng)", CONTROL_ORG, FloodRoles.DISPATCHER);
        addUser("team_hai", "Anh Hải (đội trưởng, đơn vị đối chứng)", CONTROL_ORG, FloodRoles.FIELD_TEAM);

        // Zones: illustrative points in Hanoi, fictional names. Water levels are SEED values until a gauge reports.
        addZone("Z01", PILOT_ORG, "Khu dân cư ven sông A (mô phỏng)", "WARNING", 65.0, 20.9660, 105.8710, 18.0, now);
        addZone("Z02", PILOT_ORG, "Khu dân cư ven sông B (mô phỏng)", "CRITICAL", 110.0, 20.9585, 105.8835, 25.0, now);
        addZone("Z03", PILOT_ORG, "Cụm trũng thấp C (mô phỏng)", "WATCH", 35.0, 20.9730, 105.8590, 12.0, now);
        addZone("Z04", PILOT_ORG, "Tuyến đường ngập D (mô phỏng)", "WATCH", 28.0, 20.9810, 105.8770, 9.0, now);
        addZone("Z91", CONTROL_ORG, "Khu vực đối chứng (mô phỏng)", "WATCH", 30.0, 21.0300, 105.7900, 10.0, now);

        teams.put("T01", new RescueTeam("T01", PILOT_ORG, "usr_team_binh", "Đội xuồng cứu hộ 01", 5, List.of("BOAT_RESCUE", "EVACUATION"), 4.8, "ON_MISSION"));
        teams.put("T02", new RescueTeam("T02", PILOT_ORG, "usr_team_cuong", "Đội cơ động 02", 6, List.of("HIGH_WATER_TRUCK", "EVACUATION", "BOAT_RESCUE"), 4.6, "AVAILABLE"));
        teams.put("T03", new RescueTeam("T03", PILOT_ORG, "usr_team_dung", "Đội bơm tiêu úng 03", 4, List.of("PUMPING"), 4.7, "AVAILABLE"));
        teams.put("T91", new RescueTeam("T91", CONTROL_ORG, "usr_team_hai", "Đội đối chứng 91", 3, List.of("BOAT_RESCUE"), 4.0, "AVAILABLE"));

        // Vehicle positions are SEED values. A device simulator may move them (telemetry_source becomes SIMULATOR).
        addVehicle("V01", PILOT_ORG, "Xuồng cứu hộ 01", "RESCUE_BOAT", 10, "PERSONS", "WORKING", 78, 96, 20.9668, 105.8718, "T01", now);
        addVehicle("V02", PILOT_ORG, "Xuồng cứu hộ 02", "RESCUE_BOAT", 8, "PERSONS", "IDLE", 90, 99, 20.9640, 105.8800, "T02", now);
        addVehicle("V03", PILOT_ORG, "Xe gầm cao 03", "HIGH_CLEARANCE_TRUCK", 20, "PERSONS", "IDLE", 85, 97, 20.9700, 105.8600, "T02", now);
        addVehicle("V04", PILOT_ORG, "Máy bơm di động 04", "MOBILE_PUMP", 1200, "M3_PER_HOUR", "IDLE", 70, 94, 20.9790, 105.8700, "T03", now);
        addVehicle("V05", PILOT_ORG, "Xuồng cứu hộ 05 (đang bảo dưỡng)", "RESCUE_BOAT", 8, "PERSONS", "MAINTENANCE", 40, 62, 20.9600, 105.8650, "T03", now);
        addVehicle("V91", CONTROL_ORG, "Xuồng đối chứng 91", "RESCUE_BOAT", 6, "PERSONS", "IDLE", 80, 90, 21.0310, 105.7910, "T91", now);

        shelters.put("S01", new SafeShelter("S01", PILOT_ORG, "Nhà văn hóa cụm A (điểm trú mô phỏng)", 120, 35, "SEED", 20.9690, 105.8680, "OPEN", now));
        shelters.put("S02", new SafeShelter("S02", PILOT_ORG, "Trường học cụm B (điểm trú mô phỏng)", 200, 80, "SEED", 20.9560, 105.8790, "OPEN", now));
        shelters.put("S03", new SafeShelter("S03", PILOT_ORG, "Trạm y tế cụm C (điểm trú mô phỏng)", 60, 10, "SEED", 20.9745, 105.8620, "OPEN", now));

        // Gauges: every station is a SIMULATOR source. No physical or official gauge is connected.
        gauges.put("G01", new GaugeStation("G01", PILOT_ORG, "Z01", "Trạm đo mô phỏng G01", 20.9655, 105.8705, 80, 120, 62.0, now, "SIMULATOR"));
        gauges.put("G02", new GaugeStation("G02", PILOT_ORG, "Z02", "Trạm đo mô phỏng G02", 20.9580, 105.8830, 90, 130, 105.0, now, "SIMULATOR"));
        gauges.put("G03", new GaugeStation("G03", PILOT_ORG, "Z03", "Trạm đo mô phỏng G03", 20.9725, 105.8585, 60, 100, 33.0, now, "SIMULATOR"));

        // Reports and one active order each for the first and the fourth report.
        reports.put("FR-0001", report("FR-0001", "Z01", "usr_reporter_lan", 20.9662, 105.8714, 60, "EVACUATION", 6,
                "Nước vào nhà, cần đưa người già và trẻ nhỏ ra điểm trú", "URGENT", "IN_PROGRESS", base.minus(2, ChronoUnit.HOURS)));
        reports.put("FR-0002", report("FR-0002", "Z02", "usr_reporter_hung", 20.9588, 105.8838, 90, "MEDICAL", 2,
                "Có người bệnh nằm một chỗ, ngõ ngập sâu", "URGENT", "VERIFIED", base.minus(90, ChronoUnit.MINUTES)));
        reports.put("FR-0003", report("FR-0003", "Z01", "usr_reporter_lan", 20.9650, 105.8700, 35, "PUMPING", 0,
                "Hầm nhà dân ngập, cần máy bơm", "NORMAL", "RECEIVED", base.minus(30, ChronoUnit.MINUTES)));
        reports.put("FR-0004", report("FR-0004", "Z03", "usr_reporter_hung", 20.9732, 105.8594, 20, "FOOD_WATER", 12,
                "Hộ bị cô lập, thiếu nước sạch và lương thực", "HIGH", "DISPATCHED", base.minus(60, ChronoUnit.MINUTES)));
        reports.put("FR-0091", new FloodReport("FR-0091", CONTROL_ORG, "Z91", "usr_reporter_mai", "APP", 21.0302, 105.7902,
                30, "PUMPING", 0, "Tin báo của đơn vị đối chứng", "NORMAL", "RECEIVED", null, null, null,
                "PRC-FR-0091", "CORR-FR-0091", iso(base.minus(1, ChronoUnit.HOURS)), iso(base.minus(1, ChronoUnit.HOURS))));

        orders.put("ORD-0001", new DispatchOrder("ORD-0001", PILOT_ORG, "FR-0001", "usr_reporter_lan", "Z01", "V01", "T01",
                iso(base.minus(1, ChronoUnit.HOURS)), iso(base.plus(2, ChronoUnit.HOURS)), "IN_PROGRESS", 40.0, null, null,
                "CORR-FR-0001", "usr_dispatcher_hoa", iso(base.minus(100, ChronoUnit.MINUTES))));
        orders.put("ORD-0002", new DispatchOrder("ORD-0002", PILOT_ORG, "FR-0004", "usr_reporter_hung", "Z03", "V03", "T02",
                iso(base.plus(3, ChronoUnit.HOURS)), iso(base.plus(5, ChronoUnit.HOURS)), "CONFIRMED", 0.0, null, null,
                "CORR-FR-0004", "usr_dispatcher_hoa", iso(base.minus(45, ChronoUnit.MINUTES))));

        if (databaseBacked) {
            for (Organization o : organizations.values()) {
                postgreSqlDataService.syncOrganization(o.organizationId(), o.name(), o.orgType(), o.province(), o.status());
            }
            for (UserAccount u : usersByUsername.values()) {
                postgreSqlDataService.syncUser(u.userId(), u.username(), u.fullName(), u.organizationId(), u.role(), "", "ACTIVE");
            }
            // Parents first: zones, teams, vehicles, reports, orders, shelters, gauges.
            List<Object> all = new ArrayList<>();
            all.addAll(zones.values());
            all.addAll(teams.values());
            all.addAll(vehicles.values());
            all.addAll(reports.values());
            all.addAll(orders.values());
            all.addAll(shelters.values());
            all.addAll(gauges.values());
            try {
                repository.saveAll("", FloodRepository.SYSTEM_ROLE, "system", all.toArray());
            } catch (RuntimeException e) {
                throw new IllegalStateException("Seeding the database failed: " + e.getMessage(), e);
            }
        }

        // Workflow instances for the open reports: Flowable is started for real when it is configured.
        for (FloodReport r : reports.values()) {
            String[] step = reportStep(r.status);
            bpmnEngine.startInstance(r.bpmnProcessId, r.organizationId, PROCESS_REPORT, r.reportId,
                    step[0], step[1], step[2],
                    List.of(BpmnWorkflowEngine.makeStepHistory("startReport", "Tin báo " + r.reportId + " được tiếp nhận (dữ liệu mô phỏng)",
                            "SYSTEM", "PLATFORM_ADMIN", r.createdAt)),
                    now);
        }

        // Audit trail of the golden path FR-0001.
        Map<String, Object> created = new LinkedHashMap<>();
        created.put("report_id", "FR-0001");
        created.put("zone_id", "Z01");
        created.put("depth_cm", 60.0);
        created.put("need_type", "EVACUATION");
        auditLedger.appendRecord(PILOT_ORG, "CORR-FR-0001", "FloodReport", "FR-0001",
                "CREATE_FLOOD_REPORT", "reporter_lan", FloodRoles.REPORTER, null, created, 200);
        Map<String, Object> dispatched = new LinkedHashMap<>();
        dispatched.put("order_id", "ORD-0001");
        dispatched.put("vehicle_id", "V01");
        dispatched.put("team_id", "T01");
        dispatched.put("status", "CONFIRMED");
        auditLedger.appendRecord(PILOT_ORG, "CORR-FR-0001", "DispatchOrder", "ORD-0001",
                "CONFIRM_DISPATCH_ORDER", "dispatcher_hoa", FloodRoles.DISPATCHER, Map.of("report_status", "VERIFIED"), dispatched, 200);

        if ("true".equalsIgnoreCase(System.getenv("FLOODOS_ENRICHED_DEMO"))) {
            loadEnrichedTacticalScenario();
        }
    }

    public synchronized void loadEnrichedTacticalScenario() {
        Instant base = Instant.now().truncatedTo(ChronoUnit.HOURS);
        String now = iso(Instant.now());

        // Zones bổ sung
        addZone("Z05", PILOT_ORG, "Khu vực hạ lưu sông Nhuệ - Hà Đông (mô phỏng)", "CRITICAL", 115.0, 20.9540, 105.8870, 28.0, now);
        addZone("Z06", PILOT_ORG, "Tuyến đê bãi bồi sông Đáy (mô phỏng)", "WARNING", 85.0, 20.9790, 105.8620, 22.0, now);

        // Đội cứu hộ chuyên trách bổ sung
        teams.put("T04", new RescueTeam("T04", PILOT_ORG, "usr_team_binh", "Đội y tế khẩn cấp 04", 4, List.of("MEDICAL", "FIRST_AID"), 4.9, "ON_MISSION"));
        teams.put("T05", new RescueTeam("T05", PILOT_ORG, "usr_team_cuong", "Đội thợ lặn & cứu nạn 05", 5, List.of("BOAT_RESCUE", "DIVER_RESCUE"), 4.9, "ON_MISSION"));
        teams.put("T06", new RescueTeam("T06", PILOT_ORG, "usr_team_dung", "Đội xung kích hậu cần 06", 8, List.of("HIGH_WATER_TRUCK", "LOGISTICS"), 4.7, "ON_MISSION"));

        // Phương tiện cứu hộ cơ giới & trang thiết bị đa chủng loại
        addVehicle("V06", PILOT_ORG, "Xe lội nước bánh xích 06", "AMPHIBIOUS_CARRIER", 16, "PERSONS", "WORKING", 85, 98, 20.9675, 105.8730, "T02", now);
        addVehicle("V07", PILOT_ORG, "Xuồng cứu hộ cao tốc 07", "RESCUE_BOAT", 12, "PERSONS", "BREAKDOWN", 74, 85, 20.9610, 105.8820, "T01", now);
        addVehicle("V08", PILOT_ORG, "Drone trinh sát tầm nhiệt 08", "SCOUT_DRONE", 5, "KG", "IDLE", 92, 99, 20.9710, 105.8610, "T02", now);
        addVehicle("V09", PILOT_ORG, "Xe cấp cứu lội nước 09", "AMBULANCE_AMPHIBIOUS", 4, "PERSONS", "WORKING", 88, 98, 20.9645, 105.8710, "T04", now);
        addVehicle("V10", PILOT_ORG, "Trạm bơm dã chiến công suất lớn 10", "MOBILE_PUMP", 3500, "M3_PER_HOUR", "IDLE", 82, 95, 20.9760, 105.8625, "T03", now);
        addVehicle("V11", PILOT_ORG, "Xuồng tìm kiếm cứu nạn vỏ nhôm 11", "RESCUE_BOAT", 12, "PERSONS", "WORKING", 90, 97, 20.9580, 105.8860, "T05", now);
        addVehicle("V12", PILOT_ORG, "Xe tải đặc chủng vượt lũ 3 cầu 12", "HIGH_CLEARANCE_TRUCK", 25, "PERSONS", "WORKING", 76, 94, 20.9825, 105.8760, "T06", now);
        addVehicle("V13", PILOT_ORG, "Drone thả phao cứu sinh tự động 13", "SCOUT_DRONE", 10, "KG", "IDLE", 95, 99, 20.9670, 105.8720, "T01", now);
        addVehicle("V14", PILOT_ORG, "Xe chỉ huy tác chiến & phát điện 14", "COMMAND_VEHICLE", 8, "PERSONS", "IDLE", 85, 96, 20.9700, 105.8680, "T02", now);

        // Điểm sơ tán an toàn
        shelters.put("S04", new SafeShelter("S04", PILOT_ORG, "Nhà thi đấu TDTT quận (điểm trú dã chiến)", 350, 120, "SEED", 20.9780, 105.8650, "OPEN", now));
        shelters.put("S05", new SafeShelter("S05", PILOT_ORG, "Cung thể thao Điền kinh Hà Nội", 600, 210, "SEED", 20.9765, 105.8695, "OPEN", now));
        shelters.put("S06", new SafeShelter("S06", PILOT_ORG, "Trường THPT Chuyên Nguyễn Huệ (điểm sơ tán dự phòng)", 400, 145, "SEED", 20.9620, 105.8750, "OPEN", now));

        // Trạm quan trắc thủy văn cảnh báo lũ
        gauges.put("G04", new GaugeStation("G04", PILOT_ORG, "Z04", "Trạm thủy văn sông Nhuệ G04", 20.9805, 105.8765, 85, 120, 78.0, now, "SIMULATOR"));
        gauges.put("G05", new GaugeStation("G05", PILOT_ORG, "Z05", "Trạm thủy văn đập Đáy G05", 20.9550, 105.8890, 110, 135, 128.0, now, "SIMULATOR"));
        gauges.put("G06", new GaugeStation("G06", PILOT_ORG, "Z01", "Trạm thủy văn Cầu Trắng Hà Đông G06", 20.9720, 105.8790, 80, 95, 88.0, now, "SIMULATOR"));

        // Danh sách tin báo ngập lụt đa cấp độ
        reports.put("FR-0005", report("FR-0005", "Z02", "usr_reporter_lan", 20.9592, 105.8845, 125, "EVACUATION", 5,
                "Nước lũ dâng ngập ngang ngực, có cụ già 82 tuổi và 2 trẻ nhỏ đang mắc kẹt trên gác xép cần xuồng cứu hộ gấp", "CRITICAL", "RECEIVED", base.minus(15, ChronoUnit.MINUTES)));
        reports.put("FR-0006", report("FR-0006", "Z04", "usr_reporter_hung", 20.9815, 105.8775, 45, "ROAD_BLOCKED", 0,
                "Cây đổ chắn ngang tuyến đường D đoạn trũng sâu 45cm, chia cắt xe cứu hộ tiếp cận", "HIGH", "VERIFIED", base.minus(45, ChronoUnit.MINUTES)));
        reports.put("FR-0007", report("FR-0007", "Z03", "usr_reporter_lan", 20.9738, 105.8598, 25, "FOOD_WATER", 18,
                "Xóm trũng bị ngập cô lập mất điện 3 ngày, bà con cạn kiệt nước sạch và đồ hộp", "NORMAL", "IN_PROGRESS", base.minus(120, ChronoUnit.MINUTES)));
        reports.put("FR-0008", report("FR-0008", "Z01", "usr_reporter_hung", 20.9658, 105.8708, 85, "EVACUATION", 6,
                "Đã sơ tán an toàn 6 người dân ngập sâu đến Trường tiểu học cụm A an toàn", "URGENT", "RESOLVED", base.minus(240, ChronoUnit.MINUTES)));

        reports.put("FR-0009", report("FR-0009", "Z01", "usr_reporter_lan", 20.9630, 105.8690, 135, "MEDICAL", 4,
                "Trạm y tế xã ngập tầng 1, có 2 bệnh nhân thở máy cần máy phát điện khẩn cấp và xe cứu thương lội nước di dời khẩn cấp", "CRITICAL", "RECEIVED", base.minus(10, ChronoUnit.MINUTES)));
        reports.put("FR-0010", report("FR-0010", "Z02", "usr_reporter_hung", 20.9570, 105.8850, 150, "EVACUATION", 7,
                "Sạt đê bao phụ kênh dẫn nước, dòng chảy xiết ngập đến mái nhà, 7 người dân đang bám trên mái tôn kêu cứu khẩn cấp", "CRITICAL", "IN_PROGRESS", base.minus(50, ChronoUnit.MINUTES)));
        reports.put("FR-0011", report("FR-0011", "Z03", "usr_reporter_lan", 20.9750, 105.8610, 70, "PUMPING", 0,
                "Hầm chung cư HH bị nước tràn từ đường lớn, trạm biến áp ngầm có nguy cơ nổ chập nếu nước dâng thêm 15cm, cần máy bơm công suất lớn", "HIGH", "VERIFIED", base.minus(35, ChronoUnit.MINUTES)));
        reports.put("FR-0012", report("FR-0012", "Z01", "usr_reporter_hung", 20.9680, 105.8740, 85, "EVACUATION", 9,
                "Khu dân cư tổ 5 ngõ 12 bị ngập sâu chia cắt, các gia đình đã gom người già lên tầng 2 nhưng nước tiếp tục dâng 10cm/giờ", "URGENT", "DISPATCHED", base.minus(75, ChronoUnit.MINUTES)));
        reports.put("FR-0013", report("FR-0013", "Z04", "usr_reporter_lan", 20.9830, 105.8750, 40, "FOOD_WATER", 25,
                "Cụm dân cư xóm Đồi bị cô lập 4 ngày do cầu tràn ngập nước chảy xiết, 25 người dân cạn kiệt lương thực và nước sạch", "HIGH", "IN_PROGRESS", base.minus(180, ChronoUnit.MINUTES)));
        reports.put("FR-0014", report("FR-0014", "Z01", "usr_reporter_hung", 20.9615, 105.8670, 55, "ROAD_BLOCKED", 0,
                "Cây xà cừ cổ thụ bật gốc đè lên dây điện và chắn ngang quốc lộ đoạn qua cống tiêu, ngăn cản xe cứu hộ tiếp cận", "HIGH", "VERIFIED", base.minus(60, ChronoUnit.MINUTES)));
        reports.put("FR-0015", report("FR-0015", "Z02", "usr_reporter_lan", 20.9705, 105.8810, 65, "MEDICAL", 1,
                "Sản phụ chuyển dạ sinh non trong vùng ngập sâu đường ngõ hẹp, xe cứu thương thông thường không vào được", "URGENT", "IN_PROGRESS", base.minus(85, ChronoUnit.MINUTES)));
        reports.put("FR-0016", report("FR-0016", "Z03", "usr_reporter_hung", 20.9775, 105.8660, 30, "EVACUATION", 8,
                "Đã hoàn thành sơ tán an toàn 8 hộ dân khu trũng bãi bồi ven sông sang Nhà thi đấu TDTT quận trước đỉnh lũ", "NORMAL", "RESOLVED", base.minus(300, ChronoUnit.MINUTES)));

        // Lệnh điều động lực lượng
        orders.put("ORD-0003", new DispatchOrder("ORD-0003", PILOT_ORG, "FR-0008", "usr_reporter_hung", "Z01", "V06", "T02",
                iso(base.minus(3, ChronoUnit.HOURS)), iso(base.minus(1, ChronoUnit.HOURS)), "COMPLETED", 100.0, null, null,
                "CORR-FR-0008", "usr_dispatcher_hoa", iso(base.minus(210, ChronoUnit.MINUTES))));
        orders.put("ORD-0004", new DispatchOrder("ORD-0004", PILOT_ORG, "FR-0007", "usr_reporter_lan", "Z03", "V03", "T02",
                iso(base.minus(2, ChronoUnit.HOURS)), iso(base.plus(1, ChronoUnit.HOURS)), "IN_PROGRESS", 65.0, null, null,
                "CORR-FR-0007", "usr_dispatcher_hoa", iso(base.minus(90, ChronoUnit.MINUTES))));
        orders.put("ORD-0005", new DispatchOrder("ORD-0005", PILOT_ORG, "FR-0010", "usr_reporter_hung", "Z02", "V11", "T05",
                iso(base.minus(40, ChronoUnit.MINUTES)), iso(base.plus(2, ChronoUnit.HOURS)), "IN_PROGRESS", 50.0, null, null,
                "CORR-FR-0010", "usr_dispatcher_hoa", iso(base.minus(45, ChronoUnit.MINUTES))));
        orders.put("ORD-0006", new DispatchOrder("ORD-0006", PILOT_ORG, "FR-0013", "usr_reporter_lan", "Z04", "V12", "T06",
                iso(base.minus(150, ChronoUnit.MINUTES)), iso(base.plus(1, ChronoUnit.HOURS)), "IN_PROGRESS", 80.0, null, null,
                "CORR-FR-0013", "usr_dispatcher_hoa", iso(base.minus(160, ChronoUnit.MINUTES))));
        orders.put("ORD-0007", new DispatchOrder("ORD-0007", PILOT_ORG, "FR-0015", "usr_reporter_lan", "Z02", "V09", "T04",
                iso(base.minus(70, ChronoUnit.MINUTES)), iso(base.plus(1, ChronoUnit.HOURS)), "IN_PROGRESS", 60.0, null, null,
                "CORR-FR-0015", "usr_dispatcher_hoa", iso(base.minus(75, ChronoUnit.MINUTES))));
        orders.put("ORD-0008", new DispatchOrder("ORD-0008", PILOT_ORG, "FR-0012", "usr_reporter_hung", "Z01", "V02", "T02",
                iso(base.minus(10, ChronoUnit.MINUTES)), iso(base.plus(3, ChronoUnit.HOURS)), "CONFIRMED", 0.0, null, null,
                "CORR-FR-0012", "usr_dispatcher_hoa", iso(base.minus(15, ChronoUnit.MINUTES))));
        orders.put("ORD-0009", new DispatchOrder("ORD-0009", PILOT_ORG, "FR-0016", "usr_reporter_hung", "Z03", "V06", "T02",
                iso(base.minus(4, ChronoUnit.HOURS)), iso(base.minus(2, ChronoUnit.HOURS)), "COMPLETED", 100.0, null, null,
                "CORR-FR-0016", "usr_dispatcher_hoa", iso(base.minus(280, ChronoUnit.MINUTES))));

        // Sự cố phương tiện hiện trường & phương án thay thế Replan
        incidents.put("INC-0002", new FieldIncident("INC-0002", PILOT_ORG, "V07", "usr_team_binh",
                "MAJOR", "PROPELLER_FOULED", "Xuồng 07 bị quấn rác và lưới đánh cá vào chân vịt, động cơ tạm dừng hoạt động",
                1.5, null, null, "REP-0002", "usr_resource_giang", "OPEN_REPLANNING", "PRC-INC-0002",
                List.of("ORD-0005"),
                List.of(
                        Map.of("option_id", "OPT-V11-T05", "replacement_vehicle_id", "V11", "replacement_team_id", "T05", "vehicle_name", "Xuồng tìm kiếm cứu nạn vỏ nhôm 11", "team_name", "Đội thợ lặn 05", "score", 95.0, "distance_km", 1.2),
                        Map.of("option_id", "OPT-V06-T02", "replacement_vehicle_id", "V06", "replacement_team_id", "T02", "vehicle_name", "Xe lội nước bánh xích 06", "team_name", "Đội cơ động 02", "score", 88.0, "distance_km", 2.1)
                ),
                null, "CORR-INC-0002", iso(base.minus(25, ChronoUnit.MINUTES))));

        // Báo cáo hoàn tất vụ việc có xác nhận
        resolutions.put("RES-0008", new ReportResolution("RES-0008", PILOT_ORG, "FR-0008", "ORD-0003",
                "RESOLVED", 15.0, null, "usr_team_cuong", "usr_reporter_hung", "CONFIRMED",
                "Đã hoàn thành sơ tán 6 người dân ngập sâu an toàn về điểm trú. Sức khỏe người dân ổn định.",
                "CORR-FR-0008", iso(base.minus(30, ChronoUnit.MINUTES)), iso(base.minus(45, ChronoUnit.MINUTES))));
        resolutions.put("RES-0016", new ReportResolution("RES-0016", PILOT_ORG, "FR-0016", "ORD-0009",
                "RESOLVED", 10.0, null, "usr_team_cuong", "usr_reporter_hung", "CONFIRMED",
                "Đã sơ tán 8 hộ dân và tài sản quan trọng về Cung thể thao an toàn trước khi nước lũ đạt đỉnh.",
                "CORR-FR-0016", iso(base.minus(90, ChronoUnit.MINUTES)), iso(base.minus(120, ChronoUnit.MINUTES))));

        // Khởi động BPMN process cho tất cả các tin báo mở rộng
        for (String rId : List.of("FR-0005", "FR-0006", "FR-0007", "FR-0008", "FR-0009", "FR-0010", "FR-0011", "FR-0012", "FR-0013", "FR-0014", "FR-0015", "FR-0016")) {
            FloodReport r = reports.get(rId);
            String[] step = reportStep(r.status);
            bpmnEngine.startInstance(r.bpmnProcessId, r.organizationId, PROCESS_REPORT, r.reportId,
                    step[0], step[1], step[2],
                    List.of(BpmnWorkflowEngine.makeStepHistory("startReport", "Tin báo " + r.reportId + " được tiếp nhận (tình huống mở rộng)",
                            "SYSTEM", "PLATFORM_ADMIN", r.createdAt)),
                    now);
        }

        // Audit Trail và sổ cái mật mã học
        for (String rId : List.of("FR-0005", "FR-0006", "FR-0007", "FR-0008", "FR-0009", "FR-0010", "FR-0011", "FR-0012", "FR-0013", "FR-0014", "FR-0015", "FR-0016")) {
            FloodReport r = reports.get(rId);
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("report_id", r.reportId);
            payload.put("depth_cm", r.depthCm);
            payload.put("priority", r.priority);
            payload.put("need_type", r.needType);
            payload.put("people_affected", r.peopleAffected);
            auditLedger.appendRecord(PILOT_ORG, "CORR-" + r.reportId, "FloodReport", r.reportId,
                    "CREATE_FLOOD_REPORT", r.reporterUserId.replace("usr_", ""), FloodRoles.REPORTER, null, payload, 200);
        }

        Map<String, Object> c8 = new LinkedHashMap<>();
        c8.put("report_id", "FR-0008");
        c8.put("resolution_id", "RES-0008");
        c8.put("status", "RESOLVED");
        auditLedger.appendRecord(PILOT_ORG, "CORR-FR-0008", "ReportResolution", "RES-0008",
                "CONFIRM_RESOLUTION_AND_SEAL_LEDGER", "reporter_hung", FloodRoles.REPORTER, null, c8, 200);

        Map<String, Object> c16 = new LinkedHashMap<>();
        c16.put("report_id", "FR-0016");
        c16.put("resolution_id", "RES-0016");
        c16.put("status", "RESOLVED");
        auditLedger.appendRecord(PILOT_ORG, "CORR-FR-0016", "ReportResolution", "RES-0016",
                "CONFIRM_RESOLUTION_AND_SEAL_LEDGER", "reporter_hung", FloodRoles.REPORTER, null, c16, 200);
    }

    private void addUser(String username, String fullName, String orgId, String role) {
        usersByUsername.put(username, new UserAccount("usr_" + username, username, DEMO_PASSWORD, fullName,
                username + EMAIL_DOMAIN, orgId, role));
    }

    private void addZone(String id, String orgId, String name, String risk, double waterCm, double lat, double lng,
                         double areaHa, String now) {
        zones.put(id, new FloodZone(id, orgId, name, risk, waterCm, "SEED", now,
                SpatialMatchingEngine.polygonForArea(lat, lng, areaHa), lat, lng, "SEED"));
    }

    private void addVehicle(String id, String orgId, String name, String type, double cap, String unit, String status,
                            double fuel, double health, double lat, double lng, String teamId, String now) {
        String manager = CONTROL_ORG.equals(orgId) ? "usr_dispatcher_tuan" : "usr_resource_giang";
        vehicles.put(id, new RescueVehicle(id, orgId, manager, name, type, cap, unit, status, fuel, health, lat, lng,
                teamId, now, "SEED"));
    }

    private FloodReport report(String id, String zoneId, String reporter, double lat, double lng, double depth,
                               String need, int people, String desc, String priority, String status, Instant created) {
        String ts = iso(created);
        boolean verified = !"RECEIVED".equals(status);
        return new FloodReport(id, PILOT_ORG, zoneId, reporter, "APP", lat, lng, depth, need, people, desc, priority, status,
                verified ? "usr_dispatcher_hoa" : null, verified ? "Đã xác minh qua điện thoại (dữ liệu mô phỏng)" : null,
                null, "PRC-" + id, "CORR-" + id, ts, ts);
    }
}
