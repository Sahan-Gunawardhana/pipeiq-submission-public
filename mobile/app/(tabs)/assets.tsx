import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Location from "expo-location";
import { Database, Grip, MapPin, ChevronRight } from "lucide-react-native";
import { useRouter } from "expo-router";
import { ScreenHeader } from "../../components/ScreenHeader";
import { useThemeColor } from "@/hooks/use-theme-color";
import { useTheme } from "@/context/ThemeContext";
import {
  subscribeToMarkers,
  subscribeToPipelines,
  subscribeToZones,
  findNearbyPipelinesForCoordinates,
  NEARBY_RADIUS_METERS,
} from "../../lib/firebase";

export default function AssetsScreen() {
  const router = useRouter();
  const { isDark } = useTheme();
  const backgroundColor = useThemeColor({}, "background");
  const textColor = useThemeColor({}, "text");
  const subtextColor = useThemeColor({}, "subtext");
  const iconBaseColor = useThemeColor({}, "icon");
  const borderColor = useThemeColor({}, "border");
  const cardColor = useThemeColor({}, "card");

  const [isLoading, setIsLoading] = React.useState(true);
  const [pipelineCount, setPipelineCount] = React.useState(0);
  const [zoneCount, setZoneCount] = React.useState(0);
  const [markerCount, setMarkerCount] = React.useState(0);
  const [pipelineReady, setPipelineReady] = React.useState(false);
  const [zoneReady, setZoneReady] = React.useState(false);
  const [markerReady, setMarkerReady] = React.useState(false);
  const [nearbyPipelineCount, setNearbyPipelineCount] = React.useState(0);

  const resolveGeoContext = React.useCallback(async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      setNearbyPipelineCount(0);
      return;
    }

    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    const latitude = position.coords.latitude;
    const longitude = position.coords.longitude;

    const nearby = await findNearbyPipelinesForCoordinates(
      latitude,
      longitude,
      NEARBY_RADIUS_METERS,
      100,
    );
    setNearbyPipelineCount(nearby.length);
  }, []);

  React.useEffect(() => {
    const unsubscribePipelines = subscribeToPipelines((data) => {
      setPipelineCount(data.length);
      setPipelineReady(true);
    });

    const unsubscribeZones = subscribeToZones((data) => {
      setZoneCount(data.length);
      setZoneReady(true);
    });

    const unsubscribeMarkers = subscribeToMarkers((data) => {
      setMarkerCount(data.length);
      setMarkerReady(true);
    });

    return () => {
      unsubscribePipelines();
      unsubscribeZones();
      unsubscribeMarkers();
    };
  }, []);

  React.useEffect(() => {
    setIsLoading(!(pipelineReady && zoneReady && markerReady));
  }, [pipelineReady, zoneReady, markerReady]);

  React.useEffect(() => {
    void resolveGeoContext();
  }, [resolveGeoContext]);

  const menuItems = [
    {
      title: "Pipelines",
      subtitle:
        pipelineCount > 0
          ? `${pipelineCount} network segments`
          : "No pipelines available",
      detail:
        pipelineCount > 0
          ? `${nearbyPipelineCount} pipelines nearby`
          : "No records yet",
      icon: Database,
      color: "#337AB7",
      route: "/lists/pipelines",
    },
    {
      title: "Zones",
      subtitle:
        zoneCount > 0 ? `${zoneCount} zones & sub-zones` : "No zones available",
      detail: zoneCount > 0 ? `${zoneCount} zone records` : "No records yet",
      icon: Grip,
      color: "#10B981",
      route: "/lists/zones",
    },
    {
      title: "Assets",
      subtitle:
        markerCount > 0 ? `${markerCount} field assets` : "No assets available",
      detail: "Type, zone, severity, and status",
      icon: MapPin,
      color: "#F59E0B",
      route: "/lists/markers",
    },
  ];

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor }]}
      edges={["top"]}
    >
      <ScreenHeader title="Assets" subtitle="Explore your data" type="large" />

      {isLoading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="small" color="#0ea5e9" />
          <Text
            style={{ marginTop: 10, color: subtextColor, fontWeight: "600" }}
          >
            Loading records...
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View
            style={[
              styles.summaryCard,
              { backgroundColor: cardColor, borderColor },
            ]}
          >
            <Text style={[styles.summaryTitle, { color: textColor }]}>
              Browse the network by category
            </Text>
            <View style={styles.statRow}>
              <View style={styles.statItem}>
                <Text style={[styles.statValue, { color: textColor }]}>
                  {pipelineCount}
                </Text>
                <Text style={[styles.statLabel, { color: subtextColor }]}>
                  Pipelines
                </Text>
              </View>
              <View style={styles.statItem}>
                <Text style={[styles.statValue, { color: textColor }]}>
                  {zoneCount}
                </Text>
                <Text style={[styles.statLabel, { color: subtextColor }]}>
                  Zones
                </Text>
              </View>
              <View style={styles.statItem}>
                <Text style={[styles.statValue, { color: textColor }]}>
                  {markerCount}
                </Text>
                <Text style={[styles.statLabel, { color: subtextColor }]}>
                  Assets
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
            {menuItems.map((item, index) => {
              const isLast = index === menuItems.length - 1;
              return (
                <View key={item.title}>
                  <TouchableOpacity
                    style={styles.itemRow}
                    onPress={() => router.push(item.route as any)}
                  >
                    <View
                      style={[
                        styles.iconBox,
                        {
                          backgroundColor: isDark
                            ? `${item.color}20`
                            : `${item.color}15`,
                        },
                      ]}
                    >
                      <item.icon color={item.color} size={24} />
                    </View>
                    <View style={styles.info}>
                      <Text style={[styles.cardTitle, { color: textColor }]}>
                        {item.title}
                      </Text>
                      <Text
                        style={[styles.cardSubtitle, { color: subtextColor }]}
                      >
                        {item.subtitle}
                      </Text>
                      <Text style={[styles.cardDetail, { color: textColor }]}>
                        {item.detail}
                      </Text>
                    </View>
                    <ChevronRight color={iconBaseColor} size={20} />
                  </TouchableOpacity>
                  {!isLast && (
                    <View
                      style={[styles.divider, { backgroundColor: borderColor }]}
                    />
                  )}
                </View>
              );
            })}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    paddingHorizontal: 24,
    paddingTop: 0,
    paddingBottom: 40,
    gap: 16,
  },
  summaryCard: {
    borderRadius: 24,
    borderWidth: 1,
    padding: 18,
  },
  summaryTitle: {
    marginTop: 0,
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  statRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 16,
  },
  statItem: {
    flex: 1,
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 12,
    backgroundColor: "rgba(148, 163, 184, 0.08)",
  },
  statValue: {
    fontSize: 22,
    fontWeight: "700",
  },
  statLabel: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: "600",
  },
  sectionContent: {
    borderRadius: 20,
    borderWidth: 1,
    overflow: "hidden",
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 16,
  },
  info: {
    flex: 1,
    justifyContent: "center",
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 2,
    letterSpacing: -0.2,
  },
  cardSubtitle: {
    fontSize: 13,
    fontWeight: "500",
  },
  cardDetail: {
    fontSize: 12,
    marginTop: 4,
    fontWeight: "600",
    opacity: 0.78,
  },
  divider: { height: 1, marginLeft: 76 },
  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingBottom: 40,
  },
});
