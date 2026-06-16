import React, { useEffect, useState, useRef } from "react";
import {
  View,
  StyleSheet,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
} from "react-native";
import MapView, {
  Marker,
  Polyline,
  Polygon,
  PROVIDER_DEFAULT,
  UrlTile,
} from "react-native-maps";
import { SafeAreaView } from "react-native-safe-area-context";
import { LocateFixed, Wifi, WifiOff, X } from "lucide-react-native";
import NetInfo from "@react-native-community/netinfo";
import * as Location from "expo-location";
import {
  subscribeToPipelines,
  subscribeToZones,
  subscribeToMarkers,
} from "../../lib/firebase";
import {
  subscribeToRepairSyncState,
  syncQueuedRepairs,
  type RepairSyncState,
} from "../../lib/repairSync";
import { useTheme } from "@/context/ThemeContext";
import { useThemeColor } from "@/hooks/use-theme-color";
import { ScreenHeader } from "../../components/ScreenHeader";
import { GlassButton } from "@/components/GlassButton";

const getRiskBandColors = (band: string) => {
  const normalized = String(band || "").toLowerCase();

  if (normalized === "high") {
    return { backgroundColor: "#FEE2E2", color: "#991B1B" };
  }

  if (normalized === "medium") {
    return { backgroundColor: "#FEF3C7", color: "#92400E" };
  }

  return { backgroundColor: "#D1FAE5", color: "#065F46" };
};

const getConfidenceBandColors = (band: string) => {
  const normalized = String(band || "").toLowerCase();

  if (normalized === "high") {
    return { backgroundColor: "#DBEAFE", color: "#1E3A8A" };
  }

  if (normalized === "medium") {
    return { backgroundColor: "#EDE9FE", color: "#5B21B6" };
  }

  return { backgroundColor: "#E2E8F0", color: "#334155" };
};

const getRiskStrokeColor = (band: string) => {
  const normalized = String(band || "").toLowerCase();
  if (normalized === "high") return "#DC2626";
  if (normalized === "medium") return "#D97706";
  return "#059669";
};

const hexToRgba = (hex: string, alpha: number) => {
  const clean = hex.replace("#", "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  const value = parseInt(full, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const getZoneBandFromScore = (score: number) => {
  if (score >= 67) {
    return { band: "High", color: "#DC2626", fillOpacity: 0.18 };
  }
  if (score >= 34) {
    return { band: "Medium", color: "#D97706", fillOpacity: 0.14 };
  }
  return { band: "Low", color: "#059669", fillOpacity: 0.11 };
};

const getZonePolygonColors = (props: any) => {
  const band = String(props?.zoneRiskBand || "");
  const riskBand =
    band === "High" || band === "Medium" || band === "Low" ? band : null;
  const explicitColor = String(props?.zoneRiskColor || "").trim();
  const score = Number(props?.zoneRiskScore ?? props?.highRiskPercent);

  if (explicitColor) {
    const fillOpacity = Number.isFinite(Number(props?.zoneFillOpacity))
      ? Number(props.zoneFillOpacity)
      : 0.11;
    return {
      strokeColor: explicitColor,
      fillColor: hexToRgba(explicitColor, fillOpacity),
    };
  }

  if (riskBand) {
    const color = getRiskStrokeColor(riskBand);
    const fillOpacity = Number.isFinite(Number(props?.zoneFillOpacity))
      ? Number(props.zoneFillOpacity)
      : riskBand === "High"
        ? 0.18
        : riskBand === "Medium"
          ? 0.14
          : 0.11;
    return {
      strokeColor: color,
      fillColor: hexToRgba(color, fillOpacity),
    };
  }

  if (Number.isFinite(score)) {
    const fromScore = getZoneBandFromScore(score);
    return {
      strokeColor: fromScore.color,
      fillColor: hexToRgba(fromScore.color, fromScore.fillOpacity),
    };
  }

  return {
    strokeColor: "#059669",
    fillColor: hexToRgba("#059669", 0.11),
  };
};

const getPointCoordinate = (
  feature: any,
): { latitude: number; longitude: number } | null => {
  const geometry = feature?.geometry;
  if (
    geometry?.type === "Point" &&
    Array.isArray(geometry?.coordinates) &&
    geometry.coordinates.length >= 2
  ) {
    const lng = Number(geometry.coordinates[0]);
    const lat = Number(geometry.coordinates[1]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { latitude: lat, longitude: lng };
    }
  }

  const pair = feature?.coordinates || feature?.coordinate;
  if (Array.isArray(pair) && pair.length >= 2) {
    const lng = Number(pair[0]);
    const lat = Number(pair[1]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { latitude: lat, longitude: lng };
    }
  }

  const latitude = Number(feature?.latitude ?? feature?.lat);
  const longitude = Number(feature?.longitude ?? feature?.lng ?? feature?.lon);
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    return { latitude, longitude };
  }

  return null;
};

