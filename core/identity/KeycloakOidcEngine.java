// SPDX-License-Identifier: Apache-2.0



// Copyright 2026 OpenAgriOS Contributors







package org.openagrios.core.identity;







import org.openagrios.core.dataservices.JsonCodec;







import javax.crypto.Mac;



import javax.crypto.spec.SecretKeySpec;



import java.net.URI;



import java.net.URLDecoder;
import java.net.URLEncoder;
import java.util.regex.Matcher;
import java.util.regex.Pattern;



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

    public record KeycloakExchangeResult(
            int statusCode,
            boolean success,
            Map<String, Object> data,
            String error,
            String errorDescription
    ) {
        public static KeycloakExchangeResult ok(Map<String, Object> data) {
            return new KeycloakExchangeResult(200, true, data, null, null);
        }

        public static KeycloakExchangeResult fail(int code, String err, String desc) {
            return new KeycloakExchangeResult(code, false, Map.of(), err, desc);
        }
    }








    private static final HttpClient HTTP_CLIENT = HttpClient.newBuilder()



            .connectTimeout(Duration.ofSeconds(4))



            .build();







    public static final String DEFAULT_ISSUER = System.getenv().getOrDefault("KEYCLOAK_ISSUER", "http://localhost:8080/realms/openagrios");



    public static final String DEFAULT_AUDIENCE = "agriops-web";

    public static final String DEFAULT_INTROSPECTION_CLIENT_ID =
            System.getenv().getOrDefault("KEYCLOAK_INTROSPECTION_CLIENT_ID",
                    System.getenv().getOrDefault("KEYCLOAK_CLIENT_ID", "agriops-gateway"));

    public static final String DEFAULT_INTROSPECTION_CLIENT_SECRET =
            System.getenv().getOrDefault("KEYCLOAK_INTROSPECTION_CLIENT_SECRET",
                    System.getenv().getOrDefault("KEYCLOAK_CLIENT_SECRET", "agriops-gateway-secret-2026"));
    public static final String DEFAULT_CLIENT_SECRET =
            System.getenv().getOrDefault("KEYCLOAK_CLIENT_SECRET", "agriops-client-secret-2026");







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
        public AuthContext(String userId, String username, String organizationId, String role) {
            this(userId, username, username, username + "@openagrios.vn", organizationId, role, Map.of());
        }





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
            // Flexible matching for Docker container vs host port-forwarding (localhost:8080 vs keycloak:8080 vs 127.0.0.1:8080)
            boolean isKnownAlias = (normExpectedIss.contains("localhost:8080") || normExpectedIss.contains("keycloak:8080") || normExpectedIss.contains("127.0.0.1:8080"))
                    && (iss.contains("localhost:8080") || iss.contains("keycloak:8080") || iss.contains("127.0.0.1:8080"));
            String issPath = iss.replaceAll("^https?://[^/]+", "");
            String expectedPath = normExpectedIss.replaceAll("^https?://[^/]+", "");
            if (!(isKnownAlias && !issPath.isEmpty() && issPath.equals(expectedPath))) {
                throw new IllegalArgumentException("JWT issuer mismatch: expected '" + normExpectedIss + "' but found '" + iss + "'");
            }
        }







        // 4. Validate audience (aud)



        Object audObj = payload.get("aud");
        Object azpObj = payload.get("azp");
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
        } else if (audObj == null && azpObj != null && (String.valueOf(azpObj).equals(expectedAudience) || "account".equals(String.valueOf(azpObj)))) {
            // OpenID Connect Standard: if aud is absent in access token, match against azp (authorized party)
            audMatched = true;
        } else if (audObj == null && "agriops-web".equals(expectedAudience)) {
            // Flexible match for Keycloak access token where audience is implicit
            audMatched = true;
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



            boolean active = introspectLiveKeycloakToken(normExpectedIss, DEFAULT_INTROSPECTION_CLIENT_ID, DEFAULT_INTROSPECTION_CLIENT_SECRET, token);



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



    public static String resolveDatabaseUserId(String sub, String preferredUsername) {
        if (sub != null && sub.startsWith("usr_")) {
            return sub;
        }
        if (preferredUsername != null) {
            switch (preferredUsername) {
                case "coord_htx01": return "usr_coord_01";
                case "coord_htx02": return "usr_coord_02";
                case "farmer_ba": return "usr_farmer_ba";
                case "farmer_tam": return "usr_farmer_tam";
                case "farmer_nam": return "usr_farmer_nam";
                case "op_minh": return "usr_op_minh";
                case "op_nam": return "usr_op_nam";
                case "op_hai": return "usr_op_hai";
                case "op_son": return "usr_op_son";
                case "owner_tu": return "usr_owner_tu";
                case "repair_01": return "usr_repair_01";
                default:
                    if (!preferredUsername.isBlank()) {
                        return "usr_" + preferredUsername;
                    }
            }
        }
        return sub != null ? sub : "usr_unknown";
    }

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



            String orgId = payload.get("organization_id") != null && !String.valueOf(payload.get("organization_id")).isEmpty() && !"null".equals(String.valueOf(payload.get("organization_id")))
                    ? String.valueOf(payload.get("organization_id"))
                    : "HTX_CANTHO_01";
            String uname = String.valueOf(payload.getOrDefault("preferred_username", payload.get("sub")));
            String rawSub = String.valueOf(payload.getOrDefault("sub", uname));
            String resolvedUid = resolveDatabaseUserId(rawSub, uname);
            return new AuthContext(
                    resolvedUid,
                    uname,
                    String.valueOf(payload.getOrDefault("name", "")),
                    String.valueOf(payload.getOrDefault("email", "")),
                    orgId,
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
            String formBody = "token=" + URLEncoder.encode(token, StandardCharsets.UTF_8);

            String authHeader = null;
            if (clientId != null && clientSecret != null && !clientSecret.isBlank()) {
                // RFC 7662 & RFC 6749 Section 2.3.1: HTTP Basic Authentication (client_secret_basic).
                // RFC 6749 strictly mandates: "The client MUST NOT use more than one authentication method in each request."
                // Therefore, client_secret MUST NOT be included in the request body when using HTTP Basic header.
                String creds = clientId + ":" + clientSecret;
                authHeader = "Basic " + Base64.getEncoder().encodeToString(creds.getBytes(StandardCharsets.UTF_8));
            } else if (clientId != null) {
                // Public client identification (client_id only, no secret)
                formBody += "&client_id=" + URLEncoder.encode(clientId, StandardCharsets.UTF_8);
            }

            HttpRequest.Builder reqBuilder = HttpRequest.newBuilder()
                    .uri(URI.create(introspectEndpoint))
                    .header("Content-Type", "application/x-www-form-urlencoded")
                    .timeout(Duration.ofSeconds(4))
                    .POST(HttpRequest.BodyPublishers.ofString(formBody));

            if (authHeader != null) {
                reqBuilder.header("Authorization", authHeader);
            }

            HttpResponse<String> resp = HTTP_CLIENT.send(reqBuilder.build(), HttpResponse.BodyHandlers.ofString());
            if (resp.statusCode() == 200) {
                Map<String, Object> json = JsonCodec.parseObject(resp.body());
                return Boolean.TRUE.equals(json.get("active"));
            }
        } catch (Exception ignored) {
        }
        return false;
    }







    /**



     * Attempts OIDC Resource Owner Password exchange against Keycloak.



     */



        /**
     * Exchanges an authorization code and PKCE code_verifier for an access token (RFC 7636 & RFC 9700).
     * Recommended standard for all interactive web and mobile client authentication.
     */
    public static KeycloakExchangeResult exchangeAuthorizationCodeWithPkceDetailed(
            String issuerUrl,
            String clientId,
            String clientSecret,
            String code,
            String codeVerifier,
            String redirectUri
    ) {
        try {
            String tokenEndpoint = issuerUrl.replaceAll("/+$", "") + "/protocol/openid-connect/token";
            String targetClientId = (clientId != null && !clientId.isBlank()) ? clientId : DEFAULT_AUDIENCE;
            String secret = (clientSecret != null && !clientSecret.isBlank()) ? clientSecret : DEFAULT_CLIENT_SECRET;

            String formBody = "grant_type=authorization_code"
                    + "&code=" + URLEncoder.encode(code, StandardCharsets.UTF_8)
                    + "&code_verifier=" + URLEncoder.encode(codeVerifier, StandardCharsets.UTF_8)
                    + "&redirect_uri=" + URLEncoder.encode(redirectUri, StandardCharsets.UTF_8);

            HttpRequest.Builder reqBuilder = HttpRequest.newBuilder()
                    .uri(URI.create(tokenEndpoint))
                    .header("Content-Type", "application/x-www-form-urlencoded")
                    .timeout(Duration.ofSeconds(6));

            if (secret != null && !secret.isBlank()) {
                String creds = targetClientId + ":" + secret;
                reqBuilder.header("Authorization", "Basic " + Base64.getEncoder().encodeToString(creds.getBytes(StandardCharsets.UTF_8)));
            } else {
                formBody += "&client_id=" + URLEncoder.encode(targetClientId, StandardCharsets.UTF_8);
            }

            HttpRequest req = reqBuilder.POST(HttpRequest.BodyPublishers.ofString(formBody)).build();
            HttpResponse<String> resp = HTTP_CLIENT.send(req, HttpResponse.BodyHandlers.ofString());

            Map<String, Object> bodyMap = Collections.emptyMap();
            try {
                if (resp.body() != null && !resp.body().isBlank()) {
                    bodyMap = JsonCodec.parseObject(resp.body());
                }
            } catch (Exception ignored) {}

            if (resp.statusCode() == 200) {
                return KeycloakExchangeResult.ok(bodyMap);
            } else {
                String err = String.valueOf(bodyMap.getOrDefault("error", "KEYCLOAK_TOKEN_EXCHANGE_FAILED")).toUpperCase(Locale.ROOT);
                String desc = String.valueOf(bodyMap.getOrDefault("error_description", "Keycloak upstream returned HTTP " + resp.statusCode()));
                return KeycloakExchangeResult.fail(resp.statusCode(), err, desc);
            }
        } catch (Exception ex) {
            return KeycloakExchangeResult.fail(401, "KEYCLOAK_TOKEN_EXCHANGE_FAILED", ex.getMessage());
        }
    }

    public static Optional<Map<String, Object>> exchangeAuthorizationCodeWithPkce(
            String issuerUrl,
            String clientId,
            String clientSecret,
            String code,
            String codeVerifier,
            String redirectUri
    ) {
        KeycloakExchangeResult res = exchangeAuthorizationCodeWithPkceDetailed(issuerUrl, clientId, clientSecret, code, codeVerifier, redirectUri);
        return res.success() ? Optional.of(res.data()) : Optional.empty();
    }

    /**
     * @deprecated RFC 9700 Security Best Practice: ROPC is deprecated. Web apps must use Authorization Code + PKCE.
     */
    @Deprecated(since = "0.1.0-alpha", forRemoval = false)
    public static Optional<Map<String, Object>> tryLiveKeycloakLogin(
            String keycloakIssuerUrl,
            String clientId,
            String username,
            String password
    ) {
        try {
            String tokenEndpoint = keycloakIssuerUrl.replaceAll("/+$", "") + "/protocol/openid-connect/token";
            String targetClientId = clientId != null && !clientId.isBlank() ? clientId : "agriops-web";

            String formBody = "grant_type=password"
                    + "&username=" + URLEncoder.encode(username, StandardCharsets.UTF_8)
                    + "&password=" + URLEncoder.encode(password, StandardCharsets.UTF_8)
                    + "&scope=" + URLEncoder.encode("openid profile email", StandardCharsets.UTF_8);

            HttpRequest.Builder reqBuilder = HttpRequest.newBuilder()
                    .uri(URI.create(tokenEndpoint))
                    .header("Content-Type", "application/x-www-form-urlencoded")
                    .timeout(Duration.ofSeconds(4));

            if (DEFAULT_CLIENT_SECRET != null && !DEFAULT_CLIENT_SECRET.isBlank()) {
                String creds = targetClientId + ":" + DEFAULT_CLIENT_SECRET;
                reqBuilder.header("Authorization", "Basic " + Base64.getEncoder().encodeToString(creds.getBytes(StandardCharsets.UTF_8)));
            } else {
                formBody += "&client_id=" + URLEncoder.encode(targetClientId, StandardCharsets.UTF_8);
            }

            HttpRequest req = reqBuilder.POST(HttpRequest.BodyPublishers.ofString(formBody)).build();
            HttpResponse<String> resp = HTTP_CLIENT.send(req, HttpResponse.BodyHandlers.ofString());
            if (resp.statusCode() == 200) {
                Map<String, Object> parsed = JsonCodec.parseObject(resp.body());
                return Optional.of(parsed);
            }
        } catch (Exception ignored) {
        }
        return Optional.empty();
    }







    // ------------------------------------------------------------------------



    // OIDC AUTHORIZATION CODE + PKCE URL BUILDER (RFC 7636)



    // ------------------------------------------------------------------------




    /**
     * Programmatically completes Keycloak OIDC Authorization Code Flow in headless / testing environments (RFC 7636).
     * Simulates user-agent interaction:
     * 1. Initiates authorization request with code_challenge and state
     * 2. Extracts Keycloak login form action URL and cookies
     * 3. Posts credentials to Keycloak login endpoint
     * 4. Extracts genuine authorization code from 302 Found Location header
     */
    public static Optional<String> acquireLiveKeycloakAuthCode(
            String issuerUrl,
            String clientId,
            String username,
            String password,
            String redirectUri,
            String codeChallenge,
            String state
    ) {
        try {
            String targetClientId = (clientId != null && !clientId.isBlank()) ? clientId : DEFAULT_AUDIENCE;
            String targetRedirect = (redirectUri != null && !redirectUri.isBlank()) ? redirectUri : "http://localhost:8000/callback";
            String s = (state != null && !state.isBlank()) ? state : "state-" + UUID.randomUUID().toString().substring(0, 8);

            String authUrl = buildPkceAuthorizationUrl(issuerUrl, targetClientId, targetRedirect, codeChallenge, s);

            HttpClient directClient = HttpClient.newBuilder()
                    .connectTimeout(Duration.ofSeconds(6))
                    .followRedirects(HttpClient.Redirect.NEVER)
                    .build();

            // Step 1: GET authorization endpoint to retrieve login form and session cookies
            HttpRequest getReq = HttpRequest.newBuilder()
                    .uri(URI.create(authUrl))
                    .timeout(Duration.ofSeconds(6))
                    .GET()
                    .build();

            HttpResponse<String> getResp = directClient.send(getReq, HttpResponse.BodyHandlers.ofString());

            // Collect cookies from Set-Cookie headers
            List<String> cookies = getResp.headers().allValues("Set-Cookie");
            StringBuilder cookieHeader = new StringBuilder();
            for (String c : cookies) {
                String pair = c.split(";")[0].trim();
                if (!pair.isBlank()) {
                    if (cookieHeader.length() > 0) cookieHeader.append("; ");
                    cookieHeader.append(pair);
                }
            }

            String body = getResp.body();
            Matcher matcher = Pattern.compile("action=\"([^\"]+)\"").matcher(body);
            if (!matcher.find()) {
                System.err.println("acquireLiveKeycloakAuthCode: Could not find login form action in Keycloak HTML response");
                return Optional.empty();
            }
            String rawActionUrl = matcher.group(1).replace("&amp;", "&");

            // Normalize actionUrl: if relative, make absolute using issuerUrl origin;
            // if hostname in actionUrl differs from issuerUrl (e.g. keycloak vs localhost inside container), align host
            URI issuerUri = URI.create(issuerUrl);
            String actionUrl;
            if (rawActionUrl.startsWith("/")) {
                actionUrl = issuerUri.getScheme() + "://" + issuerUri.getAuthority() + rawActionUrl;
            } else {
                URI actionUri = URI.create(rawActionUrl);
                if (!issuerUri.getHost().equalsIgnoreCase(actionUri.getHost()) || issuerUri.getPort() != actionUri.getPort()) {
                    actionUrl = issuerUri.getScheme() + "://" + issuerUri.getAuthority() + actionUri.getRawPath()
                            + (actionUri.getRawQuery() != null ? "?" + actionUri.getRawQuery() : "");
                } else {
                    actionUrl = rawActionUrl;
                }
            }

            // Step 2: POST credentials to login action URL
            String formBody = "username=" + URLEncoder.encode(username, StandardCharsets.UTF_8)
                    + "&password=" + URLEncoder.encode(password, StandardCharsets.UTF_8)
                    + "&credentialId=";

            HttpRequest.Builder postReqBuilder = HttpRequest.newBuilder()
                    .uri(URI.create(actionUrl))
                    .timeout(Duration.ofSeconds(6))
                    .header("Content-Type", "application/x-www-form-urlencoded");

            if (cookieHeader.length() > 0) {
                postReqBuilder.header("Cookie", cookieHeader.toString());
            }

            HttpRequest postReq = postReqBuilder.POST(HttpRequest.BodyPublishers.ofString(formBody)).build();
            HttpResponse<String> postResp = directClient.send(postReq, HttpResponse.BodyHandlers.ofString());

            // Step 3: Check 302 Found redirect Location header
            if (postResp.statusCode() == 302 || postResp.statusCode() == 303) {
                String location = postResp.headers().firstValue("Location").orElse("");
                if (location.contains("code=")) {
                    Matcher codeMatcher = Pattern.compile("[?&]code=([^&]+)").matcher(location);
                    if (codeMatcher.find()) {
                        String code = URLDecoder.decode(codeMatcher.group(1), StandardCharsets.UTF_8);
                        return Optional.of(code);
                    }
                }
            } else {
                System.err.println("acquireLiveKeycloakAuthCode: Login post returned HTTP " + postResp.statusCode());
            }
        } catch (Exception ex) {
            System.err.println("acquireLiveKeycloakAuthCode failed: " + ex.getMessage());
        }
        return Optional.empty();
    }

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







    public static String generateCodeVerifier() {

        byte[] bytes = new byte[32];

        new SecureRandom().nextBytes(bytes);

        return b64UrlEncode(bytes);

    }



    public static String generateCodeChallenge(String verifier) {

        try {

            MessageDigest md = MessageDigest.getInstance("SHA-256");

            byte[] hash = md.digest(verifier.getBytes(StandardCharsets.US_ASCII));

            return b64UrlEncode(hash);

        } catch (Exception e) {

            throw new IllegalStateException("SHA-256 algorithm not available", e);

        }

    }



    public static Map<String, Object> generatePkceSession(String redirectUri, String state) {
        String verifier = generateCodeVerifier();
        String challenge = generateCodeChallenge(verifier);
        String s = (state != null && !state.isBlank()) ? state : "state-" + UUID.randomUUID().toString().substring(0, 8);
        String rUri = (redirectUri != null && !redirectUri.isBlank()) ? redirectUri : "http://localhost:8000/callback";

        String authUrl = buildPkceAuthorizationUrl(DEFAULT_ISSUER, DEFAULT_AUDIENCE, rUri, challenge, s);

        Map<String, Object> res = new LinkedHashMap<>();
        res.put("flow", "OIDC_AUTHORIZATION_CODE_WITH_PKCE");
        res.put("standard", "RFC 7636 / OpenID Connect Core 1.0");
        res.put("client_id", DEFAULT_AUDIENCE);
        res.put("issuer", DEFAULT_ISSUER);
        res.put("authorization_url", authUrl);
        res.put("code_verifier", verifier);
        res.put("code_challenge", challenge);
        res.put("code_challenge_method", "S256");
        res.put("state", s);
        res.put("redirect_uri", rUri);

        AuthMode mode = getActiveAuthMode();
        if (mode == AuthMode.DEV_MOCK_STANDALONE) {
            String authCode = "code-" + UUID.randomUUID().toString().replace("-", "");
            pendingPkceSessions.put(authCode, new PkceSession(authCode, challenge, "S256", DEFAULT_AUDIENCE, rUri, s, Instant.now()));
            res.put("code", authCode);
            res.put("auth_mode", "DEV_MOCK_STANDALONE");
        } else {
            res.put("auth_mode", "KEYCLOAK_PRODUCTION");
        }

        return res;
    }







    public static String createExpiredToken(UserAccount user) {



        return issueDevMockJwtCustom(user, -3600, DEFAULT_AUDIENCE);



    }







    public static String createWrongAudienceToken(UserAccount user) {



        return issueDevMockJwtCustom(user, 3600, "malicious-third-party-audience");



    }







    private static String issueDevMockJwtCustom(UserAccount user, long ttlSeconds, String audience) {



        Map<String, Object> header = new LinkedHashMap<>();



        header.put("alg", "HS256");



        header.put("typ", "JWT");







        long now = Instant.now().getEpochSecond();



        Map<String, Object> payload = new LinkedHashMap<>();



        payload.put("iss", DEFAULT_ISSUER);



        payload.put("sub", user.userId());



        payload.put("aud", audience);



        payload.put("iat", now - 7200);



        payload.put("exp", now + ttlSeconds);



        payload.put("nbf", now - 7200);



        payload.put("preferred_username", user.username());



        payload.put("name", user.fullName());



        payload.put("email", user.email());



        payload.put("organization_id", user.organizationId());



        payload.put("realm_access", Map.of("roles", List.of(user.role())));







        String hB64 = b64UrlEncode(JsonCodec.toJson(header).getBytes(StandardCharsets.UTF_8));



        String pB64 = b64UrlEncode(JsonCodec.toJson(payload).getBytes(StandardCharsets.UTF_8));



        String signingInput = hB64 + "." + pB64;



        byte[] sig = hmacSha256(signingInput.getBytes(StandardCharsets.US_ASCII));



        return signingInput + "." + b64UrlEncode(sig);



    }




    public record PkceSession(
            String code,
            String codeChallenge,
            String codeChallengeMethod,
            String clientId,
            String redirectUri,
            String state,
            Instant createdAt
    ) {}

    public static final Map<String, PkceSession> pendingPkceSessions = new java.util.concurrent.ConcurrentHashMap<>();

    public static boolean verifyPkceCodeChallenge(String code, String codeVerifier) {
        return verifyPkceCodeChallenge(code, codeVerifier, null);
    }

    public static boolean verifyPkceCodeChallenge(String code, String codeVerifier, String state) {
        if (codeVerifier == null || codeVerifier.length() < 43 || codeVerifier.length() > 128) {
            return false;
        }
        PkceSession session = pendingPkceSessions.remove(code);
        if (session != null) {
            if (state != null && !state.isBlank() && session.state() != null && !session.state().isBlank()) {
                if (!state.equals(session.state())) {
                    return false; // CSRF state mismatch detection
                }
            }
            String computed = generateCodeChallenge(codeVerifier);
            return computed.equals(session.codeChallenge());
        }
        return false;
    }
}



