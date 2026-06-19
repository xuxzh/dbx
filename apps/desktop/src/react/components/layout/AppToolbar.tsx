import { useState, useEffect, useRef, useMemo } from "react";
import {
  DatabaseZap,
  FilePlus2,
  Loader2,
  Moon,
  Sun,
  SunMoon,
  History,
  Bot,
  ArrowLeftRight,
  FileCode,
  BookMarked,
  GitCompareArrows,
  TableProperties,
  Settings,
  CloudDownload,
  Package,
  FileDown,
} from "lucide-react";
import { Button } from "@/react/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/react/components/ui/tooltip";
import { WindowControls } from "./WindowControls";
import type { AppThemeMode } from "@/lib/appTheme";

interface AppToolbarProps {
  isDark: boolean;
  themeMode: AppThemeMode;
  showAiPanel: boolean;
  showHistory: boolean;
  showSqlLibrary: boolean;
  showDriverStore: boolean;
  checkingUpdates: boolean;
  hasUpdateAvailable: boolean;
  agentDriverUpdateCount: number;
  hasConnections: boolean;
  hasSqlFileConnections: boolean;
  // Window controls
  isMaximized: boolean;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
  // Actions
  onNewConnection: () => void;
  onNewQuery: () => void;
  onSetThemeMode: (mode: AppThemeMode) => void;
  onToggleAi: () => void;
  onToggleHistory: () => void;
  onToggleSqlLibrary: () => void;
  onOpenGithub: () => void;
  onOpenSettings: () => void;
  onOpenDriverStore: () => void;
  onCheckUpdates: () => void;
  onOpenTransfer: () => void;
  onOpenSqlFile: () => void;
  onOpenSchemaDiff: () => void;
  onOpenDataCompare: () => void;
  t: (key: string) => string;
}

// Placeholder - full implementation needs settingsStore.editorSettings.toolbarItems
const DEFAULT_TOOLBAR_ITEMS = {
  dataTransfer: true,
  driverManager: true,
  sqlLibrary: true,
  history: true,
  ai: true,
  theme: true,
  github: true,
  checkUpdates: true,
  sqlFile: true,
  schemaDiff: true,
  dataCompare: true,
};

