import React from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { ScreenHeader } from "../../components/ScreenHeader";
import SummaryCard from "../../components/SummaryCard";
import { Grip, ChevronRight, RefreshCw } from "lucide-react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Location from "expo-location";
import { useThemeColor } from "@/hooks/use-theme-color";
import { useTheme } from "@/context/ThemeContext";
import { GlassButton } from "@/components/GlassButton";
import {
  findZoneForCoordinates,
  subscribeToZones,
  fetchZonesFromFirestore,
  subscribeToPipelines,
  fetchPipelinesFromFirestore,
  subscribeToMarkers,
  fetchMarkersFromFirestore,
} from "../../lib/firebase";

export default function ZonesScreen() {
  const router = useRouter();
  const { isDark } = useTheme();
  const backgroundColor = useThemeColor({}, "background");
  const textColor = useThemeColor({}, "text");
  const subtextColor = useThemeColor({}, "subtext");
  const tintColor = useThemeColor({}, "tint");
  const borderColor = useThemeColor({}, "border");
  const cardColor = useThemeColor({}, "card");
  const iconBaseColor = useThemeColor({}, "icon");

  const [zones, setZones] = React.useState<any[]>([]);
  const [pipelines, setPipelines] = React.useState<any[]>([]);
  const [markers, setMarkers] = React.useState<any[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isResolvingGeo, setIsResolvingGeo] = React.useState(false);
  const [currentZoneId, setCurrentZoneId] = React.useState<string | null>(null);
  const [currentZoneName, setCurrentZoneName] = React.useState("Locating...");
  const [geoRefreshTick, setGeoRefreshTick] = React.useState(0);
  const GEO_REFRESH_DELAY_MS = 800;

  const isPipelineInZone = React.useCallback((pipeline: any, zoneId: string) => {
    const candidateZoneId = String(
      pipeline.zoneId ??
        pipeline.zone ??
        pipeline.dmaId ??
        pipeline.dma_id ??
        pipeline.zone_id ??
        "",
    );

    return candidateZoneId === zoneId;
  }, []);

  const isAssetInZone = React.useCallback((asset: any, zoneId: string) => {
    const candidateZoneId = String(
      asset.zoneId ??
        asset.zone ??
        asset.dmaId ??
        asset.dma_id ??
        asset.zone_id ??
        "",
    );

    return candidateZoneId === zoneId;
  }, []);

  const resolveCurrentZone = React.useCallback(async () => {
    setIsResolvingGeo(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setCurrentZoneName("Location unavailable");
        setCurrentZoneId(null);
        return;
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const zone = await findZoneForCoordinates(
        position.coords.latitude,
        position.coords.longitude,
      );

      setCurrentZoneId(zone?.zoneId ?? null);
      setCurrentZoneName(zone?.zoneName || "Not within a zone");

      const [freshZones, freshPipelines, freshMarkers] = await Promise.all([
        fetchZonesFromFirestore(),
        fetchPipelinesFromFirestore(),
        fetchMarkersFromFirestore(),
      ]);
      setZones(freshZones);
      setPipelines(freshPipelines);
      setMarkers(freshMarkers);
    } catch (_error) {
      setCurrentZoneId(null);
      setCurrentZoneName("Not within a zone");
    } finally {
      await new Promise((resolve) => setTimeout(resolve, GEO_REFRESH_DELAY_MS));
      setIsResolvingGeo(false);
    }
  }, []);

  React.useEffect(() => {
    // Initial fetch
    const initialFetch = async () => {
      try {
        const [initialZones, initialPipelines, initialMarkers] = await Promise.all([
          fetchZonesFromFirestore(),
          fetchPipelinesFromFirestore(),
          fetchMarkersFromFirestore(),
        ]);
        setZones(initialZones);
        setPipelines(initialPipelines);
        setMarkers(initialMarkers);
        setIsLoading(false);
      } catch (error) {
        console.error('[Zones] Initial fetch failed:', error);
        setIsLoading(false);
      }
    };
    void initialFetch();

    // Subscribe to real-time updates for zones
    const unsubscribeZones = subscribeToZones((data) => {
      setZones(data);
      setIsLoading(false);
    });

    // Subscribe to real-time updates for pipelines
    const unsubscribePipelines = subscribeToPipelines((data) => {
      setPipelines(data);
    });

    const unsubscribeMarkers = subscribeToMarkers((data) => {
      setMarkers(data);
    });

    return () => {
      unsubscribeZones();
      unsubscribePipelines();
      unsubscribeMarkers();
    };
  }, []);

  React.useEffect(() => {
    void resolveCurrentZone();
  }, [resolveCurrentZone, geoRefreshTick]);

  const filteredData = zones;

  const handleItemPress = (item: any) => {
    router.push({
      pathname: "/details/[collection]/[id]",
      params: { collection: "zones", id: item.id },
    });
  };

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor }]}
      edges={["top"]}
    >
      <ScreenHeader
        title="Zones"
        subtitle="Manage zones"
        showBack
        type="standard"
      />

      <View style={styles.listContainer}>
        <SummaryCard
          title="Tap a zone to open its record"
          subtitle="You’ll see the zone details shown on web."
          action={
            <GlassButton
              style={styles.refreshButton}
              contentStyle={styles.refreshButtonGlass}
              borderColor={borderColor}
              onPress={() => setGeoRefreshTick((value) => value + 1)}
              disabled={isResolvingGeo}
              accessibilityLabel="Refresh location"
            >
              {isResolvingGeo ? (
                <ActivityIndicator size="small" color={tintColor} />
              ) : (
                <RefreshCw color={tintColor} size={16} />
              )}
            </GlassButton>
          }
          chips={[
            { value: zones.length, label: "Total zones" },
            {
              value: zones.filter((item) => item.color).length,
              label: "With color tag",
            },
          ]}
        >
          <View style={{ height: 8 }} />
        </SummaryCard>

        <View
          style={[
            styles.sectionContent,
            { backgroundColor: cardColor, borderColor },
          ]}
        >
          {isLoading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator size="small" color={tintColor} />
              <Text style={[styles.loadingText, { color: subtextColor }]}>
                Loading zones...
              </Text>
            </View>
          ) : (
            <FlatList
              data={zones}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
              renderItem={({ item, index }) => {
                const isLast = index === zones.length - 1;
                const isCurrentZone = currentZoneId === String(item.id);
                // Calculate pipelineCount dynamically from actual pipelines
                const pipelineCount = pipelines.filter((pipeline) =>
                  isPipelineInZone(pipeline, String(item.id)),
                ).length;
                const assetCount = markers.filter((asset) =>
                  isAssetInZone(asset, String(item.id)),
                ).length;
                const highRisk = Number.isFinite(Number(item.highRiskPipes))
                  ? Number(item.highRiskPipes)
                  : null;
                const avgRisk = Number.isFinite(Number(item.avgRisk))
                  ? Number(item.avgRisk)
                  : null;
                const nrw = Number.isFinite(Number(item.nrwPercent))
                  ? Number(item.nrwPercent)
                  : null;
                return (
                  <View>
                    <TouchableOpacity
                      style={[
                        styles.row,
                        isCurrentZone && {
                          backgroundColor: isDark
                            ? "rgba(16, 185, 129, 0.14)"
                            : "rgba(16, 185, 129, 0.1)",
                        },
                      ]}
                      onPress={() => handleItemPress(item)}
                    >
                      <View
                        style={[
                          styles.iconContainer,
                          {
                            backgroundColor: isCurrentZone
                              ? isDark
                                ? "rgba(16, 185, 129, 0.2)"
                                : "rgba(16, 185, 129, 0.16)"
                              : isDark
                                ? `${item.color}20`
                                : `${item.color}15`,
                          },
                        ]}
                      >
                        <Grip
                          color={
                            isCurrentZone ? "#10b981" : item.color || "#10b981"
                          }
                          size={22}
                        />
                      </View>
                      <View style={styles.info}>
                        <Text style={[styles.itemTitle, { color: textColor }]}>
                          {item.name || item.zoneName}
                        </Text>
                        <Text
                          style={[styles.itemSubtitle, { color: subtextColor }]}
                        >
                          Zone ID: {item.id} • {item.type || "Zone"}
                        </Text>
                        {isCurrentZone && (
                          <Text
                            style={[styles.currentBadge, { color: "#059669" }]}
                          >
                            Current zone
                          </Text>
                        )}
                        <View style={styles.metaRow}>
                          <Text style={[styles.metaChip, { color: textColor }]}>
                            Priority: {item.priority || "Medium"}
                          </Text>
                          <Text style={[styles.metaChip, { color: textColor }]}>
                            Pipes: {pipelineCount ?? "-"}
                          </Text>
                          <Text style={[styles.metaChip, { color: textColor }]}>
                            Assets: {assetCount ?? "-"}
                          </Text>
                        </View>
                        <Text
                          style={[styles.itemMeta, { color: subtextColor }]}
                        >
                          High risk: {highRisk ?? "-"} • Avg risk:{" "}
                          {avgRisk ?? "-"} • NRW: {nrw ?? "-"}
                        </Text>
                      </View>
                      <View style={styles.rightContent}>
                        <View
                          style={[
                            styles.pressureBadge,
                            {
                              backgroundColor:
                                item.priority === "High"
                                  ? "#FEE2E2"
                                  : "#DCFCE7",
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.pressureText,
                              {
                                color:
                                  item.priority === "High"
                                    ? "#991B1B"
                                    : "#166534",
                              },
                            ]}
                          >
                            {item.priority || "Medium"}
                          </Text>
                        </View>
                        <ChevronRight
                          color={iconBaseColor}
                          size={20}
                          style={{ marginLeft: 8 }}
                        />
                      </View>
                    </TouchableOpacity>
                    {!isLast && (
                      <View
                        style={[
                          styles.divider,
                          { backgroundColor: borderColor },
                        ]}
                      />
                    )}
                  </View>
                );
              }}
            />
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  listContainer: {
    flex: 1,
    paddingHorizontal: 24,
    paddingBottom: 20,
    paddingTop: 0,
    gap: 16,
  },
  summaryCard: {
    borderWidth: 1,
    borderRadius: 20,
    padding: 16,
  },
  summaryTitle: {
    fontSize: 17,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
  summarySubtitle: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 18,
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 14,
  },
  summaryLabel: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  summaryValue: {
    marginTop: 2,
    fontSize: 14,
    fontWeight: "700",
  },
  refreshButton: {
    width: 40,
    height: 40,
  },
  refreshButtonGlass: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  summaryChips: {
    flexDirection: "row",
    gap: 12,
    marginTop: 14,
  },
  chip: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: "rgba(148, 163, 184, 0.08)",
  },
  chipValue: {
    fontSize: 20,
    fontWeight: "700",
  },
  chipLabel: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: "600",
  },
  sectionContent: {
    flex: 1,
    borderRadius: 20,
    borderWidth: 1,
    overflow: "hidden",
  },
  listContent: {
    paddingBottom: 20,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 16,
  },
  info: { flex: 1, justifyContent: "center" },
  itemTitle: { fontSize: 16, fontWeight: "600", letterSpacing: -0.2 },
  itemSubtitle: { fontSize: 13, marginTop: 4, fontWeight: "500" },
  currentBadge: { fontSize: 11, marginTop: 5, fontWeight: "700" },
  itemMeta: { fontSize: 11, marginTop: 6, fontWeight: "600" },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 },
  metaChip: { fontSize: 11, fontWeight: "700" },
  rightContent: { flexDirection: "row", alignItems: "center" },
  pressureBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 16,
  },
  pressureText: { fontSize: 12, fontWeight: "700" },
  divider: { height: 1, marginLeft: 76 },
  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 40,
  },
  loadingText: { marginTop: 10, fontSize: 13, fontWeight: "600" },
});
