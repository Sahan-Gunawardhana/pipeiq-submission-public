import React from "react";
import { View, Text, StyleSheet, Platform } from "react-native";
import { useThemeColor } from "@/hooks/use-theme-color";

type Chip = { value: React.ReactNode; label: string };

export default function SummaryCard({
  title,
  subtitle,
  action,
  children,
  chips,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children?: React.ReactNode;
  chips?: Chip[];
}) {
  const cardColor = useThemeColor({}, "card");
  const borderColor = useThemeColor({}, "border");
  const textColor = useThemeColor({}, "text");
  const subtextColor = useThemeColor({}, "subtext");

  return (
    <View style={[styles.card, { backgroundColor: cardColor, borderColor }]}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: textColor }]}>{title}</Text>
          {subtitle ? (
            <Text style={[styles.subtitle, { color: subtextColor }]}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {action ? <View style={styles.action}>{action}</View> : null}
      </View>

      {children}

      {chips ? (
        <View style={styles.chipsRow}>
          {chips.map((c, i) => (
            <View key={i} style={styles.chip}>
              <Text style={[styles.chipValue, { color: textColor }]}>
                {c.value}
              </Text>
              <Text style={[styles.chipLabel, { color: subtextColor }]}>
                {c.label}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 22,
    padding: 16,
    ...Platform.select({
      ios: {
        shadowColor: "#0f172a",
        shadowOpacity: 0.08,
        shadowOffset: { width: 0, height: 4 },
        shadowRadius: 8,
      },
      android: {
        elevation: 3,
      },
    }),
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  title: { fontSize: 17, fontWeight: "800", letterSpacing: -0.2 },
  subtitle: { marginTop: 6, fontSize: 13, lineHeight: 18, opacity: 0.75 },
  action: { marginLeft: 12 },
  chipsRow: { flexDirection: "row", gap: 12, marginTop: 14 },
  chip: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: "rgba(148, 163, 184, 0.08)",
  },
  chipValue: { fontSize: 20, fontWeight: "800" },
  chipLabel: { marginTop: 4, fontSize: 12, fontWeight: "600", opacity: 0.8 },
});
