import { useEffect, useRef } from 'react';
import { uuid } from "@/lib/utils";
import { isTauriRuntime } from "@/lib/tauriRuntime";
import { useConnectionStore } from '@/react/stores/connectionStore';
import { useQueryStore } from '@/react/stores/queryStore';
import { useToast } from '@/react/hooks/useToast';
import * as api from "@/lib/api";
import type { ConnectionConfig } from "@/types/database";

const DB_EXTENSIONS = [".db", ".db3", ".sqlite", ".sqlite3", ".duckdb"];

function getDbType(path: string): "sqlite" | "duckdb" | null {
  const lower = path.toLowerCase();
  if (lower.endsWith(".duckdb")) return "duckdb";
  if (DB_EXTENSIONS.some((ext) => lower.endsWith(ext))) return "sqlite";
  return null;
}

function isSqlFilePath(path: string): boolean {
  return /\.sql$/i.test(path);
}

function getDataFileQuery(path: string): Promise<string | undefined> {
  return api.buildDroppedFilePreviewSql({ path });
}

export function useFileDrop(onFileOpened?: (name: string) => void) {
  const connectionStore = useConnectionStore();
  const queryStore = useQueryStore();
  const { toast } = useToast();
  const onFileOpenedRef = useRef(onFileOpened);
  onFileOpenedRef.current = onFileOpened;

  async function openDroppedSqlFile(name: string, content: string) {
    const connectionId = connectionStore.activeConnectionId || connectionStore.connections[0]?.id || "";
    const connection = connectionId ? connectionStore.getConfig(connectionId) : undefined;
    const database = connection?.database || "";
    const tabId = queryStore.createTab(connectionId, database, name, "query");
    queryStore.updateSql(tabId, content);
    toast(`File opened: ${name}`);
    onFileOpenedRef.current?.(name);
  }

  async function setupFileDrop() {
    if (isTauriRuntime()) {
      const { getCurrentWebview } = await import("@tauri-apps/api/webview");
      const webview = getCurrentWebview();
      await webview.onDragDropEvent(async (event) => {
        if (event.payload.type !== "drop") return;
        for (const path of event.payload.paths) {
          const name = path.split("/").pop()?.split("\\").pop() || path;

          const dataQuery = await getDataFileQuery(path);
          if (dataQuery) {
            const config: ConnectionConfig = {
              id: uuid(),
              name: `[Preview] ${name}`,
              db_type: "duckdb",
              driver_profile: "duckdb",
              driver_label: "DuckDB",
              url_params: "",
              host: ":memory:",
              port: 0,
              username: "",
              password: "",
            };
            const connectionId = await api.connectDb(config);
            connectionStore.addEphemeralConnection({ ...config, id: connectionId });
            const tabId = queryStore.createTab(connectionId, "", name, "query");
            queryStore.updateSql(tabId, dataQuery);
            queryStore.executeCurrentTab();
            toast(`File opened: ${name}`);
            continue;
          }

          if (isSqlFilePath(path)) {
            try {
              const content = await api.readExternalSqlFile(path);
              await openDroppedSqlFile(name, content);
            } catch (e: any) {
              toast(`Failed to open SQL file: ${e?.message || String(e)}`, 5000);
            }
            continue;
          }

          const dbType = getDbType(path);
          if (!dbType) continue;
          const config: ConnectionConfig = {
            id: uuid(),
            name,
            db_type: dbType,
            driver_profile: dbType,
            driver_label: dbType === "duckdb" ? "DuckDB" : "SQLite",
            url_params: "",
            host: path,
            port: 0,
            username: "",
            password: "",
          };
          try {
            await connectionStore.addConnection(config);
            void connectionStore.connect(config);
            toast(`File opened: ${name}`);
          } catch (e: any) {
            toast(`Failed to save connection: ${e?.message || String(e)}`, 5000);
          }
        }
      });
    } else {
      // Browser fallback: handle HTML5 drag/drop
      const handleDrop = (event: DragEvent) => {
        const files = event.dataTransfer?.files;
        if (!files || files.length === 0) return;
        event.preventDefault();
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          if (!isSqlFilePath(file.name)) continue;
          const reader = new FileReader();
          reader.onload = () => {
            if (typeof reader.result === "string") {
              openDroppedSqlFile(file.name, reader.result).catch((e: any) => {
                toast(`Failed to open SQL file: ${e?.message || String(e)}`, 5000);
              });
            }
          };
          reader.readAsText(file);
        }
      };

      const handleDragOver = (event: DragEvent) => {
        const files = event.dataTransfer?.files;
        if (!files || files.length === 0) return;
        for (let i = 0; i < files.length; i++) {
          if (isSqlFilePath(files[i].name)) {
            event.preventDefault();
            return;
          }
        }
      };

      document.addEventListener("drop", handleDrop);
      document.addEventListener("dragover", handleDragOver);

      return () => {
        document.removeEventListener("drop", handleDrop);
        document.removeEventListener("dragover", handleDragOver);
      };
    }
  }

  useEffect(() => {
    const cleanup = setupFileDrop();
    return () => {
      if (cleanup && typeof cleanup === "function") {
        cleanup();
      }
    };
  }, []);
}
