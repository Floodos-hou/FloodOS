# FloodOS Tier-1 Modular Service Profiles (Hồ sơ Triển khai Hạ tầng Tầng 1)

FloodOS hỗ trợ cơ chế kiến trúc **Mô-đun hóa Cắm rút (Pluggable Architecture)** và **Suy thoái mềm (Graceful Degradation)** cho Hạ tầng Tầng 1 (DX-OS Open-Core PaaS), cho phép vận hành linh hoạt theo 3 hồ sơ triển khai chính:

---

## 1. Ba Hồ sơ Triển khai Chuẩn (3 Deployment Profiles)

| Tiêu chí | 1. FULL (Trung tâm Chỉ huy Đô thị) | 2. STANDARD (Trạm Điều phối Khu vực) | 3. EDGE_FIELD (Chỉ huy Dã chiến Tâm lũ) |
| :--- | :--- | :--- | :--- |
| **Môi trường** | Cloud DataCenter / Máy chủ Trung tâm | Văn phòng Ban Chỉ huy Quận / Huyện | Xe cơ động dã chiến, Laptop cứu hộ, Rugged Edge PC |
| **Mức tiêu thụ RAM** | ~16GB - 32GB RAM | ~4GB - 8GB RAM | **< 800MB RAM** (Siêu nhẹ) |
| **Thời gian khởi động** | 60 - 90 giây | 20 - 30 giây | **3 - 5 giây** (Tức thì) |
| **Xác thực Identity** | Keycloak OIDC 24.0 (PKCE, SSO, Multi-tenant) | Keycloak OIDC / Local PKCE | Local Tactical PKCE (Tự động độc lập, không cần mạng ngoài) |
| **Quy trình BPMN** | Flowable BPMN 2.0 REST Engine | Flowable BPMN 2.0 / Embedded | OMG BPMN 2.0 In-Process DOM Engine |
| **Lưu trữ Tệp S3** | SeaweedFS S3 Cluster (Cụm phân tán) | SeaweedFS S3 đơn trạm | Local Ephemeral Storage (Volume ổ cứng dã chiến) |
| **API Gateway** | Apache APISIX Zero-Trust Gateway (:9080) | Apache APISIX (:9080) | Direct Core Ingress (Đi thẳng qua Core API) |
| **Event Bus & Stream** | Apache Kafka 3.7 KRaft + Karapace REST | In-memory / Kafka | In-memory Circular Audit Queue |
| **Bản đồ Ngoại tuyến** | PMTiles Vector Server + OSM CDN | PMTiles Vector Server | **Self-hosted Hanoi PMTiles (Offline 100%)** |

---

## 2. Hướng dẫn Khởi chạy với Docker Compose

### A. Chế độ Dã chiến Siêu nhẹ (EDGE / FIELD) — RAM < 800MB
Khởi chạy chỉ với CSDL PostgreSQL, Core API và Web App (PWA):
```bash
# Khởi chạy dã chiến không cần Keycloak/Flowable/Kafka/SeaweedFS
FLOODOS_PROFILE=EDGE_FIELD docker compose up -d
```

### B. Chế độ Tiêu chuẩn Khu vực (STANDARD) — RAM ~4GB
Khởi chạy với PostgreSQL, APISIX Gateway, Keycloak OIDC, Flowable BPMN và SeaweedFS:
```bash
FLOODOS_PROFILE=STANDARD docker compose --profile standard up -d
```

### C. Chế độ Trung tâm Chỉ huy Đầy đủ (FULL) — RAM ~16GB
Khởi chạy toàn bộ 14 container hạ tầng, bao gồm Kafka KRaft, Lake Archiver DuckDB, ClamAV Antivirus Scanner:
```bash
FLOODOS_PROFILE=FULL docker compose --profile full up -d
```

### D. Chế độ Trình diễn Mô phỏng (DEMO)
Khởi chạy toàn bộ hệ sinh thái kèm thiết bị mô phỏng di chuyển thực tế trên bản đồ (`device-simulator`):
```bash
docker compose --profile demo up -d
```

---

## 3. Khám phá Năng lực Hệ thống (Capability Discovery API)

Tầng 1 cung cấp endpoint công khai để Tầng 2 (Giao diện web di động) và các công cụ giám sát phát hiện động năng lực của hệ thống:

```http
GET /api/v1/system/capabilities
```

**Mẫu phản hồi JSON:**
```json
{
  "profile": "FULL",
  "profile_label": "Trung tâm Chỉ huy Đô thị (Enterprise Metropolitan C2)",
  "tier": 1,
  "status": "OPERATIONAL",
  "memory_footprint": "ENTERPRISE (~16GB RAM)",
  "services": {
    "identity": {
      "name": "Identity & Access Management",
      "mode": "KEYCLOAK_PRODUCTION",
      "provider": "Keycloak OIDC 24.0",
      "status": "ACTIVE"
    },
    "workflow": {
      "name": "Workflow Engine",
      "mode": "FLOWABLE_PRODUCTION",
      "provider": "Flowable BPMN 2.0 REST",
      "status": "ACTIVE"
    },
    "database": {
      "name": "Structured Data Engine",
      "mode": "PostgreSQL 16 (RLS forced)",
      "provider": "PostgreSQL 16 (RLS forced)",
      "status": "CONNECTED"
    },
    "storage": {
      "name": "Unstructured Evidence Storage",
      "mode": "SEAWEEDFS_S3",
      "provider": "SeaweedFS S3 API (:9000)",
      "status": "ACTIVE"
    },
    "gateway": {
      "name": "Edge API Gateway",
      "provider": "Apache APISIX Zero-Trust (:9080)",
      "status": "ACTIVE"
    },
    "event_bus": {
      "name": "Tactical Event Bus",
      "provider": "Apache Kafka KRaft (:9092)",
      "status": "LIVE"
    },
    "antivirus": {
      "name": "Malware Stream Scanner",
      "provider": "ClamAV Daemon INSTREAM",
      "status": "CONFIGURED"
    }
  },
  "timestamp": "2026-11-06T18:45:00Z"
}
```

---

## 4. Hiển thị Trạng thái trên Giao diện Tác chiến (Tầng 2)

Trên thanh tiêu đề (Header) của Web Dashboard và ứng dụng PWA di động, huy hiệu trạng thái sẽ tự động cập nhật theo hồ sơ đang kích hoạt:
- 🏛️ **Trung tâm (Full):** Đầy đủ năng lực phòng điều hành trung tâm.
- 🏢 **Khu vực (Standard):** Năng lực chỉ huy cấp quận/huyện.
- ⚡ **Dã chiến (Edge):** Chế độ tối ưu tài nguyên, vận hành không phụ thuộc mạng ngoài.
