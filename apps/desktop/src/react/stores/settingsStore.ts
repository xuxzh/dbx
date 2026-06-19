import { create } from 'zustand';
import * as api from "@/lib/api";
import { normalizeColumnFormatter, normalizeCustomColumnFormatter, type ColumnFormatterConfig, type CustomColumnFormatterConfig } from "@/lib/columnFormatter";
import { normalizeShortcutSettings, type ShortcutSettings } from "@/lib/shortcutRegistry";
import { normalizeResultPageSize } from "@/lib/paginationPageSize";
import { normalizeSidebarHiddenTablePrefixes } from "@/lib/sidebarTableNameDisplay";
import { DEFAULT_SQL_FORMATTER_SETTINGS, normalizeSqlFormatterSettings, type SqlFormatterSettings } from "@/lib/sqlFormatterConfig";
import type { SidebarActivation } from "@/lib/treeNodeClick";
import type { SqlSnippet } from "@/types/database";
import { DEFAULT_SQL_SNIPPETS } from "@/lib/sqlCompletion";
import { setDebugLoggingEnabled } from "@/lib/debugLog";

export type AiProvider = "claude" | "openai" | "gemini" | "deepseek" | "qwen" | "ollama" | "openai-compatible" | "custom";
export type AiApiStyle = "completions" | "responses";
export type AiAuthMethod = "api-key" | "bearer";

export interface AiConfig {
  provider: AiProvider;
  apiKey: string;
  authMethod: AiAuthMethod;
  endpoint: string;
  model: string;
  apiStyle: AiApiStyle;
  proxyEnabled?: boolean;
  proxyUrl?: string;
  enableThinking?: boolean;
  contextWindow?: number;
}

export interface AiTestConnectionResult {
  success: boolean;
  message: string;
  latencyMs?: number;
  modelUsed: string;
  errorCategory?: string;
}

export interface DesktopSettings {
  show_tray_icon: boolean;
  icon_theme: DesktopIconTheme;
  debug_logging_enabled: boolean;
  saved_sql_sync_dir?: string | null;
  driver_store_dir?: string | null;
  plugin_store_dir?: string | null;
  agent_store_dir?: string | null;
  sidebar_table_page_size?: number | null;
}

export type DesktopIconTheme = "default" | "black";

export type InterfaceLayout = "separated" | "classic";

export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = {
  show_tray_icon: true,
  icon_theme: "default",
  debug_logging_enabled: false,
  saved_sql_sync_dir: null,
  driver_store_dir: null,
  plugin_store_dir: null,
  agent_store_dir: null,
  sidebar_table_page_size: 500,
};

function normalizeDesktopSettings(settings: Partial<DesktopSettings> | null | undefined): DesktopSettings {
  const iconTheme = settings?.icon_theme === "black" ? "black" : DEFAULT_DESKTOP_SETTINGS.icon_theme;
  const sidebarTablePageSize = typeof settings?.sidebar_table_page_size === "number" && settings.sidebar_table_page_size > 0 ? settings.sidebar_table_page_size : DEFAULT_DESKTOP_SETTINGS.sidebar_table_page_size;
  return {
    show_tray_icon: settings?.show_tray_icon ?? DEFAULT_DESKTOP_SETTINGS.show_tray_icon,
    icon_theme: iconTheme,
    debug_logging_enabled: settings?.debug_logging_enabled ?? DEFAULT_DESKTOP_SETTINGS.debug_logging_enabled,
    saved_sql_sync_dir: settings?.saved_sql_sync_dir?.trim() || DEFAULT_DESKTOP_SETTINGS.saved_sql_sync_dir,
    driver_store_dir: settings?.driver_store_dir?.trim() || DEFAULT_DESKTOP_SETTINGS.driver_store_dir,
    plugin_store_dir: settings?.plugin_store_dir?.trim() || DEFAULT_DESKTOP_SETTINGS.plugin_store_dir,
    agent_store_dir: settings?.agent_store_dir?.trim() || DEFAULT_DESKTOP_SETTINGS.agent_store_dir,
    sidebar_table_page_size: sidebarTablePageSize,
  };
}

export interface AiProviderPreset extends Omit<AiConfig, "apiKey"> {
  label: string;
  iconSlug?: string;
  requiresApiKey: boolean;
}

