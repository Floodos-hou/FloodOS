# FloodOS — Đặc tả REST API

Hợp đồng của API do [`FloodOSServer`](../apps/floodos/FloodOSServer.java) phục vụ (Tầng 1 headless + ứng dụng FloodOS). Bộ Postman tương ứng, chạy được và được kiểm thử tự động so với danh sách route thật: [`tests/postman/FloodOS.postman_collection.json`](../tests/postman/FloodOS.postman_collection.json).

> **Dữ liệu demo là mô phỏng.** Phản hồi `GET /api/v1/state` luôn kèm `data_notice` và `data_sources`; từng vị trí xe/mực nước có nhãn nguồn (`SEED`, `SIMULATOR`, `REPORTED`, `DEVICE`). Khoảng cách trong phương án thay thế là **đường chim bay (Haversine)**, không phải tuyến đường.

Quy ước chung:

- Mọi lỗi nghiệp vụ trả JSON `{"error": "<MÃ>", "status": <http>, "message": "<tiếng Việt>"}`; không có giá trị mặc định ngầm cho trường bắt buộc (thiếu hoặc sai trường là `400`).
- `401`: không có token hợp lệ, **hoặc** token không có `organization_id`, **hoặc** token không mang vai trò nào mà ứng dụng đã đăng ký (không có vai trò mặc định).
- `403`: vai trò không đủ quyền; sự kiện `RBAC_BLOCKED_*` được ghi vào sổ cái.
- `404`: bản ghi không tồn tại **hoặc không thuộc phạm vi của người gọi** (không phân biệt, để không lộ sự tồn tại); trường hợp thứ hai được ghi audit.
- `409`: xung đột trạng thái hoặc lịch. `422`: dữ liệu hợp lệ về cú pháp nhưng nghiệp vụ không chấp nhận (xe không phù hợp, ngoài vùng theo dõi, mã độc, không có phương án).
- Thời điểm là ISO-8601 UTC (`2026-11-20T08:00:00Z`).

## 1. Tổng quan endpoint

