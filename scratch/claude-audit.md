# Rà soát chuyển ứng dụng minh họa: thu hoạch lúa → điều phối ứng phó ngập lụt (ĐBSCL)

Ngày rà soát: 2026-11-02. Nhánh: `feat/tier2-harvest-map-3d`. Chế độ: **chỉ đọc**, không sửa file nào trong repo (file này là ngoại lệ do người dùng yêu cầu lưu kết quả).

## 0. Cách đọc báo cáo và giới hạn

- Số liệu "dòng chứa từ miền" là số dòng khớp regex `machine|field|harvest|operator|assignment|combine|crop|lúa|gặt|ruộng|farmer|coordinator|repair` (không phân biệt hoa thường). Đây là chỉ báo độ gắn, **không** phải thước đo chính xác.
- Tôi đã đọc kỹ: các file `core/*` nhỏ, các đoạn nêu dưới đây của `KeycloakOidcEngine`, `PostgreSqlDataService`, `schema.sql`, hai file BPMN, `ingestor.py`, `simulator.py`, danh sách route của `OpenAgriOsServer`.
- Tôi **chưa** đọc hết `AgriOpsService` (1653 dòng), `OpenAgriOsServer` (1497 dòng), các component web, `traceability.py` ngoài các dòng nêu. Phần ước lượng công sức ở mục 5 là phán đoán, không đo.
- Không chạy lệnh nào ngoài đọc/grep. Chưa chạy test.
- Thiết kế miền ngập lụt ở mục 4 là **đề xuất của tôi**, chưa kiểm chứng với nghiệp vụ ứng phó thật; tên bảng/vai trò là ví dụ.

## 1. Phần Tầng 1 dùng chung có thể giữ

Chiều phụ thuộc đúng: `core/` không import `apps/` (grep `import .*agriops` trong `core/` không có kết quả); `apps/agriops` import từ `core/` ([AgriDataStore.java:11-27](../apps/agriops/AgriDataStore.java), [AgriOpsService.java:6-14](../apps/agriops/AgriOpsService.java)). Vấn đề không nằm ở hướng import mà ở **nội dung miền nằm trong class của lõi**.

Giữ nguyên (0 dòng chứa từ miền theo regex trên):

| File | Vai trò | Ghi chú |
|---|---|---|
| [core/api-gateway/ZeroTrustGateway.java](../core/api-gateway/ZeroTrustGateway.java) (78 dòng) | Cổng Zero-Trust | trung lập |
| [core/data-services/ImmutableAuditLedger.java](../core/data-services/ImmutableAuditLedger.java) (256) | Sổ cái băm SHA-256 | trung lập; tên sự kiện do ứng dụng truyền vào |
| [core/data-services/MalwareScanner.java](../core/data-services/MalwareScanner.java) (213) | Kiểm dịch ClamAV | trung lập |
| [core/data-services/SeaweedS3StorageService.java](../core/data-services/SeaweedS3StorageService.java) (678) | Lưu đối tượng S3 | trung lập |
| [core/data-services/EventBusPublisher.java](../core/data-services/EventBusPublisher.java) (193) | Kafka | trung lập |
| [core/data-services/JsonCodec.java](../core/data-services/JsonCodec.java) (321) | JSON | trung lập |
| [core/data-services/NgsiLdTwinMapper.java:32-44](../core/data-services/NgsiLdTwinMapper.java) | Ánh xạ NGSI-LD | nhận `entityType` làm tham số, đã trung lập |

Giữ phần cơ chế, đổi phần chính sách:

- **Cơ chế RLS theo phiên**: [TenantRlsContext.java:24-61](../core/data-services/TenantRlsContext.java) đặt `app.current_org_id`, `app.current_user_role`, `app.current_user_id` bằng `set_config` có tham số hóa. Dùng lại được cho ngập lụt.
- **Mẫu ràng buộc "tài nguyên không trùng khoảng thời gian"**: `EXCLUDE USING gist` trên máy ([infra/db/schema.sql:136-139](../infra/db/schema.sql)) và người vận hành ([schema.sql:141-144](../infra/db/schema.sql)). Mẫu này áp dụng được cho xuồng/xe bơm/đội cứu hộ.
- **Sổ cái bất biến ở DB**: hàm `prevent_audit_mutation` ([schema.sql:219](../infra/db/schema.sql)) và trigger `trg_audit_immutable` ([schema.sql:227](../infra/db/schema.sql)), bảng `audit_records`.
- **Bảng nền tảng**: `organizations` ([schema.sql:20](../infra/db/schema.sql)), `users` ([schema.sql:30](../infra/db/schema.sql)), `audit_records` ([schema.sql:187](../infra/db/schema.sql)).
- **Luồng nóng/lạnh** (`services/lake-archiver`) và **MQTT → Kafka** (`services/telemetry/ingestor.py`) về cấu trúc là chung, chỉ lược đồ bản tin gắn miền (mục 3).
- **Gateway, Keycloak, Flowable, SeaweedFS, ClamAV** là hạ tầng cấu hình (`compose.yaml`, `infra/apisix`, `infra/keycloak`), không gắn mã miền.