export const AI_PROVIDER_PRESETS: Record<AiProvider, AiProviderPreset> = {
  claude: {
    label: "Claude",
    iconSlug: "anthropic",
    provider: "claude",
    endpoint: "https://api.anthropic.com/v1/messages",
    model: "claude-sonnet-4-20250514",
    apiStyle: "completions",
    authMethod: "api-key",
    requiresApiKey: true,
  },
  openai: {
    label: "OpenAI",
    iconSlug: "openai",
    provider: "openai",
    endpoint: "https://api.openai.com/v1/chat/completions",
    model: "gpt-4o-mini",
    apiStyle: "completions",
    authMethod: "bearer",
    requiresApiKey: true,
  },
  gemini: {
    label: "Gemini",
    iconSlug: "googlegemini",
    provider: "gemini",
    endpoint: "https://generativelanguage.googleapis.com",
    model: "gemini-1.5-pro",
    apiStyle: "completions",
    authMethod: "api-key",
    requiresApiKey: true,
  },
  deepseek: {
    label: "DeepSeek",
    iconSlug: "deepseek",
    provider: "deepseek",
    endpoint: "https://api.deepseek.com/v1",
    model: "deepseek-v4-flash",
    apiStyle: "completions",
    authMethod: "bearer",
    requiresApiKey: true,
  },
  qwen: {
    label: "Qwen",
    iconSlug: "alibabacloud",
    provider: "qwen",
    endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
    apiStyle: "completions",
    authMethod: "bearer",
    requiresApiKey: true,
  },
  ollama: {
    label: "Ollama",
    iconSlug: "ollama",
    provider: "ollama",
    endpoint: "http://localhost:11434/v1",
    model: "llama3.1",
    apiStyle: "completions",
    authMethod: "bearer",
    requiresApiKey: false,
  },
  "openai-compatible": {
    label: "OpenAI Compatible",
    iconSlug: "openai",
    provider: "openai-compatible",
    endpoint: "",
    model: "",
    apiStyle: "completions",
    authMethod: "bearer",
    requiresApiKey: true,
  },
  custom: {
    label: "Custom",
    provider: "custom",
    endpoint: "",
    model: "",
    apiStyle: "completions",
    authMethod: "bearer",
    requiresApiKey: true,
  },
};

const defaultConfigs: Record<AiProvider, Omit<AiConfig, "apiKey">> = Object.fromEntries(
  Object.entries(AI_PROVIDER_PRESETS).map(([provider, preset]) => {
    const { label: _label, iconSlug: _iconSlug, requiresApiKey: _requiresApiKey, ...config } = preset;
    return [provider, config];
  }),
) as Record<AiProvider, Omit<AiConfig, "apiKey">>;

export function normalizeAiConfig(config: Partial<AiConfig> | null | undefined): AiConfig {
  const provider = config?.provider && config.provider in AI_PROVIDER_PRESETS ? config.provider : inferAiProviderFromConfig(config);
  return {
    ...defaultConfigs[provider],
    apiKey: config?.apiKey ?? "",
    ...config,
    provider,
    apiStyle: config?.apiStyle ?? defaultConfigs[provider].apiStyle,
    authMethod: config?.authMethod ?? defaultConfigs[provider].authMethod,
    proxyEnabled: !!config?.proxyEnabled,
    proxyUrl: config?.proxyUrl ?? "",
    enableThinking: config?.enableThinking ?? true,
    contextWindow: config?.contextWindow ?? undefined,
  };
}

function inferAiProviderFromConfig(config: Partial<AiConfig> | null | undefined): AiProvider {
  const endpoint = config?.endpoint?.toLowerCase() ?? "";
  const model = config?.model?.toLowerCase() ?? "";
  if (endpoint.includes("deepseek") || model.includes("deepseek")) return "deepseek";
  if (endpoint.includes("dashscope") || endpoint.includes("aliyuncs") || model.includes("qwen")) return "qwen";
  if (endpoint.includes("generativelanguage.googleapis.com") || model.includes("gemini")) return "gemini";
  if (endpoint.includes("localhost:11434") || endpoint.includes("127.0.0.1:11434")) return "ollama";
  if (endpoint.includes("openai.com") || model.startsWith("gpt-")) return "openai";
  return "claude";
}

export type EditorTheme = "app" | "one-dark" | "vscode-dark" | "vscode-light" | "nord" | "okaidia" | "material" | "duotone-light" | "duotone-dark" | "xcode" | "custom";

const STRUCTURE_EDITOR_DENSITIES = ["compact", "standard", "comfortable"] as const;
export type StructureEditorDensity = (typeof STRUCTURE_EDITOR_DENSITIES)[number];
const CELL_DETAIL_PANEL_LAYOUTS = ["bottom", "right"] as const;
export type CellDetailPanelLayout = (typeof CELL_DETAIL_PANEL_LAYOUTS)[number];
const DATA_GRID_RENDER_MODES = ["dom", "canvas"] as const;
export type DataGridRenderMode = (typeof DATA_GRID_RENDER_MODES)[number];
const DISCONNECT_TAB_HANDLING_MODES = ["close-tabs", "keep-tabs-clear-results", "keep-tabs-keep-results"] as const;
export type DisconnectTabHandlingMode = (typeof DISCONNECT_TAB_HANDLING_MODES)[number];

export interface CustomThemeColors {
  keyword: string;
  field: string;
  function: string;
  string: string;
  number: string;
  comment: string;
  table: string;
  operator: string;
  type: string;
  builtin: string;
  background?: string;
  foreground?: string;
}

export const DEFAULT_CUSTOM_THEME_COLORS: CustomThemeColors = {
  keyword: "#cba6f7",
  field: "#f9e2af",
  function: "#89dceb",
  string: "#a6e3a1",
  number: "#fab387",
  comment: "#6c7086",
  table: "#a6e3a1",
  operator: "#89b4fa",
  type: "#89b4fa",
  builtin: "#f38ba8",
};

