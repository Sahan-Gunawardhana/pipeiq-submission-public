"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet-draw/dist/leaflet.draw.css";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { AlertCircle, Loader2 } from "lucide-react";
import {
  savePipelineToFirestore,
  deletePipelineFromFirestore,
  fetchPipelinesFromFirestore,
  saveZoneToFirestore,
  deleteZoneFromFirestore,
  saveMarkerToFirestore,
  deleteMarkerFromFirestore,
  fetchZonesFromFirestore,
  fetchMarkersFromFirestore,
  subscribeToPipelines,
  subscribeToZones,
  subscribeToMarkers,
} from "@/lib/firebase";
import { attemptImmediateScore } from "@/lib/queueProcessor";
import PipelineDataModal, {
  PipelineFormData,
} from "@/components/map/PipelineDataModal";
import ZoneDataModal, { ZoneFormData } from "@/components/map/ZoneDataModal";
import MarkerDataModal, {
  MarkerFormData,
} from "@/components/map/MarkerDataModal";
import MapDock from "@/components/map/MapDock";

const MAP_LAYERS_UPDATE_SOURCE = {
  zoneOwnershipRefresh: "zone-ownership-refresh",
} as const;

const PIPELINE_QUEUE_KEY = "pipeiq-pipeline-queue";
const PIPELINES_CACHE_KEY = "pipeiq-pipelines-cache";
const PIPELINE_QUEUE_MAX = 20;
const RISK_BAND_HEX = {
  Low: "#059669",
  Medium: "#D97706",
  High: "#DC2626",
} as const;

const normalizeBandValue = (value: unknown): "Low" | "Medium" | "High" | null => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "high") return "High";
  if (normalized === "medium" || normalized === "med") return "Medium";
  if (normalized === "low") return "Low";
  return null;
};

const normalizeScore01 = (value: unknown) => {
  const score = Number(value);
  if (!Number.isFinite(score)) return null;
  if (score > 1) return Math.max(0, Math.min(score / 100, 1));
  return Math.max(0, Math.min(score, 1));
};

const getRiskBand = (props: any): "Low" | "Medium" | "High" => {
  const fromBand = normalizeBandValue(
    props?.risk_band || props?.riskBand || props?.riskLevel,
  );
  if (fromBand) return fromBand;

  const score01 = normalizeScore01(props?.risk_score);
  if (Number.isFinite(score01)) {
    if ((score01 as number) >= 0.5) return "High";
    if ((score01 as number) >= 0.27) return "Medium";
    return "Low";
  }

  const score100 = normalizeScore01(props?.riskScore);
  if (Number.isFinite(score100)) {
    if ((score100 as number) >= 0.5) return "High";
    if ((score100 as number) >= 0.27) return "Medium";
  }
  return "Low";
};

const getConfidenceBand = (props: any): "Low" | "Medium" | "High" => {
  const fromBand = normalizeBandValue(
    props?.confidence_band || props?.confidenceBand,
  );
  if (fromBand) return fromBand;

  const score01 = normalizeScore01(props?.confidence_score || props?.confidence);
  if (Number.isFinite(score01)) {
    if ((score01 as number) >= 0.5) return "High";
    if ((score01 as number) >= 0.2) return "Medium";
    return "Low";
  }
  return "Low";
};

const getRiskBandHexColor = (band: "Low" | "Medium" | "High") => {
  return RISK_BAND_HEX[band];
};

const getRiskBandTextClass = (band: "Low" | "Medium" | "High") => {
  if (band === "High") return "text-red-700 dark:text-red-300";
  if (band === "Medium") return "text-amber-700 dark:text-amber-300";
  return "text-emerald-700 dark:text-emerald-300";
};

const getConfidenceBandTextClass = (band: "Low" | "Medium" | "High") => {
  if (band === "High") return "text-blue-800 dark:text-blue-300";
  if (band === "Medium") return "text-violet-800 dark:text-violet-300";
  return "text-slate-700 dark:text-slate-300";
};

const getZoneColorFromBand = (band: string) => {
  return RISK_BAND_HEX[normalizeBandValue(band) || "Low"];
};

const getZoneVisualStyle = (props: any) => {
  const normalizedBand = normalizeBandValue(props?.zoneRiskBand) || "Low";
  const color =
    typeof props?.zoneRiskColor === "string" && props.zoneRiskColor.trim()
      ? props.zoneRiskColor
      : getZoneColorFromBand(normalizedBand);
  const fillOpacity = Number.isFinite(Number(props?.zoneFillOpacity))
    ? Number(props.zoneFillOpacity)
    : 0.11;

  return {
    color,
    fillColor: color,
    fillOpacity,
    opacity: 0.55,
    weight: 2,
  };
};

// Fix for default marker icons using CDN to ensure availability
const fixLeafletIcons = () => {
  delete (L.Icon.Default.prototype as any)._getIconUrl;

  L.Icon.Default.mergeOptions({
    iconRetinaUrl:
      "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
    iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
    shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  });
};

// Call immediately
fixLeafletIcons();

// Custom hook to add persistence logic
// Extend Leaflet types to support our custom properties
declare module "leaflet" {
  interface Layer {
    _originalZoom?: number;
  }
  interface Circle {
    _originalRadius?: number;
  }
  interface Polyline {
    _originalLatLngs?: L.LatLng[] | L.LatLng[][] | L.LatLng[][][];
  }
}

// Helper functions for persistence
/**
 * Convert a Leaflet Circle to a GeoJSON-compatible format
 */
const circleToGeoJSON = (circle: L.Circle) => {
  const center = circle.getLatLng();
  const radiusMeters = circle.getRadius();
  return {
    type: "Point",
    coordinates: [center.lng, center.lat],
  };
};

/**
 * Convert a Leaflet Rectangle to a GeoJSON Polygon
 */
const rectangleToGeoJSON = (rectangle: L.Rectangle) => {
  const bounds = rectangle.getBounds();
  const coords = [
    [bounds.getWest(), bounds.getSouth()],
    [bounds.getEast(), bounds.getSouth()],
    [bounds.getEast(), bounds.getNorth()],
    [bounds.getWest(), bounds.getNorth()],
    [bounds.getWest(), bounds.getSouth()], // Close the polygon
  ];
  return {
    type: "Polygon",
    coordinates: [coords],
  };
};

/**
 * Convert a Leaflet CircleMarker to a GeoJSON-compatible format
 */
const circleMarkerToGeoJSON = (circleMarker: L.CircleMarker) => {
  const center = circleMarker.getLatLng();
  const radius = circleMarker.getRadius();
  return {
    type: "Point",
    coordinates: [center.lng, center.lat],
  };
};

/**
 * Create a Leaflet Circle from GeoJSON Point with radiusMeters metadata
 */
const geoJSONToCircle = (feature: any) => {
  const coords = feature.geometry.coordinates;
  if (!Array.isArray(coords) || coords.length !== 2) return null;

  const radiusMeters = feature.properties?.radiusMeters || 1000;
  const style = getZoneVisualStyle(feature?.properties || {});
  const circle = L.circle([coords[1], coords[0]], {
    radius: radiusMeters,
    ...style,
  });
  circle.feature = feature;
  return circle;
};

/**
 * Create a Leaflet Rectangle from GeoJSON Polygon
 */
const geoJSONToRectangle = (feature: any) => {
  const coords = feature.geometry.coordinates?.[0];
  if (!Array.isArray(coords) || coords.length < 4) return null;

  const bounds = L.latLngBounds([
    [coords[0][1], coords[0][0]],
    [coords[2][1], coords[2][0]],
  ]);

  const style = getZoneVisualStyle(feature?.properties || {});
  const rectangle = L.rectangle(bounds, style);
  rectangle.feature = feature;
  return rectangle;
};

/**
 * Create a Leaflet CircleMarker from GeoJSON Point with radiusPixels metadata
 */
const geoJSONToCircleMarker = (feature: any) => {
  const coords = feature.geometry.coordinates;
  if (!Array.isArray(coords) || coords.length !== 2) return null;

  const radiusPixels = feature.properties?.radiusPixels || 10;
  const circleMarker = L.circleMarker([coords[1], coords[0]], {
    radius: radiusPixels,
    color: "#000000",
    fillColor: "#ffffff",
    fillOpacity: 0.4,
    weight: 2,
  });
  circleMarker.feature = feature;
  return circleMarker;
};

const makeAssetMarkerIcon = () =>
  L.divIcon({
    className: "",
    iconAnchor: [11, 11],
    iconSize: [22, 22],
    html: `
      <div style="
        width:22px;
        height:22px;
        border-radius:11px;
        background:rgba(15,23,42,0.78);
        border:1px solid rgba(255,255,255,0.35);
        display:flex;
        align-items:center;
        justify-content:center;
        box-shadow:0 2px 8px rgba(0,0,0,0.25);
      ">
        <div style="
          width:12px;
          height:12px;
          border-radius:6px;
          background:#ffffff;
          border:3px solid #F59E0B;
          box-sizing:border-box;
        "></div>
      </div>
    `,
  });

const addGeoJsonToLayerGroup = (
  layerGroup: L.FeatureGroup,
  geoJsonData: any,
) => {
  const features = geoJsonData.features || [];

  features.forEach((feature: any) => {
    const leafletType = feature.properties?._leafletType;
    let layer: L.Layer | null = null;

    if (leafletType === "Circle") {
      layer = geoJSONToCircle(feature);
    } else if (leafletType === "Rectangle") {
      layer = geoJSONToRectangle(feature);
    } else if (leafletType === "CircleMarker") {
      // Circle assets are deprecated; ignore legacy CircleMarker entries.
      return;
    } else if (leafletType === "Marker") {
      // Handle standard Marker
      const coords = feature.geometry?.coordinates;
      if (Array.isArray(coords) && coords.length === 2) {
        const marker = L.marker([coords[1], coords[0]], {
          icon: makeAssetMarkerIcon(),
        });
        marker.feature = feature;
        layer = marker;
      }
    } else {
      // Use standard L.geoJSON for regular GeoJSON types.
      // Important: add child layers, not the wrapper L.GeoJSON layer group,
      // so runtime type checks (Polyline/Polygon/Marker) continue to work.
      const geoJsonLayer = L.geoJSON(feature, {
        style: (currentFeature: any) => {
          const props = currentFeature?.properties || feature?.properties || {};
          const geomType =
            currentFeature?.geometry?.type || feature?.geometry?.type;

          if (geomType === "LineString") {
            return {
              color: getRiskBandHexColor(getRiskBand(props)),
              weight: 2,
              opacity: 0.95,
            };
          }

          return getZoneVisualStyle(props);
        },
        pointToLayer: (pointFeature: any, latlng) => {
          const pointType = String(
            pointFeature?.properties?.type || feature?.properties?.type || "",
          ).toLowerCase();

          if (pointType === "marker") {
            return L.marker(latlng, {
              icon: makeAssetMarkerIcon(),
            });
          }

          return L.circleMarker(latlng, {
            radius: 5,
            color: "#000000",
            fillColor: "#ffffff",
            fillOpacity: 0.4,
            weight: 2,
          });
        },
      });

      geoJsonLayer.eachLayer((child: any) => {
        if (!child.feature) {
          child.feature = feature;
        }
        layerGroup.addLayer(child);
      });
      return;
    }

    if (layer) {
      const featureLayer = layer as L.Layer & { feature?: GeoJSON.Feature };
      if (!featureLayer.feature) {
        featureLayer.feature = feature;
      }
      layerGroup.addLayer(layer);
    }
  });
};

const flattenPolylineLatLngs = (layer: L.Polyline): L.LatLng[] => {
  const latlngs = layer.getLatLngs();
  return Array.isArray(latlngs[0])
    ? (latlngs as L.LatLng[][])[0]
    : (latlngs as L.LatLng[]);
};

const getPipelineGeometryKey = (layer: L.Polyline): string | null => {
  const flat = flattenPolylineLatLngs(layer);
  if (!flat || flat.length < 2) return null;
  return flat
    .map((ll) => `${Number(ll.lat).toFixed(5)}_${Number(ll.lng).toFixed(5)}`)
    .join("|");
};

const getPipelineLayerId = (layer: L.Polyline): string | null => {
  const props = (layer as any)?.feature?.properties || {};
  if (typeof props.id === "string" && props.id.length > 0) return props.id;
  if (typeof props.pipelineId === "string" && props.pipelineId.length > 0)
    return props.pipelineId;

  const flat = flattenPolylineLatLngs(layer);
  if (!flat || flat.length < 2) return null;
  return generateStablePipelineId(props, flat[0], flat[flat.length - 1]);
};

const pipelineSourceRank = (source: unknown): number => {
  if (source === "firebase") return 3;
  if (source === "queue") return 2;
  return 1;
};

const dedupePipelineLayers = (layerGroup: L.FeatureGroup): number => {
  const winners = new Map<string, { layer: L.Layer; rank: number }>();
  const toRemove: L.Layer[] = [];

  layerGroup.eachLayer((layer: any) => {
    const isZone =
      layer instanceof L.Polygon ||
      layer instanceof L.Rectangle ||
      layer instanceof L.Circle;
    const isPipe = layer instanceof L.Polyline && !isZone;
    if (!isPipe) return;

    const pipelineLayer = layer as L.Polyline;
    const pipelineFeatureLayer = pipelineLayer as unknown as {
      feature?: GeoJSON.Feature<any, any>;
    };
    const pipelineId = getPipelineLayerId(pipelineLayer);
    const geometryKey = getPipelineGeometryKey(pipelineLayer);
    if (!pipelineId && !geometryKey) return;

    if (pipelineId) {
      pipelineFeatureLayer.feature = pipelineFeatureLayer.feature || {
        type: "Feature",
        geometry: null,
        properties: {},
      };
      pipelineFeatureLayer.feature.properties = {
        ...(pipelineFeatureLayer.feature.properties || {}),
        id: pipelineId,
        pipelineId,
      };
    }

    const dedupeKey = pipelineId ? `id:${pipelineId}` : `geom:${geometryKey}`;
    const source = pipelineLayer?.feature?.properties?.source;
    const rank = pipelineSourceRank(source);
    const existing = winners.get(dedupeKey);

    if (!existing) {
      winners.set(dedupeKey, { layer: pipelineLayer, rank });
      return;
    }

    if (rank > existing.rank) {
      toRemove.push(existing.layer);
      winners.set(dedupeKey, { layer: pipelineLayer, rank });
    } else {
      toRemove.push(pipelineLayer);
    }
  });

  const uniqueToRemove = Array.from(new Set(toRemove));
  uniqueToRemove.forEach((layer) => layerGroup.removeLayer(layer));
  return uniqueToRemove.length;
};

const loadSavedLayers = (layerGroup: L.FeatureGroup) => {
  try {
    const savedData = localStorage.getItem("pipeiq-map-layers");
    if (savedData) {
      const geoJsonData = JSON.parse(savedData);
      const features = Array.isArray(geoJsonData?.features)
        ? geoJsonData.features
        : [];

      // Do not hydrate markers from local storage.
      // Markers must come from Firestore only.
      const nonPipelineNonMarkerFeatures = features.filter((feature: any) => {
        const geometryType = feature?.geometry?.type;
        const leafletType = feature?.properties?._leafletType;
        const isPipeline = geometryType === "LineString";
        const isMarker =
          leafletType === "Marker" || leafletType === "CircleMarker";
        return !isPipeline && !isMarker;
      });

      if (nonPipelineNonMarkerFeatures.length > 0) {
        addGeoJsonToLayerGroup(layerGroup, {
          type: "FeatureCollection",
          features: nonPipelineNonMarkerFeatures,
        });
      }
    }
  } catch (error) {
    console.error("Failed to load map layers:", error);
  }
};

