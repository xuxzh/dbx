import { useState, useEffect, useCallback, useMemo } from 'react';
import { APP_THEME_STORAGE_KEY, getTauriThemeForMode, normalizeAppThemeMode, resolveAppThemeAppearance, type AppThemeMode } from "@/lib/appTheme";
import { safeLocalStorageGet, safeLocalStorageSet } from "@/lib/safeStorage";
import { isTauriRuntime } from "@/lib/tauriRuntime";
import { useSettingsStore } from '@/react/stores/settingsStore';

type AppThemeAppearance = "light" | "dark";

function readSystemPrefersDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function useTheme() {
  const settingsStore = useSettingsStore();
  const editorTheme = settingsStore.editorSettings.theme;

  const [themeMode, setThemeModeState] = useState<AppThemeMode>(() => {
    return normalizeAppThemeMode(safeLocalStorageGet(APP_THEME_STORAGE_KEY));
  });

  const [systemPrefersDark, setSystemPrefersDark] = useState<boolean>(() => readSystemPrefersDark());

  const isDark = useMemo(() => {
    return resolveAppThemeAppearance(themeMode, systemPrefersDark) === "dark";
  }, [themeMode, systemPrefersDark]);

  // Set up system theme listener
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    setSystemPrefersDark(mediaQuery.matches);

    const onChange = (event: MediaQueryListEvent) => {
      setSystemPrefersDark(event.matches);
      if (themeMode === "system") {
        applyTheme();
      }
    };

    mediaQuery.addEventListener("change", onChange);
    return () => mediaQuery.removeEventListener("change", onChange);
  }, [themeMode]);

  const applyTheme = useCallback(() => {
    if (typeof document === "undefined") return;

    const doc = document.documentElement;
    const dark = isDark;

    doc.classList.add("disable-transitions");
    doc.classList.toggle("dark", dark);
    doc.style.colorScheme = dark ? "dark" : "light";

    // force reflow so the class toggle takes effect before re-enabling transitions
    doc.offsetHeight;
    requestAnimationFrame(() => doc.classList.remove("disable-transitions"));

    if (!isTauriRuntime()) return;

    import("@tauri-apps/api/window").then((mod) => {
      mod
        .getCurrentWindow()
        .setTheme(getTauriThemeForMode(themeMode))
        .catch(() => {});
    });
  }, [isDark, themeMode]);

  // Apply theme when it changes
  useEffect(() => {
    applyTheme();
  }, [applyTheme]);

  const setThemeMode = useCallback((mode: AppThemeMode) => {
    setThemeModeState(mode);
    safeLocalStorageSet(APP_THEME_STORAGE_KEY, mode);
    applyTheme();
  }, [applyTheme]);

  const toggleTheme = useCallback(() => {
    setThemeMode(isDark ? "light" : "dark");
  }, [isDark, setThemeMode]);

  return { isDark, themeMode, applyTheme, setThemeMode, toggleTheme };
}