export interface CustomThemeDdlColors {
  addedRowBg: string;
  addedRowBgAlpha: number;
  removedRowBg: string;
  removedRowBgAlpha: number;
  modifiedRowBg: string;
  modifiedRowBgAlpha: number;
  modifiedCharBg: string;
  modifiedCharBgAlpha: number;
}

export const DEFAULT_CUSTOM_THEME_DDL_COLORS: CustomThemeDdlColors = {
  addedRowBg: "#22c55e",
  addedRowBgAlpha: 10,
  removedRowBg: "#ef4444",
  removedRowBgAlpha: 10,
  modifiedRowBg: "#eab308",
  modifiedRowBgAlpha: 10,
  modifiedCharBg: "#f59e0b",
  modifiedCharBgAlpha: 50,
};

export interface CustomTheme {
  id: string;
  name: string;
  colors: CustomThemeColors;
  ddlColors: CustomThemeDdlColors;
}

export const DEFAULT_CUSTOM_THEMES: CustomTheme[] = [{ id: "default", name: "Custom", colors: { ...DEFAULT_CUSTOM_THEME_COLORS }, ddlColors: { ...DEFAULT_CUSTOM_THEME_DDL_COLORS } }];

export interface EditorSettings {
  fontFamily: string;
  fontSize: number;
  uiScale: number;
  theme: EditorTheme;
  customThemeColors: CustomThemeColors;
  customThemes: CustomTheme[];
  activeCustomThemeId: string;
  executeMode: "all" | "current";
  wordWrap: boolean;
  confirmDangerousSqlExecution: boolean;
  compactTabTitle: boolean;
  appLayout: "separated" | "classic";
  pageSize: number;
  infiniteScroll: boolean;
  infiniteScrollMaxRows: number;
  redisScanPageSize: number;
  mongoViewMode: "document" | "table";
  showColumnCommentsInHeader: boolean;
  showColumnTypesInHeader: boolean;
  compactColumnHeaderActions: boolean;
  dataGridRenderMode: DataGridRenderMode;
  structureEditorDensity: StructureEditorDensity;
  tableInfoDrawerWidth: number;
  cellDetailDrawerWidth: number;
  cellDetailPanelLayout: CellDetailPanelLayout;
  shortcuts: ShortcutSettings;
  sqlFormatter: SqlFormatterSettings;
  sidebarActivation: SidebarActivation;
  sidebarObjectDisplay: "grouped" | "simple";
  autoSelectActiveSidebarNode: boolean;
  disconnectTabHandlingMode: DisconnectTabHandlingMode;
  reuseDataTab: boolean;
  updateNotificationsEnabled: boolean;
  sidebarHiddenTablePrefixes: string[];
  sidebarHideTableComments: boolean;
  sidebarAllowHorizontalScroll: boolean;
  columnFormatters: Record<string, ColumnFormatterConfig>;
  customColumnFormatters: Record<string, CustomColumnFormatterConfig>;
  snippets: SqlSnippet[];
  exportBatchSize: number;
  toolbarItems: ToolbarItems;
}

export interface ToolbarItems {
  dataTransfer: boolean;
  driverManager: boolean;
  sqlFile: boolean;
  schemaDiff: boolean;
  dataCompare: boolean;
  checkUpdates: boolean;
  sqlLibrary: boolean;
  history: boolean;
  ai: boolean;
  theme: boolean;
  github: boolean;
}

export const DEFAULT_TOOLBAR_ITEMS: ToolbarItems = {
  dataTransfer: true,
  driverManager: true,
  sqlFile: true,
  schemaDiff: true,
  dataCompare: true,
  checkUpdates: true,
  sqlLibrary: true,
  history: true,
  ai: true,
  theme: true,
  github: true,
};

export const EDITOR_THEMES: { value: EditorTheme; label: string; dark: boolean }[] = [
  { value: "app", label: "Follow app theme", dark: false },
  { value: "one-dark", label: "One Dark", dark: true },
  { value: "vscode-dark", label: "VS Dark+", dark: true },
  { value: "vscode-light", label: "VS Light+", dark: false },
  { value: "nord", label: "Nord", dark: true },
  { value: "okaidia", label: "Okaidia", dark: true },
  { value: "material", label: "Material", dark: true },
  { value: "duotone-light", label: "Duotone Light", dark: false },
  { value: "duotone-dark", label: "Duotone Dark", dark: true },
  { value: "xcode", label: "Xcode", dark: false },
  { value: "custom", label: "Custom", dark: true },
];

const EDITOR_THEME_VALUES = new Set<EditorTheme>(EDITOR_THEMES.map((theme) => theme.value));

export const FONT_FAMILIES: { value: string; label: string }[] = [
  { value: "'JetBrains Mono', 'Fira Code', monospace", label: "JetBrains Mono" },
  { value: "'Fira Code', monospace", label: "Fira Code" },
  { value: "'Cascadia Code', monospace", label: "Cascadia Code" },
  { value: "'Source Code Pro', monospace", label: "Source Code Pro" },
  { value: "'SF Mono', 'Menlo', monospace", label: "SF Mono / Menlo" },
  { value: "'Consolas', 'Courier New', monospace", label: "Consolas" },
  { value: "monospace", label: "System Monospace" },
];