## 2. Phần nghiệp vụ lúa/máy gặt đang gắn cứng vào lõi

Xếp theo mức gắn:

1. **[core/data-services/PostgreSqlDataService.java](../core/data-services/PostgreSqlDataService.java)** — 164/1000 dòng chứa từ miền. Đây là chỗ gắn nặng nhất.
   - Phương thức kiểu theo miền: `syncField` (:360, :414, :423), `syncMachine` (:435, :486, :494), `syncOperator` (:505, :533), `syncServiceRequest` (:540, :588), `syncAssignment` (:599, :645), `syncIncident` (:657, :708), `syncWorkAcceptance` (:720, :762); thêm bản cũ `syncShift`/`syncAuditBlock` (:981-997).
   - **DDL nhân đôi**: khối `CREATE TABLE` nằm trong Java ([:99-250](../core/data-services/PostgreSqlDataService.java)) *và* trong [infra/db/schema.sql](../infra/db/schema.sql). Hai nguồn sự thật cho cùng một schema.
   - `initSchema()` ([:84](../core/data-services/PostgreSqlDataService.java)) quyết định bỏ qua DDL bằng cách kiểm tra bảng tên **`fields`** (`information_schema.tables ... table_name='fields'`). Đổi tên bảng mà không đổi dòng này sẽ làm kiểm tra này sai lặng lẽ.
   - Danh sách bảng cứng trong `queryWithRls`/`queryAll` ([:834-:925](../core/data-services/PostgreSqlDataService.java)) và `deleteTransactionalData` ([:907](../core/data-services/PostgreSqlDataService.java)).
2. **[core/data-services/ScheduleConflictEngine.java](../core/data-services/ScheduleConflictEngine.java)** — giao diện `SchedulableAssignment` có `fieldId()/machineId()/operatorId()` ([:17-22](../core/data-services/ScheduleConflictEngine.java)); `checkConflict` ([:31](../core/data-services/ScheduleConflictEngine.java)) kiểm trạng thái `BREAKDOWN`/`MAINTENANCE` của máy ([:49](../core/data-services/ScheduleConflictEngine.java)) và trả thông báo tiếng Việt "Máy …" ([:45](../core/data-services/ScheduleConflictEngine.java), [:52](../core/data-services/ScheduleConflictEngine.java)). Logic bản chất là "tài nguyên + người giữ + khoảng thời gian" nên tổng quát hóa được.
3. **[core/identity/KeycloakOidcEngine.java](../core/identity/KeycloakOidcEngine.java)** — 11 dòng, nhưng ảnh hưởng bảo mật:
   - [:1349-1373](../core/identity/KeycloakOidcEngine.java) `resolveDatabaseUserId` ánh xạ cứng tên đăng nhập demo (`farmer_ba`, `coord_htx01`, `op_minh`…) sang id; tên lạ rơi về `"usr_" + username` ([:1368](../core/identity/KeycloakOidcEngine.java)).
   - [:2189-2194](../core/identity/KeycloakOidcEngine.java) `OPENAGRIOS_ROLE_HIERARCHY` = `PLATFORM_ADMIN, COORDINATOR, OPERATOR, FARMER, REPAIR_TEAM`.
   - **Mặc định âm thầm về `FARMER`** khi không có vai trò ([:1403](../core/identity/KeycloakOidcEngine.java), [:2202](../core/identity/KeycloakOidcEngine.java), [:2221](../core/identity/KeycloakOidcEngine.java)). Trái với nguyên tắc fail-fast của AGENTS.md mục 4.
