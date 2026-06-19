import { useState, useCallback, useRef, type Ref } from 'react';
import { useQueryStore } from '@/react/stores/queryStore';
import { useHistoryStore } from '@/react/stores/historyStore';
import { useConnectionStore } from '@/react/stores/connectionStore';
import { useSettingsStore } from '@/react/stores/settingsStore';
import { useToast } from '@/react/hooks/useToast';
import { classifySqlActivityKind } from "@/lib/historyActivityKind";
import { sqlMetadataRefreshTarget } from "@/lib/sqlMetadataRefresh";
import { classifyRedisCommandSafety, firstRedisCommandToken } from "@/lib/redisCommandSafety";
import { isSqlExecutionSnapshot, resolveExecutableSql, type SqlExecutionOverride, type SqlExecutionSnapshot } from "@/lib/sqlExecutionTarget";
import type { ConnectionConfig, QueryTab } from "@/types/database";

const DANGER_RE = /^\s*(DROP|DELETE|TRUNCATE|ALTER|UPDATE|MERGE|REPLACE)\b/i;

export function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--.*$/gm, " ")
    .replace(/#.*$/gm, " ");
}

export function isDangerousSql(sql: string): boolean {
  const cleaned = stripSqlComments(sql);
  return cleaned.split(";").some((stmt) => DANGER_RE.test(stmt));
}

function primarySqlOperation(sql: string): string {
  const cleaned = stripSqlComments(sql);
  const statement = cleaned
    .split(";")
    .map((part) => part.trim())
    .find(Boolean);
  return statement?.match(/^([a-z]+)/i)?.[1]?.toUpperCase() || "SQL";
}

interface UseSqlExecutionDeps {
  activeTab: QueryTab | undefined;
  activeConnection: ConnectionConfig | undefined;
  executableSql: string;
  resolveExecutableSql?: (snapshot?: SqlExecutionSnapshot) => Promise<string>;
  activeOutputView: Ref<"result" | "summary" | "explain" | "chart">;
  blockDangerousRedisCommands?: Ref<boolean>;
}

