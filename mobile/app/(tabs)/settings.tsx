import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Switch,
  TouchableOpacity,
  Alert,
  Pressable,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ScreenHeader } from "../../components/ScreenHeader";
import {
  Settings as SettingsIcon,
  Moon,
  Sun,
  Smartphone,
  Map as MapIcon,
  Wifi,
  ChevronRight,
  Cloud,
  Ruler,
  Info,
  Layers,
  Activity,
  User,
  LogOut,
  Satellite,
} from "lucide-react-native";
import { AnimatedCard } from "../../components/AnimatedCard";
import { useTheme } from "@/context/ThemeContext";
import { useThemeColor } from "@/hooks/use-theme-color";
import { syncQueuedRepairs } from "../../lib/repairSync";

export default function SettingsScreen() {
  const router = useRouter();
  const {
    isDark,
    setThemeMode,
    themeMode,
    showPipelines,
    setShowPipelines,
    showZones,
    setShowZones,
    mapType,
    setMapType,
  } = useTheme();

  // Theme colors
  const backgroundColor = useThemeColor({}, "background");
  const textColor = useThemeColor({}, "text");
  const subtextColor = useThemeColor({}, "subtext");
  const borderColor = useThemeColor({}, "border");
  const tintColor = useThemeColor({}, "tint");
  const accentColor = isDark ? "#fbbf24" : "#0ea5e9"; // amber-400 : sky-500
  const cardColor = useThemeColor({}, "card");
  const showGuideColor = isDark ? "#fbbf24" : "#3b82f6";

  const handleManualSync = async () => {
    try {
      const summary = await syncQueuedRepairs("manual");

      if (summary.pendingCount === 0) {
        Alert.alert(
          "All Set",
          "No offline repairs are waiting to sync right now.",
        );
        return;
      }

      if (summary.failedCount === 0) {
        Alert.alert(
          "Sync Complete",
          "Your saved offline repairs are now synced.",
        );
        return;
      }

      Alert.alert(
        "Sync Partially Complete",
        "Some repairs synced, and a few still need connection. We'll retry automatically.",
      );
    } catch (_error) {
      Alert.alert(
        "Sync Unavailable",
        "We couldn't sync right now. Please check your connection and try again.",
      );
    }
  };

  const ThemeSelector = () => {
    const options = [
      { mode: "light", label: "Light", icon: Sun },
      { mode: "dark", label: "Dark", icon: Moon },
      { mode: "system", label: "System", icon: Smartphone },
    ];

    return (
      <View
        style={[
          styles.themeSelectorContainer,
          { backgroundColor: isDark ? "#1E293B" : "#F3F4F6" },
        ]}
      >
        {options.map((opt) => {
          const isActive = themeMode === opt.mode;
          const Icon = opt.icon;
          return (
            <Pressable
              key={opt.mode}
              onPress={() => setThemeMode(opt.mode as any)}
              style={[
                styles.themeOption,
                isActive && {
                  backgroundColor: cardColor,
                  shadowColor: "#000",
                  shadowOffset: { width: 0, height: 2 },
                  shadowOpacity: 0.1,
                  shadowRadius: 4,
                  elevation: 2,
                },
              ]}
            >
              <Icon
                size={18}
                color={isActive ? tintColor : subtextColor}
                strokeWidth={2.5}
              />
              <Text
                style={[
                  styles.themeLabel,
                  {
                    color: isActive ? textColor : subtextColor,
                    fontWeight: isActive ? "600" : "500",
                  },
                ]}
              >
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    );
  };

  const SettingsSection = ({
    title,
    children,
  }: {
    title: string;
    children: React.ReactNode;
  }) => (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: subtextColor }]}>
        {title}
      </Text>
      <View
        style={[
          styles.sectionContent,
          { backgroundColor: cardColor, borderColor },
        ]}
      >
        {children}
      </View>
    </View>
  );

  const SettingsItem = ({
    icon: Icon,
    label,
    description,
    value,
    onValueChange,
    type = "switch",
    color = "#337AB7",
    iconBackgroundColor,
    isLast = false,
    onPress,
  }: {
    icon: any;
    label: string;
    description?: string;
    value?: boolean;
    onValueChange?: (val: boolean) => void;
    type?: "switch" | "link" | "danger";
    color?: string;
    iconBackgroundColor?: string;
    isLast?: boolean;
    onPress?: () => void;
  }) => (
    <View>
      <TouchableOpacity
        style={styles.item}
        disabled={type === "switch"}
        onPress={() => {
          if (onPress) onPress();
          else if (type === "link") Alert.alert(`${label}`, "Coming soon");
        }}
      >
        <View
          style={[
            styles.iconBox,
            {
              backgroundColor:
                iconBackgroundColor || (isDark ? `${color}20` : `${color}15`),
            },
          ]}
        >
          <Icon color={color} size={22} strokeWidth={2} />
        </View>
        <View style={styles.itemTextContainer}>
          <Text
            style={[
              styles.itemLabel,
              { color: type === "danger" ? "#ef4444" : textColor },
            ]}
          >
            {label}
          </Text>
          {description && (
            <Text style={[styles.itemDescription, { color: subtextColor }]}>
              {description}
            </Text>
          )}
        </View>
        {type === "switch" ? (
          <Switch
            value={value}
            onValueChange={onValueChange}
            trackColor={{
              false: isDark ? "#334155" : "#E5E7EB",
              true: accentColor,
            }}
            thumbColor={"#FFFFFF"}
            ios_backgroundColor={isDark ? "#334155" : "#E5E7EB"}
          />
        ) : (
          <ChevronRight color={subtextColor} size={20} />
        )}
      </TouchableOpacity>
      {!isLast && (
        <View style={[styles.divider, { backgroundColor: borderColor }]} />
      )}
    </View>
  );

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor }]}
      edges={["top"]}
    >
      <ScreenHeader
        title="Settings"
        subtitle="Customize your app"
        type="large"
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Appearance */}
        <View style={styles.sectionWrapper}>
          <SettingsSection title="Appearance">
            <View style={styles.themeSelectorWrapper}>
              <ThemeSelector />
            </View>
          </SettingsSection>
        </View>

        {/* Map Overlays */}
        <View style={styles.sectionWrapper}>
          <SettingsSection title="Map">
            <SettingsItem
              icon={Activity}
              label="Show Pipelines"
              description="Display the pipeline network on the map."
              color={accentColor}
              value={showPipelines}
              onValueChange={setShowPipelines}
            />
            <SettingsItem
              icon={MapIcon}
              label="Show Zones"
              description="Display zone boundaries on the map."
              color="#10B981"
              value={showZones}
              onValueChange={setShowZones}
              isLast
            />
          </SettingsSection>
        </View>

        {/* Map Base Layer */}
        <View style={styles.sectionWrapper}>
          <SettingsSection title="Map Base Layer">
            <SettingsItem
              icon={Layers}
              label="OpenStreetMap (OSM)"
              description={
                mapType === "street" ? "Active" : "Detailed street maps."
              }
              color={mapType === "street" ? "#3B82F6" : "#64748B"}
              type="link"
              onPress={() => setMapType("street")}
            />
            <SettingsItem
              icon={Satellite}
              label="Satellite"
              description={
                mapType === "satellite" ? "Active" : "Satellite view."
              }
              color={mapType === "satellite" ? "#10B981" : "#64748B"}
              type="link"
              onPress={() => setMapType("satellite")}
              isLast
            />
          </SettingsSection>
        </View>

        {/* Operations & Data */}
        <View style={styles.sectionWrapper}>
          <SettingsSection title="Data">
            <SettingsItem
              icon={Cloud}
              label="Sync Repairs"
              description="Manually sync offline repairs now"
              color="#3B82F6"
              type="link"
              onPress={() => void handleManualSync()}
              isLast
            />
          </SettingsSection>
        </View>

        {/* Support */}
        <View style={styles.sectionWrapper}>
          <SettingsSection title="Support">
            <SettingsItem
              icon={Info}
              label="About"
              description="PipeIQ mobile field app for viewing network data, logging repairs, capturing evidence, and syncing records with Firebase."
              color="#64748B"
              type="link"
              onPress={() =>
                Alert.alert(
                  "About PipeIQ",
                  "PipeIQ Mobile supports field repair logging, GPS-assisted location capture, image evidence, network map viewing, and offline repair sync for water infrastructure operations.\n\nVersion: 2.4.0\nBuild: 2024.11",
                )
              }
              isLast
            />
          </SettingsSection>
        </View>

        <Text style={styles.version}>v2.4.0 (Build 2024.11)</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingHorizontal: 24, paddingBottom: 120, paddingTop: 0 },

  // Theme Selector
  themeSelectorWrapper: {
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  themeSelectorContainer: {
    flexDirection: "row",
    padding: 4,
    borderRadius: 16,
    height: 44,
  },
  themeOption: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    gap: 8,
  },
  themeLabel: {
    fontSize: 14,
    fontWeight: "500",
  },

  // Sections
  sectionWrapper: {
    marginBottom: 32,
  },
  section: {},
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginLeft: 16,
    marginBottom: 8,
    opacity: 0.7,
  },
  sectionContent: {
    borderRadius: 20,
    borderWidth: 1,
    overflow: "hidden",
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  iconBox: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 16,
  },
  itemTextContainer: {
    flex: 1,
    justifyContent: "center",
  },
  itemLabel: { fontSize: 16, fontWeight: "500", letterSpacing: -0.2 },
  itemDescription: {
    fontSize: 12,
    marginTop: 2,
    marginRight: 16,
    lineHeight: 16,
    opacity: 0.8,
  },
  divider: { height: 1, marginLeft: 70 },

  version: {
    textAlign: "center",
    color: "#9CA3AF",
    fontSize: 13,
    marginTop: 12,
    fontWeight: "500",
    letterSpacing: 0.5,
  },
});
