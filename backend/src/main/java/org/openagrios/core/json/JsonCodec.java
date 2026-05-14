package org.openagrios.core.json;

import java.util.*;

/**
 * TẦNG 1 (CORE PaaS) — BỘ MÃ HÓA & GIẢI MÃ JSON ĐỘC LẬP (Apache-2.0)
 * Hỗ trợ chuyển đổi Map/List/Record/Primitive sang chuỗi JSON chuẩn RFC 8259
 * và đọc JSON Request Body từ Postman / REST Client mà không phụ thuộc thư viện đóng.
 */
public final class JsonCodec {

    private JsonCodec() {}

    public static String toJson(Object value) {
        return toJson(value, false);
    }

    public static String toCanonicalJson(Object value) {
        return toJson(value, true);
    }

    @SuppressWarnings("unchecked")
    private static String toJson(Object value, boolean sortKeys) {
        if (value == null) {
            return "null";
        }
        if (value instanceof String s) {
            return "\"" + escape(s) + "\"";
        }
        if (value instanceof Boolean || value instanceof Integer || value instanceof Long) {
            return value.toString();
        }
        if (value instanceof Double d) {
            if (d == Math.floor(d) && !Double.isInfinite(d)) {
                return String.format(Locale.US, "%.1f", d);
            }
            return Double.toString(d);
        }
        if (value instanceof Number n) {
            return n.toString();
        }
        if (value instanceof Map<?, ?> map) {
            StringBuilder sb = new StringBuilder("{");
            Collection<?> keys = sortKeys ? new TreeSet<>((Set<String>) map.keySet()) : map.keySet();
            boolean first = true;
            for (Object k : keys) {
                if (!first) sb.append(",");
                first = false;
                sb.append("\"").append(escape(String.valueOf(k))).append("\":");
                sb.append(toJson(map.get(k), sortKeys));
            }
            sb.append("}");
            return sb.toString();
        }
        if (value instanceof Iterable<?> list) {
            StringBuilder sb = new StringBuilder("[");
            boolean first = true;
            for (Object item : list) {
                if (!first) sb.append(",");
                first = false;
                sb.append(toJson(item, sortKeys));
            }
            sb.append("]");
            return sb.toString();
        }
        return "\"" + escape(value.toString()) + "\"";
    }

    public static String escape(String s) {
        StringBuilder sb = new StringBuilder(s.length() + 16);
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"' -> sb.append("\\\"");
                case '\\' -> sb.append("\\\\");
                case '\b' -> sb.append("\\b");
                case '\f' -> sb.append("\\f");
                case '\n' -> sb.append("\\n");
                case '\r' -> sb.append("\\r");
                case '\t' -> sb.append("\\t");
                default -> {
                    if (c < 0x20) {
                        sb.append(String.format("\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
                }
            }
        }
        return sb.toString();
    }

    @SuppressWarnings("unchecked")
    public static Map<String, Object> parseObject(String json) {
        if (json == null || json.isBlank()) {
            return new LinkedHashMap<>();
        }
        Object parsed = new Parser(json.trim()).parseValue();
        if (parsed instanceof Map<?, ?> m) {
            return (Map<String, Object>) m;
        }
        return new LinkedHashMap<>();
    }

    private static final class Parser {
        private final String src;
        private int pos = 0;

        Parser(String src) {
            this.src = src;
        }

        Object parseValue() {
            skipWhitespace();
            if (pos >= src.length()) return null;
            char c = src.charAt(pos);
            return switch (c) {
                case '{' -> parseMap();
                case '[' -> parseList();
                case '"' -> parseString();
                case 't', 'f' -> parseBoolean();
                case 'n' -> parseNull();
                default -> parseNumber();
            };
        }

        private Map<String, Object> parseMap() {
            Map<String, Object> map = new LinkedHashMap<>();
            pos++; // skip '{'
            skipWhitespace();
            if (pos < src.length() && src.charAt(pos) == '}') {
                pos++;
                return map;
            }
            while (pos < src.length()) {
                skipWhitespace();
                String key = parseString();
                skipWhitespace();
                if (pos < src.length() && src.charAt(pos) == ':') pos++;
                Object val = parseValue();
                map.put(key, val);
                skipWhitespace();
                if (pos < src.length() && src.charAt(pos) == ',') {
                    pos++;
                } else if (pos < src.length() && src.charAt(pos) == '}') {
                    pos++;
                    break;
                } else {
                    break;
                }
            }
            return map;
        }

        private List<Object> parseList() {
            List<Object> list = new ArrayList<>();
            pos++; // skip '['
            skipWhitespace();
            if (pos < src.length() && src.charAt(pos) == ']') {
                pos++;
                return list;
            }
            while (pos < src.length()) {
                list.add(parseValue());
                skipWhitespace();
                if (pos < src.length() && src.charAt(pos) == ',') {
                    pos++;
                } else if (pos < src.length() && src.charAt(pos) == ']') {
                    pos++;
                    break;
                } else {
                    break;
                }
            }
            return list;
        }

        private String parseString() {
            if (src.charAt(pos) == '"') pos++;
            StringBuilder sb = new StringBuilder();
            while (pos < src.length()) {
                char c = src.charAt(pos++);
                if (c == '"') {
                    return sb.toString();
                }
                if (c == '\\' && pos < src.length()) {
                    char esc = src.charAt(pos++);
                    switch (esc) {
                        case '"', '\\', '/' -> sb.append(esc);
                        case 'b' -> sb.append('\b');
                        case 'f' -> sb.append('\f');
                        case 'n' -> sb.append('\n');
                        case 'r' -> sb.append('\r');
                        case 't' -> sb.append('\t');
                        case 'u' -> {
                            if (pos + 4 <= src.length()) {
                                String hex = src.substring(pos, pos + 4);
                                sb.append((char) Integer.parseInt(hex, 16));
                                pos += 4;
                            }
                        }
                        default -> sb.append(esc);
                    }
                } else {
                    sb.append(c);
                }
            }
            return sb.toString();
        }

        private Boolean parseBoolean() {
            if (src.startsWith("true", pos)) {
                pos += 4;
                return Boolean.TRUE;
            }
            if (src.startsWith("false", pos)) {
                pos += 5;
                return Boolean.FALSE;
            }
            return Boolean.FALSE;
        }

        private Object parseNull() {
            if (src.startsWith("null", pos)) {
                pos += 4;
            }
            return null;
        }

        private Number parseNumber() {
            int start = pos;
            while (pos < src.length() && "-0123456789.eE+".indexOf(src.charAt(pos)) >= 0) {
                pos++;
            }
            String numStr = src.substring(start, pos);
            if (numStr.contains(".") || numStr.contains("e") || numStr.contains("E")) {
                return Double.parseDouble(numStr);
            }
            return Long.parseLong(numStr);
        }

        private void skipWhitespace() {
            while (pos < src.length() && Character.isWhitespace(src.charAt(pos))) {
                pos++;
            }
        }
    }
}