export function useSqlExecution(deps: UseSqlExecutionDeps) {
  const queryStore = useQueryStore();
  const historyStore = useHistoryStore();
  const connectionStore = useConnectionStore();
  const settingsStore = useSettingsStore();
  const { toast } = useToast();

  const [dangerSql, setDangerSql] = useState("");
  const [pendingDangerSql, setPendingDangerSql] = useState("");
  const [showDangerDialog, setShowDangerDialog] = useState(false);
  const [suppressDangerConfirm, setSuppressDangerConfirm] = useState(false);
  const [explainMode, setExplainMode] = useState<"explain" | "autotrace">("explain");

  const resolvedExecutableSql = useCallback(async (source?: SqlExecutionOverride): Promise<string> => {
    if (typeof source === "string") return source;
    if (deps.resolveExecutableSql) return await deps.resolveExecutableSql(source);
    if (isSqlExecutionSnapshot(source)) return resolveExecutableSql(source.fullSql, source.selectedSql, { cursorPos: source.cursorPos });
    return deps.executableSql;
  }, [deps]);

  const tryExecute = useCallback(async (sqlOverride?: SqlExecutionOverride) => {
    const tab = deps.activeTab;
    const sql = await resolvedExecutableSql(sqlOverride);
    if (!tab || !sql.trim()) return;

    // Redis: block dangerous commands when toggle is on
    if (deps.activeConnection?.db_type === "redis" && deps.blockDangerousRedisCommands?.current !== false) {
      const commands = sql
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      for (const cmd of commands) {
        const safety = classifyRedisCommandSafety(cmd);
        if (safety === "blocked") {
          toast(`Blocked Redis command: ${firstRedisCommandToken(cmd)}`, 5000);
          return;
        }
      }
    }

    if (isDangerousSql(sql) && settingsStore.editorSettings.confirmDangerousSqlExecution) {
      setDangerSql(sql);
      setPendingDangerSql(sql);
      setSuppressDangerConfirm(false);
      setShowDangerDialog(true);
    } else {
      doExecute(sql);
    }
  }, [deps, resolvedExecutableSql, settingsStore.editorSettings.confirmDangerousSqlExecution, toast]);

  const doExecute = useCallback(async (sql?: string) => {
    sql ??= await resolvedExecutableSql();
    const tab = deps.activeTab;
    if (!tab || !sql.trim()) return;
    deps.activeOutputView.current = "result";
    const connName = connectionStore.getConfig(tab.connectionId)?.name || "";
    const start = Date.now();
    const isRedis = deps.activeConnection?.db_type === "redis";
    await queryStore.executeCurrentSql(sql, isRedis ? { skipRedisSafetyCheck: deps.blockDangerousRedisCommands?.current === false } : undefined);
    if (tab.result && !tab.result.columns.length && !tab.results?.some((result) => result.columns.length > 0)) {
      deps.activeOutputView.current = "summary";
    }
    const elapsed = Date.now() - start;
    const success = !tab.result?.columns.includes("Error");
    historyStore.add({
      connection_id: tab.connectionId,
      connection_name: connName,
      database: tab.database,
      sql,
      execution_time_ms: elapsed,
      success,
      error: success ? undefined : String(tab.result?.rows?.[0]?.[0] ?? ""),
      activity_kind: classifySqlActivityKind(sql),
      operation: primarySqlOperation(sql),
      affected_rows: success ? tab.result?.affected_rows : undefined,
    });
    if (success) {
      const refreshTarget = sqlMetadataRefreshTarget(sql, tab.schema);
      if (refreshTarget.scope === "connection") {
        await connectionStore.loadDatabases(tab.connectionId, { force: true });
      } else if (refreshTarget.scope === "database") {
        connectionStore.refreshObjectListTreeNode(tab.connectionId, tab.database, refreshTarget.schema);
      }
    }
  }, [deps, resolvedExecutableSql, connectionStore, queryStore, historyStore]);

  const cancelActiveExecution = useCallback(() => {
    const tab = deps.activeTab;
    if (!tab) return;
    if (tab.isExecuting) void queryStore.cancelTabExecution(tab.id);
    else if (tab.isExplaining) void queryStore.cancelTabExplain(tab.id);
  }, [deps.activeTab, queryStore]);

  const explainReasonMessage = useCallback((reason: string): string => {
    if (reason === "unsupported") return "Explain is not supported for this database type";
    if (reason === "unsafe") return "Explain is not available for this query type";
    return "No SQL to explain";
  }, []);

  const tryExplain = useCallback(async (sqlOverride?: SqlExecutionOverride) => {
    const tab = deps.activeTab;
    const sql = await resolvedExecutableSql(sqlOverride);
    if (!tab || !sql.trim()) {
      toast("No SQL to explain");
      return;
    }

    deps.activeOutputView.current = "explain";
    const result = await queryStore.explainTabSql(tab.id, sql, deps.activeConnection?.db_type, explainMode);
    if (!result.ok) {
      toast(explainReasonMessage(result.reason ?? ""), 5000);
      return;
    }

    const currentTab = queryStore.tabs.find((t) => t.id === tab.id);
    if (currentTab?.explainError) toast(currentTab.explainError, 5000);
  }, [deps, resolvedExecutableSql, explainMode, queryStore, toast, explainReasonMessage]);

  const onDangerConfirm = useCallback(async () => {
    const sql = pendingDangerSql || (await resolvedExecutableSql());
    if (suppressDangerConfirm) {
      settingsStore.updateEditorSettings({ confirmDangerousSqlExecution: false });
    }
    setSuppressDangerConfirm(false);
    setPendingDangerSql("");
    await doExecute(sql);
  }, [pendingDangerSql, suppressDangerConfirm, resolvedExecutableSql, settingsStore, doExecute]);

  return {
    dangerSql,
    pendingDangerSql,
    showDangerDialog,
    suppressDangerConfirm,
    explainMode,
    setExplainMode,
    tryExecute,
    doExecute,
    cancelActiveExecution,
    tryExplain,
    onDangerConfirm,
    setShowDangerDialog,
    setSuppressDangerConfirm,
  };
}
