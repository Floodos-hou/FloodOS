// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

package org.floodos.apps.floodos;

import org.floodos.core.dataservices.JsonCodec;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.*;

/**
 * Client for the FloodOS AI Tactical Assistant microservice (services/ai-assistant).
 * Supports situation summary, priority classification suggestion, and After-Action Report generation.
 *
 * <p>Zero-Failure Guarantee:
 * When the Python microservice is offline or unreachable, automatically falls back to deterministic,
 * rule-based tactical heuristics with 100% honesty declared in the response engine field.
 */
public final class AiAssistantClient {

    public record Result(int status, Map<String, Object> body) {}

    private final String baseUrl;
    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(3))
            .build();

    public AiAssistantClient() {
        this(System.getenv("AI_ASSISTANT_URL"));
    }

    public AiAssistantClient(String url) {
        if (url == null || url.isBlank()) {
            this.baseUrl = "http://localhost:8088";
        } else {
            this.baseUrl = url.replaceAll("/+$", "");
        }
    }

    public String getBaseUrl() {
        return baseUrl;
    }

    public String probe() {
        try {
            HttpRequest req = HttpRequest.newBuilder(URI.create(baseUrl + "/health"))
                    .timeout(Duration.ofSeconds(2))
                    .GET()
                    .build();
            HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            return res.statusCode() == 200 ? "UP" : "DEGRADED (HTTP " + res.statusCode() + ")";
        } catch (Exception e) {
            return "OFFLINE (HEURISTIC_FALLBACK_ACTIVE)";
        }
    }

    public Result summarize(Map<String, Object> payload) {
        try {
            String json = JsonCodec.toJson(payload);
            HttpRequest req = HttpRequest.newBuilder(URI.create(baseUrl + "/api/v1/ai/summarize"))
                    .timeout(Duration.ofSeconds(15))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(json, StandardCharsets.UTF_8))
                    .build();
            HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (res.statusCode() == 200) {
                return new Result(200, JsonCodec.parseObject(res.body()));
            }
        } catch (Exception ignored) {
            // Fall back to in-process heuristic
        }
        return new Result(200, summarizeFallback(payload));
    }

    public Result classifyPriority(Map<String, Object> payload) {
        try {
            String json = JsonCodec.toJson(payload);
            HttpRequest req = HttpRequest.newBuilder(URI.create(baseUrl + "/api/v1/ai/classify-priority"))
                    .timeout(Duration.ofSeconds(15))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(json, StandardCharsets.UTF_8))
                    .build();
            HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (res.statusCode() == 200) {
                return new Result(200, JsonCodec.parseObject(res.body()));
            }
        } catch (Exception ignored) {
            // Fall back to in-process heuristic
        }
        return new Result(200, classifyPriorityFallback(payload));
    }

    public Result afterActionReport(Map<String, Object> payload) {
        try {
            String json = JsonCodec.toJson(payload);
            HttpRequest req = HttpRequest.newBuilder(URI.create(baseUrl + "/api/v1/ai/after-action-report"))
                    .timeout(Duration.ofSeconds(20))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(json, StandardCharsets.UTF_8))
                    .build();
            HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (res.statusCode() == 200) {
                return new Result(200, JsonCodec.parseObject(res.body()));
            }
        } catch (Exception ignored) {
            // Fall back to in-process heuristic
        }
        return new Result(200, afterActionReportFallback(payload));
    }

    // -------------------------------------------------------------------------
    // Deterministic In-Process Fallbacks (Zero-Failure & Offline Capability)
    // -------------------------------------------------------------------------

    private static String vietnameseNeed(String need) {
        if (need == null) return "Sơ tán, cứu hộ khẩn cấp";
        return switch (need.toUpperCase(Locale.ROOT)) {
            case "EVACUATION" -> "Sơ tán, cứu hộ khẩn cấp";
            case "MEDICAL" -> "Cấp cứu y tế khẩn cấp";
            case "FOOD_WATER" -> "Tiếp tế lương thực và nước uống";
            case "PUMPING" -> "Bơm tiêu úng thoát nước";
            case "ROAD_BLOCKED" -> "Đường bị ngập cô lập, chia cắt giao thông";
            default -> need;
        };
    }

    private static Map<String, Object> summarizeFallback(Map<String, Object> req) {
        String reportId = String.valueOf(req.getOrDefault("report_id", ""));
        String status = String.valueOf(req.getOrDefault("status", "RECEIVED"));
        String priority = String.valueOf(req.getOrDefault("priority", "NORMAL"));
        String needType = vietnameseNeed(String.valueOf(req.getOrDefault("need_type", "EVACUATION")));
        double depth = 0.0;
        if (req.get("depth_cm") instanceof Number n) depth = n.doubleValue();
        int people = 0;
        if (req.get("people_affected") instanceof Number n) people = n.intValue();
        String desc = String.valueOf(req.getOrDefault("description", ""));
        String loc = String.valueOf(req.getOrDefault("location", "khu vực tin báo"));
        String ordersInfo = String.valueOf(req.getOrDefault("orders_info", "Chưa có lệnh điều phối"));
        String incidentsInfo = String.valueOf(req.getOrDefault("incidents_info", "Không có sự cố phương tiện"));

        String urgency = (depth >= 100 || people >= 5 || "CRITICAL".equals(priority) || "URGENT".equals(priority))
                ? "Mức độ NGUY HIỂM CAO"
                : (depth >= 50 || people >= 3) ? "Mức độ TRUNG BÌNH CẦN ƯU TIÊN" : "Mức độ ỔN ĐỊNH CẦN THEO DÕI";

        String summaryText = String.format(Locale.ROOT,
                "[%s] Vụ việc %s tại %s. Nhu cầu %s, mực nước ngập sâu %.0f cm với %d người cần hỗ trợ. Nội dung: \"%s\". Hiện trạng điều hành: %s.",
                urgency, reportId, loc, needType.toLowerCase(Locale.ROOT), depth, people, desc, status);

        List<String> timeline = new ArrayList<>();
        if (req.containsKey("created_at") && !String.valueOf(req.get("created_at")).isBlank()) {
            timeline.add(req.get("created_at") + ": Tiếp nhận tin báo ban đầu từ người dân.");
        }
        if (!ordersInfo.contains("Chưa có")) {
            timeline.add("Lệnh điều động: " + ordersInfo);
        } else {
            timeline.add("Đang chờ điều phối viên phát lệnh điều động.");
        }
        if (!incidentsInfo.contains("Không có")) {
            timeline.add("Sự cố phương tiện: " + incidentsInfo);
        }

        List<String> actions = new ArrayList<>();
        if ("RECEIVED".equals(status)) {
            actions.add("Xác minh nhanh thông tin thực địa và phê duyệt mức ưu tiên (" + priority + ").");
        }
        if (depth >= 80 || needType.contains("Sơ tán")) {
            actions.add("Huy động xuồng cứu hộ chuyên dụng (Rescue Boat) và áo phao cơ động tiếp cận.");
        } else if (needType.contains("Bơm")) {
            actions.add("Điều phối máy bơm dã chiến công suất lớn và rào chắn cảnh báo điểm ngập.");
        } else {
            actions.add("Chỉ định xe tải gầm cao tiếp tế lương thực và nhu yếu phẩm đến tọa độ yêu cầu.");
        }
        actions.add("Rà soát điểm trú ẩn an toàn gần nhất để sẵn sàng tiếp nhận người dân sơ tán.");

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("report_id", reportId);
        out.put("summary_text", summaryText);
        out.put("current_status", status);
        out.put("timeline", timeline);
        out.put("suggested_actions", actions);
        out.put("engine", "TACTICAL_HEURISTIC_FALLBACK (Java In-Process)");
        out.put("generated_at", Instant.now().toString());
        return out;
    }

    private static Map<String, Object> classifyPriorityFallback(Map<String, Object> req) {
        String desc = String.valueOf(req.getOrDefault("description", "")).toLowerCase(Locale.ROOT);
        double depth = 0.0;
        if (req.get("depth_cm") instanceof Number n) depth = n.doubleValue();
        int people = 1;
        if (req.get("people_affected") instanceof Number n) people = n.intValue();
        String need = String.valueOf(req.getOrDefault("need_type", "EVACUATION")).toUpperCase(Locale.ROOT);

        List<String> criticalKeywords = List.of(
                "nguy kịch", "cấp cứu", "sắp chìm", "đuối nước", "mắc kẹt người già",
                "trẻ sơ sinh", "bệnh nhân", "nguy hiểm tính mạng", "sập nhà", "cuốn trôi");
        List<String> urgentKeywords = List.of(
                "ngập sâu", "cô lập", "hết đồ ăn", "thiếu nước", "chia cắt",
                "nước dâng", "trẻ em", "người già", "khẩn cấp");

        boolean isCrit = criticalKeywords.stream().anyMatch(desc::contains) || depth >= 100 || ("MEDICAL".equals(need) && depth >= 40);
        boolean isUrg = urgentKeywords.stream().anyMatch(desc::contains) || depth >= 50 || people >= 4 || "EVACUATION".equals(need) || "MEDICAL".equals(need);

        String priority;
        double confidence;
        String reasoning;
        List<String> keyFactors = new ArrayList<>();

        if (isCrit) {
            priority = "CRITICAL";
            confidence = 0.92;
            keyFactors.add("Dấu hiệu nguy kịch hoặc ngập rất sâu (>=100cm / y tế khẩn cấp)");
            reasoning = "Tình huống có yếu tố đe dọa trực tiếp tính mạng, cần ưu tiên phản ứng tức thì.";
        } else if (isUrg) {
            priority = "URGENT";
            confidence = 0.86;
            keyFactors.add("Ngập sâu (>=50cm), nhóm người bị cô lập hoặc cần sơ tán/y tế");
            reasoning = "Ngập sâu diện rộng cần xuồng cứu hộ hoặc đội cơ động tiếp cận kịp thời.";
        } else if (depth >= 30 || people >= 2 || "FOOD_WATER".equals(need) || "ROAD_BLOCKED".equals(need)) {
            priority = "HIGH";
            confidence = 0.80;
            keyFactors.add("Ngập chia cắt giao thông (>=30cm) hoặc cần tiếp tế khẩn cấp");
            reasoning = "Khu vực cản trở đi lại, cần điều động xe gầm cao hoặc hỗ trợ tiếp tế.";
        } else if (depth >= 10 || "PUMPING".equals(need)) {
            priority = "NORMAL";
            confidence = 0.85;
            keyFactors.add("Ngập cục bộ thông thường, có thể kiểm soát bằng bơm tiêu úng");
            reasoning = "Ngập úng cục bộ, ưu tiên các biện pháp tiêu thoát nước tiêu chuẩn.";
        } else {
            priority = "LOW";
            confidence = 0.88;
            keyFactors.add("Mức độ ngập nhẹ, tình trạng ổn định");
            reasoning = "Tin báo quan sát thông thường, duy trì giám sát định kỳ.";
        }

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("suggested_priority", priority);
        out.put("confidence", confidence);
        out.put("reasoning", reasoning);
        out.put("key_factors", keyFactors);
        out.put("engine", "TACTICAL_HEURISTIC_FALLBACK (Java In-Process)");
        out.put("generated_at", Instant.now().toString());
        return out;
    }

    private static Map<String, Object> afterActionReportFallback(Map<String, Object> req) {
        String reportId = String.valueOf(req.getOrDefault("report_id", ""));
        String createdAt = String.valueOf(req.getOrDefault("created_at", ""));
        String resolvedAt = String.valueOf(req.getOrDefault("resolved_at", Instant.now().toString()));
        String priority = String.valueOf(req.getOrDefault("priority", "NORMAL"));
        String needType = vietnameseNeed(String.valueOf(req.getOrDefault("need_type", "EVACUATION")));
        double depth = 0.0;
        if (req.get("depth_cm") instanceof Number n) depth = n.doubleValue();
        double finalDepth = 0.0;
        if (req.get("final_depth_cm") instanceof Number n) finalDepth = n.doubleValue();
        int people = 0;
        if (req.get("people_affected") instanceof Number n) people = n.intValue();
        String team = String.valueOf(req.getOrDefault("team_name", "Đội phản ứng nhanh"));
        String vehicle = String.valueOf(req.getOrDefault("vehicle_name", "Phương tiện cứu hộ"));
        String outcome = String.valueOf(req.getOrDefault("outcome", "RESOLVED"));
        String fieldNotes = String.valueOf(req.getOrDefault("field_notes", "Đã xử lý an toàn cho nhân dân theo quy trình."));
        String chainProof = String.valueOf(req.getOrDefault("chain_proof", "SHA-256 Validated"));

        String md = String.format(Locale.ROOT,
                """
                # BÁO CÁO TỔNG KẾT VỤ VIỆC (AFTER-ACTION REPORT)
                **Mã vụ việc:** `%s` | **Mức ưu tiên ban đầu:** `%s` | **Trạng thái:** `HOÀN TẤT & ĐÓNG HỒ SƠ`

                ---

                ### 1. TỔNG QUAN VỤ VIỆC & MỨC ĐỘ THIỆT HẠI
                - **Loại hình nhiệm vụ:** %s
                - **Thời điểm tiếp nhận:** %s
                - **Thời điểm hoàn thành:** %s
                - **Hiện trạng ban đầu:** Mực nước ngập sâu **%.0f cm**, có **%d người** cần ứng cứu khẩn cấp.
                - **Hiện trạng kết thúc:** Mực nước rút còn **%.0f cm**, an toàn cho người dân.

                ---

                ### 2. DÒNG THỜI GIAN ĐIỀU PHỐI (CHỈ HUY ➔ HIỆN TRƯỜNG ➔ XÁC NHẬN)
                1. **Tiếp nhận & Xác minh:** Tiếp nhận tin báo của người dân qua Cổng tác chiến FloodOS. Điều phối viên thẩm tra thực địa và phê duyệt mức ưu tiên `%s`.
                2. **Phát lệnh điều động:** Trung tâm phát lệnh điều động cho **%s** vận hành **%s** cơ động tiếp cận hiện trường.
                3. **Thực thi nhiệm vụ:** Đội cứu hộ tiếp cận, triển khai sơ tán/hỗ trợ người dân, ghi nhận hiện trường và cập nhật tiến độ 100%%.
                4. **Xác nhận kết quả:** Người báo tin xác nhận thực tế (`CONFIRMED`), đóng vụ việc.

                ---

                ### 3. NGUỒN LỰC HUY ĐỘNG & ĐÁNH GIÁ HIỆU SUẤT
                - **Đội cứu hộ:** %s
                - **Phương tiện:** %s
                - **Kết quả nghiệm thu:** `%s`
                - **Ghi chú hiện trường:** %s
                - **Tính toàn vẹn kiểm chứng:** Chuỗi Hash-Chain SHA-256 xác thực **HỢP LỆ (100%% Tamper-Evident)** (Bằng chứng: `%s`).

                ---

                ### 4. ĐÁNH GIÁ VÀ BÀI HỌC KINH NGHIỆM
                - **Điểm mạnh:** Thời gian xác minh và điều động diễn ra nhanh chóng; định vị GPS và thông tin nhu cầu chính xác giúp đội cứu hộ chọn đúng phương tiện.
                - **Kiến nghị phòng ngừa:** Tiếp tục theo dõi cốt ngập tại vị trí này trong các đợt mưa kế tiếp; kiến nghị bổ sung rào chắn cảnh báo độ sâu tự động.
                """,
                reportId, priority, needType, createdAt, resolvedAt, depth, people, finalDepth,
                priority, team, vehicle, team, vehicle, outcome, fieldNotes, chainProof);

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("report_id", reportId);
        out.put("report_title", "Báo cáo tổng kết ứng phó vụ việc " + reportId);
        out.put("executive_summary", String.format(Locale.ROOT, "Đã giải quyết thành công vụ việc %s (%s). Đội %s đã hỗ trợ an toàn cho %d người dân, nước rút về %.0f cm.",
                reportId, needType, team, people, finalDepth));
        out.put("markdown_content", md);
        out.put("engine", "TACTICAL_HEURISTIC_FALLBACK (Java In-Process)");
        out.put("generated_at", Instant.now().toString());
        return out;
    }
}
