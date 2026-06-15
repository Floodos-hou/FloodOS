# Hướng dẫn Bảo mật & Triển khai Production (OpenAgriOS Security & Production Guide)

Tài liệu này quy định kiến trúc bảo mật Zero-Trust, cơ chế quản lý danh tính OIDC/PKCE, cách ly dữ liệu đa thuê ước (Multi-Tenancy RLS), chuỗi kiểm toán bất biến (Immutable Audit Hash-Chain) và quy trình thiết lập bí mật (Secrets Management) an toàn cho nền tảng OpenAgriOS khi đưa vào vận hành thực tế.

---

## 1. Mô hình Kiến trúc Bảo mật Zero-Trust

OpenAgriOS áp dụng nguyên tắc **"Không tin tưởng bất kỳ ai, luôn luôn xác thực và ủy quyền" (Never Trust, Always Verify)** trên toàn bộ 3 tầng kiến trúc:

```
                  +-------------------------------------------------------+
                  |               Client Web / Mobile / IoT               |
                  +-------------------------------------------------------+
                                              |
                                              |  HTTPS / TLS 1.3
                                              v
+-----------------------------------------------------------------------------------------+
| Apache APISIX (Zero-Trust API Gateway - Port 9080/9443)                                 |
| - Xác thực Bearer JWT Header trên mọi API Endpoint (trừ /health và /auth/pkce)          |
| - Rate Limiting & Anti-DDoS                                                             |
| - Định tuyến nội bộ an toàn (Internal Docker Overlay Network)                          |
+-----------------------------------------------------------------------------------------+
                                              |
                                              v
+-----------------------------------------------------------------------------------------+
| OpenAgriOS Core API (Port 8000)                                                         |
| - ZeroTrustGateway: Xác thực chữ ký RS256 qua Keycloak Token Introspection (RFC 7662)   |
| - RBAC Guard: Kiểm tra quyền hạn theo vai trò (FARMER, COORDINATOR, OPERATOR, v.v.)     |
| - Session Context: Nạp TenantRlsContext (app.current_org_id, app.current_user_role)     |
+-----------------------------------------------------------------------------------------+
                    |                                             |
                    v                                             v
+--------------------------------------+     +--------------------------------------------+
| PostgreSQL 16 (Port 5432)            |     | Keycloak 24 (Port 8080)                    |
| - Dedicated Role: openagrios_app     |     | - Confidential Client: agriops-gateway     |
|   (NOSUPERUSER, NOBYPASSRLS)         |     | - Public Client: agriops-web (PKCE S256)   |
| - FORCE ROW LEVEL SECURITY           |     | - Token Introspection (RFC 7662)           |
| - GiST btree_gist Time-Window Lock   |     |                                            |
+--------------------------------------+     +--------------------------------------------+
```

---

## 2. Quản lý Định danh: OIDC 1.0 & Authorization Code + PKCE (RFC 7636)

### 2.1. Tách biệt hai chế độ định danh (Strict Dual-Mode Architecture)

Hệ thống cung cấp cơ chế bảo vệ nghiêm ngặt giữa hai chế độ hoạt động:

1. **Chế độ Phát triển cục bộ (`OPENAGRIOS_AUTH_MODE=DEV_MOCK_STANDALONE`):**
   - Dành riêng cho phát triển cục bộ và kiểm thử tự động không cần container Keycloak.
   - Sử dụng thuật toán HMAC-SHA256 với secret nội bộ cục bộ.
   - **Cơ chế phòng vệ:** Mọi token giả mạo gắn thuật toán RS256 hoặc chứa chữ ký sai lệch đều bị từ chối thẳng thừng với mã lỗi `401 UNAUTHORIZED`.

2. **Chế độ Vận hành Sản xuất (`OPENAGRIOS_AUTH_MODE=KEYCLOAK_PRODUCTION`):**
   - Bắt buộc trên môi trường production và staging.
   - Mọi yêu cầu đăng nhập và kiểm tra token đều được chuyển trực tiếp tới máy chủ Keycloak thật.
   - **Quy tắc Fail-Fast:** Khi Keycloak không phản hồi hoặc trả về lỗi, Core API lập tức trả về mã lỗi `401 KEYCLOAK_LOGIN_FAILED` hoặc `401 KEYCLOAK_TOKEN_EXCHANGE_FAILED`. **Tuyệt đối không âm thầm chuyển đổi ngược về chế độ Mock.**

### 2.2. Luồng Authorization Code với PKCE cho Web và Mobile

Theo khuyến nghị bảo mật RFC 9700 (OAuth 2.0 Security Best Current Practice), cơ chế ROPC (Resource Owner Password Credentials) đã bị loại bỏ cho các ứng dụng tương tác người dùng. OpenAgriOS áp dụng chuẩn **Authorization Code Flow kết hợp Proof Key for Code Exchange (PKCE - RFC 7636)**:

1. **Khởi tạo phiên:** Client gọi `GET /api/v1/auth/pkce/authorize-url` để nhận `code_challenge` (SHA-256 base64url) và `code_verifier`.
2. **Đổi mã lấy token:** Client gửi mã xác thực tới `POST /api/v1/auth/pkce/token` cùng `code` và `code_verifier`.
3. **Kiểm tra tính hợp lệ:**
   - Chiều dài `code_verifier` bắt buộc phải từ 43 đến 128 ký tự (RFC 7636 Section 4.1).
   - Kiểm tra toán học $S256(\text{code\_verifier}) == \text{code\_challenge}$.
   - Chống tấn công giả mạo client (Single Client Authentication theo RFC 6749 Section 2.3.1).

---

## 3. Bảo mật Dữ liệu Cơ sở dữ liệu: PostgreSQL Row-Level Security (RLS)

### 3.1. Phân quyền Người dùng Ứng dụng Không có quyền Siêu quản trị (`openagrios_app`)

Để ngăn chặn lỗ hổng vô hiệu hóa RLS của tài khoản quản trị PostgreSQL (superuser bypass), ứng dụng Core API kết nối qua vai trò chuyên dụng:

```sql
CREATE ROLE openagrios_app WITH LOGIN PASSWORD 'strong_password_here'
    NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
```

### 3.2. Cưỡng chế RLS trên toàn bộ bảng thực thể (`FORCE ROW LEVEL SECURITY`)

Tất cả các bảng nghiệp vụ (`fields`, `machines`, `operators`, `service_requests`, `assignments`, `incidents`, `work_acceptances`, `audit_records`) đều được kích hoạt chính sách:

```sql
ALTER TABLE fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE fields FORCE ROW LEVEL SECURITY;
```

Mỗi truy vấn đều được đóng gói trong một phiên giao dịch thiết lập ngữ cảnh:
```sql
SET LOCAL app.current_org_id = 'HTX_CANTHO_01';
SET LOCAL app.current_user_role = 'COORDINATOR';
```
Dữ liệu của các hợp tác xã khác hoặc dữ liệu nhạy cảm của các nông hộ khác ("Fog of War") bị cô lập hoàn toàn ở cấp độ nhân cơ sở dữ liệu PostgreSQL.

---

## 4. Chuỗi Nhật ký Kiểm toán Bất biến (Immutable Audit Hash-Chain)

Bảng `audit_records` lưu trữ dấu vết thay đổi trạng thái của toàn bộ thực thể. Để đảm bảo tính toàn vẹn dữ liệu:
- Mỗi bản ghi chứa mã băm SHA-256 của bản ghi liền trước (`prev_hash`) và mã băm của chính bản ghi đó (`record_hash`).
- Kích hoạt trigger PostgreSQL `trg_audit_immutable` ngăn chặn tuyệt đối các thao tác `UPDATE` hoặc `DELETE` trên bảng kiểm toán:

```sql
CREATE OR REPLACE FUNCTION prevent_audit_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Immutable Audit Ledger Violation: UPDATE or DELETE on audit_records is strictly prohibited!';
END;
$$ LANGUAGE plpgsql;
```

---

## 5. Quy trình Quản lý Bí mật Sản xuất (Secrets Management)

### 5.1. Tạo khóa ngẫu nhiên chuẩn mật mã

Tuyệt đối không sử dụng mật khẩu mặc định (ví dụ `123456`, `openagrios_dev_only`, `admin_dev_only`). Sử dụng tiện ích `openssl` để sinh các chuỗi ngẫu nhiên 256-bit:

```bash
# 1. Mật khẩu Superuser PostgreSQL
openssl rand -hex 32

# 2. Mật khẩu Ứng dụng PostgreSQL (openagrios_app)
openssl rand -hex 32

# 3. Mật khẩu Quản trị viên Keycloak
openssl rand -hex 32

# 4. Bí mật Client Gateway Keycloak (agriops-gateway client secret)
openssl rand -hex 32

# 5. Khóa Quản trị Apache APISIX
openssl rand -hex 32
```

### 5.2. Cấu hình tệp biến môi trường `.env`

Tạo tệp `.env` từ mẫu `.env.production.example`:

```bash
cp .env.production.example .env
```

Điền các giá trị đã sinh vào tệp `.env` và thiết lập quyền truy cập giới hạn:

```bash
chmod 600 .env
```

### 5.3. Khởi chạy với tệp cấu hình bảo vệ Production (`compose.prod.yaml`)

Tệp `compose.prod.yaml` sử dụng cú pháp `${VAR:?error}` của Docker Compose, tự động hủy bỏ khởi động nếu có bất kỳ bí mật nào chưa được định nghĩa:

```bash
# Kiểm tra tính hợp lệ của cấu hình
docker compose -f compose.yaml -f compose.prod.yaml config --quiet

# Khởi chạy toàn bộ hệ sinh thái dịch vụ
docker compose -f compose.yaml -f compose.prod.yaml up -d
```

### 5.4. Đóng cổng nội bộ (Network Boundary Isolation)

Khi áp dụng `compose.prod.yaml`, các cổng nội bộ như:
- Cổng PostgreSQL `5432`
- Cổng SeaweedFS S3 `9000` / `8888`
- Cổng Flowable BPMN `8081`

sẽ **không được xuất bản ra ngoài mạng Internet (no host port binding)** mà chỉ giao tiếp qua mạng nội bộ Docker. Người dùng và ứng dụng bên ngoài chỉ có thể truy cập thông qua Gateway APISIX (cổng `9080` / `9443`).