4. **[core/data-services/TenantRlsContext.java:67-73](../core/data-services/TenantRlsContext.java)** — `resolveFieldVisibility` chứa `"FARMER"` và `"REPAIR_TEAM"` cứng, trả `FOG_OF_WAR`/`FULL`. Cơ chế chung nhưng chính sách là của miền.
5. **[core/data-services/SpatialMatchingEngine.java](../core/data-services/SpatialMatchingEngine.java)** — `computeMultiCriteriaScore(distKm, capacityHaPerHr, operatorRating)` ([:73](../core/data-services/SpatialMatchingEngine.java)): trọng số 30/25/15 dành cho máy gặt. `polygonForArea`/`ringAreaHa` (do tôi thêm ở nhánh `fix/seed-polygon-area`) là hình học chung nhưng đang nằm cạnh phần chấm điểm. Haversine dùng lại được.
6. **[core/workflow/BpmnWorkflowEngine.java:291-293](../core/workflow/BpmnWorkflowEngine.java)** — đăng ký cứng khóa quy trình `service_request` và `incident_replan` với tên file. Phần còn lại của engine không gắn miền (hit ở :581 chỉ là chữ "state machine" trong comment).
7. **[core/data-services/AnalyticsLakeClient.java:27](../core/data-services/AnalyticsLakeClient.java)** — whitelist truy vấn có `machine-utilization`.

Đã nằm đúng chỗ (ở `apps/`, không phải vấn đề của lõi, nhưng phải đổi): `apps/agriops/AgriModels.java`, `AgriDataStore.java` (seed, khóa quy trình `service_request_lifecycle` tại [:301](../apps/agriops/AgriDataStore.java)), `AgriOpsService.java`, `OpenAgriOsServer.java`.

## 3. Phải đổi: schema, API, BPMN, telemetry, test

### Schema ([infra/db/schema.sql](../infra/db/schema.sql), 363 dòng)

| Bảng | Dòng | Cột gắn lúa/máy gặt |
|---|---|---|
| `fields` | :43 | `crop` mặc định 'Lúa Đông Xuân (OM18)', `area_ha`, `readiness_status` (GROWING…COMPLETED), `harvest_progress_pct`, `season_window`, `boundary_geojson`, `center_lat/lng` |
| `machines` | :62 | `machine_type` mặc định `COMBINE_HARVESTER`, `model` mặc định Kubota, `capacity_ha_per_hr`, `fuel_pct`, `health_pct` |
| `operators` | :84 | `skills` mặc định `COMBINE_HARVESTER` |
| `service_requests` | :96 | `field_id`, `area_ha`, trạng thái `PENDING_SCHEDULE…` |
| `assignments` | :116 | `field_id`, `machine_id`, `operator_id`; hai ràng buộc GiST (:136-144) |
| `incidents` | :148 | gắn máy |
| `work_acceptances` | :169 | nghiệm thu ca gặt |

- RLS: `ENABLE`/`FORCE` ở :235-257; chính sách ở :261-325. Điều kiện **nhúng tên vai trò miền**: `<> 'FARMER'` tại :267 và :294 (nông hộ chỉ thấy thửa/yêu cầu của mình qua `owner_user_id`/`requester_user_id`). Cấp quyền cho `openagrios_app` ở :335-339.
- Nhân đôi DDL trong Java (mục 2.1) nghĩa là đổi schema phải đổi **hai** nơi hoặc gỡ một nơi.

### API ([apps/agriops/OpenAgriOsServer.java](../apps/agriops/OpenAgriOsServer.java))

