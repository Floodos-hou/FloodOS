// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenAgriOS Contributors

package org.openagrios.core.identity;

import org.openagrios.core.dataservices.JsonCodec;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.*;

/**
 * OpenID Connect (OIDC 1.0) & Identity Provider Engine.
 * ============================================================================
 * ARCHITECTURAL DESIGN (STRICT DUAL-MODE SEPARATION):
 *
 * 1. MODE `KEYCLOAK_PRODUCTION`:
 *    - Explicitly enabled via `OPENAGRIOS_AUTH_MODE=KEYCLOAK` or `PRODUCTION`.
 *    - Authenticates directly against live Keycloak OIDC 24.0.
 *    - Token validation utilizes standard RFC 7662 Token Introspection
 *      (`/protocol/openid-connect/token/introspect`) and strict claims checking
 *      (iss, aud, exp, sub).
 *    - STRICT SECURITY: NEVER automatically falls back to Mock mode if Keycloak fails.
 *
 * 2. MODE `DEV_MOCK_STANDALONE`:
 *    - Enabled by default for zero-dependency local development and automated CI.
 *    - Uses a cryptographically strong ephemeral 256-bit key (`SecureRandom`) generated
 *      per process lifecycle, preventing fixed-key forgery attacks.
 *    - Clearly stamped with `auth_mode=DEV_MOCK_STANDALONE` in all responses.
 *
 * 3. OIDC AUTHORIZATION CODE + PKCE SUPPORT:
 *    - Helper methods for building Authorization Code + PKCE endpoints according to
 *      RFC 7636 / OIDC Core 1.0.
 * ============================================================================
 */
public final class KeycloakOidcEngine {

    public enum AuthMode {
        KEYCLOAK_PRODUCTION,
        DEV_MOCK_STANDALONE
    }