const loadSavedPipelinesFromFirebase = async (layerGroup: L.FeatureGroup) => {
  try {
    console.log("[Map] loadSavedPipelinesFromFirebase called");
    const pipelines = await fetchPipelinesFromFirestore();
    console.log("[Map] Fetched pipelines from Firestore:", pipelines);

    const features = pipelines
      .map((item: any) => {
        let geometry = item?.geometry;

        if (
          !geometry &&
          item?.endpointAnchors?.start &&
          item?.endpointAnchors?.end
        ) {
          const start = item.endpointAnchors.start;
          const end = item.endpointAnchors.end;
          geometry = {
            type: "LineString",
            coordinates: [
              [start[1], start[0]],
              [end[1], end[0]],
            ],
          };
        }

        if (!geometry || geometry.type !== "LineString") return null;

        return {
          type: "Feature",
          geometry,
          properties: {
            ...item,
            id: item.id || item.pipelineId,
            source: "firebase",
            predictionStatus: "complete",
          },
        };
      })
      .filter(Boolean);

    console.log("[Map] Processed features:", features);
    if (features.length > 0) {
      console.log("[Map] Adding", features.length, "features to layer group");
      addGeoJsonToLayerGroup(layerGroup, {
        type: "FeatureCollection",
        features,
      });
      dedupePipelineLayers(layerGroup);
    } else {
      console.log("[Map] No features to add to layer group");
    }

    // Cache hydrated pipeline features for instant next reload.
    localStorage.setItem(
      PIPELINES_CACHE_KEY,
      JSON.stringify({
        fetchedAt: Date.now(),
        features,
      }),
    );
  } catch (error) {
    console.error("[Map] Failed to load saved pipelines from Firebase:", error);
  }
};

const loadCachedPipelines = (layerGroup: L.FeatureGroup) => {
  try {
    const raw = localStorage.getItem(PIPELINES_CACHE_KEY);
    if (!raw) return;

    const parsed = JSON.parse(raw);
    const features = Array.isArray(parsed?.features) ? parsed.features : [];
    if (features.length === 0) return;

    addGeoJsonToLayerGroup(layerGroup, {
      type: "FeatureCollection",
      features,
    });
  } catch (error) {
    console.error("[Map] Failed to load cached pipelines:", error);
  }
};

const loadSavedZonesFromFirebase = async (layerGroup: L.FeatureGroup) => {
  try {
    console.log("[Map] loadSavedZonesFromFirebase called");
    const zones = await fetchZonesFromFirestore();
    console.log("[Map] Fetched zones from Firestore:", zones);

    const features = zones
      .map((item: any) => {
        const geometry = item?.geometry;
        if (!geometry) return null;

        return {
          type: "Feature",
          geometry,
          properties: {
            ...item,
            id: item.id,
            source: "firebase",
            type: "zone",
          },
        };
      })
      .filter(Boolean);

    console.log("[Map] Processed zone features:", features);
    if (features.length > 0) {
      const incomingZoneIds = new Set(
        features
          .map((feature: any) => feature?.properties?.id)
          .filter((id: any) => typeof id === "string" && id.length > 0),
      );

      // Replace any existing zone with the same ID (local or firebase)
      // so only one zone is shown after Firebase persistence.
      const staleZones: L.Layer[] = [];
      layerGroup.eachLayer((layer: any) => {
        const isZone =
          layer instanceof L.Polygon ||
          layer instanceof L.Rectangle ||
          layer instanceof L.Circle;
        if (!isZone) return;

        const existingId = layer?.feature?.properties?.id;
        if (existingId && incomingZoneIds.has(existingId)) {
          staleZones.push(layer);
        }
      });
      staleZones.forEach((layer) => layerGroup.removeLayer(layer));

      console.log(
        "[Map] Adding",
        features.length,
        "zone features to layer group",
      );
      addGeoJsonToLayerGroup(layerGroup, {
        type: "FeatureCollection",
        features,
      });
    }
  } catch (error) {
    console.error("[Map] Failed to load saved zones from Firebase:", error);
  }
};

const loadSavedMarkersFromFirebase = async (layerGroup: L.FeatureGroup) => {
  try {
    console.log("[Map] loadSavedMarkersFromFirebase called");
    const markers = await fetchMarkersFromFirestore();
    console.log("[Map] Fetched markers from Firestore:", markers);

    const features = markers
      .map((item: any) => {
        const coordinates = item?.coordinates;
        if (
          !coordinates ||
          !Array.isArray(coordinates) ||
          coordinates.length !== 2
        )
          return null;

        return {
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates,
          },
          properties: {
            ...item,
            id: item.id,
            source: "firebase",
            type: "marker",
            _leafletType: "Marker",
          },
        };
      })
      .filter(Boolean);

    console.log("[Map] Processed marker features:", features);
    if (features.length > 0) {
      const incomingMarkerIds = new Set(
        features
          .map(
            (feature: any) =>
              feature?.properties?.id || feature?.properties?.markerId,
          )
          .filter((id: any) => typeof id === "string" && id.length > 0),
      );
      const incomingCoordKeys = new Set(
        features
          .map((feature: any) => {
            const coords = feature?.geometry?.coordinates;
            if (!Array.isArray(coords) || coords.length !== 2) return null;
            return `${Number(coords[1]).toFixed(5)}_${Number(coords[0]).toFixed(5)}`;
          })
          .filter((key: any) => typeof key === "string" && key.length > 0),
      );

      // Remove existing marker/circle-marker layers that match incoming IDs/positions
      // so each marker appears once and delete mode targets a single layer per marker.
      const staleMarkers: L.Layer[] = [];
      layerGroup.eachLayer((layer: any) => {
        const isMarker =
          layer instanceof L.Marker || layer instanceof L.CircleMarker;
        if (!isMarker) return;

        const existingId =
          layer?.feature?.properties?.id ||
          layer?.feature?.properties?.markerId;
        const ll = layer.getLatLng?.();
        const coordKey = ll
          ? `${Number(ll.lat).toFixed(5)}_${Number(ll.lng).toFixed(5)}`
          : null;

        if (
          (existingId && incomingMarkerIds.has(existingId)) ||
          (coordKey && incomingCoordKeys.has(coordKey))
        ) {
          staleMarkers.push(layer);
        }
      });
      staleMarkers.forEach((layer) => layerGroup.removeLayer(layer));

      console.log(
        "[Map] Adding",
        features.length,
        "marker features to layer group",
      );
      addGeoJsonToLayerGroup(layerGroup, {
        type: "FeatureCollection",
        features,
      });
    }
  } catch (error) {
    console.error("[Map] Failed to load saved markers from Firebase:", error);
  }
};

type FirebaseLayerKind = "pipeline" | "zone" | "marker";

const removeFirebaseLayersByKind = (
  layerGroup: L.FeatureGroup,
  kind: FirebaseLayerKind,
) => {
  const toRemove: L.Layer[] = [];
  layerGroup.eachLayer((layer: any) => {
    const props = layer?.feature?.properties || {};
    if (props.source !== "firebase") return;

    const isZone =
      layer instanceof L.Polygon ||
      layer instanceof L.Rectangle ||
      layer instanceof L.Circle;
    const isPipe = layer instanceof L.Polyline && !isZone;
    const isMarker =
      layer instanceof L.Marker || layer instanceof L.CircleMarker;

    if (
      (kind === "pipeline" && isPipe) ||
      (kind === "zone" && isZone) ||
      (kind === "marker" && isMarker)
    ) {
      toRemove.push(layer);
    }
  });
  toRemove.forEach((layer) => layerGroup.removeLayer(layer));
};

const removeQueuedPipelineLayers = (layerGroup: L.FeatureGroup) => {
  const toRemove: L.Layer[] = [];
  layerGroup.eachLayer((layer: any) => {
    const props = layer?.feature?.properties || {};
    const isZone =
      layer instanceof L.Polygon ||
      layer instanceof L.Rectangle ||
      layer instanceof L.Circle;
    const isPipe = layer instanceof L.Polyline && !isZone;
    if (isPipe && props.source === "queue") {
      toRemove.push(layer);
    }
  });
  toRemove.forEach((layer) => layerGroup.removeLayer(layer));
};

const removeAllMarkerLayers = (layerGroup: L.FeatureGroup) => {
  const toRemove: L.Layer[] = [];
  layerGroup.eachLayer((layer: any) => {
    const isMarker =
      layer instanceof L.Marker || layer instanceof L.CircleMarker;
    if (isMarker) toRemove.push(layer);
  });
  toRemove.forEach((layer) => layerGroup.removeLayer(layer));
};

const loadQueuedPipelinesFromLocalQueue = (layerGroup: L.FeatureGroup) => {
  try {
    const queue = JSON.parse(
      localStorage.getItem(PIPELINE_QUEUE_KEY) || "[]",
    ) as any[];
    const features = queue
      .map((item: any) => {
        const geometry = item?.geometry;
        if (!geometry || geometry.type !== "LineString") return null;

        return {
          type: "Feature",
          geometry,
          properties: {
            ...item,
            id: item?.id || item?.pipelineId,
            source: "queue",
            predictionStatus: item?.predictionStatus || "pending",
          },
        };
      })
      .filter(Boolean);

    if (features.length > 0) {
      addGeoJsonToLayerGroup(layerGroup, {
        type: "FeatureCollection",
        features,
      });
    }
  } catch (error) {
    console.error("Failed to load queued pipelines from local queue:", error);
  }
};

const saveLayers = (layerGroup: L.FeatureGroup) => {
  try {
    // Zones and markers should not be persisted in localStorage.
    // Keep map layer storage empty and rely on queue + Firebase as sources of truth.
    localStorage.setItem(
      "pipeiq-map-layers",
      JSON.stringify({
        type: "FeatureCollection",
        features: [],
      }),
    );
    window.dispatchEvent(new Event("pipeiq_map_layers_updated"));
  } catch (error) {
    console.error("Failed to save map layers:", error);
  }
};

const generateStablePipelineId = (
  props: any,
  startLL: L.LatLng,
  endLL: L.LatLng,
) => {
  if (props?.id) return props.id;
  if (props?.pipelineId) return props.pipelineId;
  const start = `${startLL.lat.toFixed(5)}_${startLL.lng.toFixed(5)}`;
  const end = `${endLL.lat.toFixed(5)}_${endLL.lng.toFixed(5)}`;
  const material = props?.material || "NA";
  const year = props?.installationYear || "NA";
  return `PL-${start}-${end}-${material}-${year}`;
};

const getPipelineStartLatLng = (layer: any) => {
  const props = layer?.feature?.properties || {};
  if (Array.isArray(props?.endpointAnchors?.start)) {
    const [lat, lng] = props.endpointAnchors.start;
    if (Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
      return L.latLng(Number(lat), Number(lng));
    }
  }

  const latlngs = layer?.getLatLngs?.();
  if (!latlngs) return null;
  const flat = Array.isArray(latlngs[0])
    ? (latlngs as L.LatLng[][])[0]
    : (latlngs as L.LatLng[]);
  return flat?.[0] || null;
};

const flattenZoneRing = (latlngs: any): L.LatLng[] => {
  if (!latlngs) return [];
  const first = Array.isArray(latlngs?.[0]) ? latlngs[0] : latlngs;
  if (!Array.isArray(first)) return [];
  return first as L.LatLng[];
};

const pointInPolygon = (point: L.LatLng, ring: L.LatLng[]) => {
  if (ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].lng;
    const yi = ring[i].lat;
    const xj = ring[j].lng;
    const yj = ring[j].lat;

    const intersect =
      yi > point.lat !== yj > point.lat &&
      point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi || 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
};

const getZoneAreaApprox = (layer: any) => {
  if (layer instanceof L.Circle) {
    const radius = layer.getRadius();
    return Math.PI * radius * radius;
  }
  const bounds = layer?.getBounds?.();
  if (!bounds) return Number.POSITIVE_INFINITY;
  const latSpan = Math.abs(bounds.getNorth() - bounds.getSouth());
  const lngSpan = Math.abs(bounds.getEast() - bounds.getWest());
  return latSpan * lngSpan;
};

const zoneContainsPoint = (zoneLayer: any, point: L.LatLng) => {
  if (!zoneLayer || !point) return false;
  if (zoneLayer instanceof L.Circle) {
    return zoneLayer.getLatLng().distanceTo(point) <= zoneLayer.getRadius();
  }
  if (zoneLayer instanceof L.Rectangle) {
    return zoneLayer.getBounds().contains(point);
  }
  if (zoneLayer instanceof L.Polygon) {
    return pointInPolygon(point, flattenZoneRing(zoneLayer.getLatLngs()));
  }
  return false;
};

const normalizeRiskScore = (props: any) => {
  const direct100 = normalizeScore01(props?.riskScore);
  if (Number.isFinite(direct100)) {
    return Math.round((direct100 as number) * 100);
  }

  const from01 = normalizeScore01(props?.risk_score);
  if (Number.isFinite(from01)) return Math.round((from01 as number) * 100);

  const band = normalizeBandValue(props?.risk_band || props?.riskLevel);
  if (band === "High") return 84;
  if (band === "Medium") return 50;
  if (band === "Low") return 16;
  return null;
};

const isHighRiskPipeline = (props: any) => {
  return getRiskBand(props) === "High";
};

const getPipelineAgeYears = (props: any) => {
  const installYear = Number(props?.installationYear);
  if (!Number.isFinite(installYear) || installYear <= 0) return null;
  const age = new Date().getFullYear() - installYear;
  if (!Number.isFinite(age) || age < 0 || age > 300) return null;
  return age;
};

const getZoneBandFromScore = (
  score: number,
): { band: "Low" | "Medium" | "High"; color: string; fillOpacity: number } => {
  if (score >= 75) {
    return { band: "High", color: "#DC2626", fillOpacity: 0.18 };
  }
  if (score >= 40) {
    return { band: "Medium", color: "#D97706", fillOpacity: 0.14 };
  }
  return { band: "Low", color: "#059669", fillOpacity: 0.11 };
};

const findOwningZoneLayer = (zoneLayers: any[], point: L.LatLng | null) => {
  if (!point) return null;
  const matches = zoneLayers.filter((zoneLayer) =>
    zoneContainsPoint(zoneLayer, point),
  );
  if (matches.length === 0) return null;
  return matches.sort((a, b) => getZoneAreaApprox(a) - getZoneAreaApprox(b))[0];
};

