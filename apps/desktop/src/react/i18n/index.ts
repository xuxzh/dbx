import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import en from "@/i18n/locales/en";
import { safeLocalStorageGet, safeLocalStorageSet } from "@/lib/safeStorage";

export type Locale = "en" | "es" | "it" | "ja" | "pt-BR" | "zh-CN" | "zh-TW";

const supportedLocales: Locale[] = ["en", "es", "it", "ja", "pt-BR", "zh-CN", "zh-TW"];
const defaultLocale: Locale = "en";
const loadedLocales = new Set<Locale>([defaultLocale]);

export function normalizeLocale(value: string | null): Locale | null {
  return value && supportedLocales.includes(value as Locale) ? (value as Locale) : null;
}

const localeLoaders: Record<Exclude<Locale, "en">, () => Promise<{ default: Record<string, unknown> }>> = {
  es: () => import("@/i18n/locales/es"),
  it: () => import("@/i18n/locales/it"),
  ja: () => import("@/i18n/locales/ja"),
  "pt-BR": () => import("@/i18n/locales/pt-BR"),
  "zh-CN": () => import("@/i18n/locales/zh-CN"),
  "zh-TW": () => import("@/i18n/locales/zh-TW"),
};

export async function loadLocaleMessages(locale: Locale) {
  if (loadedLocales.has(locale)) return;
  const messages = await localeLoaders[locale as Exclude<Locale, "en">]?.();
  if (!messages) return;
  i18next.addResourceBundle(locale, "translation", messages.default, true, true);
  loadedLocales.add(locale);
}

export async function setLocale(locale: Locale) {
  await loadLocaleMessages(locale);
  await i18next.changeLanguage(locale);
  safeLocalStorageSet("dbx-locale", locale);
}

export async function initReactI18n() {
  const initialLocale = normalizeLocale(safeLocalStorageGet("dbx-locale")) ?? defaultLocale;
  await i18next.use(initReactI18next).init({
    lng: initialLocale,
    fallbackLng: defaultLocale,
    resources: { en: { translation: en } },
    interpolation: { escapeValue: false },
  });
  await loadLocaleMessages(initialLocale);
  return i18next;
}