    private static final HttpClient HTTP_CLIENT = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(4))
            .build();

    public static final String DEFAULT_ISSUER = "http://localhost:8080/realms/openagrios";
    public static final String DEFAULT_AUDIENCE = "agriops-web";

    // Dynamic key initialization: If no env var provided, generate a cryptographically secure ephemeral 256-bit key
    private static final byte[] EPHEMERAL_JWT_SECRET;
    private static final boolean IS_EPHEMERAL_KEY;

    static {
        String envSecret = System.getenv("OPENAGRIOS_JWT_SECRET");
        if (envSecret != null && !envSecret.isBlank()) {
            EPHEMERAL_JWT_SECRET = envSecret.getBytes(StandardCharsets.UTF_8);
            IS_EPHEMERAL_KEY = false;
        } else {
            byte[] ephemeral = new byte[32];
            new SecureRandom().nextBytes(ephemeral);
            EPHEMERAL_JWT_SECRET = ephemeral;
            IS_EPHEMERAL_KEY = true;
        }
    }

    private static volatile AuthMode overriddenAuthMode = null;

    public static void setAuthModeForTesting(AuthMode mode) {
        overriddenAuthMode = mode;
    }

    public static void resetAuthModeForTesting() {
        overriddenAuthMode = null;
    }

    /**
     * Resolves the configured active identity mode.
     * Throws IllegalStateException if OPENAGRIOS_AUTH_MODE has an invalid/unrecognized value.
     */
    public static AuthMode getActiveAuthMode() {
        if (overriddenAuthMode != null) {
            return overriddenAuthMode;
        }
        String raw = System.getenv("OPENAGRIOS_AUTH_MODE");
        if (raw == null || raw.isBlank()) {
            return AuthMode.DEV_MOCK_STANDALONE;
        }
        String mode = raw.trim().toUpperCase(Locale.ROOT);
        return switch (mode) {
            case "KEYCLOAK", "PRODUCTION", "KEYCLOAK_PRODUCTION" -> AuthMode.KEYCLOAK_PRODUCTION;
            case "MOCK", "DEV", "DEV_MOCK", "DEV_MOCK_STANDALONE" -> AuthMode.DEV_MOCK_STANDALONE;
            default -> throw new IllegalStateException(
                    "Lỗi cấu hình OPENAGRIOS_AUTH_MODE không hợp lệ: '" + raw +
                    "'. Các giá trị hợp lệ: KEYCLOAK_PRODUCTION (hoặc KEYCLOAK) hoặc DEV_MOCK_STANDALONE (hoặc MOCK). Hệ thống từ chối khởi động khi cấu hình sai.");
        };
    }

    public static boolean isEphemeralKeyInUse() {
        return IS_EPHEMERAL_KEY;
    }

    public record Organization(
            String organizationId,
            String name,
            String orgType,
            String province,
            String status
    ) {
        public Map<String, Object> toMap() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("organization_id", organizationId);
            m.put("name", name);
            m.put("org_type", orgType);
            m.put("province", province);
            m.put("status", status);
            return m;
        }
    }

    public record UserAccount(
            String userId,
            String username,
            String password,
            String fullName,
            String email,
            String organizationId,
            String role
    ) {
        public Map<String, Object> toPublicMap(String orgName) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("user_id", userId);
            m.put("username", username);
            m.put("full_name", fullName);
            m.put("email", email);
            m.put("organization_id", organizationId);
            m.put("role", role);
            if (orgName != null) {
                m.put("org_name", orgName);
            }
            return m;
        }
    }

    public record AuthContext(
            String userId,
            String username,
            String fullName,
            String email,
            String organizationId,
            String role,
            Map<String, Object> jwtPayload
    ) {
        public Map<String, Object> toMap() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("user_id", userId);
            m.put("username", username);
            m.put("full_name", fullName);
            m.put("organization_id", organizationId);
            m.put("role", role);
            m.put("jwt_payload", jwtPayload);
            return m;
        }
    }

    private static String b64UrlEncode(byte[] data) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(data);
    }

    private static byte[] b64UrlDecode(String str) {
        return Base64.getUrlDecoder().decode(str);
    }

    private static byte[] hmacSha256(byte[] data) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(EPHEMERAL_JWT_SECRET, "HmacSHA256"));
            return mac.doFinal(data);
        } catch (Exception e) {
            throw new IllegalStateException("Failed to compute HMAC-SHA256", e);
        }
    }

    // ------------------------------------------------------------------------
    // STANDALONE DEV MOCK TOKEN ISSUANCE
    // ------------------------------------------------------------------------
    public static String issueJwt(UserAccount user) {
        return issueDevMockJwt(user);
    }

    public static String issueDevMockJwt(UserAccount user) {
        return issueDevMockJwt(user, DEFAULT_ISSUER, DEFAULT_AUDIENCE, 86400);
    }

    public static String issueDevMockJwt(UserAccount user, String issuer, String audience, long ttlSeconds) {
        long now = Instant.now().getEpochSecond();
        Map<String, Object> header = new LinkedHashMap<>();
        header.put("alg", "HS256");
        header.put("typ", "JWT");
        header.put("kid", "openagrios-dev-key-01");

        Map<String, Object> realmAccess = new LinkedHashMap<>();
        realmAccess.put("roles", List.of(user.role()));

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("iss", issuer != null ? issuer : DEFAULT_ISSUER);
        payload.put("sub", user.userId());
        payload.put("aud", audience != null ? audience : DEFAULT_AUDIENCE);
        payload.put("iat", now);
        payload.put("exp", now + ttlSeconds);
        payload.put("nbf", now - 5);
        payload.put("jti", "kc-jwt-" + UUID.randomUUID().toString().replace("-", "").substring(0, 12));
        payload.put("preferred_username", user.username());
        payload.put("name", user.fullName());
        payload.put("email", user.email());
        payload.put("organization_id", user.organizationId());
        payload.put("realm_access", realmAccess);
        payload.put("scope", "openid profile email organization_id");
        payload.put("auth_mode", "DEV_MOCK_STANDALONE");

        String hB64 = b64UrlEncode(JsonCodec.toJson(header).getBytes(StandardCharsets.UTF_8));
        String pB64 = b64UrlEncode(JsonCodec.toJson(payload).getBytes(StandardCharsets.UTF_8));
        String signingInput = hB64 + "." + pB64;
        byte[] sig = hmacSha256(signingInput.getBytes(StandardCharsets.US_ASCII));
        return signingInput + "." + b64UrlEncode(sig);
    }

    // ------------------------------------------------------------------------
    // JWT VERIFICATION WITH FULL CLAIMS CHECK (iss, aud, exp, nbf, sub)
    // ------------------------------------------------------------------------
    @SuppressWarnings("unchecked")
    public static Map<String, Object> verifyJwt(String token) {
        return verifyJwt(token, DEFAULT_ISSUER, DEFAULT_AUDIENCE);
    }

    @SuppressWarnings("unchecked")
    public static Map<String, Object> verifyJwt(String token, String expectedIssuer, String expectedAudience) {
        String[] parts = token.split("\\.");
        if (parts.length != 3) {
            throw new IllegalArgumentException("Invalid JWT format (expected 3 parts header.payload.signature)");
        }

        // 1. Decode header and payload
        String headerJson = new String(b64UrlDecode(parts[0]), StandardCharsets.UTF_8);
        Map<String, Object> header = JsonCodec.parseObject(headerJson);
        String alg = String.valueOf(header.getOrDefault("alg", ""));

        String payloadJson = new String(b64UrlDecode(parts[1]), StandardCharsets.UTF_8);
        Map<String, Object> payload = JsonCodec.parseObject(payloadJson);

        // 2. Validate standard temporal claims (exp, nbf, iat)
        long now = Instant.now().getEpochSecond();
        Number exp = (Number) payload.get("exp");
        if (exp == null || exp.longValue() < (now - 60)) {
            throw new IllegalArgumentException("JWT token has expired (exp=" + exp + ", now=" + now + ")");
        }

        Number nbf = (Number) payload.get("nbf");
        if (nbf != null && nbf.longValue() > (now + 60)) {
            throw new IllegalArgumentException("JWT token not yet valid (nbf=" + nbf + ", now=" + now + ")");
        }

        // 3. Validate issuer (iss)
        String iss = String.valueOf(payload.getOrDefault("iss", "")).replaceAll("/+$", "");
        String normExpectedIss = expectedIssuer != null ? expectedIssuer.replaceAll("/+$", "") : "";
        if (!normExpectedIss.isEmpty() && !iss.equals(normExpectedIss)) {
            throw new IllegalArgumentException("JWT issuer mismatch: expected '" + normExpectedIss + "' but found '" + iss + "'");
        }

        // 4. Validate audience (aud)
        Object audObj = payload.get("aud");
        boolean audMatched = false;
        if (audObj instanceof String s && (s.equals(expectedAudience) || "account".equals(s))) {
            audMatched = true;
        } else if (audObj instanceof List<?> list) {
            for (Object item : list) {
                if (String.valueOf(item).equals(expectedAudience) || "account".equals(String.valueOf(item))) {
                    audMatched = true;
                    break;
                }
            }
        }
        if (!audMatched && expectedAudience != null && !expectedAudience.isBlank()) {
            throw new IllegalArgumentException("JWT audience mismatch: expected '" + expectedAudience + "' but found '" + audObj + "'");
        }

        // 5. Validate subject (sub)
        String sub = String.valueOf(payload.getOrDefault("sub", "")).trim();
        if (sub.isEmpty() || "null".equals(sub)) {
            throw new IllegalArgumentException("JWT subject claim (sub) is missing or empty");
        }

        // 6. Verify Signature strictly according to Active Auth Mode
        AuthMode activeMode = getActiveAuthMode();
        if (activeMode == AuthMode.DEV_MOCK_STANDALONE) {
            // In standalone/mock mode, ONLY accept HS256 tokens issued by our ephemeral engine.
            // Explicitly reject RS256 because standalone mock mode has no valid RSA verification mechanism.
            if (!"HS256".equals(alg)) {
                throw new SecurityException("Từ chối JWT: Chế độ DEV_MOCK_STANDALONE chỉ chấp nhận token 'HS256' do mock engine phát hành. Thuật toán '" + alg + "' (bao gồm RS256) bị từ chối vì không có cơ chế xác minh khóa công khai RSA trong môi trường mock độc lập.");
            }
            String signingInput = parts[0] + "." + parts[1];
            byte[] expectedSig = hmacSha256(signingInput.getBytes(StandardCharsets.US_ASCII));
            byte[] actualSig = b64UrlDecode(parts[2]);
            if (!MessageDigest.isEqual(expectedSig, actualSig)) {
                throw new SecurityException("Invalid HMAC-SHA256 signature in JWT (chữ ký không khớp hoặc token bị can thiệp)");
            }
        } else if (activeMode == AuthMode.KEYCLOAK_PRODUCTION) {
            // In Keycloak production mode, reject HS256 mock tokens and require valid RS256 via live RFC 7662 introspection.
            if (!"RS256".equals(alg)) {
                throw new SecurityException("Từ chối JWT: Chế độ KEYCLOAK_PRODUCTION từ chối thuật toán '" + alg + "' (HS256 mock bị cấm). Bắt buộc token OIDC chuẩn RS256 do máy chủ Keycloak phát hành.");
            }
            boolean active = introspectLiveKeycloakToken(normExpectedIss, expectedAudience, null, token);
            if (!active) {
                throw new SecurityException("Keycloak Token Introspection rejected token (active=false, revoked, hoặc không kết nối được máy chủ Keycloak RFC 7662)");
            }
        } else {
            throw new IllegalStateException("Trạng thái AuthMode không hợp lệ: " + activeMode);
        }

        return payload;
    }

    /**
     * Authenticates an HTTP Authorization Bearer token header.
     */
    @SuppressWarnings("unchecked")
    public static AuthContext authenticateBearer(String authHeader) {
        if (authHeader == null || !authHeader.startsWith("Bearer ")) {
            return null;
        }
        String token = authHeader.substring(7).trim();
        try {
            Map<String, Object> payload = verifyJwt(token);
            String role = "FARMER";
            Object realmAccess = payload.get("realm_access");
            if (realmAccess instanceof Map<?, ?> rm) {
                Object rolesObj = rm.get("roles");
                if (rolesObj instanceof List<?> roles && !roles.isEmpty()) {
                    role = String.valueOf(roles.get(0));
                }
            }
            return new AuthContext(
                    String.valueOf(payload.get("sub")),
                    String.valueOf(payload.get("preferred_username")),
                    String.valueOf(payload.getOrDefault("name", "")),
                    String.valueOf(payload.getOrDefault("email", "")),
                    String.valueOf(payload.get("organization_id")),
                    role,
                    payload
            );
        } catch (Exception e) {
            return null;
        }
    }

    // ------------------------------------------------------------------------
    // PRODUCTION KEYCLOAK OIDC INTROSPECTION & DIRECT CLIENT
    // ------------------------------------------------------------------------
    /**
     * Verifies token via RFC 7662 Token Introspection with upstream Keycloak.
     */
    public static boolean introspectLiveKeycloakToken(
            String issuerUrl,
            String clientId,
            String clientSecret,
            String token
    ) {
        try {
            String introspectEndpoint = issuerUrl.replaceAll("/+$", "") + "/protocol/openid-connect/token/introspect";
            String formBody = "token=" + URLEncoder.encode(token, StandardCharsets.UTF_8)
                    + "&client_id=" + URLEncoder.encode(clientId != null ? clientId : "agriops-web", StandardCharsets.UTF_8);
            if (clientSecret != null && !clientSecret.isBlank()) {
                formBody += "&client_secret=" + URLEncoder.encode(clientSecret, StandardCharsets.UTF_8);
            }

            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(introspectEndpoint))
                    .header("Content-Type", "application/x-www-form-urlencoded")
                    .timeout(Duration.ofSeconds(3))
                    .POST(HttpRequest.BodyPublishers.ofString(formBody))
                    .build();

            HttpResponse<String> resp = HTTP_CLIENT.send(req, HttpResponse.BodyHandlers.ofString());
            if (resp.statusCode() == 200) {
                Map<String, Object> json = JsonCodec.parseObject(resp.body());
                return Boolean.TRUE.equals(json.get("active"));
            }
        } catch (Exception e) {
            // Introspection request failed
        }
        return false;
    }

    /**
     * Attempts OIDC Resource Owner Password exchange against Keycloak.
     */
    public static Optional<Map<String, Object>> tryLiveKeycloakLogin(
            String keycloakIssuerUrl,
            String clientId,
            String username,
            String password
    ) {
        try {
            String tokenEndpoint = keycloakIssuerUrl.replaceAll("/+$", "") + "/protocol/openid-connect/token";
            String formBody = "grant_type=password"
                    + "&client_id=" + URLEncoder.encode(clientId != null ? clientId : "agriops-web", StandardCharsets.UTF_8)
                    + "&username=" + URLEncoder.encode(username, StandardCharsets.UTF_8)
                    + "&password=" + URLEncoder.encode(password, StandardCharsets.UTF_8)
                    + "&scope=" + URLEncoder.encode("openid profile email organization_id", StandardCharsets.UTF_8);

            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(tokenEndpoint))
                    .header("Content-Type", "application/x-www-form-urlencoded")
                    .timeout(Duration.ofSeconds(3))
                    .POST(HttpRequest.BodyPublishers.ofString(formBody))
                    .build();

            HttpResponse<String> resp = HTTP_CLIENT.send(req, HttpResponse.BodyHandlers.ofString());
            if (resp.statusCode() == 200) {
                Map<String, Object> parsed = JsonCodec.parseObject(resp.body());
                return Optional.of(parsed);
            }
        } catch (Exception ignored) {
            // Live Keycloak not reachable
        }
        return Optional.empty();
    }

    // ------------------------------------------------------------------------
    // OIDC AUTHORIZATION CODE + PKCE URL BUILDER (RFC 7636)
    // ------------------------------------------------------------------------
    public static String buildPkceAuthorizationUrl(
            String issuerUrl,
            String clientId,
            String redirectUri,
            String codeChallenge,
            String state
    ) {
        String authEndpoint = issuerUrl.replaceAll("/+$", "") + "/protocol/openid-connect/auth";
        return authEndpoint
                + "?response_type=code"
                + "&client_id=" + URLEncoder.encode(clientId, StandardCharsets.UTF_8)
                + "&redirect_uri=" + URLEncoder.encode(redirectUri, StandardCharsets.UTF_8)
                + "&scope=" + URLEncoder.encode("openid profile email organization_id", StandardCharsets.UTF_8)
                + "&code_challenge=" + URLEncoder.encode(codeChallenge, StandardCharsets.UTF_8)
                + "&code_challenge_method=S256"
                + "&state=" + URLEncoder.encode(state, StandardCharsets.UTF_8);
    }

    public static String createForgedRs256Token(String sub, String role, String orgId) {
        Map<String, Object> header = new LinkedHashMap<>();
        header.put("alg", "RS256");
        header.put("typ", "JWT");

        long now = Instant.now().getEpochSecond();
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("iss", DEFAULT_ISSUER);
        payload.put("sub", sub);
        payload.put("aud", DEFAULT_AUDIENCE);
        payload.put("iat", now);
        payload.put("exp", now + 3600);
        payload.put("nbf", now - 5);
        payload.put("preferred_username", sub);
        payload.put("organization_id", orgId);
        payload.put("realm_access", Map.of("roles", List.of(role)));

        String hB64 = b64UrlEncode(JsonCodec.toJson(header).getBytes(StandardCharsets.UTF_8));
        String pB64 = b64UrlEncode(JsonCodec.toJson(payload).getBytes(StandardCharsets.UTF_8));
        String fakeSig = b64UrlEncode("forged_unverified_rsa_signature_payload".getBytes(StandardCharsets.UTF_8));
        return hB64 + "." + pB64 + "." + fakeSig;
    }
}