export default function MapScreen() {
  const OFFLINE_GRACE_MS = 30000;
  const { showPipelines, showZones, isDark, mapType } = useTheme();
  const mapRef = useRef<MapView>(null);
  const wasOnlineRef = useRef<boolean | null>(null);
  const latestOnlineRef = useRef<boolean>(true);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const offlineGraceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastAnim = useRef(new Animated.Value(0)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;
  const backgroundColor = useThemeColor({}, "background");

  const [pipelines, setPipelines] = useState<any[]>([]);
  const [zones, setZones] = useState<any[]>([]);
  const [markers, setMarkers] = useState<any[]>([]);
  const [isConnected, setIsConnected] = useState(true);
  const [repairSyncState, setRepairSyncState] = useState<RepairSyncState>({
    isSyncing: false,
    trigger: null,
    pendingCount: 0,
    processedCount: 0,
    syncedCount: 0,
    failedCount: 0,
  });
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [selectedPipeline, setSelectedPipeline] = useState<any | null>(null);
  const [connectivityToast, setConnectivityToast] = useState<{
    visible: boolean;
    text: string;
    tone: "online" | "offline";
  }>({
    visible: false,
    text: "",
    tone: "online",
  });
  const [currentTime, setCurrentTime] = useState(() => {
    const now = new Date();
    return now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  });

  // Live clock — updates every minute
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      );
    };
    const timer = setInterval(tick, 60000);
    return () => clearInterval(timer);
  }, []);

  // Debug payload interceptor
  useEffect(() => {
    if (zones.length > 0) console.log("[Expo Map] LIVE ZONES:", zones.length);
  }, [zones]);

  // Request location permissions
  useEffect(() => {
    (async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        console.log("Permission to access location was denied");
      }
    })();
  }, []);

  // Center camera on user location dynamically
  const centerOnUser = async () => {
    try {
      let location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      mapRef.current?.animateToRegion(
        {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        },
        1000,
      );
    } catch (e) {
      console.log("Error locating user:", e);
    }
  };

  // Firebase + network subscriptions
  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
      if (offlineGraceTimerRef.current) {
        clearTimeout(offlineGraceTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const ratio =
      repairSyncState.pendingCount > 0
        ? Math.min(repairSyncState.processedCount / repairSyncState.pendingCount, 1)
        : 0;

    Animated.timing(progressAnim, {
      toValue: ratio,
      duration: 300,
      useNativeDriver: false,
    }).start();
  }, [progressAnim, repairSyncState.pendingCount, repairSyncState.processedCount]);

  useEffect(() => {
    Animated.spring(toastAnim, {
      toValue: connectivityToast.visible ? 1 : 0,
      friction: 8,
      tension: 75,
      useNativeDriver: true,
    }).start();
  }, [connectivityToast.visible, toastAnim]);

  useEffect(() => {
    const unsubscribeSyncState = subscribeToRepairSyncState((state) => {
      setRepairSyncState(state);
    });

    void syncQueuedRepairs("app-start");

    const unsubscribeNet = NetInfo.addEventListener((state) => {
      const isOnlineNow =
        !!state.isConnected && state.isInternetReachable !== false;
      latestOnlineRef.current = isOnlineNow;

      setIsConnected(isOnlineNow);

      if (wasOnlineRef.current !== null && wasOnlineRef.current !== isOnlineNow) {
        if (isOnlineNow) {
          if (offlineGraceTimerRef.current) {
            clearTimeout(offlineGraceTimerRef.current);
            offlineGraceTimerRef.current = null;
          }
          if (toastTimerRef.current) {
            clearTimeout(toastTimerRef.current);
          }

          setConnectivityToast({
            visible: true,
            text: "You're back online",
            tone: "online",
          });

          toastTimerRef.current = setTimeout(() => {
            setConnectivityToast((prev) => ({ ...prev, visible: false }));
          }, 3000);
        } else {
          if (offlineGraceTimerRef.current) {
            clearTimeout(offlineGraceTimerRef.current);
          }

          offlineGraceTimerRef.current = setTimeout(() => {
            if (!latestOnlineRef.current) {
              if (toastTimerRef.current) {
                clearTimeout(toastTimerRef.current);
              }

              setConnectivityToast({
                visible: true,
                text: "You're currently offline",
                tone: "offline",
              });

              toastTimerRef.current = setTimeout(() => {
                setConnectivityToast((prev) => ({ ...prev, visible: false }));
              }, 3000);
            }
          }, OFFLINE_GRACE_MS);
        }
      }

      if (wasOnlineRef.current === false && isOnlineNow) {
        void syncQueuedRepairs("reconnect");
      }

      wasOnlineRef.current = isOnlineNow;
    });
    const unsubscribePipelines = subscribeToPipelines((data) => {
      setPipelines(data);
      setIsLoadingData(false);
      setLastUpdated(
        new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
      );
    });
    const unsubscribeZones = subscribeToZones((data) => {
      setZones(data);
      setIsLoadingData(false);
      setLastUpdated(
        new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
      );
    });
    const unsubscribeMarkers = subscribeToMarkers((data) => {
      setMarkers(data);
      setIsLoadingData(false);
      setLastUpdated(
        new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
      );
    });
    return () => {
      unsubscribeSyncState();
      unsubscribeNet();
      unsubscribePipelines();
      unsubscribeZones();
      unsubscribeMarkers();
    };
  }, []);

  const textColor = isDark ? "#f8fafc" : "#0f172a";
  const navbarBg = isDark
    ? "rgba(15, 23, 42, 0.85)"
    : "rgba(255, 255, 255, 0.9)";
  const navbarBorder = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.04)";
  const selectedRiskBand = String(
    selectedPipeline?.riskBand || selectedPipeline?.risk_band || "Unknown",
  );
  const selectedConfidenceBand = String(
    selectedPipeline?.confidenceBand ||
      selectedPipeline?.confidence_band ||
      "Unknown",
  );
  const selectedRiskColors = getRiskBandColors(selectedRiskBand);
  const selectedConfidenceColors = getConfidenceBandColors(
    selectedConfidenceBand,
  );
  const selectedRouteLabel = selectedPipeline
    ? [selectedPipeline.startLocation, selectedPipeline.endLocation]
        .filter(Boolean)
        .join(" to ")
    : "";
  const syncProgressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0%", "100%"],
  });

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor }]}
      edges={["top"]}
    >
      <ScreenHeader
        title="Field Map"
        subtitle={
          lastUpdated ? `Updated ${lastUpdated}` : `Live view · ${currentTime}`
        }
        type="large"
        rightAction={
          <View style={styles.statusIndicatorWrap}>
            <View
              style={[
                styles.statusDot,
                { backgroundColor: isConnected ? "#10b981" : "#ef4444" },
              ]}
            />
          </View>
        }
      />
      <View style={{ flex: 1 }}>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.toastWrap,
            {
              opacity: toastAnim,
              transform: [
                {
                  translateY: toastAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-8, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <View
            style={[
              styles.networkToast,
              {
                backgroundColor: isDark
                  ? "rgba(15,23,42,0.88)"
                  : "rgba(255,255,255,0.9)",
                borderColor:
                  connectivityToast.tone === "online"
                    ? "rgba(16,185,129,0.5)"
                    : "rgba(239,68,68,0.45)",
              },
            ]}
          >
            <View
              style={[
                styles.networkToastIconWrap,
                {
                  backgroundColor:
                    connectivityToast.tone === "online"
                      ? "rgba(16,185,129,0.14)"
                      : "rgba(239,68,68,0.14)",
                },
              ]}
            >
              {connectivityToast.tone === "online" ? (
                <Wifi size={15} color={isDark ? "#34d399" : "#059669"} />
              ) : (
                <WifiOff size={15} color={isDark ? "#f87171" : "#dc2626"} />
              )}
            </View>
            <Text style={[styles.networkToastText, { color: textColor }]}> 
              {connectivityToast.tone === "online"
                ? "Connection restored"
                : "No internet connection"}
            </Text>
          </View>
        </Animated.View>

        <MapView
          ref={mapRef}
          provider={PROVIDER_DEFAULT}
          mapType={mapType === "satellite" ? "satellite" : "none"}
          userInterfaceStyle={isDark ? "dark" : "light"}
          style={styles.map}
          showsUserLocation={true}
          showsMyLocationButton={false}
          initialRegion={{
            latitude: 6.927079,
            longitude: 79.861244,
            latitudeDelta: 0.02,
            longitudeDelta: 0.02,
          }}
        >
          {/* URL Tiles */}
          {mapType === "street" && (
            <UrlTile
              key="street-osm"
              urlTemplate="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
              maximumZ={19}
              flipY={false}
            />
          )}

          {/* Render Zones */}
          {showZones &&
            zones
              .filter((f) => f.geometry && f.geometry.type === "Polygon")
              .map((feature: any) => {
                const coords = feature.geometry.coordinates[0].map(
                  (coord: [number, number]) => ({
                    latitude: coord[1],
                    longitude: coord[0],
                  }),
                );
                const zoneColors = getZonePolygonColors(feature);
                return (
                  <Polygon
                    key={`zone-${feature.id}-${coords.length}`}
                    coordinates={coords}
                    fillColor={zoneColors.fillColor}
                    strokeColor={zoneColors.strokeColor}
                    strokeWidth={2}
                    zIndex={1}
                  />
                );
              })}

          {/* Render Pipelines */}
          {showPipelines &&
            pipelines
              .filter((f) => f.geometry && f.geometry.type === "LineString")
              .map((feature: any) => {
                const coords = feature.geometry.coordinates.map(
                  (coord: [number, number]) => ({
                    latitude: coord[1],
                    longitude: coord[0],
                  }),
                );

                const startLabel = feature.startLocation;
                const endLabel = feature.endLocation;
                const riskBand = String(
                  feature.riskBand || feature.risk_band || "Unknown",
                );
                const riskColor = getRiskStrokeColor(riskBand);

                return (
                  <React.Fragment key={`pipeline-${feature.id}`}>
                    <Polyline
                      onPress={() => setSelectedPipeline(feature)}
                      coordinates={coords}
                      strokeColor={riskColor}
                      strokeWidth={5}
                      lineCap="round"
                      lineJoin="round"
                      zIndex={3}
                    />
                    {/* Start node */}
                    {coords.length >= 2 && startLabel && (
                      <Marker
                        coordinate={coords[0]}
                        anchor={{ x: 0.5, y: 0.5 }}
                        onPress={() => setSelectedPipeline(feature)}
                        zIndex={4}
                      >
                        <View style={styles.chipContainer}>
                          <View
                            style={[
                              styles.chipDot,
                              { backgroundColor: "#10b981" },
                            ]}
                          />
                          <Text style={styles.chipText}>{startLabel}</Text>
                        </View>
                      </Marker>
                    )}
                    {/* End node */}
                    {coords.length >= 2 && endLabel && (
                      <Marker
                        coordinate={coords[coords.length - 1]}
                        anchor={{ x: 0.5, y: 0.5 }}
                        onPress={() => setSelectedPipeline(feature)}
                        zIndex={4}
                      >
                        <View style={styles.chipContainer}>
                          <View
                            style={[
                              styles.chipDot,
                              { backgroundColor: "#ef4444" },
                            ]}
                          />
                          <Text style={styles.chipText}>{endLabel}</Text>
                        </View>
                      </Marker>
                    )}
                  </React.Fragment>
                );
              })}

          {/* Render Assets */}
          {markers
            .map((feature: any) => ({
              feature,
              point: getPointCoordinate(feature),
            }))
            .filter((item) => item.point !== null)
            .map(({ feature, point }: any) => {
              return (
                <Marker
                  key={`asset-${feature.id}`}
                  coordinate={point}
                  anchor={{ x: 0.5, y: 0.9 }}
                  zIndex={5}
                >
                  <View style={styles.assetPinWrap}>
                    <View style={styles.assetPinInner}>
                      <View style={styles.assetPinCore} />
                    </View>
                  </View>
                </Marker>
              );
            })}
        </MapView>

        {isLoadingData && (
          <View style={styles.loadingOverlay}>
            <View style={styles.loadingCard}>
              <ActivityIndicator
                size="small"
                color={isDark ? "#fbbf24" : "#0ea5e9"}
              />
              <Text style={[styles.loadingText, { color: textColor }]}>
                Loading map data...
              </Text>
            </View>
          </View>
        )}

        {!isLoadingData && (
          <View pointerEvents="box-none" style={styles.mapAssessmentWrap}>
            <View
              style={[
                styles.mapAssessmentCard,
                { backgroundColor: navbarBg, borderColor: navbarBorder },
              ]}
            >
              {selectedPipeline ? (
                <>
                  <TouchableOpacity
                    style={styles.mapAssessmentClose}
                    onPress={() => setSelectedPipeline(null)}
                  >
                    <X color={textColor} size={18} />
                  </TouchableOpacity>
                  <Text
                    style={[styles.mapAssessmentTitle, { color: textColor }]}
                  >
                    Pipeline assessment
                  </Text>
                  <Text
                    style={[
                      styles.mapAssessmentSubtitle,
                      { color: isDark ? "#cbd5e1" : "#475569" },
                    ]}
                  >
                    {selectedRouteLabel || "Selected pipeline"}
                  </Text>
                  <View style={styles.mapBandRow}>
                    <View
                      style={[
                        styles.mapBandPill,
                        { backgroundColor: selectedRiskColors.backgroundColor },
                      ]}
                    >
                      <Text
                        style={[
                          styles.mapBandLabel,
                          { color: selectedRiskColors.color },
                        ]}
                      >
                        Risk
                      </Text>
                      <Text
                        style={[
                          styles.mapBandValue,
                          { color: selectedRiskColors.color },
                        ]}
                      >
                        {selectedRiskBand}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.mapBandPill,
                        {
                          backgroundColor:
                            selectedConfidenceColors.backgroundColor,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.mapBandLabel,
                          { color: selectedConfidenceColors.color },
                        ]}
                      >
                        Confidence
                      </Text>
                      <Text
                        style={[
                          styles.mapBandValue,
                          { color: selectedConfidenceColors.color },
                        ]}
                      >
                        {selectedConfidenceBand}
                      </Text>
                    </View>
                  </View>
                </>
              ) : (
                <>
                  <Text
                    style={[styles.mapAssessmentTitle, { color: textColor }]}
                  >
                    Tap a pipeline or endpoint
                  </Text>
                  <Text
                    style={[
                      styles.mapAssessmentSubtitle,
                      { color: isDark ? "#cbd5e1" : "#475569" },
                    ]}
                  >
                    The panel shows risk and confidence bands.
                  </Text>
                </>
              )}
            </View>
          </View>
        )}

        {repairSyncState.isSyncing && (
          <View pointerEvents="none" style={styles.syncBannerWrap}>
            <View
              style={[
                styles.syncBanner,
                {
                  backgroundColor: navbarBg,
                  borderColor: navbarBorder,
                },
              ]}
            >
              <View style={styles.syncBannerHeader}>
                <ActivityIndicator
                  size="small"
                  color={isDark ? "#fbbf24" : "#0284c7"}
                />
                <Text style={[styles.syncBannerTitle, { color: textColor }]}> 
                  Syncing your saved repairs...
                </Text>
                <Text
                  style={[
                    styles.syncBannerCount,
                    { color: isDark ? "#cbd5e1" : "#475569" },
                  ]}
                >
                  {repairSyncState.processedCount}/{repairSyncState.pendingCount}
                </Text>
              </View>
              <View style={styles.syncProgressTrack}>
                <Animated.View
                  style={[
                    styles.syncProgressFill,
                    {
                      width: syncProgressWidth,
                      backgroundColor: isDark ? "#fbbf24" : "#0284c7",
                    },
                  ]}
                />
              </View>
            </View>
          </View>
        )}

        {/* Locate Me Button */}
        <GlassButton
          style={styles.locateBtn}
          onPress={centerOnUser}
          contentStyle={styles.locateBtnGlass}
          borderColor={navbarBorder}
          fallbackColor={navbarBg}
          accessibilityLabel="Locate me"
        >
          <LocateFixed color={textColor} size={21} />
        </GlassButton>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { width: "100%", height: "100%" },
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 10,
    alignItems: "center",
  },
  statusChip: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 24, // standard native toast curve
    borderWidth: 1,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
    overflow: "hidden",
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#10b981",
  }, // emerald-500
  statusText: { fontSize: 13, fontWeight: "700", letterSpacing: 0.2 },
  chipContainer: {
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 999,
    backgroundColor: "rgba(15,23,42,0.78)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.22)",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    shadowColor: "#000",
    shadowOpacity: 0.22,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 6,
    elevation: 3,
  },
  chipDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  chipText: {
    color: "white",
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0,
    lineHeight: 12, // Needs to be explicitly small
  },
  assetPinWrap: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(15, 23, 42, 0.78)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.35)",
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
    elevation: 3,
  },
  assetPinInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
  },
  assetPinCore: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#F59E0B",
  },
  statusIndicatorWrap: {
    width: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  toastWrap: {
    position: "absolute",
    top: 8,
    left: 16,
    right: 16,
    zIndex: 95,
  },
  networkToastWrap: {
    alignItems: "center",
  },
  networkToast: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    elevation: 3,
  },
  networkToastIconWrap: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  networkToastText: {
    fontSize: 12,
    fontWeight: "700",
  },
  locateBtn: {
    position: "absolute",
    bottom: 120,
    right: 18,
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
    elevation: 8,
  },
  locateBtnGlass: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(15, 23, 42, 0.08)",
  },
  loadingCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.92)",
  },
  loadingText: {
    fontSize: 13,
    fontWeight: "700",
  },
  mapAssessmentCard: {
    position: "absolute",
    left: 16,
    right: 16,
    top: 14,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 14,
    borderRadius: 18,
    borderWidth: 1,
    zIndex: 50,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  mapAssessmentTitle: {
    fontSize: 14,
    fontWeight: "800",
    paddingRight: 30,
  },
  mapAssessmentSubtitle: {
    marginTop: 3,
    fontSize: 12,
    fontWeight: "500",
    paddingRight: 30,
  },
  mapAssessmentClose: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(148, 163, 184, 0.16)",
    zIndex: 60,
  },
  mapAssessmentWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    zIndex: 50,
  },
  mapBandRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 10,
  },
  mapBandPill: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 2,
  },
  mapBandLabel: {
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  mapBandValue: {
    fontSize: 16,
    fontWeight: "800",
  },
  syncBannerWrap: {
    position: "absolute",
    left: 16,
    right: 16,
    top: 106,
    zIndex: 70,
  },
  syncBanner: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  syncBannerHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  syncBannerTitle: {
    flex: 1,
    fontSize: 12,
    fontWeight: "700",
  },
  syncBannerCount: {
    fontSize: 11,
    fontWeight: "700",
  },
  syncProgressTrack: {
    height: 6,
    borderRadius: 999,
    overflow: "hidden",
    backgroundColor: "rgba(148, 163, 184, 0.26)",
  },
  syncProgressFill: {
    height: "100%",
    borderRadius: 999,
  },
});
