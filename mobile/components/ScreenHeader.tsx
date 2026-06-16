import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ViewStyle,
} from "react-native";
import { useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { BlurView } from "expo-blur";
import { useThemeColor } from "@/hooks/use-theme-color";
import { useTheme } from "@/context/ThemeContext";
import { GlassButton } from "@/components/GlassButton";

interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  showBack?: boolean;
  rightAction?: React.ReactNode;
  style?: ViewStyle;
  type?: "large" | "standard";
  glass?: boolean;
}

export function ScreenHeader({
  title,
  subtitle,
  showBack = false,
  rightAction,
  style,
  type = "standard",
  glass = false,
}: ScreenHeaderProps) {
  const router = useRouter();
  const { isDark } = useTheme();
  const backgroundColor = useThemeColor({}, "background");
  const textColor = useThemeColor({}, "text");
  const subtextColor = useThemeColor({}, "subtext");
  const cardColor = isDark ? "rgba(15, 23, 42, 0.72)" : "rgba(255, 255, 255, 0.76)";
  const borderColor = isDark ? "rgba(255,255,255,0.12)" : "rgba(15,23,42,0.08)";

  return (
    <View
      style={[
        styles.container,
        glass ? styles.glassContainer : null,
        glass ? { backgroundColor: "transparent" } : { backgroundColor },
        style,
      ]}
    >
      {glass && (
        <>
          <BlurView
            intensity={isDark ? 56 : 62}
            tint={isDark ? "dark" : "light"}
            style={StyleSheet.absoluteFillObject}
          />
          <View
            pointerEvents="none"
            style={[styles.glassOverlay, { borderColor, backgroundColor: cardColor }]}
          />
        </>
      )}

      {/* Top Row: Back Btn + Title (standard only) */}
      {(showBack || type === "standard") && (
        <View style={styles.topRow}>
          <View style={styles.leftSection}>
            {showBack && (
              <GlassButton
                onPress={() => router.back()}
                style={styles.backButton}
                contentStyle={styles.backButtonGlass}
                borderColor={borderColor}
                fallbackColor={cardColor}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityLabel="Go back"
              >
                <ChevronLeft color={textColor} size={28} />
              </GlassButton>
            )}

            {/* If standard, title is inline with back button */}
            {type === "standard" && (
              <View>
                <Text style={[styles.standardTitle, { color: textColor }]}>
                  {title}
                </Text>
                {subtitle && (
                  <Text style={[styles.subtitleSmall, { color: subtextColor }]}>
                    {subtitle}
                  </Text>
                )}
              </View>
            )}
          </View>

          {/* Right Action (standard type only) */}
          {rightAction && <View style={styles.rightAction}>{rightAction}</View>}
        </View>
      )}

      {/* Large Title Area */}
      {type === "large" && (
        <View style={styles.largeTitleContainer}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.largeTitle, { color: textColor }]}>
              {title}
            </Text>
            {subtitle && (
              <Text style={[styles.subtitleLarge, { color: subtextColor }]}>
                {subtitle}
              </Text>
            )}
          </View>
          {rightAction && <View style={styles.rightAction}>{rightAction}</View>}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 12,
  },
  glassContainer: {
    borderWidth: 1,
    overflow: "hidden",
  },
  glassOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 1,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 44,
  },
  leftSection: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  backButton: {
    marginLeft: -8,
  },
  backButtonGlass: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  standardTitle: {
    fontSize: 24,
    fontWeight: "700",
    letterSpacing: -0.5,
  },
  subtitleSmall: {
    fontSize: 13,
    marginTop: 1,
  },
  rightAction: {},
  largeTitleContainer: {
    marginTop: 0,
    marginBottom: 0,
    marginLeft: 0,
    marginRight: 0,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    width: "100%",
  },
  largeTitle: {
    fontSize: 34,
    fontWeight: "700",
    letterSpacing: -0.5,
    margin: 0,
  },
  subtitleLarge: {
    fontSize: 16,
    marginTop: 4,
    fontWeight: "400",
  },
});
