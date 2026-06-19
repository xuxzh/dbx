import type { QueryTab, ConnectionConfig } from "@/types/database";

interface ContentAreaProps {
  activeTab: QueryTab;
  activeConnection?: ConnectionConfig;
  activeOutputView: "result" | "summary" | "explain" | "chart";
  onUpdateOutputView: (view: "result" | "summary" | "explain" | "chart") => void;
  onEditorUpdate: (tabId: string, value: string) => void;
  onEditorSelectionChange: (value: string) => void;
  onEditorCursorChange: (pos: number) => void;
  onExecute: () => void;
  onCancel: () => void;
  onSaveSql: () => void;
  t: (key: string) => string;
}

export function ContentArea({
  activeTab,
  activeConnection,
  activeOutputView,
  onUpdateOutputView,
  onEditorUpdate,
  onEditorSelectionChange,
  onEditorCursorChange,
  onExecute,
  onCancel,
  onSaveSql,
  t,
}: ContentAreaProps) {
  // Placeholder - QueryEditor and DataGrid need migration
  // This component will be fully implemented when those are migrated

  if (activeTab.mode === "query") {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        {/* Query Editor placeholder */}
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="flex-1 min-h-0 flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <p className="text-sm">{t("editor.pressToExecute", { mod: "Ctrl" })}</p>
              <p className="text-sm">{t("editor.pressToSaveSql", { mod: "Ctrl" })}</p>
              <p className="text-xs text-muted-foreground mt-4">
                {/* QueryEditor will be migrated in a future task */}
              </p>
            </div>
          </div>

          {/* Results pane placeholder */}
          <div className="h-40 border-t flex items-center justify-center text-muted-foreground text-sm">
            {/* Results/DataGrid will be migrated in a future task */}
            Results
          </div>
        </div>
      </div>
    );
  }

  // Other modes (data, redis, etcd, mongo, mq, objects, structure, users)
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex-1 min-h-0 flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <p className="text-sm">{activeTab.title || t("tabs.sql")}</p>
          <p className="text-xs text-muted-foreground mt-2">
            {/* This mode will be migrated in a future task */}
          </p>
        </div>
      </div>
    </div>
  );
}
