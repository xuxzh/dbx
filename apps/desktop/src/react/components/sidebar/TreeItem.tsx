"use client";

import { useState, useRef, useCallback, useMemo } from "react";
import {
  ChevronRight,
  ChevronDown,
  Loader2,
  FolderOpen,
  FolderClosed,
  Database,
  Table,
  Columns3,
  Eye,
  Key,
  Link,
  Zap,
  ListTree,
  TableProperties,
  UsersRound,
  ScrollText,
  Braces,
  ListFilter,
  Package,
  FileCode,
  Network,
  Server,
  Plus,
  NetworkIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuCheckboxItem } from "@/react/components/ui/context-menu";
import { useConnectionStore } from "@/react/stores/connectionStore";
import { useQueryStore } from "@/react/stores/queryStore";
import { useSettingsStore } from "@/react/stores/settingsStore";
import { useToast } from "@/hooks/useToast";
import type { TreeNode, TreeNodeType, ColumnInfo } from "@/types/database";
import { DatabaseIcon } from "@/react/components/icons/DatabaseIcon";
import { ConnectionErrorIndicator } from "@/react/components/connection/ConnectionErrorIndicator";
import { treeItemPaddingLeft, canTreeNodeShowExpander } from "@/lib/sidebarTreeItemLayout";
import { effectiveDatabaseTypeForConnection, tableStructureDatabaseTypeForConnection } from "@/lib/jdbcDialect";
import * as api from "@/lib/api";
import { translateBackendError } from "@/i18n/backend-errors";

interface TreeItemProps {
  node: TreeNode;
  depth: number;
  dragDisabled?: boolean;
  pendingRename?: boolean;
  highlighted?: boolean;
  onNodeToggled?: (node: TreeNode, wasExpanded: boolean) => void;
  onSearchToggle?: (node: TreeNode) => void;
  onRenameStarted?: () => void;
}

interface ContextOption {
  label: string;
  icon?: React.ReactNode;
  action: () => void | Promise<void>;
  disabled?: boolean;
  danger?: boolean;
  separatorBefore?: boolean;
}

const groupTypes: Set<TreeNodeType> = new Set([
  "group-columns",
  "group-indexes",
  "group-fkeys",
  "group-triggers",
  "group-tables",
  "group-views",
  "group-materialized-views",
  "group-procedures",
  "group-functions",
  "group-sequences",
  "group-packages",
  "group-partitions",
]);

