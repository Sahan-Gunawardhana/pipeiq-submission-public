import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Image,
  Pressable,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import * as Location from "expo-location";
import * as ImagePicker from "expo-image-picker";
import { ScreenHeader } from "../../components/ScreenHeader";
import { GlassButton } from "@/components/GlassButton";
import { useThemeColor } from "@/hooks/use-theme-color";
import { useTheme } from "@/context/ThemeContext";
import {
  addRepairToPipelineFromMobile,
  findNearbyPipelinesForCoordinates,
  NEARBY_RADIUS_METERS,
  uploadRepairImages,
  fetchPipelinesFromFirestore,
} from "../../lib/firebase";
import { addRepairLog } from "../../lib/repairLogs";
import NetInfo from "@react-native-community/netinfo";
import { enqueueRepair } from "../../lib/repairQueue";
import { GlassContainer, GlassView } from "expo-glass-effect";
import {
  subscribeToRepairSyncState,
  type RepairSyncState,
} from "../../lib/repairSync";
import {
  MapPin,
  AlertTriangle,
  FileText,
  Camera,
  Check,
  Droplets,
  Activity,
  RefreshCw,
  ChevronDown,
} from "lucide-react-native";

export default function AddRepairScreen() {
  const MAX_REPAIR_IMAGES = 3;
  const insets = useSafeAreaInsets();
  const { isDark } = useTheme();
  const backgroundColor = useThemeColor({}, "background");
  const textColor = useThemeColor({}, "text");
  const subtextColor = useThemeColor({}, "subtext");
  const borderColor = useThemeColor({}, "border");

  // Mock Form State
  const [isFetchingGps, setIsFetchingGps] = useState(false);
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [issueType, setIssueType] = useState("Leak");
  const [severity, setSeverity] = useState("Routine");
  const [flowRate, setFlowRate] = useState("Trickle");
  const [notes, setNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [nearbyPipelines, setNearbyPipelines] = useState<any[]>([]);
  const [isMatchingPipeline, setIsMatchingPipeline] = useState(false);
  const [selectedPipelineId, setSelectedPipelineId] = useState("");
  const [showPipelineDropdown, setShowPipelineDropdown] = useState(false);
  const [depthM, setDepthM] = useState("");
  const [selectedImages, setSelectedImages] = useState<
    Array<{ uri: string; fileName: string }>
  >([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [allPipelines, setAllPipelines] = useState<any[]>([]);
  const [isSearchingAll, setIsSearchingAll] = useState(false);
  const [userLat, setUserLat] = useState<number | null>(null);
  const [userLng, setUserLng] = useState<number | null>(null);
  const [coordinateError, setCoordinateError] = useState("");
  const [hasCheckedPipelines, setHasCheckedPipelines] = useState(false);
  const [repairSyncState, setRepairSyncState] = useState<RepairSyncState>({
    isSyncing: false,
    trigger: null,
    pendingCount: 0,
    processedCount: 0,
    syncedCount: 0,
    failedCount: 0,
  });

  const wait = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));

  const getPipelineLabel = (pipeline: any) => {
    const start = String(
      pipeline.startLocation || pipeline.startPoint || "Unknown start",
    );
    const end = String(
      pipeline.endLocation || pipeline.endPoint || "Unknown end",
    );
    return `${start} - ${end}`;
  };

  const getPipelineDepth = (pipeline: any) => {
    const parsedDepth = Number(
      pipeline.depthM ?? pipeline.depth_m ?? pipeline.depth,
    );
    if (!Number.isFinite(parsedDepth)) {
      return "";
    }

    return String(parsedDepth);
  };

  const parseCoordinateFields = () => {
    const latitude = Number(lat);
    const longitude = Number(lng);

    if (!lat.trim() || !lng.trim()) {
      return {
        errorMessage: "Enter both latitude and longitude.",
      };
    }

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return {
        errorMessage: "Latitude and longitude must be valid numbers.",
      };
    }

    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
      return {
        errorMessage:
          "Enter valid latitude (-90 to 90) and longitude (-180 to 180).",
      };
    }

    return { latitude, longitude };
  };

  const formatDistanceLabel = (value: unknown) => {
    const distance = Number(value);
    if (!Number.isFinite(distance)) {
      return "Distance unavailable";
    }

    return `${Math.round(distance)}m`;
  };

  const toFiniteNumber = (value: unknown) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  };

  const distanceInMeters = (
    fromLat: number,
    fromLng: number,
    toLat: number,
    toLng: number,
  ) => {
    const toRad = (degrees: number) => (degrees * Math.PI) / 180;
    const earthRadiusMeters = 6371000;
    const latDiff = toRad(toLat - fromLat);
    const lngDiff = toRad(toLng - fromLng);
    const a =
      Math.sin(latDiff / 2) ** 2 +
      Math.cos(toRad(fromLat)) *
        Math.cos(toRad(toLat)) *
        Math.sin(lngDiff / 2) ** 2;

    return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  const collectPipelineCoordinatePairs = (value: unknown): [number, number][] => {
    if (!Array.isArray(value)) {
      return [];
    }

    if (value.length >= 2) {
      const lng = toFiniteNumber(value[0]);
      const lat = toFiniteNumber(value[1]);
      if (lng !== null && lat !== null) {
        return [[lng, lat]];
      }
    }

    return value.flatMap((item) => collectPipelineCoordinatePairs(item));
  };

  const getDistanceToPipeline = (pipeline: any, userLat: number, userLng: number) => {
    const distances: number[] = [];
    const directLat = toFiniteNumber(pipeline.latitude ?? pipeline.lat);
    const directLng = toFiniteNumber(pipeline.longitude ?? pipeline.lng ?? pipeline.lon);

    if (directLat !== null && directLng !== null) {
      distances.push(distanceInMeters(userLat, userLng, directLat, directLng));
    }

    const geometryCoordinates =
      pipeline.geometry?.coordinates ?? pipeline.coordinates ?? [];
    const coordinatePairs = collectPipelineCoordinatePairs(geometryCoordinates);

    coordinatePairs.forEach(([lngValue, latValue]) => {
      distances.push(distanceInMeters(userLat, userLng, latValue, lngValue));
    });

    const validDistances = distances.filter(Number.isFinite);
    if (validDistances.length === 0) {
      return 0;
    }

    return Math.min(...validDistances);
  };

  const searchAllPipelines = async (query: string) => {
    if (!Number.isFinite(userLat) || !Number.isFinite(userLng)) {
      return [];
    }

    try {
      const allPipes = await fetchPipelinesFromFirestore();
      const queryLower = query.toLowerCase().trim();

      const filtered = allPipes.filter((pipeline: any) => {
        const label = `${pipeline.startLocation || pipeline.startPoint || ""} ${
          pipeline.endLocation || pipeline.endPoint || ""
        }`.toLowerCase();
        const id = (pipeline.id || "").toLowerCase();
        const material = (pipeline.material || "").toLowerCase();
        const zone = (pipeline.zoneId || "").toLowerCase();

        return (
          label.includes(queryLower) ||
          id.includes(queryLower) ||
          material.includes(queryLower) ||
          zone.includes(queryLower)
        );
      });

      const withDistance = filtered.map((pipeline: any) => {
        const distanceMeters = getDistanceToPipeline(
          pipeline,
          userLat as number,
          userLng as number,
        );

        return {
          pipelineId: pipeline.id,
          distanceMeters,
          pipeline,
        };
      });

      return withDistance.sort((a, b) => a.distanceMeters - b.distanceMeters);
    } catch (error) {
      console.error("[AddRepair] Search all pipelines failed", error);
      return [];
    }
  };

  const handleSearchPipelines = async (query: string) => {
    setSearchQuery(query);
    if (query.trim().length === 0) {
      setIsSearchingAll(false);
      setAllPipelines([]);
      return;
    }

    setIsSearchingAll(true);
    const results = await searchAllPipelines(query);
    setAllPipelines(results);
  };

  const applyDepthFromPipeline = (pipelineId: string) => {
    let matched = nearbyPipelines.find(
      (item) => item.pipelineId === pipelineId,
    );

    if (!matched && allPipelines.length > 0) {
      matched = allPipelines.find((item) => item.pipelineId === pipelineId);
    }

    if (!matched) {
      return;
    }

    const nextDepth = getPipelineDepth(matched.pipeline);
    setDepthM(nextDepth);
  };

  const refreshNearbyPipelines = async (
    latitude: number,
    longitude: number,
  ) => {
    setIsMatchingPipeline(true);
    setUserLat(latitude);
    setUserLng(longitude);
    setHasCheckedPipelines(false);

    try {
      const nearby = await findNearbyPipelinesForCoordinates(
        latitude,
        longitude,
        NEARBY_RADIUS_METERS,
        12,
      );
      setNearbyPipelines(nearby);
      setHasCheckedPipelines(true);

      if (!nearby.length) {
        setSelectedPipelineId("");
        setDepthM("");
        return;
      }

      const closestId = nearby[0].pipelineId;
      setSelectedPipelineId(closestId);
      const nextDepth = getPipelineDepth(nearby[0].pipeline);
      setDepthM(nextDepth);
    } catch (error) {
      console.error("[AddRepair] Failed to fetch nearby pipelines", error);
    } finally {
      setIsMatchingPipeline(false);
    }
  };

  const getSelectedPipelineLabel = () => {
    if (!selectedPipelineId) {
      if (hasCheckedPipelines && nearbyPipelines.length === 0) {
        return "No pipes nearby";
      }

      return "No pipeline selected";
    }

    let selected = nearbyPipelines.find(
      (item) => item.pipelineId === selectedPipelineId,
    );

    if (!selected && allPipelines.length > 0) {
      selected = allPipelines.find(
        (item) => item.pipelineId === selectedPipelineId,
      );
    }

    return selected ? getPipelineLabel(selected.pipeline) : selectedPipelineId;
  };

  const fetchLocation = async () => {
    setIsFetchingGps(true);

    try {
      await wait(850);
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Allow Location Access",
          "We need your location to capture GPS coordinates.",
        );
        return;
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      await wait(450);
      setLat(position.coords.latitude.toFixed(5));
      setLng(position.coords.longitude.toFixed(5));
      await refreshNearbyPipelines(
        position.coords.latitude,
        position.coords.longitude,
      );
    } catch (error) {
      console.error("[AddRepair] Failed to fetch GPS location", error);
      Alert.alert(
        "Location Unavailable",
        "Couldn't get your location. Enter coordinates manually instead.",
      );
    } finally {
      setIsFetchingGps(false);
    }
  };

  useEffect(() => {
    void fetchLocation();
  }, []);

  useEffect(() => {
    if (isFetchingGps) {
      return;
    }

    if (!lat.trim() && !lng.trim()) {
      setCoordinateError("");
      return;
    }

    const parsed = parseCoordinateFields();
    if ("errorMessage" in parsed) {
      setCoordinateError(parsed.errorMessage);
      return;
    }

    setCoordinateError("");
    const timeout = setTimeout(() => {
      void refreshNearbyPipelines(parsed.latitude, parsed.longitude);
    }, 650);

    return () => clearTimeout(timeout);
  }, [lat, lng, isFetchingGps]);

  useEffect(() => {
    const unsubscribeSyncState = subscribeToRepairSyncState((state) => {
      setRepairSyncState(state);
    });

    return () => {
      unsubscribeSyncState();
    };
  }, []);

  const buildRepairId = () =>
    `repair_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const addSelectedImage = (uri: string) => {
    setSelectedImages((prev) => {
      if (prev.length >= MAX_REPAIR_IMAGES) {
        Alert.alert(
          "Limit Reached",
          `You can attach up to ${MAX_REPAIR_IMAGES} images per repair.`,
        );
        return prev;
      }

      const fileName = uri.split("/").pop() || `repair-image-${Date.now()}.jpg`;

      return [...prev, { uri, fileName }];
    });
  };

  const pickFromCamera = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (permission.status !== "granted") {
      Alert.alert(
        "Camera Permission Needed",
        "Allow camera access to attach a repair image.",
      );
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      quality: 0.8,
      allowsEditing: false,
    });

    if (!result.canceled && result.assets.length > 0) {
      addSelectedImage(result.assets[0].uri);
    }
  };

  const pickFromLibrary = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (permission.status !== "granted") {
      Alert.alert(
        "Gallery Permission Needed",
        "Allow photo library access to attach a repair image.",
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
      allowsEditing: false,
      allowsMultipleSelection: false,
    });

    if (!result.canceled && result.assets.length > 0) {
      addSelectedImage(result.assets[0].uri);
    }
  };

  const handleAddImage = () => {
    if (selectedImages.length >= MAX_REPAIR_IMAGES) {
      Alert.alert(
        "Limit Reached",
        `You can attach up to ${MAX_REPAIR_IMAGES} images per repair.`,
      );
      return;
    }

    Alert.alert("Attach Photo", "Choose image source", [
      { text: "Take Photo", onPress: () => void pickFromCamera() },
      { text: "Choose from Library", onPress: () => void pickFromLibrary() },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const removeSelectedImage = (indexToRemove: number) => {
    setSelectedImages((prev) =>
      prev.filter((_, index) => index !== indexToRemove),
    );
  };

  const saveRepairLog = async () => {
    const parsedCoordinates = parseCoordinateFields();
    if ("errorMessage" in parsedCoordinates) {
      Alert.alert("Invalid Coordinates", parsedCoordinates.errorMessage);
      return;
    }
    const { latitude, longitude } = parsedCoordinates;

    if (!selectedPipelineId) {
      Alert.alert(
        "Select a Pipeline",
        "Choose a pipeline before saving this repair.",
      );
      return;
    }

    if (selectedImages.length > MAX_REPAIR_IMAGES) {
      Alert.alert(
        "Limit Reached",
        `You can attach up to ${MAX_REPAIR_IMAGES} images per repair.`,
      );
      return;
    }

    const repairId = buildRepairId();
    const trimmedNotes = notes.trim();
    const parsedDepthM = Number.isFinite(Number(depthM))
      ? Number(depthM)
      : undefined;

    setIsSaving(true);

    try {
      await addRepairLog({
        level: "info",
        action: "repair_submit_start",
        stage: "submit",
        status: "start",
        repairId,
        pipelineId: selectedPipelineId,
        metadata: {
          issueType,
          severity,
          flowRate,
          imageCount: selectedImages.length,
        },
      });

      const netState = await NetInfo.fetch();
      const isOnlineNow =
        !!netState.isConnected && netState.isInternetReachable !== false;

      if (!isOnlineNow) {
        const queued = await enqueueRepair({
          repairId,
          pipelineId: selectedPipelineId,
          formData: {
            latitude,
            longitude,
            issueType,
            severity,
            flowRate,
            notes: trimmedNotes,
            depthM: parsedDepthM,
          },
          images: selectedImages,
        });

        await addRepairLog({
          level: "info",
          action: "repair_offline_queue_created",
          stage: "queue",
          status: "success",
          repairId,
          pipelineId: selectedPipelineId,
          metadata: {
            queueDepth: queued.queueDepth,
            imageCount: selectedImages.length,
          },
        });

        await addRepairLog({
          level: "info",
          action: "repair_submit_complete",
          stage: "submit",
          status: "success",
          repairId,
          pipelineId: selectedPipelineId,
          message: "Queued locally while offline",
        });

        Alert.alert(
          "Saved Offline",
          "You're currently offline. We'll sync this repair as soon as you're back online.",
        );
        setNotes("");
        setSelectedImages([]);
        return;
      }

      let imageUrls: string[] = [];

      if (selectedImages.length > 0) {
        await addRepairLog({
          level: "info",
          action: "repair_image_upload_start",
          stage: "upload",
          status: "start",
          repairId,
          pipelineId: selectedPipelineId,
          metadata: {
            imageCount: selectedImages.length,
          },
        });

        imageUrls = await uploadRepairImages({
          pipelineId: selectedPipelineId,
          repairId,
          imageData: selectedImages,
        });

        await addRepairLog({
          level: "info",
          action: "repair_image_upload_complete",
          stage: "upload",
          status: "success",
          repairId,
          pipelineId: selectedPipelineId,
          metadata: {
            uploadedCount: imageUrls.length,
          },
        });

        if (imageUrls.length !== selectedImages.length) {
          throw new Error("Image upload incomplete");
        }
      }

      await addRepairLog({
        level: "info",
        action: "repair_firestore_write_start",
        stage: "firestore",
        status: "start",
        repairId,
        pipelineId: selectedPipelineId,
      });

      const result = await addRepairToPipelineFromMobile({
        latitude,
        longitude,
        issueType,
        severity,
        flowRate,
        notes: trimmedNotes,
        depthM: parsedDepthM,
        repairId,
        imageUrls,
        pipelineId: selectedPipelineId,
      });

      await addRepairLog({
        level: "info",
        action: "repair_firestore_write_complete",
        stage: "firestore",
        status: "success",
        repairId,
        pipelineId: result.pipelineId,
      });

      await addRepairLog({
        level: "info",
        action: "repair_submit_complete",
        stage: "submit",
        status: "success",
        repairId,
        pipelineId: result.pipelineId,
      });

      Alert.alert(
        "Repair Saved",
        `Your repair has been saved to ${result.pipelineId}.`,
      );
      setNotes("");
      setSelectedImages([]);
    } catch (error: any) {
      console.error("[AddRepair] Failed to save repair", error);
      await addRepairLog({
        level: "error",
        action: "repair_submit_failed",
        stage: "submit",
        status: "failed",
        repairId,
        pipelineId: selectedPipelineId,
        message: error?.message || "Unknown error",
      });
      Alert.alert("Save Failed", "Something went wrong. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const inputBg = isDark ? "rgba(15, 23, 42, 0.4)" : "#f8fafc";
  const activeEmerald = "#10b981";
  const activeAmber = "#f59e0b";
  const activeRed = "#ef4444";
  const cardBg = isDark ? "rgba(15, 23, 42, 0.42)" : "#ffffff";
  const cardBorder = isDark
    ? "rgba(148, 163, 184, 0.24)"
    : "rgba(148, 163, 184, 0.22)";

  const selectedDistanceMeters =
    nearbyPipelines.find((item) => item.pipelineId === selectedPipelineId)
      ?.distanceMeters ?? null;

  const selectedPipelineDistanceText =
    Number.isFinite(Number(selectedDistanceMeters))
      ? `${formatDistanceLabel(selectedDistanceMeters)} away`
      : "No nearby pipeline";
  const pipelineStatusText =
    hasCheckedPipelines && nearbyPipelines.length === 0
      ? "No pipelines found near these coordinates"
      : "No pipeline selected yet";
  const dockClearance = Math.max(insets.bottom + 78, 98);
  const syncProgressRatio =
    repairSyncState.pendingCount > 0
      ? Math.min(
          repairSyncState.processedCount / repairSyncState.pendingCount,
          1,
        )
      : 0;

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor }]}
      edges={["top"]}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <ScreenHeader
            title="Log Repair"
            subtitle="Location, pipeline, and observations"
            type="large"
          />

          <View
            style={[
              styles.inputGroup,
              { backgroundColor: cardBg, borderColor: cardBorder },
            ]}
          >
            <View style={styles.sectionHeaderRow}>
              <Text style={[styles.sectionTitle, { color: textColor }]}>
                Location
              </Text>
              <GlassButton
                onPress={() => void fetchLocation()}
                disabled={isFetchingGps}
                style={styles.refreshButton}
                contentStyle={styles.refreshButtonGlass}
                borderColor={cardBorder}
                fallbackColor={isDark ? "rgba(5, 150, 105, 0.14)" : "rgba(16, 185, 129, 0.1)"}
                tintColor={isDark ? "rgba(5, 150, 105, 0.24)" : "rgba(16, 185, 129, 0.18)"}
                accessibilityLabel="Refresh GPS location"
              >
                <RefreshCw color={activeEmerald} size={14} />
                <Text
                  style={[styles.refreshButtonText, { color: activeEmerald }]}
                >
                  {isFetchingGps ? "Locating..." : "Refresh GPS"}
                </Text>
              </GlassButton>
            </View>

            <View style={{ gap: 10 }}>
              <View
                style={[
                  styles.inputWrapper,
                  { backgroundColor: inputBg, borderColor },
                ]}
              >
                <TextInput
                  style={[
                    styles.cleanInput,
                    { color: textColor, opacity: isFetchingGps ? 0.5 : 1 },
                  ]}
                  value={isFetchingGps ? "Locating..." : lat}
                  onChangeText={setLat}
                  keyboardType="decimal-pad"
                  editable={!isFetchingGps}
                  placeholder="Latitude"
                  placeholderTextColor={subtextColor}
                />
              </View>

              <View
                style={[
                  styles.inputWrapper,
                  { backgroundColor: inputBg, borderColor },
                ]}
              >
                <TextInput
                  style={[
                    styles.cleanInput,
                    { color: textColor, opacity: isFetchingGps ? 0.5 : 1 },
                  ]}
                  value={isFetchingGps ? "Locating..." : lng}
                  onChangeText={setLng}
                  keyboardType="decimal-pad"
                  editable={!isFetchingGps}
                  placeholder="Longitude"
                  placeholderTextColor={subtextColor}
                />
              </View>
              {!!coordinateError && (
                <Text style={[styles.coordinateErrorText, { color: activeRed }]}>
                  {coordinateError}
                </Text>
              )}
            </View>
          </View>

          <View
            style={[
              styles.inputGroup,
              { backgroundColor: cardBg, borderColor: cardBorder },
            ]}
          >
            <View style={styles.sectionHeaderRow}>
              <Text style={[styles.sectionTitle, { color: textColor }]}>
                Linked Pipeline
              </Text>
              <Text style={[styles.sectionMeta, { color: subtextColor }]}>
                100m away
              </Text>
            </View>

            <GlassView
              glassEffectStyle="regular"
              colorScheme={isDark ? "dark" : "light"}
              tintColor={isDark ? "rgba(15, 23, 42, 0.30)" : "rgba(255,255,255,0.30)"}
              isInteractive
              style={[
                styles.inputWrapper,
                styles.pipelineGlassBox,
                {
                  backgroundColor:
                    Platform.OS === "ios" ? "transparent" : inputBg,
                  borderColor,
                },
              ]}
            >
              <MapPin color={subtextColor} size={18} />
              <View style={{ flex: 1 }}>
                <Text
                  style={[styles.pipelineValue, { color: textColor }]}
                  numberOfLines={1}
                >
                  {isMatchingPipeline
                    ? "Finding nearby pipelines..."
                    : getSelectedPipelineLabel()}
                </Text>
                <Text style={[styles.inlineHint, { color: subtextColor }]}>
                  {selectedDistanceMeters !== null
                    ? selectedPipelineDistanceText
                    : pipelineStatusText}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setShowPipelineDropdown((prev) => !prev)}
                disabled={!nearbyPipelines.length}
                style={styles.chevronButton}
              >
                <ChevronDown color={subtextColor} size={16} />
              </TouchableOpacity>
            </GlassView>

            {showPipelineDropdown &&
              (nearbyPipelines.length > 0 || isSearchingAll) && (
                <View
                  style={[
                    styles.dropdownList,
                    { borderColor, backgroundColor: inputBg },
                  ]}
                >
                  {/* Search Input Section */}
                  <View style={[styles.searchInputContainer, { borderColor }]}>
                    <TextInput
                      style={[styles.cleanInput, { color: textColor }]}
                      placeholder="Search all pipelines..."
                      placeholderTextColor={subtextColor}
                      value={searchQuery}
                      onChangeText={handleSearchPipelines}
                    />
                    {searchQuery.length > 0 && (
                      <TouchableOpacity
                        onPress={() => {
                          setSearchQuery("");
                          setIsSearchingAll(false);
                          setAllPipelines([]);
                        }}
                        style={styles.clearButtonContainer}
                      >
                        <Text
                          style={[
                            styles.clearButtonText,
                            { color: subtextColor },
                          ]}
                        >
                          ✕
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>

                  {/* Results Counter */}
                  <View style={styles.counterSection}>
                    <Text style={[styles.counterText, { color: subtextColor }]}>
                      {isSearchingAll
                        ? `Found ${allPipelines.length} pipeline${allPipelines.length !== 1 ? "s" : ""}`
                        : `${nearbyPipelines.length} nearby`}
                    </Text>
                  </View>

                  {/* Pipeline List */}
                  <ScrollView
                    style={styles.pipelineListContainer}
                    scrollEnabled={
                      (isSearchingAll ? allPipelines : nearbyPipelines).length >
                      4
                    }
                    nestedScrollEnabled={true}
                  >
                    {(isSearchingAll ? allPipelines : nearbyPipelines).map(
                      (item) => {
                        const isSelected =
                          selectedPipelineId === item.pipelineId;
                        return (
                          <TouchableOpacity
                            key={item.pipelineId}
                            onPress={() => {
                              setSelectedPipelineId(item.pipelineId);
                              applyDepthFromPipeline(item.pipelineId);
                              setShowPipelineDropdown(false);
                              setSearchQuery("");
                              setIsSearchingAll(false);
                              setAllPipelines([]);
                            }}
                            style={[
                              styles.dropdownItem,
                              {
                                borderColor,
                                backgroundColor: isSelected
                                  ? "rgba(16, 185, 129, 0.12)"
                                  : "transparent",
                              },
                            ]}
                          >
                            <View>
                              <Text
                                style={[
                                  styles.dropdownItemText,
                                  { color: textColor },
                                ]}
                                numberOfLines={1}
                              >
                                {getPipelineLabel(item.pipeline)}
                              </Text>
                              <Text
                                style={[
                                  styles.dropdownItemMeta,
                                  { color: subtextColor },
                                ]}
                              >
                                {formatDistanceLabel(item.distanceMeters)} •{" "}
                                {item.pipeline.pipelineId || item.pipeline.id}
                              </Text>
                            </View>
                          </TouchableOpacity>
                        );
                      },
                    )}
                  </ScrollView>

                  {/* No Results State */}
                  {isSearchingAll && allPipelines.length === 0 && (
                    <Text
                      style={[styles.noResultsText, { color: subtextColor }]}
                    >
                      No pipelines match your search.
                    </Text>
                  )}
                </View>
              )}

            <View
              style={[
                styles.inputWrapper,
                { backgroundColor: inputBg, borderColor, marginTop: 10 },
              ]}
            >
              <TextInput
                style={[styles.cleanInput, { color: textColor }]}
                value={depthM}
                onChangeText={setDepthM}
                keyboardType="decimal-pad"
                placeholder="Depth in meters"
                placeholderTextColor={subtextColor}
              />
            </View>
            <Text style={[styles.depthHint, { color: subtextColor }]}>
              Auto-filled from selected pipeline. You can edit before saving.
            </Text>
          </View>

          <View
            style={[
              styles.inputGroup,
              { backgroundColor: cardBg, borderColor: cardBorder },
            ]}
          >
            <Text
              style={[
                styles.sectionTitle,
                { color: textColor, marginBottom: 10 },
              ]}
            >
              Repair Type
            </Text>
            <View style={styles.pillContainer}>
              {["Leak", "Burst", "Blockage"].map((type) => {
                const isActive = issueType === type;
                return (
                  <TouchableOpacity
                    key={type}
                    onPress={() => setIssueType(type)}
                    style={[
                      styles.pill,
                      {
                        backgroundColor: isActive ? activeEmerald : inputBg,
                        borderColor: isActive ? activeEmerald : borderColor,
                      },
                    ]}
                  >
                    <AlertTriangle
                      color={isActive ? "#fff" : subtextColor}
                      size={14}
                    />
                    <Text
                      style={[
                        styles.pillText,
                        { color: isActive ? "#fff" : textColor },
                      ]}
                    >
                      {type}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <View style={[styles.rowGroup, styles.dualCardRow]}>
            <View
              style={[
                styles.inputGroup,
                styles.flexCard,
                styles.compactCard,
                { backgroundColor: cardBg, borderColor: cardBorder },
              ]}
            >
              <Text
                style={[
                  styles.sectionTitle,
                  { color: textColor, marginBottom: 10 },
                ]}
              >
                Severity
              </Text>
              <View style={styles.verticalPillContainer}>
                {["Routine", "Moderate", "Critical"].map((level) => {
                  const isActive = severity === level;
                  const activeCol =
                    level === "Critical"
                      ? activeRed
                      : level === "Moderate"
                        ? activeAmber
                        : activeEmerald;
                  return (
                    <TouchableOpacity
                      key={level}
                      onPress={() => setSeverity(level)}
                      style={[
                        styles.smallPill,
                        {
                          backgroundColor: isActive ? activeCol : inputBg,
                          borderColor: isActive ? activeCol : borderColor,
                        },
                      ]}
                    >
                      <Activity
                        color={isActive ? "#fff" : subtextColor}
                        size={12}
                      />
                      <Text
                        style={[
                          styles.smallPillText,
                          { color: isActive ? "#fff" : textColor },
                        ]}
                      >
                        {level}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            <View
              style={[
                styles.inputGroup,
                styles.flexCard,
                styles.compactCard,
                { backgroundColor: cardBg, borderColor: cardBorder },
              ]}
            >
              <Text
                style={[
                  styles.sectionTitle,
                  { color: textColor, marginBottom: 10 },
                ]}
              >
                Water Loss
              </Text>
              <View style={styles.verticalPillContainer}>
                {["Seeping", "Trickle", "Gushing"].map((rate) => {
                  const isActive = flowRate === rate;
                  const activeCol =
                    rate === "Gushing"
                      ? activeRed
                      : rate === "Trickle"
                        ? activeAmber
                        : "#3b82f6";
                  return (
                    <TouchableOpacity
                      key={rate}
                      onPress={() => setFlowRate(rate)}
                      style={[
                        styles.smallPill,
                        {
                          backgroundColor: isActive ? activeCol : inputBg,
                          borderColor: isActive ? activeCol : borderColor,
                        },
                      ]}
                    >
                      <Droplets
                        color={isActive ? "#fff" : subtextColor}
                        size={12}
                      />
                      <Text
                        style={[
                          styles.smallPillText,
                          { color: isActive ? "#fff" : textColor },
                        ]}
                      >
                        {rate}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </View>

          <View
            style={[
              styles.inputGroup,
              { backgroundColor: cardBg, borderColor: cardBorder },
            ]}
          >
            <Text
              style={[
                styles.sectionTitle,
                { color: textColor, marginBottom: 10 },
              ]}
            >
              Notes
            </Text>
            <View
              style={[
                styles.notesBox,
                {
                  backgroundColor: inputBg,
                  borderColor,
                },
              ]}
            >
              <FileText
                color={subtextColor}
                size={18}
                style={{ marginTop: 2 }}
              />
              <TextInput
                style={[styles.textArea, { color: textColor }]}
                placeholder="Add context, cause, crew notes, or field observations..."
                placeholderTextColor={subtextColor}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
                value={notes}
                onChangeText={setNotes}
              />
            </View>
          </View>

          <View
            style={[
              styles.inputGroup,
              {
                marginBottom: 16,
                backgroundColor: cardBg,
                borderColor: cardBorder,
              },
            ]}
          >
            <Text
              style={[
                styles.sectionTitle,
                { color: textColor, marginBottom: 10 },
              ]}
            >
              Evidence
            </Text>
            <TouchableOpacity
              onPress={handleAddImage}
              disabled={isSaving}
              style={[
                styles.photoUpload,
                { backgroundColor: inputBg, borderColor },
              ]}
            >
              <Camera color={subtextColor} size={22} />
              <Text style={[styles.photoText, { color: subtextColor }]}>
                {selectedImages.length > 0
                  ? `${selectedImages.length}/${MAX_REPAIR_IMAGES} image${selectedImages.length > 1 ? "s" : ""} attached`
                  : "Attach site photo"}
              </Text>
            </TouchableOpacity>

            {selectedImages.length > 0 && (
              <View style={styles.selectedImageRow}>
                {selectedImages.map((item, index) => (
                  <View
                    key={`${item.uri}-${index}`}
                    style={[styles.selectedImageCard, { borderColor }]}
                  >
                    <Image
                      source={{ uri: item.uri }}
                      style={styles.selectedImageThumb}
                    />
                    <TouchableOpacity
                      onPress={() => removeSelectedImage(index)}
                      style={styles.removeImageButton}
                      disabled={isSaving}
                    >
                      <Text style={styles.removeImageButtonText}>Remove</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
          </View>

          <View
            style={[styles.bottomSpacing, { height: dockClearance - 22 }]}
          />
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Fixed Save Button */}
      <View
        pointerEvents="box-none"
        style={[
          styles.fixedBottom,
          {
            bottom: Math.max(insets.bottom + 84, 104),
          },
        ]}
      >
        {repairSyncState.isSyncing && (
          <View
            style={[
              styles.repairSyncBanner,
              {
                borderColor,
                backgroundColor: isDark
                  ? "rgba(15,23,42,0.88)"
                  : "rgba(255,255,255,0.95)",
              },
            ]}
          >
            <View style={styles.repairSyncBannerHeader}>
              <ActivityIndicator
                size="small"
                color={isDark ? "#fbbf24" : "#0284c7"}
              />
              <Text
                style={[styles.repairSyncBannerTitle, { color: textColor }]}
              >
                Syncing your saved repairs...
              </Text>
              <Text
                style={[styles.repairSyncBannerCount, { color: subtextColor }]}
              >
                {repairSyncState.processedCount}/{repairSyncState.pendingCount}
              </Text>
            </View>
            <View style={styles.repairSyncTrack}>
              <View
                style={[
                  styles.repairSyncFill,
                  {
                    width: `${Math.round(syncProgressRatio * 100)}%`,
                    backgroundColor: isDark ? "#fbbf24" : "#0284c7",
                  },
                ]}
              />
            </View>
          </View>
        )}

        <Pressable
          onPress={() => void saveRepairLog()}
          disabled={isSaving || isFetchingGps}
          accessibilityRole="button"
          accessibilityLabel="Save repair log"
          style={({ pressed }) => [
            styles.submitBtn,
            pressed && !(isSaving || isFetchingGps)
              ? styles.submitBtnPressed
              : null,
            isSaving || isFetchingGps ? styles.submitBtnDisabled : null,
          ]}
        >
          <GlassContainer spacing={12} style={styles.submitGlassContainer}>
            <GlassView
              glassEffectStyle="regular"
              colorScheme={isDark ? "dark" : "light"}
              isInteractive={!(isSaving || isFetchingGps)}
              style={[
                styles.submitBtnGlass,
                {
                  backgroundColor:
                    Platform.OS === "ios" ? "transparent" : cardBg,
                  borderColor:
                    Platform.OS === "ios"
                      ? "transparent"
                      : isDark
                        ? "rgba(255,255,255,0.20)"
                        : "rgba(255,255,255,0.72)",
                },
              ]}
            >
              {isSaving ? (
                <ActivityIndicator color={textColor} />
              ) : (
                <Check color={textColor} size={18} strokeWidth={3} />
              )}
              <Text style={[styles.submitText, { color: textColor }]}>
                {isSaving ? "Saving..." : "Save Repair Log"}
              </Text>
            </GlassView>
          </GlassContainer>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 12,
  },
  inputGroup: {
    marginBottom: 12,
    marginHorizontal: 24,
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
    shadowColor: "#0f172a",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
    gap: 8,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.35,
    textTransform: "uppercase",
  },
  sectionMeta: {
    fontSize: 11,
    fontWeight: "600",
  },
  refreshButton: {
  },
  refreshButtonGlass: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
    gap: 6,
  },
  refreshButtonText: {
    fontSize: 13,
    fontWeight: "700",
  },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 10,
  },
  pipelineGlassBox: {
    overflow: "hidden",
  },
  cleanInput: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    padding: 0,
    margin: 0,
    minHeight: 22,
  },
  pipelineValue: {
    fontSize: 14,
    fontWeight: "700",
  },
  inlineHint: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: "500",
  },
  depthHint: {
    marginTop: 6,
    fontSize: 11,
    fontWeight: "500",
  },
  coordinateErrorText: {
    marginTop: -2,
    fontSize: 11,
    fontWeight: "700",
  },
  chevronButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(148, 163, 184, 0.10)",
  },
  dropdownList: {
    maxHeight: 320,
    marginTop: 8,
    borderWidth: 1,
    borderRadius: 14,
    overflow: "hidden",
  },
  searchInputContainer: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  clearButtonContainer: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    justifyContent: "center",
    alignItems: "center",
  },
  clearButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
  counterSection: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(148, 163, 184, 0.1)",
  },
  counterText: {
    fontSize: 11,
    fontWeight: "600",
  },
  pipelineListContainer: {
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  dropdownItem: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 6,
  },
  dropdownItemText: {
    fontSize: 12,
    fontWeight: "600",
  },
  dropdownItemMeta: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: "500",
  },
  rowGroup: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 24,
    alignItems: "stretch",
  },
  dualCardRow: {
    padding: 0,
    borderWidth: 0,
  },
  compactCard: {
    marginHorizontal: 0,
  },
  flexCard: {
    flex: 1,
    minWidth: 0,
    justifyContent: "flex-start",
  },
  verticalPillContainer: {
    flexDirection: "column",
    gap: 8,
  },
  pillContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    gap: 8,
  },
  smallPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    gap: 6,
  },
  pillText: {
    fontSize: 14,
    fontWeight: "600",
  },
  smallPillText: {
    fontSize: 13,
    fontWeight: "700",
  },
  notesBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
  },
  textArea: {
    flex: 1,
    fontSize: 15,
    minHeight: 72,
    fontWeight: "500",
  },
  photoUpload: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: 14,
    height: 66,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  photoText: {
    fontSize: 14,
    fontWeight: "500",
  },
  selectedImageRow: {
    marginTop: 10,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  selectedImageCard: {
    width: "31%",
    borderWidth: 1,
    borderRadius: 12,
    padding: 6,
    gap: 6,
    backgroundColor: "rgba(148, 163, 184, 0.08)",
  },
  selectedImageThumb: {
    width: "100%",
    height: 72,
    borderRadius: 8,
    backgroundColor: "rgba(148, 163, 184, 0.18)",
  },
  removeImageButton: {
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 6,
    backgroundColor: "rgba(239, 68, 68, 0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  removeImageButtonText: {
    color: "#b91c1c",
    fontSize: 11,
    fontWeight: "700",
  },
  bottomSpacing: {
    height: 64,
  },
  fixedBottom: {
    position: "absolute",
    left: 0,
    right: 0,
    paddingHorizontal: 24,
    paddingTop: 0,
    backgroundColor: "transparent",
  },
  repairSyncBanner: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 7,
    marginBottom: 8,
  },
  repairSyncBannerHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  repairSyncBannerTitle: {
    flex: 1,
    fontSize: 12,
    fontWeight: "700",
  },
  repairSyncBannerCount: {
    fontSize: 11,
    fontWeight: "700",
  },
  repairSyncTrack: {
    height: 5,
    borderRadius: 999,
    overflow: "hidden",
    backgroundColor: "rgba(148, 163, 184, 0.26)",
  },
  repairSyncFill: {
    height: "100%",
    borderRadius: 999,
  },
  submitBtn: {
    borderRadius: 28,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.16,
    shadowRadius: 18,
    elevation: 6,
  },
  submitBtnPressed: {
    transform: [{ scale: 0.98 }],
  },
  submitBtnDisabled: {
    opacity: 0.58,
  },
  submitGlassContainer: {
    borderRadius: 28,
  },
  submitBtnGlass: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 13,
    borderRadius: 28,
    gap: 8,
  },
  submitText: {
    fontSize: 14,
    fontWeight: "700",
  },
  noResultsText: {
    fontSize: 12,
    fontWeight: "500",
    textAlign: "center",
    paddingHorizontal: 12,
    paddingVertical: 16,
  },
});
