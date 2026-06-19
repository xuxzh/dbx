import { Play, Loader2, Square, Database, Check, Table2, AlignLeft, GitBranch, Save, FolderOpen, Layers, X, Shield, Upload } from "lucide-react";
import { Button } from "@/react/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/react/components/ui/tooltip";
import type { QueryTab, ConnectionConfig } from "@/types/database";

interface EditorToolbarProps {
  activeTab: QueryTab;
  activeConnection?: ConnectionConfig;
  executableSql: string;
  explainMode?: "explain" | "autotrace";
  blockDangerousRedisCommands?: boolean;
  onExecute: () => void;
  onCancel: () => void;
  onExplain: () => void;
  onFormatSql: () => void;
  onSaveSql: () => void;
  onOpenSql: () => void;
  onImportResultArchive: () => void;
  onChangeConnection: (connectionId: string) => void;
  onChangeDatabase: (database: string) => void;
  onChangeSchema: (schema: string | undefined) => void;
  onSetDefaultDatabase: () => void;
  onClearDefaultDatabase: () => void;
  t: (key: string) => string;
}

export function EditorToolbar({
  activeTab,
  activeConnection,
  executableSql,
  explainMode,
  blockDangerousRedisCommands = true,
  onExecute,
  onCancel,
  onExplain,
  onFormatSql,
  onSaveSql,
  onOpenSql,
  onImportResultArchive,
  onChangeConnection,
  onChangeDatabase,
  onChangeSchema,
  onSetDefaultDatabase,
  onClearDefaultDatabase,
  t,
}: EditorToolbarProps) {
  const supportsExplain = activeConnection
    ? !["redis", "mongodb", "elasticsearch", "etcd"].includes(activeConnection.db_type)
    : false;

  const toolbarStyle = activeConnection?.color
    ? {
        backgroundColor: `color-mix(in oklch, ${activeConnection.color} 10%, transparent)`,
        boxShadow: `inset 0 1px 0 color-mix(in oklch, ${activeConnection.color} 18%, transparent)`,
      }
    : undefined;

  return (
    <div
      className="h-9 shrink-0 border-b bg-background/80 px-3 flex items-center gap-1 text-xs text-muted-foreground relative z-10"
      style={toolbarStyle}
    >
      <div className="flex items-center gap-0.5">
        {/* Execute / Cancel */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={activeTab.isExecuting ? "destructive" : "ghost"}
              size="icon"
              className={`h-6 w-6 ${
                !activeTab.isExecuting
                  ? "bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 hover:text-emerald-800 dark:text-emerald-300 dark:hover:text-emerald-200"
                  : ""
              }`}
              disabled={
                (activeTab.isCancelling || activeTab.isExplaining ||
                  (!activeTab.isExecuting && !executableSql.trim()))
              }
              onClick={activeTab.isExecuting ? onCancel : onExecute}
            >
              {activeTab.isCancelling ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : activeTab.isExecuting ? (
                <Square className="h-3.5 w-3.5 fill-current" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {activeTab.isExecuting ? t("toolbar.stopQuery") : t("toolbar.executeShortcut")}
          </TooltipContent>
        </Tooltip>

        {/* Explain */}
        {supportsExplain && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={activeTab.isExplaining ? "destructive" : "ghost"}
                size="icon"
                className={`h-6 w-6 ${
                  !activeTab.isExplaining
                    ? "text-violet-600 hover:bg-violet-500/10 hover:text-violet-700 dark:text-violet-300 dark:hover:text-violet-200"
                    : ""
                }`}
                disabled={
                  activeTab.isExecuting || (!activeTab.isExplaining && !executableSql.trim())
                }
                onClick={activeTab.isExplaining ? onCancel : onExplain}
              >
                {activeTab.isExplaining ? (
                  <Square className="h-3.5 w-3.5 fill-current" />
                ) : (
                  <GitBranch className="h-3.5 w-3.5" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {activeTab.isExplaining ? t("toolbar.stopExplain") : t("toolbar.explainPlan")}
            </TooltipContent>
          </Tooltip>
        )}

        {/* Format SQL */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-amber-600 hover:bg-amber-500/10 hover:text-amber-700 dark:text-amber-300 dark:hover:text-amber-200"
              disabled={activeTab.isExecuting || activeTab.isExplaining || !activeTab.sql.trim()}
              onClick={onFormatSql}
            >
              <AlignLeft className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("toolbar.formatSql")}</TooltipContent>
        </Tooltip>

        {/* Save SQL */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-blue-600 hover:bg-blue-500/10 hover:text-blue-700 dark:text-blue-300 dark:hover:text-blue-200"
              disabled={!activeTab.sql.trim()}
              onClick={onSaveSql}
            >
              <Save className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("toolbar.saveSql")}</TooltipContent>
        </Tooltip>

        {/* Open SQL */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-sky-600 hover:bg-sky-500/10 hover:text-sky-700 dark:text-sky-300 dark:hover:text-sky-200"
              onClick={onOpenSql}
            >
              <FolderOpen className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("toolbar.openSql")}</TooltipContent>
        </Tooltip>
      </div>

      <span className="flex-1 min-w-0" />

      {/* Connection selector placeholder */}
      <div className="flex items-center gap-1">
        {activeConnection && (
          <span
            className="h-4 w-1 rounded-full shrink-0"
            style={{ backgroundColor: activeConnection.color }}
          />
        )}
        <span className="text-foreground font-medium">
          {activeConnection?.name || t("editor.selectConnection")}
        </span>
      </div>
    </div>
  );
}
