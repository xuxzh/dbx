import { create } from 'zustand';
import { uuid } from "@/lib/utils";
import { markRaw } from "vue";
import type { DatabaseType, QueryResult, QueryTab } from "@/types/database";
import { orderPinnedFirst } from "@/lib/pinnedItems";
import { canCancelQueryExecution } from "@/lib/queryExecutionState";
import { closeAllTabsState, closeOtherTabsState } from "@/lib/tabCloseActions";
import { buildExplainSql, parseExplainResult, parseDamengExplainText } from "@/lib/explainPlan";
import { allEditableColumnsWriteable, allPrimaryKeysPresent, sourceColumnsForResult, type EditableQueryInfo } from "@/lib/sqlAnalysis";
import { restoreOpenTabsState, serializeOpenTabs } from "@/lib/openTabsPersistence";
import {
  evaluateMongoAggregateSafety,
  mongoCountToQueryResult,
  mongoDocumentsToQueryResult,
  mongoIndexesToQueryResult,
  mongoWriteToQueryResult,
  parseMongoAggregateCommand,
  parseMongoCountDocumentsCommand,
  parseMongoFindCommand,
  parseMongoGetIndexesCommand,
  parseMongoWriteCommand,
  type MongoAggregateSafetyOptions,
} from "@/lib/mongoShellCommand";
import { redisCommandResultToQueryResult } from "@/lib/redisQueryResult";
import { nextRedisCommandDb } from "@/lib/redisCommandSession";
import { isRedisMutatingCommand } from "@/lib/redisCommandTable";
import { supportsDatabaseFeature } from "@/lib/databaseCapabilities";
import { editablePrimaryKeys } from "@/lib/tableEditing";
import { TABLE_DATA_EXPORT_PAGE_SIZE } from "@/lib/tableDataExport";
import { tableMetaForDataTab } from "@/lib/tableDataTabMeta";
import { quoteTableIdentifier } from "@/lib/tableSelectSql";
import { connectionUsesDatabaseObjectTreeMode, connectionUsesSchemaExecutionContext, effectiveDatabaseTypeForConnection } from "@/lib/jdbcDialect";
import { queryTimeoutSecsForConnection } from "@/lib/queryTimeout";
import { clearDataGridPendingSnapshotsForTab } from "@/composables/useDataGridEditor";
import { buildTabResultSnapshot, deleteTabResultSnapshot, readTabResultSnapshot, tabResultCacheKey, writeTabResultSnapshot } from "@/lib/tabResultCache";
import { decodeQueryResultArchive, encodeQueryResultArchive, type DecodedQueryResultArchive } from "@/lib/queryResultArchive";
import * as api from "@/lib/api";
import { useConnectionStore } from "./connectionStore";
import { useSettingsStore } from "./settingsStore";
import type { SavedSqlFile } from "@/types/database";

const STORAGE_KEY = "dbx-open-tabs";
const ACTIVE_TAB_KEY = "dbx-active-tab";
const ORACLE_LIKE_METADATA_TYPES = new Set<string>(["oracle", "dameng", "oceanbase-oracle"]);
const MAX_CACHED_RESULTS = 5;

function markQueryResultRowsRaw(result: QueryResult): QueryResult {
  markRaw(result.rows);
  return result;
}

function markQueryResultsRowsRaw(results: QueryResult[]): QueryResult[] {
  for (const result of results) markQueryResultRowsRaw(result);
  return results;
}

function markQueryResultRunsRowsRaw(resultRuns: NonNullable<QueryTab["resultRuns"]>): NonNullable<QueryTab["resultRuns"]> {
  for (const run of resultRuns) {
    if (run.result) markQueryResultRowsRaw(run.result);
    if (run.results) markQueryResultsRowsRaw(run.results);
  }
  return resultRuns;
}