- Chung, giữ: `/api/v1/auth/*` (:612-942), `health` (:644), `stream/events` (:763), `state` (:788, nội dung gắn miền), `digital-twin/entities` (:808), `audit/verify` (:828), `analytics/` (:848), `audit/lineage/` (:860), `internal/telemetry` (:901).
- Gắn miền, đổi: `requests` (:1003), `assignments` (:1027, :1035), `incidents` (:1059, `…/approve-replan` :1083, `…/repair` :1115), `acceptances` (:1147), `internal/fleet` (:409), `sim/reset` (:979), `sim/tick` (:1171).
- Kiểm tra bản tin telemetry nằm ở [AgriOpsService.java:1603-1605](../apps/agriops/AgriOpsService.java): bắt buộc `fuel_pct ∈ [0,100]` và `speed_kmh ∈ [0,80]`. **Cảm biến mực nước không có hai trường này**, nên bản tin ngập lụt sẽ bị từ chối 4xx nếu giữ nguyên.
- Tên sự kiện kiểm toán chứa miền, ví dụ `REPORT_MACHINE_INCIDENT` ([AgriOpsService.java:857](../apps/agriops/AgriOpsService.java)); loại thực thể NGSI-LD `Machine` cùng chỗ.
- Frontend: [apps/web/src/types.ts](../apps/web/src/types.ts) (17 dòng miền, `UserRole` :10), [apps/web/src/services/api.ts](../apps/web/src/services/api.ts) (5), cùng ~20 component (`FarmerWorkspace`, `OperatorWorkspace`, `CoordinatorWorkspace`, `RepairTeamWorkspace`, `MachineOwnerWorkspace`, `TacticalMap`, `IncidentScenario`…) và toàn bộ `apps/twin3d/`.

### BPMN ([infra/bpmn/](../infra/bpmn/))

- [service_request.bpmn20.xml:9](../infra/bpmn/service_request.bpmn20.xml): process `service_request_lifecycle` (SOP-01), tác vụ `taskCoordinatorSchedule`, `taskOperatorExecute`, `taskFarmerAcceptance`.
- [incident_replan.bpmn20.xml:9](../infra/bpmn/incident_replan.bpmn20.xml): process `incident_replan_workflow` (SOP-02), có `parallelSplit` giữa `taskCoordinatorApproveReplan` và `taskRepairTeamFix`, rồi `taskFarmerConfirmNewSchedule`.
- Cấu trúc (khởi tạo → phê duyệt song song → xác nhận → kết thúc) dùng lại được; tên tác vụ, nhóm giao việc, nhãn tiếng Việt phải viết lại. Khóa quy trình xuất hiện ở BpmnWorkflowEngine :291-293 và AgriDataStore :301.

### Telemetry

- [services/telemetry/ingestor.py:35-36](../services/telemetry/ingestor.py): topic `openagrios/+/machines/+/telemetry` và regex; :86 bắt buộc `lat`, `lon`, `fuel_pct`; :97-98 payload chuẩn hóa.
- [infra/mosquitto/entrypoint.sh:25,28](../infra/mosquitto/entrypoint.sh): ACL theo cùng họ topic `machines/`.
- [services/telemetry/simulator.py](../services/telemetry/simulator.py): lấy danh sách máy từ `/api/v1/internal/fleet` (:46), chỉ máy `WORKING` di chuyển (:71-79), đốt nhiên liệu. Với ngập lụt, thiết bị là trạm đo (mực nước, mưa) đứng yên cùng xuồng/xe cứu hộ di chuyển — mô hình mô phỏng khác.
- [services/lake-archiver/archiver.py](../services/lake-archiver/archiver.py): cột `machine_id` (:61), `DEDUPE_KEYS` (:362), cửa sổ `PARTITION BY machine_id` (:445), truy vấn `machine-utilization` (:475-491). Parquet đã ghi có cột cũ nên cần chiến lược lược đồ (mục 5).

### Test

Số dòng chứa từ miền theo regex `machine|field|harvest|farmer|operator|combine|F0x|M0x`: `tests/unit/PlatformTests.java` 99; `tests/AcceptanceTestRunner.java` 67; `tests/e2e_full_stack_test.sh` 56 (827 dòng, có đăng nhập `coord_htx01` ở :252, :302); `tests/unit/PureLogicTests.java` 51; Postman Tier1 collection 36; `services/telemetry/tests/test_telemetry.py` 25; `apps/traceability/tests/test_traceability.py` 25; `services/lake-archiver/tests/test_archiver.py` 23; `tests/unit/SecurityTests.java` 15; `ScannerTests.java` 12; `test_pipeline.py` 6. `UnitTestRunner.java`, `TestKit.java` là trung lập.

### Tầng 3 hiện có

[apps/traceability/traceability.py](../apps/traceability/traceability.py): docstring "rice supply-chain TRACEABILITY" (:4), tiêu đề HTML lúa gạo (:283). Lõi xác minh một lô so với cả epoch sổ cái (`verify` ~:105, `load_lot` :169, `build_trace` :199) là **trung lập** — dùng lại được cho "truy vết hàng cứu trợ".

