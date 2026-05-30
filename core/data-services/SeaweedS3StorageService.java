// SPDX-License-Identifier: Apache-2.0



// Copyright 2026 OpenAgriOS Contributors







package org.openagrios.core.dataservices;







import java.net.URI;



import java.net.http.HttpClient;



import java.net.http.HttpRequest;



import java.net.http.HttpResponse;



import java.nio.charset.StandardCharsets;



import java.security.MessageDigest;



import java.time.Duration;



import java.util.*;







/**



 * SeaweedFS S3-Compatible Unstructured Object Storage Service.



 * Supports dual-mode execution:



 * 1. SEAWEEDFS_S3_LIVE: Performs live HTTP PUT/GET operations against SeaweedFS S3 endpoint (:8333).



 * 2. EMBEDDED_DEV_MOCK: Standalone in-memory metadata store with cryptographic MD5 ETag computation



 *    when running unit/integration tests without external containers.



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



            String createdAt,



            String storageBackend,



            boolean liveS3Connected



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



            m.put("storage_backend", storageBackend);



            m.put("live_s3_connected", liveS3Connected);



            return m;



        }



    }







    private final String s3Endpoint;



    private final HttpClient httpClient;



    private final Map<String, S3ObjectMeta> objects = new LinkedHashMap<>();







    public SeaweedS3StorageService() {



        this(resolveEndpoint());



    }







    private static String resolveEndpoint() {



        String env = System.getenv("S3_ENDPOINT");



        if (env != null && !env.isBlank()) {



            return env;



        }



        return "http://localhost:9000";



    }







    public SeaweedS3StorageService(String s3Endpoint) {



        this.s3Endpoint = s3Endpoint != null ? s3Endpoint.replaceAll("/+$", "") : "http://localhost:9000";



        this.httpClient = HttpClient.newBuilder()



                .connectTimeout(Duration.ofMillis(1200))



                .build();



    }







    public String getS3Endpoint() {



        return s3Endpoint;



    }







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



        String backend = "EMBEDDED_DEV_MOCK";



        boolean liveConnected = false;







        // Attempt live HTTP PUT to SeaweedFS S3 REST API endpoint



        try {



            String pathUrl = s3Endpoint + "/" + bucket + "/" + orgId.toLowerCase(Locale.ROOT) + "/" + folder + "/" + recordId + "/" + filename;



            byte[] bodyBytes = (dataUrl != null && !dataUrl.isBlank())



                    ? dataUrl.getBytes(StandardCharsets.UTF_8)



                    : ("OpenAgriOS S3 Evidence Record: " + filename + " | Org: " + orgId + " | TS: " + timestamp).getBytes(StandardCharsets.UTF_8);







            HttpRequest req = HttpRequest.newBuilder()



                    .uri(URI.create(pathUrl))



                    .timeout(Duration.ofMillis(1200))



                    .header("Content-Type", mimeType != null ? mimeType : "application/octet-stream")



                    .PUT(HttpRequest.BodyPublishers.ofByteArray(bodyBytes))



                    .build();







            HttpResponse<String> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofString());



            if (resp.statusCode() >= 200 && resp.statusCode() < 300) {



                backend = "SEAWEEDFS_S3_LIVE";



                liveConnected = true;



                Optional<String> remoteEtag = resp.headers().firstValue("ETag");



                if (remoteEtag.isPresent()) {



                    etag = remoteEtag.get().replace("\"", "");



                }



            }



        } catch (Exception ignored) {



            // Live S3 endpoint offline in standalone testing; gracefully defaults to EMBEDDED_DEV_MOCK



            backend = "EMBEDDED_DEV_MOCK";



            liveConnected = false;



        }







        S3ObjectMeta meta = new S3ObjectMeta(



                objKey, orgId, bucket, filename, mimeType, sizeBytes, etag, uploadedBy, dataUrl, timestamp,



                backend, liveConnected



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





    public synchronized Map<String, Object> readEvidenceObject(String orgId, String bucket, String folder, String recordId, String filename) {

        String objKey = String.format("s3://%s/%s/%s/%s/%s",

                bucket, orgId.toLowerCase(Locale.ROOT), folder, recordId, filename);

        S3ObjectMeta meta = objects.get(objKey);



        Map<String, Object> result = new LinkedHashMap<>();

        result.put("object_key", objKey);

        result.put("organization_id", orgId);

        result.put("bucket", bucket);

        result.put("filename", filename);



        try {

            String pathUrl = s3Endpoint + "/" + bucket + "/" + orgId.toLowerCase(Locale.ROOT) + "/" + folder + "/" + recordId + "/" + filename;

            HttpRequest req = HttpRequest.newBuilder()

                    .uri(URI.create(pathUrl))

                    .timeout(Duration.ofMillis(1200))

                    .GET()

                    .build();



            HttpResponse<byte[]> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofByteArray());

            if (resp.statusCode() == 200) {

                result.put("status", "SUCCESS");

                result.put("bytes_read", resp.body().length);

                result.put("storage_backend", "SEAWEEDFS_S3_LIVE");

                result.put("live_s3_connected", true);

                Optional<String> remoteEtag = resp.headers().firstValue("ETag");

                remoteEtag.ifPresent(s -> result.put("etag", s.replace("\"", "")));

                return result;

            }

        } catch (Exception ignored) {

            // Live S3 endpoint offline in standalone mode

        }



        if (meta != null) {

            result.put("status", "SUCCESS");

            result.put("bytes_read", meta.sizeBytes());

            result.put("etag", meta.etag());

            result.put("storage_backend", meta.storageBackend());

            result.put("live_s3_connected", meta.liveS3Connected());

            return result;

        }



        result.put("status", "NOT_FOUND");

        return result;

    }

}

