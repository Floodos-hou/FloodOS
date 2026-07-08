# OpenAgriOS — Kiến Trúc Hệ Thống (DX-OS Open-Core)

OpenAgriOS được thiết kế theo triết lý **DX-OS Open-Core (Digital Transformation Operating System)**: tách bạch hoàn toàn giữa **Nền tảng lõi dùng chung (Headless Core PaaS & Capability Engines)**, **Không gian năng lực số & Cổng điều hành tác chiến đa vai trò (Experience & Operations Portal — H-P-D-I)** và **Ứng dụng nghiệp vụ chuyên ngành cắm-và-chạy (Domain Business Apps)**.

---

## 1. Mô hình Kiến trúc Tổng thể

<p align="center">
  <img src="assets/architecture_diagram.svg" alt="Kiến trúc Tổng thể OpenAgriOS DX-OS" width="100%">
</p>

```mermaid
flowchart TD
    subgraph T3 ["ỨNG DỤNG NGHIỆP VỤ MỞ RỘNG (DOMAIN BUSINESS APPS)"]
        FutureApps["Các mô-đun mở rộng tương lai (Truy xuất nguồn gốc chuỗi cung ứng, Quản lý vật tư phân bón, Drone)"]
    end

    subgraph T2 ["KHÔNG GIAN NĂNG LỰC SỐ & CỔNG ĐIỀU HÀNH TÁC CHIẾN (EXPERIENCE & OPERATIONS PORTAL — H-P-D-I)"]
        H["[H] Human Role Workspaces — Cổng Nông hộ · Điều phối viên · Buồng lái Lái máy · Chủ máy · Đội sửa chữa"]
        P["[P] Process Command Card — Bảng lệnh quy trình BPMN 2.0 theo Candidate Groups (SOP-01 & SOP-02)"]
        D["[D] Data & Tactical Map — Bản đồ số 2D/2.5D Digital Twin & Sương mù phân quyền (Role-Based Fog of War)"]
        I["[I] Intelligence Radar — Radar gợi ý máy cứu viện (Green Vector), giải thích đa tiêu chí & cảnh báo xung đột"]
    end

    subgraph T1 ["NỀN TẢNG LÕI HEADLESS CORE PaaS & CAPABILITY ENGINES (core/ & apps/agriops)"]
        subgraph Sec ["Identity & Gateway"]
            IAM["core/identity — Keycloak OIDC, JWT, PKCE RFC 7636, RBAC Multi-Tenancy"]
            GW["core/api-gateway — Apache APISIX Zero-Trust Guard (:9080) & Rate Limit"]
        end
        subgraph Engines ["Capability Engines"]
            ConflictEngine["ScheduleConflictEngine — Kiểm tra xung đột thời gian & tài nguyên (GiST)"]
            SpatialEngine["SpatialMatchingEngine — Phân tích không gian Haversine & Chấm điểm cứu viện"]
        end
        subgraph Flow ["Workflow & State"]
            BPMN["core/workflow — Flowable BPMN 2.0 XML Engine (:8081)"]
        end
        subgraph Data ["Data Services"]
            RLS["TenantRlsContext — PostgreSQL 16 Row-Level Security Isolation"]
            S3["SeaweedS3StorageService — S3-Compatible Unstructured Storage (:9000)"]
            Ledger["ImmutableAuditLedger — SHA-256 Hash-Chain Audit Ledger"]
            Twin["NgsiLdTwinMapper — ETSI NGSI-LD v1.6 Digital Twin Entities"]
        end
    end

    T2 -->|OIDC PKCE Login| IAM
    T2 -->|HTTPS REST, 20-second polling & Bearer JWT| GW
    GW --> Engines
    GW --> Flow
    GW --> Data
    T3 --> T2
    T3 --> T1
```

---

## 2. Chi tiết các Phân hệ Kiến trúc

### 2.1. Tầng 1: Nền tảng Lõi Dùng Chung (Headless Core PaaS & Capability Engines)
- **`core/identity` — Quản trị Định danh & Phân quyền (IAM):**
  - OpenID Connect (OIDC 1.0) & OAuth 2.0 trên nền Keycloak 24.0.
  - Luồng chuẩn **Authorization Code Flow với PKCE (RFC 7636)**.
  - Phân quyền theo vai trò (RBAC): `COORDINATOR`, `FARMER`, `OPERATOR`, `MACHINE_OWNER`, `REPAIR_TEAM`.
  - Đa đơn vị thuê (`organization_id` claim) nhúng trực tiếp trong JWT token.
