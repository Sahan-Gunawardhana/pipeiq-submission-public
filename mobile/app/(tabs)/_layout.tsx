import { NativeTabs, Icon, Label } from "expo-router/unstable-native-tabs";
import { useTheme } from "@/context/ThemeContext";

export default function TabLayout() {
  const { isDark } = useTheme();
  const selectedColor = isDark ? "#fbbf24" : "#3b82f6";

  return (
    <NativeTabs
      blurEffect={isDark ? "systemChromeMaterialDark" : "systemChromeMaterialLight"}
      backgroundColor={isDark ? "#0f172a" : "#ffffff"}
      iconColor={{ default: isDark ? "#64748b" : "#94a3b8", selected: selectedColor }}
      labelStyle={{
        fontSize: 10,
        fontWeight: "700",
      }}
      tintColor={selectedColor}
      disableTransparentOnScrollEdge
    >
      <NativeTabs.Trigger name="index">
        <Icon sf={{ default: "map", selected: "map.fill" }} md="map" />
        <Label>Map</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="assets">
        <Icon
          sf={{ default: "network", selected: "network" }}
          md="inventory_2"
        />
        <Label>Assets</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="add-repair">
        <Icon
          sf={{ default: "plus.circle", selected: "plus.circle.fill" }}
          md="add_circle"
        />
        <Label>Add Repair</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <Icon
          sf={{ default: "gearshape", selected: "gearshape.fill" }}
          md="settings"
        />
        <Label>Settings</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
