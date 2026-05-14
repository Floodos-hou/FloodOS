package org.openagrios.core.twin;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * ETSI NGSI-LD v1 Context Entity Mapper.
 * Serializes physical asset telemetry into JSON-LD context entities
 * compliant with https://uri.etsi.org/ngsi-ld/v1/ngsi-ld-core-context.jsonld.
 */
public final class NgsiLdTwinMapper {

    private NgsiLdTwinMapper() {}

    public static Map<String, Object> toProperty(Object value, String unitCode, String observedAt) {
        Map<String, Object> prop = new LinkedHashMap<>();
        prop.put("type", "Property");
        prop.put("value", value);
        if (observedAt != null) {
            prop.put("observedAt", observedAt);
        }
        if (unitCode != null) {
            prop.put("unitCode", unitCode);
        }
        return prop;
    }

    public static Map<String, Object> toNgsiLdEntity(
            String entityType,
            String entityId,
            Map<String, Map<String, Object>> properties,
            double lng,
            double lat
    ) {
        Map<String, Object> entity = new LinkedHashMap<>();
        entity.put("@context", "https://uri.etsi.org/ngsi-ld/v1/ngsi-ld-core-context.jsonld");
        entity.put("id", "urn:ngsi-ld:" + entityType + ":" + entityId);
        entity.put("type", entityType);
        entity.putAll(properties);

        Map<String, Object> point = new LinkedHashMap<>();
        point.put("type", "Point");
        point.put("coordinates", List.of(lng, lat));

        Map<String, Object> location = new LinkedHashMap<>();
        location.put("type", "GeoProperty");
        location.put("value", point);

        entity.put("location", location);
        return entity;
    }
}
