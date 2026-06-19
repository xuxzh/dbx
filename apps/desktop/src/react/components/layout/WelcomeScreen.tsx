import { FilePlus2, Plus, History, Download, Database, Search, ShieldCheck, Sparkles } from "lucide-react";
import { DatabaseIcon } from "@/react/components/ui/icons";
import { Button } from "@/react/components/ui/button";
import type { ConnectionConfig } from "@/types/database";

export interface WelcomeSavedSqlHistoryItem {
  id: string;
  name: string;
  connectionName: string;
  database?: string;
  folderName?: string;
  openCount?: number;
}

interface WelcomeScreenProps {
  connectionStats: { total: number; connected: number; types: number };
  recentConnections: ConnectionConfig[];
  savedSqlHistoryItems: WelcomeSavedSqlHistoryItem[];
  appVersion: string;
  hasConnections: boolean;
  onOpenConnectionQuery: (connectionId: string) => void;
  onOpenSavedSql: (fileId: string) => void;
  onNewConnection: () => void;
  onNewQuery: () => void;
  onShowHistory: () => void;
  onImportConfig: () => void;
  onOpenGithub: () => void;
  onOpenMcpGuide: () => void;
  t: (key: string) => string;
}

export function WelcomeScreen({
  connectionStats,
  recentConnections,
  savedSqlHistoryItems,
  appVersion,
  hasConnections,
  onOpenConnectionQuery,
  onOpenSavedSql,
  onNewConnection,
  onNewQuery,
  onShowHistory,
  onImportConfig,
  onOpenGithub,
  onOpenMcpGuide,
  t,
}: WelcomeScreenProps) {
  return (
    <div className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto bg-background">
      <div className="mx-auto flex min-h-full w-full min-w-0 max-w-5xl flex-col justify-center gap-6 px-8 py-10">
        {/* Stats Grid */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-lg border bg-muted/20 px-4 py-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Database className="h-3.5 w-3.5" />
              {t("welcome.connections")}
            </div>
            <div className="mt-2 text-2xl font-semibold">{connectionStats.total}</div>
          </div>
          <div className="rounded-lg border bg-muted/20 px-4 py-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5" />
              {t("welcome.connected")}
            </div>
            <div className="mt-2 text-2xl font-semibold">{connectionStats.connected}</div>
          </div>
          <div className="rounded-lg border bg-muted/20 px-4 py-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5" />
              {t("welcome.databaseTypes")}
            </div>
            <div className="mt-2 text-2xl font-semibold">{connectionStats.types}</div>
          </div>
        </div>

        {/* Quick Connections & Shortcuts */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          {/* Quick Connections */}
          <div className="rounded-lg border">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div className="text-sm font-medium">{t("welcome.quickConnections")}</div>
            </div>
            <div className="divide-y">
              {recentConnections.length > 0 ? (
                recentConnections.map((connection) => (
                  <button
                    key={connection.id}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/40"
                    onClick={() => onOpenConnectionQuery(connection.id)}
                  >
                    <DatabaseIcon dbType={connection.db_type} className="h-4 w-4" />
                    <span
                      className="h-5 w-1 rounded-full shrink-0"
                      style={{ backgroundColor: connection.color || "#9ca3af" }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{connection.name}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {connection.driver_label || connection.db_type}
                      </div>
                    </div>
                    <FilePlus2 className="h-4 w-4 text-muted-foreground" />
                  </button>
                ))
              ) : (
                <div className="px-4 py-8 text-sm text-muted-foreground">
                  {t("sidebar.noConnections")}
                </div>
              )}
            </div>
          </div>

          {/* Shortcuts */}
          <div className="rounded-lg border">
            <div className="border-b px-4 py-3">
              <div className="text-sm font-medium">{t("welcome.shortcuts")}</div>
            </div>
            <div className="grid gap-1 p-2">
              <button
                className="flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-muted/50"
                onClick={onNewConnection}
              >
                <Plus className="h-4 w-4" />
                {t("toolbar.newConnection")}
              </button>
              <button
                className="flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-muted/50 disabled:opacity-50"
                onClick={onNewQuery}
                disabled={!hasConnections}
              >
                <FilePlus2 className="h-4 w-4" />
                {t("toolbar.newQuery")}
              </button>
              <button
                className="flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-muted/50"
                onClick={onShowHistory}
              >
                <History className="h-4 w-4" />
                {t("history.title")}
              </button>
              <button
                className="flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-muted/50"
                onClick={onImportConfig}
              >
                <Download className="h-4 w-4" />
                {t("sidebar.import")}
              </button>
              <div className="mt-2 rounded-md bg-muted/30 px-3 py-2 text-xs leading-5 text-muted-foreground">
                <Search className="mr-1 inline h-3.5 w-3.5" />
                {t("welcome.tip")}
              </div>
            </div>
          </div>
        </div>

        {/* SQL History */}
        <div className="rounded-lg border">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <History className="h-4 w-4" />
              {t("welcome.sqlHistory")}
            </div>
          </div>
          <div className="divide-y">
            {savedSqlHistoryItems.length > 0 ? (
              savedSqlHistoryItems.map((item) => (
                <button
                  key={item.id}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/40"
                  onClick={() => onOpenSavedSql(item.id)}
                >
                  <History className="h-4 w-4 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{item.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      <span>{item.connectionName}</span>
                      {item.database && <span> · {item.database}</span>}
                      {item.folderName && <span> · {item.folderName}</span>}
                      {item.openCount && (
                        <span> · {t("welcome.sqlHistoryOpenCount", { count: item.openCount })}</span>
                      )}
                    </div>
                  </div>
                  <FilePlus2 className="h-4 w-4 text-muted-foreground" />
                </button>
              ))
            ) : (
              <div className="px-4 py-8 text-sm text-muted-foreground">
                {t("welcome.sqlHistoryEmpty")}
              </div>
            )}
          </div>
        </div>

        {/* MCP Integration Hint */}
        <div className="rounded-lg border bg-muted/10 px-5 py-4">
          <div className="flex items-start gap-3">
            <Sparkles className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
            <div className="min-w-0">
              <div className="text-sm font-medium">{t("welcome.mcpTitle")}</div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {t("welcome.mcpDescription")}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <code className="max-w-full break-all rounded bg-muted px-2 py-0.5 text-[11px] select-all">
                  npx @dbx-app/mcp-server
                </code>
                <button
                  className="text-xs text-primary hover:underline"
                  onClick={onOpenMcpGuide}
                >
                  {t("welcome.mcpLearnMore")}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Project Info */}
        <div className="mt-2 flex items-center justify-center gap-3 text-[11px] text-muted-foreground/60">
          <span>DBX {appVersion ? `v${appVersion}` : ""}</span>
          <span>·</span>
          <button className="hover:text-foreground transition-colors" onClick={onOpenGithub}>
            GitHub
          </button>
        </div>
      </div>
    </div>
  );
}
