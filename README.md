# OpenAgriOS — Nền tảng Chuyển đổi số & Điều phối Cơ giới hóa Nông nghiệp (DX-OS Open-Core)

[![License](https://img.shields.io/badge/License-Apache_2.0-emerald.svg)](LICENSE)
[![Runtime](https://img.shields.io/badge/Runtime-OpenJDK_21_LTS-orange.svg)](backend/pom.xml)
[![Architecture](https://img.shields.io/badge/Architecture-3--Tier_Modular_Open--Core-purple.svg)](#1-cấu-trúc-kiến-trúc-3-tầng-java-21)

---

## 1. Cấu trúc Kiến trúc 3 Tầng (Java 21 Modular Open-Core)

Hệ thống Backend (`backend/src/main/java/org/openagrios/`) được thiết kế phân tách chặt chẽ theo 3 tầng độc lập:

```text
backend/
├── pom.xml
└── src/main/java/org/openagrios/
    ├── OpenAgriOsServer.java                      # Cổng điều phối HTTP Router mỏng (Java 21 Virtual Threads)
    ├── AcceptanceTestRunner.java                  # Bộ kiểm thử tích hợp tự động toàn trình
    │
    ├── core/                                      # [TẦNG 1] HEADLESS CORE PaaS (100% Độc lập miền nghiệp vụ)
    │   ├── security/KeycloakOidcEngine.java       # Định danh OIDC/SSO, ký & xác thực JWT HMAC-SHA256
    │   ├── gateway/ZeroTrustGateway.java          # Chốt chặn Apache APISIX Zero-Trust PEP & RBAC Guard (403)
    │   ├── rls/TenantRlsContext.java              # Cách ly đa tổ chức (PostgreSQL RLS) & phân quyền hiển thị
    │   ├── storage/SeaweedS3StorageService.java   # Lưu trữ đối tượng phi cấu trúc S3 URI + kiểm chứng ETag
    │   ├── workflow/BpmnWorkflowEngine.java       # Bộ đọc W3C DOM XML BPMN 2.0 & Máy trạng thái tiến trình
    │   ├── audit/ImmutableAuditLedger.java        # Sổ cái kiểm toán bất biến SHA-256 Hash-Chain & Data Lineage
    │   ├── twin/NgsiLdTwinMapper.java             # Bộ chuẩn hóa Bản sao số quốc tế ETSI NGSI-LD v1
    │   └── json/JsonCodec.java                    # Bộ tuần tự hóa JSON chuẩn RFC 8259
    │
    ├── hpdi/                                      # [TẦNG 2] KHÔNG GIAN NĂNG LỰC SỐ H-P-D-I (Tái sử dụng đa ngành)
    │   ├── conflict/ScheduleConflictEngine.java   # [P & D] Động cơ kiểm tra xung đột khung giờ (GiST Overlap 409)
    │   └── intelligence/SpatialMatchingEngine.java# [I] Khoảng cách mặt cầu Haversine & Chấm điểm đa tiêu chí
    │
    └── modules/agriops/                           # [TẦNG 3] MÔ-ĐUN NGHIỆP VỤ CẮM-VÀ-CHẠY (AgriOps PSA/TMS)
        ├── domain/AgriModels.java                 # Thực thể nghiệp vụ: FieldPlot, HarvesterMachine, Assignment...
        ├── repository/AgriDataStore.java          # Kho dữ liệu đa hợp tác xã (HTX Cần Thơ 01 & HTX Sóc Trăng 02)
        └── service/AgriOpsService.java            # Dịch vụ điều phối mùa vụ, xử lý sự cố & nghiệm thu
```

---

## 2. Biên dịch & Khởi chạy (OpenJDK 21 LTS)

```powershell
# 1. Biên dịch toàn bộ mã nguồn Java 21
javac -encoding UTF-8 -d backend/target/classes (Get-ChildItem -Recurse backend/src/main/java/*.java).FullName

# 2. Chạy bộ kiểm thử tích hợp tự động
java -cp backend/target/classes org.openagrios.AcceptanceTestRunner

# 3. Khởi động máy chủ OpenAgriOS Headless Core PaaS tại cổng 8000
java -cp backend/target/classes org.openagrios.OpenAgriOsServer
```

Sau khi máy chủ chạy tại `http://localhost:8000`, có thể mở Postman và import bộ sưu tập `postman/OpenAgriOS_Tier1_Core.postman_collection.json` để kiểm thử toàn bộ 18 API.

---

## 3. Danh sách Tài khoản Hệ thống (Mật khẩu mặc định: `123456`)

| Tài khoản (`username`) | Vai trò (`Role`) | Tổ chức (`Tenant RLS`) | Quyền hạn trong hệ thống |
| :--- | :--- | :--- | :--- |
| **`coord_htx01`** | `COORDINATOR` | `HTX_CANTHO_01` | Quản lý toàn bộ 10 vùng canh tác & 4 máy của HTX Cần Thơ 01; điều phối lịch & phê duyệt phương án máy thay thế trên BPMN. |
| **`farmer_ba`** | `FARMER` | `HTX_CANTHO_01` | Nông hộ sở hữu 3 vùng (`F01, F03, F07`); tạo yêu cầu dịch vụ thu hoạch & xác nhận nghiệm thu. |
| **`op_minh`** | `OPERATOR` | `HTX_CANTHO_01` | Người vận hành máy `M01`; cập nhật tiến độ hiện trường & gửi báo cáo sự cố kèm ảnh minh chứng `S3`. |
| **`op_nam`** | `OPERATOR` | `HTX_CANTHO_01` | Người vận hành máy `M02`; nhận lệnh điều động thay thế. |
| **`owner_tu`** | `MACHINE_OWNER` | `HTX_CANTHO_01` | Chủ sở hữu thiết bị (`M01, M02`); theo dõi trạng thái kỹ thuật và hiệu suất máy. |
| **`repair_01`** | `REPAIR_TEAM` | `HTX_CANTHO_01` | Đội kỹ thuật bảo trì; tiếp nhận phiếu sửa chữa và cập nhật chẩn đoán kỹ thuật. |
| **`coord_htx02`** | `COORDINATOR` | `HTX_SOCTRANG_02` | Điều phối viên HTX Sóc Trăng 02 (dữ liệu cách ly độc lập theo `organization_id`). |