async function withFrontendQueryTimeout<T>(promise: Promise<T>, timeoutSecs: number, _message: string): Promise<T> {
  if (timeoutSecs === 0) return promise;

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Query timeout after ${timeoutSecs}s`)), timeoutSecs * 1000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function normalizeOracleLikeMetadataIdentifier(dbType: string, identifier: string | undefined, quoted?: boolean) {
  if (!identifier || quoted || !ORACLE_LIKE_METADATA_TYPES.has(dbType)) return identifier;
  return identifier.toUpperCase();
}

function normalizeOracleLikeQueryAnalysis(dbType: string, analysis: EditableQueryInfo, schema: string | undefined, tableName: string): EditableQueryInfo {
  if (!ORACLE_LIKE_METADATA_TYPES.has(dbType)) return analysis;
  return {
    ...analysis,
    schema,
    tableName,
    columns: analysis.columns.map((column) => ({
      ...column,
      sourceName: normalizeOracleLikeMetadataIdentifier(dbType, column.sourceName, column.sourceNameQuoted),
    })),
  };
}

function saveTabs(tabs: QueryTab[], activeTabId: string | null) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeOpenTabs(tabs)));
    localStorage.setItem(ACTIVE_TAB_KEY, activeTabId || "");
  } catch {}
}

function loadSavedTabs(): { tabs: QueryTab[]; activeTabId: string | null } {
  try {
    return restoreOpenTabsState(localStorage.getItem(STORAGE_KEY), localStorage.getItem(ACTIVE_TAB_KEY));
  } catch {
    return { tabs: [], activeTabId: null };
  }
}

// Simple identity function for i18n - actual i18n integration happens at component level
function getI18nT() {
  return (key: string) => key;
}

export interface QueryStoreState {
  tabs: QueryTab[];
  activeTabId: string | null;
  showCloseConfirm: boolean;
  pendingCloseTabId: string | null;
  tableStructureRefreshVersions: Record<string, number>;
  createTab: (connectionId: string, database: string, title?: string, mode?: QueryTab["mode"], schema?: string) => string;
  closeTab: (id: string, options?: { force?: boolean }) => void;
  forceClosePendingTab: () => void;
  cancelClosePendingTab: () => void;
  saveAndClosePendingTab: () => string | null;
  isTabDirty: (tab: QueryTab) => boolean;
  markTabClean: (tab: QueryTab | undefined) => void;
  closeOtherTabs: (id: string) => void;
  closeAllTabs: () => void;
  duplicateTab: (id: string) => void;
  closeConnectionTabs: (connectionId: string) => void;
  closeDatabaseTabs: (connectionId: string, database: string) => void;
  releaseConnectionTabs: (connectionId: string) => void;
  releaseDatabaseTabs: (connectionId: string, database: string) => void;
  updateSql: (id: string, sql: string) => void;
  updateEditorViewport: (id: string, viewport: { scrollTop: number; scrollLeft: number }) => void;
  updateEditorSelection: (id: string, selection: { anchor: number; head: number }) => void;
  renameTab: (id: string, title: string) => boolean;
  openObjectBrowser: (connectionId: string, database: string, schema?: string) => string;
  openUserAdmin: (connectionId: string) => string;
  openMqAdmin: (connectionId: string, target?: { tenant?: string }) => string;
  openTableStructure: (connectionId: string, database: string, schema?: string, tableName?: string) => string;
  linkSavedSql: (id: string, savedSqlId: string, title?: string) => void;
  openSavedSql: (file: SavedSqlFile) => string;
  togglePinnedTab: (id: string) => void;
  reorderTab: (id: string, targetId: string, position: "before" | "after") => void;
  updateDatabase: (id: string, database: string) => void;
  updateSchema: (id: string, schema: string | undefined) => void;
  updateConnection: (id: string, connectionId: string, database?: string) => void;
  setTableMeta: (id: string, meta: NonNullable<QueryTab["tableMeta"]>) => void;
  invalidateTableStructure: (connectionId: string, database: string, schema: string | undefined, tableName: string) => void;
  tableStructureRefreshVersion: (connectionId: string, database: string, schema: string | undefined, tableName: string) => number;
  setObjectSource: (id: string, objectSource: NonNullable<QueryTab["objectSource"]>) => void;
  setExecuting: (id: string, isExecuting: boolean) => void;
  setExecutingWithId: (id: string, executionId: string) => void;
  setErrorResult: (id: string, e: any) => void;
  setActiveResultRun: (id: string, runId: string) => boolean;
  removeResultRun: (id: string, runId: string) => boolean;
  setActiveResultIndex: (id: string, index: number) => void;
  executeCurrentTab: () => Promise<void>;
  executeCurrentSql: (sql: string, options?: { skipRedisSafetyCheck?: boolean }) => Promise<void>;
  executeTabSql: (id: string, sql: string, options?: {
    resultBaseSql?: string;
    resultSortedSql?: string | undefined;
    pagination?: { limit: number; offset: number; sessionId?: string };
    mongoSafety?: MongoAggregateSafetyOptions;
    preserveResultDuringExecution?: boolean;
    preserveTotalRowCountDuringExecution?: boolean;
    skipRedisSafetyCheck?: boolean;
  }) => Promise<void>;
  explainTabSql: (id: string, sql: string, databaseType?: DatabaseType, explainMode?: string) => Promise<{ ok: boolean; reason?: string; sql?: string }>;
  cancelTabExecution: (id: string) => Promise<boolean>;
  cancelTabExplain: (id: string) => Promise<boolean>;
  reloadEvictedTab: (id: string) => Promise<void>;
  exportResultArchive: (id: string) => Promise<Uint8Array | undefined>;
  importResultArchive: (bytes: Uint8Array | ArrayBuffer) => Promise<string | undefined>;
  fetchTabResultForExport: (id: string) => Promise<QueryResult | undefined>;
  notifyConnectionMayBeLost: () => void;
}

export const useQueryStore = create<QueryStoreState>((set, get) => {
  const t = getI18nT();
  const restored = loadSavedTabs();
  const tableStructureRefreshVersions: Record<string, number> = {};

  // Initialize: delete cached results for restored tabs
  for (const tab of restored.tabs) {
    if (tab.mode === "data") void deleteTabResultSnapshot(tabResultCacheKey(tab.id));
  }

  let _persistTimer: ReturnType<typeof setTimeout> | null = null;

  function schedulePersist() {
    if (_persistTimer) clearTimeout(_persistTimer);
    _persistTimer = setTimeout(() => {
      saveTabs(get().tabs, get().activeTabId);
      _persistTimer = null;
    }, 300);
  }

  function findTab(id: string) {
    return get().tabs.find((t) => t.id === id);
  }

  function tableStructureKey(connectionId: string, database: string, schema: string | undefined, tableName: string): string {
    return [connectionId, database, schema || "", tableName].map((part) => part.toLowerCase()).join(" ");
  }

  async function closeResultSession(tab: QueryTab | undefined, preserveSessionId?: string) {
    const sessionId = tab?.resultSessionId ?? tab?.result?.session_id;
    if (!tab || !sessionId || sessionId === preserveSessionId) return;
    try {
      await api.closeQuerySession(tab.connectionId, tab.database, sessionId, tab.id);
    } catch (error) {
      console.warn("[DBX][query-session:close:error]", { tabId: tab.id, sessionId, error });
    } finally {
      if (tab.resultSessionId === sessionId) tab.resultSessionId = undefined;
      if (tab.result?.session_id === sessionId) tab.result.session_id = undefined;
    }
  }

  async function closeClientConnectionSession(tab: QueryTab | undefined) {
    if (!tab?.connectionId) return;
    try {
      await api.closeClientConnectionSession(tab.connectionId, tab.database, tab.id);
    } catch (error) {
      console.warn("[DBX][client-session:close:error]", { tabId: tab.id, error });
    }
  }

  function touchResult(tab: QueryTab | undefined, accessedAt = Date.now()) {
    if (tab?.result || tab?.results) {
      tab.resultAccessedAt = accessedAt;
      tab.resultCacheState = "memory";
      tab.resultEvicted = undefined;
    }
  }

  function clearResultPayload(tab: QueryTab, options: { evicted?: boolean } = {}) {
    tab.result = undefined;
    tab.results = undefined;
    tab.activeResultIndex = undefined;
    tab.resultSessionId = undefined;
    tab.resultAccessedAt = undefined;
    tab.queryAnalysis = undefined;
    tab.querySourceColumns = undefined;
    tab.queryEditabilityReason = undefined;
    if (tab.mode === "query") tab.tableMeta = undefined;
    tab.resultEvicted = options.evicted ? true : undefined;
    tab.resultCacheState = options.evicted ? tab.resultCacheState : undefined;
    if (!options.evicted) {
      if (tab.resultCacheKey) void deleteTabResultSnapshot(tab.resultCacheKey);
      tab.resultCacheKey = undefined;
    }
  }

  function projectResultRun(tab: QueryTab, run: NonNullable<QueryTab["resultRuns"]>[number]) {
    const activeIndex = run.activeResultIndex ?? 0;
    tab.activeResultRunId = run.id;
    tab.result = run.result ?? run.results?.[activeIndex];
    tab.results = run.results;
    tab.activeResultIndex = run.activeResultIndex;
    tab.resultBaseSql = run.resultBaseSql;
    tab.resultSortedSql = run.resultSortedSql;
    tab.resultSortColumn = run.resultSortColumn;
    tab.resultSortColumnIndex = run.resultSortColumnIndex;
    tab.resultSortDirection = run.resultSortDirection;
    tab.orderByInput = run.orderByInput;
    tab.resultPageSql = run.resultPageSql;
    tab.resultPageLimit = run.resultPageLimit;
    tab.resultPageOffset = run.resultPageOffset;
    tab.resultCountSql = run.resultCountSql;
    tab.resultTotalRowCount = run.resultTotalRowCount;
    tab.resultTotalRowCountLoading = run.resultTotalRowCountLoading;
    tab.resultSessionId = run.resultSessionId;
    tab.resultAccessedAt = run.resultAccessedAt;
    tab.resultCacheKey = run.resultCacheKey;
    tab.resultCacheState = run.resultCacheState;
    tab.resultEvicted = run.resultEvicted;
    tab.queryAnalysis = run.queryAnalysis;
    tab.querySourceColumns = run.querySourceColumns;
    tab.queryEditabilityReason = run.queryEditabilityReason;
    tab.tableMeta = run.tableMeta;
    touchResult(tab);
  }

  function setActiveResultRun(id: string, runId: string): boolean {
    const tab = findTab(id);
    const run = tab?.resultRuns?.find((item) => item.id === runId);
    if (!tab || !run) return false;
    projectResultRun(tab, run);
    return true;
  }

  function removeResultRun(id: string, runId: string): boolean {
    const tab = findTab(id);
    const runIndex = tab?.resultRuns?.findIndex((run) => run.id === runId) ?? -1;
    if (!tab || !tab.resultRuns || runIndex < 0) return false;

    const wasActive = tab.activeResultRunId === runId;
    const remainingRuns = tab.resultRuns.filter((run) => run.id !== runId);
    tab.resultRuns = remainingRuns;

    if (!wasActive) return true;

    const nextRun = remainingRuns[Math.min(runIndex, remainingRuns.length - 1)];
    if (nextRun) {
      projectResultRun(tab, nextRun);
      return true;
    }

    tab.activeResultRunId = undefined;
    clearResultPayload(tab);
    return true;
  }

  function nextResultRunSequence(tab: QueryTab): number {
    return (tab.resultRuns?.reduce((max, run) => Math.max(max, run.sequence), 0) ?? 0) + 1;
  }

  function captureDisplayedResultRun(tab: QueryTab, sql: string, createdAt = Date.now()) {
    if (tab.mode !== "query" || !tab.result) return;
    const sequence = nextResultRunSequence(tab);
    const run: NonNullable<QueryTab["resultRuns"]>[number] = {
      id: uuid(),
      title: `Run ${sequence}`,
      sequence,
      sql,
      createdAt,
      result: tab.result,
      results: tab.results,
      activeResultIndex: tab.activeResultIndex,
      resultBaseSql: tab.resultBaseSql,
      resultSortedSql: tab.resultSortedSql,
      resultSortColumn: tab.resultSortColumn,
      resultSortColumnIndex: tab.resultSortColumnIndex,
      resultSortDirection: tab.resultSortDirection,
      orderByInput: tab.orderByInput,
      resultPageSql: tab.resultPageSql,
      resultPageLimit: tab.resultPageLimit,
      resultPageOffset: tab.resultPageOffset,
      resultCountSql: tab.resultCountSql,
      resultTotalRowCount: tab.resultTotalRowCount,
      resultTotalRowCountLoading: tab.resultTotalRowCountLoading,
      resultSessionId: tab.resultSessionId,
      resultAccessedAt: tab.resultAccessedAt,
      resultCacheKey: tab.resultCacheKey,
      resultCacheState: tab.resultCacheState,
      resultEvicted: tab.resultEvicted,
      queryAnalysis: tab.queryAnalysis,
      querySourceColumns: tab.querySourceColumns,
      queryEditabilityReason: tab.queryEditabilityReason,
      tableMeta: tab.tableMeta,
    };
    tab.resultRuns = [...(tab.resultRuns ?? []), run];
    tab.activeResultRunId = run.id;
  }

  function syncActiveResultRunFromDisplayed(tab: QueryTab) {
    if (!tab.activeResultRunId || !tab.resultRuns?.length) return;
    const index = tab.resultRuns.findIndex((run) => run.id === tab.activeResultRunId);
    if (index < 0) return;
    tab.resultRuns[index] = {
      ...tab.resultRuns[index],
      result: tab.result,
      results: tab.results,
      activeResultIndex: tab.activeResultIndex,
      resultBaseSql: tab.resultBaseSql,
      resultSortedSql: tab.resultSortedSql,
      resultSortColumn: tab.resultSortColumn,
      resultSortColumnIndex: tab.resultSortColumnIndex,
      resultSortDirection: tab.resultSortDirection,
      orderByInput: tab.orderByInput,
      resultPageSql: tab.resultPageSql,
      resultPageLimit: tab.resultPageLimit,
      resultPageOffset: tab.resultPageOffset,
      resultCountSql: tab.resultCountSql,
      resultTotalRowCount: tab.resultTotalRowCount,
      resultTotalRowCountLoading: tab.resultTotalRowCountLoading,
      resultSessionId: tab.resultSessionId,
      resultAccessedAt: tab.resultAccessedAt,
      resultCacheKey: tab.resultCacheKey,
      resultCacheState: tab.resultCacheState,
      resultEvicted: tab.resultEvicted,
      queryAnalysis: tab.queryAnalysis,
      querySourceColumns: tab.querySourceColumns,
      queryEditabilityReason: tab.queryEditabilityReason,
      tableMeta: tab.tableMeta,
    };
  }

  function resultRunHasPayload(run: NonNullable<QueryTab["resultRuns"]>[number]): boolean {
    return !!run.result || !!run.results?.length;
  }

  function resultSnapshotHasPayload(snapshot: NonNullable<ReturnType<typeof buildTabResultSnapshot>>): boolean {
    return !!snapshot.result || !!snapshot.results?.length || !!snapshot.resultRuns?.some(resultRunHasPayload);
  }

  async function evictCachedResult(tab: QueryTab) {
    await closeResultSession(tab);
    const cacheKey = tabResultCacheKey(tab.id);
    const cached = await writeTabResultSnapshot(cacheKey, buildTabResultSnapshot(tab));
    tab.resultCacheKey = cached ? cacheKey : undefined;
    tab.resultCacheState = cached ? "disk" : "missing";
    clearResultPayload(tab, { evicted: true });
  }

  async function trimResultCache() {
    const activeTabId = get().activeTabId;
    const inactive = get().tabs.filter((t) => t.id !== activeTabId && (t.result || t.results)).sort((a, b) => (a.resultAccessedAt ?? 0) - (b.resultAccessedAt ?? 0));
    if (inactive.length > MAX_CACHED_RESULTS) {
      const toEvict = inactive.slice(0, inactive.length - MAX_CACHED_RESULTS);
      await Promise.all(toEvict.map((t) => evictCachedResult(t)));
    }
  }

  function findTabByIdentity(connectionId: string, database: string, title: string, mode: QueryTab["mode"], schema?: string) {
    return get().tabs.find((tab) => tab.connectionId === connectionId && tab.database === database && tab.title === title && tab.mode === mode && (tab.schema || "") === (schema || ""));
  }

  function createTab(connectionId: string, database: string, title?: string, mode: QueryTab["mode"] = "query", schema?: string): string {
    if (title) {
      const existing = findTabByIdentity(connectionId, database, title, mode, schema);
      if (existing) {
        set({ activeTabId: existing.id });
        return existing.id;
      }
    }

    const id = uuid();
    const tab: QueryTab = {
      id,
      title: title || `query_${get().tabs.length + 1}`,
      customTitle: mode === "query" && !!title ? true : undefined,
      connectionId,
      database,
      schema,
      sql: "",
      isExecuting: false,
      isCancelling: false,
      isExplaining: false,
      mode,
    };
    if (mode === "query") tab.originalSql = "";
    set((state) => ({ tabs: [...state.tabs, tab], activeTabId: id }));
    schedulePersist();
    return id;
  }

  function openObjectBrowser(connectionId: string, database: string, schema?: string): string {
    const title = schema ? `${schema} objects` : `${database} objects`;
    const existing = get().tabs.find((tab) => tab.mode === "objects" && tab.connectionId === connectionId && tab.database === database && (tab.objectBrowser?.schema || "") === (schema || ""));
    if (existing) {
      set({ activeTabId: existing.id });
      return existing.id;
    }

    const id = uuid();
    const tab: QueryTab = {
      id,
      title,
      connectionId,
      database,
      schema,
      sql: "",
      isExecuting: false,
      isCancelling: false,
      isExplaining: false,
      mode: "objects",
      objectBrowser: {
        schema,
        objectType: "tables",
      },
    };
    set((state) => ({ tabs: [...state.tabs, tab], activeTabId: id }));
    schedulePersist();
    return id;
  }

  function openUserAdmin(connectionId: string): string {
    const existing = get().tabs.find((tab) => tab.mode === "users" && tab.connectionId === connectionId);
    if (existing) {
      set({ activeTabId: existing.id });
      return existing.id;
    }

    const conn = useConnectionStore.getState().getConfig(connectionId);
    const id = uuid();
    const tab: QueryTab = {
      id,
      title: t("userAdmin.title"),
      connectionId,
      database: conn?.database || "",
      sql: "",
      isExecuting: false,
      isCancelling: false,
      isExplaining: false,
      mode: "users",
    };
    set((state) => ({ tabs: [...state.tabs, tab], activeTabId: id }));
    schedulePersist();
    return id;
  }

  function openMqAdmin(connectionId: string, target?: { tenant?: string }): string {
    const existing = get().tabs.find((tab) => tab.mode === "mq" && tab.connectionId === connectionId);
    if (existing) {
      if (target?.tenant) existing.mqTenant = target.tenant;
      set({ activeTabId: existing.id });
      return existing.id;
    }

    const conn = useConnectionStore.getState().getConfig(connectionId);
    const id = uuid();
    const tab: QueryTab = {
      id,
      title: `${conn?.name || "Message Queue"} Admin`,
      connectionId,
      database: conn?.database || "",
      sql: "",
      isExecuting: false,
      isCancelling: false,
      isExplaining: false,
      mode: "mq",
      mqTenant: target?.tenant,
    };
    set((state) => ({ tabs: [...state.tabs, tab], activeTabId: id }));
    schedulePersist();
    return id;
  }

  function openTableStructure(connectionId: string, database: string, schema?: string, tableName?: string): string {
    const resolvedTableName = tableName || "";
    if (resolvedTableName) {
      const existing = get().tabs.find((tab) => tab.mode === "structure" && tab.connectionId === connectionId && tab.database === database && (tab.structureTableName || "") === resolvedTableName);
      if (existing) {
        set({ activeTabId: existing.id });
        return existing.id;
      }
    }

    const title = resolvedTableName ? t("structureEditor.editTabTitle", { tableName: resolvedTableName }) : t("structureEditor.createTitle");
    const id = uuid();
    const tab: QueryTab = {
      id,
      title,
      connectionId,
      database,
      schema,
      sql: "",
      isExecuting: false,
      isCancelling: false,
      isExplaining: false,
      mode: "structure",
      structureTableName: resolvedTableName,
    };
    set((state) => ({ tabs: [...state.tabs, tab], activeTabId: id }));
    schedulePersist();
    return id;
  }

  function isTabDirty(tab: QueryTab): boolean {
    if (tab.mode !== "query") return false;
    if (!tab.sql.trim()) return false;
    const original = tab.originalSql;
    if (original === undefined) return !!tab.savedSqlId;
    return tab.sql !== original;
  }

  function markTabClean(tab: QueryTab | undefined) {
    if (tab) tab.originalSql = tab.sql;
  }

  function closeTab(id: string, { force = false }: { force?: boolean } = {}) {
    const tab = findTab(id);
    if (!tab) return;
    if (!force && isTabDirty(tab)) {
      set({ pendingCloseTabId: id, showCloseConfirm: true });
      return;
    }
    const idx = get().tabs.findIndex((t) => t.id === id);
    if (idx < 0) return;
    clearDataGridPendingSnapshotsForTab(id);
    if (get().tabs[idx].isExecuting) void cancelTabExecution(id);
    if (get().tabs[idx].isExplaining) void cancelTabExplain(id);
    void closeResultSession(get().tabs[idx]);
    void closeClientConnectionSession(get().tabs[idx]);
    clearResultPayload(get().tabs[idx]);
    set((state) => {
      const newTabs = state.tabs.filter((t) => t.id !== id);
      const newActiveTabId = state.activeTabId === id ? (newTabs[Math.min(idx, newTabs.length - 1)]?.id ?? null) : state.activeTabId;
      return { tabs: newTabs, activeTabId: newActiveTabId };
    });
    schedulePersist();
  }

  function forceClosePendingTab() {
    const id = get().pendingCloseTabId;
    set({ pendingCloseTabId: null, showCloseConfirm: false });
    if (id) closeTab(id, { force: true });
  }

  function cancelClosePendingTab() {
    set({ pendingCloseTabId: null, showCloseConfirm: false });
  }

  function saveAndClosePendingTab(): string | null {
    const id = get().pendingCloseTabId;
    set({ pendingCloseTabId: null, showCloseConfirm: false });
    return id;
  }

  function closeOtherTabs(id: string) {
    get().tabs
      .filter((tab) => tab.id !== id)
      .forEach((tab) => {
        clearDataGridPendingSnapshotsForTab(tab.id);
        if (tab.isExecuting) void cancelTabExecution(tab.id);
        if (tab.isExplaining) void cancelTabExplain(tab.id);
        void closeResultSession(tab);
        void closeClientConnectionSession(tab);
        clearResultPayload(tab);
      });
    const next = closeOtherTabsState(get().tabs, get().activeTabId, id);
    set({ tabs: next.tabs, activeTabId: next.activeTabId });
    schedulePersist();
  }

  function closeAllTabs() {
    get().tabs.forEach((tab) => {
      clearDataGridPendingSnapshotsForTab(tab.id);
      if (tab.isExecuting) void cancelTabExecution(tab.id);
      if (tab.isExplaining) void cancelTabExplain(tab.id);
      void closeResultSession(tab);
      void closeClientConnectionSession(tab);
      clearResultPayload(tab);
    });
    const next = closeAllTabsState(get().tabs, get().activeTabId);
    set({ tabs: next.tabs, activeTabId: next.activeTabId });
    schedulePersist();
  }

  function duplicateTab(id: string) {
    const idx = get().tabs.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const original = get().tabs[idx];
    const newId = uuid();
    const newTab: QueryTab = {
      id: newId,
      title: original.title,
      customTitle: original.customTitle,
      connectionId: original.connectionId,
      database: original.database,
      schema: original.schema,
      sql: original.sql,
      savedSqlId: original.savedSqlId,
      lastExecutedSql: undefined,
      resultBaseSql: original.resultBaseSql,
      resultSortedSql: undefined,
      resultSortColumn: undefined,
      resultSortColumnIndex: undefined,
      resultSortDirection: undefined,
      orderByInput: undefined,
      resultPageSql: undefined,
      resultPageLimit: undefined,
      resultPageOffset: undefined,
      resultCountSql: undefined,
      resultTotalRowCount: undefined,
      resultTotalRowCountLoading: undefined,
      resultSessionId: undefined,
      resultAccessedAt: undefined,
      resultCacheKey: undefined,
      resultCacheState: undefined,
      pinned: false,
      result: undefined,
      results: undefined,
      activeResultIndex: undefined,
      explainPlan: undefined,
      explainError: undefined,
      explainSql: undefined,
      lastExplainedSql: undefined,
      isExecuting: false,
      isCancelling: false,
      queryExecutionStartedAt: undefined,
      editorViewport: undefined,
      editorSelection: undefined,
      executionId: undefined,
      isExplaining: false,
      explainExecutionId: undefined,
      mode: original.mode,
      mqTenant: original.mqTenant,
      structureTableName: original.structureTableName,
      objectBrowser: original.objectBrowser ? { ...original.objectBrowser } : undefined,
      objectSource: original.objectSource ? { ...original.objectSource } : undefined,
      tableMeta: original.tableMeta ? { ...original.tableMeta, columns: [...original.tableMeta.columns], primaryKeys: [...original.tableMeta.primaryKeys] } : undefined,
      queryAnalysis: original.queryAnalysis ? { ...original.queryAnalysis, columns: original.queryAnalysis.columns.map((c) => ({ ...c })) } : undefined,
      querySourceColumns: original.querySourceColumns ? [...original.querySourceColumns] : undefined,
      queryEditabilityReason: original.queryEditabilityReason,
      resultEvicted: undefined,
      whereInput: original.whereInput,
      previewSql: original.previewSql,
    };
    set((state) => {
      const newTabs = [...state.tabs];
      newTabs.splice(idx + 1, 0, newTab);
      return { tabs: newTabs, activeTabId: newId };
    });
    schedulePersist();
  }

  function closeTabsWhere(predicate: (tab: QueryTab) => boolean) {
    const closingIds = new Set(get().tabs.filter((tab) => predicate(tab)).map((tab) => tab.id));
    if (closingIds.size === 0) return;

    get().tabs
      .filter((tab) => closingIds.has(tab.id))
      .forEach((tab) => {
        clearDataGridPendingSnapshotsForTab(tab.id);
        if (tab.isExecuting) void cancelTabExecution(tab.id);
        if (tab.isExplaining) void cancelTabExplain(tab.id);
        void closeResultSession(tab);
        void closeClientConnectionSession(tab);
        clearResultPayload(tab);
      });

    const activeClosingIndex = get().tabs.findIndex((tab) => tab.id === get().activeTabId && closingIds.has(tab.id));
    set((state) => {
      const newTabs = state.tabs.filter((tab) => !closingIds.has(tab.id));
      const newActiveTabId = activeClosingIndex >= 0 ? (newTabs[Math.min(activeClosingIndex, newTabs.length - 1)]?.id ?? null) : state.activeTabId;
      return { tabs: newTabs, activeTabId: newActiveTabId };
    });
    schedulePersist();
  }

  function closeConnectionTabs(connectionId: string) {
    closeTabsWhere((tab) => tab.connectionId === connectionId);
  }

  function closeDatabaseTabs(connectionId: string, database: string) {
    closeTabsWhere((tab) => tab.connectionId === connectionId && tab.database === database);
  }

  function releaseTabsWhere(predicate: (tab: QueryTab) => boolean) {
    closeTabsWhere((tab) => predicate(tab) && tab.mode !== "query");
    get().tabs
      .filter((tab) => predicate(tab))
      .forEach((tab) => {
        if (tab.isExecuting) void cancelTabExecution(tab.id);
        if (tab.isExplaining) void cancelTabExplain(tab.id);
        void closeResultSession(tab);
        void closeClientConnectionSession(tab);
        clearResultPayload(tab);
      });
    schedulePersist();
  }

  function releaseConnectionTabs(connectionId: string) {
    releaseTabsWhere((tab) => tab.connectionId === connectionId);
  }

  function releaseDatabaseTabs(connectionId: string, database: string) {
    releaseTabsWhere((tab) => tab.connectionId === connectionId && tab.database === database);
  }

  function updateSql(id: string, sql: string) {
    const tab = findTab(id);
    if (tab) tab.sql = sql;
    schedulePersist();
  }

  function updateEditorViewport(id: string, viewport: { scrollTop: number; scrollLeft: number }) {
    const tab = findTab(id);
    if (tab) tab.editorViewport = viewport;
  }

  function updateEditorSelection(id: string, selection: { anchor: number; head: number }) {
    const tab = findTab(id);
    if (tab) tab.editorSelection = selection;
  }

  function renameTab(id: string, title: string): boolean {
    const trimmed = title.trim();
    if (!trimmed) return false;
    const tab = findTab(id);
    if (!tab || tab.mode !== "query") return false;
    tab.title = trimmed;
    tab.customTitle = true;
    schedulePersist();
    return true;
  }

  function linkSavedSql(id: string, savedSqlId: string, title?: string) {
    const tab = findTab(id);
    if (!tab) return;
    tab.savedSqlId = savedSqlId;
    if (title) {
      tab.title = title;
      tab.customTitle = true;
    }
    schedulePersist();
  }

  function openSavedSql(file: SavedSqlFile): string {
    const existing = get().tabs.find((tab) => tab.savedSqlId === file.id);
    if (existing) {
      set({ activeTabId: existing.id });
      return existing.id;
    }

    const id = uuid();
    const tab: QueryTab = {
      id,
      title: file.name,
      customTitle: true,
      connectionId: file.connectionId,
      database: file.database,
      schema: file.schema,
      sql: file.sql,
      savedSqlId: file.id,
      originalSql: file.sql,
      isExecuting: false,
      isCancelling: false,
      isExplaining: false,
      mode: "query",
    };
    set((state) => ({ tabs: [...state.tabs, tab], activeTabId: id }));
    schedulePersist();
    return id;
  }

  function togglePinnedTab(id: string) {
    const tab = findTab(id);
    if (!tab) return;
    tab.pinned = !tab.pinned;
    set((state) => ({ tabs: orderPinnedFirst(state.tabs, (item) => !!item.pinned) }));
    schedulePersist();
  }

  function reorderTab(id: string, targetId: string, position: "before" | "after") {
    const fromIdx = get().tabs.findIndex((t) => t.id === id);
    const toIdx = get().tabs.findIndex((t) => t.id === targetId);
    if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
    set((state) => {
      const newTabs = [...state.tabs];
      const [tab] = newTabs.splice(fromIdx, 1);
      const newToIdx = newTabs.findIndex((t) => t.id === targetId);
      newTabs.splice(newToIdx + (position === "after" ? 1 : 0), 0, tab);
      return { tabs: orderPinnedFirst(newTabs, (item) => !!item.pinned) };
    });
    schedulePersist();
  }

  function updateDatabase(id: string, database: string) {
    const tab = findTab(id);
    if (!tab || tab.database === database) return;
    void closeResultSession(tab);
    void closeClientConnectionSession(tab);
    tab.database = database;
    tab.schema = undefined;
    tab.objectBrowser = undefined;
    clearResultPayload(tab);
    tab.lastExecutedSql = undefined;
    tab.resultBaseSql = undefined;
    tab.resultSortedSql = undefined;
    clearExplain(tab);
    tab.tableMeta = undefined;
    schedulePersist();
  }

  function updateSchema(id: string, schema: string | undefined) {
    const tab = findTab(id);
    if (!tab || tab.schema === schema) return;
    tab.schema = schema;
    if (tab.mode === "objects") tab.objectBrowser = { ...tab.objectBrowser, schema };
  }

  function updateConnection(id: string, connectionId: string, database = "") {
    const tab = findTab(id);
    if (!tab || tab.connectionId === connectionId) return;
    void closeResultSession(tab);
    void closeClientConnectionSession(tab);
    tab.connectionId = connectionId;
    tab.database = database;
    tab.schema = undefined;
    clearResultPayload(tab);
    tab.lastExecutedSql = undefined;
    tab.resultBaseSql = undefined;
    tab.resultSortedSql = undefined;
    clearExplain(tab);
    tab.tableMeta = undefined;
    schedulePersist();
  }

  function setTableMeta(id: string, meta: NonNullable<QueryTab["tableMeta"]>) {
    const tab = findTab(id);
    if (tab) tab.tableMeta = meta;
  }

  function invalidateTableStructure(connectionId: string, database: string, schema: string | undefined, tableName: string) {
    if (!tableName) return;
    const key = tableStructureKey(connectionId, database, schema, tableName);
    tableStructureRefreshVersions[key] = (tableStructureRefreshVersions[key] ?? 0) + 1;
    set({ tableStructureRefreshVersions: { ...tableStructureRefreshVersions } });
  }

  function tableStructureRefreshVersion(connectionId: string, database: string, schema: string | undefined, tableName: string): number {
    return tableStructureRefreshVersions[tableStructureKey(connectionId, database, schema, tableName)] ?? 0;
  }

  function setObjectSource(id: string, objectSource: NonNullable<QueryTab["objectSource"]>) {
    const tab = findTab(id);
    if (tab) tab.objectSource = objectSource;
  }

  function setExecuting(id: string, isExecuting: boolean) {
    const tab = findTab(id);
    if (!tab) return;
    tab.isExecuting = isExecuting;
    tab.queryExecutionStartedAt = isExecuting ? Date.now() : undefined;
    if (!isExecuting) {
      tab.isCancelling = false;
      tab.executionId = undefined;
    }
  }

  function setExecutingWithId(id: string, executionId: string) {
    const tab = findTab(id);
    if (!tab) return;
    tab.isExecuting = true;
    tab.executionId = executionId;
    tab.isCancelling = false;
    tab.queryExecutionStartedAt = Date.now();
  }

  function clearExplain(tab: QueryTab) {
    tab.explainPlan = undefined;
    tab.explainError = undefined;
    tab.explainSql = undefined;
    tab.lastExplainedSql = undefined;
    tab.isExplaining = false;
    tab.explainExecutionId = undefined;
  }

  function toErrorResult(e: any): NonNullable<QueryTab["result"]> {
    const message = e instanceof Error ? e.message : String(e);
    return markQueryResultRowsRaw({
      columns: ["Error"],
      rows: [[message]],
      affected_rows: 0,
      execution_time_ms: 0,
    });
  }

  function setErrorResult(id: string, e: any) {
    const tab = findTab(id);
    if (!tab) return;
    tab.result = toErrorResult(e);
    tab.results = undefined;
    tab.activeResultIndex = undefined;
    tab.resultSessionId = undefined;
    tab.isExecuting = false;
    tab.isCancelling = false;
    tab.queryExecutionStartedAt = undefined;
    tab.executionId = undefined;
  }

  function setActiveResultIndex(id: string, index: number) {
    const tab = findTab(id);
    if (!tab?.results || index < 0 || index >= tab.results.length) return;
    tab.activeResultIndex = index;
    tab.result = tab.results[index];
    touchResult(tab);
    tab.queryAnalysis = undefined;
    tab.querySourceColumns = undefined;
    tab.queryEditabilityReason = undefined;
    syncActiveResultRunFromDisplayed(tab);
  }

  async function executeTabSql(
    id: string,
    sql: string,
    options?: {
      resultBaseSql?: string;
      resultSortedSql?: string | undefined;
      pagination?: { limit: number; offset: number; sessionId?: string };
      mongoSafety?: MongoAggregateSafetyOptions;
      preserveResultDuringExecution?: boolean;
      preserveTotalRowCountDuringExecution?: boolean;
      skipRedisSafetyCheck?: boolean;
    },
  ) {
    const tab = findTab(id);
    if (!tab || !sql.trim()) return;

    const executionId = uuid();
    const traceId = executionId.slice(0, 8);
    const startedAt = performance.now();
    const elapsed = () => `${Math.round(performance.now() - startedAt)}ms`;
    tab.isExecuting = true;
    tab.isCancelling = false;
    if (!tab.queryExecutionStartedAt) {
      tab.queryExecutionStartedAt = Date.now();
    }
    tab.executionId = executionId;
    tab.lastExecutedSql = sql;
    if (!options?.preserveTotalRowCountDuringExecution) {
      tab.resultTotalRowCount = undefined;
    }
    tab.resultTotalRowCountLoading = false;
    const previousResultSessionClose = closeResultSession(tab, options?.pagination?.sessionId);
    if (!options?.preserveResultDuringExecution || !tab.result) {
      clearResultPayload(tab);
    }
    console.info("[DBX][executeTabSql:start]", {
      traceId,
      tabId: id,
      mode: tab.mode,
      connectionId: tab.connectionId,
      database: tab.database,
      schema: tab.schema,
      sql,
    });
    const queryBaseSql = options?.resultBaseSql ?? sql;
    let sqlToExecute = sql;
    let pageSql: string | undefined;
    let pageLimit: number | undefined;
    let pageOffset: number | undefined;
    let countSql: string | undefined;
    let useAgentResultSession = false;
    try {
      const connStore = useConnectionStore.getState();
      await connStore.ensureConnected(tab.connectionId);
      const conn = connStore.getConfig(tab.connectionId);
      const effectiveDbType = effectiveDatabaseTypeForConnection(conn);
      const useAgentCursor = supportsDatabaseFeature(conn?.db_type, "driverManagement");
      const queryTimeoutSecs = queryTimeoutSecsForConnection(conn);
      const settingsStore = useSettingsStore.getState();
      await previousResultSessionClose;

      // Redis command execution
      if (conn?.db_type === "redis") {
        await connStore.ensureConnected(tab.connectionId);
        let currentDb = Number(tab.database) || 0;
        const commands = sql.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
        if (commands.length === 0) return;
        console.info("[DBX][executeTabSql:redis:start]", { traceId, db: currentDb, commandCount: commands.length, sql });

        const allResults: QueryResult[] = [];
        const skipSafety = options?.skipRedisSafetyCheck;
        let hadMutatingCommand = false;
        for (const command of commands) {
          try {
            const result = await api.redisExecuteCommand(tab.connectionId, currentDb, command, skipSafety);
            allResults.push(markQueryResultRowsRaw(redisCommandResultToQueryResult(result.value, performance.now() - startedAt, result.command)));
            currentDb = nextRedisCommandDb(currentDb, command, result.value);
            if (isRedisMutatingCommand(command)) {
              hadMutatingCommand = true;
              connStore.invalidateCompletionCache(tab.connectionId, String(currentDb));
            }
          } catch (e: any) {
            allResults.push({ columns: ["Error"], rows: [[e?.message ?? String(e)]], affected_rows: 0, execution_time_ms: 0 });
          }
        }
        console.info("[DBX][executeTabSql:redis:done]", { traceId, commandCount: commands.length, elapsed: elapsed() });

        const currentTab = findTab(id);
        if (currentTab?.executionId === executionId) {
          if (allResults.length > 1) {
            const activeResultIndex = allResults.findIndex((r) => !r.columns.includes("Error"));
            const resultIndex = activeResultIndex >= 0 ? activeResultIndex : 0;
            currentTab.results = allResults;
            currentTab.activeResultIndex = resultIndex;
            currentTab.result = allResults[resultIndex];
          } else {
            currentTab.results = undefined;
            currentTab.activeResultIndex = undefined;
            currentTab.result = allResults[0];
          }
          touchResult(currentTab);
          currentTab.queryAnalysis = undefined;
          currentTab.querySourceColumns = undefined;
          currentTab.queryEditabilityReason = undefined;
          currentTab.tableMeta = undefined;
          currentTab.resultBaseSql = options?.resultBaseSql ?? sql;
          currentTab.resultSortedSql = options?.resultSortedSql;
          captureDisplayedResultRun(currentTab, options?.resultBaseSql ?? sql);
          if (currentTab.database !== String(currentDb)) {
            currentTab.database = String(currentDb);
          }
        }
        if (hadMutatingCommand) {
          void connStore.refreshRedisDbKeyCounts(tab.connectionId);
        }
        return;
      }

      if (tab.mode === "query") {
        const pagination = options?.pagination ?? { limit: settingsStore.editorSettings.pageSize, offset: 0 };
        const plan = await api.prepareQueryPaginationExecutionPlan({
          sql,
          queryBaseSql,
          databaseType: effectiveDbType,
          pagination,
          useAgentCursor,
        });
        sqlToExecute = plan.sqlToExecute;
        pageSql = plan.pageSql;
        pageLimit = plan.pageLimit;
        pageOffset = plan.pageOffset;
        countSql = plan.countSql;
        useAgentResultSession = plan.useAgentResultSession;
      } else if (tab.mode === "data") {
        pageLimit = options?.pagination?.limit ?? settingsStore.editorSettings.pageSize;
        pageOffset = options?.pagination?.offset ?? 0;
      }
      const mongoFind = conn?.db_type === "mongodb" ? parseMongoFindCommand(sql) : null;
      if (mongoFind) {
        await connStore.ensureConnected(tab.connectionId);
        console.info("[DBX][executeTabSql:mongo-find:start]", { traceId, collection: mongoFind.collection });
        const result = await api.mongoFindDocuments(tab.connectionId, tab.database, mongoFind.collection, mongoFind.skip, mongoFind.limit, mongoFind.filter, mongoFind.sort, executionId);
        console.info("[DBX][executeTabSql:mongo-find:done]", {
          traceId,
          rowCount: result.documents.length,
          total: result.total,
          elapsed: elapsed(),
        });
        const currentTab = findTab(id);
        if (currentTab?.executionId === executionId) {
          currentTab.results = undefined;
          currentTab.activeResultIndex = undefined;
          currentTab.result = markQueryResultRowsRaw(mongoDocumentsToQueryResult(result.documents, performance.now() - startedAt, result.total));
          touchResult(currentTab);
          currentTab.queryAnalysis = undefined;
          currentTab.querySourceColumns = undefined;
          currentTab.queryEditabilityReason = undefined;
          currentTab.tableMeta = undefined;
          currentTab.resultBaseSql = options?.resultBaseSql ?? sql;
          currentTab.resultSortedSql = options?.resultSortedSql;
          captureDisplayedResultRun(currentTab, options?.resultBaseSql ?? sql);
        }
        return;
      }
      const mongoCount = conn?.db_type === "mongodb" ? parseMongoCountDocumentsCommand(sql) : null;
      if (mongoCount) {
        await connStore.ensureConnected(tab.connectionId);
        console.info("[DBX][executeTabSql:mongo-count:start]", { traceId, collection: mongoCount.collection });
        const result = await api.mongoFindDocuments(tab.connectionId, tab.database, mongoCount.collection, 0, 1, mongoCount.filter, undefined, executionId);
        console.info("[DBX][executeTabSql:mongo-count:done]", {
          traceId,
          total: result.total,
          elapsed: elapsed(),
        });
        const currentTab = findTab(id);
        if (currentTab?.executionId === executionId) {
          currentTab.results = undefined;
          currentTab.activeResultIndex = undefined;
          currentTab.result = markQueryResultRowsRaw(mongoCountToQueryResult(result.total, performance.now() - startedAt));
          touchResult(currentTab);
          currentTab.queryAnalysis = undefined;
          currentTab.querySourceColumns = undefined;
          currentTab.queryEditabilityReason = undefined;
          currentTab.tableMeta = undefined;
          currentTab.resultBaseSql = options?.resultBaseSql ?? sql;
          currentTab.resultSortedSql = options?.resultSortedSql;
          captureDisplayedResultRun(currentTab, options?.resultBaseSql ?? sql);
        }
        return;
      }

      const mongoAggregate = conn?.db_type === "mongodb" ? parseMongoAggregateCommand(sql) : null;
      if (mongoAggregate) {
        if (options?.mongoSafety) {
          const safety = evaluateMongoAggregateSafety(mongoAggregate, options.mongoSafety);
          if (!safety.allowed) throw new Error(safety.reason);
        }
        await connStore.ensureConnected(tab.connectionId);
        console.info("[DBX][executeTabSql:mongo-aggregate:start]", { traceId, collection: mongoAggregate.collection });
        const result = await api.mongoAggregateDocuments(tab.connectionId, tab.database, mongoAggregate.collection, mongoAggregate.pipeline, pageLimit, executionId);
        console.info("[DBX][executeTabSql:mongo-aggregate:done]", {
          traceId,
          rowCount: result.documents.length,
          total: result.total,
          elapsed: elapsed(),
        });
        const currentTab = findTab(id);
        if (currentTab?.executionId === executionId) {
          currentTab.results = undefined;
          currentTab.activeResultIndex = undefined;
          currentTab.result = markQueryResultRowsRaw(mongoDocumentsToQueryResult(result.documents, performance.now() - startedAt, result.total));
          touchResult(currentTab);
          currentTab.queryAnalysis = undefined;
          currentTab.querySourceColumns = undefined;
          currentTab.queryEditabilityReason = undefined;
          currentTab.tableMeta = undefined;
          currentTab.resultBaseSql = options?.resultBaseSql ?? sql;
          currentTab.resultSortedSql = options?.resultSortedSql;
          captureDisplayedResultRun(currentTab, options?.resultBaseSql ?? sql);
        }
        return;
      }

      const mongoGetIndexes = conn?.db_type === "mongodb" ? parseMongoGetIndexesCommand(sql) : null;
      if (mongoGetIndexes) {
        await connStore.ensureConnected(tab.connectionId);
        console.info("[DBX][executeTabSql:mongo-indexes:start]", { traceId, collection: mongoGetIndexes.collection });
        const indexes = await api.listIndexes(tab.connectionId, tab.database, "", mongoGetIndexes.collection);
        console.info("[DBX][executeTabSql:mongo-indexes:done]", {
          traceId,
          indexCount: indexes.length,
          elapsed: elapsed(),
        });
        const currentTab = findTab(id);
        if (currentTab?.executionId === executionId) {
          currentTab.results = undefined;
          currentTab.activeResultIndex = undefined;
          currentTab.result = markQueryResultRowsRaw(mongoIndexesToQueryResult(indexes, performance.now() - startedAt));
          touchResult(currentTab);
          currentTab.queryAnalysis = undefined;
          currentTab.querySourceColumns = undefined;
          currentTab.queryEditabilityReason = undefined;
          currentTab.tableMeta = undefined;
          currentTab.resultBaseSql = options?.resultBaseSql ?? sql;
          currentTab.resultSortedSql = options?.resultSortedSql;
          captureDisplayedResultRun(currentTab, options?.resultBaseSql ?? sql);
        }
        return;
      }

      const mongoWrite = conn?.db_type === "mongodb" ? parseMongoWriteCommand(sql) : null;
      if (mongoWrite) {
        await connStore.ensureConnected(tab.connectionId);
        console.info("[DBX][executeTabSql:mongo-write:start]", {
          traceId,
          kind: mongoWrite.kind,
          collection: mongoWrite.collection,
        });
        let affectedRows = 0;
        if (mongoWrite.kind === "insert") {
          const result = await api.mongoInsertDocuments(tab.connectionId, tab.database, mongoWrite.collection, mongoWrite.docsJson);
          affectedRows = result.affected_rows;
        } else if (mongoWrite.kind === "update") {
          const result = await api.mongoUpdateDocuments(tab.connectionId, tab.database, mongoWrite.collection, mongoWrite.filter, mongoWrite.update, mongoWrite.many);
          affectedRows = result.affected_rows;
        } else {
          const result = await api.mongoDeleteDocuments(tab.connectionId, tab.database, mongoWrite.collection, mongoWrite.filter, mongoWrite.many);
          affectedRows = result.affected_rows;
        }
        console.info("[DBX][executeTabSql:mongo-write:done]", {
          traceId,
          affectedRows,
          elapsed: elapsed(),
        });
        const currentTab = findTab(id);
        if (currentTab?.executionId === executionId) {
          currentTab.results = undefined;
          currentTab.activeResultIndex = undefined;
          currentTab.result = markQueryResultRowsRaw(mongoWriteToQueryResult(affectedRows, performance.now() - startedAt));
          touchResult(currentTab);
          currentTab.queryAnalysis = undefined;
          currentTab.querySourceColumns = undefined;
          currentTab.queryEditabilityReason = undefined;
          currentTab.tableMeta = undefined;
          currentTab.resultBaseSql = options?.resultBaseSql ?? sql;
          currentTab.resultSortedSql = options?.resultSortedSql;
          captureDisplayedResultRun(currentTab, options?.resultBaseSql ?? sql);
        }
        return;
      }

      console.info("[DBX][executeTabSql:execute-multi:start]", { traceId, elapsed: elapsed() });
      const clientSessionId = tab.mode === "query" ? tab.id : undefined;
      const executionOptions = {
        ...(typeof pageLimit === "number"
          ? useAgentResultSession
            ? {
                maxRows: pageLimit,
                fetchSize: pageLimit,
                pageSize: pageLimit,
                resultSessionId: options?.pagination?.sessionId,
              }
            : { maxRows: pageLimit, fetchSize: pageLimit }
          : {}),
        ...(clientSessionId ? { clientSessionId } : {}),
        timeoutSecs: queryTimeoutSecs,
      };
      const executionSchema = connectionUsesSchemaExecutionContext(conn) ? tab.schema || tab.database : tab.mode === "data" || connectionUsesDatabaseObjectTreeMode(conn) ? undefined : tab.schema;
      const executionPromise = api.executeMulti(tab.connectionId, tab.database, sqlToExecute, executionSchema, executionId, executionOptions);
      const frontendTimeoutSecs = Math.max(queryTimeoutSecs * 2, 60);
      const results = markQueryResultsRowsRaw(await withFrontendQueryTimeout(executionPromise, queryTimeoutSecs === 0 ? 0 : frontendTimeoutSecs, t("editor.queryTimeoutError")));
      console.info("[DBX][executeTabSql:execute-multi:done]", {
        traceId,
        resultCount: results.length,
        rowCounts: results.map((result) => result.rows.length),
        columnCounts: results.map((result) => result.columns.length),
        elapsed: elapsed(),
      });
      const currentTab = findTab(id);
      if (currentTab?.executionId === executionId) {
        if (results.length > 1) {
          const activeResultIndex = results.findIndex((result) => result.columns.length > 0);
          const resultIndex = activeResultIndex >= 0 ? activeResultIndex : 0;
          currentTab.results = results;
          currentTab.activeResultIndex = resultIndex;
          currentTab.result = results[resultIndex];
        } else {
          currentTab.results = undefined;
          currentTab.activeResultIndex = undefined;
          currentTab.result = results[0];
        }
        currentTab.resultBaseSql = queryBaseSql;
        currentTab.resultSortedSql = options?.resultSortedSql;
        currentTab.resultPageSql = pageSql;
        currentTab.resultPageLimit = pageLimit;
        currentTab.resultPageOffset = pageOffset;
        currentTab.resultCountSql = countSql;
        currentTab.resultSessionId = currentTab.result?.session_id ?? undefined;
        if (!options?.preserveTotalRowCountDuringExecution) {
          currentTab.resultTotalRowCount = undefined;
        }
        currentTab.resultTotalRowCountLoading = currentTab.mode === "query" && !!currentTab.result && !!countSql;
        if (currentTab.result && currentTab.mode === "query" && typeof pageLimit === "number" && !countSql && typeof currentTab.result.affected_rows === "number") {
          currentTab.resultTotalRowCount = currentTab.result.affected_rows;
          currentTab.resultTotalRowCountLoading = false;
        }
        touchResult(currentTab);
        captureDisplayedResultRun(currentTab, queryBaseSql);
        console.info("[DBX][executeTabSql:result:assigned]", {
          traceId,
          activeResultIndex: currentTab.activeResultIndex,
          rowCount: currentTab.result?.rows.length ?? 0,
          columnCount: currentTab.result?.columns.length ?? 0,
          backendMs: currentTab.result?.execution_time_ms,
          elapsed: elapsed(),
        });
      }
    } catch (e: any) {
      console.error("[DBX][executeTabSql:error]", { traceId, elapsed: elapsed(), error: e });
      const currentTab = findTab(id);
      if (currentTab?.executionId === executionId) {
        currentTab.result = toErrorResult(e);
        currentTab.results = undefined;
        currentTab.activeResultIndex = undefined;
        currentTab.queryAnalysis = undefined;
        currentTab.querySourceColumns = undefined;
        currentTab.queryEditabilityReason = undefined;
        if (currentTab.mode !== "data") currentTab.tableMeta = undefined;
        currentTab.resultBaseSql = queryBaseSql;
        currentTab.resultSortedSql = options?.resultSortedSql;
        currentTab.resultPageSql = pageSql;
        currentTab.resultPageLimit = pageLimit;
        currentTab.resultPageOffset = pageOffset;
        currentTab.resultCountSql = countSql;
        currentTab.resultSessionId = undefined;
        currentTab.resultTotalRowCount = undefined;
        currentTab.resultTotalRowCountLoading = false;
        touchResult(currentTab);
        captureDisplayedResultRun(currentTab, queryBaseSql);
      }
    } finally {
      const currentTab = findTab(id);
      if (currentTab?.executionId === executionId) {
        currentTab.isExecuting = false;
        currentTab.isCancelling = false;
        currentTab.queryExecutionStartedAt = undefined;
        currentTab.executionId = undefined;
        console.info("[DBX][executeTabSql:finish]", { traceId, elapsed: elapsed() });
      }
    }
    await trimResultCache();
  }

  async function explainTabSql(id: string, sql: string, databaseType?: DatabaseType, explainMode?: string) {
    const tab = findTab(id);
    if (!tab) return { ok: false as const, reason: "empty" as const };
    const conn = useConnectionStore.getState().getConfig(tab.connectionId);
    const queryTimeoutSecs = queryTimeoutSecsForConnection(conn);
    const executionId = uuid();

    tab.isExplaining = true;
    tab.explainExecutionId = executionId;
    tab.explainError = undefined;
    tab.lastExplainedSql = sql;

    // DM uses native getExplainInfo via JDBC
    if (databaseType === "dameng") {
      if (explainMode === "autotrace") {
        const DANGER_RE = /^\s*(DROP|DELETE|TRUNCATE|ALTER|UPDATE|MERGE|REPLACE)\b/i;
        const cleaned = sql
          .replace(/\/\*[\s\S]*?\*\//g, " ")
          .replace(/--.*$/gm, " ")
          .replace(/#.*$/gm, " ");
        if (cleaned.split(";").some((stmt) => DANGER_RE.test(stmt))) {
          tab.isExplaining = false;
          tab.explainExecutionId = undefined;
          return { ok: false as const, reason: "unsafe" as const };
        }
      }
      try {
        const mode = explainMode === "autotrace" ? "autotrace" : "explain";
        const planText = (await api.getExplainInfo(tab.connectionId, tab.database, tab.schema, sql, mode)) as string | undefined;
        const current = findTab(id);
        if (current?.explainExecutionId === executionId) {
          if (planText && planText.length > 0) {
            current.explainPlan = parseDamengExplainText(planText);
            current.explainSql = sql;
            current.explainError = undefined;
          } else {
            current.explainPlan = undefined;
            current.explainError = "No explain plan returned";
          }
        }
      } catch (e: any) {
        const current = findTab(id);
        if (current?.explainExecutionId === executionId) {
          current.explainPlan = undefined;
          current.explainError = String(e?.message || e);
        }
      } finally {
        const current = findTab(id);
        if (current?.explainExecutionId === executionId) {
          current.isExplaining = false;
        }
      }
      return { ok: true as const };
    }

    const built = await buildExplainSql(databaseType, sql);
    if (!built.ok) {
      tab.explainPlan = undefined;
      tab.explainError = built.reason;
      return built;
    }

    tab.explainSql = built.sql;
    try {
      const result = await api.executeQuery(tab.connectionId, tab.database, built.sql, tab.schema, executionId, {
        timeoutSecs: queryTimeoutSecs,
      });
      const current = findTab(id);
      if (current?.explainExecutionId === executionId) {
        current.explainPlan = parseExplainResult(databaseType as "mysql" | "postgres", result);
        current.explainError = undefined;
      }
    } catch (e: any) {
      const current = findTab(id);
      if (current?.explainExecutionId === executionId) {
        current.explainPlan = undefined;
        current.explainError = String(e?.message || e);
      }
    } finally {
      const current = findTab(id);
      if (current?.explainExecutionId === executionId) {
        current.isExplaining = false;
        current.explainExecutionId = undefined;
      }
    }
    return { ok: true as const, sql: built.sql };
  }

  async function cancelTabExecution(id: string): Promise<boolean> {
    const tab = findTab(id);
    if (!tab || !canCancelQueryExecution(tab)) return false;

    const executionId = tab.executionId;
    if (!executionId) return false;
    tab.isCancelling = true;
    try {
      const canceled = await api.cancelQuery(executionId);
      if (!canceled) {
        const current = findTab(id);
        if (current && current.executionId === executionId) {
          current.isExecuting = false;
          current.isCancelling = false;
          current.executionId = undefined;
          current.queryExecutionStartedAt = undefined;
        }
      }
      return canceled;
    } catch (e: any) {
      const current = findTab(id);
      if (current && current.executionId === executionId) {
        current.isCancelling = false;
        current.result = toErrorResult(e);
      }
      return false;
    }
  }

  async function cancelTabExplain(id: string): Promise<boolean> {
    const tab = findTab(id);
    if (!tab?.isExplaining || !tab.explainExecutionId) return false;

    const executionId = tab.explainExecutionId;
    try {
      const canceled = await api.cancelQuery(executionId);
      if (!canceled) {
        const current = findTab(id);
        if (current && current.explainExecutionId === executionId) current.isExplaining = false;
      }
      return canceled;
    } catch (e: any) {
      const current = findTab(id);
      if (current && current.explainExecutionId === executionId) {
        current.isExplaining = false;
        current.explainError = String(e?.message || e);
      }
      return false;
    }
  }

  function restoreCachedResultPayload(tab: QueryTab, snapshot: Awaited<ReturnType<typeof readTabResultSnapshot>>) {
    if (!snapshot) return false;
    const results = snapshot.results ? markQueryResultsRowsRaw(snapshot.results) : undefined;
    const activeIndex = snapshot.activeResultIndex ?? 0;
    tab.results = results;
    tab.activeResultIndex = snapshot.activeResultIndex;
    tab.result = snapshot.result ? markQueryResultRowsRaw(snapshot.result) : results?.[activeIndex] ? markQueryResultRowsRaw(results[activeIndex]) : undefined;
    tab.resultRuns = snapshot.resultRuns ? markQueryResultRunsRowsRaw(snapshot.resultRuns) : tab.resultRuns;
    tab.activeResultRunId = snapshot.activeResultRunId ?? tab.activeResultRunId;
    if (!tab.result && !tab.results && !tab.resultRuns) return false;

    tab.queryAnalysis = snapshot.queryAnalysis;
    tab.querySourceColumns = snapshot.querySourceColumns;
    tab.queryEditabilityReason = snapshot.queryEditabilityReason;
    tab.tableMeta = snapshot.tableMeta;
    tab.resultPageSql = snapshot.resultPageSql;
    tab.resultPageLimit = snapshot.resultPageLimit;
    tab.resultPageOffset = snapshot.resultPageOffset;
    tab.resultCountSql = snapshot.resultCountSql;
    tab.resultTotalRowCount = snapshot.resultTotalRowCount;
    tab.resultTotalRowCountLoading = false;
    tab.resultSessionId = undefined;
    tab.resultEvicted = undefined;
    tab.resultCacheState = "memory";
    touchResult(tab);
    return true;
  }

  async function resultArchiveSnapshotForTab(tab: QueryTab) {
    let snapshot = buildTabResultSnapshot(tab);
    if (tab.resultCacheKey && (!snapshot || tab.resultEvicted || !resultSnapshotHasPayload(snapshot))) {
      snapshot = (await readTabResultSnapshot(tab.resultCacheKey)) ?? snapshot;
    }
    return snapshot && resultSnapshotHasPayload(snapshot) ? snapshot : undefined;
  }

  async function exportResultArchive(id: string): Promise<Uint8Array | undefined> {
    const tab = findTab(id);
    if (!tab || tab.mode !== "query") return undefined;
    const snapshot = await resultArchiveSnapshotForTab(tab);
    if (!snapshot) return undefined;
    return encodeQueryResultArchive(tab, snapshot);
  }

  function openResultArchiveTab(archive: DecodedQueryResultArchive): string | undefined {
    const id = uuid();
    const title = archive.tab.title.trim() || t("tabs.importedResultArchive");
    const tab: QueryTab = {
      id,
      title,
      customTitle: true,
      connectionId: archive.tab.connectionId,
      database: archive.tab.database,
      schema: archive.tab.schema,
      sql: archive.tab.sql,
      originalSql: archive.tab.sql,
      lastExecutedSql: archive.tab.lastExecutedSql,
      resultBaseSql: archive.tab.resultBaseSql,
      resultSortedSql: archive.tab.resultSortedSql,
      isExecuting: false,
      isCancelling: false,
      isExplaining: false,
      mode: "query",
    };
    if (!restoreCachedResultPayload(tab, archive.snapshot)) return undefined;
    const activeRun = tab.resultRuns?.find((run) => run.id === tab.activeResultRunId) ?? tab.resultRuns?.[0];
    if (activeRun) projectResultRun(tab, activeRun);
    set((state) => ({ tabs: [...state.tabs, tab], activeTabId: id }));
    return id;
  }

  async function importResultArchive(bytes: Uint8Array | ArrayBuffer): Promise<string | undefined> {
    const archive = await decodeQueryResultArchive(bytes);
    if (!archive) return undefined;
    return openResultArchiveTab(archive);
  }

  async function reloadEvictedTab(id: string) {
    const tab = findTab(id);
    if (!tab || !tab.resultEvicted) return;
    if (tab.resultCacheKey) {
      const restored = restoreCachedResultPayload(tab, await readTabResultSnapshot(tab.resultCacheKey));
      if (restored) return;
      tab.resultCacheState = "missing";
    }
    tab.resultEvicted = false;
    const sql = tab.lastExecutedSql ?? tab.sql;
    if (!sql?.trim()) return;
    const settingsStore = useSettingsStore.getState();
    await executeTabSql(tab.id, sql, {
      resultBaseSql: tab.resultBaseSql ?? sql,
      resultSortedSql: tab.resultSortedSql,
      pagination:
        tab.mode === "data"
          ? {
              limit: tab.resultPageLimit ?? settingsStore.editorSettings.pageSize,
              offset: tab.resultPageOffset ?? 0,
            }
          : undefined,
    });
  }

  async function fetchTabResultForExport(id: string): Promise<QueryResult | undefined> {
    const tab = findTab(id);
    if (!tab?.result) return undefined;

    if (tab.mode === "data") {
      const connStore = useConnectionStore.getState();
      await connStore.ensureConnected(tab.connectionId);
      const conn = connStore.getConfig(tab.connectionId);
      const tableMeta = tableMetaForDataTab(tab);
      if (!tableMeta?.tableName) return tab.result;

      const pageLimit = TABLE_DATA_EXPORT_PAGE_SIZE;
      const effectiveDbType = effectiveDatabaseTypeForConnection(conn);
      const primaryKeys = tab.tableMeta ? editablePrimaryKeys(effectiveDbType, tab.tableMeta.columns, tab.tableMeta.tableType) : tableMeta.primaryKeys;
      const fallbackOrderColumns = effectiveDbType === "sqlserver" && !primaryKeys.length ? tableMeta.columns.slice(0, 1).map((column) => column.name) : undefined;
      const sortOrder = tab.resultSortColumn && tab.resultSortDirection ? `${quoteTableIdentifier(effectiveDbType, tab.resultSortColumn)} ${tab.resultSortDirection.toUpperCase()}` : undefined;
      const orderBy = tab.orderByInput?.trim() || sortOrder;
      const queryTimeoutSecs = queryTimeoutSecsForConnection(conn);
      const rows: QueryResult["rows"] = [];
      let columns: string[] = [];
      let executionTimeMs = 0;
      let offset = 0;

      while (true) {
        const sql = await api.buildTableSelectSql({
          databaseType: effectiveDbType,
          schema: tableMeta.schema,
          tableName: tableMeta.tableName,
          columns: tableMeta.columns.map((column) => column.name),
          primaryKeys,
          fallbackOrderColumns,
          whereInput: tab.whereInput,
          orderBy,
          limit: pageLimit,
          offset,
        });
        const results = await api.executeMulti(tab.connectionId, tab.database, sql, undefined, undefined, {
          maxRows: pageLimit,
          fetchSize: pageLimit,
          timeoutSecs: queryTimeoutSecs,
        });
        const result = results[0];
        if (!result) break;
        if (columns.length === 0) columns = result.columns;
        rows.push(...result.rows);
        executionTimeMs += result.execution_time_ms ?? 0;
        if (result.rows.length < pageLimit) break;
        offset += result.rows.length;
      }

      return {
        columns: columns.length ? columns : tab.result.columns,
        rows,
        affected_rows: 0,
        execution_time_ms: executionTimeMs,
        truncated: false,
        has_more: false,
      };
    }

    if (tab.mode !== "query") return tab.result;

    const sql = tab.resultSortedSql ?? tab.resultBaseSql ?? tab.lastExecutedSql ?? tab.sql;
    if (!sql.trim()) return tab.result;

    const connStore = useConnectionStore.getState();
    await connStore.ensureConnected(tab.connectionId);
    const conn = connStore.getConfig(tab.connectionId);
    const effectiveDbType = effectiveDatabaseTypeForConnection(conn);
    const queryTimeoutSecs = queryTimeoutSecsForConnection(conn);
    const useAgentCursor = supportsDatabaseFeature(conn?.db_type, "driverManagement");
    const queryBaseSql = tab.resultBaseSql ?? sql;
    const pageLimit = Math.max(tab.resultPageLimit ?? 0, TABLE_DATA_EXPORT_PAGE_SIZE);
    const rows: QueryResult["rows"] = [];
    let columns: string[] = [];
    let executionTimeMs = 0;
    let offset = 0;
    let sessionId: string | undefined;
    const clientSessionId = `${tab.id}:export`;

    try {
      while (true) {
        const plan = await api.prepareQueryPaginationExecutionPlan({
          sql,
          queryBaseSql,
          databaseType: effectiveDbType,
          pagination: { limit: pageLimit, offset, sessionId },
          useAgentCursor,
        });
        if (typeof plan.pageLimit !== "number" || typeof plan.pageOffset !== "number") return tab.result;
        const executionOptions = plan.useAgentResultSession
          ? {
              maxRows: plan.pageLimit,
              fetchSize: plan.pageLimit,
              pageSize: plan.pageLimit,
              resultSessionId: sessionId,
              clientSessionId,
              timeoutSecs: queryTimeoutSecs,
            }
          : { maxRows: plan.pageLimit, fetchSize: plan.pageLimit, timeoutSecs: queryTimeoutSecs };
        const results = await api.executeMulti(tab.connectionId, tab.database, plan.sqlToExecute, tab.schema, undefined, executionOptions);
        const result = results[0];
        if (!result) break;
        if (columns.length === 0) columns = result.columns;
        rows.push(...result.rows);
        executionTimeMs += result.execution_time_ms ?? 0;
        sessionId = result.session_id ?? undefined;
        const shouldFetchNextPage = plan.useAgentResultSession ? result.has_more === true : result.rows.length >= plan.pageLimit;
        if (!shouldFetchNextPage) break;
        offset += result.rows.length;
      }
    } finally {
      if (sessionId) void api.closeQuerySession(tab.connectionId, tab.database, sessionId, clientSessionId);
    }

    return {
      columns: columns.length ? columns : tab.result.columns,
      rows,
      affected_rows: 0,
      execution_time_ms: executionTimeMs,
      truncated: false,
      has_more: false,
    };
  }

  function notifyConnectionMayBeLost() {
    const stuck = get().tabs.filter((t) => t.isExecuting);
    if (stuck.length > 0) {
      stuck.forEach((tab) => {
        tab.isExecuting = false;
        tab.isCancelling = false;
        tab.queryExecutionStartedAt = undefined;
        tab.executionId = undefined;
        tab.result = toErrorResult(new Error(t("editor.connectionMayBeLost")));
      });
    }
  }

  async function executeCurrentTab() {
    const tab = findTab(get().activeTabId ?? "");
    if (!tab || !tab.sql.trim()) return;
    await executeCurrentSql(tab.sql);
  }

  async function executeCurrentSql(sql: string, options?: { skipRedisSafetyCheck?: boolean }) {
    const activeTabId = get().activeTabId;
    if (!activeTabId) return;
    await executeTabSql(activeTabId, sql, { resultBaseSql: sql, resultSortedSql: undefined, ...options });
  }

  return {
    tabs: restored.tabs,
    activeTabId: restored.activeTabId,
    showCloseConfirm: false,
    pendingCloseTabId: null,
    tableStructureRefreshVersions,
    createTab,
    closeTab,
    forceClosePendingTab,
    cancelClosePendingTab,
    saveAndClosePendingTab,
    isTabDirty,
    markTabClean,
    closeOtherTabs,
    closeAllTabs,
    duplicateTab,
    closeConnectionTabs,
    closeDatabaseTabs,
    releaseConnectionTabs,
    releaseDatabaseTabs,
    updateSql,
    updateEditorViewport,
    updateEditorSelection,
    renameTab,
    openObjectBrowser,
    openUserAdmin,
    openMqAdmin,
    openTableStructure,
    linkSavedSql,
    openSavedSql,
    togglePinnedTab,
    reorderTab,
    updateDatabase,
    updateSchema,
    updateConnection,
    setTableMeta,
    invalidateTableStructure,
    tableStructureRefreshVersion,
    setObjectSource,
    setExecuting,
    setExecutingWithId,
    setErrorResult,
    setActiveResultRun,
    removeResultRun,
    setActiveResultIndex,
    executeCurrentTab,
    executeCurrentSql,
    executeTabSql,
    explainTabSql,
    cancelTabExecution,
    cancelTabExplain,
    reloadEvictedTab,
    exportResultArchive,
    importResultArchive,
    fetchTabResultForExport,
    notifyConnectionMayBeLost,
  };
});
