# FloodOS Web — Trung Tâm Điều Hành Phối Hợp Ứng Phó Ngập Lụt (Operations Portal)

Ứng dụng React 19 + TypeScript + Vite + Tailwind CSS 4 + MapLibre GL cho người dân / người báo tin, điều phối viên,
đội cơ động hiện trường và người quản lý nguồn lực cứu trợ. Mọi dữ liệu đi qua API Gateway (APISIX); không có mock.

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

## Giao diện tác chiến FloodOS

Giao diện điều hành ứng phó ngập lụt đô thị: thiết kế chuyên dụng cho 5 vai trò (Điều phối viên, Đội hiện trường, Người dân vùng ngập, Quản lý nguồn lực, Quản trị nền tảng). Toàn bộ chữ bằng tiếng Việt chuẩn công vụ, bản đồ tác chiến MapLibre GL thời gian thực, nút bấm và luồng thao tác tối ưu cho cả máy tính tác chiến và thiết bị di động hiện trường. Mọi mã trạng thái của backend (`IN_PROGRESS`, `CRITICAL`, `SUPERSEDED`…) được chuẩn hóa nhãn tập trung tại `src/utils/labels.ts`.

Bảng màu "Tác chiến & Thủy văn Đô thị" (Tactical Dark Slate & Hydrology) khai báo bằng `@theme` trong `src/index.css`: nhóm màu slate chỉ huy (`slate-*`), xanh thủy văn tác chiến (`sky-*`, `cyan-*`), và cảnh báo khẩn cấp (`amber-*`, `red-*`). Hỗ trợ chế độ bản đồ tác chiến ban đêm và ban ngày.

## Trải nghiệm Di động Hiện trường (Mobile-First PWA & Cảnh báo Giọng nói)

- **Mobile PWA (Progressive Web App):** Hỗ trợ cài đặt độc lập (Standalone App) trên Android và iOS với `manifest.webmanifest`, lưu đệm offline shell (`sw.js`), và hỗ trợ hoạt động ngoại tuyến khi mất sóng Internet hoặc mạng gián đoạn.
- **Cảnh báo Giọng nói Tiếng Việt (Web Speech API):** Phát thông báo khẩn cấp tự động bằng tiếng Việt tự nhiên kèm chuông âm thanh tác chiến (Tactical Audio Chime) khi có tin báo ngập nguy cấp (`CRITICAL`/`URGENT`), lệnh điều động mới cho đội hiện trường, sự cố phương tiện hoặc trạm đo vượt ngưỡng báo động. Có công tắc bật/tắt âm thanh trực tiếp trên thanh tác vụ di động.
- **Nút Báo Ngập Khẩn Cấp 1-Chạm (1-Tap Quick GPS SOS):** Thanh điều khiển nổi tối ưu thao tác một tay trên màn hình điện thoại (`< 768px`). Tự động quét và lấy tọa độ GPS độ chính xác cao từ thiết bị di động, cho phép người dân và đội cứu hộ gửi tín hiệu khẩn cấp đến trung tâm chỉ huy chỉ sau 1 lần bấm.

## Bảo mật

- Nginx áp dụng CSP + các header bảo mật cho **mọi** location (`security-headers.conf`).
- Dữ liệu từ API không bao giờ được chèn bằng `innerHTML` (marker bản đồ dựng bằng DOM + `textContent`).
- Danh tính điều phối viên/đội cứu hộ lấy trực tiếp từ hồ sơ đăng nhập Keycloak OIDC, bảo vệ phân quyền RBAC và PostgreSQL RLS nghiêm ngặt.
