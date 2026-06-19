import { useState, useRef, useEffect, useMemo } from "react";
import { X, Pin, Table2, Code2, TableProperties, PencilRuler, KeyRound } from "lucide-react";
import { Button } from "@/react/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/react/components/ui/tooltip";
import type { QueryTab } from "@/types/database";

interface AppTabBarProps {
  tabs: QueryTab[];
  activeTabId: string | null;
  showDriverStore: boolean;
  agentDriverUpdateCount: number;
  compactTabTitle: boolean;
  onTabClick: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onTabPin: (tabId: string) => void;
  onTabRename: (tabId: string, title: string) => void;
  onToggleDriverStore: () => void;
  onCloseDriverStore: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}

function tabDisplayTitle(tab: QueryTab, t: (key: string) => string): string {
  return tab.title || t("tabs.sql");
}

function tabIconClass(tab: QueryTab): string {
  if (
    tab.mode === "data" ||
    tab.mode === "mongo" ||
    tab.mode === "redis" ||
    tab.mode === "objects" ||
    tab.mode === "structure"
  )
    return "text-emerald-600 dark:text-emerald-400";
  return "text-blue-600 dark:text-blue-400";
}

function tabMenuIcon(tab: QueryTab) {
  if (tab.mode === "data" || tab.mode === "mongo" || tab.mode === "redis") return Table2;
  if (tab.mode === "etcd") return KeyRound;
  if (tab.mode === "objects") return TableProperties;
  if (tab.mode === "structure") return PencilRuler;
  return Code2;
}

function connectionColor(_connectionId: string): string | undefined {
  // TODO: implement connectionColor
  return undefined;
}

export function AppTabBar({
  tabs,
  activeTabId,
  showDriverStore,
  agentDriverUpdateCount,
  compactTabTitle,
  onTabClick,
  onTabClose,
  onTabPin,
  onTabRename,
  onToggleDriverStore,
  onCloseDriverStore,
  t,
}: AppTabBarProps) {
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingTabId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingTabId]);

  function startRenameTab(tab: QueryTab) {
    if (tab.mode !== "query") return;
    setEditingTabId(tab.id);
    setEditingTitle(tab.title);
  }

  function commitRenameTab(tab: QueryTab) {
    if (editingTabId !== tab.id) return;
    const title = editingTitle.trim();
    if (title) onTabRename(tab.id, title);
    setEditingTabId(null);
  }

  function cancelRenameTab() {
    setEditingTabId(null);
  }

  function tabColorStyle(tab: QueryTab) {
    const color = connectionColor(tab.connectionId);
    const isActive = tab.id === activeTabId && !showDriverStore;
    if (!color) {
      return isActive ? { borderColor: "var(--ring)" } : undefined;
    }
    return {
      backgroundColor: `color-mix(in oklch, ${color} ${isActive ? "16%" : "9%"} , transparent)`,
      borderColor: isActive
        ? `color-mix(in oklch, ${color} 72% , transparent)`
        : `color-mix(in oklch, ${color} 18% , transparent)`,
    };
  }

  if (tabs.length === 0 && !showDriverStore) {
    return null;
  }

  return (
    <div className="relative flex border-b shrink-0 h-10 items-center bg-background px-2">
      <div className="app-tab-strip relative h-full min-w-0 flex-1">
        <div className="app-tab-scroll flex min-w-0 flex-1 items-center h-10 gap-1.5 py-1.5 overflow-x-auto">
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId && !showDriverStore;
            const Icon = tabMenuIcon(tab);

            return (
              <div
                key={tab.id}
                className={`
                  group flex items-center gap-1 px-2 text-xs cursor-pointer transition-colors whitespace-nowrap select-none
                  h-7 rounded-md border
                  ${compactTabTitle ? "min-w-24" : "min-w-38"}
                  ${
                    isActive
                      ? "text-foreground font-medium border-border/60"
                      : "border-transparent text-foreground/70 hover:border-border hover:text-foreground/90"
                  }
                `}
                style={tabColorStyle(tab)}
                onClick={() => onTabClick(tab.id)}
                onDoubleClick={() => startRenameTab(tab)}
              >
                <span className={`shrink-0 ${tabIconClass(tab)}`}>
                  <Icon className="h-3.5 w-3.5" />
                </span>

                {editingTabId === tab.id ? (
                  <input
                    ref={inputRef}
                    value={editingTitle}
                    onChange={(e) => setEditingTitle(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRenameTab(tab);
                      if (e.key === "Escape") cancelRenameTab();
                    }}
                    onBlur={() => commitRenameTab(tab)}
                    className="h-5 min-w-0 flex-1 rounded border border-ring bg-background px-1.5 text-xs font-normal text-foreground outline-none"
                  />
                ) : (
                  <span className="min-w-0 truncate flex-1">{tabDisplayTitle(tab, t)}</span>
                )}

                {/* Pin button */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      className={`rounded p-0.5 text-muted-foreground hover:bg-muted-foreground/20 hover:text-foreground ${
                        tab.pinned ? "visible text-primary" : "invisible group-hover:visible"
                      }`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onTabPin(tab.id);
                      }}
                    >
                      <Pin className={`h-3 w-3 ${tab.pinned ? "fill-current" : ""}`} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{tab.pinned ? t("contextMenu.unpin") : t("contextMenu.pin")}</TooltipContent>
                </Tooltip>

                {/* Close button */}
                <button
                  className="rounded hover:bg-muted-foreground/20 p-0.5 shrink-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    onTabClose(tab.id);
                  }}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}

          {/* Driver Store Tab */}
          {showDriverStore && (
            <div
              className="group flex min-w-38 items-center gap-1 px-2 text-xs cursor-pointer transition-colors whitespace-nowrap h-7 rounded-md border border-ring text-foreground font-medium"
              onClick={onToggleDriverStore}
            >
              <span className="shrink-0 text-amber-600 dark:text-amber-400">
                <Package className="h-3.5 w-3.5" />
              </span>
              <span className="min-w-0 truncate flex-1">{t("toolbar.driverManager")}</span>
              {agentDriverUpdateCount > 0 && (
                <span className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium leading-none text-white">
                  {agentDriverUpdateCount > 99 ? "99+" : agentDriverUpdateCount}
                </span>
              )}
              <button
                className="rounded hover:bg-muted-foreground/20 p-0.5 shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseDriverStore();
                }}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Placeholder icon for driver store
function Package({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={className ? undefined : 24}
      height={className ? undefined : 24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M3 9h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9Z" />
      <path d="m3 9 2.45-4.9A2 2 0 0 1 7.24 3h9.52a2 2 0 0 1 1.8 1.1L21 9" />
      <path d="M12 3v6" />
    </svg>
  );
}