| Phương thức | Đường dẫn | Vai trò | Mô tả | Mã chính |
|:--:|:--|:--|:--|:--|
| GET | `/`, `/api/v1` | công khai | Manifest khám phá dịch vụ | 200 |
| GET | `/api/v1/health` | công khai | Sức khỏe các dịch vụ lõi, **vai trò đã đăng ký**, định nghĩa BPMN đã nạp | 200 |
| GET | `/api/v1/auth/accounts` | công khai | Tài khoản demo (không dùng cho môi trường công khai) | 200 |
| GET | `/api/v1/auth/pkce/authorize-url` | công khai | Tạo phiên PKCE; client tự giữ `code_verifier` và gửi `code_challenge` (S256) | 200 / 400 |
| POST | `/api/v1/auth/pkce/authorize-code` | công khai | Cầu nối cho kiểm thử/CI: đăng nhập Keycloak thật, trả `code` | 200 / 401 |
| POST | `/api/v1/auth/pkce/token` | công khai | Đổi `code` + `code_verifier` lấy access token (RFC 7636, RFC 9700) | 200 / 400 / 401 |
| POST | `/api/v1/auth/login` | công khai | Đăng nhập mật khẩu (đã lỗi thời theo RFC 9700; có thể tắt bằng `FLOODOS_STRICT_RFC9700`) | 200 / 401 / 410 |
| GET | `/api/v1/auth/userinfo` | Bearer | Danh tính từ token | 200 |
| GET | `/api/v1/state` | Bearer | Bức tranh trạng thái **đã lọc theo vai trò** (mục 3) | 200 |
| GET | `/api/v1/digital-twin/entities` | Bearer | Thực thể NGSI-LD `RescueVehicle`, `WaterGaugeStation`, mỗi thực thể có `dataSource` | 200 |
| POST | `/api/v1/flood-reports` | REPORTER, DISPATCHER | Gửi tin báo ngập (có thể kèm ảnh) | 201 / 400 / 415 / 422 / 503 |
| POST | `/api/v1/flood-reports/{id}/verify` | DISPATCHER | Xác minh (kèm ưu tiên) hoặc từ chối (kèm lý do) | 200 / 400 / 404 / 409 |
| POST | `/api/v1/dispatch-orders` | DISPATCHER | Điều đội + xe + khung giờ | 201 / 400 / 404 / 409 / 422 |
| POST | `/api/v1/dispatch-orders/{id}/status` | FIELD_TEAM (đội của lệnh), DISPATCHER | `IN_PROGRESS` hoặc `COMPLETED` | 200 / 400 / 404 / 409 |
| POST | `/api/v1/field-incidents` | FIELD_TEAM, DISPATCHER | Báo xe hỏng; trả phương án thay thế xếp hạng | 201 / 400 / 404 / 409 |
| POST | `/api/v1/field-incidents/{id}/approve-replan` | DISPATCHER | Duyệt một phương án (`option_id` bắt buộc) | 200 / 400 / 404 / 409 / 422 |
| POST | `/api/v1/field-incidents/{id}/repair-ticket` | RESOURCE_MANAGER (phiếu của mình), DISPATCHER | Cập nhật/đóng phiếu sửa chữa | 200 / 400 / 404 / 409 |
| POST | `/api/v1/resolutions` | REPORTER (tin của mình), DISPATCHER | `CONFIRMED` hoặc `DISPUTED` kết quả xử lý | 200 / 400 / 404 / 409 |
| POST | `/api/v1/shelters/{id}/occupancy` | DISPATCHER | Cập nhật số người ở điểm trú | 200 / 400 / 404 |
| GET | `/api/v1/audit/verify` | Bearer | Kiểm chứng toàn bộ chuỗi băm SHA-256 | 200 |
| GET | `/api/v1/audit/lineage/{correlation_id}` | Bearer | Phả hệ các sự kiện của một vụ việc (`CORR-<report_id>`) | 200 |
| GET | `/api/v1/analytics/{summary\|actions-by-day\|asset-utilization\|water-level-summary}` | DISPATCHER, PLATFORM_ADMIN | Phân tích trên kho lạnh Parquet bằng DuckDB, giới hạn theo `organization_id` của token | 200 / 403 / 404 / 503 |
| GET | `/api/v1/stream/events` | Bearer | SSE: snapshot kiểm toán + nhịp tim | 200 |
| POST | `/api/v1/sim/reset` | PLATFORM_ADMIN, **chỉ khi** `FLOODOS_ALLOW_DEMO_RESET=true` | Khôi phục dữ liệu mô phỏng, bắt đầu epoch sổ cái mới | 200 / 403 |
| POST | `/api/v1/internal/telemetry` | `X-Ingest-Token` (nội bộ; **APISIX chặn 404 ở biên**) | Một mẫu `vehicle` hoặc `gauge` đã được ingestor xác thực | 200 / 400 / 401 / 404 / 409 / 503 |
| GET | `/api/v1/internal/assets` | `X-Ingest-Token` (nội bộ, chặn ở biên) | Danh sách xe và trạm đo cho bộ mô phỏng, kèm đích đường thẳng | 200 / 401 / 503 |

## 2. Đăng nhập (PKCE qua gateway)

1. Client tạo `code_verifier` (43–128 ký tự), tính `code_challenge = BASE64URL(SHA256(code_verifier))`.
2. `GET /api/v1/auth/pkce/authorize-url?state=<csrf>&code_challenge=<S256>&redirect_uri=<uri>`. Máy chủ **không** trả `code_verifier`. `code_challenge` sai định dạng bị `400`.
3. Người dùng đăng nhập tại Keycloak (trình duyệt) hoặc, trong CI, `POST /api/v1/auth/pkce/authorize-code` với `{username, password, code_challenge, state, redirect_uri}`.
4. `POST /api/v1/auth/pkce/token` với `{code, code_verifier, state, redirect_uri}` → `access_token`. `code_verifier` bị sửa bị từ chối.

## 3. Trạng thái theo vai trò (`GET /api/v1/state`)

Các khóa: `auth_context`, `server_time`, `data_notice`, `data_sources`, `zones`, `reports`, `teams`, `vehicles`, `orders`, `incidents`, `resolutions`, `shelters`, `gauges`, `bpmn_instances`, `bpmn_definitions`, `evidence_objects`, `audit_logs`, `audit_chain_proof`.