- **`core/api-gateway` — Cổng API Biên mạng Zero-Trust:**
  - Apache APISIX Cloud-Native API Gateway (:9080).
  - Xác thực Token Introspection với Keycloak (RFC 7662), gắn Zero-Trust Headers (`X-User-Id`, `X-Org-Id`, `X-User-Roles`).
- **`core/workflow` — Động cơ Quy trình Nghiệp vụ BPMN 2.0:**
  - Flowable BPMN 2.0 REST Engine (:8081).
  - SOP-01: Vòng đời yêu cầu dịch vụ thu hoạch (`service_request.bpmn20.xml`).
  - SOP-02: Báo sự cố máy hỏng & Tái lập kế hoạch cứu viện (`incident_replan.bpmn20.xml`).
- **`core/data-services` — Dịch vụ Dữ liệu Hợp nhất:**
  - **PostgreSQL 16 RLS**: Phân quyền Row-Level Security ở cấp nhân CSDL, cô lập tuyệt đối dữ liệu giữa các HTX và giữa các Nông hộ.
  - **ScheduleConflictEngine**: Ràng buộc `btree_gist` chống trùng lịch ca gặt theo khung thời gian `tstzrange`.
  - **SpatialMatchingEngine**: Tính toán khoảng cách trắc địa đường chim bay (Haversine) và chấm điểm cứu viện đa tiêu chí.
  - **SeaweedFS S3**: Lưu trữ ảnh minh chứng sự cố và biên bản nghiệm thu qua presigned/safe upload.
  - **ImmutableAuditLedger**: Sổ cái kiểm toán bất biến chuỗi băm SHA-256 và truy vết phả hệ dữ liệu (`correlation_id`).
  - **NgsiLdTwinMapper**: Bản sao số thực thể chuẩn ETSI GS CIM 009 / Smart Data Models.

### 2.2. Không gian Năng lực Số & Cổng Điều hành Tác chiến (Experience & Operations Portal — H-P-D-I)
Ứng dụng web điều hành nghiệp vụ tập trung (`apps/web` - React 18, TypeScript, Tailwind CSS, MapLibre GL JS):
- **[H] Human Role Workspaces:**
  - Shell giao diện tiếng Việt, responsive cho cả Mobile, Tablet và Desktop.
  - 5 Buồng lái cá nhân hóa: Cổng Nông hộ, Trung tâm Chỉ huy Điều phối viên, Buồng lái Hiện trường Lái máy, Cổng Chủ máy, Cổng Kỹ thuật Sửa chữa.
  - Hộp công cụ an toàn: **SSO & RBAC Proof Inspector** (hiển thị claims cho phép, kèm cảnh báo bảo mật).
- **[P] Process Command Card:**
  - Trực quan hóa tiến trình thực tế theo SOP-01 và SOP-02 kết nối Flowable BPMN.
  - Phân loại rõ ràng: Đang chạy, Chờ phê duyệt, Xung đột lịch, Đã hoàn tất.
- **[D] Data & Tactical Map (Fog of War):**
  - Bản đồ 2D/2.5D Digital Twin hiển thị đa giác ruộng và marker máy gặt chuẩn NGSI-LD.
  - Cơ chế Sương mù Phân quyền: Nông hộ chỉ thấy ruộng của mình; các ruộng khác không lộ tọa độ hay polygon.
  - Đường hành quân Waypoints: Xanh dương (Ca đã chốt), Đỏ nhấp nháy (Ca bị đứt gãy).
- **[I] Intelligence Radar:**
  - Vector xanh lá gợi ý máy cứu viện tối ưu (`M02` sang `F03`).
  - Bảng giải thích chi tiết điểm số đa tiêu chí (Sẵn sàng, Công suất, Khoảng cách Haversine đường chim bay, Kỹ năng thợ lái).
  - Cảnh báo xung đột thời gian (`409 Conflict`) và kịch bản biên (`NO_FEASIBLE_UNIT_IN_WINDOW`).
- **Thanh Live Combat Log & Phả hệ Dữ liệu:**
  - Hiển thị nhật ký kiểm toán được làm mới mỗi 20 giây và sơ đồ phả hệ dữ liệu SHA-256.

### 2.3. Tầng 3: Ứng dụng Nghiệp vụ Mở rộng (Domain Business Apps)
- Các module chuyên ngành cắm-rút phục vụ chuyển đổi số toàn diện: truy xuất nguồn gốc chuỗi giá trị lúa gạo, quản lý vật tư phân bón thông minh, điều phối đội bay drone phun thuốc bảo vệ thực vật.
