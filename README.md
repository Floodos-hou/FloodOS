# FloodOS — Hệ điều hành Chuyển đổi số mã nguồn mở (DX-OS Open-Core) cho điều phối ứng phó ngập lụt

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Java: 21 LTS](https://img.shields.io/badge/Java-21_LTS-orange.svg)](pom.xml)
[![Architecture: DX--OS Open--Core](https://img.shields.io/badge/Architecture-DX--OS_Open--Core-purple.svg)](docs/architecture.md)
[![Status: Prototype / MVP Preview](https://img.shields.io/badge/Status-Prototype%20%2F%20MVP%20Preview-yellow.svg)](CHANGELOG.md)
[![Standard: ETSI NGSI--LD](https://img.shields.io/badge/Standard-ETSI_NGSI--LD-informational.svg)](core/data-services/NgsiLdTwinMapper.java)

> Bài dự thi **OLP 2026 — Phần mềm nguồn mở**: *Xây dựng Hệ điều hành Chuyển đổi số bằng Công nghệ Lõi nguồn mở (DX-OS Open-Core)*.
> **FloodOS** gồm một **lõi nền tảng dùng chung** (Tầng 1, headless) và một **ứng dụng nghiệp vụ** điều phối ứng phó ngập lụt cho **một địa bàn thí điểm tại Hà Nội** chạy trên lõi đó.
> Mọi dữ liệu trong bản demo là **mô phỏng**: không có cảm biến thật, không có dữ liệu quan trắc chính thức và không có định tuyến giao thông (xem mục 3).

<p align="center">
  <img src="docs/assets/architecture_diagram.svg" alt="Kiến trúc FloodOS theo mô hình DX-OS Open-Core" width="100%">
</p>

---

## 1. Bài toán và câu chuyện demo

Khi mưa lớn hoặc nước dâng, một địa bàn phải làm liên tục năm việc: **tiếp nhận** tin báo của người dân, **xác minh và xếp ưu tiên**, **điều đội và phương tiện** mà không xếp trùng, **cập nhật hiện trường** và **điều phối lại** khi phương tiện hỏng, rồi **xác nhận xử lý xong** với dấu vết không thể sửa. FloodOS cài đặt đúng chuỗi đó trên nền tảng DX-OS:

`Báo tin → Xác minh/ưu tiên → Điều phối → Cập nhật hiện trường → Điều phối lại khi có sự cố → Xác nhận hoàn tất + niêm phong sổ cái`

Một vụ việc (chạy được bằng API thật và được kiểm thử tự động):

1. Chị Lan (người dân) gửi tin báo: nước sâu 55 cm, cần sơ tán 5 người. Hệ thống ghép tin vào vùng gần nhất theo **khoảng cách đường chim bay**.
2. Chị Hoa (điều phối viên) xác minh, đặt ưu tiên URGENT, điều **xuồng V02 + đội T02**. Nếu xuồng hoặc đội đã có lệnh trùng giờ, dịch vụ và PostgreSQL đều từ chối.
3. Đội trưởng cập nhật tiến độ. Xuồng hỏng chân vịt: hệ thống khoanh các lệnh bị ảnh hưởng và **xếp hạng phương án thay thế** (khoảng cách đường chim bay, độ phù hợp loại xe, tải, đánh giá đội) kèm lời giải thích.
4. Điều phối viên **tự chọn** một phương án; hệ thống không tự điều động. Lệnh cũ chuyển `SUPERSEDED`, lệnh mới `-R1` giữ nguyên mã vụ việc.
5. Đội thay thế hoàn thành, người dân xác nhận. Sổ cái SHA-256 nối toàn bộ chuỗi từ tin báo đến xác nhận; trang công khai Tầng 3 tự tính lại chuỗi băm mà không tin lời của lõi.

---

## 2. Kiến trúc 3 tầng DX-OS và ranh giới

| Tầng | Thành phần trong repo | Ghi chú |
|---|---|---|
| **1. Lõi dịch vụ số (headless PaaS)** | [`core/`](core/) (Java 21, không phụ thuộc thư viện ngoài) cùng Keycloak, APISIX, PostgreSQL, Flowable, SeaweedFS, Kafka/Karapace, Mosquitto, ClamAV, lake DuckDB | Không có giao diện. **Không chứa từ nào của nghiệp vụ ngập lụt**: một kiểm thử tự động quét `core/` tìm từ miền ([PlatformTests](tests/unit/PlatformTests.java), mục "Tier-1 boundary"). |
| **2. Không gian năng lực H-P-D-I** | API ứng dụng ở [`apps/floodos/`](apps/floodos/); giao diện còn lại ở [`apps/web`](apps/web), [`apps/twin3d`](apps/twin3d) | **Giao diện chưa được làm lại cho FloodOS** (xem mục 3 và 10). |
| **3. Ứng dụng nghiệp vụ** | FloodOS ([`apps/floodos/`](apps/floodos/)); truy xuất vụ việc công khai ([`apps/traceability/`](apps/traceability/)) | Quy tắc nghiệp vụ nằm ở đây, không nằm trong lõi. |

Ranh giới được thực thi bằng mã, không chỉ bằng tài liệu:

- Lõi chỉ biết *tổ chức, người dùng, vai trò đăng ký, tài nguyên đặt lịch, sự kiện, quy trình, tệp, sổ cái*. Vai trò do ứng dụng đăng ký lúc khởi động ([`FloodRoles.register()`](apps/floodos/FloodRoles.java)); token không có vai trò đã đăng ký bị từ chối (không có vai trò mặc định) và token thiếu `organization_id` không bao giờ được gán vào một tenant.
- Bộ kiểm tra xung đột lịch ([`ScheduleConflictEngine`](core/data-services/ScheduleConflictEngine.java)) làm việc với "tài nguyên + người giữ + khoảng thời gian", giống ràng buộc GiST trong PostgreSQL.
- SQL của ứng dụng nằm ở [`FloodRepository`](apps/floodos/FloodRepository.java); lõi chỉ cung cấp phiên RLS và giao dịch ([`PostgreSqlDataService`](core/data-services/PostgreSqlDataService.java)).
- **DDL chỉ có một nguồn**: [`infra/db/schema.sql`](infra/db/schema.sql), được container PostgreSQL áp dụng lại **mỗi lần khởi động**, dù volume mới hay cũ. Mã Java không tạo bảng; nó kiểm tra bảng có đủ và dừng ngay nếu thiếu.

### Ánh xạ bốn nguyên lý kỹ thuật của đề

| Nguyên lý của đề | Hiện thực trong repo |
|---|---|
| (i) Tách dữ liệu nóng/lạnh | Core → Kafka → lake-archiver → Parquet trên SeaweedFS S3 → DuckDB. Telemetry có bảng riêng `asset_telemetry`, sự kiện kiểm toán có bảng `audit`. |
| (ii) Hội tụ IT và OT, bản sao số | Mosquitto (xác thực, ACL theo topic) → ingestor → bản sao số NGSI-LD (`RescueVehicle`, `WaterGaugeStation`); **mỗi mẫu mang nhãn nguồn** `SIMULATOR` hoặc `DEVICE`. |
| (iii) Phả hệ, nguồn gốc, chất lượng dữ liệu | Sổ cái SHA-256 bất biến, `GET /audit/lineage/{correlation_id}`, Tầng 3 tự xác minh độc lập; mọi con số hiển thị có nhãn nguồn (SEED, SIMULATOR, REPORTED, DEVICE). |
| (iv) Zero-Trust, quét mã độc, hạ tầng bằng mã | APISIX + introspection Keycloak, RLS cưỡng bức, ClamAV fail-closed, hạ tầng bằng mã (Docker Compose, schema idempotent, realm nạp lúc khởi động). GitOps/ArgoCD và tự phục hồi bằng giám sát **chưa có** (mục 3). |

---

## 3. Trạng thái trung thực: Có / Mô phỏng / Chưa có

| Hạng mục | Trạng thái | Chi tiết |
|---|---|---|
| Đăng nhập một lần OIDC + PKCE (Keycloak thật) | **Có** | Kiểm thử E2E qua gateway; từ chối `code_verifier` bị sửa và mật khẩu sai. |
| Cổng API Zero-Trust (APISIX, introspection token) | **Có** | Đường `/api/v1/internal/*` bị chặn ở biên. |
| RBAC theo vai trò + quyền sở hữu | **Có** | 5 vai trò; người báo tin chỉ thấy dữ liệu của mình (ở Java và ở PostgreSQL). Thiếu vai trò thì từ chối. |
| Cô lập đa tenant và theo hàng (PostgreSQL RLS) | **Có** | `FORCE ROW LEVEL SECURITY`, vai trò ứng dụng không phải superuser; kiểm thử trực tiếp từng vai trò. Phiên rỗng hoặc vai trò lạ thấy 0 hàng. |
| Chống xếp trùng lịch | **Có** | Ràng buộc loại trừ GiST ở DB **và** kiểm tra ở dịch vụ (mã 409). |
| Quy trình BPMN | **Có, một phần** | Hai file BPMN trong [`infra/bpmn/`](infra/bpmn/) được triển khai lên Flowable thật và Flowable **khởi tạo** tiến trình. Từng bước do nền tảng theo dõi trong bản sao trạng thái; **chưa gọi REST để hoàn tất user task trong Flowable**. Sau khi khởi động lại, bản sao được dựng lại từ bảng nghiệp vụ và gắn nhãn `STATE_MIRROR`. |
| Ảnh hiện trường (SeaweedFS S3) + quét mã độc ClamAV | **Có** | Ảnh nhiễm EICAR bị từ chối 422; ClamAV tắt thì từ chối 503 (fail-closed); tệp không phải ảnh bị từ chối 415. |
| Sổ cái kiểm toán SHA-256, phả hệ, trang truy xuất công khai | **Có** | Tầng 3 tự tính lại chuỗi băm từ Parquet; trang công khai không hiện danh tính. |
| Luồng nóng/lạnh Kafka → Parquet → DuckDB | **Có** | Truy vấn `summary`, `actions-by-day`, `asset-utilization`, `water-level-summary`. |
| Telemetry xe và trạm đo | **Mô phỏng** | Bộ mô phỏng ([`services/telemetry/simulator.py`](services/telemetry/simulator.py)) phát qua MQTT thật, mỗi mẫu `source=SIMULATOR`. Xe đi **theo đường thẳng** tới vùng, tua nhanh. Mực nước là bước ngẫu nhiên có chặn. |
| Dữ liệu seed (vùng, đội, xe, điểm trú, tin báo) | **Mô phỏng** | Tên hư cấu, tọa độ minh họa trong Hà Nội, không mô tả nơi ngập thật. Nhãn `SEED`. |
| Quan trắc/dự báo chính thức của Hà Nội | **Chưa có** | Không dùng và không bịa nguồn. Enum nguồn có `DEVICE` để dành cho thiết bị thật. |
| Định tuyến đường bộ/đường thủy, tránh vùng ngập | **Chưa có** | Khoảng cách là Haversine (đường chim bay). Không có PostGIS, không có routing. |
| Giao diện FloodOS (cổng điều hành, bản đồ, điện thoại) | **Chưa có** | [`apps/web`](apps/web) và [`apps/twin3d`](apps/twin3d) vẫn là giao diện của nguyên mẫu thu hoạch lúa cũ; gateway vẫn phục vụ chúng nhưng chúng **không dùng được với API mới**. Đây là bước tiếp theo. |
| Giám sát Prometheus/Grafana, tự phục hồi, GitOps (ArgoCD) | **Chưa có** | Ingestor và lake-archiver có `/health` và `/metrics` dạng Prometheus, nhưng chưa có Prometheus/Grafana hay ArgoCD, chưa có bằng chứng phục hồi tự động. |
| Triển khai Internet, mật khẩu mạnh, MFA, Vault | **Chưa có** | Mật khẩu `123456` chỉ dùng cho realm demo; `compose.prod.yaml` đòi bí mật tường minh nhưng realm vẫn là realm demo. |
| Thành phần AI/RAG (không gian [I]) | **Chưa có** | "Gợi ý phương án thay thế" là **xếp hạng theo luật có giải thích**, không phải mô hình AI. |
| Quản trị đơn vị (tạo người dùng, cấp phạm vi) | **Chưa có** | Người dùng đến từ realm Keycloak; chưa có API quản trị. |
| Hàng đợi ngoại tuyến trên điện thoại | **Chưa có** | |

---

## 4. Vai trò, quyền và phạm vi dữ liệu

| Vai trò | Được làm | Chỉ thấy |
|---|---|---|
| `REPORTER` Người báo tin | Gửi tin báo (kèm ảnh); xác nhận hoặc phản đối kết quả của **chính tin báo mình** | Tin báo của mình, vùng chứa các tin đó, lệnh và xe đang phục vụ mình, điểm trú, trạm đo. Không thấy đội, sự cố, tin của người khác. |
| `DISPATCHER` Điều phối viên | Xác minh/từ chối, đặt ưu tiên, điều đội+xe, duyệt phương án thay thế, cập nhật điểm trú, xác nhận thay người báo tin, xem phân tích lạnh | Toàn bộ dữ liệu của đơn vị mình. |
| `FIELD_TEAM` Đội hiện trường | Bắt đầu/cập nhật/hoàn thành **lệnh của đội mình**; báo sự cố phương tiện mình đang dùng | Đội mình, lệnh và xe của đội, tin báo đứng sau lệnh đó, sự cố mình báo. |
| `RESOURCE_MANAGER` Quản lý nguồn lực | Cập nhật và đóng phiếu sửa chữa gắn với mình. **Không duyệt điều động.** | Đội, xe, lệnh, sự cố. Không thấy tin báo của người dân. |
| `PLATFORM_ADMIN` Quản trị nền tảng | Đặt lại dữ liệu demo (chỉ khi `FLOODOS_ALLOW_DEMO_RESET=true`; đóng trong production) | Dữ liệu của tenant trong token; không có quyền nghiệp vụ (tách nhiệm vụ). |

Quy tắc chung: bản ghi không thuộc phạm vi của người gọi trả **404** (không lộ sự tồn tại) và được ghi audit; vai trò không đủ quyền trả **403** và ghi `RBAC_BLOCKED_*` vào sổ cái. Các quy tắc này được hiện thực và kiểm thử ở ba nơi: dịch vụ Java ([`FloodOSService`](apps/floodos/FloodOSService.java)), chính sách RLS ([`schema.sql`](infra/db/schema.sql)) và realm Keycloak ([`floodos-realm.json`](infra/keycloak/floodos-realm.json)); một kiểm thử đối chiếu realm với seed của ứng dụng để hai danh sách không lệch nhau.

---

## 5. Mô hình dữ liệu và API

Bảng của ứng dụng (tên mới, **không đụng** bảng của nguyên mẫu cũ): `flood_zones`, `flood_reports`, `rescue_teams`, `rescue_vehicles`, `dispatch_orders`, `field_incidents`, `report_resolutions`, `safe_shelters`, `gauge_stations`. Bảng nền tảng: `organizations`, `users`, `audit_records`.

| Phương thức, đường dẫn | Vai trò | Ý nghĩa |
|---|---|---|
| `POST /api/v1/flood-reports` | REPORTER, DISPATCHER | Gửi tin báo; máy chủ ghép vùng theo đường chim bay (tối đa 5 km) |
| `POST /api/v1/flood-reports/{id}/verify` | DISPATCHER | Xác minh (kèm ưu tiên) hoặc từ chối (kèm lý do) |
| `POST /api/v1/dispatch-orders` | DISPATCHER | Điều đội + xe + khung giờ; 409 khi trùng, 422 khi xe không phù hợp nhu cầu |
| `POST /api/v1/dispatch-orders/{id}/status` | FIELD_TEAM (đội của lệnh), DISPATCHER | `IN_PROGRESS` / `COMPLETED` (+ `outcome`) |
| `POST /api/v1/field-incidents` | FIELD_TEAM, DISPATCHER | Báo xe hỏng; trả danh sách phương án xếp hạng |
| `POST /api/v1/field-incidents/{id}/approve-replan` | DISPATCHER | Duyệt **một** phương án (`option_id` bắt buộc) |
| `POST /api/v1/field-incidents/{id}/repair-ticket` | RESOURCE_MANAGER, DISPATCHER | Cập nhật hoặc đóng phiếu sửa chữa |
| `POST /api/v1/resolutions` | REPORTER (tin của mình), DISPATCHER | `CONFIRMED` hoặc `DISPUTED` |
| `POST /api/v1/shelters/{id}/occupancy` | DISPATCHER | Cập nhật số người ở điểm trú |
| `GET /api/v1/state`, `/digital-twin/entities`, `/audit/verify`, `/audit/lineage/{id}`, `/analytics/{q}`, `/stream/events` | theo phạm vi vai trò | Trạng thái, bản sao số NGSI-LD, kiểm chứng chuỗi băm, phả hệ, phân tích lạnh |

Đặc tả đầy đủ: [`docs/api-spec.md`](docs/api-spec.md). Bộ Postman: [`tests/postman/FloodOS.postman_collection.json`](tests/postman/FloodOS.postman_collection.json).

**Máy trạng thái của tin báo:** `RECEIVED → VERIFIED | REJECTED → DISPATCHED → IN_PROGRESS → AWAITING_CONFIRMATION → RESOLVED`. Khi xe hỏng: `IN_PROGRESS → IMPACTED → RESCHEDULED → IN_PROGRESS`. Khi bị phản đối: `AWAITING_CONFIRMATION → VERIFIED`. BPMN: [`flood_report_lifecycle`](infra/bpmn/flood_report_lifecycle.bpmn20.xml) (SOP-01) và [`dispatch_replan`](infra/bpmn/dispatch_replan.bpmn20.xml) (SOP-02).

---

## 6. Minh bạch dữ liệu

- Mọi vị trí xe và mực nước có **nhãn nguồn** (`telemetry_source`, `water_level_source`, `source`) và thời điểm cập nhật; API trả thêm `position_is_simulated`, `data_notice` và `data_sources`.
- Ingestor **từ chối** bản tin thiếu hoặc sai nhãn nguồn (chỉ `SIMULATOR` hoặc `DEVICE`, so khớp chính xác); dịch vụ lõi và lake-archiver cũng vậy, nên giá trị mô phỏng không thể bị lưu như quan trắc.
- Phương án thay thế ghi rõ `distance_kind = STRAIGHT_LINE_HAVERSINE`: khoảng cách đường chim bay, **không phải tuyến đường**, chưa tính đường ngập. Ngưỡng công suất bơm (10 m³/giờ cho mỗi cm nước) là một quy ước ghi trong mã, không phải tiêu chuẩn thủy lực.
- Điều phối viên luôn là người quyết định; hệ thống không tự điều động.

---

## 7. Chạy hệ thống

Yêu cầu: Docker (Compose v2), Java 21 (chạy kiểm thử cục bộ), Python 3, Node 20+ (kiểm thử giao diện cũ).

```bash
docker compose --profile demo up -d --build          # dựng toàn bộ stack + bộ mô phỏng thiết bị
curl http://localhost:9080/api/v1/health             # qua gateway APISIX
```

Đăng nhập bằng luồng PKCE qua gateway (xem [`docs/api-spec.md`](docs/api-spec.md), mục 2). Tài khoản demo, mật khẩu `123456`, **chỉ dùng cho bản mô phỏng**:

| Tài khoản | Vai trò | Đơn vị |
|---|---|---|
| `reporter_lan`, `reporter_hung` | REPORTER | `ORG_HN_PILOT_01` |
| `dispatcher_hoa` | DISPATCHER | `ORG_HN_PILOT_01` |
| `team_binh`, `team_cuong`, `team_dung` | FIELD_TEAM (đội T01, T02, T03) | `ORG_HN_PILOT_01` |
| `resource_giang` | RESOURCE_MANAGER | `ORG_HN_PILOT_01` |
| `platform_admin` | PLATFORM_ADMIN | `ORG_HN_PILOT_01` |
| `reporter_mai`, `dispatcher_tuan`, `team_hai` | đơn vị đối chứng để kiểm thử cô lập tenant | `ORG_HN_PILOT_02` |

Production: sao chép `.env.production.example`, đặt bí mật riêng, chạy `docker compose -f compose.yaml -f compose.prod.yaml up -d`. Bản này đóng các cổng nội bộ ra máy chủ và **tắt** `POST /api/v1/sim/reset`. Chưa có triển khai Internet nào được kiểm chứng.

**Nâng cấp từ nguyên mẫu thu hoạch lúa trên volume cũ** (đã kiểm thử): `schema.sql` được áp dụng chồng lên volume cũ; ràng buộc `role`/`org_type` được thay bằng `NOT VALID` (dòng cũ vẫn đọc được, dòng mới bị kiểm tra); các bảng cũ (`fields`, `machines`, …) **không bị xóa** và không còn được đọc. Keycloak chỉ nạp realm ở lần khởi động đầu: với container Keycloak cũ, chạy `docker compose up -d --force-recreate keycloak core-api apisix` (script E2E tự làm bước này khi phát hiện realm cũ).

---

## 8. Kiểm thử

```bash
bash tests/run_unit_tests.sh                                         # Java + Node + Python (Python chạy trong container)
java -cp target/classes org.floodos.tests.AcceptanceTestRunner    # chấp nhận trong tiến trình: HTTP thật, luồng đầy đủ
bash tests/e2e_full_stack_test.sh                                    # toàn stack bằng Docker thật, không giả lập
```

Kết quả của lần chạy gần nhất (kèm lệnh và mã thoát) được ghi ở [`CHANGELOG.md`](CHANGELOG.md). Phạm vi:

- **Đơn vị Java** ([`tests/unit/`](tests/unit/)): xung đột lịch, xếp hạng, JWT/PKCE, sổ cái, RBAC và phạm vi theo vai trò, quy tắc nghiệp vụ, cổng mã độc, ranh giới Tầng 1, đối chiếu realm với seed, DDL một nguồn, hợp đồng Postman.
- **Chấp nhận trong tiến trình**: toàn bộ câu chuyện ở mục 1 qua HTTP thật.
- **E2E toàn stack** ([`tests/e2e_full_stack_test.sh`](tests/e2e_full_stack_test.sh)): schema idempotent trên volume cũ, RLS từng vai trò bằng vai trò DB không phải superuser, PKCE với Keycloak thật, luồng vàng qua APISIX với mỗi vai trò một danh tính thật, Flowable, ClamAV (EICAR), MQTT (ACL, nhãn nguồn), Kafka→Parquet→DuckDB, trang truy xuất công khai, khởi động lại core.
- **Python**: lake-archiver, telemetry (ingestor + simulator), traceability.

---

## 9. Công nghệ và giấy phép

| Thành phần | Phiên bản | Giấy phép |
|---|---|---|
| Java (Eclipse Temurin) | 21 LTS | GPL-2.0 + Classpath Exception |
| Keycloak | 24.0.5 | Apache-2.0 |
| Apache APISIX | 3.9.0 | Apache-2.0 |
| Flowable REST | 7.0.0 | Apache-2.0 |
| PostgreSQL | 16.2 | PostgreSQL License |
| SeaweedFS | 3.64 | Apache-2.0 |
| Apache Kafka, Karapace | 3.7.1, 4.1.0 | Apache-2.0 |
| Eclipse Mosquitto | 2.0.18 | EPL-2.0 / EDL-1.0 |
| ClamAV | 1.4.3 | GPL-2.0 |
| DuckDB (lake-archiver) | xem [requirements](services/lake-archiver/requirements.txt) | MIT |

Mã của dự án: **Apache-2.0** ([`LICENSE`](LICENSE)). Danh mục thư viện và nguồn dữ liệu: [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

---

## 10. Hạn chế đã biết và lộ trình

1. **Giao diện FloodOS chưa làm** (cổng điều hành theo vai trò, bản đồ, màn hình điện thoại). `apps/web` và `apps/twin3d` là giao diện cũ và không khớp API mới. Thiết kế UX mục tiêu: [`docs/floodos-demo-ux.md`](docs/floodos-demo-ux.md) (đích thiết kế, chưa phải chức năng đã có).
2. Hoàn tất user task của Flowable qua REST (hiện chỉ khởi tạo tiến trình và theo dõi bước ở nền tảng).
3. Giám sát (Prometheus/Grafana), GitOps (ArgoCD), bằng chứng tự phục hồi, triển khai Internet, mật khẩu/MFA cho môi trường công khai.
4. Dữ liệu quan trắc thật (nếu có nguồn được phép dùng) thay cho mô phỏng; định tuyến thật thay cho đường chim bay.
5. API quản trị đơn vị; hàng đợi ngoại tuyến; thành phần AI có giải thích.

Tài liệu kỹ thuật: [`docs/architecture.md`](docs/architecture.md), [`docs/api-spec.md`](docs/api-spec.md), [`docs/security.md`](docs/security.md), [`docs/product-direction.md`](docs/product-direction.md), [`docs/demo-guide.md`](docs/demo-guide.md). Đóng góp: [`CONTRIBUTING.md`](CONTRIBUTING.md).