| Vai trò | `reports` | `zones` | `vehicles` | `orders` | `teams` | `incidents` |
|:--|:--|:--|:--|:--|:--|:--|
| REPORTER | của mình | vùng chứa tin của mình | xe đang phục vụ tin của mình | của mình | — | — |
| DISPATCHER | toàn đơn vị | toàn đơn vị | toàn đơn vị | toàn đơn vị | toàn đơn vị | toàn đơn vị |
| FIELD_TEAM | tin đứng sau lệnh của đội | toàn đơn vị | xe của đội và xe trên lệnh của đội | lệnh của đội | đội mình | sự cố mình báo |
| RESOURCE_MANAGER | — | toàn đơn vị | toàn đơn vị | toàn đơn vị | toàn đơn vị | toàn đơn vị |
| PLATFORM_ADMIN | toàn tenant của token | toàn tenant | toàn tenant | toàn tenant | toàn tenant | toàn tenant |

`shelters` và `gauges` (thông tin an toàn công cộng) hiển thị cho mọi vai trò trong cùng đơn vị. `evidence_objects` chỉ dành cho DISPATCHER/PLATFORM_ADMIN. Dữ liệu ngoài phạm vi **không được gửi đi** (không có bản che giấu nào ở phía trình duyệt). Cùng quy tắc được PostgreSQL cưỡng bức bằng RLS ([`infra/db/schema.sql`](../infra/db/schema.sql)).

## 4. Payload mẫu

### 4.1. Gửi tin báo (`POST /api/v1/flood-reports`)

```json
{
  "lat": 20.9665, "lng": 105.8712,
  "depth_cm": 55,
  "need_type": "EVACUATION",
  "people_affected": 5,
  "description": "Nước vào nhà, cần đưa người già ra điểm trú",
  "evidence_filename": "nuoc.png",
  "evidence_data_url": "data:image/png;base64,iVBORw0KGgo..."
}
```

`need_type` ∈ `EVACUATION | FOOD_WATER | MEDICAL | PUMPING | ROAD_BLOCKED`. `depth_cm` ∈ [0, 1000]. Ảnh là tùy chọn; chỉ nhận `image/jpeg|png|webp` (`415` nếu khác), được **quét ClamAV trước khi lưu** (`422 MALWARE_DETECTED`; `503 MALWARE_SCANNER_UNAVAILABLE` khi không quét được — fail-closed).

**201**:

```json
{"ok": true, "report_id": "FR-3F9A1C", "zone_id": "Z01", "zone_match": "NEAREST_ZONE_CENTER_STRAIGHT_LINE",
 "bpmn_process_id": "PRC-FR-3F9A1C", "correlation_id": "CORR-FR-3F9A1C", "audit": {"seq_no": 10, "action": "CREATE_FLOOD_REPORT", "...": "..."}}
```

Người báo tin **không** chọn được vùng: máy chủ ghép vùng có tâm gần nhất theo đường chim bay, tối đa 5 km (`422 OUTSIDE_MONITORED_AREA` nếu xa hơn). Chỉ DISPATCHER được truyền `zone_id` (tin nhận qua điện thoại, `channel = PHONE`).

### 4.2. Điều phối và xung đột (`POST /api/v1/dispatch-orders`)

```json
{"report_id": "FR-3F9A1C", "vehicle_id": "V02", "team_id": "T02",
 "start_time": "2030-01-01T08:00:00Z", "end_time": "2030-01-01T10:00:00Z"}
```

Chỉ điều phối được tin ở trạng thái `VERIFIED`. Khoảng thời gian là nửa mở `[start, end)`, giống ràng buộc `EXCLUDE USING gist` trong PostgreSQL. **409**:

```json
{"error": "RESOURCE_TIME_OVERLAP", "status": 409,
 "message": "Phương tiện V02 đã có lệnh trùng khung giờ.",
 "conflict_details": {"code": "RESOURCE_TIME_OVERLAP", "resource_id": "V02",
                      "conflicting_booking": {"order_id": "ORD-0007", "start_time": "…", "end_time": "…", "status": "CONFIRMED"}},
 "audit_event": {"action": "CONFLICT_BLOCKED_RESOURCE_TIME_OVERLAP", "...": "..."}}
```

Mã khác: `HOLDER_TIME_OVERLAP` (đội bận), `RESOURCE_UNAVAILABLE` (xe `BREAKDOWN`/`MAINTENANCE`), `RESOURCE_NOT_FOUND` (xe không thuộc đơn vị), `422 VEHICLE_NOT_SUITABLE` (ví dụ máy bơm không đi sơ tán người).

