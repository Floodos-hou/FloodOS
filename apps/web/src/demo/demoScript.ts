// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

/**
 * Demo storyline for FloodOS Operations Portal. Only active when the image is built with VITE_DEMO_MODE=true
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
  {
    username: 'dispatcher_hoa',
    name: 'Chị Hoa',
    role: 'Điều phối viên PCTT',
    emoji: '👩‍💼',
    blurb: 'Ban Chỉ huy PCTT Hà Nội. Xác minh tin ngập, điều động đội xuồng & máy bơm, duyệt chi viện khi hỏng xe.',
  },
  {
    username: 'reporter_lan',
    name: 'Chị Lan',
    role: 'Người báo tin / Người dân',
    emoji: '🙋‍♀️',
    blurb: 'Người dân vùng trũng ven sông. Gửi tin báo ngập sâu cần sơ tán, theo dõi và xác nhận an toàn khi nước rút.',
  },
  {
    username: 'reporter_hung',
    name: 'Anh Hùng',
    role: 'Người báo tin / Người dân',
    emoji: '👨‍💼',
    blurb: 'Người dân cụm dân cư B. Báo tin có người già cần trợ giúp y tế khẩn cấp.',
  },
  {
    username: 'team_cuong',
    name: 'Anh Cường',
    role: 'Đội trưởng Cơ động 02',
    emoji: '🧑‍🚒',
    blurb: 'Vận hành xuồng cứu hộ V02, nhận lệnh điều động, báo sự cố khi chân vịt vướng rác giữa dòng.',
  },
  {
    username: 'team_binh',
    name: 'Anh Bình',
    role: 'Đội trưởng Xuồng 01',
    emoji: '👷',
    blurb: 'Vận hành xuồng V01, nhận lệnh chi viện khẩn cấp thay thế xuồng V02 bị sự cố.',
  },
  {
    username: 'team_dung',
    name: 'Anh Dũng',
    role: 'Đội trưởng Bơm tiêu úng 03',
    emoji: '🧑‍🔧',
    blurb: 'Vận hành trạm bơm di động V04 (1.200 m³/h) bơm tiêu úng cho khu vực trũng thấp.',
  },
  {
    username: 'resource_giang',
    name: 'Chị Giang',
    role: 'Quản lý Nguồn lực',
    emoji: '📋',
    blurb: 'Quản lý phương tiện, theo dõi điểm trú an toàn, tiếp nhận phiếu sửa chữa thiết bị hư hỏng.',
  },
  {
    username: 'platform_admin',
    name: 'Quản trị hệ thống',
    role: 'Quản trị Nền tảng',
    emoji: '🛡️',
    blurb: 'Kiểm chứng toàn vẹn chuỗi băm SHA-256 bất biến, đối soát phả hệ dữ liệu.',
  },
];

export interface DemoStep {
  step: number;
  who: string; // username
  role: string;
  title: string;
  doThis: string;
  youSee: string;
}

export const DEMO_STEPS: DemoStep[] = [
  {
    step: 1,
    who: 'reporter_lan',
    role: 'REPORTER',
    title: 'Bước 1: Người dân gửi tin báo ngập khẩn cấp',
    doThis: 'Đăng nhập tài khoản Chị Lan (reporter_lan). Bấm “🚨 Báo điểm ngập khẩn cấp”, chọn nhu cầu “Sơ tán người dân”, nhập nước ngập 60 cm, kèm ảnh hiện trường rồi bấm gửi.',
    youSee: 'Tin báo FR-... xuất hiện ngay lập tức trên bản đồ và danh sách, trạng thái “Mới tiếp nhận, chờ xác minh”.',
  },
  {
    step: 2,
    who: 'dispatcher_hoa',
    role: 'DISPATCHER',
    title: 'Bước 2: Ban chỉ huy xác minh & xếp ưu tiên',
    doThis: 'Đổi sang tài khoản Chị Hoa (dispatcher_hoa). Xem tin báo vừa gửi, bấm “Xác minh tin báo”, chọn mức ưu tiên “Khẩn cấp (URGENT)”, ghi chú hiện trường.',
    youSee: 'Tin báo chuyển sang trạng thái “Đã xác minh, chờ điều phối”. Quy trình Flowable SOP-01 chuyển bước.',
  },
  {
    step: 3,
    who: 'dispatcher_hoa',
    role: 'DISPATCHER',
    title: 'Bước 3: Điều động Đội & Phương tiện ứng cứu',
    doThis: 'Bấm “Điều động lực lượng”. Thử chọn xuồng V01 trùng khung giờ để kiểm chứng cảnh báo trùng lịch 409 GiST. Sau đó chọn Xuồng V02 + Đội cơ động T02 trong khung giờ hợp lệ.',
    youSee: 'Lệnh điều động ORD-... được ban hành. Phương tiện V02 chuyển sang trạng thái sẵn sàng xuất phát.',
  },
  {
    step: 4,
    who: 'team_cuong',
    role: 'FIELD_TEAM',
    title: 'Bước 4: Đội hiện trường tác nghiệp & Báo sự cố',
    doThis: 'Đăng nhập Anh Cường (team_cuong). Bấm “Bắt đầu triển khai” (IN_PROGRESS). Sau đó giả định gặp rác cuộn, bấm “🚨 Báo hỏng phương tiện”, chọn sự cố “Chân vịt vướng rác”.',
    youSee: 'Xuồng V02 chuyển sang màu đỏ nhấp nháy (BREAKDOWN). Ca điều động bị gián đoạn. Động cơ cứu viện kích hoạt.',
  },
  {
    step: 5,
    who: 'dispatcher_hoa',
    role: 'DISPATCHER',
    title: 'Bước 5: Radar gợi ý & Phê duyệt chi viện',
    doThis: 'Đổi về Chị Hoa (dispatcher_hoa). Vào tab “Sự cố & Chi viện”, xem Radar chấm điểm các xuồng lân cận theo cự ly đường chim bay (Haversine), bấm “✅ Duyệt chi viện Xuồng V01 + Đội T01”.',
    youSee: 'Lệnh cũ chuyển SUPERSEDED, lệnh mới ORD-...-R1 xuất phát. Đường chi viện nối thẳng đến điểm ngập.',
  },
  {
    step: 6,
    who: 'team_binh',
    role: 'FIELD_TEAM',
    title: 'Bước 6: Đội chi viện hoàn tất nhiệm vụ',
    doThis: 'Đăng nhập Anh Bình (team_binh). Cập nhật tiến độ 100%, mực nước rút an toàn còn 10 cm, bấm “Hoàn tất nhiệm vụ”.',
    youSee: 'Vụ việc chuyển sang trạng thái RESOLVED, chờ người dân xác nhận nghiệm thu.',
  },
  {
    step: 7,
    who: 'reporter_lan',
    role: 'REPORTER',
    title: 'Bước 7: Người dân xác nhận an toàn & Kiểm chứng',
    doThis: 'Đăng nhập Chị Lan (reporter_lan). Bấm “✍️ Xác nhận đã an toàn”. Sau đó mở “Xem phả hệ dữ liệu” để kiểm chứng chuỗi băm SHA-256 từ Genesis.',
    youSee: 'Vụ việc được niêm phong vĩnh viễn trong sổ cái kiểm toán bất biến SHA-256.',
  },
];
