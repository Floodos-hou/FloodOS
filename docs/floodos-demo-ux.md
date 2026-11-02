# FloodOS — Đặc tả Trải nghiệm Người dùng (UX) & Trung tâm Tác chiến

Tài liệu này xác lập tiêu chuẩn thiết kế trải nghiệm người dùng (UX) cho **FloodOS**, hiện thực hóa tại [`apps/web`](../apps/web) (React 19 + TypeScript + MapLibre GL + TailwindCSS) và kết nối trực tiếp với backend API qua APISIX Zero-Trust Gateway.

---

## 1. Mục tiêu và Nguyên tắc Thiết kế Giao diện

- **Bản đồ tình huống + Dòng thời gian vụ việc + Hành động tiếp theo:** Ưu tiên số một là không gian tác chiến trực quan, loại bỏ tư duy xây dựng các bảng quản trị CRUD có các nút thêm/sửa/xóa làm trải nghiệm chính.
- **Ngữ cảnh tức thời:** Mỗi màn hình trả lời nhanh 4 câu hỏi:
  1. Người dùng đang xem vụ việc nào?
  2. Trạng thái hiện tại của vụ việc là gì?
  3. Nguồn dữ liệu và thời điểm cập nhật ra sao?
  4. Người dùng có thẩm quyền thực hiện bước nào tiếp theo?
- **Trực quan hóa 2D/3D trung thực:** Bản đồ thể hiện rõ vị trí và tương quan nguồn lực; mọi điểm đánh dấu, trạng thái và chuyển động bắt nguồn từ dữ liệu API thật hoặc bộ mô phỏng IoT/MQTT đã gắn nhãn nguồn.
- **Minh bạch nhãn nguồn dữ liệu:** Mọi dữ liệu mô phỏng (`SIMULATOR`, `SEED`) được đánh dấu rõ ràng. Không tự tạo số liệu, địa danh, trạng thái xe chạy hoặc tiến độ ảo chỉ để làm giao diện sinh động.
- **Thiết kế hướng tới demo thật:** Người trình bày đăng nhập đúng vai trò (Keycloak OIDC PKCE) và thao tác tuần tự qua toàn bộ luồng nghiệp vụ bằng các lệnh gọi API backend thật.

---

## 2. Kịch bản tiêu biểu 7 bước trình diễn

Chu trình điều phối khép kín của một vụ việc trên giao diện:

`Báo tin → Xác minh/Ưu tiên → Phân công Xuồng/Đội → Đội hiện trường cập nhật → Báo sự cố & Điều phối lại → Xác nhận & Niêm phong sổ cái`

| Bước | Người dùng | Trải nghiệm tác chiến trên giao diện |
|---|---|---|
| **1. Báo tin** | Người dân (`REPORTER`) | Chọn tọa độ trên bản đồ Hà Nội, nhập độ sâu ngập (cm), số người cần hỗ trợ, nhu cầu (sơ tán, y tế, lương thực); chụp/gửi ảnh hiện trường (quét ClamAV); nhận mã tin báo `FR-...` và theo dõi trực tiếp tiến trình. |
| **2. Xác minh** | Điều phối viên (`DISPATCHER`) | Xem hàng đợi tin mới, nguồn và thời điểm dữ liệu; đối soát vị trí trên bản đồ tác chiến; thẩm định thông tin, gán mức ưu tiên (`CRITICAL`, `URGENT`, `NORMAL`) và ghi chú hiện trường. |
| **3. Điều phối** | Điều phối viên (`DISPATCHER`) | Xem danh sách đội và xuồng/xe cứu hộ sẵn sàng; kiểm tra xung đột lịch; nếu phân công trùng giờ, hệ thống giải thích rõ ràng lý do từ chối (409 GiST Exclusion) mà không làm mất dữ liệu biểu mẫu. Ban hành lệnh điều động `ORD-...`. |
| **4. Tác nghiệp** | Đội hiện trường (`FIELD_TEAM`) | Nhận nhiệm vụ trên điện thoại, xem vị trí người dân cần hỗ trợ; bấm **Bắt đầu** (`IN_PROGRESS`); khi gặp sự cố kỹ thuật (chân vịt vướng rác, chết máy), bấm **Báo sự cố** bằng thao tác nhanh. |
| **5. Điều phối lại** | Điều phối viên (`DISPATCHER`) | Radar chi viện phân tích và xếp hạng các phương án thay thế khả dụng theo 4 tiêu chí minh bạch (Haversine 40đ, loại xe 25đ, công suất 20đ, đánh giá đội 15đ). Điều phối viên bấm duyệt phương án; lệnh cũ chuyển `SUPERSEDED`, lệnh mới `-R1` kế thừa mã vụ việc. |
| **6. Hoàn tất** | Đội chi viện (`FIELD_TEAM`) | Đội tiếp quản cập nhật tiến độ hiện trường, xác nhận nước rút an toàn và bấm **Hoàn tất nhiệm vụ** (`COMPLETED`). |
| **7. Nghiệm thu** | Người dân & Thanh tra | Người báo tin bấm **Xác nhận đã an toàn** (`CONFIRMED`). Mở Proof Inspector để kiểm chứng chuỗi băm mật mã SHA-256 từ Genesis block. |

