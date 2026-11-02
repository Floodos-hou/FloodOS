// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

package org.floodos.core.dataservices;

import java.util.*;

/**
 * High-performance, zero-dependency JSON serialization and parsing utility (RFC 8259).
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
            if (d.isNaN() || d.isInfinite()) {
                return "null";
            }
            if (d == Math.floor(d) && !Double.isInfinite(d)) {
                return String.format(Locale.US, "%.1f", d);
            }
            return Double.toString(d);
        }
        if (value instanceof Float f && (f.isNaN() || f.isInfinite())) {
            return "null";
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

    /**
     * Lenient parse for trusted upstream responses (Keycloak, Flowable, Postgres): blank or non-object input
     * yields an empty map and minor syntax errors are tolerated.
     */
    @SuppressWarnings("unchecked")
    public static Map<String, Object> parseObject(String json) {
        if (json == null || json.isBlank()) {
            return new LinkedHashMap<>();
        }
        Object parsed = new Parser(json.trim(), false).parseValue();
        if (parsed instanceof Map<?, ?> m) {
            return (Map<String, Object>) m;
        }
        return new LinkedHashMap<>();
    }

    /**
     * Strict RFC 8259 parse for untrusted client input. A blank body is an empty object; anything else must be
     * one well-formed JSON object with no trailing characters, otherwise {@link IllegalArgumentException}.
     * Garbage must never degrade silently into "{}" (handlers would then apply their default values).
     */
    @SuppressWarnings("unchecked")
    public static Map<String, Object> parseObjectStrict(String json) {
        if (json == null || json.isBlank()) {
            return new LinkedHashMap<>();
        }
        Parser parser = new Parser(json.trim(), true);
        Object parsed = parser.parseValue();
        parser.expectEnd();
        if (!(parsed instanceof Map<?, ?> m)) {
            throw new IllegalArgumentException("JSON body must be an object");
        }
        return (Map<String, Object>) m;
    }

    private static final class Parser {
        private final String src;
        private final boolean strict;
        private int pos = 0;

        Parser(String src, boolean strict) {
            this.src = src;
            this.strict = strict;
        }

        private IllegalArgumentException syntax(String what) {
            return new IllegalArgumentException("Malformed JSON at offset " + pos + ": " + what);
        }

        void expectEnd() {
            skipWhitespace();
            if (pos != src.length()) {
                throw syntax("unexpected trailing characters");
            }
        }

        Object parseValue() {
            skipWhitespace();
            if (pos >= src.length()) {
                if (strict) throw syntax("unexpected end of input");
                return null;
            }
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
                if (strict && (pos >= src.length() || src.charAt(pos) != '"')) throw syntax("object key must be a string");
                String key = parseString();
                skipWhitespace();
                if (pos < src.length() && src.charAt(pos) == ':') {
                    pos++;
                } else if (strict) {
                    throw syntax("expected ':' after object key");
                }
                Object val = parseValue();
                map.put(key, val);
                skipWhitespace();
                if (pos < src.length() && src.charAt(pos) == ',') {
                    pos++;
                } else if (pos < src.length() && src.charAt(pos) == '}') {
                    pos++;
                    return map;
                } else {
                    break;
                }
            }
            if (strict) throw syntax("unterminated object");
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
                    return list;
                } else {
                    break;
                }
            }
            if (strict) throw syntax("unterminated array");
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
                if (strict && c < 0x20) {
                    throw syntax("unescaped control character in string");
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
                                try {
                                    sb.append((char) Integer.parseInt(hex, 16));
                                } catch (NumberFormatException e) {
                                    if (strict) throw syntax("invalid \\u escape");
                                    throw e;
                                }
                                pos += 4;
                            } else if (strict) {
                                throw syntax("truncated \\u escape");
                            }
                        }
                        default -> {
                            if (strict) throw syntax("invalid escape \\" + esc);
                            sb.append(esc);
                        }
                    }
                } else {
                    sb.append(c);
                }
            }
            if (strict) throw syntax("unterminated string");
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
            if (strict) throw syntax("invalid literal");
            return Boolean.FALSE;
        }

        private Object parseNull() {
            if (src.startsWith("null", pos)) {
                pos += 4;
            } else if (strict) {
                throw syntax("invalid literal");
            }
            return null;
        }

        private Number parseNumber() {
            int start = pos;
            while (pos < src.length() && "-0123456789.eE+".indexOf(src.charAt(pos)) >= 0) {
                pos++;
            }
            String numStr = src.substring(start, pos);
            if (strict && numStr.isEmpty()) {
                throw syntax("unexpected character '" + (pos < src.length() ? src.charAt(pos) : '?') + "'");
            }
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
