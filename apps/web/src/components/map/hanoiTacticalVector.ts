// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

/**
 * Built-in Hanoi Tactical Hydrology & Administrative Vector Dataset.
 * Enables MapLibre GL to render an ultra-crisp, high-contrast Tactical GIS basemap
 * with 0 external network dependencies, ensuring the map never turns into a blank void.
 */

export const HANOI_TACTICAL_BASEMAP_GEOJSON = {
  type: 'FeatureCollection',
  features: [
    // ------------------------------------------------------------------------
    // 1. Hanoi Administrative Districts (Fill & Boundaries)
    // ------------------------------------------------------------------------
    {
      type: 'Feature',
      properties: { name: 'Q. Hoàng Mai', type: 'district', elevation: '4.8m' },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [105.815, 20.995], [105.875, 20.995], [105.895, 20.960],
          [105.865, 20.940], [105.820, 20.955], [105.815, 20.995]
        ]]
      }
    },
    {
      type: 'Feature',
      properties: { name: 'H. Thanh Trì', type: 'district', elevation: '4.2m' },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [105.800, 20.960], [105.865, 20.940], [105.885, 20.910],
          [105.820, 20.895], [105.785, 20.930], [105.800, 20.960]
        ]]
      }
    },
    {
      type: 'Feature',
      properties: { name: 'Q. Hà Đông', type: 'district', elevation: '5.5m' },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [105.740, 20.990], [105.795, 20.985], [105.785, 20.930],
          [105.720, 20.935], [105.740, 20.990]
        ]]
      }
    },
    {
      type: 'Feature',
      properties: { name: 'Q. Đống Đa', type: 'district', elevation: '6.5m' },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [105.810, 21.035], [105.845, 21.030], [105.840, 20.995],
          [105.805, 21.000], [105.810, 21.035]
        ]]
      }
    },
    {
      type: 'Feature',
      properties: { name: 'Q. Thanh Xuân', type: 'district', elevation: '5.8m' },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [105.790, 21.010], [105.830, 21.005], [105.815, 20.980],
          [105.780, 20.985], [105.790, 21.010]
        ]]
      }
    },
    {
      type: 'Feature',
      properties: { name: 'Q. Nam Từ Liêm', type: 'district', elevation: '6.2m' },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [105.740, 21.030], [105.790, 21.025], [105.780, 20.985],
          [105.735, 20.990], [105.740, 21.030]
        ]]
      }
    },
    {
      type: 'Feature',
      properties: { name: 'Q. Cầu Giấy', type: 'district', elevation: '7.0m' },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [105.775, 21.055], [105.815, 21.050], [105.810, 21.020],
          [105.770, 21.025], [105.775, 21.055]
        ]]
      }
    },
    {
      type: 'Feature',
      properties: { name: 'Q. Ba Đình', type: 'district', elevation: '7.8m' },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [105.810, 21.050], [105.845, 21.045], [105.845, 21.025],
          [105.810, 21.030], [105.810, 21.050]
        ]]
      }
    },
    {
      type: 'Feature',
      properties: { name: 'Q. Hoàn Kiếm', type: 'district', elevation: '8.2m' },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [105.845, 21.040], [105.865, 21.035], [105.860, 21.015],
          [105.840, 21.020], [105.845, 21.040]
        ]]
      }
    },
    {
      type: 'Feature',
      properties: { name: 'Q. Hai Bà Trưng', type: 'district', elevation: '6.8m' },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [105.840, 21.015], [105.875, 21.010], [105.870, 20.985],
          [105.835, 20.990], [105.840, 21.015]
        ]]
      }
    },
    {
      type: 'Feature',
      properties: { name: 'Q. Tây Hồ', type: 'district', elevation: '7.5m' },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [105.800, 21.090], [105.850, 21.080], [105.850, 21.045],
          [105.805, 21.050], [105.800, 21.090]
        ]]
      }
    },

    // ------------------------------------------------------------------------
    // 2. Primary Hanoi Water Bodies & Retention Lakes (Polygons)
    // ------------------------------------------------------------------------
    {
      type: 'Feature',
      properties: { name: 'Hồ Tây (500 ha)', type: 'lake', capacity: '12.0M m³' },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [105.810, 21.055], [105.835, 21.075], [105.850, 21.065],
          [105.845, 21.050], [105.825, 21.045], [105.810, 21.055]
        ]]
      }
    },
    {
      type: 'Feature',
      properties: { name: 'Hồ Yên Sở (Công viên thoát nước Nam Hà Nội)', type: 'lake', capacity: '6.5M m³' },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [105.860, 20.970], [105.885, 20.975], [105.890, 20.955],
          [105.865, 20.950], [105.860, 20.970]
        ]]
      }
    },
    {
      type: 'Feature',
      properties: { name: 'Hồ Linh Đàm (Hồ điều hòa trũng)', type: 'lake', capacity: '2.8M m³' },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [105.820, 20.968], [105.838, 20.970], [105.840, 20.958],
          [105.822, 20.956], [105.820, 20.968]
        ]]
      }
    },
    {
      type: 'Feature',
      properties: { name: 'Hồ Định Công (Vùng ngập trọng điểm)', type: 'lake', capacity: '1.2M m³' },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [105.832, 20.985], [105.844, 20.986], [105.845, 20.978],
          [105.833, 20.977], [105.832, 20.985]
        ]]
      }
    },
    {
      type: 'Feature',
      properties: { name: 'Hồ Hoàn Kiếm', type: 'lake', capacity: '0.3M m³' },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [105.850, 21.031], [105.854, 21.031], [105.853, 21.026],
          [105.849, 21.026], [105.850, 21.031]
        ]]
      }
    },

    // ------------------------------------------------------------------------
    // 3. Primary Rivers & Critical Drainage Canals (LineStrings)
    // ------------------------------------------------------------------------
    {
      type: 'Feature',
      properties: { name: 'Sông Hồng (Red River)', type: 'river', width: '900m', flow: 'Tây Bắc - Đông Nam' },
      geometry: {
        type: 'LineString',
        coordinates: [
          [105.740, 21.115], [105.770, 21.100], [105.805, 21.085],
          [105.840, 21.065], [105.870, 21.035], [105.895, 20.995],
          [105.920, 20.955], [105.940, 20.920]
        ]
      }
    },
    {
      type: 'Feature',
      properties: { name: 'Sông Đuống (Phân lưu Sông Hồng)', type: 'river', width: '400m' },
      geometry: {
        type: 'LineString',
        coordinates: [
          [105.840, 21.065], [105.875, 21.070], [105.920, 21.065],
          [105.960, 21.055], [106.000, 21.045]
        ]
      }
    },
    {
      type: 'Feature',
      properties: { name: 'Sông Nhuệ (Hệ thống thoát lũ Hà Đông - Thanh Trì)', type: 'canal', width: '45m' },
      geometry: {
        type: 'LineString',
        coordinates: [
          [105.750, 21.060], [105.760, 21.020], [105.775, 20.980],
          [105.795, 20.950], [105.820, 20.920], [105.845, 20.890]
        ]
      }
    },
    {
      type: 'Feature',
      properties: { name: 'Sông Tô Lịch (Trục thoát nước trung tâm đô thị)', type: 'canal', width: '35m' },
      geometry: {
        type: 'LineString',
        coordinates: [
          [105.805, 21.050], [105.800, 21.020], [105.808, 20.990],
          [105.825, 20.965], [105.850, 20.950]
        ]
      }
    },
    {
      type: 'Feature',
      properties: { name: 'Kênh dẫn trạm bơm Yên Sở (Công suất 90m³/s)', type: 'canal', width: '25m' },
      geometry: {
        type: 'LineString',
        coordinates: [
          [105.850, 20.950], [105.870, 20.955], [105.890, 20.955]
        ]
      }
    },

    // ------------------------------------------------------------------------
    // 4. Tactical Grid & Elevation Contours
    // ------------------------------------------------------------------------
    {
      type: 'Feature',
      properties: { name: 'Tactical Grid N21°00\'', type: 'grid' },
      geometry: {
        type: 'LineString',
        coordinates: [[105.700, 21.000], [106.000, 21.000]]
      }
    },
    {
      type: 'Feature',
      properties: { name: 'Tactical Grid N20°95\'', type: 'grid' },
      geometry: {
        type: 'LineString',
        coordinates: [[105.700, 20.950], [106.000, 20.950]]
      }
    },
    {
      type: 'Feature',
      properties: { name: 'Tactical Grid E105°85\'', type: 'grid' },
      geometry: {
        type: 'LineString',
        coordinates: [[105.850, 20.900], [105.850, 21.120]]
      }
    },
    {
      type: 'Feature',
      properties: { name: 'Tactical Grid E105°80\'', type: 'grid' },
      geometry: {
        type: 'LineString',
        coordinates: [[105.800, 20.900], [105.800, 21.120]]
      }
    }
  ]
};
