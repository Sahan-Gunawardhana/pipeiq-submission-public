import React from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import * as Location from "expo-location";
import { useRouter } from "expo-router";
import { ScreenHeader } from "../../components/ScreenHeader";
import SummaryCard from "../../components/SummaryCard";
import { MapPin, ChevronRight, RefreshCw } from "lucide-react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useThemeColor } from "@/hooks/use-theme-color";
import { useTheme } from "@/context/ThemeContext";
import { GlassButton } from "@/components/GlassButton";
import {
  subscribeToMarkers,
  subscribeToZones,
  NEARBY_RADIUS_METERS,
} from "../../lib/firebase";

export default function AssetsScreen() {
  const router = useRouter();
  const { isDark } = useTheme();
  const [isLoading, setIsLoading] = React.useState(true);
  const backgroundColor = useThemeColor({}, "background");
  const textColor = useThemeColor({}, "text");
  const subtextColor = useThemeColor({}, "subtext");
  const tintColor = useThemeColor({}, "tint");
  const borderColor = useThemeColor({}, "border");
  const cardColor = useThemeColor({}, "card");
  const iconBaseColor = useThemeColor({}, "icon");
  const [markers, setMarkers] = React.useState<any[]>([]);
  const [zones, setZones] = React.useState<any[]>([]);
  const [nearbyAssetIds, setNearbyAssetIds] = React.useState<Set<string>>(
    new Set(),
  );
  const [nearbyAssetDistances, setNearbyAssetDistances] = React.useState<
    Map<string, number>
  >(new Map());
  const [lastPosition, setLastPosition] = React.useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [isRefreshingGeo, setIsRefreshingGeo] = React.useState(false);
  const GEO_REFRESH_DELAY_MS = 800;
  const emerald = "#10b981";

  const distanceInMeters = (
    fromLatitude: number,
    fromLongitude: number,
    toLatitude: number,
    toLongitude: number,
  ) => {
    const toRad = (degrees: number) => (degrees * Math.PI) / 180;
    const earthRadiusMeters = 6371000;
    const latDiff = toRad(toLatitude - fromLatitude);
    const lonDiff = toRad(toLongitude - fromLongitude);
    const a =
      Math.sin(latDiff / 2) ** 2 +
      Math.cos(toRad(fromLatitude)) *
        Math.cos(toRad(toLatitude)) *
        Math.sin(lonDiff / 2) ** 2;

    return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  const getMarkerLatLng = (marker: any): [number, number] | null => {
    const geometry = marker.geometry;
    if (
      geometry?.type === "Point" &&
      Array.isArray(geometry.coordinates) &&
      geometry.coordinates.length >= 2
    ) {
      const longitude = Number(geometry.coordinates[0]);
      const latitude = Number(geometry.coordinates[1]);
      if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
        return [latitude, longitude];
      }
    }

    const coords = marker.coordinates;
    if (Array.isArray(coords) && coords.length >= 2) {
      const longitude = Number(coords[0]);
      const latitude = Number(coords[1]);
      if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
        return [latitude, longitude];
      }
    }

    const latitude = Number(marker.latitude ?? marker.lat);
    const longitude = Number(marker.longitude ?? marker.lng ?? marker.lon);
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      return [latitude, longitude];
    }

    return null;
  };

  React.useEffect(() => {
    const unsubscribe = subscribeToMarkers((data) => {
      setMarkers(data);
      setIsLoading(false);
    });
    return () => unsubscribe();
  }, []);

  React.useEffect(() => {
    const unsubscribeZones = subscribeToZones((data) => {
      setZones(data);
    });
    return () => unsubscribeZones();
  }, []);

  const resolveNearbyAssets = React.useCallback(async () => {
    setIsRefreshingGeo(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setNearbyAssetIds(new Set());
        setNearbyAssetDistances(new Map());
        return;
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const nearbyIds = new Set<string>();
      const nearbyDistances = new Map<string, number>();
      for (const marker of markers) {
        const markerLatLng = getMarkerLatLng(marker);
        if (!markerLatLng) {
          continue;
        }

        const distance = distanceInMeters(
          position.coords.latitude,
          position.coords.longitude,
          markerLatLng[0],
          markerLatLng[1],
        );

        if (distance <= NEARBY_RADIUS_METERS) {
          nearbyIds.add(String(marker.id));
          nearbyDistances.set(String(marker.id), distance);
        }
      }

      setNearbyAssetIds(nearbyIds);
      setNearbyAssetDistances(nearbyDistances);
      setLastPosition({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });
    } catch (_error) {
      setNearbyAssetIds(new Set());
      setNearbyAssetDistances(new Map());
    } finally {
      await new Promise((resolve) => setTimeout(resolve, GEO_REFRESH_DELAY_MS));
      setIsRefreshingGeo(false);
    }
  }, [markers]);

  React.useEffect(() => {
    if (!markers.length) {
      setNearbyAssetIds(new Set());
      return;
    }

    void resolveNearbyAssets();
  }, [markers, resolveNearbyAssets]);

  const resolveZoneName = (zoneId: string) => {
    const normalized = String(zoneId || "");
    const match = zones.find(
      (zone) =>
        String(zone.id) === normalized || String(zone.zoneId) === normalized,
    );
    return match?.zoneName || match?.name || normalized || "Unassigned";
  };

  const filteredData = React.useMemo(() => {
    if (!markers || markers.length === 0) return markers;

    // If we have a lastPosition, sort by computed distance for every marker.
    if (lastPosition) {
      return [...markers].sort((a, b) => {
        const aLatLng = getMarkerLatLng(a);
        const bLatLng = getMarkerLatLng(b);
        if (!aLatLng && !bLatLng) return 0;
        if (!aLatLng) return 1;
        if (!bLatLng) return -1;
        const da = distanceInMeters(
          lastPosition.latitude,
          lastPosition.longitude,
          aLatLng[0],
          aLatLng[1],
        );
        const db = distanceInMeters(
          lastPosition.latitude,
          lastPosition.longitude,
          bLatLng[0],
          bLatLng[1],
        );
        return da - db;
      });
    }

    // Fallback: keep original order but push known nearby items first
    const nearby = markers.filter((m) => nearbyAssetIds.has(String(m.id)));
    const others = markers.filter((m) => !nearbyAssetIds.has(String(m.id)));
    return [...nearby, ...others];
  }, [markers, nearbyAssetIds, lastPosition]);

  const handleItemPress = (item: any) => {
    router.push({
      pathname: "/details/[collection]/[id]",
      params: { collection: "markers", id: item.id },
    });
  };

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor }]}
      edges={["top"]}
    >
      <ScreenHeader
        title="Assets"
        subtitle="Field assets"
        showBack
        type="standard"
      />

      <View style={styles.listContainer}>
        <View
          style={[
            styles.summaryCard,
            { backgroundColor: cardColor, borderColor },
          ]}
        >
          <View style={styles.summaryHeader}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.summaryTitle, { color: textColor }]}>
                Assets
              </Text>
              <Text style={[styles.summarySubtitle, { color: subtextColor }]}>
                Nearby assets and status
              </Text>
            </View>
            <GlassButton
              style={styles.refreshButton}
              contentStyle={styles.refreshButtonGlass}
              borderColor={borderColor}
              fallbackColor="rgba(16, 185, 129, 0.08)"
              onPress={() => void resolveNearbyAssets()}
              disabled={isRefreshingGeo}
              accessibilityLabel="Refresh location"
            >
              {isRefreshingGeo ? (
                <ActivityIndicator size="small" color={tintColor} />
              ) : (
                <RefreshCw color={tintColor} size={16} />
              )}
            </GlassButton>
          </View>
          <View style={styles.summaryChips}>
            <View style={styles.chip}>
              <Text style={[styles.chipValue, { color: textColor }]}>
                {filteredData.length}
              </Text>
              <Text style={[styles.chipLabel, { color: subtextColor }]}>
                Assets
              </Text>
            </View>
            <View style={styles.chip}>
              <Text style={[styles.chipValue, { color: textColor }]}>
                {nearbyAssetIds.size}
              </Text>
              <Text style={[styles.chipLabel, { color: subtextColor }]}>
                Within 100m of your location
              </Text>
            </View>
          </View>
        </View>

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
                Loading assets...
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
                const isNearby = nearbyAssetIds.has(String(item.id));
                const distance = nearbyAssetDistances.get(String(item.id));
                const zoneName = resolveZoneName(item.zone);
                return (
                  <View>
                    <TouchableOpacity
                      style={[
                        styles.row,
                        isNearby && {
                          backgroundColor: isDark
                            ? "rgba(16, 185, 129, 0.14)"
                            : "rgba(209, 250, 229, 0.75)",
                        },
                      ]}
                      onPress={() => handleItemPress(item)}
                    >
                      <View
                        style={[
                          styles.iconContainer,
                          {
                            backgroundColor: isNearby
                              ? isDark
                                ? "rgba(16, 185, 129, 0.18)"
                                : "rgba(209, 250, 229, 0.9)"
                              : isDark
                                ? "#3b2f1f"
                                : "#FFFBEB",
                          },
                        ]}
                      >
                        <MapPin
                          color={isNearby ? emerald : "#F59E0B"}
                          size={24}
                        />
                      </View>
                      <View style={styles.info}>
                        <Text style={[styles.itemTitle, { color: textColor }]}>
                          {item.name || item.markerId || item.id}
                        </Text>
                        <Text
                          style={[styles.itemSubtitle, { color: subtextColor }]}
                        >
                          {item.type || "Marker"} • Zone {zoneName}
                        </Text>
                        <Text style={[styles.itemMeta, { color: textColor }]}>
                          {item.location || "Location unavailable"}
                        </Text>
                        <Text
                          style={[styles.itemMetaSub, { color: subtextColor }]}
                        >
                          Created{" "}
                          {item.createdAt ? String(item.createdAt) : "N/A"}
                        </Text>
                        {isNearby && (
                          <Text
                            style={[styles.nearbyLabel, { color: emerald }]}
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
                                item.status === "Active"
                                  ? "#DCFCE7"
                                  : "#FEE2E2",
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.statusBadgeText,
                              {
                                color:
                                  item.status === "Active"
                                    ? "#166534"
                                    : "#991B1B",
                              },
                            ]}
                          >
                            {item.status || "Unknown"}
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
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
  },
  summaryHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
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
  summaryChips: {
    flexDirection: "row",
    gap: 12,
    marginTop: 14,
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
  listContent: { paddingBottom: 20 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 16,
  },
  info: { flex: 1 },
  itemTitle: { fontSize: 16, fontWeight: "600" },
  itemSubtitle: { fontSize: 14, marginTop: 2 },
  itemMeta: { fontSize: 12, marginTop: 4, fontWeight: "700" },
  itemMetaSub: { fontSize: 11, marginTop: 2, fontWeight: "500", opacity: 0.75 },
  nearbyLabel: {
    fontSize: 11,
    marginTop: 4,
    fontWeight: "700",
  },
  rightContent: { flexDirection: "row", alignItems: "center" },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  statusBadgeText: { fontSize: 12, fontWeight: "600" },
  divider: { height: 1, marginLeft: 76 },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  loadingText: { marginTop: 10, fontSize: 13, fontWeight: "600" },
});
