import React, { createContext, useContext, useEffect, useState } from 'react';
import { useColorScheme as useSystemColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

type ThemeMode = 'light' | 'dark' | 'system';
type MapType = 'street' | 'satellite';

interface ThemeContextType {
    themeMode: ThemeMode;
    setThemeMode: (mode: ThemeMode) => void;
    isDark: boolean; // The effective state
    showPipelines: boolean;
    setShowPipelines: (show: boolean) => void;
    showZones: boolean;
    setShowZones: (show: boolean) => void;
    mapType: MapType;
    setMapType: (type: MapType) => void;
}

const ThemeContext = createContext<ThemeContextType>({
    themeMode: 'system',
    setThemeMode: () => { },
    isDark: false,
    showPipelines: true,
    setShowPipelines: () => { },
    showZones: true,
    setShowZones: () => { },
    mapType: 'street',
    setMapType: () => { }
});

const THEME_STORAGE_KEY = 'user_theme_preference';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    const systemColorScheme = useSystemColorScheme();
    const [themeMode, setThemeMode] = useState<ThemeMode>('system');
    const [loaded, setLoaded] = useState(false);
    const [showPipelines, setShowPipelines] = useState(true);
    const [showZones, setShowZones] = useState(true);
    const [mapType, setMapType] = useState<MapType>('street');

    useEffect(() => {
        loadTheme();
    }, []);

    const loadTheme = async () => {
        try {
            const savedTheme = await AsyncStorage.getItem(THEME_STORAGE_KEY);
            if (savedTheme && ['light', 'dark', 'system'].includes(savedTheme)) {
                setThemeMode(savedTheme as ThemeMode);
            }
        } catch (error) {
            console.warn('Failed to load theme preference', error);
        } finally {
            setLoaded(true);
        }
    };

    const handleSetTheme = async (mode: ThemeMode) => {
        setThemeMode(mode);
        try {
            await AsyncStorage.setItem(THEME_STORAGE_KEY, mode);
        } catch (error) {
            console.warn('Failed to save theme preference', error);
        }
    };

    const isDark =
        themeMode === 'dark' ||
        (themeMode === 'system' && systemColorScheme === 'dark');

    // Prevent rendering (or render null/loading) until we know the theme
    // This prevents a "flash" of the wrong theme
    if (!loaded) {
        return null;
    }

    return (
        <ThemeContext.Provider value={{ 
            themeMode, setThemeMode: handleSetTheme, isDark,
            showPipelines, setShowPipelines,
            showZones, setShowZones,
            mapType, setMapType
        }}>
            {children}
        </ThemeContext.Provider>
    );
}

export function useTheme() {
    return useContext(ThemeContext);
}