export const DEFAULT_EDITOR_SETTINGS: EditorSettings = {
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  fontSize: 13,
  uiScale: 1,
  theme: "app",
  customThemeColors: { ...DEFAULT_CUSTOM_THEME_COLORS },
  customThemes: [...DEFAULT_CUSTOM_THEMES],
  activeCustomThemeId: "default",
  executeMode: "all",
  wordWrap: false,
  confirmDangerousSqlExecution: true,
  compactTabTitle: false,
  appLayout: "classic",
  pageSize: 100,
  infiniteScroll: false,
  infiniteScrollMaxRows: 5000,
  redisScanPageSize: 1000,
  mongoViewMode: "document",
  showColumnCommentsInHeader: false,
  showColumnTypesInHeader: true,
  compactColumnHeaderActions: true,
  dataGridRenderMode: "canvas",
  structureEditorDensity: "compact",
  tableInfoDrawerWidth: 320,
  cellDetailDrawerWidth: 320,
  cellDetailPanelLayout: "bottom",
  shortcuts: normalizeShortcutSettings(),
  sqlFormatter: normalizeSqlFormatterSettings(DEFAULT_SQL_FORMATTER_SETTINGS),
  sidebarActivation: "single",
  sidebarObjectDisplay: "grouped",
  autoSelectActiveSidebarNode: false,
  disconnectTabHandlingMode: "close-tabs",
  reuseDataTab: false,
  updateNotificationsEnabled: true,
  sidebarHiddenTablePrefixes: [],
  sidebarHideTableComments: false,
  sidebarAllowHorizontalScroll: false,
  columnFormatters: {},
  customColumnFormatters: {},
  snippets: DEFAULT_SQL_SNIPPETS,
  exportBatchSize: 10000,
  toolbarItems: { ...DEFAULT_TOOLBAR_ITEMS },
};

export const STORAGE_KEY = "dbx-editor-settings";
const OLD_FONT_SIZE_KEY = "dbx-query-editor-font-size";
const MIN_UI_SCALE = 0.75;
const MAX_UI_SCALE = 2;

function normalizeUiScale(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_EDITOR_SETTINGS.uiScale;
  return Math.min(MAX_UI_SCALE, Math.max(MIN_UI_SCALE, Math.round(value * 100) / 100));
}

function normalizeDrawerWidth(value: unknown, min: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(900, Math.max(min, Math.round(value)));
}

function normalizeStructureEditorDensity(value: unknown): StructureEditorDensity {
  return STRUCTURE_EDITOR_DENSITIES.includes(value as StructureEditorDensity) ? (value as StructureEditorDensity) : DEFAULT_EDITOR_SETTINGS.structureEditorDensity;
}

function normalizeCellDetailPanelLayout(value: unknown): CellDetailPanelLayout {
  return CELL_DETAIL_PANEL_LAYOUTS.includes(value as CellDetailPanelLayout) ? (value as CellDetailPanelLayout) : DEFAULT_EDITOR_SETTINGS.cellDetailPanelLayout;
}

function normalizeDataGridRenderMode(value: unknown): DataGridRenderMode {
  return DATA_GRID_RENDER_MODES.includes(value as DataGridRenderMode) ? (value as DataGridRenderMode) : DEFAULT_EDITOR_SETTINGS.dataGridRenderMode;
}

function normalizeDisconnectTabHandlingMode(value: unknown, legacyCloseTabsOnDisconnect?: unknown): DisconnectTabHandlingMode {
  if (DISCONNECT_TAB_HANDLING_MODES.includes(value as DisconnectTabHandlingMode)) {
    return value as DisconnectTabHandlingMode;
  }
  if (value === "clear-state") return "keep-tabs-clear-results";
  if (value === "keep-tabs") return "keep-tabs-keep-results";
  if (typeof legacyCloseTabsOnDisconnect === "boolean") {
    return legacyCloseTabsOnDisconnect ? "close-tabs" : "keep-tabs-clear-results";
  }
  return DEFAULT_EDITOR_SETTINGS.disconnectTabHandlingMode;
}

function normalizeColumnFormatters(value: unknown): Record<string, ColumnFormatterConfig> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const formatters: Record<string, ColumnFormatterConfig> = {};
  for (const [key, formatter] of Object.entries(value as Record<string, unknown>)) {
    const normalized = normalizeColumnFormatter(formatter);
    if (normalized) formatters[key] = normalized;
  }
  return formatters;
}

function normalizeCustomColumnFormatters(value: unknown): Record<string, CustomColumnFormatterConfig> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const formatters: Record<string, CustomColumnFormatterConfig> = {};
  for (const formatter of Object.values(value as Record<string, unknown>)) {
    const normalized = normalizeCustomColumnFormatter(formatter);
    if (normalized) formatters[normalized.id] = normalized;
  }
  return formatters;
}

