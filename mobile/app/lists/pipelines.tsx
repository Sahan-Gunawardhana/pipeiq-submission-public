import React from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { ScreenHeader } from "../../components/ScreenHeader";
import SummaryCard from "../../components/SummaryCard";
import { Database, ChevronRight, RefreshCw } from "lucide-react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Location from "expo-location";
import { useThemeColor } from "@/hooks/use-theme-color";
import { useTheme } from "@/context/ThemeContext";
import { GlassButton } from "@/components/GlassButton";
import {
  subscribeToPipelines,
  findNearbyPipelinesForCoordinates,
  findZoneForCoordinates,
  NEARBY_RADIUS_METERS,
} from "../../lib/firebase";

export default function PipelinesScreen() {
  const router = useRouter();
  const { isDark } = useTheme();
  const backgroundColor = useThemeColor({}, "background");
  const textColor = useThemeColor({}, "text");
  const subtextColor = useThemeColor({}, "subtext");
  const tintColor = useThemeColor({}, "tint");
  const borderColor = useThemeColor({}, "border");
  const cardColor = useThemeColor({}, "card");
  const iconBaseColor = useThemeColor({}, "icon");

  const [pipelines, setPipelines] = React.useState<any[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isResolvingGps, setIsResolvingGps] = React.useState(true);
  const [nearbyPipelineIds, setNearbyPipelineIds] = React.useState<Set<string>>(
    new Set(),
  );
  const [nearbyPipelineDistances, setNearbyPipelineDistances] = React.useState<
    Map<string, number>
  >(new Map());
  const [currentZoneName, setCurrentZoneName] = React.useState("Locating...");
  const [geoRefreshTick, setGeoRefreshTick] = React.useState(0);
  const GEO_REFRESH_DELAY_MS = 800;

  const resolveContext = React.useCallback(async () => {
    setIsResolvingGps(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setCurrentZoneName("Location unavailable");
        setNearbyPipelineIds(new Set());
        setNearbyPipelineDistances(new Map());
        return;
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const latitude = position.coords.latitude;
      const longitude = position.coords.longitude;

      const [nearby, zone] = await Promise.all([
        findNearbyPipelinesForCoordinates(
          latitude,
          longitude,
          NEARBY_RADIUS_METERS,
          60,
        ),
        findZoneForCoordinates(latitude, longitude),
      ]);

      setNearbyPipelineIds(new Set(nearby.map((item) => item.pipelineId)));
      setNearbyPipelineDistances(
        new Map(nearby.map((item) => [item.pipelineId, item.distanceMeters])),
      );
      setCurrentZoneName(zone?.zoneName || "Not within a zone");
    } catch (_error) {
      setCurrentZoneName("Not within a zone");
      setNearbyPipelineIds(new Set());
      setNearbyPipelineDistances(new Map());
    } finally {
      await new Promise((resolve) => setTimeout(resolve, GEO_REFRESH_DELAY_MS));
      setIsResolvingGps(false);
    }
  }, []);

  React.useEffect(() => {
    const unsubscribe = subscribeToPipelines((data) => {
      setPipelines(data);
      setIsLoading(false);
    });
    return () => unsubscribe();
  }, []);

  React.useEffect(() => {
    void resolveContext();
  }, [resolveContext, geoRefreshTick]);

  const nearbyPipelines = pipelines.filter((item) =>
    nearbyPipelineIds.has(item.id),
  );
  const otherPipelines = pipelines.filter(
    (item) => !nearbyPipelineIds.has(item.id),
  );
  const filteredData = [...nearbyPipelines, ...otherPipelines];

  const openDetail = (item: any) => {
    router.push({
      pathname: "/details/[collection]/[id]",
      params: { collection: "pipelines", id: item.id },
    });
  };

  const getPipelineAgeLabel = (item: any) => {
    if (Number.isFinite(Number(item.age)) && Number(item.age) > 0) {
      return `${Math.round(Number(item.age))} years`;
    }

    const installationYear = Number(item.installationYear);
    if (Number.isFinite(installationYear) && installationYear > 0) {
      const age = new Date().getFullYear() - installationYear;
      if (Number.isFinite(age) && age >= 0) {
        return `${age} years`;
      }
    }

    return "Age unavailable";
  };

  const getConfidenceLabel = (item: any) => {
    return item.confidenceBand || item.confidence_band || "Low";
  };

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor }]}
      edges={["top"]}
    >
      <ScreenHeader
        title="Pipelines"
        subtitle="Active pipelines"
        showBack
        type="standard"
      />

      <View style={styles.listContainer}>
        <SummaryCard
          title="Tap any pipeline for details"
          subtitle="The detail screen shows the full pipeline record."
          action={
            <GlassButton
              style={styles.refreshButton}
              contentStyle={styles.refreshButtonGlass}
              borderColor={borderColor}
              onPress={() => setGeoRefreshTick((value) => value + 1)}
              disabled={isResolvingGps}
              accessibilityLabel="Refresh location"
            >
              {isResolvingGps ? (
                <ActivityIndicator size="small" color={tintColor} />
              ) : (
                <RefreshCw color={tintColor} size={16} />
              )}
            </GlassButton>
          }
          chips={[
            { value: filteredData.length, label: "Total" },
            {
              value: nearbyPipelines.length,
              label: "Within 100m of your location",
            },
          ]}
        >
          <View style={styles.zoneRow}>
            <Text style={[styles.zoneLine, { color: subtextColor }]}>
              Current zone: {isResolvingGps ? "Locating..." : currentZoneName}
            </Text>
          </View>
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
                Loading pipelines...
              </Text>
            </View>
          ) : (
            <FlatList
              data={filteredData}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
              renderItem={({ item, index }) => {
                const isLast = index === filteredData.length - 1;
                const pipelineTitle = `${item.startLocation || "Unknown"} - ${item.endLocation || "Unknown"}`;
                const ageLabel = getPipelineAgeLabel(item);
                const confidenceLabel = getConfidenceLabel(item);
                const isNearby = nearbyPipelineIds.has(item.id);
                const distance = nearbyPipelineDistances.get(item.id);
                const riskBand = item.riskBand || item.risk_band || "Low";

                return (
                  <View>
                    <TouchableOpacity
                      style={[
                        styles.row,
                        isNearby && {
                          backgroundColor: isDark
                            ? "rgba(34, 197, 94, 0.14)"
                            : "rgba(187, 247, 208, 0.5)",
                        },
                      ]}
                      onPress={() => openDetail(item)}
                    >
                      <View
                        style={[
                          styles.iconContainer,
                          { backgroundColor: isDark ? "#334155" : "#f1f5f9" },
                        ]}
                      >
                        <Database
                          color={isDark ? "#94a3b8" : "#64748b"}
                          size={24}
                        />
                      </View>
                      <View style={styles.info}>
                        <Text
                          style={[styles.itemTitle, { color: textColor }]}
                          numberOfLines={2}
                          ellipsizeMode="tail"
                        >
                          {pipelineTitle}
                        </Text>
                        <Text
                          style={[styles.itemSubtitle, { color: subtextColor }]}
                        >
                          {item.material || "Unknown material"} • {ageLabel}
                        </Text>
                        <View style={styles.metricsBlock}>
                          <Text style={[styles.itemMeta, { color: textColor }]}>
                            Risk: {riskBand}
                          </Text>
                          <Text
                            style={[
                              styles.itemMetaSub,
                              { color: subtextColor },
                            ]}
                          >
                            Confidence: {confidenceLabel}
                          </Text>
                        </View>
                        {isNearby && (
                          <Text
                            style={[
                              styles.nearbyLabel,
                              { color: isDark ? "#86efac" : "#166534" },
                            ]}
                          >
                            {distance !== undefined
                              ? `${Math.round(distance)}m away`
                              : "100m away"}
                          </Text>
                        )}
                      </View>
                      <View style={styles.rightContent}>
                        <View
                          style={[
                            styles.statusBadge,
                            {
                              backgroundColor:
                                item.status === "Under Maintenance"
                                  ? "#FEE2E2"
                                  : "#DCFCE7",
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.statusBadgeText,
                              {
                                color:
                                  item.status === "Under Maintenance"
                                    ? "#991B1B"
                                    : "#166534",
                              },
                            ]}
                          >
                            {item.status || "Active"}
                          </Text>
                        </View>
                        <ChevronRight color={iconBaseColor} size={20} />
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
  zoneLine: {
    flex: 1,
    fontSize: 12,
    fontWeight: "600",
  },
  zoneRow: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  refreshButton: {
    width: 40,
    height: 40,
    marginTop: 10,
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
    alignItems: "flex-start",
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginHorizontal: 0,
    ...Platform.select({
      ios: {
        shadowColor: "#0f172a",
        shadowOpacity: 0.03,
        shadowOffset: { width: 0, height: 1 },
        shadowRadius: 3,
      },
      android: {
        elevation: 1,
      },
    }),
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 16,
    marginTop: 2,
  },
  info: { flex: 1, justifyContent: "center", minWidth: 0 },
  itemTitle: { fontSize: 16, fontWeight: "600", letterSpacing: -0.2 },
  itemSubtitle: { fontSize: 13, marginTop: 4, fontWeight: "500" },
  metricsBlock: {
    marginTop: 6,
    gap: 2,
  },
  itemMeta: { fontSize: 12, fontWeight: "700" },
  itemMetaSub: { fontSize: 11, fontWeight: "500" },
  nearbyLabel: {
    fontSize: 11,
    marginTop: 4,
    fontWeight: "700",
  },
  rightContent: {
    marginLeft: 8,
    alignItems: "flex-end",
    justifyContent: "center",
    gap: 8,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 16,
    maxWidth: 120,
  },
  statusBadgeText: { fontSize: 11, fontWeight: "700" },
  divider: { height: 1, marginLeft: 76 },
  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 40,
  },
  loadingText: { marginTop: 10, fontSize: 13, fontWeight: "600" },
});
