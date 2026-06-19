import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Copy,
  Database,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/react/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/react/components/ui/dialog";
import { useHistoryStore } from "@/react/stores/historyStore";
import { useToast } from "@/react/hooks/useToast";
import { resolveHistoryActivityKind } from "@/lib/historyActivityKind";
import { canRollbackHistoryEntry } from "@/lib/historyAiAnalysis";
import type { HistoryEntry } from "@/lib/api";
import { copyToClipboard } from "@/lib/clipboard";
import * as api from "@/lib/api";

interface QueryHistoryProps {
  onRestore: (sql: string, entry: HistoryEntry) => void;
  onAnalyzeAi: (entry: HistoryEntry) => void;
  onClose: () => void;
  t: (key: string) => string;
  highlightSql?: (sql: string) => string;
}

type HistoryFilter = "all" | "query" | "data_change" | "schema_change" | "failed";

const FILTERS: HistoryFilter[] = ["all", "query", "data_change", "schema_change", "failed"];

const HISTORY_ROW_HEIGHT = 72;
const HISTORY_SCROLL_BUFFER = 100;

export function QueryHistory({
  onRestore,
  onAnalyzeAi,
  onClose,
  t,
  highlightSql,
}: QueryHistoryProps) {
  const store = useHistoryStore();
  const { toast } = useToast();

  const [searchText, setSearchText] = useState("");
  const [activeFilter, setActiveFilter] = useState<HistoryFilter>("all");
  const [selectedEntry, setSelectedEntry] = useState<HistoryEntry | null>(null);
  const [isRollingBack, setIsRollingBack] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  useEffect(() => {
    store.load();
  }, [store]);

  const filtered = useMemo(() => {
    const q = searchText.toLowerCase();
    return store.entries.filter((entry) => {
      if (activeFilter === "failed" && entry.success) return false;
      if (
        activeFilter !== "all" &&
        activeFilter !== "failed" &&
        activityKind(entry) !== activeFilter
      ) {
        return false;
      }
      if (!q) return true;
      return [entry.sql, entry.connection_name, entry.database, entry.operation, entry.target]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q));
    });
  }, [store.entries, searchText, activeFilter]);

  function activityKind(entry: HistoryEntry) {
    return resolveHistoryActivityKind(entry);
  }

  const restore = useCallback(
    (entry: HistoryEntry) => {
      onRestore(entry.sql, entry);
      setSelectedEntry(null);
    },
    [onRestore]
  );

  const copyText = useCallback(
    async (text: string) => {
      try {
        await copyToClipboard(text);
        toast(t("grid.copied"));
      } catch (e: any) {
        toast(t("grid.copyFailed", { message: e?.message || String(e) }), 5000);
      }
    },
    [toast, t]
  );

  const confirmDeleteEntry = useCallback((id: string) => {
    setDeleteTargetId(id);
    setShowDeleteConfirm(true);
  }, []);

  const executeDelete = useCallback(() => {
    if (deleteTargetId) {
      store.remove(deleteTargetId);
      setDeleteTargetId(null);
    }
    setShowDeleteConfirm(false);
  }, [deleteTargetId, store]);

  const confirmClearHistory = useCallback(() => {
    if (store.entries.length > 0) {
      setShowClearConfirm(true);
    }
  }, [store.entries.length]);

  const executeClear = useCallback(() => {
    store.clear();
    setShowClearConfirm(false);
  }, [store]);

  const formatTime = useCallback((iso: string): string => {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
      d.getMinutes()
    )}`;
  }, []);

  const formatFullTime = useCallback((iso: string): string => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
  }, []);

  const truncateSql = useCallback((sql: string): string => {
    const line = sql.replace(/\s+/g, " ").trim();
    return line.length > 120 ? line.slice(0, 120) + "..." : line;
  }, []);

  const entryTitle = useCallback((entry: HistoryEntry) => {
    return entry.target || entry.operation || truncateSql(entry.sql);
  }, [truncateSql]);

  const entrySubtitle = useCallback((entry: HistoryEntry) => {
    if (activityKind(entry) === "query") return truncateSql(entry.sql);
    return truncateSql(entry.sql || entry.target || entry.operation || "");
  }, [activityKind, truncateSql]);

  const filterLabel = useCallback(
    (filter: HistoryFilter) => t(`history.filters.${filter}`),
    [t]
  );

  const kindLabel = useCallback(
    (entry: HistoryEntry) => t(`history.kinds.${activityKind(entry)}`),
    [t, activityKind]
  );

  const kindShortLabel = useCallback(
    (entry: HistoryEntry) => t(`history.kindShort.${activityKind(entry)}`),
    [t, activityKind]
  );

  const detailsRows = useCallback(
    (entry: HistoryEntry) => {
      const rows: [string, string][] = [
        [t("history.detail.kind"), kindLabel(entry)],
        [t("history.detail.operation"), entry.operation || "-"],
        [t("history.detail.connection"), entry.connection_name || "-"],
        [t("history.detail.database"), entry.database || "-"],
        [t("history.detail.target"), entry.target || "-"],
        [t("history.detail.time"), formatFullTime(entry.executed_at)],
        [t("history.detail.duration"), `${entry.execution_time_ms}ms`],
        [
          t("history.detail.affectedRows"),
          entry.affected_rows != null ? String(entry.affected_rows) : "-",
        ],
        [
          t("history.detail.rollback"),
          canRollbackHistoryEntry(entry)
            ? t("history.rollbackAvailable")
            : t("history.rollbackUnavailable"),
        ],
        [
          t("history.detail.status"),
          entry.success ? t("history.success") : t("history.failed"),
        ],
      ];
      if (entry.error) rows.push([t("history.detail.error"), entry.error]);
      return rows;
    },
    [t, kindLabel, formatFullTime]
  );

  const rollback = useCallback(
    async (entry: HistoryEntry) => {
      if (!canRollbackHistoryEntry(entry) || isRollingBack) return;
      if (!window.confirm(t("history.rollbackConfirm"))) return;

      const connectionId = entry.connection_id!;
      const rollbackSql = entry.rollback_sql!;
      setIsRollingBack(true);
      const start = Date.now();
      try {
        const result = await api.executeScript(
          connectionId,
          entry.database,
          rollbackSql
        );
        await store.add({
          connection_id: connectionId,
          connection_name: entry.connection_name,
          database: entry.database,
          sql: rollbackSql,
          execution_time_ms: Date.now() - start,
          success: true,
          activity_kind: "data_change",
          operation: "ROLLBACK",
          target: entry.target,
          affected_rows: result.affected_rows,
          details_json: JSON.stringify({ rollback_of: entry.id }),
        });
        toast(t("history.rollbackSuccess"));
        setSelectedEntry(null);
      } catch (e: any) {
        toast(t("history.rollbackFailed", { message: e?.message || String(e) }), 5000);
      } finally {
        setIsRollingBack(false);
      }
    },
    [isRollingBack, store, toast, t]
  );

  const getContextMenuItems = useCallback(
    (entry: HistoryEntry) => [
      {
        label: t("history.viewDetails"),
        action: () => setSelectedEntry(entry),
      },
      { label: t("history.restore"), action: () => restore(entry) },
      { label: t("history.analyzeWithAi"), action: () => onAnalyzeAi(entry) },
      { label: t("history.copy"), action: () => copyText(entry.sql) },
      ...(canRollbackHistoryEntry(entry)
        ? [{ label: t("history.rollback"), action: () => rollback(entry) }]
        : []),
      {
        label: t("history.delete"),
        action: () => confirmDeleteEntry(entry.id),
        variant: "destructive" as const,
      },
    ],
    [t, restore, onAnalyzeAi, copyText, rollback, confirmDeleteEntry]
  );

  return (
    <div className="h-full flex flex-col overflow-hidden border-l">
      {/* Header */}
      <div className="h-9 flex items-center gap-1 px-2 border-b shrink-0 bg-muted/20">
        <span className="text-xs font-medium">{t("history.title")}</span>
        <span className="flex-1" />
        {store.entries.length > 0 && (
          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={confirmClearHistory}>
            <Trash2 className="h-3 w-3" />
          </Button>
        )}
        <Button variant="ghost" size="icon" className="h-5 w-5" onClick={onClose}>
          <X className="h-3 w-3" />
        </Button>
      </div>

      {/* Filters */}
      <div className="border-b shrink-0">
        <div className="flex gap-1 overflow-x-auto px-2 pt-2">
          {FILTERS.map((filter) => (
            <button
              key={filter}
              type="button"
              className={`h-6 shrink-0 rounded border px-2 text-xs ${
                activeFilter === filter
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-background"
              }`}
              onClick={() => setActiveFilter(filter)}
            >
              {filterLabel(filter)}
            </button>
          ))}
        </div>
        <div className="relative flex items-center px-2 py-1">
          <Search className="absolute left-3 w-3 h-3 text-muted-foreground pointer-events-none" />
          <input
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            autocapitalize="off"
            autocorrect="off"
            spellcheck={false}
            className="flex-1 h-5 text-xs bg-transparent border rounded pl-5 pr-1 outline-none placeholder:text-muted-foreground"
            placeholder={t("history.search")}
          />
        </div>
      </div>

      {/* List */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {filtered.length > 0 ? (
          <div className="py-1">
            {filtered.map((entry) => (
              <div
                key={entry.id}
                className="h-[72px] cursor-pointer border-b border-border/50 px-3 py-2 text-xs hover:bg-accent/50"
                onClick={() => setSelectedEntry(entry)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  // Context menu would be shown here
                  setSelectedEntry(entry);
                }}
              >
                <div className="mb-0.5 flex items-center gap-1">
                  <span className="inline-flex h-5 w-9 shrink-0 items-center justify-center rounded border px-1 text-[10px] leading-none text-muted-foreground">
                    {kindShortLabel(entry)}
                  </span>
                  <span className="truncate font-medium">{entryTitle(entry)}</span>
                  <span className="ml-auto shrink-0 text-muted-foreground">
                    {formatTime(entry.executed_at)}
                  </span>
                </div>
                <div className="truncate font-mono text-muted-foreground">
                  {entrySubtitle(entry)}
                </div>
                <div className="mt-0.5 flex items-center gap-2">
                  <span className="inline-flex min-w-0 items-center gap-1 text-muted-foreground">
                    <Database className="h-3 w-3 shrink-0" />
                    <span className="truncate">
                      {entry.connection_name}
                      {entry.database && ` / ${entry.database}`}
                    </span>
                  </span>
                  <span
                    className={`ml-auto shrink-0 ${
                      entry.success ? "text-green-500" : "text-red-500"
                    }`}
                  >
                    {entry.success
                      ? `${entry.execution_time_ms}ms`
                      : t("history.failed")}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-3 py-8 text-center text-muted-foreground text-xs">
            {t("history.empty")}
          </div>
        )}
      </div>

      {/* Detail Dialog */}
      <Dialog open={!!selectedEntry} onOpenChange={(value) => !value && setSelectedEntry(null)}>
        <DialogContent className="sm:max-w-2xl duration-75 max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {selectedEntry ? entryTitle(selectedEntry) : t("history.viewDetails")}
            </DialogTitle>
          </DialogHeader>
          {selectedEntry && (
            <div className="space-y-4">
              <div className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-2 text-sm">
                {detailsRows(selectedEntry).map(([label, value]) => (
                  <div key={label} className="flex gap-2">
                    <div className="text-muted-foreground">{label}</div>
                    <div className="min-w-0 break-words">{value}</div>
                  </div>
                ))}
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <div className="text-sm font-medium">SQL</div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7"
                    onClick={() => copyText(selectedEntry.sql)}
                  >
                    <Copy className="h-3.5 w-3.5" />
                    {t("history.copy")}
                  </Button>
                </div>
                <pre
                  className="max-h-48 overflow-auto rounded border bg-muted/30 p-3 text-xs"
                  dangerouslySetInnerHTML={{
                    __html: highlightSql ? highlightSql(selectedEntry.sql) : selectedEntry.sql,
                  }}
                />
              </div>
              {selectedEntry.rollback_sql && (
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <div className="text-sm font-medium">{t("history.rollbackSql")}</div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7"
                      onClick={() => copyText(selectedEntry.rollback_sql || "")}
                    >
                      <Copy className="h-3.5 w-3.5" />
                      {t("history.copy")}
                    </Button>
                  </div>
                  <pre
                    className="max-h-40 overflow-auto rounded border bg-muted/30 p-3 text-xs"
                    dangerouslySetInnerHTML={{
                      __html: highlightSql
                        ? highlightSql(selectedEntry.rollback_sql || "")
                        : selectedEntry.rollback_sql || "",
                    }}
                  />
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => selectedEntry && onAnalyzeAi(selectedEntry)}>
              <Sparkles className="h-4 w-4" />
              {t("history.analyzeWithAi")}
            </Button>
            <Button variant="outline" onClick={() => selectedEntry && restore(selectedEntry)}>
              {t("history.restore")}
            </Button>
            {selectedEntry && canRollbackHistoryEntry(selectedEntry) && (
              <Button
                variant="outline"
                disabled={isRollingBack}
                onClick={() => rollback(selectedEntry)}
              >
                <RotateCcw className="h-4 w-4" />
                {isRollingBack ? t("common.loading") : t("history.rollback")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>{t("history.delete")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t("history.confirmDelete")}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteConfirm(false)}>
              {t("dangerDialog.cancel")}
            </Button>
            <Button variant="destructive" onClick={executeDelete}>
              {t("dangerDialog.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Clear Confirm Dialog */}
      <Dialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>{t("history.clear")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t("history.confirmClear")}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowClearConfirm(false)}>
              {t("dangerDialog.cancel")}
            </Button>
            <Button variant="destructive" onClick={executeClear}>
              {t("dangerDialog.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