function normalizeSqlSnippets(value: unknown, existing?: SqlSnippet[]): SqlSnippet[] {
  if (!Array.isArray(value)) return existing ?? DEFAULT_SQL_SNIPPETS;
  if (value.length === 0) return [];
  const valid: SqlSnippet[] = [];
  const seenPrefixes = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object" || typeof item.id !== "string" || !item.id || typeof item.label !== "string" || !item.label || typeof item.prefix !== "string" || !item.prefix || typeof item.body !== "string") {
      continue;
    }
    if (seenPrefixes.has(item.prefix)) continue;
    seenPrefixes.add(item.prefix);
    valid.push({ id: item.id, label: item.label, prefix: item.prefix, body: item.body });
  }
  if (valid.length === 0) return existing ?? DEFAULT_SQL_SNIPPETS;
  return valid;
}

function normalizeToolbarItems(items: Partial<ToolbarItems> | undefined): ToolbarItems {
  const defaults = DEFAULT_TOOLBAR_ITEMS;
  if (!items || typeof items !== "object") return { ...defaults };
  return {
    dataTransfer: items.dataTransfer ?? defaults.dataTransfer,
    driverManager: items.driverManager ?? defaults.driverManager,
    sqlFile: items.sqlFile ?? defaults.sqlFile,
    schemaDiff: items.schemaDiff ?? defaults.schemaDiff,
    dataCompare: items.dataCompare ?? defaults.dataCompare,
    checkUpdates: items.checkUpdates ?? defaults.checkUpdates,
    sqlLibrary: items.sqlLibrary ?? defaults.sqlLibrary,
    history: items.history ?? defaults.history,
    ai: items.ai ?? defaults.ai,
    theme: items.theme ?? defaults.theme,
    github: items.github ?? defaults.github,
  };
}

export function normalizeEditorSettings(settings: Partial<EditorSettings>, existing?: EditorSettings): EditorSettings {
  return {
    fontFamily: settings.fontFamily ?? DEFAULT_EDITOR_SETTINGS.fontFamily,
    fontSize: settings.fontSize ?? DEFAULT_EDITOR_SETTINGS.fontSize,
    uiScale: normalizeUiScale(settings.uiScale),
    theme: settings.theme && EDITOR_THEME_VALUES.has(settings.theme) ? settings.theme : DEFAULT_EDITOR_SETTINGS.theme,
    customThemeColors: {
      ...DEFAULT_CUSTOM_THEME_COLORS,
      ...settings.customThemeColors,
    },
    customThemes: (() => {
      if (Array.isArray(settings.customThemes) && settings.customThemes.length > 0) {
        return settings.customThemes.map((theme) => {
          const renamed = theme.name === "默认" ? { ...theme, name: "Custom" } : { ...theme };
          return {
            ...renamed,
            colors: { ...DEFAULT_CUSTOM_THEME_COLORS, ...renamed.colors },
            ddlColors: { ...DEFAULT_CUSTOM_THEME_DDL_COLORS, ...(renamed as any).ddlColors },
          };
        });
      }
      return settings.customThemeColors
        ? [
            {
              id: "migrated",
              name: "Migrated",
              colors: { ...DEFAULT_CUSTOM_THEME_COLORS, ...settings.customThemeColors },
              ddlColors: { ...DEFAULT_CUSTOM_THEME_DDL_COLORS },
            },
          ]
        : [];
    })(),
    activeCustomThemeId: settings.activeCustomThemeId ?? "default",
    executeMode: settings.executeMode ?? DEFAULT_EDITOR_SETTINGS.executeMode,
    wordWrap: settings.wordWrap ?? DEFAULT_EDITOR_SETTINGS.wordWrap,
    confirmDangerousSqlExecution: settings.confirmDangerousSqlExecution ?? DEFAULT_EDITOR_SETTINGS.confirmDangerousSqlExecution,
    compactTabTitle: settings.compactTabTitle ?? DEFAULT_EDITOR_SETTINGS.compactTabTitle,
    appLayout: settings.appLayout ?? DEFAULT_EDITOR_SETTINGS.appLayout,
    pageSize: normalizeResultPageSize(settings.pageSize),
    infiniteScroll: settings.infiniteScroll ?? DEFAULT_EDITOR_SETTINGS.infiniteScroll,
    infiniteScrollMaxRows: typeof settings.infiniteScrollMaxRows === "number" && settings.infiniteScrollMaxRows >= 1000 && settings.infiniteScrollMaxRows <= 50000 ? Math.round(settings.infiniteScrollMaxRows) : DEFAULT_EDITOR_SETTINGS.infiniteScrollMaxRows,
    redisScanPageSize: settings.redisScanPageSize ?? DEFAULT_EDITOR_SETTINGS.redisScanPageSize,
    mongoViewMode: settings.mongoViewMode === "table" ? "table" : DEFAULT_EDITOR_SETTINGS.mongoViewMode,
    showColumnCommentsInHeader: settings.showColumnCommentsInHeader ?? DEFAULT_EDITOR_SETTINGS.showColumnCommentsInHeader,
    showColumnTypesInHeader: settings.showColumnTypesInHeader ?? DEFAULT_EDITOR_SETTINGS.showColumnTypesInHeader,
    compactColumnHeaderActions: settings.compactColumnHeaderActions ?? DEFAULT_EDITOR_SETTINGS.compactColumnHeaderActions,
    dataGridRenderMode: normalizeDataGridRenderMode(settings.dataGridRenderMode),
    structureEditorDensity: normalizeStructureEditorDensity(settings.structureEditorDensity),
    tableInfoDrawerWidth: normalizeDrawerWidth(settings.tableInfoDrawerWidth, 240, DEFAULT_EDITOR_SETTINGS.tableInfoDrawerWidth),
    cellDetailDrawerWidth: normalizeDrawerWidth(settings.cellDetailDrawerWidth, 260, DEFAULT_EDITOR_SETTINGS.cellDetailDrawerWidth),
    cellDetailPanelLayout: normalizeCellDetailPanelLayout(settings.cellDetailPanelLayout),
    shortcuts: normalizeShortcutSettings(settings.shortcuts),
    sqlFormatter: normalizeSqlFormatterSettings(settings.sqlFormatter),
    sidebarActivation: settings.sidebarActivation === "single" || settings.sidebarActivation === "double" ? settings.sidebarActivation : DEFAULT_EDITOR_SETTINGS.sidebarActivation,
    sidebarObjectDisplay: settings.sidebarObjectDisplay === "simple" || settings.sidebarObjectDisplay === "grouped" ? settings.sidebarObjectDisplay : DEFAULT_EDITOR_SETTINGS.sidebarObjectDisplay,
    autoSelectActiveSidebarNode: settings.autoSelectActiveSidebarNode ?? DEFAULT_EDITOR_SETTINGS.autoSelectActiveSidebarNode,
    disconnectTabHandlingMode: normalizeDisconnectTabHandlingMode((settings as Partial<EditorSettings>).disconnectTabHandlingMode, (settings as Partial<EditorSettings> & { closeQueryTabsOnDisconnect?: boolean }).closeQueryTabsOnDisconnect),
    reuseDataTab: settings.reuseDataTab ?? DEFAULT_EDITOR_SETTINGS.reuseDataTab,
    updateNotificationsEnabled: settings.updateNotificationsEnabled ?? DEFAULT_EDITOR_SETTINGS.updateNotificationsEnabled,
    sidebarHiddenTablePrefixes: normalizeSidebarHiddenTablePrefixes(settings.sidebarHiddenTablePrefixes),
    sidebarHideTableComments: settings.sidebarHideTableComments ?? DEFAULT_EDITOR_SETTINGS.sidebarHideTableComments,
    sidebarAllowHorizontalScroll: settings.sidebarAllowHorizontalScroll ?? DEFAULT_EDITOR_SETTINGS.sidebarAllowHorizontalScroll,
    columnFormatters: normalizeColumnFormatters(settings.columnFormatters),
    customColumnFormatters: normalizeCustomColumnFormatters(settings.customColumnFormatters),
    snippets: normalizeSqlSnippets(settings.snippets, existing?.snippets),
    exportBatchSize: typeof settings.exportBatchSize === "number" && settings.exportBatchSize >= 100 && settings.exportBatchSize <= 100000 ? Math.round(settings.exportBatchSize) : DEFAULT_EDITOR_SETTINGS.exportBatchSize,
    toolbarItems: normalizeToolbarItems(settings.toolbarItems),
  };
}