const MapValues = ({
  isEditorMode,
  showPipelines,
  showZones,
  showAssets,
  riskFilter,
  confidenceFilter,
  onPendingCountChange,
  onPipelineSelect,
}: {
  isEditorMode: boolean;
  showPipelines: boolean;
  showZones: boolean;
  showAssets: boolean;
  riskFilter: "all" | "low" | "medium" | "high";
  confidenceFilter: "all" | "low" | "medium" | "high";
  onPendingCountChange?: (count: number) => void;
  onPipelineSelect?: (pipelineId: string) => void;
}) => {
  const map = useMap();
  const [mapReady, setMapReady] = useState<boolean>(
    (map as any)?._loaded ?? false,
  );
  const [displayFg, setDisplayFg] = useState<L.FeatureGroup | null>(null);
  const allLayersRef = useRef<L.FeatureGroup>(new L.FeatureGroup());
  const editableFgRef = useRef<L.FeatureGroup>(new L.FeatureGroup());
  const deletableFgRef = useRef<L.FeatureGroup>(new L.FeatureGroup());
  const labelFgRef = useRef<L.FeatureGroup>(new L.FeatureGroup());
  const drawPluginReadyRef = useRef(false);
  const drawPluginPromiseRef = useRef<Promise<void> | null>(null);
  const isMapInitializedRef = useRef(false);
  const [pendingPipelineLayer, setPendingPipelineLayer] =
    useState<L.Polyline | null>(null);
  const [pendingZoneLayer, setPendingZoneLayer] = useState<any | null>(null);
  const [pendingMarkerLayer, setPendingMarkerLayer] = useState<
    L.Marker | L.CircleMarker | null
  >(null);
  useEffect(() => {
    if ((map as any)?._loaded) {
      setMapReady(true);
      return;
    }
    map.whenReady(() => setMapReady(true));
  }, [map]);
  const [pendingCount, setPendingCount] = useState(0);
  const [deleteConfirmLayers, setDeleteConfirmLayers] = useState<any[] | null>(
    null,
  );
  const [isConfirmDeleting, setIsConfirmDeleting] = useState(false);
  const [isDeleteModeActive, setIsDeleteModeActive] = useState(false);
  const isDeleteModeActiveRef = useRef(false);
  const isEditModeActiveRef = useRef(false);
  const isRefreshingZoneOwnershipRef = useRef(false);
  const persistenceTimeoutIdRef = useRef<NodeJS.Timeout | null>(null);
  const hiddenQueueLayersDuringEditRef = useRef<L.Layer[]>([]);

  const isDeleteToolbarActive = () => {
    if (typeof document === "undefined") return false;
    return !!document.querySelector(
      ".leaflet-draw-edit-remove.leaflet-draw-toolbar-button-enabled",
    );
  };

  const isEditToolbarActive = () => {
    if (typeof document === "undefined") return false;
    return !!document.querySelector(
      ".leaflet-draw-edit-edit.leaflet-draw-toolbar-button-enabled",
    );
  };

  const getQueue = () =>
    JSON.parse(localStorage.getItem(PIPELINE_QUEUE_KEY) || "[]") as any[];
  const removeQueueItem = (id: string) => {
    const existing = getQueue();
    localStorage.setItem(
      PIPELINE_QUEUE_KEY,
      JSON.stringify(existing.filter((entry) => entry?.id !== id)),
    );
    window.dispatchEvent(new Event("pipeiq_queue_updated"));
  };

  // Helper: compact endpoint chip (kept intentionally minimal to avoid map clutter)
  const makeEndpointIcon = (
    label: string,
    type: "start" | "end",
    fullLabel: string,
  ) => {
    const accent = type === "start" ? "#10b981" : "#ef4444";
    return L.divIcon({
      className: "",
      iconAnchor: [12, 10],
      iconSize: [24, 20],
      html: `
                <div style="
                    padding:2px 6px;
                    border-radius:999px;
                    background:rgba(15,23,42,0.78);
                    border:1px solid rgba(255,255,255,0.22);
                    box-shadow:0 1px 6px rgba(0,0,0,0.22);
                    display:inline-flex;align-items:center;justify-content:center;gap:4px;
                    pointer-events:none;
                    max-width:110px;
                    white-space:nowrap;
                ">
                    <span style="
                        width:6px;height:6px;border-radius:50%;
                        background:${accent};
                        flex:0 0 auto;
                    "></span>
                    <span style="
                        color:white;
                        font-size:9px;
                        font-weight:700;
                        font-family:system-ui,sans-serif;
                        letter-spacing:0;
                        line-height:1;
                        overflow:hidden;
                        text-overflow:ellipsis;
                    " title="${fullLabel}">${label}</span>
                </div>
            `,
    });
  };

  const compactEndpointLabel = (value: string) => {
    const normalized = value.trim().replace(/\s+/g, " ");
    if (normalized.length <= 12) return normalized;
    return `${normalized.slice(0, 12)}…`;
  };

  const pipelineMatchesBandFilters = useCallback(
    (props: any) => {
      const riskBand = getRiskBand(props).toLowerCase();
      const confidenceBand = getConfidenceBand(props).toLowerCase();
      const riskOk = riskFilter === "all" || riskBand === riskFilter;
      const confidenceOk =
        confidenceFilter === "all" || confidenceBand === confidenceFilter;
      return riskOk && confidenceOk;
    },
    [riskFilter, confidenceFilter],
  );

  const ensureLeafletDrawLoaded = useCallback(async () => {
    if (drawPluginReadyRef.current) return;
    if (!drawPluginPromiseRef.current) {
      drawPluginPromiseRef.current = (async () => {
        if (typeof window !== "undefined") {
          (window as any).L = L;
        }
        await import("leaflet-draw");
        drawPluginReadyRef.current = true;
      })();
    }
    await drawPluginPromiseRef.current;
  }, []);

  const refreshZoneOwnershipAndStyles = useCallback(
    async (options?: { persistToFirebase?: boolean }) => {
      const persistToFirebase = options?.persistToFirebase !== false;
      if (isRefreshingZoneOwnershipRef.current) return;
      isRefreshingZoneOwnershipRef.current = true;

      try {
        const allLayers = allLayersRef.current;
        if (!allLayers) return;

        const zoneLayers: any[] = [];
        const pipelineLayers: any[] = [];
        const markerLayers: any[] = [];

        allLayers.eachLayer((layer: any) => {
          const isZone =
            layer instanceof L.Polygon ||
            layer instanceof L.Rectangle ||
            layer instanceof L.Circle;
          const isPipe = layer instanceof L.Polyline && !isZone;
          const isMarker =
            layer instanceof L.Marker || layer instanceof L.CircleMarker;
          if (isZone) zoneLayers.push(layer);
          if (isPipe) pipelineLayers.push(layer);
          if (isMarker) markerLayers.push(layer);
        });

        const queue = getQueue();
        const queueById = new Map<string, any>();
        queue.forEach((item) => {
          const id = item?.id || item?.pipelineId;
          if (id) queueById.set(String(id), item);
        });

        const persistPipelineUpdates: Promise<any>[] = [];
        const persistZoneUpdates: Promise<any>[] = [];
        let queueChanged = false;
        let ownershipMutated = false;

        pipelineLayers.forEach((layer) => {
          const props = (layer as any).feature?.properties || {};
          const startLL = getPipelineStartLatLng(layer);
          const owningZone = findOwningZoneLayer(zoneLayers, startLL);
          const owningZoneProps = owningZone?.feature?.properties || null;
          const nextZoneId = owningZoneProps?.id || undefined;
          const nextZoneName = owningZoneProps?.zoneName || undefined;
          const nextZoneBand = owningZoneProps?.zoneRiskBand || undefined;
          const nextZoneScore = Number.isFinite(
            Number(owningZoneProps?.zoneRiskScore),
          )
            ? Number(owningZoneProps.zoneRiskScore)
            : undefined;

          const nextProps = {
            ...props,
            zoneId: nextZoneId,
            zoneName: nextZoneName,
            zoneRiskBand: nextZoneBand,
            zoneRiskScore: nextZoneScore,
          };

          const changed =
            props.zoneId !== nextZoneId ||
            props.zoneName !== nextZoneName ||
            props.zoneRiskBand !== nextZoneBand ||
            props.zoneRiskScore !== nextZoneScore;

          if (changed) {
            ownershipMutated = true;
            layer.feature = layer.feature || {
              type: "Feature",
              properties: {},
            };
            layer.feature.properties = nextProps;

            const pipelineId = String(
              nextProps.id || nextProps.pipelineId || "",
            );
            const queueItem = pipelineId ? queueById.get(pipelineId) : null;
            if (queueItem) {
              queueById.set(pipelineId, {
                ...queueItem,
                ...nextProps,
              });
              queueChanged = true;
            }

            if (
              persistToFirebase &&
              (nextProps.source === "firebase" ||
                nextProps.predictionStatus === "complete")
            ) {
              persistPipelineUpdates.push(
                savePipelineToFirestore({
                  ...nextProps,
                  source: nextProps.source || "firebase",
                  geometry: nextProps.geometry || layer.toGeoJSON?.()?.geometry,
                }),
              );
            }
          }
        });

        markerLayers.forEach((layer) => {
          const props = (layer as any).feature?.properties || {};
          const point = layer?.getLatLng?.();
          const owningZone = findOwningZoneLayer(zoneLayers, point || null);
          const owningZoneProps = owningZone?.feature?.properties || null;
          const nextZoneId = owningZoneProps?.id || undefined;
          const nextZoneName = owningZoneProps?.zoneName || undefined;

          const changed =
            props.zoneId !== nextZoneId || props.zoneName !== nextZoneName;
          if (!changed) return;

          ownershipMutated = true;
          const nextProps = {
            ...props,
            zoneId: nextZoneId,
            zoneName: nextZoneName,
          };
          layer.feature = layer.feature || { type: "Feature", properties: {} };
          layer.feature.properties = nextProps;

          if (persistToFirebase && nextProps.source === "firebase") {
            persistZoneUpdates.push(
              saveMarkerToFirestore({
                ...nextProps,
                id: nextProps.id || nextProps.markerId,
                markerId: nextProps.id || nextProps.markerId,
                coordinates:
                  nextProps.coordinates ||
                  (point ? [point.lng, point.lat] : undefined),
                source: "firebase",
              }),
            );
          }
        });

        zoneLayers.forEach((layer) => {
          const props = (layer as any).feature?.properties || {};
          const zoneId = props.id;
          if (!zoneId) return;
          const zoneIdStr = String(zoneId);

          const ownedPipelines = pipelineLayers.filter((pipelineLayer) => {
            const pipelineProps = pipelineLayer?.feature?.properties || {};
            return String(pipelineProps.zoneId || "") === zoneIdStr;
          });
          const ownedAssets = markerLayers.filter((markerLayer) => {
            const markerPoint = markerLayer?.getLatLng?.();
            if (!markerPoint) return false;

            const owningZone = findOwningZoneLayer(zoneLayers, markerPoint);
            const markerZoneId = owningZone?.feature?.properties?.id;
            return String(markerZoneId || "") === zoneIdStr;
          });

          const highRiskCount = ownedPipelines.filter((pipelineLayer) =>
            isHighRiskPipeline(pipelineLayer?.feature?.properties || {}),
          ).length;
          const riskScores = ownedPipelines
            .map((pipelineLayer) =>
              normalizeRiskScore(pipelineLayer?.feature?.properties || {}),
            )
            .filter((score): score is number =>
              Number.isFinite(Number(score)),
            );
          const avgRisk =
            riskScores.length > 0
              ? Math.round(
                  riskScores.reduce((sum, score) => sum + score, 0) /
                    riskScores.length,
                )
              : 0;
          const { band, color, fillOpacity } = getZoneBandFromScore(avgRisk);
          const ages = ownedPipelines
            .map((pipelineLayer) =>
              getPipelineAgeYears(pipelineLayer?.feature?.properties || {}),
            )
            .filter((age): age is number => Number.isFinite(Number(age)));
          const avgAge =
            ages.length > 0
              ? Math.round(
                  ages.reduce((sum, age) => sum + age, 0) / ages.length,
                )
              : undefined;
          const ownedIds = ownedPipelines
            .map(
              (pipelineLayer) =>
                pipelineLayer?.feature?.properties?.id ||
                pipelineLayer?.feature?.properties?.pipelineId,
            )
            .filter(
              (id): id is string => typeof id === "string" && id.length > 0,
            );

          const nextZoneProps = {
            ...props,
            ownedPipelineIds: ownedIds,
            ownedPipelineCount: ownedIds.length,
            ownedAssetCount: ownedAssets.length,
            highRiskPipes: highRiskCount,
            avgRisk,
            avgAge,
            zoneRiskScore: avgRisk,
            zoneRiskBand: band,
            zoneRiskColor: color,
            zoneFillOpacity: fillOpacity,
          };

          const changed =
            props.zoneRiskScore !== avgRisk ||
            props.highRiskPipes !== highRiskCount ||
            props.avgRisk !== avgRisk ||
            props.avgAge !== avgAge ||
            props.ownedAssetCount !== ownedAssets.length ||
            props.zoneRiskBand !== band ||
            props.zoneFillOpacity !== fillOpacity ||
            JSON.stringify(props.ownedPipelineIds || []) !==
              JSON.stringify(ownedIds);

          layer.feature = layer.feature || { type: "Feature", properties: {} };
          layer.feature.properties = nextZoneProps;
          if (layer.setStyle) {
            layer.setStyle({
              color,
              fillColor: color,
              fillOpacity,
              opacity: 0.55,
              weight: 2,
            });
          }

          if (changed) {
            ownershipMutated = true;
            if (persistToFirebase) {
              persistZoneUpdates.push(
                saveZoneToFirestore({
                  ...nextZoneProps,
                  geometry:
                    layer.feature?.geometry || layer.toGeoJSON?.()?.geometry,
                  type: "zone",
                  source: nextZoneProps.source || "firebase",
                }),
              );
            }
          }
        });

        if (queueChanged) {
          localStorage.setItem(
            PIPELINE_QUEUE_KEY,
            JSON.stringify(Array.from(queueById.values())),
          );
          localStorage.setItem(
            "pipeiq_pending_count",
            String(
              Array.from(queueById.values()).filter(
                (item) =>
                  item?.status !== "scored" &&
                  item?.predictionStatus !== "complete",
              ).length,
            ),
          );
          window.dispatchEvent(new Event("pipeiq_queue_updated"));
          window.dispatchEvent(new Event("pipeiq_pending_updated"));
        }

        if (persistToFirebase && persistPipelineUpdates.length > 0) {
          await Promise.allSettled(persistPipelineUpdates);
        }
        if (persistToFirebase && persistZoneUpdates.length > 0) {
          await Promise.allSettled(persistZoneUpdates);
        }

        if (displayFg) syncVisibleLayers(displayFg);
        if (ownershipMutated || queueChanged) {
          window.dispatchEvent(
            new CustomEvent("pipeiq_map_layers_updated", {
              detail: {
                source: MAP_LAYERS_UPDATE_SOURCE.zoneOwnershipRefresh,
              },
            }),
          );
        }
      } finally {
        isRefreshingZoneOwnershipRef.current = false;
      }
    },
    [displayFg],
  );

  const syncEditableLayers = useCallback(() => {
    const editableFg = editableFgRef.current;
    const allLayers = allLayersRef.current;

    if (!editableFg || !allLayers || !isMapInitializedRef.current) return;

    try {
      editableFg.clearLayers();

      allLayers.eachLayer((layer: any) => {
        const isZone =
          layer instanceof L.Polygon ||
          layer instanceof L.Rectangle ||
          layer instanceof L.Circle;
        const isPipe = layer instanceof L.Polyline && !isZone;
        const isMarker =
          layer instanceof L.Marker || layer instanceof L.CircleMarker;
        const source = layer?.feature?.properties?.source;

        if (
          (isZone && showZones) ||
          (isPipe &&
            showPipelines &&
            source !== "queue" &&
            pipelineMatchesBandFilters(layer?.feature?.properties || {})) ||
          (isMarker && showAssets && source === "firebase")
        ) {
          editableFg.addLayer(layer);
        }
      });
    } catch (error) {
      // Silently ignore errors during sync
    }
  }, [showPipelines, showZones, showAssets, pipelineMatchesBandFilters]);

  const syncDeletableLayers = useCallback(() => {
    const deletableFg = deletableFgRef.current;
    const allLayers = allLayersRef.current;

    if (!deletableFg || !allLayers || !isMapInitializedRef.current) return;

    try {
      deletableFg.clearLayers();

      const desiredZones: L.Layer[] = [];
      const desiredPipes: L.Layer[] = [];
      const desiredMarkers: L.Layer[] = [];

      allLayers.eachLayer((layer: any) => {
        const isZone =
          layer instanceof L.Polygon ||
          layer instanceof L.Rectangle ||
          layer instanceof L.Circle;
        const isPipe = layer instanceof L.Polyline && !isZone;
        const isMarker =
          layer instanceof L.Marker || layer instanceof L.CircleMarker;

        if (
          (isZone && showZones) ||
          (isPipe &&
            showPipelines &&
            pipelineMatchesBandFilters(layer?.feature?.properties || {})) ||
          (isMarker && showAssets)
        ) {
          if (isZone) desiredZones.push(layer);
          else if (isPipe) desiredPipes.push(layer);
          else if (isMarker) desiredMarkers.push(layer);
        }
      });

      // Ordering matters for hit-testing in delete mode.
      // Put zones at the bottom so overlapping pipelines remain selectable.
      desiredZones.forEach((layer) => deletableFg.addLayer(layer));
      desiredPipes.forEach((layer) => deletableFg.addLayer(layer));
      desiredMarkers.forEach((layer) => deletableFg.addLayer(layer));

      desiredZones.forEach((layer: any) => layer.bringToBack?.());
      desiredPipes.forEach((layer: any) => layer.bringToFront?.());
    } catch (error) {
      // Silently ignore errors during sync
    }
  }, [showPipelines, showZones, showAssets, pipelineMatchesBandFilters]);

  const syncVisibleLayers = useCallback(
    (fg: L.FeatureGroup) => {
      if (!fg) return;
      let pending = 0;

      // Determine which layers SHOULD be visible
      const desiredZones: L.Layer[] = [];
      const desiredPipes: L.Layer[] = [];
      const desiredMarkers: L.Layer[] = [];

      allLayersRef.current.eachLayer((layer) => {
        const isZone =
          layer instanceof L.Polygon ||
          layer instanceof L.Rectangle ||
          layer instanceof L.Circle;
        const isPipe = layer instanceof L.Polyline && !isZone;
        const isMarker =
          layer instanceof L.Marker || layer instanceof L.CircleMarker;

        // Bind Pipeline Tooltip
        if (
          isPipe &&
          (layer as any).feature &&
          (layer as any).feature.properties
        ) {
          const props = (layer as any).feature.properties;
          if (props.source === "queue" || props.predictionStatus === "pending")
            pending++;

          // Queue pipelines are visible but read-only until they are persisted to Firebase.
          if (layer.setStyle) {
            const existingVisualLayers = (layer as any)._visualLayers as
              | L.Polyline[]
              | undefined;
            if (existingVisualLayers?.length) {
              existingVisualLayers.forEach((visualLayer) =>
                fg.removeLayer(visualLayer),
              );
              (layer as any)._visualLayers = [];
            }

            if (props.source === "queue") {
              layer.setStyle({
                color: "#475569",
                weight: 2,
                dashArray: "6 8",
                opacity: 0.95,
                lineCap: "round",
              });
            } else {
              const riskBand = getRiskBand(props);
              layer.setStyle({
                color: getRiskBandHexColor(riskBand),
                weight: 3,
                dashArray: undefined,
                opacity: 0.95,
                lineCap: "round",
                lineJoin: "round",
              });
            }
          }

          const latlngs = (layer as L.Polyline).getLatLngs();
          const flat = Array.isArray(latlngs[0])
            ? (latlngs as L.LatLng[][])[0]
            : (latlngs as L.LatLng[]);
          const startLL = flat[0];
          const endLL = flat[flat.length - 1];
          const pipelineId = generateStablePipelineId(props, startLL, endLL);
          if (!props.id) {
            props.id = pipelineId;
            (layer as any).feature.properties = props;
          }

          const isQueuedReadonly = props.source === "queue";
          const statusColor = isQueuedReadonly
            ? "text-amber-600 dark:text-amber-400"
            : props.predictionStatus === "pending"
              ? "text-amber-600 dark:text-amber-400"
              : "text-slate-800 dark:text-slate-200";
          const statusText = isQueuedReadonly
            ? "Queued (Read-only)"
            : props.predictionStatus === "pending"
              ? "Analyzing..."
              : "Logged";
          const riskBand = getRiskBand(props);
          const confidenceBand = getConfidenceBand(props);
          const riskColor = getRiskBandTextClass(riskBand);
          const confidenceColor = getConfidenceBandTextClass(confidenceBand);
          const confidenceLevel =
            confidenceBand === "High" ? 3 : confidenceBand === "Medium" ? 2 : 1;
          const age = props.installationYear
            ? new Date().getFullYear() - Number(props.installationYear)
            : "Unknown";
          const tooltipHtml = `
                    <div class="px-3 py-2.5 bg-white/70 dark:bg-slate-900/80 backdrop-blur-xl rounded-xl shadow-lg border border-white/50 dark:border-white/10 min-w-[170px]">
                        <div class="text-xs font-bold text-slate-800 dark:text-white tracking-tight mb-2">Underground Pipeline</div>
                        <div class="space-y-1.5 text-[11px]">
                            <div class="flex justify-between items-center text-slate-600 dark:text-slate-400">
                                <span>ID</span>
                                <span class="font-mono text-[10px] font-medium text-slate-700 dark:text-slate-300">${props.id ? props.id.substring(0, 12) + "..." : "N/A"}</span>
                            </div>
                            <div class="flex justify-between items-center text-slate-600 dark:text-slate-400">
                                <span>Material</span>
                                <span class="font-medium text-slate-800 dark:text-white">${props.material || "Unknown"}</span>
                            </div>
                            <div class="flex justify-between items-center text-slate-600 dark:text-slate-400">
                                <span>Age</span>
                                <span class="font-medium text-slate-800 dark:text-white">${typeof age === "number" ? age + " yrs" : age}</span>
                            </div>
                            <div class="flex justify-between items-center text-slate-600 dark:text-slate-400">
                                <span>Zone</span>
                                <span class="font-medium text-slate-800 dark:text-white">${props.zoneId || "N/A"}</span>
                            </div>
                        </div>
                        <div class="flex justify-between items-center text-[10px] uppercase tracking-wider font-bold pt-2 mt-2 border-t border-white/50 dark:border-white/10">
                            <span class="text-slate-400 dark:text-slate-500">Risk</span> 
                            <span class="${riskColor} font-semibold">${riskBand}</span>
                        </div>
                        <div class="flex justify-between items-center text-[10px] uppercase tracking-wider font-bold pt-1 mt-1">
                            <span class="text-slate-400 dark:text-slate-500">Confidence</span>
                          <span class="${confidenceColor} font-semibold">${confidenceBand}</span>
                        </div>
                        <div class="mt-1.5 flex items-center gap-1.5" aria-label="Confidence level bar">
                            <span class="h-1.5 flex-1 rounded-full ${confidenceLevel >= 1 ? "bg-slate-700 dark:bg-slate-200" : "bg-slate-200 dark:bg-slate-700"}"></span>
                            <span class="h-1.5 flex-1 rounded-full ${confidenceLevel >= 2 ? "bg-slate-700 dark:bg-slate-200" : "bg-slate-200 dark:bg-slate-700"}"></span>
                            <span class="h-1.5 flex-1 rounded-full ${confidenceLevel >= 3 ? "bg-slate-700 dark:bg-slate-200" : "bg-slate-200 dark:bg-slate-700"}"></span>
                        </div>
                    </div>
                `;
          layer.bindTooltip(tooltipHtml, {
            permanent: false,
            sticky: true,
            className: "custom-glass-tooltip",
            opacity: 1,
            direction: "top",
            offset: [0, -10],
          });

          layer.off("click");
          layer.on("click", (event: L.LeafletMouseEvent) => {
            L.DomEvent.stopPropagation(event);
            if (
              isDeleteModeActiveRef.current ||
              isDeleteToolbarActive() ||
              isEditModeActiveRef.current ||
              isEditToolbarActive()
            )
              return;
            onPipelineSelect?.(pipelineId);
          });
        }

        // Bind Zone Tooltip
        if (isZone) {
          const props = (layer as any).feature?.properties || {};
          if (layer.setStyle) {
            layer.setStyle(getZoneVisualStyle(props));
          }
          const priorityColor =
            props.priority === "High"
              ? "text-red-500 dark:text-red-400"
              : props.priority === "Low"
                ? "text-emerald-500 dark:text-emerald-400"
                : "text-amber-500 dark:text-amber-400";
          const zoneRiskBand = String(props.zoneRiskBand || "Low");
          const zoneRiskColor = getRiskBandTextClass(
            zoneRiskBand === "High" ||
              zoneRiskBand === "Medium" ||
              zoneRiskBand === "Low"
              ? zoneRiskBand
              : "Low",
          );
          const suppliedWater = Number(props.suppliedWater);
          const wastedWater = Number(props.wastedWater);
          const zoneTooltipHtml = `
                    <div class="px-3 py-2.5 bg-white/70 dark:bg-slate-900/80 backdrop-blur-xl rounded-xl shadow-lg border border-white/50 dark:border-white/10 min-w-[160px]">
                        <div class="text-xs font-bold text-slate-800 dark:text-white tracking-tight mb-2">${props.zoneName || "Unnamed Zone"}</div>
                        <div class="space-y-1.5 text-[11px]">
                            <div class="flex justify-between items-center text-slate-600 dark:text-slate-400">
                    <span>Pipelines</span>
                    <span class="font-medium text-slate-800 dark:text-white">${Number.isFinite(Number(props.ownedPipelineCount)) ? props.ownedPipelineCount : 0}</span>
                            </div>
                            <div class="flex justify-between items-center text-slate-600 dark:text-slate-400">
                              <span>Assets</span>
                              <span class="font-medium text-slate-800 dark:text-white">${Number.isFinite(Number(props.ownedAssetCount)) ? props.ownedAssetCount : 0}</span>
                            </div>
                            <div class="flex justify-between items-center text-slate-600 dark:text-slate-400">
                    <span>High Risk Pipes</span>
                    <span class="font-medium text-slate-800 dark:text-white">${Number.isFinite(Number(props.highRiskPipes)) ? props.highRiskPipes : 0}</span>
                            </div>
                            <div class="flex justify-between items-center text-slate-600 dark:text-slate-400">
                    <span>Avg Risk</span>
                    <span class="font-medium text-slate-800 dark:text-white">${Number.isFinite(Number(props.avgRisk ?? props.zoneRiskScore)) ? Math.round(Number(props.avgRisk ?? props.zoneRiskScore)) : 0}</span>
                  </div>
                  <div class="flex justify-between items-center text-slate-600 dark:text-slate-400">
                    <span>Avg Pipe Age</span>
                    <span class="font-medium text-slate-800 dark:text-white">${Number.isFinite(Number(props.avgAge)) ? `${props.avgAge} yrs` : "N/A"}</span>
                  </div>
                  <div class="flex justify-between items-center text-slate-600 dark:text-slate-400">
                    <span>Water Supplied</span>
                    <span class="font-medium text-slate-800 dark:text-white">${Number.isFinite(suppliedWater) ? suppliedWater : "N/A"}</span>
                  </div>
                  <div class="flex justify-between items-center text-slate-600 dark:text-slate-400">
                    <span>Water Wasted</span>
                    <span class="font-medium text-slate-800 dark:text-white">${Number.isFinite(wastedWater) ? wastedWater : "N/A"}</span>
                            </div>
                        </div>
                        <div class="flex justify-between items-center text-[10px] uppercase tracking-wider font-bold pt-2 mt-2 border-t border-white/50 dark:border-white/10">
                            <span class="text-slate-400 dark:text-slate-500">Priority</span> 
                            <span class="${priorityColor}">${props.priority || "Medium"}</span>
                        </div>
                <div class="flex justify-between items-center text-[10px] uppercase tracking-wider font-bold pt-1 mt-1">
                  <span class="text-slate-400 dark:text-slate-500">Zone Risk</span>
                  <span class="${zoneRiskColor}">${zoneRiskBand}</span>
                </div>
                    </div>
                `;
          layer.bindTooltip(zoneTooltipHtml, {
            permanent: false,
            sticky: true,
            className: "custom-glass-tooltip",
            opacity: 1,
            direction: "top",
            offset: [0, -10],
          });
        }

        // Bind Marker Tooltip
        if (isMarker) {
          const props = (layer as any).feature?.properties || {};
          const markerType = props.type || "Point Asset";
          const assetName = props.name || props.location || "Unnamed Asset";
          const markerTooltipHtml = `
                    <div class="px-3 py-2.5 bg-white/70 dark:bg-slate-900/80 backdrop-blur-xl rounded-xl shadow-lg border border-white/50 dark:border-white/10 min-w-[150px]">
                <div class="text-xs font-bold text-slate-800 dark:text-white tracking-tight mb-1">${assetName}</div>
                <div class="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">${markerType}</div>
                        <div class="space-y-1.5 text-[11px]">
                            <div class="flex justify-between items-center text-slate-600 dark:text-slate-400">
                    <span>Asset ID</span>
                    <span class="font-mono text-[10px] font-medium text-slate-700 dark:text-slate-300">${props.id || props.markerId || "N/A"}</span>
                            </div>
                            <div class="flex justify-between items-center text-slate-600 dark:text-slate-400">
                                <span>Location</span>
                    <span class="font-medium text-slate-800 dark:text-white">${props.location || "Unknown"}</span>
                            </div>
                            <div class="flex justify-between items-center text-slate-600 dark:text-slate-400">
                                <span>Condition</span>
                                <span class="font-medium text-slate-800 dark:text-white">${props.condition || props.status || "Unknown"}</span>
                            </div>
                            <div class="flex justify-between items-center text-slate-600 dark:text-slate-400">
                                <span>Service</span>
                                <span class="font-medium text-slate-800 dark:text-white">${props.lastService || "—"}</span>
                            </div>
                        </div>
                    </div>
                `;
          layer.bindTooltip(markerTooltipHtml, {
            permanent: false,
            sticky: true,
            className: "custom-glass-tooltip",
            opacity: 1,
            direction: "top",
            offset: [0, -10],
          });
        }

        // Bucket into desired sets
        if (isZone && showZones) desiredZones.push(layer);
        else if (
          isPipe &&
          showPipelines &&
          pipelineMatchesBandFilters((layer as any).feature?.properties || {})
        )
          desiredPipes.push(layer);
        else if (isMarker && showAssets) desiredMarkers.push(layer);
      });

      // Build the desired set for fast lookup
      const desiredSet = new Set<L.Layer>([
        ...desiredZones,
        ...desiredMarkers,
        ...desiredPipes,
      ]);

      // Remove layers from fg that should no longer be visible
      const toRemove: L.Layer[] = [];
      fg.eachLayer((layer) => {
        if (!desiredSet.has(layer)) toRemove.push(layer);
      });
      toRemove.forEach((l) => fg.removeLayer(l));

      // Add layers that aren't already in fg (order: zones, pipes, then markers on top for z-ordering)
      const alreadyIn = new Set<L.Layer>();
      fg.eachLayer((l) => alreadyIn.add(l));

      desiredZones.forEach((l) => {
        if (!alreadyIn.has(l)) fg.addLayer(l);
      });
      desiredPipes.forEach((l) => {
        if (!alreadyIn.has(l)) fg.addLayer(l);
      });
      desiredMarkers.forEach((l) => {
        if (!alreadyIn.has(l)) fg.addLayer(l);
      });

      // Keep edit-target layers synced
      syncEditableLayers();
      syncDeletableLayers();

      // Always push zones to the back so pipelines and markers stay on top, regardless of draw order
      desiredZones.forEach((l) => (l as any).bringToBack?.());
      // Bring markers to the very front
      desiredMarkers.forEach((l) => (l as any).bringToFront?.());

      // Rebuild endpoint labels (always clear + rebuild since they're supplementary display only)
      labelFgRef.current.clearLayers();
      if (showPipelines) {
        const placedLabelPoints: L.LatLng[] = [];
        const minLabelDistanceMeters = 24;
        const endpointCandidates: Array<{
          latlng: L.LatLng;
          icon: L.DivIcon;
          stableKey: string;
        }> = [];

        const canPlaceLabel = (latlng: L.LatLng) => {
          return !placedLabelPoints.some(
            (placed) => map.distance(placed, latlng) < minLabelDistanceMeters,
          );
        };

        allLayersRef.current.eachLayer((layer) => {
          const isZone =
            layer instanceof L.Polygon ||
            layer instanceof L.Rectangle ||
            layer instanceof L.Circle;
          const isPipe = layer instanceof L.Polyline && !isZone;
          if (!isPipe) return;
          const props = (layer as any).feature?.properties;
          if (!props?.startLocation && !props?.endLocation) return;
          // Skip endpoints for pipelines that don't match active filters
          if (!pipelineMatchesBandFilters(props)) return;

          const latlngs = (layer as L.Polyline).getLatLngs();
          // Flatten nested arrays (multi-segment lines)
          const flat = Array.isArray(latlngs[0])
            ? (latlngs as L.LatLng[][])[0]
            : (latlngs as L.LatLng[]);
          if (flat.length < 2) return;

          const endpointA = flat[0];
          const endpointB = flat[flat.length - 1];

          const storedStartAnchor = props?.endpointAnchors?.start
            ? L.latLng(
                props.endpointAnchors.start[0],
                props.endpointAnchors.start[1],
              )
            : null;

          let startLL = endpointA;
          let endLL = endpointB;

          if (storedStartAnchor) {
            const startToA = map.distance(storedStartAnchor, endpointA);
            const startToB = map.distance(storedStartAnchor, endpointB);
            if (startToB < startToA) {
              startLL = endpointB;
              endLL = endpointA;
            }
          }

          const featureId = generateStablePipelineId(props, startLL, endLL);
          if (!props.id) {
            props.id = featureId;
            (layer as any).feature.properties = props;
          }

          if (props.startLocation) {
            endpointCandidates.push({
              latlng: startLL,
              icon: makeEndpointIcon(
                compactEndpointLabel(props.startLocation),
                "start",
                props.startLocation,
              ),
              stableKey: `${featureId}:0:${props.startLocation}`,
            });
          }
          if (props.endLocation) {
            endpointCandidates.push({
              latlng: endLL,
              icon: makeEndpointIcon(
                compactEndpointLabel(props.endLocation),
                "end",
                props.endLocation,
              ),
              stableKey: `${featureId}:1:${props.endLocation}`,
            });
          }
        });

        endpointCandidates
          .sort((a, b) => a.stableKey.localeCompare(b.stableKey))
          .forEach((candidate) => {
            if (!canPlaceLabel(candidate.latlng)) return;
            L.marker(candidate.latlng, {
              icon: candidate.icon,
              interactive: false,
              zIndexOffset: -200,
            }).addTo(labelFgRef.current);
            placedLabelPoints.push(candidate.latlng);
          });
      }

      setPendingCount(pending);
      // Write to localStorage so sidebar reads it from any page
      localStorage.setItem("pipeiq_pending_count", String(pending));
      window.dispatchEvent(new Event("pipeiq_pending_updated"));
      if (onPendingCountChange) onPendingCountChange(pending);
    },
    [
      showPipelines,
      showZones,
      showAssets,
      onPendingCountChange,
      onPipelineSelect,
      map,
      syncEditableLayers,
      syncDeletableLayers,
      pipelineMatchesBandFilters,
    ],
  );

  // 1. Initialize Display Group and Load Data
  useEffect(() => {
    let isMounted = true;
    if (!mapReady) return;
    const fg = new L.FeatureGroup().addTo(map);
    editableFgRef.current.addTo(map);
    deletableFgRef.current.addTo(map);
    const labelFg = labelFgRef.current;
    labelFg.addTo(map);
    setDisplayFg(fg);

    const shouldSkipRefresh = () => {
      return (
        isDeleteModeActiveRef.current ||
        isEditModeActiveRef.current ||
        isEditToolbarActive() ||
        !!deleteConfirmLayers
      );
    };

    const refreshLocalAndQueue = () => {
      if (shouldSkipRefresh()) return;
      // Keep local in-memory shapes (e.g. newly drawn zones/markers) visible.
      // Only recycle queue pipelines from local queue source.
      removeQueuedPipelineLayers(allLayersRef.current);
      loadSavedLayers(allLayersRef.current);
      loadQueuedPipelinesFromLocalQueue(allLayersRef.current);
      dedupePipelineLayers(allLayersRef.current);
      void refreshZoneOwnershipAndStyles({ persistToFirebase: false });
      if (isMounted) syncVisibleLayers(fg);
    };

    const refreshFirebasePipelines = async () => {
      if (shouldSkipRefresh()) return;
      removeFirebaseLayersByKind(allLayersRef.current, "pipeline");
      await loadSavedPipelinesFromFirebase(allLayersRef.current);
      dedupePipelineLayers(allLayersRef.current);
      await refreshZoneOwnershipAndStyles({ persistToFirebase: false });
      if (isMounted) syncVisibleLayers(fg);
    };

    const refreshFirebaseZones = async () => {
      if (shouldSkipRefresh()) return;
      removeFirebaseLayersByKind(allLayersRef.current, "zone");
      await loadSavedZonesFromFirebase(allLayersRef.current);
      await refreshZoneOwnershipAndStyles({ persistToFirebase: false });
      if (isMounted) syncVisibleLayers(fg);
    };

    const refreshFirebaseMarkers = async () => {
      if (shouldSkipRefresh()) return;
      removeAllMarkerLayers(allLayersRef.current);
      await loadSavedMarkersFromFirebase(allLayersRef.current);
      await refreshZoneOwnershipAndStyles({ persistToFirebase: false });
      if (isMounted) syncVisibleLayers(fg);
    };

    const refreshAllFirebase = async () => {
      if (shouldSkipRefresh()) return;
      removeFirebaseLayersByKind(allLayersRef.current, "pipeline");
      removeFirebaseLayersByKind(allLayersRef.current, "zone");
      removeAllMarkerLayers(allLayersRef.current);
      await loadSavedPipelinesFromFirebase(allLayersRef.current);
      await loadSavedZonesFromFirebase(allLayersRef.current);
      await loadSavedMarkersFromFirebase(allLayersRef.current);
      dedupePipelineLayers(allLayersRef.current);
      await refreshZoneOwnershipAndStyles();
      if (isMounted) syncVisibleLayers(fg);
    };

    const updateWeights = () => {
      const scale = Math.pow(2, map.getZoom() - 14);
      fg.eachLayer((layer: any) => {
        if (layer.setStyle) {
          const isZone =
            layer instanceof L.Polygon ||
            layer instanceof L.Rectangle ||
            layer instanceof L.Circle;
          const isPipe = layer instanceof L.Polyline && !isZone;
          if (!Number.isFinite(Number(layer.options.baseWeight))) {
            layer.options.baseWeight = isPipe ? 2 : 2;
          }

          const nextWeight = Number(layer.options.baseWeight) * scale;
          layer.setStyle({
            weight: isPipe
              ? Math.max(1, Math.min(nextWeight, 2.5))
              : Math.max(1, Math.min(nextWeight, 4)),
          });
        }
      });
    };

    map.on("zoomend", updateWeights);
    updateWeights();

    (async () => {
      // Load draw plugin first so subsequently created layers include editing hooks.
      await ensureLeafletDrawLoaded();
      if (!isMounted) return;

      refreshLocalAndQueue();
      loadCachedPipelines(allLayersRef.current);
      if (isMounted) syncVisibleLayers(fg);
      refreshAllFirebase();

      // Mark map as fully initialized after first data load
      if (isMounted) {
        isMapInitializedRef.current = true;
      }
    })();

    // Sync across tabs
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === "pipeiq-map-layers") {
        refreshLocalAndQueue();
      }
    };
    const handleMapLayersUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ source?: string }>).detail;
      if (detail?.source === MAP_LAYERS_UPDATE_SOURCE.zoneOwnershipRefresh) {
        return;
      }
      refreshLocalAndQueue();
    };
    const handleQueueUpdated = () => {
      refreshLocalAndQueue();
    };

    // Debounce Firebase persistence: individual snapshots update UI without persisting,
    // but a debounced timer ensures counts persist after all snapshots settle.
    const clearPersistenceTimer = () => {
      if (persistenceTimeoutIdRef.current) {
        clearTimeout(persistenceTimeoutIdRef.current);
        persistenceTimeoutIdRef.current = null;
      }
    };
    const schedulePersistence = () => {
      clearPersistenceTimer();
      persistenceTimeoutIdRef.current = setTimeout(() => {
        if (isMounted) {
          void refreshZoneOwnershipAndStyles({ persistToFirebase: true });
        }
        persistenceTimeoutIdRef.current = null;
      }, 500); // Wait 500ms for snapshot cascades to settle
    };

    const unsubPipelines = subscribeToPipelines(() => {
      refreshFirebasePipelines().then(() => schedulePersistence());
    });
    const unsubZones = subscribeToZones(() => {
      refreshFirebaseZones().then(() => schedulePersistence());
    });
    const unsubMarkers = subscribeToMarkers(() => {
      refreshFirebaseMarkers().then(() => schedulePersistence());
    });

    window.addEventListener("storage", handleStorageChange);
    window.addEventListener(
      "pipeiq_map_layers_updated",
      handleMapLayersUpdated,
    );
    window.addEventListener("pipeiq_queue_updated", handleQueueUpdated);

    return () => {
      isMounted = false;
      if (persistenceTimeoutIdRef.current) {
        clearTimeout(persistenceTimeoutIdRef.current);
        persistenceTimeoutIdRef.current = null;
      }
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener(
        "pipeiq_map_layers_updated",
        handleMapLayersUpdated,
      );
      window.removeEventListener("pipeiq_queue_updated", handleQueueUpdated);
      unsubPipelines();
      unsubZones();
      unsubMarkers();
      map.off("zoomend", updateWeights);
      map.removeLayer(fg);
      map.removeLayer(editableFgRef.current);
      map.removeLayer(deletableFgRef.current);
      map.removeLayer(labelFg);
    };
  }, [map, mapReady, deleteConfirmLayers, ensureLeafletDrawLoaded]); // Added deleteConfirmLayers to dependency array

  // Sync rendering when toggles change
  useEffect(() => {
    if (displayFg) {
      syncVisibleLayers(displayFg);
    }
  }, [syncVisibleLayers, displayFg]);

  // Handle dock actions and map them to Leaflet controls.
  useEffect(() => {
    const getEnabledToolbarButtons = () => {
      return Array.from(
        document.querySelectorAll<HTMLElement>(
          ".leaflet-draw-toolbar-button-enabled",
        ),
      );
    };

    const activateExclusiveControl = (selector: string) => {
      const target = document.querySelector<HTMLElement>(selector);
      if (!target) {
        return;
      }

      const targetWasEnabled = target.classList.contains(
        "leaflet-draw-toolbar-button-enabled",
      );

      // Turn off every other active draw/edit/delete tool first.
      getEnabledToolbarButtons().forEach((btn) => {
        if (btn !== target) btn.click();
      });

      // Only activate target if it is not already active.
      if (!targetWasEnabled) {
        target.click();
      }
    };

    const requestToolSwitch = (selector: string) => {
      const target = document.querySelector<HTMLElement>(selector);
      if (!target) {
        return;
      }

      const targetWasEnabled = target.classList.contains(
        "leaflet-draw-toolbar-button-enabled",
      );
      if (targetWasEnabled) return;

      const enabledButtons = getEnabledToolbarButtons();
      const anotherToolActive = enabledButtons.some((btn) => btn !== target);

      if (anotherToolActive) {
        return;
      }

      activateExclusiveControl(selector);
    };

    const clickLeafletAction = (kind: "save" | "undo" | "cancel") => {
      const activeToolbarButtons = getEnabledToolbarButtons();
      const links = Array.from(
        document.querySelectorAll<HTMLAnchorElement>(".leaflet-draw-actions a"),
      ).filter((a) => {
        if (!a.isConnected) return false;
        const actions = a.closest(
          ".leaflet-draw-actions",
        ) as HTMLElement | null;
        if (!actions) return false;
        const toolbar = actions.parentElement;
        const hasEnabledInSameToolbar = !!toolbar?.querySelector(
          ".leaflet-draw-toolbar-button-enabled",
        );
        return hasEnabledInSameToolbar;
      });

      const drawModeHandler = (map as any)?._toolbars?.draw?._activeMode
        ?.handler;
      const editModeHandler = (map as any)?._toolbars?.edit?._activeMode
        ?.handler;

      const safeClick = (el: HTMLAnchorElement) => {
        try {
          el.dispatchEvent(
            new MouseEvent("click", {
              bubbles: true,
              cancelable: true,
              view: window,
            }),
          );
          return true;
        } catch {
          return false;
        }
      };

      const findByText = (matcher: (text: string) => boolean) => {
        return links.find((a) =>
          matcher((a.textContent || "").trim().toLowerCase()),
        );
      };

      let target: HTMLAnchorElement | undefined;
      if (kind === "save") {
        target = findByText((t) => t.includes("save") || t.includes("finish"));
      } else if (kind === "undo") {
        target = findByText(
          (t) =>
            t.includes("delete last point") || t.includes("remove last point"),
        );
      } else {
        target = findByText((t) => t.includes("cancel"));
      }

      // Fallback by position for built-in Leaflet.Draw menus.
      if (!target && links.length > 0) {
        if (kind === "save") target = links[0];
        else if (kind === "undo" && links.length >= 3) target = links[1];
        else if (kind === "cancel") target = links[links.length - 1];
      }

      if (!target) {
        if (kind === "undo") {
          if (typeof drawModeHandler?.deleteLastVertex === "function") {
            drawModeHandler.deleteLastVertex();
            return;
          }
        }

        if (kind === "save") {
          if (typeof drawModeHandler?.completeShape === "function") {
            drawModeHandler.completeShape();
            return;
          }
          if (typeof editModeHandler?.save === "function") {
            editModeHandler.save();
            return;
          }
          if (typeof editModeHandler?._save === "function") {
            editModeHandler._save();
            return;
          }
        }

        if (kind === "cancel") {
          if (typeof drawModeHandler?.disable === "function") {
            drawModeHandler.disable();
          }
          if (typeof editModeHandler?.disable === "function") {
            editModeHandler.disable();
          }
          activeToolbarButtons.forEach((btn) => {
            if (btn.classList.contains("leaflet-draw-toolbar-button-enabled")) {
              try {
                btn.click();
              } catch {}
            }
          });
          return;
        }

        toast.info("That action is not available right now.");
        return;
      }

      if (!safeClick(target)) {
        if (kind === "cancel") {
          activeToolbarButtons.forEach((btn) => {
            if (btn.classList.contains("leaflet-draw-toolbar-button-enabled")) {
              try {
                btn.click();
              } catch {}
            }
          });
        } else if (
          kind === "undo" &&
          typeof drawModeHandler?.deleteLastVertex === "function"
        ) {
          drawModeHandler.deleteLastVertex();
        } else if (kind === "save") {
          if (typeof drawModeHandler?.completeShape === "function")
            drawModeHandler.completeShape();
          else if (typeof editModeHandler?.save === "function")
            editModeHandler.save();
          else if (typeof editModeHandler?._save === "function")
            editModeHandler._save();
        }
      }
    };

    const onDockAction = (event: Event) => {
      const detail = (event as CustomEvent<{ action?: string }>).detail;
      const action = detail?.action;
      if (!action) return;

      if (action === "zoomIn") {
        map.zoomIn();
        return;
      }
      if (action === "zoomOut") {
        map.zoomOut();
        return;
      }
      if (action === "drawPipelines") {
        requestToolSwitch(".leaflet-draw-draw-polyline");
        return;
      }
      if (action === "drawZones") {
        requestToolSwitch(".leaflet-draw-draw-polygon");
        return;
      }
      if (action === "drawMarkers") {
        requestToolSwitch(".leaflet-draw-draw-marker");
        return;
      }
      if (action === "drawCircleMarkers") {
        requestToolSwitch(".leaflet-draw-draw-circlemarker");
        return;
      }
      if (action === "edit") {
        requestToolSwitch(".leaflet-draw-edit-edit");
        return;
      }
      if (action === "delete") {
        requestToolSwitch(".leaflet-draw-edit-remove");
        return;
      }
      if (action === "leafletSave") {
        clickLeafletAction("save");
        return;
      }
      if (action === "leafletUndo") {
        clickLeafletAction("undo");
        return;
      }
      if (action === "leafletCancel") {
        clickLeafletAction("cancel");
      }
    };

    window.addEventListener(
      "pipeiq_dock_action",
      onDockAction as EventListener,
    );
    return () =>
      window.removeEventListener(
        "pipeiq_dock_action",
        onDockAction as EventListener,
      );
  }, [map, pendingPipelineLayer, pendingZoneLayer, pendingMarkerLayer]);

  // 2. Handle Editor Mode drawing toolbars
  useEffect(() => {
    if (!displayFg || !isEditorMode) return;
    let isMounted = true;
    let drawControl: any;
    let editControl: any;
    let deleteControl: any;
    let onCreated: any;
    let onEdited: any;
    let onDeleted: any;
    let onDeleteStart: any;
    let onDeleteStop: any;
    let onEditStart: any;
    let onEditStop: any;
    let onDrawStart: any;
    let onDrawStop: any;

    const emitLeafletMode = (
      mode: "draw" | "edit" | "delete" | null,
      drawType?: string | null,
    ) => {
      window.dispatchEvent(
        new CustomEvent("pipeiq_leaflet_mode_changed", {
          detail: { mode, drawType: drawType ?? null },
        }),
      );
    };

    const initDraw = async () => {
      try {
        await ensureLeafletDrawLoaded();

        if (!isMounted) return;

        // We create a dedicated control for drawing, with editing DISABLED
        drawControl = new L.Control.Draw({
          position: "topleft",
          draw: {
            polyline: { shapeOptions: { color: "#000000", weight: 2 } },
            polygon: {
              shapeOptions: {
                color: "#000000",
                fillColor: "#ffffff",
                fillOpacity: 0.4,
              },
            },
            rectangle: false,
            circle: false,
            marker: {},
            circlemarker: false,
          },
          edit: false as any,
        });

        // We create a separate dedicated control for editing, with drawing DISABLED
        editControl = new L.Control.Draw({
          position: "topleft",
          draw: false as any,
          edit: {
            featureGroup: editableFgRef.current,
            edit: {
              selectedPathOptions: {
                color: "#000000",
                fillColor: "#ffffff",
                fillOpacity: 0.4,
              },
            },
            remove: false,
          },
        });

        // Dedicated remove control includes markers/circle markers.
        deleteControl = new L.Control.Draw({
          position: "topleft",
          draw: false as any,
          edit: {
            featureGroup: deletableFgRef.current,
            edit: false as any,
            remove: true,
          },
        });

        map.addControl(drawControl);
        map.addControl(editControl);
        map.addControl(deleteControl);

        onCreated = (e: any) => {
          const layer = e.layer;

          if (layer.setStyle) {
            layer.options.baseWeight = layer.options.weight || 2;
            const scale = Math.pow(2, map.getZoom() - 14);
            const isZone =
              layer instanceof L.Polygon ||
              layer instanceof L.Rectangle ||
              layer instanceof L.Circle;
            const isPipe = layer instanceof L.Polyline && !isZone;
            const nextWeight = layer.options.baseWeight * scale;
            layer.setStyle({
              weight: isPipe ? Math.min(nextWeight, 2.5) : nextWeight,
            });
          }

          const isZone =
            layer instanceof L.Polygon ||
            layer instanceof L.Rectangle ||
            layer instanceof L.Circle;
          const isPipe = layer instanceof L.Polyline && !isZone;
          const isMarker =
            layer instanceof L.Marker || layer instanceof L.CircleMarker;

          if (isZone) {
            setPendingZoneLayer(layer);
          } else if (isPipe) {
            // Pause saving: prompt for model data first!
            setPendingPipelineLayer(layer);
          } else if (isMarker) {
            // Show modal for marker data entry
            setPendingMarkerLayer(layer as L.Marker | L.CircleMarker);
          } else {
            // Unknown feature type - save locally only
            allLayersRef.current.addLayer(layer);
            if (displayFg) syncVisibleLayers(displayFg);
            saveLayers(allLayersRef.current);
          }
        };

        onEdited = async (e: any) => {
          // Leaflet Draw mutates layers in-place. Just save the current state.
          // We do NOT clear/rebuild allLayersRef here to avoid losing hidden layers.
          const firebaseSaves: Promise<any>[] = [];

          e.layers.eachLayer((layer: any) => {
            const isZone =
              layer instanceof L.Polygon ||
              layer instanceof L.Rectangle ||
              layer instanceof L.Circle;
            const isPipe = layer instanceof L.Polyline && !isZone;
            const isMarker =
              layer instanceof L.Marker || layer instanceof L.CircleMarker;

            if (isZone) {
              const props = layer?.feature?.properties || {};
              const source = String(props?.source || "").toLowerCase();
              if (source !== "firebase") return;

              let geometry: any = null;
              if (layer instanceof L.Circle) {
                geometry = circleToGeoJSON(layer);
              } else if (layer instanceof L.Rectangle) {
                geometry = rectangleToGeoJSON(layer);
              } else if (layer instanceof L.Polygon) {
                const latlngsRaw = layer.getLatLngs() as any;
                const ring: L.LatLng[] = Array.isArray(latlngsRaw?.[0])
                  ? latlngsRaw[0]
                  : latlngsRaw;
                geometry = {
                  type: "Polygon",
                  coordinates: [ring.map((ll: L.LatLng) => [ll.lng, ll.lat])],
                };
              }

              if (!geometry) return;

              const zoneId = props.id || props.zoneId;
              if (!zoneId) return;

              const nextProps: any = {
                ...props,
                id: zoneId,
                zoneId,
                source: "firebase",
              };

              if (layer instanceof L.Circle) {
                nextProps._leafletType = "Circle";
                nextProps.radiusMeters = layer.getRadius();
              } else if (layer instanceof L.Rectangle) {
                nextProps._leafletType = "Rectangle";
              } else if (layer instanceof L.Polygon) {
                nextProps._leafletType = "Polygon";
              }

              const featureLayer = layer as unknown as {
                feature?: GeoJSON.Feature<any, any>;
              };
              featureLayer.feature = featureLayer.feature || {
                type: "Feature",
                geometry,
                properties: {},
              };
              featureLayer.feature.geometry = geometry;
              featureLayer.feature.properties = nextProps;

              firebaseSaves.push(
                saveZoneToFirestore({
                  ...nextProps,
                  id: zoneId,
                  zoneId,
                  geometry,
                  source: "firebase",
                }),
              );
              return;
            }

            if (isMarker) {
              const props = layer?.feature?.properties || {};
              const source = props?.source;
              if (source !== "firebase") return;

              const latlng = layer.getLatLng?.();
              if (!latlng) return;

              const markerId = props.id || props.markerId;
              if (!markerId) return;

              const nextProps = {
                ...props,
                id: markerId,
                markerId,
                source: "firebase",
                coordinates: [latlng.lng, latlng.lat],
                _leafletType:
                  layer instanceof L.CircleMarker ? "CircleMarker" : "Marker",
              } as any;

              if (layer instanceof L.CircleMarker) {
                nextProps.radiusPixels = layer.getRadius();
              }

              const featureLayer = layer as unknown as {
                feature?: GeoJSON.Feature<any, any>;
              };
              featureLayer.feature = featureLayer.feature || {
                type: "Feature",
                geometry: {
                  type: "Point",
                  coordinates: [latlng.lng, latlng.lat],
                },
                properties: {},
              };
              featureLayer.feature.properties = nextProps;

              firebaseSaves.push(
                saveMarkerToFirestore({
                  ...nextProps,
                  id: markerId,
                  coordinates: [latlng.lng, latlng.lat],
                  source: "firebase",
                }),
              );
              return;
            }

            if (!isPipe) return;

            const props = layer?.feature?.properties;
            if (!props?.startLocation && !props?.endLocation) return;

            const latlngs = layer.getLatLngs();
            const flat = (
              Array.isArray(latlngs[0]) ? latlngs[0] : latlngs
            ) as L.LatLng[];
            if (!flat || flat.length < 2) return;

            const startLL = flat[0];
            const endLL = flat[flat.length - 1];
            const currentProps = layer?.feature?.properties || {};
            const pipelineId =
              currentProps.id ||
              currentProps.pipelineId ||
              generateStablePipelineId(currentProps, startLL, endLL);

            const featureLayer = layer as unknown as {
              feature?: GeoJSON.Feature<any, any>;
            };
            featureLayer.feature = featureLayer.feature || {
              type: "Feature",
              geometry: {
                type: "LineString",
                coordinates: flat.map((ll: L.LatLng) => [ll.lng, ll.lat]),
              },
              properties: {},
            };
            featureLayer.feature.properties = {
              ...(featureLayer.feature.properties || {}),
              id: pipelineId,
              pipelineId,
              endpointAnchors: {
                start: [startLL.lat, startLL.lng],
                end: [endLL.lat, endLL.lng],
              },
              geometry: {
                type: "LineString",
                coordinates: flat.map((ll: L.LatLng) => [ll.lng, ll.lat]),
              },
            };

            const nextProps = featureLayer.feature.properties || {};
            if (nextProps.source === "firebase") {
              firebaseSaves.push(
                savePipelineToFirestore({
                  ...nextProps,
                  id: pipelineId,
                  pipelineId,
                  source: "firebase",
                  predictionStatus: nextProps.predictionStatus || "complete",
                  geometry: {
                    type: "LineString",
                    coordinates: flat.map((ll: L.LatLng) => [ll.lng, ll.lat]),
                  },
                }),
              );
            }
          });

          dedupePipelineLayers(allLayersRef.current);

          if (displayFg) {
            syncVisibleLayers(displayFg);
          }
          saveLayers(allLayersRef.current);

          if (firebaseSaves.length > 0) {
            const saveResults = await Promise.allSettled(firebaseSaves);
            const failedCount = saveResults.filter(
              (r) => r.status === "rejected",
            ).length;
            if (failedCount > 0) {
              toast.error("Some changes could not be saved.", {
                description: "Please try again.",
              });
            } else {
              toast.success("Changes saved.");
              window.dispatchEvent(new Event("pipeiq_map_layers_updated"));
            }
          } else {
            toast.success("Changes saved.");
          }

          await refreshZoneOwnershipAndStyles();
        };
        onDeleted = (e: any) => {
          const deletedLayers: any[] = [];
          const seenIds = new Set<string>();

          e.layers.eachLayer((layer: any) => {
            const props = layer?.feature?.properties || {};
            const layerId =
              props.id || props.markerId || props.pipelineId || props.zoneId;

            // Only add if we haven't already seen this ID
            if (layerId && seenIds.has(String(layerId))) {
              return;
            }
            if (layerId) seenIds.add(String(layerId));

            deletedLayers.push(layer);
            // Temporarily add it back to the map to 'pause' the deletion
            if (displayFg) displayFg.addLayer(layer);
          });

          setDeleteConfirmLayers(deletedLayers);
        };

        map.on(L.Draw.Event.CREATED, onCreated);
        map.on(L.Draw.Event.EDITED, onEdited);
        map.on(L.Draw.Event.DELETED, onDeleted);
        onDeleteStart = () => {
          emitLeafletMode("delete");
          isDeleteModeActiveRef.current = true;
          setIsDeleteModeActive(true);
          toast.warning("Delete mode is on", {
            description: "Select map items you want to remove, then confirm.",
            duration: 2800,
          });
        };
        onDeleteStop = () => {
          emitLeafletMode(null);
          isDeleteModeActiveRef.current = false;
          setIsDeleteModeActive(false);
          toast.info("Delete mode is off", {
            description: "You are back to normal map mode.",
            duration: 2200,
          });
        };
        onEditStart = () => {
          emitLeafletMode("edit");
          isEditModeActiveRef.current = true;
          toast.warning("Edit mode is on", {
            description:
              "Saved pipelines can be edited. Queued pipelines stay read-only.",
            duration: 3200,
          });

          // Hide queued pipelines during edit mode so only persisted layers can be edited.
          hiddenQueueLayersDuringEditRef.current = [];
          displayFg.eachLayer((layer: any) => {
            const isZone =
              layer instanceof L.Polygon ||
              layer instanceof L.Rectangle ||
              layer instanceof L.Circle;
            const isPipe = layer instanceof L.Polyline && !isZone;
            const source = layer?.feature?.properties?.source;
            if (isPipe && source === "queue") {
              hiddenQueueLayersDuringEditRef.current.push(layer);
            }
          });
          hiddenQueueLayersDuringEditRef.current.forEach((layer) =>
            displayFg.removeLayer(layer),
          );
        };
        onEditStop = () => {
          emitLeafletMode(null);
          isEditModeActiveRef.current = false;

          // Restore queued pipelines after edit mode exits.
          hiddenQueueLayersDuringEditRef.current.forEach((layer) => {
            if (!displayFg.hasLayer(layer)) displayFg.addLayer(layer);
          });
          hiddenQueueLayersDuringEditRef.current = [];

          syncVisibleLayers(displayFg);
          toast.info("Edit mode is off", {
            description: "You are back to normal map mode.",
            duration: 2200,
          });
        };
        map.on("draw:deletestart", onDeleteStart);
        map.on("draw:deletestop", onDeleteStop);
        map.on("draw:editstart", onEditStart);
        map.on("draw:editstop", onEditStop);
        onDrawStart = (event: any) => {
          const layerType =
            typeof event?.layerType === "string" ? event.layerType : null;
          emitLeafletMode("draw", layerType);
        };
        onDrawStop = () => emitLeafletMode(null);
        map.on("draw:drawstart", onDrawStart);
        map.on("draw:drawstop", onDrawStop);
      } catch (e) {
        console.error("Failed to load leaflet-draw", e);
      }
    };

    const drawPromise = initDraw();

    return () => {
      isMounted = false;
      drawPromise.then(() => {
        if (drawControl) map.removeControl(drawControl);
        if (editControl) map.removeControl(editControl);
        if (deleteControl) map.removeControl(deleteControl);
        if (onCreated) map.off(L.Draw.Event.CREATED, onCreated);
        if (onEdited) map.off(L.Draw.Event.EDITED, onEdited);
        if (onDeleted) map.off(L.Draw.Event.DELETED, onDeleted);
        if (onDeleteStart) map.off("draw:deletestart", onDeleteStart);
        if (onDeleteStop) map.off("draw:deletestop", onDeleteStop);
        if (onEditStart) map.off("draw:editstart", onEditStart);
        if (onEditStop) map.off("draw:editstop", onEditStop);
        if (onDrawStart) map.off("draw:drawstart", onDrawStart);
        if (onDrawStop) map.off("draw:drawstop", onDrawStop);
        emitLeafletMode(null);
        isDeleteModeActiveRef.current = false;
        setIsDeleteModeActive(false);
        isEditModeActiveRef.current = false;
        hiddenQueueLayersDuringEditRef.current = [];
      });
    };
  }, [map, displayFg, isEditorMode, ensureLeafletDrawLoaded]);

  // Listen for test button: mark all pending layers as complete
  useEffect(() => {
    const handler = () => {
      let changed = false;
      allLayersRef.current.eachLayer((layer) => {
        const props = (layer as any).feature?.properties;
        if (props?.predictionStatus === "pending") {
          props.predictionStatus = "complete";
          props.riskScore = Math.floor(Math.random() * 100);
          props.risk_score = Number(props.riskScore) / 100;
          props.risk_band = getRiskBand(props);
          props.confidence_score = 0.5;
          props.confidence_band = "High";
          changed = true;
        }
      });
      if (changed && displayFg) {
        syncVisibleLayers(displayFg);
        saveLayers(allLayersRef.current);
        window.dispatchEvent(new Event("pipeiq_predictions_complete"));
      }
    };
    window.addEventListener("pipeiq_mark_all_complete", handler);
    return () =>
      window.removeEventListener("pipeiq_mark_all_complete", handler);
  }, [displayFg, syncVisibleLayers]);

  const handleSavePipeline = async (data: PipelineFormData) => {
    if (!pendingPipelineLayer || !displayFg) return;

    const pendingLatLngs = pendingPipelineLayer.getLatLngs();
    const pendingFlat = Array.isArray(pendingLatLngs[0])
      ? (pendingLatLngs as L.LatLng[][])[0]
      : (pendingLatLngs as L.LatLng[]);
    const startAnchor = pendingFlat[0];
    const endAnchor = pendingFlat[pendingFlat.length - 1];

    const zoneLayers: any[] = [];
    allLayersRef.current.eachLayer((layer: any) => {
      const isZone =
        layer instanceof L.Polygon ||
        layer instanceof L.Rectangle ||
        layer instanceof L.Circle;
      if (isZone) zoneLayers.push(layer);
    });
    const owningZone = findOwningZoneLayer(zoneLayers, startAnchor);
    const owningZoneProps = owningZone?.feature?.properties || null;

    const generatedId = `PL-${Date.now()}`;

    const upsertQueueItem = (item: any) => {
      const existing = getQueue();
      const existsAlready = existing.some((entry) => entry?.id === item?.id);
      if (!existsAlready && existing.length >= PIPELINE_QUEUE_MAX) {
        toast.warning(
          `Queue is full (${PIPELINE_QUEUE_MAX} items). Please wait for sync, then try again.`,
        );
        return false;
      }
      const withoutCurrent = existing.filter((entry) => entry?.id !== item?.id);
      localStorage.setItem(
        PIPELINE_QUEUE_KEY,
        JSON.stringify([...withoutCurrent, item]),
      );
      console.log("[Map] Pipeline queued:", item.id);
      window.dispatchEvent(new Event("pipeiq_queue_updated"));
      return true;
    };

    // Create pipeline object for queue
    const pipelineObject = {
      id: generatedId,
      ...data,
      source: "queue",
      endpointAnchors: {
        start: [startAnchor.lat, startAnchor.lng],
        end: [endAnchor.lat, endAnchor.lng],
      },
      geometry: {
        type: "LineString",
        coordinates: pendingFlat.map((ll) => [ll.lng, ll.lat]),
      },
      zoneId: owningZoneProps?.id || undefined,
      zoneName: owningZoneProps?.zoneName || undefined,
      status: "pending",
      predictionStatus: "pending" as const,
    };

    // 1. Add to local queue
    const queued = upsertQueueItem(pipelineObject);
    if (!queued) return;

    // 2. Attempt immediate score; if fails, it stays in queue for scheduled retry
    attemptImmediateScore(pipelineObject).catch((err) => {
      console.log(
        "[Map] Immediate score attempt failed, item in queue for retry:",
        err,
      );
    });

    // 3. Add to map layers for display
    (pendingPipelineLayer as any).feature = (pendingPipelineLayer as any)
      .feature || { type: "Feature", properties: {} };
    (pendingPipelineLayer as any).feature.properties = pipelineObject;

    console.log("[Map] Adding pipeline to allLayersRef:", generatedId);
    console.log("[Map] Layer feature:", (pendingPipelineLayer as any).feature);

    // Apply styling to the pipeline
    if (pendingPipelineLayer.setStyle) {
      pendingPipelineLayer.setStyle({
        color: "#475569",
        weight: 2,
        dashArray: "6 8",
        opacity: 0.95,
        lineCap: "round",
      });
      console.log("[Map] Applied queue pipeline styling");
    }

    allLayersRef.current.addLayer(pendingPipelineLayer);
    dedupePipelineLayers(allLayersRef.current);
    console.log(
      "[Map] allLayersRef now has",
      allLayersRef.current.getLayers().length,
      "layers",
    );

    // Also immediately add to displayFg for instant visibility
    console.log(
      "[Map] displayFg before add:",
      displayFg.getLayers().length,
      "layers",
    );
    displayFg.addLayer(pendingPipelineLayer);
    console.log(
      "[Map] displayFg after add:",
      displayFg.getLayers().length,
      "layers",
    );

    syncVisibleLayers(displayFg);
    console.log(
      "[Map] After syncVisibleLayers, displayFg has",
      displayFg.getLayers().length,
      "layers",
    );

    saveLayers(allLayersRef.current);
    // Immediately persist zone ownership with the new pipeline
    // Clear debounce timer so snapshot listeners don't delay this
    if (persistenceTimeoutIdRef.current) {
      clearTimeout(persistenceTimeoutIdRef.current);
      persistenceTimeoutIdRef.current = null;
    }
    void refreshZoneOwnershipAndStyles({ persistToFirebase: true });
    setPendingPipelineLayer(null);

    toast.success("Pipeline added.", {
      description: "Risk and confidence are being checked in the background.",
    });
    window.dispatchEvent(new Event("pipeiq_run_predict"));
  };

  const handleCancelPipeline = () => {
    if (pendingPipelineLayer && displayFg) {
      displayFg.removeLayer(pendingPipelineLayer);
    }
    setPendingPipelineLayer(null);
    toast.info("Pipeline drawing canceled.");
  };

  const handleSaveMarker = async (data: MarkerFormData) => {
    if (!pendingMarkerLayer || !displayFg) return;

    const latlng = pendingMarkerLayer.getLatLng();
    const markerId = `MK-${Number(latlng.lat).toFixed(5)}_${Number(latlng.lng).toFixed(5)}`;
    const zoneLayers: any[] = [];
    allLayersRef.current.eachLayer((layer: any) => {
      const isZone =
        layer instanceof L.Polygon ||
        layer instanceof L.Rectangle ||
        layer instanceof L.Circle;
      if (isZone) zoneLayers.push(layer);
    });
    const owningZone = findOwningZoneLayer(zoneLayers, latlng);
    const owningZoneProps = owningZone?.feature?.properties || null;

    // Build marker properties with form data
    const markerProperties: any = {
      id: markerId,
      name: data.name,
      type: data.type,
      location: data.location,
      condition: data.condition,
      status: data.condition,
      lastService: data.lastService,
      description: data.description,
      markerType: "marker",
      source: "firebase",
      zoneId: owningZoneProps?.id || undefined,
      zoneName: owningZoneProps?.zoneName || undefined,
      coordinates: [latlng.lng, latlng.lat],
    };

    // Add CircleMarker-specific metadata
    if (pendingMarkerLayer instanceof L.CircleMarker) {
      markerProperties._leafletType = "CircleMarker";
      markerProperties.radiusPixels = pendingMarkerLayer.getRadius();
    } else if (pendingMarkerLayer instanceof L.Marker) {
      markerProperties._leafletType = "Marker";
    }

    // Set marker properties
    const featureLayer = pendingMarkerLayer as unknown as {
      feature?: GeoJSON.Feature<any, any>;
    };
    featureLayer.feature = featureLayer.feature || {
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [latlng.lng, latlng.lat],
      },
      properties: {},
    };
    featureLayer.feature.properties = markerProperties;

    if (pendingMarkerLayer instanceof L.Marker) {
      pendingMarkerLayer.setIcon(makeAssetMarkerIcon());
    }

    allLayersRef.current.addLayer(pendingMarkerLayer);
    if (displayFg) syncVisibleLayers(displayFg);
    saveLayers(allLayersRef.current);

    // Save to Firebase
    saveMarkerToFirestore({
      id: markerId,
      ...markerProperties,
      coordinates: [latlng.lng, latlng.lat],
    })
      .catch((error) => {
        console.error("Failed to save marker to Firebase:", error);
        // Rollback marker if persistence fails.
        allLayersRef.current.removeLayer(pendingMarkerLayer);
        displayFg?.removeLayer(pendingMarkerLayer);
        deletableFgRef.current?.removeLayer(pendingMarkerLayer);
        toast.error("We couldn't save this asset.", {
          description: "Please try again.",
        });
        if (displayFg) syncVisibleLayers(displayFg);
        saveLayers(allLayersRef.current);
      })
      .then(() => {
        if (pendingMarkerLayer?.feature?.properties) {
          pendingMarkerLayer.feature.properties = {
            ...pendingMarkerLayer.feature.properties,
            source: "firebase",
          };
          // Immediately persist zone ownership with the new marker
          // Clear debounce timer so snapshot listeners don't delay this
          if (persistenceTimeoutIdRef.current) {
            clearTimeout(persistenceTimeoutIdRef.current);
            persistenceTimeoutIdRef.current = null;
          }
          void refreshZoneOwnershipAndStyles({ persistToFirebase: true });
          syncVisibleLayers(displayFg);
          saveLayers(allLayersRef.current);
        }
      });

    setPendingMarkerLayer(null);
    toast.success("Asset added.");
    if (!owningZoneProps?.id) {
      toast.info("Asset currently outside any zone.", {
        description:
          "When a zone includes this location, ownership updates automatically.",
      });
    }
  };

  const handleCancelMarker = () => {
    if (pendingMarkerLayer && displayFg) {
      displayFg.removeLayer(pendingMarkerLayer);
    }
    setPendingMarkerLayer(null);
    toast.info("Asset drawing canceled.");
  };

  const handleSaveZone = (data: ZoneFormData) => {
    if (!pendingZoneLayer || !displayFg) return;

    const suppliedWater = Number(data.suppliedWater);
    const wastedWater = Number(data.wastedWater);
    const meterCount = Number(data.meterCount);
    const bulkMeterCount = Number(data.bulkMeterCount);

    const normalizedData = {
      ...data,
      suppliedWater: Number.isFinite(suppliedWater) ? suppliedWater : undefined,
      wastedWater: Number.isFinite(wastedWater) ? wastedWater : undefined,
      meterCount: Number.isFinite(meterCount) ? meterCount : undefined,
      bulkMeterCount: Number.isFinite(bulkMeterCount)
        ? bulkMeterCount
        : undefined,
    };

    // Convert Leaflet shape to GeoJSON geometry
    let geometry: any = null;
    if (pendingZoneLayer instanceof L.Circle) {
      geometry = circleToGeoJSON(pendingZoneLayer);
    } else if (pendingZoneLayer instanceof L.Rectangle) {
      geometry = rectangleToGeoJSON(pendingZoneLayer);
    } else if (pendingZoneLayer instanceof L.Polygon) {
      // Regular polygon
      const latlngsRaw = pendingZoneLayer.getLatLngs() as any;
      const ring: L.LatLng[] = Array.isArray(latlngsRaw?.[0])
        ? latlngsRaw[0]
        : latlngsRaw;
      geometry = {
        type: "Polygon",
        coordinates: [ring.map((ll: L.LatLng) => [ll.lng, ll.lat])],
      };
    } else if (pendingZoneLayer instanceof L.Polyline) {
      // Regular polyline (shouldn't happen for zones, but just in case)
      const latlngs = pendingZoneLayer.getLatLngs() as L.LatLng[];
      geometry = {
        type: "LineString",
        coordinates: latlngs.map((ll) => [ll.lng, ll.lat]),
      };
    }

    if (!geometry) {
      toast.error("This zone shape is invalid.", {
        description: "Please redraw the zone and try again.",
      });
      return;
    }

    // Generate stable zone ID
    let zoneId: string;
    if (geometry.type === "Point") {
      const coords = geometry.coordinates;
      zoneId = `ZN-${Number(coords[1]).toFixed(5)}_${Number(coords[0]).toFixed(5)}`;
    } else if (geometry.type === "Polygon") {
      const coords = geometry.coordinates?.[0]?.[0];
      if (coords && coords.length >= 2) {
        zoneId = `ZN-${Number(coords[1]).toFixed(5)}_${Number(coords[0]).toFixed(5)}`;
      } else {
        zoneId = `ZN-${Math.random().toString(36).slice(2, 10)}`;
      }
    } else {
      zoneId = `ZN-${Math.random().toString(36).slice(2, 10)}`;
    }

    // Build properties with metadata for proper restoration
    const properties: any = {
      ...normalizedData,
      id: zoneId,
      type: "zone",
      source: "local",
    };

    // Add type-specific metadata
    if (pendingZoneLayer instanceof L.Circle) {
      properties._leafletType = "Circle";
      properties.radiusMeters = pendingZoneLayer.getRadius();
    } else if (pendingZoneLayer instanceof L.Rectangle) {
      properties._leafletType = "Rectangle";
    } else if (pendingZoneLayer instanceof L.Polygon) {
      properties._leafletType = "Polygon";
    }

    // Save form data to GeoJSON properties
    (pendingZoneLayer as any).feature = {
      type: "Feature",
      geometry,
      properties,
    };

    allLayersRef.current.addLayer(pendingZoneLayer);
    syncVisibleLayers(displayFg);
    saveLayers(allLayersRef.current);
    // Immediately persist zone ownership
    // Clear debounce timer so snapshot listeners don't delay this
    if (persistenceTimeoutIdRef.current) {
      clearTimeout(persistenceTimeoutIdRef.current);
      persistenceTimeoutIdRef.current = null;
    }
    void refreshZoneOwnershipAndStyles({ persistToFirebase: true });

    // Save to Firebase with all metadata
    saveZoneToFirestore({
      id: zoneId,
      ...normalizedData,
      ...properties,
      geometry,
      type: "zone",
      source: "firebase",
    })
      .catch((error) => {
        console.error("Failed to save zone to Firebase:", error);
        toast.error("Zone saved on this device.", {
          description: "Cloud sync will retry automatically.",
        });
      })
      .then(() => {
        if ((pendingZoneLayer as any)?.feature?.properties) {
          (pendingZoneLayer as any).feature.properties = {
            ...(pendingZoneLayer as any).feature.properties,
            source: "firebase",
          };
          // Clear debounce again and persist immediately after Firebase save succeeds
          if (persistenceTimeoutIdRef.current) {
            clearTimeout(persistenceTimeoutIdRef.current);
            persistenceTimeoutIdRef.current = null;
          }
          void refreshZoneOwnershipAndStyles({ persistToFirebase: true });
          syncVisibleLayers(displayFg);
          saveLayers(allLayersRef.current);
        }
      });

    setPendingZoneLayer(null);
    toast.success("Zone added.");
  };

  const handleCancelZone = () => {
    if (pendingZoneLayer && displayFg) {
      displayFg.removeLayer(pendingZoneLayer);
    }
    setPendingZoneLayer(null);
    toast.info("Zone drawing canceled.");
  };

  return (
    <>
      <PipelineDataModal
        isOpen={!!pendingPipelineLayer}
        onSave={handleSavePipeline}
        onCancel={handleCancelPipeline}
      />
      <ZoneDataModal
        isOpen={!!pendingZoneLayer}
        onSave={handleSaveZone}
        onCancel={handleCancelZone}
      />
      <MarkerDataModal
        isOpen={!!pendingMarkerLayer}
        onSave={handleSaveMarker}
        onCancel={handleCancelMarker}
      />

      {/* Custom Confirmation Dialog for Edit Deletions */}
      <AnimatePresence>
        {deleteConfirmLayers && (
          <div className="fixed inset-0 z-[10000] flex items-center justify-center pointer-events-auto p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-900/20 dark:bg-black/60 backdrop-blur-md"
              onClick={() => {
                if (isConfirmDeleting) return;
                setDeleteConfirmLayers(null);
                toast.info("Deletion canceled.");
              }}
            />
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10 }}
              className="bg-white/40 dark:bg-slate-900/95 backdrop-blur-3xl rounded-3xl shadow-[0_8px_32px_0_rgba(31,38,135,0.15)] dark:shadow-[0_8px_32px_0_rgba(0,0,0,0.5)] p-7 max-w-sm w-full border border-white/50 dark:border-white/10 relative z-10"
            >
              <div className="flex flex-col items-center text-center">
                <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-500/10 flex items-center justify-center mb-4 text-red-600">
                  <AlertCircle size={32} />
                </div>
                <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
                  Delete Map Features
                </h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-8 px-2">
                  Are you sure you want to permanently delete{" "}
                  {deleteConfirmLayers.length} shape(s) from the map?
                </p>

                <div className="flex gap-3 w-full">
                  <button
                    onClick={() => {
                      if (isConfirmDeleting) return;
                      setDeleteConfirmLayers(null);
                      toast.info("Deletion canceled.");
                    }}
                    disabled={isConfirmDeleting}
                    className="flex-1 px-4 py-3 rounded-xl text-sm font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={async () => {
                      if (isConfirmDeleting) return;
                      setIsConfirmDeleting(true);
                      try {
                        const layers = deleteConfirmLayers || [];
                        const failedPipelineIds: string[] = [];
                        const failedZoneIds: string[] = [];
                        const failedMarkerIds: string[] = [];
                        const layersToRemoveLocally: any[] = [];
                        const deletedPipelineIds = new Set<string>();
                        const deletedZoneIds = new Set<string>();
                        const deletedMarkerIds = new Set<string>();

                        for (const layer of layers) {
                          const isZone =
                            layer instanceof L.Polygon ||
                            layer instanceof L.Rectangle ||
                            layer instanceof L.Circle;
                          const isPipe = layer instanceof L.Polyline && !isZone;
                          const isMarker =
                            layer instanceof L.Marker ||
                            layer instanceof L.CircleMarker;
                          const props = layer?.feature?.properties || {};
                          const source = String(
                            props.source || "",
                          ).toLowerCase();

                          if (isZone) {
                            // Handle zone deletion
                            let zoneId = props.id || props.zoneId;

                            if (source === "local") {
                              if (zoneId) deletedZoneIds.add(String(zoneId));
                              layersToRemoveLocally.push(layer);
                              continue;
                            }

                            if (!zoneId && layer instanceof L.Circle) {
                              const center = layer.getLatLng();
                              const radius = Math.round(layer.getRadius());
                              zoneId = `zone_circle_${center.lat.toFixed(5)}_${center.lng.toFixed(5)}_${radius}`;
                            }

                            if (!zoneId) {
                              if (source === "firebase") {
                                failedZoneIds.push("unknown-zone-id");
                                continue;
                              }
                              layersToRemoveLocally.push(layer);
                              continue;
                            }

                            try {
                              console.log(
                                "[Map] Deleting zone from Firestore:",
                                zoneId,
                              );
                              await deleteZoneFromFirestore(String(zoneId));
                              console.log(
                                "[Map] Successfully deleted zone:",
                                zoneId,
                              );
                              deletedZoneIds.add(String(zoneId));
                              layersToRemoveLocally.push(layer);
                            } catch (_error) {
                              console.error(
                                "[Map] Failed to delete zone:",
                                zoneId,
                                _error,
                              );
                              failedZoneIds.push(String(zoneId));
                            }
                          } else if (isMarker) {
                            // Handle marker deletion
                            const markerId = props.id || props.markerId;

                            if (source === "local") {
                              if (markerId)
                                deletedMarkerIds.add(String(markerId));
                              layersToRemoveLocally.push(layer);
                              continue;
                            }

                            if (!markerId) {
                              if (source === "firebase") {
                                failedMarkerIds.push("unknown-marker-id");
                                continue;
                              }
                              layersToRemoveLocally.push(layer);
                              continue;
                            }

                            try {
                              console.log(
                                "[Map] Deleting marker from Firestore:",
                                markerId,
                              );
                              await deleteMarkerFromFirestore(String(markerId));
                              console.log(
                                "[Map] Successfully deleted marker:",
                                markerId,
                              );
                              deletedMarkerIds.add(String(markerId));
                              layersToRemoveLocally.push(layer);
                            } catch (_error) {
                              console.error(
                                "[Map] Failed to delete marker:",
                                markerId,
                                _error,
                              );
                              failedMarkerIds.push(String(markerId));
                            }
                          } else if (isPipe) {
                            // Handle pipeline deletion
                            let pipelineId = props.id || props.pipelineId;

                            if (!pipelineId) {
                              const latlngs = (
                                layer as L.Polyline
                              ).getLatLngs();
                              const flat = Array.isArray(latlngs[0])
                                ? (latlngs as L.LatLng[][])[0]
                                : (latlngs as L.LatLng[]);
                              if (flat.length >= 2) {
                                pipelineId = generateStablePipelineId(
                                  props,
                                  flat[0],
                                  flat[flat.length - 1],
                                );
                              }
                            }

                            if (!pipelineId) {
                              layersToRemoveLocally.push(layer);
                              continue;
                            }

                            const queueItem = getQueue().find(
                              (item) => item?.id === pipelineId,
                            );
                            if (queueItem) {
                              removeQueueItem(pipelineId);
                              deletedPipelineIds.add(String(pipelineId));
                              layersToRemoveLocally.push(layer);
                              continue;
                            }

                            try {
                              console.log(
                                "[Map] Deleting pipeline from Firestore:",
                                pipelineId,
                              );
                              await deletePipelineFromFirestore(
                                String(pipelineId),
                              );
                              console.log(
                                "[Map] Successfully deleted pipeline:",
                                pipelineId,
                              );
                              deletedPipelineIds.add(String(pipelineId));
                              layersToRemoveLocally.push(layer);
                            } catch (_error) {
                              console.error(
                                "[Map] Failed to delete pipeline:",
                                pipelineId,
                                _error,
                              );
                              failedPipelineIds.push(String(pipelineId));
                            }
                          } else {
                            // Unknown type - just remove locally
                            layersToRemoveLocally.push(layer);
                          }
                        }

                        // Remove any duplicate overlays representing the same deleted entity.
                        // This prevents requiring a second delete click when stacked layers exist.
                        allLayersRef.current.eachLayer((layer: any) => {
                          const props = layer?.feature?.properties || {};
                          const isZone =
                            layer instanceof L.Polygon ||
                            layer instanceof L.Rectangle ||
                            layer instanceof L.Circle;
                          const isPipe = layer instanceof L.Polyline && !isZone;
                          const isMarker =
                            layer instanceof L.Marker ||
                            layer instanceof L.CircleMarker;

                          if (isPipe) {
                            const pipelineId = props.id || props.pipelineId;
                            if (
                              pipelineId &&
                              deletedPipelineIds.has(String(pipelineId))
                            ) {
                              layersToRemoveLocally.push(layer);
                            }
                          } else if (isZone) {
                            const zoneId = props.id || props.zoneId;
                            if (zoneId && deletedZoneIds.has(String(zoneId))) {
                              layersToRemoveLocally.push(layer);
                            }
                          } else if (isMarker) {
                            const markerId = props.id || props.markerId;
                            if (
                              markerId &&
                              deletedMarkerIds.has(String(markerId))
                            ) {
                              layersToRemoveLocally.push(layer);
                            }
                          }
                        });

                        const uniqueLayersToRemove = Array.from(
                          new Set(layersToRemoveLocally),
                        );

                        uniqueLayersToRemove.forEach((layer) => {
                          displayFg?.removeLayer(layer);
                          deletableFgRef.current?.removeLayer(layer);
                          allLayersRef.current.removeLayer(layer);
                        });

                        if (displayFg) syncVisibleLayers(displayFg);
                        saveLayers(allLayersRef.current);
                        window.dispatchEvent(
                          new Event("pipeiq_map_layers_updated"),
                        );

                        const failureMessages: string[] = [];
                        if (failedPipelineIds.length > 0) {
                          failureMessages.push(
                            `${failedPipelineIds.length} pipeline${failedPipelineIds.length > 1 ? "s" : ""}`,
                          );
                        }
                        if (failedZoneIds.length > 0) {
                          failureMessages.push(
                            `${failedZoneIds.length} zone${failedZoneIds.length > 1 ? "s" : ""}`,
                          );
                        }
                        if (failedMarkerIds.length > 0) {
                          failureMessages.push(
                            `${failedMarkerIds.length} marker${failedMarkerIds.length > 1 ? "s" : ""}`,
                          );
                        }

                        if (failureMessages.length > 0) {
                          toast.error("Some items could not be deleted.", {
                            description: "Please try again.",
                          });
                        } else {
                          toast.success("Selected map items deleted.");
                        }

                        setDeleteConfirmLayers(null);
                      } finally {
                        setIsConfirmDeleting(false);
                      }
                    }}
                    disabled={isConfirmDeleting}
                    className="flex-1 px-4 py-3 rounded-xl text-sm font-semibold bg-red-500 text-white hover:bg-red-600 transition-colors shadow-lg shadow-red-500/20 disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {isConfirmDeleting && (
                      <Loader2 size={14} className="animate-spin" />
                    )}
                    {isConfirmDeleting ? "Deleting..." : "Yes, Delete"}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
};