## 4. Đề xuất ranh giới: nghiệp vụ ngập lụt nằm ở ứng dụng

Nguyên tắc: lõi chỉ biết *tổ chức, người dùng, vai trò (từ cấu hình), tài nguyên đặt lịch, thực thể có vị trí, sự kiện, quy trình, tệp, sổ cái*. Mọi từ "ruộng/máy/xuồng/hộ dân" thuộc ứng dụng.

| Lõi (trung lập) | Ứng dụng `apps/floodops` (ví dụ) |
|---|---|
| Phiên RLS `org/role/user` (`TenantRlsContext.applyPostgresRlsSession`) | Chính sách hiển thị: vai nào thấy hàng nào (thay `resolveFieldVisibility`) |
| Bộ kiểm tra xung đột: `resource_id`, `holder_id`, `[start,end)`, `status` → thay `ScheduleConflictEngine` hiện tại | Ánh xạ: tài nguyên = xuồng/xe bơm; người giữ = đội cứu hộ |
| Chấm điểm đa tiêu chí nhận danh sách tiêu chí + trọng số | Tiêu chí ngập lụt: khoảng cách, tải trọng, mực nước tuyến đường, mức ưu tiên hộ yếu thế |
| Engine BPMN nạp quy trình theo **danh mục** (khóa → file) từ cấu hình | File BPMN ngập lụt và danh mục |
| Kho thực thể theo **đăng ký bảng** (tên bảng, cột khóa, cột chủ sở hữu) | Schema miền trong file riêng, ví dụ `infra/db/domain/flood.sql` |
| Cổng `internal/telemetry` kiểm tra theo lược đồ do ứng dụng khai báo | Lược đồ bản tin trạm đo / xuồng |
| Danh sách vai trò đọc từ realm (không `FARMER` mặc định; thiếu vai → từ chối) | Realm ngập lụt: ví dụ `COMMUNE_COMMANDER`, `RESCUE_CREW`, `HAMLET_LEADER`, `HOUSEHOLD` |
| Registry truy vấn phân tích do ứng dụng nạp | `water-level-trend`, `rescue-response-time`… |

Mô hình miền ngập lụt gợi ý (chưa kiểm chứng nghiệp vụ): `hazard_zones` (vùng nguy cơ theo ấp), `households` (hộ dân, cờ yếu thế), `rescue_assets` (xuồng, xe, máy bơm), `crews`, `relief_requests` (hộ cần sơ tán/hỗ trợ — tương ứng `service_requests`), `missions` (tương ứng `assignments`, giữ GiST), `incidents` (vỡ bờ bao, hỏng trạm bơm), `shelters` (điểm sơ tán, sức chứa), `gauge_readings` (mực nước, mưa; ngưỡng báo động). Quy tắc RLS tương đương nông hộ: hộ dân chỉ thấy yêu cầu của chính mình.

Cách thực hiện tối thiểu, tránh dựng framework: (a) tách `infra/db/schema.sql` thành `core.sql` + `domain/*.sql` do entrypoint nạp idempotent; (b) bỏ DDL nhân đôi trong Java; (c) đưa danh mục BPMN, vai trò, bảng được truy vấn vào cấu hình ứng dụng; (d) thêm **kiểm thử ranh giới**: quét `core/` tìm từ cấm, chạy cùng bộ test để ranh giới không bị phá lại.

## 5. Rủi ro và thứ tự chuyển đổi

### Rủi ro