function loadEditorSettings(): EditorSettings {
  // Try new format first
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<EditorSettings>;
      return normalizeEditorSettings(parsed);
    }
  } catch {
    /* ignore */
  }

  // Migrate old font-size key if new settings don't exist
  try {
    const oldSize = localStorage.getItem(OLD_FONT_SIZE_KEY);
    if (oldSize) {
      const parsed = parseInt(oldSize, 10);
      if (!isNaN(parsed)) {
        const migrated = normalizeEditorSettings({ fontSize: parsed });
        saveEditorSettings(migrated);
        localStorage.removeItem(OLD_FONT_SIZE_KEY);
        return migrated;
      }
    }
  } catch {
    /* ignore */
  }

  return normalizeEditorSettings({});
}

function saveEditorSettings(settings: EditorSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export interface SettingsStoreState {
  aiConfig: AiConfig;
  isAiConfigLoaded: boolean;
  desktopSettings: DesktopSettings;
  isDesktopSettingsLoaded: boolean;
  editorSettings: EditorSettings;
  initDesktopSettings: () => Promise<void>;
  updateDesktopSettings: (partial: Partial<DesktopSettings>) => Promise<void>;
  initAiConfig: () => Promise<void>;
  updateAiConfig: (config: Partial<AiConfig>) => void;
  isConfigured: () => boolean;
  updateEditorSettings: (partial: Partial<EditorSettings>) => void;
  updateColumnFormatter: (key: string, formatter: ColumnFormatterConfig | undefined) => void;
  upsertCustomColumnFormatter: (formatter: CustomColumnFormatterConfig) => CustomColumnFormatterConfig | undefined;
  deleteCustomColumnFormatter: (id: string) => void;
}

export const useSettingsStore = create((set, get) => ({
  aiConfig: normalizeAiConfig({ provider: "claude" }),
  isAiConfigLoaded: false,
  desktopSettings: { ...DEFAULT_DESKTOP_SETTINGS },
  isDesktopSettingsLoaded: false,
  editorSettings: loadEditorSettings(),

  async initDesktopSettings() {
    if (get().isDesktopSettingsLoaded) return;
    const normalized = normalizeDesktopSettings(await api.loadDesktopSettings().catch(() => null));
    set({ desktopSettings: normalized, isDesktopSettingsLoaded: true });
    setDebugLoggingEnabled(normalized.debug_logging_enabled);
  },

  async updateDesktopSettings(partial: Partial<DesktopSettings>) {
    const previous = get().desktopSettings;
    const next = { ...previous, ...partial };
    const normalized = normalizeDesktopSettings(next);
    set({ desktopSettings: normalized });
    setDebugLoggingEnabled(normalized.debug_logging_enabled);
    try {
      await api.saveDesktopSettings(normalized);
    } catch (error) {
      set({ desktopSettings: previous });
      setDebugLoggingEnabled(previous.debug_logging_enabled);
      throw error;
    }
  },

  async initAiConfig() {
    if (get().isAiConfigLoaded) return;
    const legacy = localStorage.getItem("dbx-ai-config");
    const saved = await api.loadAiConfig().catch(() => null);
    let config: AiConfig;
    if (saved) {
      config = normalizeAiConfig(saved);
    } else if (legacy) {
      config = normalizeAiConfig(JSON.parse(legacy));
      await api.saveAiConfig(config).catch(() => {});
      localStorage.removeItem("dbx-ai-config");
    } else {
      config = normalizeAiConfig({ provider: "claude" });
    }
    set({ aiConfig: config, isAiConfigLoaded: true });
  },

  updateAiConfig(config: Partial<AiConfig>) {
    const previousProvider = get().aiConfig.provider;
    const currentConfig = get().aiConfig;
    if (config.provider && config.provider !== previousProvider) {
      const newConfig = { ...defaultConfigs[config.provider], ...currentConfig, ...config, provider: config.provider };
      set({ aiConfig: newConfig });
      api.saveAiConfig(newConfig).catch(() => {});
    } else {
      const newConfig = { ...currentConfig, ...config };
      set({ aiConfig: newConfig });
      api.saveAiConfig(newConfig).catch(() => {});
    }
  },

  isConfigured(): boolean {
    const preset = AI_PROVIDER_PRESETS[get().aiConfig.provider];
    return !!get().aiConfig.endpoint && !!get().aiConfig.model && (!preset.requiresApiKey || !!get().aiConfig.apiKey);
  },

  updateEditorSettings(partial: Partial<EditorSettings>) {
    const current = get().editorSettings;
    let updated = { ...current };

    if (partial.fontFamily !== undefined) updated.fontFamily = partial.fontFamily;
    if (partial.fontSize !== undefined) updated.fontSize = partial.fontSize;
    if (partial.uiScale !== undefined) updated.uiScale = normalizeUiScale(partial.uiScale);
    if (partial.theme !== undefined) updated.theme = partial.theme;
    if (partial.customThemeColors !== undefined) {
      updated.customThemeColors = { ...updated.customThemeColors, ...partial.customThemeColors };
    }
    if (partial.customThemes !== undefined) {
      updated.customThemes = Array.isArray(partial.customThemes) ? partial.customThemes : updated.customThemes;
    }
    if (partial.activeCustomThemeId !== undefined) {
      updated.activeCustomThemeId = partial.activeCustomThemeId;
    }
    if (partial.customThemes !== undefined || partial.activeCustomThemeId !== undefined) {
      const themes = updated.customThemes;
      const activeId = updated.activeCustomThemeId;
      const activeTheme = themes.find((t) => t.id === activeId) || themes[0];
      if (activeTheme) {
        updated.customThemeColors = { ...activeTheme.colors };
      }
    }
    if (partial.executeMode !== undefined) updated.executeMode = partial.executeMode;
    if (partial.wordWrap !== undefined) updated.wordWrap = partial.wordWrap;
    if (partial.confirmDangerousSqlExecution !== undefined) updated.confirmDangerousSqlExecution = partial.confirmDangerousSqlExecution;
    if (partial.compactTabTitle !== undefined) updated.compactTabTitle = partial.compactTabTitle;
    if (partial.appLayout !== undefined) updated.appLayout = partial.appLayout;
    if (partial.pageSize !== undefined) updated.pageSize = normalizeResultPageSize(partial.pageSize);
    if (partial.infiniteScroll !== undefined) updated.infiniteScroll = partial.infiniteScroll;
    if (partial.infiniteScrollMaxRows !== undefined) {
      updated.infiniteScrollMaxRows = typeof partial.infiniteScrollMaxRows === "number" && partial.infiniteScrollMaxRows >= 1000 && partial.infiniteScrollMaxRows <= 50000 ? Math.round(partial.infiniteScrollMaxRows) : DEFAULT_EDITOR_SETTINGS.infiniteScrollMaxRows;
    }
    if (partial.redisScanPageSize !== undefined) updated.redisScanPageSize = partial.redisScanPageSize;
    if (partial.mongoViewMode !== undefined) updated.mongoViewMode = partial.mongoViewMode;
    if (partial.showColumnCommentsInHeader !== undefined) updated.showColumnCommentsInHeader = partial.showColumnCommentsInHeader;
    if (partial.showColumnTypesInHeader !== undefined) updated.showColumnTypesInHeader = partial.showColumnTypesInHeader;
    if (partial.compactColumnHeaderActions !== undefined) updated.compactColumnHeaderActions = partial.compactColumnHeaderActions;
    if (partial.dataGridRenderMode !== undefined) updated.dataGridRenderMode = normalizeDataGridRenderMode(partial.dataGridRenderMode);
    if (partial.structureEditorDensity !== undefined) updated.structureEditorDensity = normalizeStructureEditorDensity(partial.structureEditorDensity);
    if (partial.tableInfoDrawerWidth !== undefined) updated.tableInfoDrawerWidth = normalizeDrawerWidth(partial.tableInfoDrawerWidth, 240, 320);
    if (partial.cellDetailDrawerWidth !== undefined) updated.cellDetailDrawerWidth = normalizeDrawerWidth(partial.cellDetailDrawerWidth, 260, 320);
    if (partial.cellDetailPanelLayout !== undefined) updated.cellDetailPanelLayout = normalizeCellDetailPanelLayout(partial.cellDetailPanelLayout);
    if (partial.shortcuts !== undefined) updated.shortcuts = normalizeShortcutSettings(partial.shortcuts);
    if (partial.sqlFormatter !== undefined) updated.sqlFormatter = normalizeSqlFormatterSettings(partial.sqlFormatter);
    if (partial.sidebarActivation !== undefined) updated.sidebarActivation = partial.sidebarActivation;
    if (partial.sidebarObjectDisplay !== undefined) updated.sidebarObjectDisplay = partial.sidebarObjectDisplay;
    if (partial.autoSelectActiveSidebarNode !== undefined) updated.autoSelectActiveSidebarNode = partial.autoSelectActiveSidebarNode;
    if (partial.disconnectTabHandlingMode !== undefined) updated.disconnectTabHandlingMode = normalizeDisconnectTabHandlingMode(partial.disconnectTabHandlingMode);
    if (partial.reuseDataTab !== undefined) updated.reuseDataTab = partial.reuseDataTab;
    if (partial.updateNotificationsEnabled !== undefined) updated.updateNotificationsEnabled = partial.updateNotificationsEnabled;
    if (partial.sidebarHiddenTablePrefixes !== undefined) updated.sidebarHiddenTablePrefixes = normalizeSidebarHiddenTablePrefixes(partial.sidebarHiddenTablePrefixes);
    if (partial.sidebarHideTableComments !== undefined) updated.sidebarHideTableComments = partial.sidebarHideTableComments;
    if (partial.sidebarAllowHorizontalScroll !== undefined) updated.sidebarAllowHorizontalScroll = partial.sidebarAllowHorizontalScroll;
    if (partial.columnFormatters !== undefined) updated.columnFormatters = partial.columnFormatters;
    if (partial.customColumnFormatters !== undefined) updated.customColumnFormatters = partial.customColumnFormatters;
    if (partial.snippets !== undefined) updated.snippets = normalizeSqlSnippets(partial.snippets);
    if (partial.exportBatchSize !== undefined) updated.exportBatchSize = Math.min(100000, Math.max(100, Math.round(partial.exportBatchSize)));
    if (partial.toolbarItems !== undefined) updated.toolbarItems = normalizeToolbarItems(partial.toolbarItems);

    set({ editorSettings: updated });
    saveEditorSettings(updated);
  },

  updateColumnFormatter(key: string, formatter: ColumnFormatterConfig | undefined) {
    const current = get().editorSettings;
    const columnFormatters = { ...current.columnFormatters };
    const normalized = normalizeColumnFormatter(formatter);
    if (normalized) {
      columnFormatters[key] = normalized;
    } else {
      delete columnFormatters[key];
    }
    get().updateEditorSettings({ columnFormatters });
  },

  upsertCustomColumnFormatter(formatter: CustomColumnFormatterConfig): CustomColumnFormatterConfig | undefined {
    const normalized = normalizeCustomColumnFormatter(formatter);
    if (!normalized) return undefined;
    const current = get().editorSettings;
    get().updateEditorSettings({
      customColumnFormatters: {
        ...current.customColumnFormatters,
        [normalized.id]: normalized,
      },
    });
    return normalized;
  },

  deleteCustomColumnFormatter(id: string) {
    const current = get().editorSettings;
    const customColumnFormatters = { ...current.customColumnFormatters };
    delete customColumnFormatters[id];
    const columnFormatters = Object.fromEntries(
      Object.entries(current.columnFormatters).filter(([, formatter]) => {
        return formatter.kind !== "custom-ref" || formatter.formatterId !== id;
      }),
    );
    get().updateEditorSettings({ customColumnFormatters, columnFormatters });
  },
}));
