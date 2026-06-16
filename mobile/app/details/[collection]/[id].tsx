import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Platform,
  Image,
  Modal,
  TouchableOpacity,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { ScreenHeader } from "../../../components/ScreenHeader";
import { useThemeColor } from "@/hooks/use-theme-color";
import {
  subscribeToFirestoreDocument,
  subscribeToMarkers,
  subscribeToPipelines,
} from "../../../lib/firebase";

type DetailCollection = "pipelines" | "zones" | "markers";

const COLLECTION_LABELS: Record<DetailCollection, string> = {
  pipelines: "Pipeline",
  zones: "Zone",
  markers: "Asset",
};

const normalizeCollection = (value: unknown): DetailCollection | null => {
  if (value === "pipelines" || value === "zones" || value === "markers") {
    return value;
  }
  return null;
};

const getDisplayDate = (value: any) => {
  if (!value) return "N/A";

  if (typeof value?.toDate === "function") {
    return value.toDate().toLocaleString();
  }

  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return new Date(numeric).toLocaleString();
  }

  const parsed = new Date(String(value));
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toLocaleString();
  }

  return String(value);
};

const formatValue = (value: any) => {
  if (value === undefined || value === null || value === "") return "N/A";
  if (typeof value === "number")
    return Number.isFinite(value) ? String(value) : "N/A";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
};

const formatPercentMaybe = (value: any) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return formatValue(value);
  if (numeric <= 1) return `${Math.round(numeric * 100)}%`;
  return `${Math.round(numeric)}%`;
};

const getTone = (value: any) => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "high" || normalized === "critical") {
    return { bg: "#FEE2E2", fg: "#991B1B", gradient: "#FECACA" };
  }
  if (normalized === "medium" || normalized === "maintenance") {
    return { bg: "#FEF3C7", fg: "#92400E", gradient: "#FCD34D" };
  }
  if (
    normalized === "active" ||
    normalized === "low" ||
    normalized === "complete"
  ) {
    return { bg: "#DCFCE7", fg: "#166534", gradient: "#A7F3D0" };
  }
  return { bg: "#E2E8F0", fg: "#334155", gradient: "#CBD5E1" };
};

type DetailField = { label: string; value: any };
type DetailSection = { title: string; fields: DetailField[] };

const getZoneRef = (record: any) =>
  String(record?.zoneId ?? record?.zone ?? record?.dmaId ?? record?.dma_id ?? record?.zone_id ?? "");

const isRecordInZone = (record: any, zoneId: string) => getZoneRef(record) === zoneId;

type RepairHistoryEntry = {
  repairId?: string;
  issueType?: string;
  repairType?: string;
  severity?: string;
  flowRate?: string | number;
  waterLoss?: string | number;
  notes?: string;
  depthM?: number;
  source?: string;
  imageUrls?: string[];
  imageUrl?: string;
  createdAt?: unknown;
  timestamp?: unknown;
  repairedAt?: unknown;
  repairAt?: unknown;
  date?: unknown;
  createdAtIso?: string;
  createdAtMs?: number;
};