1. **Đổi tên bảng gây lỗi lặng lẽ**: kiểm tra `table_name='fields'` ở `initSchema` (:84), danh sách bảng cứng ở `queryWithRls`/`deleteTransactionalData`, tên bảng trong các câu SQL ~18 chỗ.
2. **Hai nguồn schema** (Java và `schema.sql`) dễ lệch nhau khi đổi.
3. **RLS/Zero-Trust có thể hỏng khi đổi vai trò**: tên vai trò nằm trong policy SQL (:267, :294), trong `TenantRlsContext` (:67-73), trong realm JSON, trong frontend (`UserRole`). Phải có test cô lập theo hàng chạy trên PostgreSQL thật, không mock.
4. **Mặc định vai `FARMER`** (KeycloakOidcEngine :1403, :2202, :2221) cần thành từ chối có chủ đích; sửa nó đổi hành vi bảo mật nên cần test riêng.
5. **Ràng buộc telemetry**: `fuel_pct`/`speed_kmh` bắt buộc (AgriOpsService :1603) chặn cảm biến mực nước.
6. **Dữ liệu lạnh cũ**: Parquet đã ghi có cột `machine_id`; lược đồ mới cần epoch/cột mới hoặc cách ly để archiver không trộn hai lược đồ.
7. **Sổ cái kiểm toán**: đổi tên sự kiện không phá chuỗi băm nhưng test và tài liệu tham chiếu tên cũ; chuỗi cũ trong volume phải được reset có chủ đích.
8. **Khóa quy trình Flowable** xuất hiện ở ≥3 nơi (engine :291-293, AgriDataStore :301, file BPMN); triển khai lên Flowable thật cần nạp lại định nghĩa.
9. **Khối lượng test/tài liệu**: ~400 dòng test chứa từ miền, 827 dòng E2E, Postman, README 657 dòng, ảnh chụp, `apps/web` + `apps/twin3d`. Không dùng thay chuỗi hàng loạt; làm theo tầng.
10. **Tính xác thực dữ liệu ngập lụt**: cảm biến/mực nước trong demo là mô phỏng; không được trình bày như dữ liệu quan trắc thật. Phải ghi rõ trong README (bảng Có / Mô phỏng / Chưa có).
11. **Khớp hồ sơ đề xuất**: hai file `.docx` đề xuất đang mô tả dịch vụ thu hoạch.
12. **Thời gian**: hạn nộp 17:00 06/12/2026; từ 02/11 còn 34 ngày.
13. **Việc nền chưa xong** (đã thỏa thuận từ trước): Prometheus/Grafana, triển khai Internet, tập thuyết trình. Chuyển miền không được ăn hết quỹ thời gian này.

### Thứ tự chuyển đổi đề xuất (mỗi bước một nhánh + PR, test xanh trước khi sang bước sau)

0. **Chốt đường cơ sở**: gắn tag, chạy đủ Java/Node/Python/E2E trên Docker thật, lưu kết quả.
1. **Thêm kiểm thử ranh giới** (quét từ miền trong `core/`) — ban đầu đỏ, là thước đo tiến độ.
2. **Tách miền khỏi lõi, giữ nguyên hành vi lúa**: bỏ DDL nhân đôi, đưa phương thức `sync*`, `resolveFieldVisibility`, `computeMultiCriteriaScore`, danh mục BPMN, whitelist phân tích sang `apps/agriops` hoặc cấu hình. Bộ test hiện tại là lưới an toàn.
3. **Tổng quát hóa 4 hợp đồng của lõi**: kiểm tra xung đột tài nguyên, chính sách hiển thị theo cấu hình, lược đồ telemetry do ứng dụng khai báo, vai trò thiếu → từ chối.
4. **Thêm `apps/floodops` song song** (schema `domain/flood.sql`, mô hình, BPMN, realm, seed, API). Chưa xóa lúa.
5. **Telemetry ngập lụt**: topic `sensors/`, bản tin mực nước, simulator trạm đo + xuồng, ACL Mosquitto, cột lake mới.
6. **Cổng điều hành và `/twin/`** theo kịch bản demo (bản đồ vùng ngập, ngưỡng báo động, xuồng/xe, điểm sơ tán).
7. **Tầng 3**: dùng lại lõi xác minh sổ cái cho truy vết hàng cứu trợ (ai nhận gì, lúc nào); module thứ hai tùy thời gian.
8. **Quyết định số phận ứng dụng lúa**: giữ làm app thứ hai chứng minh tính cắm-rút, hoặc gỡ.
9. **README/tài liệu theo đề thi**, bảng Có/Mô phỏng/Chưa có, kiểm tra xóa volume rồi khởi động lại tự phục hồi, E2E đầy đủ, PR.

## 6. Việc cần người dùng quyết trước khi bắt đầu

- Đổi tên toàn bộ bảng/mô hình (đúng nhưng rộng) hay chỉ lớp ứng dụng mới `floodops` chạy song song (an toàn hơn, giữ lúa làm ứng dụng thứ hai).
- Phạm vi nghiệp vụ ngập lụt cụ thể (xã/cụm xã nào, vai trò thật, tình huống chính của demo).
- Có dùng nguồn dữ liệu công khai thật (ví dụ mực nước quan trắc) hay chỉ mô phỏng có ghi chú.
