package org.openagrios.core.identity;

import org.openagrios.core.dataservices.JsonCodec;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.*;

/**
 * OpenID Connect (OIDC) & JWT Token Engine.
 * Implements HMAC-SHA256 signature generation and cryptographic verification.
 * 100% domain-agnostic headless core identity service.
 */
public final class KeycloakOidcEngine {

    private static final String SECRET_STR = System.getenv().getOrDefault(
            "OPENAGRIOS_JWT_SECRET",
            "openagrios-keycloak-oidc-hs256-signing-key-2026"
    );
    private static final byte[] JWT_SECRET = SECRET_STR.getBytes(StandardCharsets.UTF_8);

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
            mac.init(new SecretKeySpec(JWT_SECRET, "HmacSHA256"));
            return mac.doFinal(data);
        } catch (Exception e) {
            throw new IllegalStateException("Failed to compute HMAC-SHA256", e);
        }
    }

    public static String issueJwt(UserAccount user) {
        long now = Instant.now().getEpochSecond();
        Map<String, Object> header = new LinkedHashMap<>();
        header.put("alg", "HS256");
        header.put("typ", "JWT");
        header.put("kid", "keycloak-openagrios-rsa-1");

        Map<String, Object> realmAccess = new LinkedHashMap<>();
        realmAccess.put("roles", List.of(user.role()));

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("iss", "http://localhost:8080/realms/openagrios");
        payload.put("sub", user.userId());
        payload.put("aud", "agriops-web");
        payload.put("iat", now);
        payload.put("exp", now + 86400);
        payload.put("jti", "kc-jwt-" + UUID.randomUUID().toString().replace("-", "").substring(0, 12));
        payload.put("preferred_username", user.username());
        payload.put("name", user.fullName());
        payload.put("email", user.email());
        payload.put("organization_id", user.organizationId());
        payload.put("realm_access", realmAccess);
        payload.put("scope", "openid profile email organization_id");

        String hB64 = b64UrlEncode(JsonCodec.toJson(header).getBytes(StandardCharsets.UTF_8));
        String pB64 = b64UrlEncode(JsonCodec.toJson(payload).getBytes(StandardCharsets.UTF_8));
        String signingInput = hB64 + "." + pB64;
        byte[] sig = hmacSha256(signingInput.getBytes(StandardCharsets.US_ASCII));
        return signingInput + "." + b64UrlEncode(sig);
    }

    @SuppressWarnings("unchecked")
    public static Map<String, Object> verifyJwt(String token) {
        String[] parts = token.split("\\.");
        if (parts.length != 3) {
            throw new IllegalArgumentException("Invalid JWT format");
        }
        String signingInput = parts[0] + "." + parts[1];
        byte[] expectedSig = hmacSha256(signingInput.getBytes(StandardCharsets.US_ASCII));
        byte[] actualSig = b64UrlDecode(parts[2]);
        if (!MessageDigest.isEqual(expectedSig, actualSig)) {
            throw new IllegalArgumentException("Invalid JWT signature");
        }
        String payloadJson = new String(b64UrlDecode(parts[1]), StandardCharsets.UTF_8);
        Map<String, Object> payload = JsonCodec.parseObject(payloadJson);
        Number exp = (Number) payload.getOrDefault("exp", 0L);
        if (exp.longValue() < Instant.now().getEpochSecond()) {
            throw new IllegalArgumentException("JWT token expired");
        }
        return payload;
    }

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
}
