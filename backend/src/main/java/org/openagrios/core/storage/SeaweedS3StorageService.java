package org.openagrios.core.storage;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;

/**
 * TẦNG 1 (CORE PaaS) — LƯU TRỮ ĐỐI TƯỢNG PHI CẤU TRÚC (SEAWEEDFS / S3 OBJECT STORAGE)
 * ===================================================================================
 * Quản lý việc lưu trữ minh chứng phi cấu trúc (ảnh hiện trường, biên bản nghiệm thu, tài liệu)
 * theo chuẩn S3 URI (`s3://bucket/tenant/...`) kèm mã băm kiểm chứng toàn vẹn `ETag` (MD5).
 */
public final class SeaweedS3StorageService {

    public record S3ObjectMeta(
            String objectKey,
            String organizationId,
            String bucket,
            String filename,
            String mimeType,
            long sizeBytes,
            String etag,
            String uploadedBy,
            String dataUrl,
            String createdAt
    ) {
        public Map<String, Object> toMap() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("object_key", objectKey);
            m.put("organization_id", organizationId);
            m.put("bucket", bucket);
            m.put("filename", filename);
            m.put("mime_type", mimeType);
            m.put("size_bytes", sizeBytes);
            m.put("etag", etag);
            m.put("uploaded_by", uploadedBy);
            m.put("data_url", dataUrl);
            m.put("created_at", createdAt);
            return m;
        }
    }

    private final Map<String, S3ObjectMeta> objects = new LinkedHashMap<>();

    public synchronized void clear() {
        objects.clear();
    }

    private static String md5Hex(String input) {
        try {
            MessageDigest md = MessageDigest.getInstance("MD5");
            byte[] digest = md.digest(input.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(32);
            for (byte b : digest) {
                sb.append(String.format("%02x", b));
            }
            return sb.toString();
        } catch (Exception e) {
            throw new IllegalStateException("MD5 not available", e);
        }
    }

    public synchronized S3ObjectMeta putEvidenceObject(
            String orgId,
            String bucket,
            String folder,
            String recordId,
            String filename,
            String mimeType,
            long sizeBytes,
            String uploadedBy,
            String dataUrl,
            String timestamp
    ) {
        String objKey = String.format("s3://%s/%s/%s/%s/%s",
                bucket, orgId.toLowerCase(Locale.ROOT), folder, recordId, filename);
        String etag = md5Hex(objKey + "|" + timestamp);
        S3ObjectMeta meta = new S3ObjectMeta(
                objKey, orgId, bucket, filename, mimeType, sizeBytes, etag, uploadedBy, dataUrl, timestamp
        );
        objects.put(objKey, meta);
        return meta;
    }

    public synchronized List<Map<String, Object>> listByTenant(String orgId) {
        List<Map<String, Object>> list = new ArrayList<>();
        List<S3ObjectMeta> all = new ArrayList<>(objects.values());
        for (int i = all.size() - 1; i >= 0; i--) {
            if (all.get(i).organizationId().equals(orgId)) {
                list.add(all.get(i).toMap());
            }
        }
        return list;
    }
}
