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

        addVehicle("V06", PILOT_ORG, "Xe lội nước bánh xích 06", "AMPHIBIOUS_CARRIER", 16, "PERSONS", "WORKING", 85, 98, 20.9675, 105.8730, "T02", now);
        addVehicle("V07", PILOT_ORG, "Xuồng cứu hộ cao tốc 07", "RESCUE_BOAT", 12, "PERSONS", "WORKING", 74, 95, 20.9610, 105.8820, "T01", now);
        addVehicle("V08", PILOT_ORG, "Drone trinh sát tầm nhiệt 08", "SCOUT_DRONE", 5, "KG", "IDLE", 92, 99, 20.9710, 105.8610, "T02", now);

        shelters.put("S04", new SafeShelter("S04", PILOT_ORG, "Nhà thi đấu TDTT quận (điểm trú dã chiến)", 350, 120, "SEED", 20.9780, 105.8650, "OPEN", now));
        gauges.put("G04", new GaugeStation("G04", PILOT_ORG, "Z04", "Trạm thủy văn sông Nhuệ G04", 20.9805, 105.8765, 85, 120, 78.0, now, "SIMULATOR"));

        reports.put("FR-0005", report("FR-0005", "Z02", "usr_reporter_lan", 20.9592, 105.8845, 125, "EVACUATION", 5,
                "Nước lũ dâng ngập ngang ngực, có cụ già 82 tuổi và 2 trẻ nhỏ đang mắc kẹt trên gác xép cần xuồng cứu hộ gấp", "CRITICAL", "RECEIVED", base.minus(15, ChronoUnit.MINUTES)));
        reports.put("FR-0006", report("FR-0006", "Z04", "usr_reporter_hung", 20.9815, 105.8775, 45, "ROAD_BLOCKED", 0,
                "Cây đổ chắn ngang tuyến đường D đoạn trũng sâu 45cm, chia cắt xe cứu hộ tiếp cận", "HIGH", "VERIFIED", base.minus(45, ChronoUnit.MINUTES)));
        reports.put("FR-0007", report("FR-0007", "Z03", "usr_reporter_lan", 20.9738, 105.8598, 25, "FOOD_WATER", 18,
                "Xóm trũng bị ngập cô lập mất điện 3 ngày, bà con cạn kiệt nước sạch và đồ hộp", "NORMAL", "IN_PROGRESS", base.minus(120, ChronoUnit.MINUTES)));
        reports.put("FR-0008", report("FR-0008", "Z01", "usr_reporter_hung", 20.9658, 105.8708, 85, "EVACUATION", 6,
                "Đã sơ tán an toàn 6 người dân ngập sâu đến Trường tiểu học cụm A an toàn", "URGENT", "RESOLVED", base.minus(240, ChronoUnit.MINUTES)));

        orders.put("ORD-0003", new DispatchOrder("ORD-0003", PILOT_ORG, "FR-0008", "usr_reporter_hung", "Z01", "V06", "T02",
                iso(base.minus(3, ChronoUnit.HOURS)), iso(base.minus(1, ChronoUnit.HOURS)), "COMPLETED", 100.0, null, null,
                "CORR-FR-0008", "usr_dispatcher_hoa", iso(base.minus(210, ChronoUnit.MINUTES))));
        orders.put("ORD-0004", new DispatchOrder("ORD-0004", PILOT_ORG, "FR-0007", "usr_reporter_lan", "Z03", "V03", "T02",
                iso(base.minus(2, ChronoUnit.HOURS)), iso(base.plus(1, ChronoUnit.HOURS)), "IN_PROGRESS", 65.0, null, null,
                "CORR-FR-0007", "usr_dispatcher_hoa", iso(base.minus(90, ChronoUnit.MINUTES))));

        resolutions.put("RES-0008", new ReportResolution("RES-0008", PILOT_ORG, "FR-0008", "ORD-0003",
                "RESOLVED", 15.0, null, "usr_team_cuong", "usr_reporter_hung", "CONFIRMED",
                "Đã hoàn thành sơ tán 6 người dân ngập sâu an toàn về điểm trú. Sức khỏe người dân ổn định.",
                "CORR-FR-0008", iso(base.minus(30, ChronoUnit.MINUTES)), iso(base.minus(45, ChronoUnit.MINUTES))));

        for (String rId : List.of("FR-0005", "FR-0006", "FR-0007", "FR-0008")) {
            FloodReport r = reports.get(rId);
            String[] step = reportStep(r.status);
            bpmnEngine.startInstance(r.bpmnProcessId, r.organizationId, PROCESS_REPORT, r.reportId,
                    step[0], step[1], step[2],
                    List.of(BpmnWorkflowEngine.makeStepHistory("startReport", "Tin báo " + r.reportId + " được tiếp nhận (tình huống mở rộng)",
                            "SYSTEM", "PLATFORM_ADMIN", r.createdAt)),
                    now);
        }

        Map<String, Object> c5 = new LinkedHashMap<>();
        c5.put("report_id", "FR-0005");
        c5.put("depth_cm", 125.0);
        c5.put("priority", "CRITICAL");
        auditLedger.appendRecord(PILOT_ORG, "CORR-FR-0005", "FloodReport", "FR-0005",
                "CREATE_FLOOD_REPORT", "reporter_lan", FloodRoles.REPORTER, null, c5, 200);

        Map<String, Object> c8 = new LinkedHashMap<>();
        c8.put("report_id", "FR-0008");
        c8.put("resolution_id", "RES-0008");
        c8.put("status", "RESOLVED");
        auditLedger.appendRecord(PILOT_ORG, "CORR-FR-0008", "ReportResolution", "RES-0008",
                "CONFIRM_RESOLUTION_AND_SEAL_LEDGER", "reporter_hung", FloodRoles.REPORTER, null, c8, 200);
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
