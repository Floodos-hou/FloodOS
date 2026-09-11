# FloodOS Web — Trung Tâm Điều Hành Phối Hợp Ứng Phó Ngập Lụt (Operations Portal)

Ứng dụng React 19 + TypeScript + Vite + Tailwind CSS 4 + MapLibre GL cho nông hộ, điều phối viên HTX,
người vận hành, chủ máy và đội sửa chữa. Mọi dữ liệu đi qua API Gateway (APISIX); không có mock.

## Chạy

```bash
npm ci
npm run dev        # http://localhost:5173 (cần stack backend: docker compose up -d)
npm run lint       # oxlint — phải sạch cảnh báo
npm run build      # tsc -b && vite build
```

Biến môi trường (xem `.env.example`): `VITE_API_GATEWAY_URL`, `VITE_KEYCLOAK_ISSUER`,
`VITE_KEYCLOAK_CLIENT_ID`, `VITE_REDIRECT_URI`.

## Xác thực

Authorization Code + PKCE (RFC 7636 / RFC 9700), client công khai `floodos-web`:

1. Trình duyệt tự sinh `code_verifier` và `code_challenge` (Web Crypto, `src/utils/pkce.ts`).
2. Gọi `GET /api/v1/auth/pkce/authorize-url?code_challenge=…` rồi chuyển hướng sang Keycloak.
3. Keycloak chuyển về `/auth/callback?code=…&state=…`; state được so khớp trước khi đổi token.
4. Access token chỉ nằm trong bộ nhớ React, không ghi `localStorage`. Hết hạn → xóa phiên cục bộ và hiện thông báo.

## Giao diện

Giao diện viết cho nông dân: toàn bộ chữ bằng tiếng Việt thường ngày, cỡ chữ gốc 17px, nút bấm lớn (cao ≥ 48px),
mỗi vai trò chỉ thấy các tab liên quan. Mọi mã trạng thái của backend (`IN_PROGRESS`, `READY_HARVEST`…) được đổi sang
lời thường ở một nơi duy nhất: `src/utils/labels.ts`. Thêm trạng thái mới thì thêm nhãn ở đó, đừng hiển thị mã thô.

Bảng màu "Đồng lúa & Phù sa" khai báo bằng `@theme` trong `src/index.css`: nhóm trung tính ấm màu đất/rơm
(`slate-*`), xanh lá (`emerald-*`) và vàng lúa chín (`amber-*`). Dùng font hệ thống có đủ dấu tiếng Việt (font serif dự phòng làm lệch dấu); có hỗ trợ
`prefers-reduced-motion`.

## Bảo mật

- Nginx áp dụng CSP + các header bảo mật cho **mọi** location (`security-headers.conf`).
- Dữ liệu từ API không bao giờ được chèn bằng `innerHTML` (marker bản đồ dựng bằng DOM + `textContent`).
- Danh tính người vận hành/chủ máy lấy từ hồ sơ đăng nhập, không có tài khoản demo gán cứng.
