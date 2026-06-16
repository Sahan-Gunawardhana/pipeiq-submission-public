/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import { Platform } from 'react-native';

const tintColorLight = '#f59e0b'; // amber-500
const tintColorDark = '#fbbf24'; // amber-400

export const Colors = {
  light: {
    text: '#0f172a', // slate-900
    subtext: '#64748b', // slate-500
    background: '#f8fafc', // slate-50
    card: '#ffffff', // white
    border: '#e2e8f0', // slate-200
    tint: tintColorLight,
    icon: '#64748b', // slate-500
    tabIconDefault: '#94a3b8', // slate-400
    tabIconSelected: tintColorLight,
    primary: '#0f172a', // slate-900
    success: '#10b981', // emerald-500
    warning: '#f59e0b', // amber-500
    danger: '#ef4444', // red-500
    cardShadow: '#000000',
  },
  dark: {
    text: '#f8fafc', // slate-50
    subtext: '#94a3b8', // slate-400
    background: '#020617', // slate-950
    card: '#0f172a', // slate-900
    border: '#1e293b', // slate-800
    tint: tintColorDark,
    icon: '#94a3b8', // slate-400
    tabIconDefault: '#475569', // slate-600
    tabIconSelected: tintColorDark,
    primary: '#ffffff', // white
    success: '#34d399', // emerald-400
    warning: '#fbbf24', // amber-400
    danger: '#f87171', // red-400
    cardShadow: '#000000',
  },
};

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
