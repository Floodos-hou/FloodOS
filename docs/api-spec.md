# OpenAgriOS — Đặc Tả Giao Diện Lập Trình Ứng Dụng (REST API Specification)

Tài liệu đặc tả toàn bộ các điểm cuối REST API của hệ thống OpenAgriOS Core PaaS (Chuẩn OpenAPI 3.0 / JSON).

---

## 1. Tổng quan Endpoint

| Phương thức | Đường dẫn Endpoint | Vai trò truy cập (RBAC) | Mô tả chức năng | Mã trạng thái HTTP |
| :---: | :--- | :--- | :--- | :---: |
| `GET` | `/` hoặc `/api/v1` | Public (Mọi người) | Trả về Manifest khám phá dịch vụ Headless PaaS | `200 OK` |
| `GET` | `/openapi.json` | Public (Mọi người) | OpenAPI 3.0 JSON Specification | `200 OK` |
| `GET` | `/api/v1/health` | Public (Mọi người) | Kiểm tra trạng thái sức khỏe các dịch vụ Core & BPMN | `200 OK` |
| `GET` | `/api/v1/auth/accounts` | Public (Mọi người) | Danh sách tài khoản demo và vai trò Keycloak OIDC | `200 OK` |
| `GET` | `/api/v1/auth/pkce/authorize-url` | Public (Mọi người) | Khởi tạo phiên PKCE OAuth2/OIDC, sinh `code_challenge` SHA-256 | `200 OK` |
| `POST` | `/api/v1/auth/pkce/token` | Public (Mọi người) | Trao đổi `code` và `code_verifier` lấy Access Token chuẩn RFC 7636 & RFC 9700 | `200 OK` / `400 Bad Request` |
| `POST` | `/api/v1/auth/login` | Public (Mọi người) | Đăng nhập OIDC SSO, nhận JWT Bearer Token | `200 OK` / `401 Unauthorized` |
| `GET` | `/api/v1/auth/userinfo` | Bearer Token | Lấy thông tin định danh người dùng từ Token | `200 OK` / `401 Unauthorized` |
| `GET` | `/api/v1/state` | Bearer Token | Lấy bức tranh trạng thái vận hành theo bộ lọc RLS | `200 OK` / `401 Unauthorized` |
| `GET` | `/api/v1/digital-twin/entities`| Bearer Token | Xuất thực thể Bản sao số chuẩn ETSI NGSI-LD v1.6 | `200 OK` / `401 Unauthorized` |
| `POST` | `/api/v1/requests` | `FARMER`, `COORDINATOR` | Tạo yêu cầu dịch vụ thu hoạch lúa chín | `201 Created` / `403 Forbidden` |
| `POST` | `/api/v1/assignments` | `COORDINATOR` | Điều phối ghép cặp Máy - Thợ lái vào ca gặt | `201 Created` / `409 Conflict` / `403 Forbidden` |
| `POST` | `/api/v1/incidents` | `OPERATOR`, `COORDINATOR` | Báo cáo máy hỏng, tải ảnh S3 & tìm máy cứu viện | `201 Created` / `403 Forbidden` |
| `POST` | `/api/v1/incidents/{id}/approve-replan` | `COORDINATOR` | Phê duyệt phương án máy cứu viện trên quy trình BPMN | `200 OK` / `422 Unprocessable` / `403 Forbidden` |
| `POST` | `/api/v1/incidents/{id}/repair` | `REPAIR_TEAM`, `COORDINATOR` | Cập nhật tiến độ và nhật ký sửa chữa kỹ thuật | `200 OK` / `403 Forbidden` |
| `POST` | `/api/v1/acceptances` | `FARMER`, `COORDINATOR` | Nghiệm thu thực địa & đóng băng Sổ cái SHA-256 | `200 OK` / `403 Forbidden` |
| `GET` | `/api/v1/audit/verify` | Bearer Token | Kiểm chứng toán học tính toàn vẹn của Sổ cái SHA-256 | `200 OK` / `401 Unauthorized` |
| `GET` | `/api/v1/audit/lineage/{corr_id}` | Bearer Token | Truy vết phả hệ dữ liệu xuyên suốt các giao dịch | `200 OK` / `401 Unauthorized` |
| `POST` | `/api/v1/sim/tick` | Bearer Token | Bước thời gian mô phỏng (tiến 30 phút) | `200 OK` / `401 Unauthorized` |
| `POST` | `/api/v1/sim/reset` | Bearer Token | Khôi phục trạng thái dữ liệu mẫu mặc định | `200 OK` / `401 Unauthorized` |

---

## 2. Chi tiết Một số Payload Mẫu

### 2.1. Đăng nhập OIDC (`POST /api/v1/auth/login`)
**Request**:
```json
{
  "username": "farmer_ba",
  "password": "123456"
}
```
**Response (200 OK)**:
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "Bearer",
  "expires_in": 86400,
  "sso_issuer": "http://localhost:8080/realms/openagrios",
  "user": {
    "user_id": "usr_farmer_01",
    "username": "farmer_ba",
    "full_name": "Bác Ba Nông Dân",
    "role": "FARMER",
    "organization_id": "HTX_THOISU_01"
  }
}
```

### 2.2. Kiểm tra Xung đột Lịch (`POST /api/v1/assignments`)
Nếu khung giờ yêu cầu bị trùng với ca đang thực thi:
**Response (409 Conflict)**:
```json
{
  "error": "MACHINE_TIME_OVERLAP",
  "status": 409,
  "message": "Xung đột lịch trình: Máy 'M01' đã được xếp lịch cho ca 'ASG-101' trong khung giờ 2026-11-20T08:00:00Z -> 2026-11-20T11:30:00Z!",
  "conflict_details": {
    "code": "MACHINE_TIME_OVERLAP",
    "machine_id": "M01",
    "conflicting_assignment": "ASG-101"
  }
}
```
