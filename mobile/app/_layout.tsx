import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider as NavigationThemeProvider,
} from "@react-navigation/native";
import React from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import "react-native-reanimated";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { LogBox, Platform, Text, TextInput } from "react-native";

import {
  ThemeProvider as AppThemeProvider,
  useTheme,
} from "@/context/ThemeContext";

function RootLayoutContent() {
  const { isDark } = useTheme();

  React.useEffect(() => {
    LogBox.ignoreLogs([
      "@firebase/firestore: Firestore",
      "Could not reach Cloud Firestore backend",
    ]);
  }, []);

  React.useEffect(() => {
    if (Platform.OS !== "ios") return;

    const textDefaults = (Text as any).defaultProps || {};
    const inputDefaults = (TextInput as any).defaultProps || {};

    (Text as any).defaultProps = {
      ...textDefaults,
      style: [textDefaults.style, { fontFamily: "System" }],
    };

    (TextInput as any).defaultProps = {
      ...inputDefaults,
      style: [inputDefaults.style, { fontFamily: "System" }],
    };
  }, []);

  return (
    <NavigationThemeProvider value={isDark ? DarkTheme : DefaultTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" options={{ animationEnabled: false }} />
        <Stack.Screen name="details/[collection]/[id]" />
        <Stack.Screen
          name="modal"
          options={{ presentation: "modal", title: "Modal" }}
        />
      </Stack>
      <StatusBar style={isDark ? "light" : "dark"} />
    </NavigationThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AppThemeProvider>
        <RootLayoutContent />
      </AppThemeProvider>
    </GestureHandlerRootView>
  );
}
