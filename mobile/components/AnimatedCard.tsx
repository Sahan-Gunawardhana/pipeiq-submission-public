import { Pressable, ViewStyle, StyleProp } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  FadeInDown,
  Layout,
  Easing,
} from "react-native-reanimated";
import { useThemeColor } from "@/hooks/use-theme-color";

interface AnimatedCardProps {
  children: React.ReactNode;
  index: number;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function AnimatedCard({
  children,
  index,
  onPress,
  style,
}: AnimatedCardProps) {
  const scale = useSharedValue(1);

  const backgroundColor = useThemeColor({}, "card");
  const borderColor = useThemeColor({}, "border");
  const shadowColor = useThemeColor({}, "cardShadow");

  const animatedStyle = useAnimatedStyle(() => {
    return {
      transform: [{ scale: scale.value }],
    };
  });

  const handlePressIn = () => {
    // Professional, subtle feedback (no bounce)
    scale.value = withTiming(0.98, {
      duration: 150,
      easing: Easing.out(Easing.quad),
    });
  };

  const handlePressOut = () => {
    scale.value = withTiming(1, {
      duration: 250,
      easing: Easing.out(Easing.quad),
    });
  };

  // Unified, subtle depth standard
  const cardStyle = {
    backgroundColor,
    borderRadius: 16,
    shadowColor,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 3,
    borderWidth: 1,
    borderColor,
  };

  return (
    <Animated.View
      entering={FadeInDown.delay(index * 50)
        .duration(400)
        .easing(Easing.out(Easing.quad))}
      layout={Layout.duration(300)}
      style={[style, cardStyle]}
    >
      <Pressable
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={{ width: "100%" }}
      >
        <Animated.View style={animatedStyle}>{children}</Animated.View>
      </Pressable>
    </Animated.View>
  );
}