// Component to handle map interaction capability based on route
const MapInteractionHandler = ({
  isInteractive,
}: {
  isInteractive: boolean;
}) => {
  const map = useMap();

  useEffect(() => {
    const toggle = isInteractive ? "enable" : "disable";

    // Some handlers can be temporarily unavailable during map/control re-init.
    (map.dragging as any)?.[toggle]?.();
    (map.touchZoom as any)?.[toggle]?.();
    (map.doubleClickZoom as any)?.[toggle]?.();
    (map.scrollWheelZoom as any)?.[toggle]?.();
    (map.boxZoom as any)?.[toggle]?.();
    (map.keyboard as any)?.[toggle]?.();
  }, [map, isInteractive]);

  return null;
};

const LocateMeHandler = () => {
  const map = useMap();
  const markerRef = useRef<L.CircleMarker | null>(null);
  const accuracyRef = useRef<L.Circle | null>(null);
  const locatingRef = useRef(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [manualLat, setManualLat] = useState("");
  const [manualLng, setManualLng] = useState("");

  const showLocation = useCallback(
    ({
      latitude,
      longitude,
      accuracy,
      label = "Location found",
      withAccuracy = true,
    }: {
      latitude: number;
      longitude: number;
      accuracy?: number | null;
      label?: string;
      withAccuracy?: boolean;
    }) => {
      const latLng: L.LatLngExpression = [latitude, longitude];

      markerRef.current?.remove();
      accuracyRef.current?.remove();

      if (withAccuracy) {
        accuracyRef.current = L.circle(latLng, {
          radius: Math.max(accuracy || 25, 25),
          color: "#0284c7",
          fillColor: "#38bdf8",
          fillOpacity: 0.12,
          weight: 1,
        }).addTo(map);
      }

      markerRef.current = L.circleMarker(latLng, {
        radius: 7,
        color: "#ffffff",
        fillColor: "#0284c7",
        fillOpacity: 1,
        weight: 3,
      }).addTo(map);

      map.flyTo(latLng, Math.max(map.getZoom(), 16), {
        animate: true,
        duration: 0.8,
      });
      toast.success(label, { id: "locate-me" });
    },
    [map],
  );

  useEffect(() => {
    const showPosition = (position: GeolocationPosition) => {
      const { latitude, longitude, accuracy } = position.coords;
      showLocation({ latitude, longitude, accuracy });
      setManualLat(latitude.toFixed(6));
      setManualLng(longitude.toFixed(6));
      setPanelOpen(false);
    };

    const getPosition = (options: PositionOptions) =>
      new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, options);
      });

    const watchForPosition = () =>
      new Promise<GeolocationPosition>((resolve, reject) => {
        let settled = false;
        const timeoutId = window.setTimeout(() => {
          if (settled) return;
          settled = true;
          navigator.geolocation.clearWatch(watchId);
          reject(new Error("Location watch timed out"));
        }, 30000);

        const watchId = navigator.geolocation.watchPosition(
          (position) => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timeoutId);
            navigator.geolocation.clearWatch(watchId);
            resolve(position);
          },
          (error) => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timeoutId);
            navigator.geolocation.clearWatch(watchId);
            reject(error);
          },
          {
            enableHighAccuracy: false,
            timeout: 30000,
            maximumAge: 300000,
          },
        );
      });

    const getLocationErrorMessage = (error: unknown) => {
      const code =
        typeof error === "object" && error && "code" in error
          ? (error as GeolocationPositionError).code
          : undefined;
      if (code === 1) {
        return "Location permission was denied";
      }
      if (code === 2) {
        return "Location is still being resolved. Try again, move near a window, or allow precise location.";
      }
      if (code === 3) {
        return "Location is taking longer than usual. Try again in a moment.";
      }
      return "Location is temporarily unavailable. Try again in a moment.";
    };

    const locate = () => {
      if (!navigator.geolocation) {
        toast.error("Location is not available on this device");
        return;
      }
      if (locatingRef.current) return;

      locatingRef.current = true;
      toast.loading("Finding your location...", { id: "locate-me" });
      void (async () => {
        try {
          try {
            showPosition(
              await getPosition({
                enableHighAccuracy: false,
                timeout: 6000,
                maximumAge: 300000,
              }),
            );
            return;
          } catch {
            toast.loading("Checking live device location...", {
              id: "locate-me",
            });
          }

          try {
            showPosition(
              await getPosition({
                enableHighAccuracy: true,
                timeout: 18000,
                maximumAge: 30000,
              }),
            );
            return;
          } catch {
            toast.loading("Still searching for device location...", {
              id: "locate-me",
            });
          }

          try {
            showPosition(
              await getPosition({
                enableHighAccuracy: false,
                timeout: 20000,
                maximumAge: 300000,
              }),
            );
            return;
          } catch {
            toast.loading("Waiting for a location update...", {
              id: "locate-me",
            });
          }

          showPosition(await watchForPosition());
        } catch (error) {
          const code =
            typeof error === "object" && error && "code" in error
              ? (error as GeolocationPositionError).code
              : undefined;
          const message = getLocationErrorMessage(error);
          if (code === 1) {
            toast.error(message, { id: "locate-me" });
          } else {
            toast.info(message, { id: "locate-me" });
          }
        } finally {
          locatingRef.current = false;
        }
      })();
    };

    const onDockAction = (event: Event) => {
      const action = (event as CustomEvent<{ action?: string }>).detail?.action;
      if (action === "locateMe") setPanelOpen(true);
    };

    const openLocatePanel = () => setPanelOpen(true);

    window.addEventListener("pipeiq_locate_me", openLocatePanel);
    window.addEventListener("pipeiq_use_device_location", locate);
    window.addEventListener("pipeiq_dock_action", onDockAction as EventListener);
    return () => {
      window.removeEventListener("pipeiq_locate_me", openLocatePanel);
      window.removeEventListener("pipeiq_use_device_location", locate);
      window.removeEventListener(
        "pipeiq_dock_action",
        onDockAction as EventListener,
      );
      markerRef.current?.remove();
      accuracyRef.current?.remove();
    };
  }, [showLocation]);

  const parsedLat = Number(manualLat);
  const parsedLng = Number(manualLng);
  const coordsAreNumeric =
    Number.isFinite(parsedLat) && Number.isFinite(parsedLng);
  const coordsAreValid =
    coordsAreNumeric &&
    Math.abs(parsedLat) <= 90 &&
    Math.abs(parsedLng) <= 180;
  const outsideSriLanka =
    coordsAreValid &&
    (parsedLat < 5.8 || parsedLat > 10 || parsedLng < 79.3 || parsedLng > 82.2);

  const goToManualLocation = () => {
    if (!coordsAreValid) {
      toast.error("Enter valid latitude and longitude values.", {
        id: "locate-me",
      });
      return;
    }

    showLocation({
      latitude: parsedLat,
      longitude: parsedLng,
      label: outsideSriLanka
        ? "Moved to coordinates outside Sri Lanka"
        : "Moved to coordinates",
      withAccuracy: false,
    });
    setPanelOpen(false);
  };

  if (!panelOpen) return null;

  return (
    <div className="absolute left-1/2 top-24 z-[650] w-[min(92vw,360px)] -translate-x-1/2 rounded-2xl border border-white/45 bg-white/90 p-4 text-slate-900 shadow-xl shadow-black/15 backdrop-blur-xl dark:border-slate-700/70 dark:bg-slate-900/90 dark:text-slate-100">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Locate coordinates</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Enter coordinates or use device location.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setPanelOpen(false)}
          className="rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          Close
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
          Latitude
          <input
            value={manualLat}
            onChange={(event) => setManualLat(event.target.value)}
            inputMode="decimal"
            placeholder="6.9271"
            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
        </label>
        <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
          Longitude
          <input
            value={manualLng}
            onChange={(event) => setManualLng(event.target.value)}
            inputMode="decimal"
            placeholder="79.8612"
            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
        </label>
      </div>

      {outsideSriLanka && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
          Warning: these coordinates appear to be outside Sri Lanka.
        </p>
      )}

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={goToManualLocation}
          className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700 dark:bg-amber-300 dark:text-slate-950 dark:hover:bg-amber-200"
        >
          Go
        </button>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event("pipeiq_use_device_location"))}
          className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          Use device location
        </button>
      </div>
    </div>
  );
};

