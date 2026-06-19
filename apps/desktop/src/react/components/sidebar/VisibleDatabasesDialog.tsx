import { useState, useEffect, useCallback } from "react";
import { CheckSquare, Loader2, Search, Square } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/react/components/ui/dialog";
import { Button } from "@/react/components/ui/button";
import { Input } from "@/react/components/ui/input";
import { useConnectionStore } from "@/react/stores/connectionStore";
import { canSaveVisibleDatabaseSelection, filterDatabaseNamesForConnection, isSystemDatabaseName, normalizeVisibleDatabaseSelection } from "@/lib/visibleDatabases";
import * as api from "@/lib/api";

interface VisibleDatabasesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId: string;
  connectionName: string;
}

export function VisibleDatabasesDialog({
  open,
  onOpenChange,
  connectionId,
  connectionName,
}: VisibleDatabasesDialogProps) {
  const { t } = useTranslation();
  const connectionStore = useConnectionStore();

  const [databaseNames, setDatabaseNames] = useState<string[]>([]);
  const [selectedNames, setSelectedNames] = useState<Set<string>>(new Set());
  const [searchText, setSearchText] = useState("");
  const [showSystemDatabases, setShowSystemDatabases] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const connection = connectionStore.getConfig(connectionId);

  const listedDatabaseNames = showSystemDatabases
    ? databaseNames
    : filterDatabaseNamesForConnection(databaseNames, connection);

  const filteredDatabaseNames = searchText.trim()
    ? listedDatabaseNames.filter((name) =>
        name.toLowerCase().includes(searchText.trim().toLowerCase())
      )
    : listedDatabaseNames;

  const selectedCount = selectedNames.size;
  const totalCount = listedDatabaseNames.length;
  const canSaveSelection = canSaveVisibleDatabaseSelection([...selectedNames]);
  const hasSystemDatabases = databaseNames.some((database) =>
    isSystemDatabaseName(connection?.db_type, database)
  );

  const loadDatabases = useCallback(async () => {
    if (!open) return;
    setIsLoading(true);
    setErrorMessage("");
    setSearchText("");

    try {
      const names = await loadDatabaseNames();
      setDatabaseNames(names);
      const configured = connection?.visible_databases;
      const initialSelection = Array.isArray(configured)
        ? normalizeVisibleDatabaseSelection(configured, names)
        : filterDatabaseNamesForConnection(names, connection);
      setSelectedNames(new Set(initialSelection));
      setShowSystemDatabases(
        initialSelection.some((database) =>
          isSystemDatabaseName(connection?.db_type, database)
        )
      );
    } catch (e: any) {
      setDatabaseNames([]);
      setSelectedNames(new Set());
      setShowSystemDatabases(false);
      setErrorMessage(String(e?.message || e));
    } finally {
      setIsLoading(false);
    }
  }, [open, connection]);

  useEffect(() => {
    loadDatabases();
  }, [loadDatabases]);

  useEffect(() => {
    if (!showSystemDatabases) {
      setSelectedNames((prev) => {
        const next = new Set(
          [...prev].filter(
            (database) => !isSystemDatabaseName(connection?.db_type, database)
          )
        );
        return next;
      });
    }
  }, [showSystemDatabases, connection?.db_type]);

  async function loadDatabaseNames(): Promise<string[]> {
    if (!connection) throw new Error("No connection config");

    await connectionStore.ensureConnected(connectionId);
    if (connection.db_type === "oracle" || connection.db_type === "dameng") {
      return api.listSchemas(connectionId, connection.database || "");
    }
    if (connection.db_type === "redis") {
      const result = await api.redisListDatabases(connectionId);
      return result.map((database) => String(database.db));
    }
    if (connection.db_type === "mongodb") {
      return api.mongoListDatabases(connectionId);
    }
    const result = await api.listDatabases(connectionId);
    return result.map((database) => database.name);
  }

  function toggleDatabase(database: string) {
    setSelectedNames((prev) => {
      const next = new Set(prev);
      if (next.has(database)) next.delete(database);
      else next.add(database);
      return next;
    });
  }

  function selectAll() {
    setSelectedNames(new Set(listedDatabaseNames));
  }

  function selectFiltered() {
    setSelectedNames(new Set(filteredDatabaseNames));
  }

  function clearSelection() {
    setSelectedNames(new Set());
  }

  async function showAllDatabases() {
    await connectionStore.clearVisibleDatabases(connectionId);
    onOpenChange(false);
  }

  async function saveSelection() {
    if (!canSaveSelection) return;
    await connectionStore.setVisibleDatabases(connectionId, [...selectedNames]);
    onOpenChange(false);
  }

  const isSearching = searchText.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>{t("visibleDatabases.title")}</DialogTitle>
          <p className="text-sm text-muted-foreground">
            {t("visibleDatabases.description", { connection: connectionName })}
          </p>
        </DialogHeader>

        <div className="flex items-center gap-2 rounded-md border bg-background px-2">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <Input
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder={t("visibleDatabases.searchPlaceholder")}
            className="h-8 border-0 px-0 shadow-none focus-visible:ring-0"
            disabled={isLoading || !!errorMessage}
          />
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {t("visibleDatabases.selectedCount", {
              selected: selectedCount,
              total: totalCount,
            })}
          </span>
          <div className="flex items-center gap-2">
            <button
              className="hover:text-foreground disabled:opacity-50"
              disabled={isLoading}
              onClick={selectAll}
            >
              {t("visibleDatabases.selectAll")}
            </button>
            {isSearching && (
              <button
                className="hover:text-foreground disabled:opacity-50"
                disabled={isLoading}
                onClick={selectFiltered}
              >
                {t("visibleDatabases.selectFiltered")}
              </button>
            )}
            <button
              className="hover:text-foreground disabled:opacity-50"
              disabled={isLoading}
              onClick={clearSelection}
            >
              {t("visibleDatabases.clear")}
            </button>
            <button
              className="hover:text-foreground disabled:opacity-50"
              disabled={isLoading || !Array.isArray(connection?.visible_databases)}
              onClick={showAllDatabases}
            >
              {t("visibleDatabases.showAll")}
            </button>
          </div>
        </div>

        {!isLoading && !errorMessage && !canSaveSelection && (
          <p className="text-xs text-destructive">
            {t("visibleDatabases.emptySelection")}
          </p>
        )}

        {hasSystemDatabases && (
          <label className="flex h-8 items-center gap-2 rounded-md px-1 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={showSystemDatabases}
              onChange={(e) => setShowSystemDatabases(e.target.checked)}
              className="h-3.5 w-3.5 accent-primary"
              disabled={isLoading || !!errorMessage}
            />
            <span>{t("visibleDatabases.showSystemDatabases")}</span>
          </label>
        )}

        <div className="h-72 overflow-y-auto rounded-md border bg-background/50 p-1">
          {isLoading && (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("common.loading")}
            </div>
          )}
          {!isLoading && errorMessage && (
            <div className="p-3 text-sm text-destructive">
              {t("visibleDatabases.loadFailed", { message: errorMessage })}
            </div>
          )}
          {!isLoading && !errorMessage && filteredDatabaseNames.length === 0 && (
            <div className="p-3 text-sm text-muted-foreground">
              {t("grid.noSearchResults")}
            </div>
          )}
          {!isLoading && !errorMessage && filteredDatabaseNames.length > 0 && (
            <>
              {filteredDatabaseNames.map((database) => (
                <button
                  key={database}
                  type="button"
                  className="flex h-8 w-full min-w-0 items-center gap-2 rounded-sm px-2 text-left text-sm hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:outline-none"
                  onClick={() => toggleDatabase(database)}
                >
                  {selectedNames.has(database) ? (
                    <CheckSquare className="h-4 w-4 shrink-0 text-primary" />
                  ) : (
                    <Square className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="truncate">{database}</span>
                </button>
              ))}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("dangerDialog.cancel")}
          </Button>
          <Button
            disabled={isLoading || !!errorMessage || !canSaveSelection}
            onClick={saveSelection}
          >
            {t("visibleDatabases.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