const toDateFromValue = (value: unknown): Date | null => {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;

  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (typeof value === "object") {
    const candidate = value as {
      toDate?: () => Date;
      seconds?: number;
      nanoseconds?: number;
    };

    if (typeof candidate.toDate === "function") {
      const parsed = candidate.toDate();
      return parsed instanceof Date && !Number.isNaN(parsed.getTime())
        ? parsed
        : null;
    }

    if (Number.isFinite(candidate.seconds)) {
      const parsed = new Date(
        (candidate.seconds ?? 0) * 1000 + (candidate.nanoseconds ?? 0) / 1e6,
      );
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
  }

  return null;
};

const getRepairDate = (entry: RepairHistoryEntry) => {
  return (
    toDateFromValue(entry.createdAt) ||
    toDateFromValue(entry.createdAtIso) ||
    toDateFromValue(entry.createdAtMs) ||
    toDateFromValue(entry.timestamp) ||
    toDateFromValue(entry.repairedAt) ||
    toDateFromValue(entry.repairAt) ||
    toDateFromValue(entry.date)
  );
};

const formatRepairDate = (entry: RepairHistoryEntry) => {
  const date = getRepairDate(entry);
  return date ? date.toLocaleString() : "Unknown date";
};

const normalizeRepairHistory = (value: unknown): RepairHistoryEntry[] => {
  if (!Array.isArray(value)) return [];

  return value
    .filter(
      (entry): entry is RepairHistoryEntry =>
        !!entry && typeof entry === "object",
    )
    .map((entry) => ({
      ...entry,
      imageUrls: [
        ...(Array.isArray(entry.imageUrls) ? entry.imageUrls : []),
        ...(typeof entry.imageUrl === "string" ? [entry.imageUrl] : []),
      ].filter(
        (url): url is string =>
          typeof url === "string" && url.trim().length > 0,
      ),
    }))
    .sort((a, b) => {
      const aTime = getRepairDate(a)?.getTime() ?? 0;
      const bTime = getRepairDate(b)?.getTime() ?? 0;
      return bTime - aTime;
    });
};

const buildSections = (
  collection: DetailCollection,
  record: any,
): DetailSection[] => {
  if (collection === "pipelines") {
    return [
      {
        title: "Identity",
        fields: [
          { label: "Pipeline ID", value: record.id },
          {
            label: "Zone ID",
            value:
              record.zoneId || record.dmaId || record.zone || record.dma_id,
          },
          { label: "Status", value: record.status },
          { label: "Prediction Status", value: record.predictionStatus },
        ],
      },
      {
        title: "Route",
        fields: [
          {
            label: "Start Location",
            value: record.startLocation || record.startPoint || record.start,
          },
          {
            label: "End Location",
            value: record.endLocation || record.endPoint || record.end,
          },
          {
            label: "Pipe Length (m)",
            value: record.pipeLengthM || record.pipe_length_m,
          },
          {
            label: "Road Category",
            value: record.roadCategory || record.road_category,
          },
        ],
      },
      {
        title: "Condition and Risk",
        fields: [
          {
            label: "Installation Year",
            value: record.installationYear || record.install_year,
          },
          { label: "Material", value: record.material },
          {
            label: "Diameter (mm)",
            value: record.diameter || record.diameter_mm,
          },
          {
            label: "Elevation (m)",
            value: record.elevationM || record.elevation_m,
          },
          {
            label: "Operating Pressure",
            value: record.operatingPressure || record.pressure_bar,
          },
          {
            label: "Past Repairs",
            value:
              record.pastRepairs || record.repairs || record.n_past_repairs,
          },
          { label: "Soil Type", value: record.soilType || record.soil_type },
          { label: "Depth (m)", value: record.depthM || record.depth_m },
          {
            label: "Risk Score",
            value:
              record.riskScore ??
              (Number.isFinite(Number(record.risk_score))
                ? Math.round(Number(record.risk_score) * 100)
                : undefined),
          },
          {
            label: "Risk Band",
            value: record.riskBand || record.risk_band || record.riskLevel,
          },
          {
            label: "Confidence Band",
            value: record.confidenceBand || record.confidence_band,
          },
        ],
      },
    ];
  }

  if (collection === "zones") {
    return [
      {
        title: "Identity",
        fields: [
          { label: "Zone ID", value: record.id },
          { label: "Zone Name", value: record.zoneName || record.name },
          { label: "Area Type", value: record.type || record.areaType },
          { label: "Priority", value: record.priority },
        ],
      },
      {
        title: "Network Summary",
        fields: [
          {
            label: "Pipe Count",
            value: record.pipeCount ?? record.ownedPipelineCount,
          },
          {
            label: "Asset Count",
            value: record.assetCount ?? record.ownedAssetCount,
          },
          { label: "High Risk Pipes", value: record.highRiskPipes },
          {
            label: "Average Risk",
            value: record.avgRisk ?? record.zoneRiskScore,
          },
          {
            label: "NRW Percent",
            value: formatPercentMaybe(record.nrwPercent),
          },
        ],
      },
    ];
  }

  return [
    {
      title: "Identity",
      fields: [
        { label: "Asset ID", value: record.markerId || record.id },
        { label: "Asset Name", value: record.name || record.assetName },
        { label: "Type", value: record.type },
      ],
    },
    {
      title: "Assignment and Condition",
      fields: [
        {
          label: "Zone",
          value: record.zoneName || record.zone || record.zoneId,
        },
        { label: "Location", value: record.location || record.address },
        {
          label: "Severity",
          value: record.severity || record.priority || record.riskLevel,
        },
        { label: "Status", value: record.status || record.condition },
      ],
    },
  ];
};

const FieldRow = ({
  label,
  value,
  textColor,
  subtextColor,
  borderColor,
}: {
  label: string;
  value: any;
  textColor: string;
  subtextColor: string;
  borderColor: string;
}) => (
  <View style={[styles.fieldRow, { borderBottomColor: borderColor }]}>
    <Text style={[styles.fieldLabel, { color: subtextColor }]}>{label}</Text>
    <Text
      style={[styles.fieldValueRow, { color: textColor }]}
      numberOfLines={2}
      ellipsizeMode="tail"
    >
      {formatValue(value)}
    </Text>
  </View>
);

export default function RecordDetailsScreen() {
  const params = useLocalSearchParams<{ collection?: string; id?: string }>();
  const collection = normalizeCollection(params.collection);
  const documentId = typeof params.id === "string" ? params.id : "";

  const backgroundColor = useThemeColor({}, "background");
  const cardColor = useThemeColor({}, "card");
  const textColor = useThemeColor({}, "text");
  const subtextColor = useThemeColor({}, "subtext");
  const borderColor = useThemeColor({}, "border");
  const tintColor = useThemeColor({}, "tint");

  const [record, setRecord] = React.useState<any | null>(null);
  const [pipelines, setPipelines] = React.useState<any[]>([]);
  const [markers, setMarkers] = React.useState<any[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [selectedRepairImageUrl, setSelectedRepairImageUrl] = React.useState<
    string | null
  >(null);
  const [repairImageLoadState, setRepairImageLoadState] = React.useState<
    Record<string, "loading" | "loaded" | "error">
  >({});

  React.useEffect(() => {
    if (!collection || !documentId) {
      setIsLoading(false);
      return;
    }

    const unsubscribe = subscribeToFirestoreDocument(
      collection,
      documentId,
      (data) => {
        setRecord(data);
        setIsLoading(false);
      },
    );

    return () => unsubscribe();
  }, [collection, documentId]);

  React.useEffect(() => {
    if (collection !== "zones") {
      setPipelines([]);
      setMarkers([]);
      return;
    }

    const unsubscribePipelines = subscribeToPipelines(setPipelines);
    const unsubscribeMarkers = subscribeToMarkers(setMarkers);

    return () => {
      unsubscribePipelines();
      unsubscribeMarkers();
    };
  }, [collection]);

  const displayRecord = React.useMemo(() => {
    if (collection !== "zones" || !record) {
      return record;
    }

    const zoneId = String(record.id || documentId);
    const calculatedPipeCount = pipelines.filter((pipeline) =>
      isRecordInZone(pipeline, zoneId),
    ).length;
    const calculatedAssetCount = markers.filter((marker) =>
      isRecordInZone(marker, zoneId),
    ).length;

    return {
      ...record,
      pipeCount: calculatedPipeCount,
      ownedPipelineCount: calculatedPipeCount,
      assetCount: calculatedAssetCount,
      ownedAssetCount: calculatedAssetCount,
    };
  }, [collection, documentId, markers, pipelines, record]);

  const title = collection ? COLLECTION_LABELS[collection] : "Details";

  const primaryTitle = React.useMemo(() => {
    if (!collection || !displayRecord) return "";
    if (collection === "pipelines") {
      const start = displayRecord.startLocation || "Unknown";
      const end = displayRecord.endLocation || "Unknown";
      return `${start} - ${end}`;
    }
    if (collection === "zones") {
      return displayRecord.zoneName || displayRecord.name || "Unnamed Zone";
    }
    return displayRecord.name || displayRecord.assetName || displayRecord.markerId || displayRecord.id;
  }, [collection, displayRecord]);

  const highlights = React.useMemo(() => {
    if (!collection || !displayRecord)
      return [] as Array<{ label: string; value: any }>;
    if (collection === "pipelines") {
      return [
        { label: "Risk", value: displayRecord.riskBand || displayRecord.risk_band || "Low" },
        {
          label: "Confidence",
          value: displayRecord.confidenceBand || displayRecord.confidence_band || "Low",
        },
        { label: "Status", value: displayRecord.status || "Active" },
      ];
    }
    if (collection === "zones") {
      return [
        { label: "Priority", value: displayRecord.priority || "Medium" },
        {
          label: "Pipes",
          value: displayRecord.pipeCount ?? displayRecord.ownedPipelineCount ?? "N/A",
        },
        {
          label: "Assets",
          value: displayRecord.assetCount ?? displayRecord.ownedAssetCount ?? "N/A",
        },
      ];
    }
    return [
      {
        label: "Severity",
        value: displayRecord.severity || displayRecord.priority || "Medium",
      },
      { label: "Status", value: displayRecord.status || displayRecord.condition || "Active" },
      {
        label: "Zone",
        value: displayRecord.zoneName || displayRecord.zone || displayRecord.zoneId || "Unassigned",
      },
    ];
  }, [collection, displayRecord]);

  const sections = React.useMemo(() => {
    if (!collection || !displayRecord) return [] as DetailSection[];
    return buildSections(collection, displayRecord);
  }, [collection, displayRecord]);

  const repairHistory = React.useMemo(() => {
    if (collection !== "pipelines" || !displayRecord)
      return [] as RepairHistoryEntry[];
    return normalizeRepairHistory(displayRecord.repair_history);
  }, [collection, displayRecord]);

  const [expandedSections, setExpandedSections] = React.useState<
    Record<string, boolean>
  >({});
  const toggleSection = (title: string) =>
    setExpandedSections((prev) => ({ ...prev, [title]: !prev[title] }));

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor }]}
      edges={["top"]}
    >
      <ScreenHeader
        title={`${title} Details`}
        subtitle={documentId ? documentId : "Details"}
        showBack
        type="standard"
      />

      {isLoading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="small" color={tintColor} />
          <Text style={[styles.loadingText, { color: subtextColor }]}>
            Loading details...
          </Text>
        </View>
      ) : !collection || !documentId ? (
        <View style={styles.emptyWrap}>
          <Text style={[styles.emptyTitle, { color: textColor }]}>
            Invalid detail route
          </Text>
          <Text style={[styles.emptySubtitle, { color: subtextColor }]}>
            Select a pipeline, zone, or asset from a list screen.
          </Text>
        </View>
      ) : !record ? (
        <View style={styles.emptyWrap}>
          <Text style={[styles.emptyTitle, { color: textColor }]}>
            Record not found
          </Text>
          <Text style={[styles.emptySubtitle, { color: subtextColor }]}>
            This record may have been deleted or is unavailable.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View
            style={[
              styles.heroCard,
              { backgroundColor: cardColor, borderColor },
            ]}
          >
            <Text style={[styles.heroOverline, { color: subtextColor }]}>
              {title} Record
            </Text>
            <Text style={[styles.heroTitle, { color: textColor }]}>
              {primaryTitle}
            </Text>
            <Text style={[styles.heroSubtitle, { color: subtextColor }]}>
              ID: {record.id || documentId}
            </Text>

            <View style={styles.highlightRow}>
              {highlights.map((item, index) => {
                const tone = getTone(item.value);
                return (
                  <View
                    key={`${item.label}-${index}`}
                    style={[styles.highlightPill, { backgroundColor: tone.bg }]}
                  >
                    <Text style={[styles.highlightLabel, { color: tone.fg }]}>
                      {item.label}
                    </Text>
                    <Text style={[styles.highlightValue, { color: tone.fg }]}>
                      {formatValue(item.value)}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>

          {sections.map((section) => {
            const isExpanded = !!expandedSections[section.title];
            const visibleFields = isExpanded
              ? section.fields
              : section.fields.slice(0, 3);

            return (
              <View
                key={section.title}
                style={[
                  styles.sectionCard,
                  { backgroundColor: cardColor, borderColor },
                ]}
              >
                <Text style={[styles.sectionTitle, { color: textColor }]}>
                  {section.title}
                </Text>
                <View style={[styles.detailsCard, { borderColor }]}>
                  {visibleFields.map((field, index) => (
                    <FieldRow
                      key={`${section.title}-${field.label}`}
                      label={field.label}
                      value={field.value}
                      textColor={textColor}
                      subtextColor={subtextColor}
                      borderColor={
                        index === visibleFields.length - 1
                          ? "transparent"
                          : borderColor
                      }
                    />
                  ))}
                </View>

                {section.fields.length > 3 ? (
                  <TouchableOpacity
                    onPress={() => toggleSection(section.title)}
                    style={[styles.showMoreButton, { borderColor }]}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.showMoreText, { color: tintColor }]}>
                      {isExpanded
                        ? "Show less"
                        : `Show all ${section.fields.length} fields`}
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            );
          })}

          {collection === "pipelines" && (
            <View
              style={[
                styles.sectionCard,
                { backgroundColor: cardColor, borderColor },
              ]}
            >
              <Text style={[styles.sectionTitle, { color: textColor }]}>
                Repairs: {repairHistory.length}
              </Text>
              <Text
                style={[styles.repairSectionSubtitle, { color: subtextColor }]}
              >
                Showing the most recent repairs first.
              </Text>

              {repairHistory.length === 0 ? (
                <View style={[styles.repairEmptyCard, { borderColor }]}>
                  <Text
                    style={[styles.repairEmptyText, { color: subtextColor }]}
                  >
                    No repair history has been logged for this pipeline yet.
                  </Text>
                </View>
              ) : (
                <View style={styles.repairList}>
                  {repairHistory.map((entry, index) => {
                    const repairType =
                      entry.repairType || entry.issueType || "Repair";
                    const waterLossDisplay =
                      entry.waterLoss ?? entry.flowRate ?? "-";
                    const notesText = entry.notes?.trim() || "-";
                    const imageCount = Array.isArray(entry.imageUrls)
                      ? entry.imageUrls.length
                      : 0;

                    return (
                      <View
                        key={`${entry.repairId || "repair"}-${index}`}
                        style={[styles.repairCard, { borderColor }]}
                      >
                        <View style={styles.repairHeaderRow}>
                          <View style={{ flex: 1 }}>
                            <Text
                              style={[styles.repairType, { color: textColor }]}
                            >
                              {repairType}
                            </Text>
                            <Text
                              style={[
                                styles.repairDate,
                                { color: subtextColor },
                              ]}
                            >
                              {formatRepairDate(entry)}
                            </Text>
                          </View>
                          <View style={styles.repairSeverityPill}>
                            <Text style={styles.repairSeverityText}>
                              {entry.severity || "Unknown"}
                            </Text>
                          </View>
                        </View>

                        <View style={styles.repairMetaGrid}>
                          <View
                            style={[styles.repairMetaItem, { borderColor }]}
                          >
                            <Text
                              style={[
                                styles.repairMetaLabel,
                                { color: subtextColor },
                              ]}
                            >
                              Water Loss
                            </Text>
                            <Text
                              style={[
                                styles.repairMetaValue,
                                { color: textColor },
                              ]}
                            >
                              {String(waterLossDisplay)}
                            </Text>
                          </View>
                          <View
                            style={[styles.repairMetaItem, { borderColor }]}
                          >
                            <Text
                              style={[
                                styles.repairMetaLabel,
                                { color: subtextColor },
                              ]}
                            >
                              Depth (m)
                            </Text>
                            <Text
                              style={[
                                styles.repairMetaValue,
                                { color: textColor },
                              ]}
                            >
                              {Number.isFinite(Number(entry.depthM))
                                ? Number(entry.depthM)
                                : "-"}
                            </Text>
                          </View>
                        </View>

                        <View style={[styles.repairNotesBox, { borderColor }]}>
                          <Text
                            style={[
                              styles.repairMetaLabel,
                              { color: subtextColor },
                            ]}
                          >
                            Notes
                          </Text>
                          <Text
                            style={[
                              styles.repairMetaValue,
                              { color: textColor },
                            ]}
                          >
                            {notesText.length > 240
                              ? `${notesText.slice(0, 240)}...`
                              : notesText}
                          </Text>
                        </View>

                        {imageCount > 0 ? (
                          <View
                            style={[
                              styles.repairImagePlaceholderWrap,
                              { borderColor },
                            ]}
                          >
                            <View style={styles.repairImageHeaderRow}>
                              <Text
                                style={[
                                  styles.repairMetaLabel,
                                  { color: subtextColor },
                                ]}
                              >
                                Repair Images
                              </Text>
                              <Text
                                style={[
                                  styles.repairImageCount,
                                  { color: subtextColor },
                                ]}
                              >
                                {imageCount > 0
                                  ? `${imageCount} image${imageCount > 1 ? "s" : ""} available`
                                  : "No images uploaded yet"}
                              </Text>
                            </View>
                            <View style={styles.repairImageGridWrap}>
                              {entry.imageUrls?.map((url, imageIndex) => {
                                const imageKey = `${entry.repairId || "repair"}-${index}-img-${imageIndex}`;

                                return (
                                  <TouchableOpacity
                                    key={imageKey}
                                    onPress={() =>
                                      setSelectedRepairImageUrl(url)
                                    }
                                    activeOpacity={0.86}
                                    style={[
                                      styles.repairImageFrame,
                                      { borderColor },
                                    ]}
                                  >
                                    <Image
                                      source={{ uri: url }}
                                      style={styles.repairImageThumb}
                                      resizeMode="cover"
                                      onLoad={() =>
                                        setRepairImageLoadState((prev) => ({
                                          ...prev,
                                          [imageKey]: "loaded",
                                        }))
                                      }
                                      onError={() =>
                                        setRepairImageLoadState((prev) => ({
                                          ...prev,
                                          [imageKey]: "error",
                                        }))
                                      }
                                    />
                                  </TouchableOpacity>
                                );
                              })}
                            </View>
                          </View>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          )}
        </ScrollView>
      )}

      <Modal
        visible={!!selectedRepairImageUrl}
        transparent
        animationType="slide"
        presentationStyle="overFullScreen"
        hardwareAccelerated
        statusBarTranslucent
        onRequestClose={() => setSelectedRepairImageUrl(null)}
      >
        <View style={styles.previewModalRoot}>
          <TouchableOpacity
            style={styles.previewBackdrop}
            activeOpacity={1}
            onPress={() => setSelectedRepairImageUrl(null)}
          />

          <View style={styles.previewContentWrap}>
            <TouchableOpacity
              style={styles.previewCloseButton}
              onPress={() => setSelectedRepairImageUrl(null)}
            >
              <Text style={styles.previewCloseText}>X</Text>
            </TouchableOpacity>

            {selectedRepairImageUrl && (
              <Image
                source={{ uri: selectedRepairImageUrl }}
                style={styles.previewImage}
                resizeMode="contain"
              />
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    paddingHorizontal: 24,
    paddingTop: 0,
    paddingBottom: 60,
    gap: 12,
  },
  heroCard: {
    borderWidth: 1,
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingVertical: 18,
    marginBottom: 12,
    backgroundColor: "#FFFFFF",
    ...Platform.select({
      ios: {
        shadowColor: "#0f172a",
        shadowOpacity: 0.12,
        shadowOffset: { width: 0, height: 8 },
        shadowRadius: 16,
      },
      android: {
        elevation: 6,
      },
    }),
  },
  heroOverline: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    opacity: 0.65,
  },
  heroTitle: {
    marginTop: 8,
    fontSize: 20,
    fontWeight: "800",
    lineHeight: 26,
  },
  heroSubtitle: {
    marginTop: 6,
    fontSize: 12,
    fontWeight: "500",
    opacity: 0.7,
  },
  highlightRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 16,
  },
  highlightPill: {
    minWidth: "31%",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOpacity: 0.06,
        shadowOffset: { width: 0, height: 2 },
        shadowRadius: 4,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  highlightLabel: {
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    opacity: 0.85,
  },
  highlightValue: {
    marginTop: 4,
    fontSize: 15,
    fontWeight: "800",
    lineHeight: 19,
  },
  sectionCard: {
    borderWidth: 1,
    borderRadius: 20,
    padding: 16,
    marginBottom: 6,
    ...Platform.select({
      ios: {
        shadowColor: "#0f172a",
        shadowOpacity: 0.04,
        shadowOffset: { width: 0, height: 2 },
        shadowRadius: 6,
      },
      android: {
        elevation: 1,
      },
    }),
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "800",
    marginBottom: 14,
    letterSpacing: 0.2,
    textTransform: "capitalize",
  },
  detailsCard: {
    borderWidth: 1,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "rgba(148, 163, 184, 0.05)",
  },
  fieldRow: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    flex: 0.45,
    opacity: 0.75,
  },
  fieldValueRow: {
    marginLeft: 12,
    fontSize: 15,
    fontWeight: "800",
    lineHeight: 19,
    flex: 0.55,
    textAlign: "right",
  },
  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingText: {
    marginTop: 10,
    fontSize: 13,
    fontWeight: "600",
  },
  emptyWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "700",
  },
  emptySubtitle: {
    marginTop: 6,
    textAlign: "center",
    fontSize: 13,
    lineHeight: 18,
  },
  repairEmptyCard: {
    borderWidth: 1,
    borderRadius: 14,
    borderStyle: "dashed",
    paddingHorizontal: 12,
    paddingVertical: 14,
  },
  repairEmptyText: {
    fontSize: 13,
    fontWeight: "500",
  },
  repairList: {
    gap: 10,
  },
  repairProgressText: {
    fontSize: 12,
    fontWeight: "600",
  },
  repairCard: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 8,
  },
  repairHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  repairType: {
    fontSize: 14,
    fontWeight: "700",
  },
  repairDate: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: "500",
  },
  repairSeverityPill: {
    backgroundColor: "#e0f2fe",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginTop: 2,
  },
  repairSeverityText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#075985",
  },
  repairMetaGrid: {
    flexDirection: "row",
    gap: 8,
  },
  repairMetaItem: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  repairMetaLabel: {
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  repairMetaValue: {
    marginTop: 3,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
  },
  repairNotesBox: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  repairImagePlaceholderWrap: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
    gap: 6,
  },
  repairImageHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  repairImageCount: {
    fontSize: 11,
    fontWeight: "600",
  },
  repairImageGrid: {
    flexDirection: "row",
    gap: 8,
  },
  repairImageGridWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  repairImageFrame: {
    width: "31%",
    borderWidth: 1,
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: "rgba(148, 163, 184, 0.08)",
  },
  repairImageThumb: {
    width: "100%",
    height: 84,
    backgroundColor: "rgba(148, 163, 184, 0.16)",
  },
  repairImageOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(241, 245, 249, 0.78)",
  },
  repairImageStatusText: {
    fontSize: 11,
    fontWeight: "600",
  },
  repairNoImagesText: {
    fontSize: 12,
    fontWeight: "500",
  },
  previewModalRoot: {
    flex: 1,
    backgroundColor: "rgba(2, 6, 23, 0.88)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 20,
  },
  previewBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  previewContentWrap: {
    width: "100%",
    maxWidth: 680,
    alignItems: "center",
    justifyContent: "center",
  },
  previewCloseButton: {
    alignSelf: "flex-end",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
    backgroundColor: "rgba(15,23,42,0.65)",
    borderRadius: 12,
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  previewCloseText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "800",
    lineHeight: 18,
  },
  previewImage: {
    width: "100%",
    height: "82%",
    maxHeight: 620,
    borderRadius: 12,
    backgroundColor: "rgba(15, 23, 42, 0.35)",
  },
  showMoreButton: {
    marginTop: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(59, 130, 246, 0.08)",
    borderColor: "rgba(59, 130, 246, 0.2)",
  },
  showMoreText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#3B82F6",
  },
  repairPreviewRow: {
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(34, 197, 94, 0.08)",
    borderColor: "rgba(34, 197, 94, 0.2)",
  },
  repairPreviewText: {
    fontSize: 14,
    fontWeight: "600",
  },
  repairPreviewActionButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(59, 130, 246, 0.08)",
  },
  repairPreviewActionText: {
    fontSize: 12,
    fontWeight: "700",
  },
});