---

## 3. Không gian làm việc theo vai trò (Workspaces)

- **Người báo tin (`REPORTER`):** Giao diện tối ưu di động với nút báo tin khẩn cấp nổi bật; danh sách tin của chính mình; bản đồ chỉ hiển thị tin của mình, trạm đo và điểm trú an toàn (cách ly hoàn toàn dữ liệu người khác bằng PostgreSQL RLS).
- **Điều phối viên (`DISPATCHER`):** Trung tâm chỉ huy toàn diện: Bản đồ tác chiến MapLibre GL, thanh KPI khẩn cấp, hàng đợi tin chờ duyệt, quản lý đội/xe, radar chi viện sự cố và phân tích kho lạnh DuckDB.
- **Đội hiện trường (`FIELD_TEAM`):** Giao diện tập trung vào nhiệm vụ hiện tại: tọa độ mục tiêu, nút thao tác lớn (tối thiểu 48px) dễ bấm bằng một tay khi cơ động, cập nhật tiến độ hoặc báo sự cố tức thì.
- **Quản lý nguồn lực (`RESOURCE_MANAGER`):** Quản lý trạng thái đội, phương tiện, sức chứa điểm sơ tán; cập nhật và đóng phiếu sửa chữa kỹ thuật (`repair-ticket`). Không can thiệp duyệt điều động.
- **Quản trị nền tảng (`PLATFORM_ADMIN`):** Giám sát tình trạng hạ tầng, đối soát phả hệ dữ liệu và kiểm chứng chuỗi khối kiểm toán SHA-256.

---

## 4. Minh bạch dữ liệu & Tiêu chí nghiệm thu UX

1. **Minh bạch nhãn nguồn:** Mọi vị trí xe và mực nước trạm đo đều hiển thị nhãn nguồn (`SIMULATOR` hoặc `DEVICE`) và thời điểm cập nhật. Khoảng cách cứu trợ ghi rõ “đường chim bay (Haversine)”, không gọi là tuyến đường bộ thực tế.
2. **Bảo mật phân quyền nghiêm ngặt:** Người báo tin không thể xem dữ liệu ngoài phạm vi được cấp; vai trò không đủ quyền nhận lỗi `403 Forbidden` khi gọi API trực tiếp.
3. **Phản hồi lỗi rõ ràng:** Xung đột lịch (409) hoặc tệp nhiễm mã độc (422) giải thích nguyên nhân cụ thể và không làm mất dữ liệu người dùng đã nhập.
4. **Kiểm chứng độc lập:** Sau khi đóng vụ việc, người dùng có thể tra cứu và xác minh chuỗi băm SHA-256 độc lập từ cổng Tầng 3 mà không cần tin vào máy chủ cơ sở dữ liệu.
