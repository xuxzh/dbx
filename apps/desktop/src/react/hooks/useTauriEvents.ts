import { useEffect, useRef, useCallback } from 'react';
import { useConnectionStore } from '@/react/stores/connectionStore';
import { useQueryStore } from '@/react/stores/queryStore';
import type { ConnectionConfig, QueryTab } from "@/types/database";

interface NavigationTarget {
  connectionId: string;
  database: string;
  schema?: string;
  tableName: string;
}

interface UseTauriEventsDeps {
  openTableTarget: (target: NavigationTarget) => Promise<void>;
  openSqlFilePath: (path: string) => Promise<void>;
  openDbFilePath: (path: string) => Promise<void>;
  openConnectionDeepLink: (url: string) => Promise<void>;
}

export function useTauriEvents(deps: UseTauriEventsDeps) {
  const connectionStore = useConnectionStore();
  const queryStore = useQueryStore();
  const unlistenHandlesRef = useRef<Array<() => void>>([]);

  const focusCurrentWindow = useCallback(() => {
    import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
      getCurrentWindow()
        .setFocus()
        .catch(() => {}),
    );
  }, []);

  useEffect(() => {
    let isMounted = true;
    const unlistenHandles: Array<() => void> = [];

    import("@tauri-apps/api/event")
      .then(({ listen }) => {
        if (!isMounted) return;

        listen<{ connection_id: string; database: string; schema?: string; table: string }>("mcp-open-table", async (event) => {
          try {
            const { connection_id, database, schema, table } = event.payload;
            if (!connectionStore.connections.length) await connectionStore.initFromDisk();
            const config = connectionStore.getConfig(connection_id);
            if (!config) return;
            connectionStore.activeConnectionId = connection_id;
            await connectionStore.ensureConnected(connection_id);
            if (config.db_type === "redis") {
              queryStore.createTab(connection_id, database || "0", `db${database || "0"}`, "redis");
            } else if (config.db_type === "mongodb") {
              queryStore.createTab(connection_id, database, table, "mongo");
            } else {
              await deps.openTableTarget({ connectionId: connection_id, database, schema, tableName: table });
            }
            focusCurrentWindow();
          } catch (e) {
            console.error("[DBX] mcp-open-table error:", e);
          }
        }).then((unlisten) => unlistenHandles.push(unlisten));

        listen("mcp-reload-connections", async () => {
          try {
            await connectionStore.initFromDisk();
          } catch (e) {
            console.error("[DBX] mcp-reload-connections error:", e);
          }
        }).then((unlisten) => unlistenHandles.push(unlisten));

        listen<{
          connection_id: string;
          database: string;
          sql: string;
          allow_writes?: boolean;
          allow_dangerous?: boolean;
        }>("mcp-execute-query", async (event) => {
          try {
            const { connection_id, database, sql, allow_writes, allow_dangerous } = event.payload;
            if (!connectionStore.connections.length) await connectionStore.initFromDisk();
            const config = connectionStore.getConfig(connection_id);
            if (!config) return;
            connectionStore.activeConnectionId = connection_id;
            await connectionStore.ensureConnected(connection_id);
            const tabId = queryStore.createTab(connection_id, database, undefined, "query");
            queryStore.updateSql(tabId, sql);
            await queryStore.executeTabSql(tabId, sql, {
              mongoSafety: { allowWrites: !!allow_writes, allowDangerous: !!allow_dangerous },
            });
            focusCurrentWindow();
          } catch (e) {
            console.error("[DBX] mcp-execute-query error:", e);
          }
        }).then((unlisten) => unlistenHandles.push(unlisten));

        listen<string[]>("dbx-open-sql-files", async (event) => {
          try {
            for (const path of event.payload) {
              await deps.openSqlFilePath(path);
            }
            focusCurrentWindow();
          } catch (e) {
            console.error("[DBX] dbx-open-sql-files error:", e);
          }
        }).then((unlisten) => unlistenHandles.push(unlisten));

        listen<string[]>("dbx-open-db-files", async (event) => {
          try {
            for (const path of event.payload) {
              await deps.openDbFilePath(path);
            }
            focusCurrentWindow();
          } catch (e) {
            console.error("[DBX] dbx-open-db-files error:", e);
          }
        }).then((unlisten) => unlistenHandles.push(unlisten));

        listen<string[]>("dbx-open-connection-links", async (event) => {
          try {
            for (const url of event.payload) {
              await deps.openConnectionDeepLink(url);
            }
            focusCurrentWindow();
          } catch (e) {
            console.error("[DBX] dbx-open-connection-links error:", e);
          }
        }).then((unlisten) => unlistenHandles.push(unlisten));
      })
      .catch(() => {});

    unlistenHandlesRef.current = unlistenHandles;

    return () => {
      isMounted = false;
      unlistenHandles.forEach((unlisten) => unlisten());
      unlistenHandlesRef.current = [];
    };
  }, [deps, connectionStore, queryStore, focusCurrentWindow]);

  const cleanupTauriListeners = useCallback(() => {
    unlistenHandlesRef.current.forEach((unlisten) => unlisten());
    unlistenHandlesRef.current = [];
  }, []);

  return { cleanupTauriListeners };
}
