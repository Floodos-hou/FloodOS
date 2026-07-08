// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenAgriOS Contributors

/**
 * Demo storyline for the Tier-2 web app. Only active when the image is built with VITE_DEMO_MODE=true
 * (dev compose default; compose.prod.yaml turns it off so no demo accounts or passwords ship to production).
 */
export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true';
export const DEMO_PASSWORD = '123456';

export interface DemoCharacter {
  username: string;
  name: string;
  role: string;
  emoji: string;
  blurb: string;
}

export const DEMO_CHARACTERS: DemoCharacter[] = [
  { username: 'farmer_ba', name: 'Bác Ba', role: 'Nông hộ', emoji: '🧑‍🌾', blurb: '3 thửa ruộng. Gọi máy gặt, theo dõi và xác nhận gặt xong.' },
  { username: 'coord_htx01', name: 'Chị Lan', role: 'Điều phối viên HTX', emoji: '👩‍💼', blurb: 'Xếp máy cho xã viên, chọn máy cứu viện khi máy hỏng.' },
  { username: 'op_minh', name: 'Anh Minh', role: 'Thợ lái máy', emoji: '🧑‍🔧', blurb: 'Lái máy gặt M01, cập nhật tiến độ, báo khi máy hỏng.' },
  { username: 'op_nam', name: 'Anh Nam', role: 'Thợ lái máy cứu viện', emoji: '👷', blurb: 'Lái máy M02, đến thay khi máy khác bị hỏng.' },
  { username: 'owner_tu', name: 'Chú Tư', role: 'Chủ máy', emoji: '👨‍🌾', blurb: 'Chủ máy M01 và M02, theo dõi tình trạng máy của mình.' },
  { username: 'repair_01', name: 'Đội sửa chữa', role: 'Đội kỹ thuật', emoji: '🛠️', blurb: 'Nhận máy hỏng, ghi nhận kết quả sửa chữa.' },
];

export interface DemoStep {
  who: string; // username
  title: string;
  doThis: string;
  youSee: string;
}

export const DEMO_STEPS: DemoStep[] = [
  {
    who: 'farmer_ba',
    title: 'Bác Ba gọi máy gặt',
    doThis: 'Ở Trang chủ, bấm “🌾 Gọi máy gặt”, chọn ruộng và giờ gặt rồi “Gửi cho HTX”.',
    youSee: 'Yêu cầu mới hiện ngay, thanh tiến trình dừng ở “Đã gửi”.',
  },
  {
    who: 'coord_htx01',
    title: 'Chị Lan xếp máy',
    doThis: 'Ở tab Điều phối, bấm “🚜 Xếp máy cho yêu cầu này”, chọn máy và thợ lái. Thử chọn máy M01 vào 20/11 14:00–19:00 để thấy hệ thống chặn trùng lịch.',
    youSee: 'Xếp được thì yêu cầu chuyển sang “Lịch máy đang chạy”; trùng giờ thì hiện cảnh báo đỏ.',
  },
  {
    who: 'op_minh',
    title: 'Máy hỏng giữa vụ',
    doThis: 'Bấm “🆘 Máy bị hỏng? Báo ngay”, chọn “Động cơ quá nóng” và “Nặng, cần máy khác đến thay”, rồi gửi.',
    youSee: 'Hệ thống ghi nhận sự cố và tự tìm máy thay thế.',
  },
  {
    who: 'coord_htx01',
    title: 'Chọn máy cứu viện',
    doThis: 'Mở tab “🆘 Máy hỏng & cứu viện”, xem máy được gợi ý (điểm phù hợp, khoảng cách) rồi bấm “✅ Chọn máy này đi thay”.',
    youSee: 'Ca gặt cũ được thay bằng ca mới; sự cố chuyển sang “Đã chọn máy thay thế”.',
  },
  {
    who: 'repair_01',
    title: 'Sửa máy hỏng',
    doThis: 'Ở “Việc sửa chữa”, mở máy đang chờ sửa, ghi kết quả và lưu.',
    youSee: 'Sự cố chuyển sang “Đã khắc phục”.',
  },
  {
    who: 'op_nam',
    title: 'Anh Nam gặt thay',
    doThis: 'Bấm “Bắt đầu ca”, sau đó “Hoàn tất ca gặt”.',
    youSee: 'Ca chuyển sang “Đã xong”, chờ chủ ruộng xác nhận.',
  },
  {
    who: 'farmer_ba',
    title: 'Bác Ba xác nhận gặt xong',
    doThis: 'Bấm “✍️ Xác nhận đã gặt xong”, chấm sao và xác nhận.',
    youSee: 'Thanh tiến trình đầy 5 bước, yêu cầu hoàn tất.',
  },
  {
    who: 'coord_htx01',
    title: 'Truy vết dữ liệu',
    doThis: 'Ở thanh “Nhật ký hoạt động” phía dưới, bấm “Xem chi tiết” ở một dòng.',
    youSee: '“Dữ liệu nguyên vẹn, không bị sửa”: mọi việc đều có người làm và thời gian, không thể sửa lại.',
  },
];