import LayerControl from "./LayerControl";

type BandFilter = "all" | "low" | "medium" | "high";

const MapComponent = ({
  onPendingCountChange,
  sidebarCollapsed = false,
}: {
  onPendingCountChange?: (count: number) => void;
  sidebarCollapsed?: boolean;
}) => {
  // Fit the full Sri Lanka extent on first load.
  const sriLankaBounds: L.LatLngBoundsExpression = [
    [5.85, 79.4],
    [9.95, 82.1],
  ];
  const pathname = usePathname();
  const router = useRouter();
  const isHome = pathname === "/";

  const [showPipelines, setShowPipelines] = useState(true);
  const [showZones, setShowZones] = useState(true);
  const [showAssets, setShowAssets] = useState(true);
  const [riskFilter, setRiskFilter] = useState<BandFilter>("all");
  const [confidenceFilter, setConfidenceFilter] = useState<BandFilter>("all");
  const [isEditorMode, setIsEditorMode] = useState(true);
  const [mapStyle, setMapStyle] = useState<"light" | "street" | "satellite">(
    "street",
  );

  const handlePipelineSelect = useCallback(
    (pipelineId: string) => {
      localStorage.setItem("pipeiq_pipelines_highlighted", pipelineId);
      window.dispatchEvent(new Event("pipeiq_pipeline_selected"));
      if (pathname !== "/pipelines") {
        router.push("/pipelines");
      }
    },
    [pathname, router],
  );

  return (
    <div className="h-full w-full relative group" data-map-style={mapStyle}>
      {/* Map Controls Overlay - Only show on home map page */}
      {isHome && (
        <div className="absolute top-4 right-4 z-[1000]">
          <LayerControl
            showPipelines={showPipelines}
            setShowPipelines={setShowPipelines}
            showZones={showZones}
            setShowZones={setShowZones}
            showAssets={showAssets}
            setShowAssets={setShowAssets}
            mapStyle={mapStyle}
            setMapStyle={setMapStyle}
            riskFilter={riskFilter}
            setRiskFilter={setRiskFilter}
            confidenceFilter={confidenceFilter}
            setConfidenceFilter={setConfidenceFilter}
            isEditorMode={isEditorMode}
            setIsEditorMode={setIsEditorMode}
          />
        </div>
      )}

      <MapContainer
        bounds={sriLankaBounds}
        boundsOptions={{ padding: [24, 24] }}
        style={{ height: "100%", width: "100%" }}
        className="z-0"
        zoomControl={false}
        attributionControl={false}
      >
        <LocateMeHandler />
        <MapInteractionHandler isInteractive={isHome} />

        {/* Dynamic Tile Layer */}
        {mapStyle === "light" && (
          <TileLayer
            attribution='&copy; <a href="https://carto.com/attributions">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          />
        )}
        {mapStyle === "street" && (
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
        )}
        {mapStyle === "satellite" && (
          <TileLayer
            attribution="Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community"
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          />
        )}

        {/* Core Data Layers */}
        <MapValues
          isEditorMode={isEditorMode}
          showPipelines={showPipelines}
          showZones={showZones}
          showAssets={showAssets}
          riskFilter={riskFilter}
          confidenceFilter={confidenceFilter}
          onPendingCountChange={onPendingCountChange}
          onPipelineSelect={handlePipelineSelect}
        />
      </MapContainer>

      {/* macOS-style Dock at bottom center */}
      <MapDock
        sidebarCollapsed={sidebarCollapsed}
        isEditorMode={isEditorMode}
      />

      <style jsx global>{`
        /* Keep Leaflet draw controls mounted for dock actions, but remove side toolbar from view. */
        .leaflet-left .leaflet-draw {
          position: absolute !important;
          left: -10000px !important;
          top: -10000px !important;
        }
      `}</style>
    </div>
  );
};

export default MapComponent;