export function TreeItem({
  node,
  depth,
  dragDisabled = false,
  pendingRename = false,
  highlighted = false,
  onNodeToggled,
  onSearchToggle,
}: TreeItemProps) {
  const { t } = useTranslation();
  const connectionStore = useConnectionStore();
  const queryStore = useQueryStore();
  const settingsStore = useSettingsStore();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);

  const usesFullWidthLabel = false;
  const paddingLeft = treeItemPaddingLeft(depth);

  function getIconInfo(): { icon: React.ReactNode; colorClass: string } {
    switch (node.type) {
      case "connection":
        return { icon: null, colorClass: "" };
      case "connection-group":
        return { icon: node.isExpanded ? <FolderOpen className="h-4 w-4" /> : <FolderClosed className="h-4 w-4" />, colorClass: "text-amber-500" };
      case "database":
        return { icon: <Database className="h-4 w-4" />, colorClass: "text-yellow-500" };
      case "linked-server-root":
        return { icon: <Network className="h-4 w-4" />, colorClass: "text-blue-500" };
      case "linked-server":
        return { icon: <Server className="h-4 w-4" />, colorClass: "text-blue-400" };
      case "linked-server-catalog":
        return { icon: <Database className="h-4 w-4" />, colorClass: "text-yellow-500" };
      case "linked-server-schema":
        return { icon: <FolderOpen className="h-4 w-4" />, colorClass: "text-sky-400" };
      case "schema":
        return { icon: <FolderOpen className="h-4 w-4" />, colorClass: "text-sky-400" };
      case "table":
        return { icon: <Table className="h-4 w-4" />, colorClass: "text-green-500" };
      case "view":
        return { icon: <Eye className="h-4 w-4" />, colorClass: "text-purple-500" };
      case "materialized_view":
        return { icon: <Eye className="h-4 w-4" />, colorClass: "text-indigo-500" };
      case "column":
        if ((node.meta as ColumnInfo)?.is_primary_key) {
          return { icon: <Columns3 className="h-4 w-4" />, colorClass: "text-orange-400" };
        }
        return { icon: <Columns3 className="h-4 w-4" />, colorClass: "text-muted-foreground" };
      case "group-columns":
        return { icon: <ListTree className="h-4 w-4" />, colorClass: "text-green-400" };
      case "group-indexes":
        return { icon: <Key className="h-4 w-4" />, colorClass: "text-amber-500" };
      case "group-fkeys":
        return { icon: <Link className="h-4 w-4" />, colorClass: "text-blue-400" };
      case "group-triggers":
        return { icon: <Zap className="h-4 w-4" />, colorClass: "text-orange-400" };
      case "object-browser":
        return { icon: <TableProperties className="h-4 w-4" />, colorClass: "text-primary" };
      case "user-admin":
        return { icon: <UsersRound className="h-4 w-4" />, colorClass: "text-primary" };
      case "index":
        return { icon: <Key className="h-4 w-4" />, colorClass: "text-amber-400" };
      case "fkey":
        return { icon: <Link className="h-4 w-4" />, colorClass: "text-blue-300" };
      case "trigger":
        return { icon: <Zap className="h-4 w-4" />, colorClass: "text-orange-300" };
      case "redis-db":
        return { icon: <Database className="h-4 w-4" />, colorClass: "text-red-400" };
      case "mq-tenant":
        return { icon: <FolderOpen className="h-4 w-4" />, colorClass: "text-sky-400" };
      case "etcd-root":
        return { icon: <Database className="h-4 w-4" />, colorClass: "text-sky-500" };
      case "mongo-db":
        return { icon: <Database className="h-4 w-4" />, colorClass: "text-yellow-500" };
      case "mongo-collection":
        return { icon: <Table className="h-4 w-4" />, colorClass: "text-green-400" };
      case "elasticsearch-index":
        return { icon: <Table className="h-4 w-4" />, colorClass: "text-emerald-400" };
      case "procedure":
        return { icon: <ScrollText className="h-4 w-4" />, colorClass: "text-blue-500" };
      case "function":
        return { icon: <Braces className="h-4 w-4" />, colorClass: "text-amber-500" };
      case "sequence":
        return { icon: <ListTree className="h-4 w-4" />, colorClass: "text-emerald-500" };
      case "package":
        return { icon: <Package className="h-4 w-4" />, colorClass: "text-cyan-500" };
      case "package-body":
        return { icon: <FileCode className="h-4 w-4" />, colorClass: "text-cyan-400" };
      case "group-tables":
        return { icon: <Table className="h-4 w-4" />, colorClass: "text-green-500" };
      case "group-views":
        return { icon: <Eye className="h-4 w-4" />, colorClass: "text-purple-500" };
      case "group-materialized-views":
        return { icon: <Eye className="h-4 w-4" />, colorClass: "text-indigo-500" };
      case "group-procedures":
        return { icon: <ScrollText className="h-4 w-4" />, colorClass: "text-blue-500" };
      case "group-functions":
        return { icon: <Braces className="h-4 w-4" />, colorClass: "text-amber-500" };
      case "group-sequences":
        return { icon: <ListTree className="h-4 w-4" />, colorClass: "text-emerald-500" };
      case "group-packages":
        return { icon: <Package className="h-4 w-4" />, colorClass: "text-cyan-500" };
      case "group-partitions":
        return { icon: node.isExpanded ? <FolderOpen className="h-4 w-4" /> : <FolderClosed className="h-4 w-4" />, colorClass: "text-green-400" };
      case "load-more":
        return { icon: <Plus className="h-4 w-4" />, colorClass: "text-primary" };
      default:
        return { icon: <Database className="h-4 w-4" />, colorClass: "text-muted-foreground" };
    }
  }

  function isGroupLabel(): boolean {
    return groupTypes.has(node.type);
  }

  function displayLabel(): string {
    if (node.type === "load-more") return t(node.label);
    if (node.type === "object-browser") return t(node.label, { count: node.objectCount ?? 0 });
    if (node.type === "user-admin") return t(node.label);
    if (node.type === "linked-server-root") return t(node.label);
    if (node.label === "tree.defaultDatabase") return t(node.label);
    return isGroupLabel() ? t(node.label) : node.label;
  }

  async function handleToggle() {
    if (node.isLoading) return;
    onSearchToggle?.(node);
    const wasExpanded = !!node.isExpanded;

    if (node.type === "connection-group") {
      node.isExpanded = !node.isExpanded;
      connectionStore.toggleConnectionGroupCollapsed(node.id);
      onNodeToggled?.(node, wasExpanded);
      return;
    }

    if (node.type === "group-partitions") {
      node.isExpanded = !node.isExpanded;
      onNodeToggled?.(node, wasExpanded);
      return;
    }

    const databaseObjectGroup =
      node.type === "group-tables" ||
      node.type === "group-views" ||
      node.type === "group-materialized-views" ||
      node.type === "group-procedures" ||
      node.type === "group-functions" ||
      node.type === "group-sequences" ||
      node.type === "group-packages";

    if (databaseObjectGroup && connectionStore.isTreeNodeChildrenLoaded(node.id)) {
      node.isExpanded = !node.isExpanded;
      onNodeToggled?.(node, wasExpanded);
      return;
    }

    if (node.isExpanded) {
      node.isExpanded = false;
      onNodeToggled?.(node, wasExpanded);
      return;
    }

    try {
      setIsLoading(true);
      if (node.type === "connection" && node.connectionId) {
        const config = connectionStore.getConfig(node.connectionId);
        if (config?.db_type === "redis") {
          await connectionStore.loadRedisDatabases(node.connectionId);
        } else if (config?.db_type === "etcd") {
          await connectionStore.loadEtcdRoot(node.connectionId);
        } else if (config?.db_type === "mongodb") {
          await connectionStore.loadMongoDatabases(node.connectionId);
        } else if (config?.db_type === "elasticsearch") {
          await connectionStore.loadElasticsearchIndices(node.connectionId);
        } else if (config?.db_type === "mq") {
          await connectionStore.loadMqTenants(node.connectionId);
        } else {
          await connectionStore.loadDatabases(node.connectionId);
        }
      } else if (node.type === "database" && node.connectionId) {
        const config = connectionStore.getConfig(node.connectionId);
        const effectiveDbType = effectiveDatabaseTypeForConnection(config);
        if (config?.db_type === "sqlserver") {
          await connectionStore.loadSqlServerDatabaseObjects(node.connectionId, node.database!);
        } else {
          await connectionStore.loadTables(node.connectionId, node.database!);
        }
      } else if (node.type === "schema" && node.connectionId && node.schema) {
        await connectionStore.loadTables(node.connectionId, node.database!, node.schema);
      } else if (
        (node.type === "table" || node.type === "view" || node.type === "materialized_view") &&
        node.connectionId &&
        node.database
      ) {
        await connectionStore.loadTableGroups(node.connectionId, node.database!, node.label, node.schema, node.id);
      } else if (node.type === "group-tables" || node.type === "group-views" || node.type === "group-materialized-views") {
        await connectionStore.loadObjectGroupChildren(node);
      } else if (databaseObjectGroup) {
        await connectionStore.loadObjectGroupChildren(node);
      }
      onNodeToggled?.(node, wasExpanded);
    } catch (e: any) {
      if (!wasExpanded) node.isExpanded = false;
      const errMsg = e?.message || String(e);
      toast(t("connection.connectFailed", { message: translateBackendError(t, errMsg) }), 5000);
    } finally {
      setIsLoading(false);
    }
  }

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    connectionStore.selectedTreeNodeId = node.id;
    connectionStore.selectedTreeNodeIds = [node.id];

    if (settingsStore.editorSettings.sidebarActivation === "single") {
      handleToggle();
    }
  }

  function handleDoubleClick() {
    if (settingsStore.editorSettings.sidebarActivation === "double") {
      handleToggle();
    }
  }

  const { icon, colorClass } = getIconInfo();
  const label = displayLabel();
  const showExpander = canTreeNodeShowExpander({ type: node.type, childCount: node.children?.length });
  const isSelected = connectionStore.selectedTreeNodeId === node.id;
  const isConnected = node.connectionId ? connectionStore.connectedIds.has(node.connectionId) : false;

  const contextMenuOptions = useMemo<ContextOption[]>(() => {
    const options: ContextOption[] = [];

    if (node.type === "connection" && node.connectionId) {
      const config = connectionStore.getConfig(node.connectionId);
      if (config) {
        options.push({
          label: t("contextMenu.newQuery"),
          action: () => {
            queryStore.createTab(node.connectionId!, node.database || "", node.label, "query");
          },
        });
        options.push({
          label: t("contextMenu.editConnection"),
          action: () => {
            // Emit event to open connection dialog
          },
          separatorBefore: true,
        });
        options.push({
          label: t("contextMenu.duplicateConnection"),
          action: () => {
            // Handle duplicate
          },
        });
        options.push({
          label: t("contextMenu.deleteConnection"),
          danger: true,
          action: () => {
            connectionStore.removeConnections([node.connectionId!]);
          },
          separatorBefore: true,
        });
      }
    }

    if (node.type === "table" || node.type === "view" || node.type === "materialized_view") {
      options.push({
        label: t("contextMenu.openData"),
        action: () => {
          if (node.connectionId) {
            queryStore.createTab(node.connectionId, node.database!, node.label, "data");
          }
        },
      });
      options.push({
        label: t("contextMenu.newQuery"),
        action: () => {
          if (node.connectionId) {
            queryStore.createTab(node.connectionId, node.database!, node.label, "query");
          }
        },
      });
      options.push({
        label: t("contextMenu.refresh"),
        action: () => {
          connectionStore.refreshTreeNode(node);
        },
        separatorBefore: true,
      });
    }

    if (node.type === "database" && node.connectionId) {
      options.push({
        label: t("contextMenu.refresh"),
        action: () => {
          connectionStore.refreshTreeNode(node);
        },
      });
    }

    return options;
  }, [node, t, connectionStore, queryStore]);

  const contextMenuContent = (
    <ContextMenuContent className="min-w-[180px]">
      {contextMenuOptions.map((option, index) =>
        option.separatorBefore ? (
          <>
            <ContextMenuSeparator key={`sep-${index}`} />
            <ContextMenuItem
              key={index}
              disabled={option.disabled}
              onClick={option.action}
              className={option.danger ? "text-destructive focus:text-destructive" : ""}
            >
              {option.icon && <span className="mr-2">{option.icon}</span>}
              {option.label}
            </ContextMenuItem>
          </>
        ) : (
          <ContextMenuItem
            key={index}
            disabled={option.disabled}
            onClick={option.action}
            className={option.danger ? "text-destructive focus:text-destructive" : ""}
          >
            {option.icon && <span className="mr-2">{option.icon}</span>}
            {option.label}
          </ContextMenuItem>
        )
      )}
    </ContextMenuContent>
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={`
            group flex h-7 cursor-pointer items-center gap-1 px-1 text-xs
            ${isSelected ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"}
            ${highlighted ? "ring-2 ring-primary" : ""}
            ${isLoading ? "opacity-70" : ""}
          `}
          style={{ paddingLeft }}
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
        >
          {isLoading ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
          ) : showExpander ? (
            <button
              className="shrink-0 rounded p-0.5 hover:bg-black/10"
              onClick={(e) => {
                e.stopPropagation();
                handleToggle();
              }}
            >
              {node.isExpanded ? (
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              )}
            </button>
          ) : (
            <span className="w-4 shrink-0" />
          )}

          {node.type === "connection" && node.connectionId && (
            <>
              <DatabaseIcon
                dbType={connectionStore.getConfig(node.connectionId)?.db_type || "postgres"}
                className="h-4 w-4 shrink-0"
              />
              {!isConnected && (
                <ConnectionErrorIndicator
                  connectionId={node.connectionId}
                  triggerClass="shrink-0"
                />
              )}
            </>
          )}

          {node.type !== "connection" && icon && (
            <span className={`shrink-0 ${colorClass}`}>{icon}</span>
          )}

          <span className="truncate">{label}</span>

          {node.isLoading && (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          )}
        </div>
      </ContextMenuTrigger>
      {contextMenuOptions.length > 0 && contextMenuContent}
    </ContextMenu>
  );
}
