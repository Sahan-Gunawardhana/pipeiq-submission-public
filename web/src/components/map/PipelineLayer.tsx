"use client";

import { GeoJSON, useMapEvents, useMap } from "react-leaflet";
import { useRef, useEffect } from "react";
import L from "leaflet";
import { PipelineProperties } from "@/lib/mock-data";

interface PipelineLayerProps {
  data: GeoJSON.FeatureCollection;
  onSelectPipeline?: (pipeline: PipelineProperties) => void;
}

const getRiskColor = (
  riskBand?: string,
  score01?: number,
  score100?: number,
) => {
  const normalizedBand = String(riskBand || "").toLowerCase();
  if (normalizedBand === "high") return "#DC2626";
  if (normalizedBand === "medium") return "#D97706";
  if (normalizedBand === "low") return "#059669";

  const normalizedScore01 = Number(score01);
  if (Number.isFinite(normalizedScore01)) {
    if (normalizedScore01 >= 0.5) return "#DC2626";
    if (normalizedScore01 >= 0.27) return "#D97706";
    return "#059669";
  }

  const normalizedScore100 = Number(score100);
  if (Number.isFinite(normalizedScore100)) {
    if (normalizedScore100 >= 75) return "#DC2626";
    if (normalizedScore100 >= 40) return "#D97706";
  }

  return "#059669";
};

export default function PipelineLayer({
  data,
  onSelectPipeline,
}: PipelineLayerProps) {
  const geoJsonRef = useRef<L.GeoJSON>(null);
  const map = useMap();

  const updateWeights = () => {
    if (!geoJsonRef.current) return;
    const scale = Math.pow(2, map.getZoom() - 14);
    geoJsonRef.current.eachLayer((layer: any) => {
      if (layer.setStyle) {
        if (layer.options.baseWeight === undefined) {
          layer.options.baseWeight = layer.options.weight || 4;
        }
        layer.setStyle({ weight: layer.options.baseWeight * scale });
      }
    });
  };

  useMapEvents({
    zoomend: updateWeights,
  });

  useEffect(() => {
    updateWeights();
  }, [data, map]);

  const onEachFeature = (feature: GeoJSON.Feature, layer: L.Layer) => {
    layer.on({
      mouseover: (e) => {
        const layer = e.target;
        const scale = Math.pow(2, map.getZoom() - 14);
        layer.setStyle({
          weight: 6 * scale,
          opacity: 1,
        });
      },
      mouseout: (e) => {
        const layer = e.target;
        const scale = Math.pow(2, map.getZoom() - 14);
        layer.setStyle({
          weight: 4 * scale,
          opacity: 0.8,
        });
      },
      click: (e) => {
        const props = feature.properties as PipelineProperties;
        if (onSelectPipeline) {
          onSelectPipeline(props);
        }
        L.DomEvent.stopPropagation(e); // Prevent map click
      },
    });
  };

  const style = (feature: any) => {
    const riskBand =
      feature?.properties?.risk_band || feature?.properties?.riskLevel;
    const riskScore01 = feature?.properties?.risk_score;
    const riskScore100 = feature?.properties?.riskScore;
    const scale = Math.pow(2, map.getZoom() - 14);
    return {
      color: getRiskColor(riskBand, riskScore01, riskScore100),
      weight: 4 * scale,
      baseWeight: 4, // Custom property for dynamic scaling
      opacity: 0.8,
      lineCap: "round" as CanvasLineCap,
      lineJoin: "round" as CanvasLineJoin,
    } as any;
  };

  // Key ensures re-render when data changes
  return (
    <GeoJSON
      ref={geoJsonRef}
      key="pipelines-layer"
      data={data}
      style={style}
      onEachFeature={onEachFeature}
    />
  );
}