export function AppToolbar({
  isDark,
  themeMode,
  showAiPanel,
  showHistory,
  showSqlLibrary,
  showDriverStore,
  checkingUpdates,
  hasUpdateAvailable,
  agentDriverUpdateCount,
  hasConnections,
  hasSqlFileConnections,
  isMaximized,
  onMinimize,
  onToggleMaximize,
  onClose,
  onNewConnection,
  onNewQuery,
  onSetThemeMode,
  onToggleAi,
  onToggleHistory,
  onToggleSqlLibrary,
  onOpenGithub,
  onOpenSettings,
  onOpenDriverStore,
  onCheckUpdates,
  onOpenTransfer,
  onOpenSqlFile,
  onOpenSchemaDiff,
  onOpenDataCompare,
  t,
}: AppToolbarProps) {
  const toolbarItems = DEFAULT_TOOLBAR_ITEMS;

  const themeItems = useMemo(
    () => [
      { value: "light", label: t("toolbar.themeLight"), icon: Sun },
      { value: "dark", label: t("toolbar.themeDark"), icon: Moon },
      { value: "system", label: t("toolbar.themeSystem"), icon: SunMoon },
    ],
    [t]
  );

  const themeTriggerIcon = useMemo(() => {
    if (themeMode === "system") return SunMoon;
    return isDark ? Moon : Sun;
  }, [themeMode, isDark]);

  const showControls = true; // TODO: useWindowControls hook

  return (
    <div className="h-10 flex items-center gap-1 px-2 border-b bg-muted/30 shrink-0 overflow-hidden">
      <Button
        variant="ghost"
        size="sm"
        className="h-8 px-2 text-xs gap-1"
        onClick={onNewConnection}
      >
        <DatabaseZap className="h-3.5 w-3.5" />
        {t("toolbar.newConnection")}
      </Button>

      <Button
        variant="ghost"
        size="sm"
        className="h-8 px-2 text-xs gap-1"
        onClick={onNewQuery}
        disabled={!hasConnections}
      >
        <FilePlus2 className="h-3.5 w-3.5" />
        {t("toolbar.newQuery")}
      </Button>

      {/* Placeholder for dataTransfer button */}
      {toolbarItems.dataTransfer && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-xs gap-1"
          onClick={onOpenTransfer}
          disabled={!hasConnections}
        >
          <ArrowLeftRight className="h-3.5 w-3.5" />
          {t("transfer.dataTransfer")}
        </Button>
      )}

      {/* Placeholder for driverManager button */}
      {toolbarItems.driverManager && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-xs gap-1"
          onClick={onOpenDriverStore}
        >
          <Package className="h-3.5 w-3.5" />
          {t("toolbar.driverManager")}
          {agentDriverUpdateCount > 0 && (
            <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium leading-none text-white">
              {agentDriverUpdateCount > 99 ? "99+" : agentDriverUpdateCount}
            </span>
          )}
        </Button>
      )}

      <div className="flex-1" />

      {/* Right-side items */}
      <div className="flex items-center gap-1 overflow-hidden">
        {toolbarItems.checkUpdates && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="relative h-8 w-8 shrink-0"
                disabled={checkingUpdates}
                onClick={onCheckUpdates}
              >
                {checkingUpdates ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CloudDownload className="h-4 w-4" />
                )}
                {hasUpdateAvailable && (
                  <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-red-500 ring-2 ring-background" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("updates.check")}</TooltipContent>
          </Tooltip>
        )}

        {toolbarItems.sqlLibrary && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={`h-8 w-8 shrink-0 ${showSqlLibrary ? "bg-accent" : ""}`}
                onClick={onToggleSqlLibrary}
              >
                <BookMarked className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("sqlLibrary.title")}</TooltipContent>
          </Tooltip>
        )}

        {toolbarItems.history && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={`h-8 w-8 shrink-0 ${showHistory ? "bg-accent" : ""}`}
                onClick={onToggleHistory}
              >
                <History className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("history.title")}</TooltipContent>
          </Tooltip>
        )}

        {toolbarItems.ai && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={`h-8 w-8 shrink-0 ${showAiPanel ? "bg-accent" : ""}`}
                onClick={onToggleAi}
              >
                <Bot className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>AI</TooltipContent>
          </Tooltip>
        )}

        {toolbarItems.theme && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => {
                    const next =
                      themeMode === "light" ? "dark" : themeMode === "dark" ? "system" : "light";
                    onSetThemeMode(next);
                  }}
                >
                  {themeTriggerIcon === SunMoon ? (
                    <SunMoon className="h-4 w-4" />
                  ) : themeTriggerIcon === Moon ? (
                    <Moon className="h-4 w-4" />
                  ) : (
                    <Sun className="h-4 w-4" />
                  )}
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>{t("toolbar.theme")}</TooltipContent>
          </Tooltip>
        )}

        {toolbarItems.github && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onOpenGithub}>
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.438 9.8 8.205 11.387.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.09-.745.083-.729.083-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 21.795 24 17.295 24 12 24 5.37 18.627 0 12 0z" />
                </svg>
              </Button>
            </TooltipTrigger>
            <TooltipContent>GitHub</TooltipContent>
          </Tooltip>
        )}
      </div>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onOpenSettings}>
            <Settings className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("settings.title")}</TooltipContent>
      </Tooltip>

      {showControls && (
        <WindowControls
          isMaximized={isMaximized}
          onMinimize={onMinimize}
          onToggleMaximize={onToggleMaximize}
          onClose={onClose}
        />
      )}
    </div>
  );
}
