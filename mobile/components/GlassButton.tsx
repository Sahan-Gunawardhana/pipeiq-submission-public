import React from "react";
import {
  Platform,
  Pressable,
  StyleProp,
  StyleSheet,
  ViewStyle,
} from "react-native";
import { GlassView } from "expo-glass-effect";
import type { GlassViewProps } from "expo-glass-effect";
import { useTheme } from "@/context/ThemeContext";
import { useThemeColor } from "@/hooks/use-theme-color";

interface GlassButtonProps {
  children: React.ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  tintColor?: string | null;
  borderColor?: string;
  fallbackColor?: string;
  glassEffectStyle?: GlassViewProps["glassEffectStyle"];
  hitSlop?: number | { top: number; bottom: number; left: number; right: number };
  accessibilityLabel?: string;
}

export function GlassButton({
  children,
  onPress,
  disabled = false,
  style,
  contentStyle,
  tintColor,
  borderColor,
  fallbackColor,
  glassEffectStyle = "regular",
  hitSlop,
  accessibilityLabel,
}: GlassButtonProps) {
  const { isDark } = useTheme();
  const defaultBorderColor = useThemeColor({}, "border");
  const defaultFallbackColor = isDark
    ? "rgba(15, 23, 42, 0.78)"
    : "rgba(255, 255, 255, 0.82)";

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={hitSlop}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        styles.pressable,
        pressed && !disabled ? styles.pressed : null,
        disabled ? styles.disabled : null,
        style,
      ]}
    >
      <GlassView
        glassEffectStyle={glassEffectStyle}
        colorScheme={isDark ? "dark" : "light"}
        {...(tintColor === null
          ? {}
          : {
              tintColor:
                tintColor ||
                (isDark
                  ? "rgba(15, 23, 42, 0.34)"
                  : "rgba(255,255,255,0.32)"),
            })}
        isInteractive={!disabled}
        style={[
          styles.glass,
          {
            borderColor: borderColor || defaultBorderColor,
            backgroundColor:
              Platform.OS === "ios"
                ? "transparent"
                : fallbackColor || defaultFallbackColor,
          },
          contentStyle,
        ]}
      >
        {children}
      </GlassView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressable: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius: 14,
    elevation: 6,
  },
  pressed: {
    transform: [{ scale: 0.97 }],
  },
  disabled: {
    opacity: 0.58,
  },
  glass: {
    borderWidth: 1,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
});
