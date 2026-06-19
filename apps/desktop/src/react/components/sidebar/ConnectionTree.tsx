"use client";

import { useState, useRef, useMemo, useEffect } from "react";
import { Search, X, Crosshair } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useConnectionStore } from "@/react/stores/connectionStore";
import { useQueryStore } from "@/react/stores/queryStore";
import { TreeItem } from "./TreeItem";
import { Input } from "@/react/components/ui/input";
import type { TreeNode, TreeNodeType } from "@/types/database";
import { filterSidebarSearchRootsByConnectionState, filterSidebarTree } from "@/lib/sidebarSearchTree";
import { flattenTree, type FlatTreeNode } from "@/composables/useFlatTree";

type SearchScope = "connection" | "database" | "schema" | "table" | "view";

export function ConnectionTree() {
  const { t } = useTranslation();
  const connectionStore = useConnectionStore();
  const queryStore = useQueryStore();

  const [searchQuery, setSearchQuery] = useState("");
  const [deferredSearchQuery, setDeferredSearchQuery] = useState("");
  const [selectedSearchScopes, setSelectedSearchScopes] = useState<SearchScope[]>([]);
  const [searchCollapsedIds, setSearchCollapsedIds] = useState<Set<string>>(new Set());
  const [pendingRenameGroupId, setPendingRenameGroupId] = useState<string | null>(null);
  const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const parentRef = useRef<HTMLDivElement>(null);

  const isSearching = !!deferredSearchQuery;
  const isFiltering = !!searchQuery.trim() || hasSearchScopeFilter;

  const hasSearchScopeFilter = useMemo(
    () => selectedSearchScopes.length > 0,
    [selectedSearchScopes]
  );

  const searchableNodeTypes = useMemo<Set<TreeNodeType> | undefined>(() => {
    if (!hasSearchScopeFilter) return undefined;
    const SEARCH_SCOPE_TO_NODE_TYPES: Record<SearchScope, TreeNodeType[]> = {
      connection: ["connection"],
      database: ["database", "redis-db", "mq-tenant", "mongo-db"],
      schema: ["schema"],
      table: ["table", "mongo-collection", "elasticsearch-index"],
      view: ["view"],
    };
    const types = new Set<TreeNodeType>();
    for (const scope of selectedSearchScopes) {
      for (const nodeType of SEARCH_SCOPE_TO_NODE_TYPES[scope]) {
        types.add(nodeType);
      }
    }
    return types;
  }, [hasSearchScopeFilter, selectedSearchScopes]);

  // Debounced search
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDeferredSearchQuery(searchQuery.trim().toLowerCase());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  // Update store search query
  useEffect(() => {
    connectionStore.sidebarSearchQuery = deferredSearchQuery;
  }, [deferredSearchQuery, connectionStore]);

  const filteredNodes = useMemo(() => {
    let nodes = connectionStore.treeNodes;
    if (deferredSearchQuery) {
      nodes = filterSidebarTree(nodes, deferredSearchQuery, searchCollapsedIds, searchableNodeTypes);
      nodes = filterSidebarSearchRootsByConnectionState(nodes, connectionStore.connectedIds);
    }
    return nodes;
  }, [connectionStore.treeNodes, deferredSearchQuery, searchCollapsedIds, searchableNodeTypes, connectionStore.connectedIds]);

  const flatNodes = useMemo<FlatTreeNode[]>(() => {
    return flattenTree(filteredNodes);
  }, [filteredNodes]);

  function handleSearchToggle(node: TreeNode) {
    if (!isSearching || !node.children) return;
    setSearchCollapsedIds((prev) => {
      const next = new Set(prev);
      if (node.isExpanded) next.add(node.id);
      else next.delete(node.id);
      return next;
    });
  }

  function handleNodeToggled(node: TreeNode, wasExpanded: boolean) {
    // Could emit event for auto-scrolling
  }

  function clearSidebarSelection() {
    connectionStore.selectedTreeNodeId = null;
    connectionStore.selectedTreeNodeIds = [];
    connectionStore.treeSelectionAnchorId = null;
  }

  async function locateActiveTabInSidebar() {
    const activeTab = queryStore.tabs.find((tab) => tab.id === queryStore.activeTabId);
    if (!activeTab) return;

    const connId = activeTab.connectionId;
    if (connId && !connectionStore.connectedIds.has(connId)) {
      const config = connectionStore.getConfig(connId);
      if (!config) return;
      try {
        await connectionStore.connect(config);
      } catch {
        return;
      }
    }
  }

  function handleSearchKeydown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setSearchQuery("");
      setDeferredSearchQuery("");
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col text-sm select-none">
      {/* Search Bar */}
      <div className="sticky top-0 z-10 bg-background px-2 py-1">
        <div className="relative flex items-center gap-1">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleSearchKeydown}
              placeholder={t("grid.search")}
              className="h-6 pl-7 pr-6 text-xs"
            />
            {searchQuery && (
              <button
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setSearchQuery("")}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <button
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-border text-muted-foreground hover:bg-accent hover:text-foreground"
            title={t("sidebar.locateActiveTab")}
            onClick={locateActiveTabInSidebar}
          >
            <Crosshair className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Tree Content */}
      <div
        ref={parentRef}
        className="min-h-0 flex-1 overflow-y-auto"
        onClick={clearSidebarSelection}
      >
        {flatNodes.length === 0 ? (
          <div className="px-3 py-8 text-center text-muted-foreground text-xs">
            {t("sidebar.noConnections")}
          </div>
        ) : (
          flatNodes.map((item) => (
            <TreeItem
              key={item.id}
              node={item.node}
              depth={item.depth}
              dragDisabled={isFiltering}
              pendingRename={pendingRenameGroupId === item.node.id}
              highlighted={highlightedNodeId === item.node.id}
              onNodeToggled={handleNodeToggled}
              onSearchToggle={handleSearchToggle}
              onRenameStarted={() => setPendingRenameGroupId(null)}
            />
          ))
        )}
      </div>
    </div>
  );
}