### 4.3. Sự cố và phương án thay thế (`POST /api/v1/field-incidents`)

```json
{"vehicle_id": "V02", "severity": "CRITICAL", "incident_type": "PROPELLER_FOULED",
 "description": "Chân vịt vướng rác", "estimated_downtime_hours": 4}
```

**201** gồm `impacted_order_ids`, `no_feasible_option` và `candidate_options` đã xếp hạng:

```json
{"option_id": "OPT-V01-T01-ORD-3A91B2", "vehicle_id": "V01", "team_id": "T01",
 "distance_km": 0.12, "distance_kind": "STRAIGHT_LINE_HAVERSINE",
 "suitability": 1.0, "capacity_fit": 1.0, "score": 99.1, "position_is_simulated": true,
 "explanations": ["Sẵn sàng: …", "Khoảng cách đường chim bay (Haversine): 0.12 km … không phải tuyến đường …", "…"]}
```

Điểm (0–100) = 40 khoảng cách (về 0 ở 15 km) + 25 độ phù hợp loại xe với nhu cầu + 20 độ đáp ứng công suất + 15 đánh giá đội ([`RescueScoring`](../apps/floodos/RescueScoring.java)). Chỉ đưa ra xe **rảnh trong khung giờ**, **phù hợp nhu cầu** và **có đội**. Duyệt: `POST …/approve-replan` với `{"option_id": "…"}`; thiếu `option_id` là `400` (hệ thống không tự điều động); không có phương án là `422 NO_FEASIBLE_OPTION_AVAILABLE`.

### 4.4. Hoàn thành và xác nhận

```json
POST /api/v1/dispatch-orders/ORD-3A91B2-R1/status
{"status": "COMPLETED", "progress_pct": 100, "outcome": "RESOLVED", "final_depth_cm": 8}
→ 200 {"ok": true, "order": {…}, "resolution_id": "RES-ORD-3A91B2-R1", "audit": {…}}

POST /api/v1/resolutions
{"resolution_id": "RES-ORD-3A91B2-R1", "decision": "CONFIRMED"}
→ 200 {"ok": true, "report_status": "RESOLVED", "resolution": {…}}
```

`DISPUTED` yêu cầu `notes` và đưa tin báo về `VERIFIED` để điều phối lại. Chỉ người báo tin của **chính tin đó** (hoặc điều phối viên) xác nhận được; đội hiện trường không tự xác nhận công việc của mình.

### 4.5. Telemetry nội bộ (`POST /api/v1/internal/telemetry`)

```json
{"asset_kind": "vehicle", "asset_id": "V03", "organization_id": "ORG_HN_PILOT_01", "ts": "2026-11-20T10:00:00Z",
 "lat": 20.97, "lon": 105.86, "fuel_pct": 61.5, "speed_kmh": 6.2, "source": "SIMULATOR"}
{"asset_kind": "gauge", "asset_id": "G03", "organization_id": "ORG_HN_PILOT_01", "ts": "2026-11-20T10:00:00Z",
 "level_cm": 130, "source": "SIMULATOR"}
```

`source` bắt buộc và chỉ nhận `SIMULATOR` hoặc `DEVICE` (khớp chính xác). Khoảng hợp lệ: `lat` [-90,90], `lon` [-180,180], `fuel_pct` [0,100], `speed_kmh` [0,80], `level_cm` [0,1000]. Mẫu bị từ chối **không làm đổi** bản sao số. Trạng thái xe (`status`) do quy trình sở hữu và không bao giờ bị telemetry thay đổi. Mẫu trạm đo cập nhật `water_level_cm`/`water_level_source` của vùng và suy ra `risk_level` theo ngưỡng của chính trạm.

## 5. Kênh MQTT (thiết bị → ingestor)

`floodos/<organization_id>/vehicles/<vehicle_id>/telemetry` và `floodos/<organization_id>/gauges/<station_id>/telemetry`. Mosquitto yêu cầu xác thực; tài khoản thiết bị chỉ được **ghi** hai họ topic này, tài khoản ingestor chỉ được **đọc**. Họ topic cũ `…/machines/…` không còn tồn tại.
