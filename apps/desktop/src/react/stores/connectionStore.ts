import { create } from 'zustand';
import { uuid } from "@/lib/utils";
import type { ColumnInfo, ConnectionConfig, ForeignKeyInfo, ObjectInfo, SidebarLayout, TreeNode } from "@/types/database";
import { applyPinnedTreeNodeState, updatePinnedTreeNodeInPlace } from "@/lib/pinnedItems";
import {
  reconcileLayout,
  buildTreeNodesFromLayout,
  emptyLayout,
  appendConnectionToLayout,
  removeConnectionFromSidebarLayout,
  createGroup as createGroupOp,
  renameGroup as renameGroupOp,
  deleteGroup as deleteGroupOp,
  toggleGroupCollapsed as toggleGroupCollapsedOp,
  moveConnectionToGroup as moveConnectionToGroupOp,
  remapSidebarLayoutConnectionIds,
  reorderEntry as reorderEntryOp,
  type DropPosition,
} from "@/lib/sidebarLayout";
import type { SqlCompletionColumn, SqlCompletionForeignKey, SqlCompletionObject, SqlCompletionTable } from "@/lib/sqlCompletion";
import * as api from "@/lib/api";
import { isTauriRuntime } from "@/lib/tauriRuntime";
import { isSchemaAware, normalizeSidebarObjectKind, sidebarObjectKindsForDatabase, usesTreeSchemaMode } from "@/lib/databaseCapabilities";
import { connectionObjectTreeNodeSchema, connectionObjectTreeQuerySchema, connectionUsesDatabaseObjectTreeMode, effectiveDatabaseTypeForConnection } from "@/lib/jdbcDialect";
import { buildDatabaseTreeNodes, buildDuckDbConnectionTreeNodes, sortSidebarNames, shouldIncludeDefaultDatabaseNode } from "@/lib/databaseTree";
import { buildSqlServerDatabaseTreeNodes, SQLSERVER_DEFAULT_SCHEMA } from "@/lib/sqlServerTree";
import { findDatabaseTreeNode } from "@/lib/treeRefreshTarget";
import { shouldMarkDisconnected } from "@/lib/connectionHealth";
import { connectionAttemptTimeoutMessage, connectionAttemptTimeoutMs } from "@/lib/connectionAttemptTimeout";
import { filterDatabaseNamesForConnection, filterVisibleDatabaseNames, normalizeVisibleDatabaseSelection } from "@/lib/visibleDatabases";
import {
  buildObjectGroupPlaceholderNodes,
  buildGroupedObjectTreeNodes,
  buildSimpleObjectTreeNodes,
  buildTableTreeNodes,
  expandCachedObjectBrowserNodes,
  mergeTableInfosIntoObjects,
  objectGroupRefreshParentId,
  objectTypesForGroupNode,
  tablePartitionGroups,
  type DatabaseObjectTreeKind,
} from "@/lib/tableTree";
import { hasTreeNodeDatabaseContext, normalizeCataloglessDatabaseNodes, treeNodeSchemaCachePrefix } from "@/lib/treeNodeContext";
import { decodeSchemaTreeCache, encodeSchemaTreeCache } from "@/lib/schemaTreeCache";
import { sortSidebarTreeChildrenForParent } from "@/lib/sidebarNodeOrdering";
import { prunePinnedTreeNodeIdsForConnection } from "@/lib/pinnedTreeNodeIds";
import { supportsDatabaseUserAdmin } from "@/lib/databaseUserAdmin";
import { getTableMetadataCapabilities } from "@/lib/tableMetadataCapabilities";
import { useSettingsStore } from "./settingsStore";
import { encodeSqlServerLinkedSchema, parseSqlServerLinkedSchema } from "@/lib/sqlServerLinkedServers";

const PINNED_TREE_NODES_STORAGE_KEY = "dbx-pinned-tree-nodes";
const ACTIVE_CONNECTION_STORAGE_KEY = "dbx-active-connection";

function sidebarObjectGroupPageSize(): number {
  const settingsStore = useSettingsStore();
  const size = settingsStore.desktopSettings.sidebar_table_page_size;
  return typeof size === "number" && size > 0 ? size : 500;
}

type ImportSource = "dbx" | "navicat" | "dbeaver" | "datagrip";

function nodeIdPart(value: string): string {
  return encodeURIComponent(value);
}

function sqlServerLinkedRootId(connectionId: string): string {
  return `${connectionId}:__linked_servers`;
}

function sqlServerLinkedServerId(connectionId: string, server: string): string {
  return `${sqlServerLinkedRootId(connectionId)}:${nodeIdPart(server)}`;
}

function sqlServerLinkedCatalogId(connectionId: string, server: string, catalog: string): string {
  return `${sqlServerLinkedServerId(connectionId, server)}:${nodeIdPart(catalog)}`;
}

function sqlServerLinkedRuntimeDatabase(config?: ConnectionConfig): string {
  return config?.database?.trim() || "master";
}

function sqlServerLinkedRootNode(connectionId: string, database: string): TreeNode {
  return {
    id: sqlServerLinkedRootId(connectionId),
    label: "tree.linkedServers",
    type: "linked-server-root",
    connectionId,
    database,
    isExpanded: false,
    children: [],
  };
}

function ensureSqlServerLinkedRootNode(connectionId: string, children: TreeNode[], config?: ConnectionConfig): TreeNode[] {
  if (config?.db_type !== "sqlserver") return children;
  if (children.some((child) => child.type === "linked-server-root" || child.id === sqlServerLinkedRootId(connectionId))) {
    return children;
  }
  return [...children, sqlServerLinkedRootNode(connectionId, sqlServerLinkedRuntimeDatabase(config))];
}

interface TreeClipboardTableStructure {
  kind: "table-structure";
  connectionId: string;
  database: string;
  schema?: string;
  tableName: string;
}

interface LoadTreeOptions {
  force?: boolean;
}

interface PersistedTreeChildrenLoadResult {
  hit: boolean;
  isStale: boolean;
}

type BeforeConnectHandler = (config: ConnectionConfig) => Promise<void>;

function redisDbLabel(db: number, _loadedKeyCount?: number, totalKeyCount?: number): string {
  if (totalKeyCount == null) return `db${db}`;
  return `db${db} (${totalKeyCount})`;
}

export interface ConnectionStoreState {
  connections: ConnectionConfig[];
  activeConnectionId: string | null;
  selectedTreeNodeId: string | null;
  selectedTreeNodeIds: string[];
  treeSelectionAnchorId: string | null;
  treeClipboard: TreeClipboardTableStructure | null;
  treeNodes: TreeNode[];
  connectedIds: Set<string>;
  connectionErrors: Record<string, string>;
  editingConnectionId: string | null;
  newConnectionGroupId: string | null;
  sidebarLayout: SidebarLayout;
  sidebarSearchQuery: string;
  transferSource: { connectionId: string; database: string } | null;
  schemaDiffSource: { connectionId: string; database: string; schema?: string } | null;
  dataCompareSource: { connectionId: string; database: string; schema?: string; tableName?: string } | null;
  sqlFileSource: { connectionId: string; database: string } | null;
  diagramSource: { connectionId: string; database: string; schema?: string; tableName?: string } | null;
  tableImportSource: { connectionId: string; database: string; schema?: string; tableName: string } | null;
  tableDataGenerateSource: { connectionId: string; database: string; schema?: string; tableName: string } | null;
  fieldLineageSource: { connectionId: string; database: string; schema?: string; tableName: string; columnName: string } | null;
  databaseSearchSource: { connectionId: string; database: string; schema?: string } | null;
  databaseExportSource: { connectionId: string; database: string; schema?: string; tableName?: string; tableNames?: string[] } | null;
  pinnedTreeNodeIds: Set<string>;
  loadedTreeNodeChildrenIds: Set<string>;
  completionTablesCache: Record<string, SqlCompletionTable[]>;
  completionObjectsCache: Record<string, SqlCompletionObject[]>;
  completionColumnsCache: Record<string, ColumnInfo[]>;
  completionForeignKeysCache: Record<string, ForeignKeyInfo[]>;
  completionDatabasesCache: Record<string, string[]>;
  elasticsearchCompletionIndicesCache: Record<string, string[]>;
  redisCompletionKeysCache: Record<string, string[]>;
  schemaListCache: Record<string, string[]>;
  getConfig: (connectionId: string) => ConnectionConfig | undefined;
  setConnectionError: (connectionId: string, message: string) => void;
  clearConnectionError: (connectionId: string) => void;
  recordConnectionError: (connectionId: string, error: unknown) => string;
  normalizeConnection: (config: ConnectionConfig) => ConnectionConfig;
  loadPinnedTreeNodeIds: () => Promise<Set<string>>;
  persistPinnedTreeNodeIds: () => void;
  isTreeNodePinned: (id: string) => boolean;
  toggleTreeNodePin: (id: string) => void;
  setChildren: (parent: TreeNode, children: TreeNode[]) => void;
  removeTreeNode: (nodeId: string) => void;
  findNode: (nodes: TreeNode[], id: string) => TreeNode | null;
  isTreeNodeChildrenLoaded: (nodeId: string) => boolean;
  clearLoadedChildrenCache: (prefix: string) => void;
  schemaCachePrefixForNode: (node: TreeNode) => string | null;
  addConnection: (config: ConnectionConfig) => Promise<void>;
  updateConnection: (config: ConnectionConfig) => Promise<void>;
  setDefaultDatabase: (connectionId: string, database: string) => Promise<void>;
  clearDefaultDatabase: (connectionId: string) => Promise<void>;
  isDefaultDatabase: (connectionId: string, database: string) => boolean;
  setVisibleDatabases: (connectionId: string, databaseNames: string[]) => Promise<void>;
  clearVisibleDatabases: (connectionId: string) => Promise<void>;
  removeConnection: (id: string) => Promise<void>;
  connect: (config: ConnectionConfig) => Promise<string>;
  disconnect: (connectionId: string) => Promise<void>;
  closeDatabaseConnection: (connectionId: string, database: string) => Promise<void>;
  ensureConnected: (connectionId: string) => Promise<void>;
  setBeforeConnectHandler: (handler: BeforeConnectHandler | null) => void;
  initFromDisk: () => Promise<void>;
  loadDatabases: (connectionId: string, options?: LoadTreeOptions) => Promise<void>;
  loadRedisDatabases: (connectionId: string) => Promise<void>;
  loadEtcdRoot: (connectionId: string) => Promise<void>;
  loadMqTenants: (connectionId: string, options?: LoadTreeOptions) => Promise<void>;
  loadMongoDatabases: (connectionId: string) => Promise<void>;
  loadElasticsearchIndices: (connectionId: string) => Promise<void>;
  loadMongoCollections: (connectionId: string, database: string) => Promise<void>;
  loadSchemas: (connectionId: string, database: string, options?: LoadTreeOptions) => Promise<void>;
  loadSqlServerDatabaseObjects: (connectionId: string, database: string, options?: LoadTreeOptions) => Promise<void>;
  loadSqlServerLinkedServers: (connectionId: string, options?: LoadTreeOptions) => Promise<void>;
  loadSqlServerLinkedServerCatalogs: (node: TreeNode, options?: LoadTreeOptions) => Promise<void>;
  loadSqlServerLinkedServerSchemas: (node: TreeNode, options?: LoadTreeOptions) => Promise<void>;
  loadTables: (connectionId: string, database: string, schema?: string, options?: LoadTreeOptions) => Promise<void>;
  loadObjectGroupChildren: (node: TreeNode, options?: LoadTreeOptions) => Promise<void>;
  loadMoreObjectGroupChildren: (node: TreeNode) => Promise<void>;
  loadTableGroups: (connectionId: string, database: string, table: string, schema?: string, nodeId?: string) => Promise<void>;
  loadColumns: (connectionId: string, database: string, table: string, schema?: string, nodeId?: string) => Promise<void>;
  loadIndexes: (connectionId: string, database: string, table: string, schema?: string, nodeId?: string) => Promise<void>;
  loadForeignKeys: (connectionId: string, database: string, table: string, schema?: string, nodeId?: string) => Promise<void>;
  loadTriggers: (connectionId: string, database: string, table: string, schema?: string, nodeId?: string) => Promise<void>;
  loadTreeNodeChildren: (node: TreeNode, options?: LoadTreeOptions) => Promise<void>;
  refreshTreeNode: (node: TreeNode) => Promise<void>;
  refreshDatabaseTreeNode: (connectionId: string, database: string) => Promise<void>;
  refreshObjectListTreeNode: (connectionId: string, database: string, schema?: string) => Promise<void>;
  refreshRedisDbKeyCounts: (connectionId: string) => Promise<void>;
  invalidateCompletionCache: (connectionId: string, database?: string) => void;
  listCompletionTables: (connectionId: string, database: string, filter?: string, limit?: number, schema?: string) => Promise<SqlCompletionTable[]>;
  listCompletionObjects: (connectionId: string, database: string, filter?: string, limit?: number, schema?: string) => Promise<SqlCompletionObject[]>;
  listCompletionColumns: (connectionId: string, database: string, table: string, schema?: string) => Promise<SqlCompletionColumn[]>;
  listCompletionForeignKeys: (connectionId: string, database: string, table: string, schema?: string) => Promise<SqlCompletionForeignKey[]>;
  listCompletionSchemas: (connectionId: string, database: string) => Promise<string[]>;
  listCompletionDatabases: (connectionId: string) => Promise<string[]>;
  listElasticsearchCompletionIndices: (connectionId: string, database: string) => Promise<string[]>;
  listRedisCompletionKeys: (connectionId: string, database: string) => Promise<string[]>;
  lookupLocalCompletionTables: (connectionId: string, database: string, filter?: string, limit?: number, schema?: string) => SqlCompletionTable[];
  lookupLocalCompletionObjects: (connectionId: string, database: string, filter?: string, limit?: number, schema?: string) => SqlCompletionObject[];
  lookupLocalCompletionColumns: (connectionId: string, database: string, table: string, schema?: string) => SqlCompletionColumn[];
  lookupLocalCompletionForeignKeys: (connectionId: string, database: string, table: string, schema?: string) => SqlCompletionForeignKey[];
  lookupLocalCompletionSchemas: (connectionId: string, database: string, filter?: string, limit?: number) => string[];
  lookupLocalCompletionDatabases: (connectionId: string, filter?: string, limit?: number) => string[];
  refreshCompletionTables: (connectionId: string, database: string, filter?: string, limit?: number, schema?: string) => Promise<SqlCompletionTable[]>;
  refreshCompletionObjects: (connectionId: string, database: string, filter?: string, limit?: number, schema?: string) => Promise<SqlCompletionObject[]>;
  refreshCompletionColumns: (connectionId: string, database: string, table: string, schema?: string) => Promise<SqlCompletionColumn[]>;
  refreshCompletionForeignKeys: (connectionId: string, database: string, table: string, schema?: string) => Promise<SqlCompletionForeignKey[]>;
  refreshCompletionSchemas: (connectionId: string, database: string) => Promise<string[]>;
  refreshCompletionDatabases: (connectionId: string) => Promise<string[]>;
  refreshAllTree: () => Promise<void>;
  exportConnectionsToFile: (passphrase: string) => Promise<void>;
  readImportFile: (source?: ImportSource) => Promise<{ content: string; encrypted: boolean } | null>;
  importConnectionsFromFile: (content: string, passphrase: string | null) => Promise<{ count: number; layout?: SidebarLayout }>;
  applyDataGripKeychainPasswords: () => Promise<number>;
  applySidebarLayout: (layout: SidebarLayout) => void;
  createConnectionGroup: (name: string, parentGroupId?: string | null) => string;
  renameConnectionGroup: (groupId: string, name: string) => void;
  deleteConnectionGroup: (groupId: string) => void;
  toggleConnectionGroupCollapsed: (groupId: string) => void;
  moveConnectionToGroup: (connectionId: string, groupId: string | null) => void;
  reorderSidebarEntry: (draggedId: string, targetId: string, position: DropPosition) => void;
  reorderSidebarEntries: (draggedIds: string[], targetId: string, position: DropPosition) => void;
  startEditing: (id: string) => void;
  stopEditing: () => void;
  startCreatingConnectionInGroup: (groupId: string) => void;
  stopCreatingConnectionInGroup: () => void;
  rebuildTreeNodes: () => void;
  reloadConnectionDatabaseChildren: (connectionId: string) => Promise<void>;
}

const COMPLETION_CACHE_MAX = 50;
const REDIS_COMPLETION_KEYS_MAX = 1000;

export const useConnectionStore = create<ConnectionStoreState>((set, get) => {
  let layoutPersistTimer: ReturnType<typeof setTimeout> | null = null;
  const staleTreeRefreshIds = new Set<string>();
  let beforeConnectHandler: BeforeConnectHandler | null = null;
  let initFromDiskPromise: Promise<void> | null = null;

  function configById() {
    return new Map(get().connections.map((c) => [c.id, c]));
  }

  function connectionErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
  }

  function recordMetadataLoadError(connectionId: string, error: unknown) {
    if (shouldMarkDisconnected(error)) {
      const connectedIds = new Set(get().connectedIds);
      connectedIds.delete(connectionId);
      set({ connectedIds });
      if (get().activeConnectionId === connectionId) {
        set({ activeConnectionId: null });
      }
    }
    recordConnectionError(connectionId, error);
  }

  async function withConnectionAttemptTimeout<T>(promise: Promise<T>, config: ConnectionConfig): Promise<T> {
    const timeoutMs = connectionAttemptTimeoutMs(config);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(connectionAttemptTimeoutMessage(timeoutMs))), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function normalizeConnection(config: ConnectionConfig): ConnectionConfig {
    const labelMap: Record<string, string> = {
      mysql: "MySQL",
      postgres: "PostgreSQL",
      sqlite: "SQLite",
      redis: "Redis",
      etcd: "etcd",
      duckdb: "DuckDB",
      clickhouse: "ClickHouse",
      sqlserver: "SQL Server",
      mongodb: "MongoDB",
      oracle: "Oracle",
      elasticsearch: "Elasticsearch",
      doris: "Doris",
      starrocks: "StarRocks",
      manticoresearch: "Manticore Search",
      redshift: "Redshift",
      dameng: "DM (Dameng)",
      gaussdb: "GaussDB",
      questdb: "QuestDB",
      kwdb: "KWDB",
      kingbase: "KingBase",
      highgo: "瀚高 HighGo",
      yashandb: "崖山 YashanDB",
      vastbase: "Vastbase",
      goldendb: "GoldenDB",
      access: "Microsoft Access",
      h2: "H2",
      snowflake: "Snowflake",
      trino: "Trino",
      hive: "Hive",
      db2: "DB2",
      informix: "Informix",
      neo4j: "Neo4j",
      cassandra: "Cassandra",
      bigquery: "BigQuery",
      kylin: "Kylin",
      sundb: "SunDB",
      influxdb: "InfluxDB",
    };

    const profile = config.driver_profile || config.db_type;
    let dbType = config.db_type;
    if ((profile === "gaussdb" || profile === "opengauss") && dbType === "postgres") {
      dbType = "gaussdb" as ConnectionConfig["db_type"];
    } else if (profile === "kwdb" && dbType === "postgres") {
      dbType = "kwdb" as ConnectionConfig["db_type"];
    } else if (profile === "questdb" && dbType === "postgres") {
      dbType = "questdb" as ConnectionConfig["db_type"];
    } else if (profile === "redshift" && dbType === "postgres") {
      dbType = "redshift" as ConnectionConfig["db_type"];
    } else if (profile === "kingbase" && dbType === "postgres") {
      dbType = "kingbase" as ConnectionConfig["db_type"];
    } else if (profile === "highgo" && dbType === "postgres") {
      dbType = "highgo" as ConnectionConfig["db_type"];
    } else if (profile === "vastbase" && dbType === "postgres") {
      dbType = "vastbase" as ConnectionConfig["db_type"];
    } else if (profile === "goldendb" && dbType === "mysql") {
      dbType = "goldendb" as ConnectionConfig["db_type"];
    }

    return {
      ...config,
      db_type: dbType,
      driver_profile: profile,
      driver_label: config.driver_label || labelMap[profile] || config.db_type,
      url_params: config.url_params || "",
      attached_databases: Array.isArray(config.attached_databases) ? config.attached_databases.filter((database) => database.name?.trim() && database.path?.trim()) : [],
      transport_layers: Array.isArray(config.transport_layers) ? config.transport_layers : [],
      connect_timeout_secs: config.connect_timeout_secs || 5,
      query_timeout_secs: config.query_timeout_secs ?? 30,
      idle_timeout_secs: config.idle_timeout_secs ?? 60,
      keepalive_interval_secs: config.keepalive_interval_secs ?? 0,
    };
  }

  function loadPinnedTreeNodeIdsFromLocalStorage(): Set<string> {
    try {
      if (typeof localStorage === "undefined") return new Set();
      const saved = localStorage.getItem(PINNED_TREE_NODES_STORAGE_KEY);
      const ids = saved ? JSON.parse(saved) : [];
      return new Set(Array.isArray(ids) ? ids.filter((id: string) => typeof id === "string") : []);
    } catch {
      return new Set();
    }
  }

  async function loadPinnedTreeNodeIdsFromDisk(): Promise<Set<string>> {
    const isDesktop = isTauriRuntime();
    if (!isDesktop) return loadPinnedTreeNodeIdsFromLocalStorage();
    const ids = await api.loadPinnedTreeNodeIds().catch(() => []);
    const valid = ids.filter((id: string) => typeof id === "string");
    if (valid.length > 0) return new Set(valid);

    const legacy = loadPinnedTreeNodeIdsFromLocalStorage();
    if (legacy.size > 0) {
      await api.savePinnedTreeNodeIds([...legacy]).catch(() => undefined);
      if (typeof localStorage !== "undefined") {
        localStorage.removeItem(PINNED_TREE_NODES_STORAGE_KEY);
      }
    }
    return legacy;
  }

  function persistPinnedTreeNodeIds() {
    const isDesktop = isTauriRuntime();
    if (isDesktop) {
      void api.savePinnedTreeNodeIds([...get().pinnedTreeNodeIds]).catch(() => undefined);
      return;
    }
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(PINNED_TREE_NODES_STORAGE_KEY, JSON.stringify([...get().pinnedTreeNodeIds]));
  }

  function isTreeNodePinned(id: string): boolean {
    return get().pinnedTreeNodeIds.has(id);
  }

  function setChildren(parent: TreeNode, children: TreeNode[]) {
    if (parent.children && parent.children.length > 0) {
      const oldMap = new Map(parent.children.map((c) => [c.id, c] as const));
      children = children.map((child) => {
        const old = oldMap.get(child.id);
        if (old && old.isExpanded && old.children && old.children.length > 0) {
          return { ...child, isExpanded: true, children: old.children };
        }
        return child;
      });
    }
    parent.children = applyPinnedTreeNodeState(children, get().pinnedTreeNodeIds);
    const loadedTreeNodeChildrenIds = new Set(get().loadedTreeNodeChildrenIds);
    loadedTreeNodeChildrenIds.add(parent.id);
    set({ loadedTreeNodeChildrenIds });
  }

  function removeTreeNode(nodeId: string) {
    const treeNodes = get().treeNodes;
    const parent = findParentNode(treeNodes, nodeId);
    if (parent?.children) {
      parent.children = parent.children.filter((c) => c.id !== nodeId);
    }
    const selectedTreeNodeId = get().selectedTreeNodeId === nodeId ? null : get().selectedTreeNodeId;
    const selectedTreeNodeIds = get().selectedTreeNodeIds.filter((id) => id !== nodeId);
    const treeSelectionAnchorId = get().treeSelectionAnchorId === nodeId ? null : get().treeSelectionAnchorId;
    set({ selectedTreeNodeId, selectedTreeNodeIds, treeSelectionAnchorId });
  }

  function buildUserAdminNode(connectionId: string, existingConnectionNode?: TreeNode): TreeNode | undefined {
    const config = getConfig(connectionId);
    if (!supportsDatabaseUserAdmin(effectiveDatabaseTypeForConnection(config))) return undefined;
    const existing = existingConnectionNode?.children?.find((child) => child.type === "user-admin");
    return {
      id: `${connectionId}:__user_admin`,
      label: "tree.userAdmin",
      type: "user-admin",
      connectionId,
      database: "",
      isExpanded: existing?.isExpanded ?? false,
    };
  }

  function withConnectionUtilityNodes(connectionId: string, children: TreeNode[], existingConnectionNode?: TreeNode): TreeNode[] {
    const nonUtilityChildren = children.filter((child) => child.type !== "user-admin");
    const userAdminNode = buildUserAdminNode(connectionId, existingConnectionNode);
    return [...nonUtilityChildren, userAdminNode].filter(Boolean) as TreeNode[];
  }

  function withSavedSqlRoot(connectionId: string, children: TreeNode[], existingConnectionNode?: TreeNode): TreeNode[] {
    return withConnectionUtilityNodes(connectionId, children, existingConnectionNode);
  }

  function schemaCacheKey(...parts: string[]): string {
    return parts.map((part) => encodeURIComponent(part)).join(":");
  }

  function supportedSidebarObjectTypes(config?: ConnectionConfig): DatabaseObjectTreeKind[] {
    const dbType = effectiveDatabaseTypeForConnection(config);
    return sidebarObjectKindsForDatabase(dbType);
  }

  function objectGroupCacheKey(node: TreeNode): string {
    return schemaCacheKey(node.connectionId || "", node.database || "", node.schema || "", node.type, "objects-v2");
  }

  function buildLoadMoreNode(parent: TreeNode, offset: number, pageSize: number): TreeNode {
    return {
      id: `${parent.id}:__load_more:${offset}`,
      label: "tree.loadMore",
      type: "load-more",
      connectionId: parent.connectionId,
      database: parent.database,
      schema: parent.schema,
      isLoading: false,
      loadMore: {
        parentId: parent.id,
        offset,
        pageSize,
      },
    };
  }

  function withoutLoadMoreNodes(children: TreeNode[] | undefined): TreeNode[] {
    return (children || []).filter((child) => child.type !== "load-more");
  }

  function objectGroupChildrenFromObjects(options: { node: TreeNode; parentNodeId: string; effectiveSchema?: string; objectTypes: DatabaseObjectTreeKind[]; objects: ObjectInfo[] }): TreeNode[] {
    const grouped = buildGroupedObjectTreeNodes({
      nodeId: options.parentNodeId,
      connectionId: options.node.connectionId || "",
      database: options.node.database || "",
      schema: options.effectiveSchema,
      objects: options.objects.filter((object) => options.objectTypes.includes(normalizedObjectTreeKind(object.object_type))),
    });
    const refreshedGroup = grouped.find((group) => group.type === options.node.type);
    return refreshedGroup?.children ?? [];
  }

  async function loadPagedTableGroupChildren(options: {
    node: TreeNode;
    parentNodeId: string;
    querySchema: string;
    effectiveSchema?: string;
    objectTypes: DatabaseObjectTreeKind[];
    offset: number;
    pageSize: number;
  }): Promise<{ children: TreeNode[]; objectCount: number; hasMore: boolean; nextOffset: number }> {
    if (!options.node.connectionId || !options.node.database) {
      return { children: [], objectCount: 0, hasMore: false, nextOffset: options.offset };
    }
    const searchFilter = get().sidebarSearchQuery || undefined;
    const fetchLimit = searchFilter ? undefined : options.pageSize + 1;
    const tables = await api.listTables(options.node.connectionId, options.node.database, options.querySchema, searchFilter, fetchLimit, searchFilter ? undefined : options.offset, options.objectTypes);
    const hasMore = searchFilter ? false : tables.length > options.pageSize;
    const pageTables = hasMore ? tables.slice(0, options.pageSize) : tables;
    const objects = mergeTableInfosIntoObjects([], pageTables, options.effectiveSchema);
    const visibleObjectCount = objects.filter((object) => options.objectTypes.includes(normalizedObjectTreeKind(object.object_type))).length;
    return {
      children: objectGroupChildrenFromObjects({
        node: options.node,
        parentNodeId: options.parentNodeId,
        effectiveSchema: options.effectiveSchema,
        objectTypes: options.objectTypes,
        objects,
      }),
      objectCount: visibleObjectCount,
      hasMore,
      nextOffset: options.offset + pageTables.length,
    };
  }

  function refreshStaleTreeNode(node: TreeNode) {
    if (staleTreeRefreshIds.has(node.id)) return;
    staleTreeRefreshIds.add(node.id);
    const expandedIds = collectExpandedNodeIds([node]);
    clearLoadedChildrenCache(node.id);
    void loadTreeNodeChildren(node, { force: true })
      .then(() => restoreExpandedChildren(node, expandedIds, { force: true }))
      .finally(() => staleTreeRefreshIds.delete(node.id));
  }

  async function loadPersistedTreeChildren(node: TreeNode, cacheKey: string): Promise<PersistedTreeChildrenLoadResult> {
    const payload = await api.loadSchemaCache<unknown>(cacheKey).catch(() => null);
    const decoded = decodeSchemaTreeCache<TreeNode[]>(payload);
    if (!decoded) return { hit: false, isStale: false };
    const config = node.connectionId ? get().getConfig(node.connectionId) : undefined;
    const cachedChildren = normalizeCataloglessDatabaseNodes(expandCachedObjectBrowserNodes(decoded.children));
    const childrenWithLinkedServers = node.type === "connection" && node.connectionId ? ensureSqlServerLinkedRootNode(node.connectionId, cachedChildren, config) : cachedChildren;
    const normalizedChildren = sortSidebarTreeChildrenForParent(node, childrenWithLinkedServers, config?.db_type);
    setChildren(node, node.type === "connection" && node.connectionId ? withSavedSqlRoot(node.connectionId, normalizedChildren, node) : normalizedChildren);
    node.isExpanded = true;
    return { hit: true, isStale: decoded.isStale };
  }

  async function savePersistedTreeChildren(cacheKey: string, children: TreeNode[]) {
    await api.saveSchemaCache(cacheKey, encodeSchemaTreeCache(children)).catch(() => undefined);
  }

  function useCachedChildren(node: TreeNode, options?: LoadTreeOptions): boolean {
    if (options?.force || !get().loadedTreeNodeChildrenIds.has(node.id)) return false;
    if (node.type === "connection" && node.connectionId) {
      const normalizedChildren = sortSidebarTreeChildrenForParent(node, withSavedSqlRoot(node.connectionId, node.children || [], node), get().getConfig(node.connectionId)?.db_type);
      setChildren(node, normalizedChildren);
    }
    node.isExpanded = true;
    return true;
  }

  function isTreeNodeChildrenLoaded(nodeId: string): boolean {
    return get().loadedTreeNodeChildrenIds.has(nodeId);
  }

  function clearLoadedChildrenCache(prefix: string) {
    const loadedTreeNodeChildrenIds = new Set(get().loadedTreeNodeChildrenIds);
    for (const id of loadedTreeNodeChildrenIds) {
      if (id === prefix || id.startsWith(`${prefix}:`)) {
        loadedTreeNodeChildrenIds.delete(id);
      }
    }
    set({ loadedTreeNodeChildrenIds });
    const rawPrefix = `${prefix}:`;
    const encodedPrefix = `${schemaCacheKey(prefix)}:`;
    if (rawPrefix === encodedPrefix) {
      api.deleteSchemaCachePrefix(rawPrefix).catch(() => undefined);
    } else {
      Promise.all([api.deleteSchemaCachePrefix(rawPrefix), api.deleteSchemaCachePrefix(encodedPrefix)]).catch(() => undefined);
    }
  }

  function schemaCachePrefixForNode(node: TreeNode): string | null {
    return treeNodeSchemaCachePrefix(node);
  }

  function findParentNode(nodes: TreeNode[], id: string, parent: TreeNode | null = null): TreeNode | null {
    for (const node of nodes) {
      if (node.id === id) return parent;
      if (node.children) {
        const found = findParentNode(node.children, id, node);
        if (found) return found;
      }
    }
    return null;
  }

  function findNode(nodes: TreeNode[], id: string): TreeNode | null {
    for (const node of nodes) {
      if (node.id === id) return node;
      if (node.children) {
        const found = findNode(node.children, id);
        if (found) return found;
      }
    }
    return null;
  }

  function toggleTreeNodePin(id: string) {
    const pinnedTreeNodeIds = new Set(get().pinnedTreeNodeIds);
    if (pinnedTreeNodeIds.has(id)) pinnedTreeNodeIds.delete(id);
    else pinnedTreeNodeIds.add(id);
    set({ pinnedTreeNodeIds });

    const scope = updatePinnedTreeNodeInPlace(get().treeNodes, id, pinnedTreeNodeIds.has(id));
    if (scope === "root") get().rebuildTreeNodes();
    get().persistPinnedTreeNodeIds();
  }

  async function persistConnections(nextConnections?: ConnectionConfig[]) {
    const conns = nextConnections ?? get().connections;
    await api.saveConnections(conns);
  }

  function persistSidebarLayoutDebounced() {
    if (layoutPersistTimer) clearTimeout(layoutPersistTimer);
    layoutPersistTimer = setTimeout(() => {
      api.saveSidebarLayout(get().sidebarLayout).catch(() => {});
      layoutPersistTimer = null;
    }, 300);
  }

  function updateLayoutAndRebuild(nextLayout: SidebarLayout) {
    set({ sidebarLayout: nextLayout });
    get().rebuildTreeNodes();
    persistSidebarLayoutDebounced();
  }

  function rebuildTreeNodes() {
    const existingNodesMap = new Map<string, TreeNode>();
    const collectExisting = (nodes: TreeNode[]) => {
      for (const node of nodes) {
        existingNodesMap.set(node.id, node);
        if (node.children) collectExisting(node.children);
      }
    };
    collectExisting(get().treeNodes);

    const freshNodes = buildTreeNodesFromLayout(get().sidebarLayout, get().connections, get().pinnedTreeNodeIds);
    const mergeState = (nodes: TreeNode[]): TreeNode[] =>
      nodes.map((node) => {
        const existing = existingNodesMap.get(node.id);
        if (node.type === "connection-group") {
          return { ...node, children: mergeState(node.children || []) };
        }
        if (existing && node.type === "connection") {
          return {
            ...existing,
            label: node.label,
            pinned: node.pinned,
            children: withSavedSqlRoot(node.connectionId!, existing.children || [], existing),
          };
        }
        if (node.type === "connection" && node.connectionId) {
          return { ...node, children: withSavedSqlRoot(node.connectionId, node.children || []) };
        }
        return node;
      });
    set({ treeNodes: mergeState(freshNodes) });
  }

  function collectExpandedNodeIds(nodes: TreeNode[], ids = new Set<string>()): Set<string> {
    for (const node of nodes) {
      if (node.isExpanded) ids.add(node.id);
      if (node.children) collectExpandedNodeIds(node.children, ids);
    }
    return ids;
  }

  function normalizedObjectTreeKind(type: string): DatabaseObjectTreeKind {
    return normalizeSidebarObjectKind(type);
  }

  function evictOldestCacheEntries(cache: Record<string, unknown>, max: number) {
    const keys = Object.keys(cache);
    if (keys.length <= max) return;
    const toRemove = keys.slice(0, keys.length - max);
    for (const key of toRemove) {
      delete cache[key];
    }
  }

  function completionScopeKey(connectionId: string, database: string, schema?: string): string {
    return `${connectionId}:${database}:${schema ?? ""}`;
  }

  function completionColumnsKey(connectionId: string, database: string, table: string, schema?: string): string {
    return `${completionScopeKey(connectionId, database, schema)}:${table.toLowerCase()}`;
  }

  function completionForeignKeysKey(connectionId: string, database: string, table: string, schema?: string): string {
    return `${completionScopeKey(connectionId, database, schema)}:${table.toLowerCase()}:fkeys`;
  }

  const completionTableIndex = new Map<string, { touched: number; tables: SqlCompletionTable[] }>();
  const completionObjectIndex = new Map<string, { touched: number; objects: SqlCompletionObject[] }>();
  const completionColumnIndex = new Map<string, { touched: number; columns: SqlCompletionColumn[] }>();
  const completionForeignKeyIndex = new Map<string, { touched: number; foreignKeys: SqlCompletionForeignKey[] }>();
  const completionInFlight = new Map<string, Promise<unknown>>();

  function touchCompletionIndex<T>(index: Map<string, { touched: number } & T>, key: string, value: T, max = COMPLETION_CACHE_MAX) {
    index.set(key, { ...value, touched: Date.now() });
    if (index.size <= max) return;
    const oldest = [...index.entries()].sort(([, a], [, b]) => a.touched - b.touched).slice(0, index.size - max);
    for (const [oldKey] of oldest) index.delete(oldKey);
  }

  function withCompletionInFlight<T>(key: string, load: () => Promise<T>): Promise<T> {
    const existing = completionInFlight.get(key) as Promise<T> | undefined;
    if (existing) return existing;
    const promise = load().finally(() => {
      if (completionInFlight.get(key) === promise) completionInFlight.delete(key);
    });
    completionInFlight.set(key, promise);
    return promise;
  }

  function completionNameSegments(name: string): string[] {
    return name
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .split(/[\s_.:-]+/)
      .map((segment) => segment.trim().toLowerCase())
      .filter(Boolean);
  }

  function completionNameAcronym(name: string): string {
    return completionNameSegments(name)
      .map((segment) => segment[0])
      .join("");
  }

  function orderedSubsequenceScore(text: string, filter: string): number {
    let index = 0;
    let gaps = 0;
    for (const ch of filter) {
      const found = text.indexOf(ch, index);
      if (found < 0) return -1;
      gaps += found - index;
      index = found + 1;
    }
    return 1_000 - gaps - text.length;
  }

  function tableMatchScore(table: SqlCompletionTable, filter: string, preferredSchema?: string): number {
    const text = table.name.toLowerCase();
    const schema = table.schema?.toLowerCase();
    const normalized = filter.trim().toLowerCase();
    let score = schema && preferredSchema && schema === preferredSchema.toLowerCase() ? 10_000 : 0;
    if (!normalized) return score;
    if (text === normalized) return score + 9_000 - text.length;
    if (text.startsWith(normalized)) return score + 7_500 - text.length;
    const segments = completionNameSegments(table.name);
    if (segments.some((segment) => segment.startsWith(normalized))) return score + 7_200 - text.length;
    const acronym = completionNameAcronym(table.name);
    if (acronym === normalized) return score + 7_100 - text.length;
    if (acronym.startsWith(normalized)) return score + 6_900 - text.length;
    if (normalized.length <= segments.length && segments.every((segment, index) => segment.startsWith(normalized[index] ?? ""))) return score + 6_700 - text.length;
    if (text.includes(normalized)) return score + 4_000 - text.length;
    const subsequenceScore = orderedSubsequenceScore(text, normalized);
    return subsequenceScore < 0 ? -1 : score + subsequenceScore;
  }

  function objectMatchScore(object: SqlCompletionObject, filter: string, preferredSchema?: string): number {
    const tableLike: SqlCompletionTable = { name: object.name, schema: object.schema };
    return tableMatchScore(tableLike, filter, preferredSchema);
  }

  function indexCompletionTables(connectionId: string, database: string, schema: string | undefined, tables: SqlCompletionTable[]) {
    const groups = new Map<string, SqlCompletionTable[]>();
    for (const table of tables) {
      const tableSchema = table.schema ?? schema;
      const key = completionScopeKey(connectionId, database, tableSchema);
      const list = groups.get(key) ?? [];
      list.push({ ...table, schema: tableSchema });
      groups.set(key, list);
    }
    for (const [key, group] of groups) {
      const previous = completionTableIndex.get(key)?.tables ?? [];
      touchCompletionIndex(completionTableIndex, key, {
        tables: dedupeCompletionTables([...previous, ...group]),
      });
    }
  }

  function indexCompletionObjects(connectionId: string, database: string, schema: string | undefined, objects: SqlCompletionObject[]) {
    const groups = new Map<string, SqlCompletionObject[]>();
    for (const object of objects) {
      const objectSchema = object.schema ?? schema;
      const key = completionScopeKey(connectionId, database, objectSchema);
      const list = groups.get(key) ?? [];
      list.push({ ...object, schema: objectSchema });
      groups.set(key, list);
    }
    for (const [key, group] of groups) {
      const previous = completionObjectIndex.get(key)?.objects ?? [];
      touchCompletionIndex(completionObjectIndex, key, {
        objects: dedupeCompletionObjects([...previous, ...group]),
      });
    }
  }

  function indexCompletionColumns(connectionId: string, database: string, table: string, schema: string | undefined, columns: SqlCompletionColumn[]) {
    touchCompletionIndex(completionColumnIndex, completionColumnsKey(connectionId, database, table, schema), {
      columns,
    });
  }

  function sqlCompletionForeignKeys(foreignKeys: ForeignKeyInfo[]): SqlCompletionForeignKey[] {
    return foreignKeys.map((foreignKey) => ({
      name: foreignKey.name,
      column: foreignKey.column,
      ref_schema: foreignKey.ref_schema,
      ref_table: foreignKey.ref_table,
      ref_column: foreignKey.ref_column,
    }));
  }

  function indexCompletionForeignKeys(connectionId: string, database: string, table: string, schema: string | undefined, foreignKeys: SqlCompletionForeignKey[]) {
    touchCompletionIndex(completionForeignKeyIndex, completionForeignKeysKey(connectionId, database, table, schema), {
      foreignKeys,
    });
  }

  function lookupLocalCompletionTables(connectionId: string, database: string, filter = "", limit?: number, schema?: string): SqlCompletionTable[] {
    const allScopes = [...completionTableIndex.entries()].filter(([key]) => key.startsWith(`${connectionId}:${database}:`)).map(([, entry]) => entry);
    const preferred = schema ? completionTableIndex.get(completionScopeKey(connectionId, database, schema)) : undefined;
    const scopes = preferred ? [preferred, ...allScopes.filter((entry) => entry !== preferred)] : allScopes;
    const ranked = scopes
      .flatMap((entry) => entry?.tables ?? [])
      .map((table) => ({ table, score: tableMatchScore(table, filter, schema) }))
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => b.score - a.score || a.table.name.localeCompare(b.table.name));
    return dedupeCompletionTables(ranked.map((entry) => entry.table)).slice(0, limit ?? 200);
  }

  function lookupLocalCompletionObjects(connectionId: string, database: string, filter = "", limit?: number, schema?: string): SqlCompletionObject[] {
    const allScopes = [...completionObjectIndex.entries()].filter(([key]) => key.startsWith(`${connectionId}:${database}:`)).map(([, entry]) => entry);
    const preferred = schema ? completionObjectIndex.get(completionScopeKey(connectionId, database, schema)) : undefined;
    const scopes = preferred ? [preferred, ...allScopes.filter((entry) => entry !== preferred)] : allScopes;
    const ranked = scopes
      .flatMap((entry) => entry?.objects ?? [])
      .map((object) => ({ object, score: objectMatchScore(object, filter, schema) }))
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => b.score - a.score || a.object.name.localeCompare(b.object.name));
    return dedupeCompletionObjects(ranked.map((entry) => entry.object)).slice(0, limit ?? 200);
  }

  function fuzzyTextMatch(value: string, filter: string): boolean {
    if (!filter) return true;
    const text = value.toLowerCase();
    if (text.includes(filter)) return true;
    let index = 0;
    for (const ch of filter) {
      index = text.indexOf(ch, index);
      if (index < 0) return false;
      index++;
    }
    return true;
  }

  function lookupLocalCompletionSchemas(connectionId: string, database: string, filter = "", limit = 50): string[] {
    const schemas = get().schemaListCache[`${connectionId}:${database}`] ?? [];
    const normalized = filter.trim().toLowerCase();
    return schemas
      .filter((schema) => fuzzyTextMatch(schema, normalized))
      .sort((a, b) => tableMatchScore({ name: b }, normalized) - tableMatchScore({ name: a }, normalized))
      .slice(0, limit);
  }

  function lookupLocalCompletionDatabases(connectionId: string, filter = "", limit = 50): string[] {
    const databases = get().completionDatabasesCache[connectionId] ?? databaseNamesFromTree(connectionId);
    const normalized = filter.trim().toLowerCase();
    return databases
      .filter((database) => fuzzyTextMatch(database, normalized))
      .sort((a, b) => tableMatchScore({ name: b }, normalized) - tableMatchScore({ name: a }, normalized))
      .slice(0, limit);
  }

  function lookupLocalCompletionColumns(connectionId: string, database: string, table: string, schema?: string): SqlCompletionColumn[] {
    return completionColumnIndex.get(completionColumnsKey(connectionId, database, table, schema))?.columns ?? [];
  }

  function lookupLocalCompletionForeignKeys(connectionId: string, database: string, table: string, schema?: string): SqlCompletionForeignKey[] {
    return completionForeignKeyIndex.get(completionForeignKeysKey(connectionId, database, table, schema))?.foreignKeys ?? [];
  }

  function databaseNamesFromTree(connectionId: string): string[] {
    const node = findNode(get().treeNodes, connectionId);
    if (!node?.children) return [];
    const seen = new Set<string>();
    const names: string[] = [];
    for (const child of node.children) {
      if (child.type !== "database" || !child.database) continue;
      const key = child.database.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      names.push(child.database);
    }
    return names;
  }

  function metadataQuerySchema(connectionId: string, database: string, schema?: string): string {
    return connectionObjectTreeQuerySchema(get().getConfig(connectionId), database, schema);
  }

  function isSchemaAwareDatabase(connectionId: string): boolean {
    return isSchemaAware(get().getConfig(connectionId)?.db_type);
  }

  function relaxedCompletionTableFilter(filter: string): string | undefined {
    if (filter.length < 3) return undefined;
    return filter.slice(0, 2);
  }

  function expandedCompletionLimit(limit?: number): number | undefined {
    if (!limit) return limit;
    return Math.min(Math.max(limit * 3, limit), 1000);
  }

  function dedupeCompletionTables(tables: SqlCompletionTable[]): SqlCompletionTable[] {
    const seen = new Set<string>();
    const deduped: SqlCompletionTable[] = [];
    for (const table of tables) {
      const key = `${table.schema ?? ""}.${table.name}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(table);
    }
    return deduped;
  }

  function dedupeCompletionObjects(objects: SqlCompletionObject[]): SqlCompletionObject[] {
    const seen = new Set<string>();
    const deduped: SqlCompletionObject[] = [];
    for (const object of objects) {
      const key = `${object.type}:${object.schema ?? ""}:${object.name}:${object.parentName ?? ""}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(object);
    }
    return deduped;
  }

  function fuzzyCompletionObjectMatch(object: SqlCompletionObject, filter: string): boolean {
    return fuzzyTextMatch(object.name, filter) || (!!object.schema && fuzzyTextMatch(object.schema, filter)) || (!!object.parentName && fuzzyTextMatch(object.parentName, filter)) || (!!object.parentSchema && fuzzyTextMatch(`${object.parentSchema}.${object.parentName ?? ""}`, filter));
  }

  function toSqlCompletionObject(object: ObjectInfo): SqlCompletionObject | null {
    const objectType = object.object_type.toUpperCase();
    const type = objectType.includes("PROCEDURE") ? "procedure" : objectType.includes("FUNCTION") ? "function" : objectType.includes("TRIGGER") ? "trigger" : objectType.includes("PACKAGE") ? "package" : null;
    if (!type) return null;
    return {
      name: object.name,
      schema: object.schema ?? undefined,
      type,
      parentSchema: object.parent_schema ?? undefined,
      parentName: object.parent_name ?? undefined,
    };
  }

  async function listSchemaAwareCompletionObjects(connectionId: string, database: string, schema?: string): Promise<ObjectInfo[]> {
    const schemas = schema ? [schema] : await listCompletionSchemas(connectionId, database);
    const batchSize = 5;
    const results: ObjectInfo[] = [];
    for (let i = 0; i < schemas.length; i += batchSize) {
      const batch = schemas.slice(i, i + batchSize);
      const groups = await Promise.all(
        batch.map(async (s) => {
          try {
            return await api.listCompletionObjects(connectionId, database, s);
          } catch {
            return [] as ObjectInfo[];
          }
        }),
      );
      for (const group of groups) results.push(...group);
    }
    return results;
  }

  async function restoreExpandedChildren(node: TreeNode, expandedIds: Set<string>, options?: LoadTreeOptions) {
    if (!node.children) return;
    for (const child of node.children) {
      if (!expandedIds.has(child.id)) continue;
      await loadTreeNodeChildren(child, options);
      await restoreExpandedChildren(child, expandedIds, options);
    }
  }

  async function reloadConnectionDatabaseChildren(connectionId: string) {
    const config = get().getConfig(connectionId);
    if (!config) return;
    clearLoadedChildrenCache(connectionId);
    if (config.db_type === "redis") {
      await get().loadRedisDatabases(connectionId);
    } else if (config.db_type === "etcd") {
      await get().loadEtcdRoot(connectionId);
    } else if (config.db_type === "mongodb") {
      await get().loadMongoDatabases(connectionId);
    } else if (config.db_type === "elasticsearch") {
      await get().loadElasticsearchIndices(connectionId);
    } else if (config.db_type === "mq") {
      await get().loadMqTenants(connectionId, { force: true });
    } else {
      await get().loadDatabases(connectionId, { force: true });
    }
  }

  async function applyDataGripKeychainPasswordsImpl(): Promise<number> {
    return 0; // Simplified for React - full implementation requires Tauri keychain APIs
  }

  async function exportConnectionsToFileImpl(passphrase: string) {
    const { encryptConfig } = await import("@/lib/configCrypto");
    const exportData = { connections: get().connections, layout: get().sidebarLayout };
    const json = JSON.stringify(exportData);
    const payload = await encryptConfig(json, passphrase);
    const content = JSON.stringify(payload, null, 2);

    if (isTauriRuntime()) {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const { writeTextFile } = await import("@tauri-apps/plugin-fs");
      const path = await save({
        filters: [{ name: "JSON", extensions: ["json"] }],
        defaultPath: "dbx-connections.json",
      });
      if (!path) return;
      await writeTextFile(path, content);
    } else {
      const blob = new Blob([content], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "dbx-connections.json";
      a.click();
      URL.revokeObjectURL(url);
    }
  }

  async function readImportFileImpl(source: ImportSource = "dbx"): Promise<{ content: string; encrypted: boolean } | null> {
    let content: string;

    if (isTauriRuntime()) {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const { readTextFile } = await import("@tauri-apps/plugin-fs");
      const path = await open({
        filters: source === "navicat" ? [{ name: "Navicat Connection Export", extensions: ["ncx", "xml"] }] : [{ name: "DBX JSON", extensions: ["json"] }],
        multiple: false,
      });
      if (!path) return null;
      content = await readTextFile(path as string);
    } else {
      content = await new Promise<string>((resolve, reject) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = source === "navicat" ? ".ncx,.xml" : ".json";
        input.onchange = () => {
          const file = input.files?.[0];
          if (!file) {
            reject(new Error("No file selected"));
            return;
          }
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(reader.error);
          reader.readAsText(file);
        };
        input.click();
      });
    }

    if (content.trimStart().startsWith("<")) {
      return { content, encrypted: false };
    }

    const { isEncryptedConfig } = await import("@/lib/configCrypto");
    const parsed = JSON.parse(content);
    return { content, encrypted: isEncryptedConfig(parsed) };
  }

  async function importConnectionsFromFileImpl(content: string, passphrase: string | null): Promise<{ count: number; layout?: SidebarLayout }> {
    let imported: ConnectionConfig[] = [];
    let importedLayout: SidebarLayout | undefined;

    if (!passphrase && content.trimStart().startsWith("<")) {
      const { parseNavicatConnections } = await import("@/lib/navicatImport");
      imported = await parseNavicatConnections(content);
    } else if (!passphrase) {
      const { isDbeaverImportPayload, parseDbeaverConnections } = await import("@/lib/dbeaverImport");
      if (isDbeaverImportPayload(content)) {
        imported = await parseDbeaverConnections(content);
      } else {
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) {
          imported = parsed;
        } else if (parsed.format === "dbx-config" && Array.isArray(parsed.connections)) {
          imported = parsed.connections;
        } else if (parsed.connections && Array.isArray(parsed.connections)) {
          imported = parsed.connections;
          if (parsed.layout?.groups && parsed.layout?.order) {
            importedLayout = parsed.layout;
          }
        } else {
          imported = [];
        }
      }
    } else {
      const parsed = JSON.parse(content);
      if (passphrase) {
        const { decryptConfig } = await import("@/lib/configCrypto");
        const json = await decryptConfig(parsed, passphrase);
        const decrypted = JSON.parse(json);
        if (Array.isArray(decrypted)) {
          imported = decrypted;
        } else if (decrypted.connections) {
          imported = decrypted.connections;
          if (decrypted.layout?.groups && decrypted.layout?.order) {
            importedLayout = decrypted.layout;
          }
        } else {
          imported = [];
        }
      }
    }

    let count = 0;
    const importedConnectionIdMap = new Map<string, string>();
    for (const config of imported) {
      const duplicate = get().connections.find((c) => c.name === config.name && c.host === config.host && c.port === config.port);
      if (!duplicate) {
        const importedId = config.id;
        config.id = uuid();
        if (typeof importedId === "string") importedConnectionIdMap.set(importedId, config.id);
        const normalized = normalizeConnection(config);
        await get().addConnection(normalized);
        count++;
      } else if (typeof config.id === "string") {
        importedConnectionIdMap.set(config.id, duplicate.id);
      }
    }
    if (importedLayout) {
      importedLayout = remapSidebarLayoutConnectionIds(importedLayout, importedConnectionIdMap);
    }
    return { count, layout: importedLayout };
  }

  // Load Tree Node Children - the big dispatch
  async function loadTreeNodeChildren(node: TreeNode, options?: LoadTreeOptions) {
    if (node.type === "connection" && node.connectionId) {
      const config = get().getConfig(node.connectionId);
      if (config?.db_type === "redis") {
        await get().loadRedisDatabases(node.connectionId);
      } else if (config?.db_type === "etcd") {
        await get().loadEtcdRoot(node.connectionId);
      } else if (config?.db_type === "mongodb") {
        await get().loadMongoDatabases(node.connectionId);
      } else if (config?.db_type === "elasticsearch") {
        await get().loadElasticsearchIndices(node.connectionId);
      } else if (config?.db_type === "mq") {
        await get().loadMqTenants(node.connectionId, options);
      } else {
        await get().loadDatabases(node.connectionId, options);
      }
    } else if (node.type === "mongo-db" && node.connectionId && node.database) {
      await get().loadMongoCollections(node.connectionId, node.database);
    } else if (node.type === "database" && node.connectionId && hasTreeNodeDatabaseContext(node)) {
      const config = get().getConfig(node.connectionId);
      const effectiveDbType = effectiveDatabaseTypeForConnection(config);
      if (config?.db_type === "sqlserver") {
        await get().loadSqlServerDatabaseObjects(node.connectionId, node.database, options);
      } else if (usesTreeSchemaMode(effectiveDbType) && !connectionUsesDatabaseObjectTreeMode(config)) {
        await get().loadSchemas(node.connectionId, node.database, options);
      } else {
        await get().loadTables(node.connectionId, node.database, undefined, options);
      }
    } else if (node.type === "schema" && node.connectionId && hasTreeNodeDatabaseContext(node) && node.schema) {
      await get().loadTables(node.connectionId, node.database, node.schema, options);
    } else if (node.type === "linked-server-root" && node.connectionId) {
      await get().loadSqlServerLinkedServers(node.connectionId, options);
    } else if (node.type === "linked-server" && node.connectionId) {
      await get().loadSqlServerLinkedServerCatalogs(node, options);
    } else if (node.type === "linked-server-catalog" && node.connectionId) {
      await get().loadSqlServerLinkedServerSchemas(node, options);
    } else if (node.type === "linked-server-schema" && node.connectionId && hasTreeNodeDatabaseContext(node) && node.schema) {
      await get().loadTables(node.connectionId, node.database, node.schema, options);
    } else if ((node.type === "table" || node.type === "view" || node.type === "materialized_view") && node.connectionId && hasTreeNodeDatabaseContext(node)) {
      await get().loadTableGroups(node.connectionId, node.database, node.label, node.schema, node.id);
    } else if (node.type === "group-columns" && node.connectionId && hasTreeNodeDatabaseContext(node) && node.tableName) {
      await get().loadColumns(node.connectionId, node.database, node.tableName, node.schema, node.id);
    } else if (node.type === "group-indexes" && node.connectionId && hasTreeNodeDatabaseContext(node) && node.tableName) {
      await get().loadIndexes(node.connectionId, node.database, node.tableName, node.schema, node.id);
    } else if (node.type === "group-fkeys" && node.connectionId && hasTreeNodeDatabaseContext(node) && node.tableName) {
      await get().loadForeignKeys(node.connectionId, node.database, node.tableName, node.schema, node.id);
    } else if (node.type === "group-triggers" && node.connectionId && hasTreeNodeDatabaseContext(node) && node.tableName) {
      await get().loadTriggers(node.connectionId, node.database, node.tableName, node.schema, node.id);
    } else if (node.type === "group-tables" || node.type === "group-views" || node.type === "group-materialized-views" || node.type === "group-procedures" || node.type === "group-functions" || node.type === "group-sequences" || node.type === "group-packages") {
      await get().loadObjectGroupChildren(node, options);
    } else if (node.type === "group-partitions") {
      node.isExpanded = true;
    }
  }

  return {
    connections: [],
    activeConnectionId: null,
    selectedTreeNodeId: null,
    selectedTreeNodeIds: [],
    treeSelectionAnchorId: null,
    treeClipboard: null,
    treeNodes: [],
    connectedIds: new Set<string>(),
    connectionErrors: {},
    editingConnectionId: null,
    newConnectionGroupId: null,
    sidebarLayout: emptyLayout(),
    sidebarSearchQuery: "",
    transferSource: null,
    schemaDiffSource: null,
    dataCompareSource: null,
    sqlFileSource: null,
    diagramSource: null,
    tableImportSource: null,
    tableDataGenerateSource: null,
    fieldLineageSource: null,
    databaseSearchSource: null,
    databaseExportSource: null,
    pinnedTreeNodeIds: new Set<string>(),
    loadedTreeNodeChildrenIds: new Set<string>(),
    completionTablesCache: {},
    completionObjectsCache: {},
    completionColumnsCache: {},
    completionForeignKeysCache: {},
    completionDatabasesCache: {},
    elasticsearchCompletionIndicesCache: {},
    redisCompletionKeysCache: {},
    schemaListCache: {},

    getConfig(connectionId: string) {
      return configById().get(connectionId);
    },

    setConnectionError(connectionId: string, message: string) {
      const connectionErrors = { ...get().connectionErrors, [connectionId]: message };
      set({ connectionErrors });
    },

    clearConnectionError(connectionId: string) {
      const connectionErrors = { ...get().connectionErrors };
      delete connectionErrors[connectionId];
      set({ connectionErrors });
    },

    recordConnectionError(connectionId: string, error: unknown): string {
      const message = connectionErrorMessage(error);
      get().setConnectionError(connectionId, message);
      return message;
    },

    normalizeConnection,

    async loadPinnedTreeNodeIds() {
      const ids = await loadPinnedTreeNodeIdsFromDisk();
      set({ pinnedTreeNodeIds: ids });
      return ids;
    },

    persistPinnedTreeNodeIds,

    isTreeNodePinned,

    toggleTreeNodePin,

    setChildren,

    removeTreeNode,

    findNode,

    isTreeNodeChildrenLoaded,

    clearLoadedChildrenCache,

    schemaCachePrefixForNode,

    async addConnection(config: ConnectionConfig) {
      const normalized = normalizeConnection(config);
      const existing = get().connections.findIndex((c) => c.id === normalized.id);
      const nextConnections = [...get().connections];
      if (existing >= 0) {
        nextConnections[existing] = normalized;
      } else {
        nextConnections.push(normalized);
        const sidebarLayout = appendConnectionToLayout(get().sidebarLayout, normalized.id, get().newConnectionGroupId);
        set({ sidebarLayout });
      }
      await persistConnections(nextConnections);
      set({ connections: nextConnections });
      rebuildTreeNodes();
      persistSidebarLayoutDebounced();
      stopCreatingConnectionInGroup();
    },

    async updateConnection(config: ConnectionConfig) {
      config = normalizeConnection(config);
      const idx = get().connections.findIndex((c) => c.id === config.id);
      if (idx < 0) return;
      const nextConnections = [...get().connections];
      nextConnections[idx] = config;
      await persistConnections(nextConnections);
      const connectedIds = new Set(get().connectedIds);
      connectedIds.delete(config.id);
      set({ connections: nextConnections, connectedIds });
      rebuildTreeNodes();
      get().invalidateCompletionCache(config.id);
      get().clearLoadedChildrenCache(config.id);
    },

    async setDefaultDatabase(connectionId: string, database: string) {
      const config = get().getConfig(connectionId);
      if (!config || config.database === database) return;
      await get().updateConnection({ ...config, database });
    },

    async clearDefaultDatabase(connectionId: string) {
      const config = get().getConfig(connectionId);
      if (!config || !config.database) return;
      await get().updateConnection({ ...config, database: undefined });
    },

    isDefaultDatabase(connectionId: string, database: string): boolean {
      return get().getConfig(connectionId)?.database === database && database !== "";
    },

    async setVisibleDatabases(connectionId: string, databaseNames: string[]) {
      const config = get().getConfig(connectionId);
      if (!config) return;
      await get().updateConnection({ ...config, visible_databases: normalizeVisibleDatabaseSelection(databaseNames, databaseNames) });
      await reloadConnectionDatabaseChildren(connectionId);
    },

    async clearVisibleDatabases(connectionId: string) {
      const config = get().getConfig(connectionId);
      if (!config || !Array.isArray(config.visible_databases)) return;
      await get().updateConnection({ ...config, visible_databases: undefined });
      await reloadConnectionDatabaseChildren(connectionId);
    },

    async removeConnection(id: string) {
      const removedIds = new Set([id]);
      const nextConnections = get().connections.filter((c) => !removedIds.has(c.id));
      await persistConnections(nextConnections);
      const pinnedTreeNodeIds = prunePinnedTreeNodeIdsForConnection(get().pinnedTreeNodeIds, id);
      const connectedIds = new Set(get().connectedIds);
      for (const id of removedIds) {
        connectedIds.delete(id);
      }
      const connectionErrors = { ...get().connectionErrors };
      for (const id of removedIds) {
        delete connectionErrors[id];
      }
      const sidebarLayout = removeConnectionFromSidebarLayout(get().sidebarLayout, id);
      rebuildTreeNodes();
      set({ connections: nextConnections, connectedIds, pinnedTreeNodeIds, connectionErrors, sidebarLayout });
      persistSidebarLayoutDebounced();
      persistPinnedTreeNodeIds();
      if (get().activeConnectionId && removedIds.has(get().activeConnectionId)) {
        set({ activeConnectionId: null });
      }
      const selectedTreeNodeIds = get().selectedTreeNodeIds.filter((id) => !removedIds.has(id));
      const selectedTreeNodeId = get().selectedTreeNodeId && removedIds.has(get().selectedTreeNodeId) ? null : get().selectedTreeNodeId;
      const treeSelectionAnchorId = get().treeSelectionAnchorId && removedIds.has(get().treeSelectionAnchorId) ? null : get().treeSelectionAnchorId;
      set({ selectedTreeNodeIds, selectedTreeNodeId, treeSelectionAnchorId });
      for (const id of removedIds) {
        get().invalidateCompletionCache(id);
        get().clearLoadedChildrenCache(id);
      }
    },

    async connect(config: ConnectionConfig) {
      config = normalizeConnection(config);
      const pendingNode = findNode(get().treeNodes, config.id);
      if (pendingNode) pendingNode.isLoading = true;
      try {
        await beforeConnectHandler?.(config);
        const id = await withConnectionAttemptTimeout(api.connectDb(config), config);
        const connectedIds = new Set(get().connectedIds);
        connectedIds.add(id);
        const activeConnectionId = id;
        get().clearConnectionError(config.id);
        if (id !== config.id) get().clearConnectionError(id);

        const existing = findNode(get().treeNodes, id);
        if (existing) {
          existing.label = config.name;
          existing.type = "connection";
          existing.connectionId = id;
          existing.children = existing.children || [];
        } else {
          const treeNodes = [...get().treeNodes, {
            id,
            label: config.name,
            type: "connection" as const,
            connectionId: id,
            isExpanded: false,
            children: [],
          }];
          set({ treeNodes });
        }
        return id;
      } catch (e) {
        get().recordConnectionError(config.id, e);
        throw e;
      } finally {
        const node = findNode(get().treeNodes, config.id);
        if (node) node.isLoading = false;
      }
    },

    async disconnect(connectionId: string) {
      const shouldRemoveOneTimeConnection = get().getConfig(connectionId)?.one_time === true;
      await api.disconnectDb(connectionId);
      get().clearConnectionError(connectionId);
      const connectedIds = new Set(get().connectedIds);
      connectedIds.delete(connectionId);
      set({ connectedIds });
      const node = findNode(get().treeNodes, connectionId);
      if (node) {
        node.isExpanded = false;
        node.children = [];
      }
      get().clearLoadedChildrenCache(connectionId);
      if (get().activeConnectionId === connectionId) {
        set({ activeConnectionId: null });
      }
      get().invalidateCompletionCache(connectionId);
      if (shouldRemoveOneTimeConnection) {
        await get().removeConnection(connectionId);
      }
    },

    async closeDatabaseConnection(connectionId: string, database: string) {
      await api.closeDatabaseConnection(connectionId, database);
      const node = findDatabaseTreeNode(get().treeNodes, connectionId, database);
      if (node) {
        node.isExpanded = false;
        node.children = [];
        get().clearLoadedChildrenCache(node.id);
      }
      get().invalidateCompletionCache(connectionId, database);
    },

    async ensureConnected(connectionId: string) {
      if (get().connectedIds.has(connectionId)) return;
      let config = get().getConfig(connectionId);
      if (!config) {
        await get().initFromDisk();
        config = get().getConfig(connectionId);
      }
      if (!config) {
        const error = new Error("Connection config not found");
        get().recordConnectionError(connectionId, error);
        throw error;
      }
      try {
        await beforeConnectHandler?.(config);
        await withConnectionAttemptTimeout(api.connectDb(config), config);
        const connectedIds = new Set(get().connectedIds);
        connectedIds.add(connectionId);
        set({ connectedIds, activeConnectionId: connectionId });
        get().clearConnectionError(connectionId);
      } catch (e) {
        get().recordConnectionError(connectionId, e);
        throw e;
      }
    },

    setBeforeConnectHandler(handler: BeforeConnectHandler | null) {
      beforeConnectHandler = handler;
    },

    async initFromDisk() {
      if (!initFromDiskPromise) {
        initFromDiskPromise = (async () => {
          await get().loadPinnedTreeNodeIds();
          const saved = await api.loadConnections();
          set({ connections: saved.map(normalizeConnection) });
          const savedLayout = await api.loadSidebarLayout();
          const sidebarLayout = reconcileLayout(get().connections.map((c) => c.id), savedLayout);
          set({ sidebarLayout });
          rebuildTreeNodes();
        })().finally(() => {
          initFromDiskPromise = null;
        });
      }
      await initFromDiskPromise;
    },

    async loadDatabases(connectionId: string, options?: LoadTreeOptions) {
      const node = findNode(get().treeNodes, connectionId);
      if (!node) return;
      node.isLoading = true;
      try {
        await get().ensureConnected(connectionId);
        if (useCachedChildren(node, options)) return;

        const config = get().getConfig(connectionId);
        if (config?.db_type === "duckdb") {
          const cacheKey = schemaCacheKey(connectionId, "duckdb-root");
          if (!options?.force) {
            const cached = await loadPersistedTreeChildren(node, cacheKey);
            if (cached.hit) {
              if (cached.isStale) refreshStaleTreeNode(node);
              return;
            }
          }
          const [databases, schemas] = await Promise.all([api.listDatabases(connectionId), api.listSchemas(connectionId, "main")]);
          const children = withSavedSqlRoot(connectionId, buildDuckDbConnectionTreeNodes(connectionId, databases, schemas), node);
          setChildren(node, children);
          await savePersistedTreeChildren(cacheKey, children);
        } else if (config?.db_type === "dameng" || config?.db_type === "oracle") {
          const effectiveDb = config.database || "";
          const cacheKey = schemaCacheKey(connectionId, effectiveDb, "schemas");
          if (!options?.force) {
            const cached = await loadPersistedTreeChildren(node, cacheKey);
            if (cached.hit) {
              if (cached.isStale) refreshStaleTreeNode(node);
              return;
            }
          }
          const schemas = await api.listSchemas(connectionId, effectiveDb);
          const visibleSchemas = filterDatabaseNamesForConnection(schemas, config);
          const schemaNodes: TreeNode[] = sortSidebarNames(visibleSchemas).map((s) => ({
            id: `${connectionId}:${s}:${s}`,
            label: s,
            type: "schema" as const,
            connectionId,
            database: s,
            schema: s,
            isExpanded: false,
            children: [],
          }));
          setChildren(node, withSavedSqlRoot(connectionId, schemaNodes, node));
          await savePersistedTreeChildren(cacheKey, schemaNodes);
        } else {
          const cacheKey = schemaCacheKey(connectionId, "databases");
          if (!options?.force) {
            const cached = await loadPersistedTreeChildren(node, cacheKey);
            if (cached.hit) {
              if (cached.isStale) refreshStaleTreeNode(node);
              return;
            }
          }
          const databases = await api.listDatabases(connectionId);
          const visibleNames = filterDatabaseNamesForConnection(databases.map((database) => database.name), config);
          const visibleNameSet = new Set(visibleNames);
          const visibleDatabases = databases.filter((database) => visibleNameSet.has(database.name));
          const effectiveDbType = effectiveDatabaseTypeForConnection(config);
          const databaseNodes = buildDatabaseTreeNodes(connectionId, visibleDatabases, {
            includeDefaultWhenEmpty: usesTreeSchemaMode(effectiveDbType) || shouldIncludeDefaultDatabaseNode(config, visibleDatabases),
          });
          if (config?.db_type === "sqlserver") {
            const linkedServers = await api.listSqlServerLinkedServers(connectionId).catch(() => []);
            const linkedDatabase = sqlServerLinkedRuntimeDatabase(config);
            databaseNodes.push({
              ...sqlServerLinkedRootNode(connectionId, linkedDatabase),
              children: linkedServers.map((server) => ({
                id: sqlServerLinkedServerId(connectionId, server.name),
                label: server.name,
                type: "linked-server" as const,
                connectionId,
                database: linkedDatabase,
                linkedServer: server.name,
                comment: [server.product, server.provider, server.data_source].filter(Boolean).join(" / ") || null,
                isExpanded: false,
                children: [],
              })),
            });
            if (linkedServers.length > 0) {
              const loadedTreeNodeChildrenIds = new Set(get().loadedTreeNodeChildrenIds);
              loadedTreeNodeChildrenIds.add(sqlServerLinkedRootId(connectionId));
              set({ loadedTreeNodeChildrenIds });
            }
          }
          const children = withSavedSqlRoot(connectionId, databaseNodes, node);
          setChildren(node, children);
          await savePersistedTreeChildren(cacheKey, children);
        }
        node.isExpanded = true;
      } catch (e) {
        recordMetadataLoadError(connectionId, e);
        throw e;
      } finally {
        node.isLoading = false;
      }
    },

    async loadRedisDatabases(connectionId: string) {
      const node = findNode(get().treeNodes, connectionId);
      if (!node) return;

      node.isLoading = true;
      try {
        await get().ensureConnected(connectionId);
        const dbs = await api.redisListDatabases(connectionId);
        const config = get().getConfig(connectionId);
        const visibleNames = filterVisibleDatabaseNames(dbs.map((db) => String(db.db)), config?.visible_databases);
        const visibleNameSet = new Set(visibleNames);
        setChildren(
          node,
          withSavedSqlRoot(
            connectionId,
            dbs
              .filter((db) => visibleNameSet.has(String(db.db)))
              .map((db) => ({
                id: `${connectionId}:db${db.db}`,
                label: redisDbLabel(db.db, 0, db.keys),
                type: "redis-db" as const,
                connectionId,
                database: String(db.db),
                loadedKeyCount: 0,
                totalKeyCount: db.keys,
                isExpanded: false,
                children: [],
              })),
            node,
          ),
        );
        node.isExpanded = true;
      } catch (e) {
        recordMetadataLoadError(connectionId, e);
        throw e;
      } finally {
        node.isLoading = false;
      }
    },

    async loadEtcdRoot(connectionId: string) {
      const node = findNode(get().treeNodes, connectionId);
      if (!node) return;

      node.isLoading = true;
      try {
        await get().ensureConnected(connectionId);
        setChildren(
          node,
          withSavedSqlRoot(
            connectionId,
            [
              {
                id: `${connectionId}:etcd`,
                label: "Keys",
                type: "etcd-root" as const,
                connectionId,
                database: "",
                isExpanded: false,
                children: [],
              },
            ],
            node,
          ),
        );
        node.isExpanded = true;
      } catch (e) {
        recordMetadataLoadError(connectionId, e);
        throw e;
      } finally {
        node.isLoading = false;
      }
    },

    async loadMqTenants(connectionId: string, options?: LoadTreeOptions) {
      const node = findNode(get().treeNodes, connectionId);
      if (!node) return;

      node.isLoading = true;
      try {
        await get().ensureConnected(connectionId);
        if (useCachedChildren(node, options)) return;

        const tenants = await api.mqListTenants(connectionId);
        const tenantNames = sortSidebarNames(tenants.map((tenant) => tenant.name).filter((name) => !!name.trim()));
        setChildren(
          node,
          tenantNames.map((tenant) => ({
            id: schemaCacheKey(connectionId, "mq-tenant", tenant),
            label: tenant,
            type: "mq-tenant" as const,
            connectionId,
            mqTenant: tenant,
          })),
        );
        node.isExpanded = true;
      } catch (e) {
        recordMetadataLoadError(connectionId, e);
        throw e;
      } finally {
        node.isLoading = false;
      }
    },

    updateRedisDbKeyStats(connectionId: string, db: number, stats: { loaded?: number; total?: number; totalDelta?: number }) {
      const node = findNode(get().treeNodes, `${connectionId}:db${db}`);
      if (!node || node.type !== "redis-db") return;
      if (stats.loaded != null) node.loadedKeyCount = stats.loaded;
      if (stats.total != null) node.totalKeyCount = stats.total;
      if (stats.totalDelta != null && node.totalKeyCount != null) {
        node.totalKeyCount = Math.max(0, node.totalKeyCount + stats.totalDelta);
      }
      node.label = redisDbLabel(db, node.loadedKeyCount, node.totalKeyCount);
    },

    async refreshRedisDbKeyCounts(connectionId: string) {
      const connNode = findNode(get().treeNodes, connectionId);
      if (!connNode) return;
      try {
        await get().ensureConnected(connectionId);
        const dbs = await api.redisListDatabases(connectionId);
        for (const db of dbs) {
          get().updateRedisDbKeyStats(connectionId, db.db, { total: db.keys });
        }
      } catch {
        // Best-effort
      }
    },

    async loadMongoDatabases(connectionId: string) {
      const node = findNode(get().treeNodes, connectionId);
      if (!node) return;

      node.isLoading = true;
      try {
        await get().ensureConnected(connectionId);
        const dbs = await api.mongoListDatabases(connectionId);
        const config = get().getConfig(connectionId);
        const visibleDbs = filterDatabaseNamesForConnection(dbs, config);
        setChildren(
          node,
          withSavedSqlRoot(
            connectionId,
            sortSidebarNames(visibleDbs).map((db) => ({
              id: `${connectionId}:${db}`,
              label: db,
              type: "mongo-db" as const,
              connectionId,
              database: db,
              isExpanded: false,
              children: [],
            })),
            node,
          ),
        );
        node.isExpanded = true;
      } catch (e) {
        recordMetadataLoadError(connectionId, e);
        throw e;
      } finally {
        node.isLoading = false;
      }
    },

    async loadElasticsearchIndices(connectionId: string) {
      const node = findNode(get().treeNodes, connectionId);
      if (!node) return;

      node.isLoading = true;
      try {
        await get().ensureConnected(connectionId);
        const indices = await api.elasticsearchListIndices(connectionId);
        setChildren(
          node,
          withSavedSqlRoot(
            connectionId,
            sortSidebarNames(indices).map((index) => ({
              id: `${connectionId}:__es_index:${index}`,
              label: index,
              type: "elasticsearch-index" as const,
              connectionId,
              database: "default",
              isExpanded: false,
            })),
            node,
          ),
        );
        node.isExpanded = true;
      } catch (e) {
        recordMetadataLoadError(connectionId, e);
        throw e;
      } finally {
        node.isLoading = false;
      }
    },

    async loadMongoCollections(connectionId: string, database: string) {
      const nodeId = `${connectionId}:${database}`;
      const node = findNode(get().treeNodes, nodeId);
      if (!node) return;

      node.isLoading = true;
      try {
        const collections = await api.mongoListCollections(connectionId, database);
        setChildren(
          node,
          sortSidebarNames(collections).map((col) => ({
            id: `${nodeId}:${col}`,
            label: col,
            type: "mongo-collection" as const,
            connectionId,
            database,
            isExpanded: false,
          })),
        );
        node.isExpanded = true;
      } catch (e) {
        recordMetadataLoadError(connectionId, e);
        throw e;
      } finally {
        node.isLoading = false;
      }
    },

    async loadSchemas(connectionId: string, database: string, options?: LoadTreeOptions) {
      const nodeId = `${connectionId}:${database}`;
      const node = findNode(get().treeNodes, nodeId);
      if (!node) return;
      node.isLoading = true;
      try {
        await get().ensureConnected(connectionId);
        if (useCachedChildren(node, options)) return;
        const cacheKey = schemaCacheKey(connectionId, database, "schemas");
        if (!options?.force) {
          const cached = await loadPersistedTreeChildren(node, cacheKey);
          if (cached.hit) {
            if (cached.isStale) refreshStaleTreeNode(node);
            return;
          }
        }

        const schemas = sortSidebarNames(await api.listSchemas(connectionId, database));
        const children = schemas.map((s) => ({
          id: `${connectionId}:${database}:${s}`,
          label: s,
          type: "schema" as const,
          connectionId,
          database,
          schema: s,
          isExpanded: false,
          children: [],
        }));
        setChildren(node, children);
        await savePersistedTreeChildren(cacheKey, children);
        node.isExpanded = true;
      } catch (e) {
        recordMetadataLoadError(connectionId, e);
        throw e;
      } finally {
        node.isLoading = false;
      }
    },

    async loadSqlServerDatabaseObjects(connectionId: string, database: string, options?: LoadTreeOptions) {
      const nodeId = `${connectionId}:${database}`;
      const node = findNode(get().treeNodes, nodeId);
      if (!node) return;
      node.isLoading = true;
      try {
        await get().ensureConnected(connectionId);
        if (useCachedChildren(node, options)) return;
        const simpleObjectDisplay = useSettingsStore().editorSettings.sidebarObjectDisplay === "simple";
        const cacheKey = schemaCacheKey(connectionId, database, simpleObjectDisplay ? "sqlserver-objects-simple-v2" : "sqlserver-objects-grouped-v2");
        if (!options?.force) {
          const cached = await loadPersistedTreeChildren(node, cacheKey);
          if (cached.hit) {
            if (cached.isStale) refreshStaleTreeNode(node);
            return;
          }
        }

        const config = get().getConfig(connectionId);
        const schemas = await api.listSchemas(connectionId, database);
        const defaultSchemaObjects = simpleObjectDisplay ? await api.listObjects(connectionId, database, SQLSERVER_DEFAULT_SCHEMA) : [];
        const children = buildSqlServerDatabaseTreeNodes(connectionId, database, schemas, defaultSchemaObjects, {
          lazyObjectTypes: simpleObjectDisplay ? undefined : supportedSidebarObjectTypes(config),
          simpleObjectDisplay,
        });
        setChildren(node, children);
        await savePersistedTreeChildren(cacheKey, children);
        node.isExpanded = true;
      } catch (e) {
        recordMetadataLoadError(connectionId, e);
        throw e;
      } finally {
        node.isLoading = false;
      }
    },

    async loadSqlServerLinkedServers(connectionId: string, options?: LoadTreeOptions) {
      const node = findNode(get().treeNodes, sqlServerLinkedRootId(connectionId));
      if (!node) return;
      node.isLoading = true;
      try {
        await get().ensureConnected(connectionId);
        if (useCachedChildren(node, options)) return;
        const config = get().getConfig(connectionId);
        const database = sqlServerLinkedRuntimeDatabase(config);
        const linkedServers = await api.listSqlServerLinkedServers(connectionId);
        setChildren(
          node,
          linkedServers.map((server) => ({
            id: sqlServerLinkedServerId(connectionId, server.name),
            label: server.name,
            type: "linked-server" as const,
            connectionId,
            database,
            linkedServer: server.name,
            comment: [server.product, server.provider, server.data_source].filter(Boolean).join(" / ") || null,
            isExpanded: false,
            children: [],
          })),
        );
        node.isExpanded = true;
      } catch (e) {
        recordMetadataLoadError(connectionId, e);
        throw e;
      } finally {
        node.isLoading = false;
      }
    },

    async loadSqlServerLinkedServerCatalogs(node: TreeNode, options?: LoadTreeOptions) {
      if (!node.connectionId || !node.linkedServer) return;
      const connectionId = node.connectionId;
      const server = node.linkedServer;
      node.isLoading = true;
      try {
        await get().ensureConnected(connectionId);
        if (useCachedChildren(node, options)) return;
        const catalogs = await api.listSqlServerLinkedServerCatalogs(connectionId, server);
        const database = node.database || sqlServerLinkedRuntimeDatabase(get().getConfig(connectionId));
        setChildren(
          node,
          catalogs
            .filter((catalog) => catalog.name.trim())
            .map((catalog) => ({
              id: sqlServerLinkedCatalogId(connectionId, server, catalog.name),
              label: catalog.name,
              type: "linked-server-catalog" as const,
              connectionId,
              database,
              linkedServer: server,
              linkedCatalog: catalog.name,
              isExpanded: false,
              children: [],
            })),
        );
        node.isExpanded = true;
      } catch (e) {
        recordMetadataLoadError(connectionId, e);
        throw e;
      } finally {
        node.isLoading = false;
      }
    },

    async loadSqlServerLinkedServerSchemas(node: TreeNode, options?: LoadTreeOptions) {
      if (!node.connectionId || !node.linkedServer || !node.linkedCatalog) return;
      node.isLoading = true;
      try {
        await get().ensureConnected(node.connectionId);
        if (useCachedChildren(node, options)) return;
        const schemas = await api.listSqlServerLinkedServerSchemas(node.connectionId, node.linkedServer, node.linkedCatalog);
        const database = node.database || sqlServerLinkedRuntimeDatabase(get().getConfig(node.connectionId));
        setChildren(
          node,
          sortSidebarNames(schemas)
            .filter((schema) => schema.trim())
            .map((schema) => {
              const encodedSchema = encodeSqlServerLinkedSchema({
                server: node.linkedServer!,
                catalog: node.linkedCatalog!,
                schema,
              });
              return {
                id: `${node.connectionId}:${database}:${encodedSchema}`,
                label: schema,
                type: "linked-server-schema" as const,
                connectionId: node.connectionId,
                database,
                schema: encodedSchema,
                linkedServer: node.linkedServer,
                linkedCatalog: node.linkedCatalog,
                linkedSchema: schema,
                isExpanded: false,
                children: [],
              };
            }),
        );
        node.isExpanded = true;
      } catch (e) {
        recordMetadataLoadError(node.connectionId, e);
        throw e;
      } finally {
        node.isLoading = false;
      }
    },

    async loadTables(connectionId: string, database: string, schema?: string, options?: LoadTreeOptions) {
      const nodeId = schema ? `${connectionId}:${database}:${schema}` : `${connectionId}:${database}`;
      const node = findNode(get().treeNodes, nodeId);
      if (!node) return;
      node.isLoading = true;
      try {
        await get().ensureConnected(connectionId);
        if (useCachedChildren(node, options)) return;
        const simpleObjectDisplay = useSettingsStore().editorSettings.sidebarObjectDisplay === "simple";
        const cacheKey = schemaCacheKey(connectionId, database, schema || "", simpleObjectDisplay ? "objects-simple-v2" : "objects-grouped-v2");
        if (!options?.force) {
          const cached = await loadPersistedTreeChildren(node, cacheKey);
          if (cached.hit) {
            if (cached.isStale) refreshStaleTreeNode(node);
            return;
          }
        }

        const config = get().getConfig(connectionId);
        const querySchema = connectionObjectTreeQuerySchema(config, database, schema);
        const effectiveSchema = connectionObjectTreeNodeSchema(config, database, schema);
        let children: TreeNode[];
        if (simpleObjectDisplay) {
          try {
            const [objects, tables] = await Promise.all([api.listObjects(connectionId, database, querySchema), api.listTables(connectionId, database, querySchema)]);
            children = buildSimpleObjectTreeNodes({
              nodeId,
              connectionId,
              database,
              schema: effectiveSchema,
              objects: mergeTableInfosIntoObjects(objects, tables, effectiveSchema),
            });
          } catch {
            const tables = await api.listTables(connectionId, database, querySchema);
            children = buildTableTreeNodes({ nodeId, connectionId, database, schema: effectiveSchema, tables });
          }
        } else {
          children = buildObjectGroupPlaceholderNodes({
            nodeId,
            connectionId,
            database,
            schema: effectiveSchema,
            objectTypes: supportedSidebarObjectTypes(config),
          });
        }
        setChildren(node, children);
        await savePersistedTreeChildren(cacheKey, children);
        node.isExpanded = true;
      } catch (e) {
        recordMetadataLoadError(connectionId, e);
        throw e;
      } finally {
        node.isLoading = false;
      }
    },

    async loadObjectGroupChildren(node: TreeNode, options?: LoadTreeOptions) {
      if (!node.connectionId || !hasTreeNodeDatabaseContext(node)) return;
      node.isLoading = true;
      try {
        await get().ensureConnected(node.connectionId);
        if (useCachedChildren(node, options)) return;
        const objectTypes = objectTypesForGroupNode(node.type);
        const parentNodeId = objectGroupRefreshParentId(node);
        if (!objectTypes || !parentNodeId) return;

        const config = get().getConfig(node.connectionId);
        const querySchema = connectionObjectTreeQuerySchema(config, node.database, node.schema);
        const effectiveSchema = connectionObjectTreeNodeSchema(config, node.database, node.schema);
        const cacheKey = objectGroupCacheKey(node);
        if (!options?.force && !get().sidebarSearchQuery) {
          const cached = await loadPersistedTreeChildren(node, cacheKey);
          if (cached.hit) {
            if (cached.isStale) refreshStaleTreeNode(node);
            return;
          }
        }

        const wantsOnlyTablesOrViews = objectTypes.every((objectType) => objectType === "TABLE" || objectType === "VIEW" || objectType === "MATERIALIZED_VIEW");
        let children: TreeNode[];
        if (wantsOnlyTablesOrViews) {
          const page = await loadPagedTableGroupChildren({
            node,
            parentNodeId,
            querySchema,
            effectiveSchema,
            objectTypes,
            offset: 0,
            pageSize: sidebarObjectGroupPageSize(),
          });
          children = page.hasMore && !get().sidebarSearchQuery ? [...page.children, buildLoadMoreNode(node, page.nextOffset, sidebarObjectGroupPageSize())] : page.children;
          node.objectCount = page.objectCount;
        } else {
          const objects = await api.listObjects(node.connectionId, node.database, querySchema, objectTypes);
          children = objectGroupChildrenFromObjects({
            node,
            parentNodeId,
            effectiveSchema,
            objectTypes,
            objects,
          });
          node.objectCount = children.length;
        }
        setChildren(node, children);
        if (!get().sidebarSearchQuery) {
          await savePersistedTreeChildren(cacheKey, children);
        }
        node.isExpanded = true;
      } catch (e) {
        recordMetadataLoadError(node.connectionId, e);
        throw e;
      } finally {
        node.isLoading = false;
      }
    },

    async loadMoreObjectGroupChildren(node: TreeNode) {
      if (node.type !== "load-more" || !node.loadMore) return;
      const parent = findNode(get().treeNodes, node.loadMore.parentId);
      if (!parent?.connectionId || !hasTreeNodeDatabaseContext(parent)) return;
      node.isLoading = true;
      try {
        await get().ensureConnected(parent.connectionId);
        const objectTypes = objectTypesForGroupNode(parent.type);
        const parentNodeId = objectGroupRefreshParentId(parent);
        if (!objectTypes || !parentNodeId) return;
        if (!objectTypes.every((objectType) => objectType === "TABLE" || objectType === "VIEW" || objectType === "MATERIALIZED_VIEW")) return;

        const config = get().getConfig(parent.connectionId);
        const querySchema = connectionObjectTreeQuerySchema(config, parent.database, parent.schema);
        const effectiveSchema = connectionObjectTreeNodeSchema(config, parent.database, parent.schema);
        const page = await loadPagedTableGroupChildren({
          node: parent,
          parentNodeId,
          querySchema,
          effectiveSchema,
          objectTypes,
          offset: node.loadMore.offset,
          pageSize: node.loadMore.pageSize,
        });
        const currentChildren = withoutLoadMoreNodes(parent.children);
        const nextChildren = page.hasMore ? [...currentChildren, ...page.children, buildLoadMoreNode(parent, page.nextOffset, node.loadMore.pageSize)] : [...currentChildren, ...page.children];
        parent.objectCount = (parent.objectCount ?? currentChildren.length) + page.objectCount;
        setChildren(parent, nextChildren);
        await savePersistedTreeChildren(objectGroupCacheKey(parent), nextChildren);
        parent.isExpanded = true;
      } catch (e) {
        recordMetadataLoadError(parent.connectionId, e);
        throw e;
      } finally {
        node.isLoading = false;
      }
    },

    async loadTableGroups(connectionId: string, database: string, table: string, schema?: string, nodeId?: string) {
      const parentId = nodeId ?? (schema ? `${connectionId}:${database}:${schema}:${table}` : `${connectionId}:${database}:${table}`);
      const node = findNode(get().treeNodes, parentId);
      if (!node) return;

      const children: TreeNode[] = [
        ...tablePartitionGroups(node),
        {
          id: `${parentId}:__columns`,
          label: "tree.columns",
          type: "group-columns",
          connectionId,
          database,
          schema,
          tableName: table,
          isExpanded: false,
          children: [],
        },
      ];

      const config = get().getConfig(connectionId);
      const metadataCapabilities = getTableMetadataCapabilities(effectiveDatabaseTypeForConnection(config));
      if (node.type === "table" && !parseSqlServerLinkedSchema(schema)) {
        if (metadataCapabilities.indexes) {
          children.push({
            id: `${parentId}:__indexes`,
            label: "tree.indexes",
            type: "group-indexes",
            connectionId,
            database,
            schema,
            tableName: table,
            isExpanded: false,
            children: [],
          });
        }
        if (metadataCapabilities.foreignKeys) {
          children.push({
            id: `${parentId}:__fkeys`,
            label: "tree.foreignKeys",
            type: "group-fkeys",
            connectionId,
            database,
            schema,
            tableName: table,
            isExpanded: false,
            children: [],
          });
        }
        if (metadataCapabilities.triggers) {
          children.push({
            id: `${parentId}:__triggers`,
            label: "tree.triggers",
            type: "group-triggers",
            connectionId,
            database,
            schema,
            tableName: table,
            isExpanded: false,
            children: [],
          });
        }
      }

      setChildren(node, children);
      node.isExpanded = true;
    },

    async loadColumns(connectionId: string, database: string, table: string, schema?: string, nodeId?: string) {
      const parentId = nodeId ?? (schema ? `${connectionId}:${database}:${schema}:${table}:__columns` : `${connectionId}:${database}:${table}:__columns`);
      const node = findNode(get().treeNodes, parentId);
      if (!node) return;

      node.isLoading = true;
      try {
        const querySchema = metadataQuerySchema(connectionId, database, schema);
        const columns = await api.getColumns(connectionId, database, querySchema, table);
        setChildren(
          node,
          columns.map((col) => ({
            id: `${parentId}:${col.name}`,
            label: `${col.name} (${col.data_type})`,
            type: "column" as const,
            connectionId,
            database,
            schema,
            tableName: table,
            meta: col,
          })),
        );
        node.isExpanded = true;
      } catch (e) {
        recordMetadataLoadError(connectionId, e);
        throw e;
      } finally {
        node.isLoading = false;
      }
    },

    async loadIndexes(connectionId: string, database: string, table: string, schema?: string, nodeId?: string) {
      const parentId = nodeId ?? (schema ? `${connectionId}:${database}:${schema}:${table}:__indexes` : `${connectionId}:${database}:${table}:__indexes`);
      const node = findNode(get().treeNodes, parentId);
      if (!node) return;

      node.isLoading = true;
      try {
        const metadataCapabilities = getTableMetadataCapabilities(effectiveDatabaseTypeForConnection(get().getConfig(connectionId)));
        if (!metadataCapabilities.indexes) {
          setChildren(node, []);
          node.isExpanded = true;
          return;
        }
        const querySchema = metadataQuerySchema(connectionId, database, schema);
        const indexes = await api.listIndexes(connectionId, database, querySchema, table);
        setChildren(
          node,
          indexes.map((idx) => ({
            id: `${parentId}:${idx.name}`,
            label: `${idx.name} (${idx.columns.join(", ")})`,
            type: "index" as const,
            connectionId,
            database,
            schema,
            tableName: table,
            meta: idx,
          })),
        );
        node.isExpanded = true;
      } catch (e) {
        recordMetadataLoadError(connectionId, e);
        throw e;
      } finally {
        node.isLoading = false;
      }
    },

    async loadForeignKeys(connectionId: string, database: string, table: string, schema?: string, nodeId?: string) {
      const parentId = nodeId ?? (schema ? `${connectionId}:${database}:${schema}:${table}:__fkeys` : `${connectionId}:${database}:${table}:__fkeys`);
      const node = findNode(get().treeNodes, parentId);
      if (!node) return;

      node.isLoading = true;
      try {
        const metadataCapabilities = getTableMetadataCapabilities(effectiveDatabaseTypeForConnection(get().getConfig(connectionId)));
        if (!metadataCapabilities.foreignKeys) {
          setChildren(node, []);
          node.isExpanded = true;
          return;
        }
        const querySchema = metadataQuerySchema(connectionId, database, schema);
        const fkeys = await api.listForeignKeys(connectionId, database, querySchema, table);
        const cacheKey = `${connectionId}:${database}:${schema || ""}:${table}`;
        const completionForeignKeysCache = { ...get().completionForeignKeysCache, [cacheKey]: fkeys };
        set({ completionForeignKeysCache });
        evictOldestCacheEntries(completionForeignKeysCache, COMPLETION_CACHE_MAX);
        indexCompletionForeignKeys(connectionId, database, table, schema, sqlCompletionForeignKeys(fkeys));
        setChildren(
          node,
          fkeys.map((fk) => ({
            id: `${parentId}:${fk.name}`,
            label: `${fk.column} → ${fk.ref_table}.${fk.ref_column}`,
            type: "fkey" as const,
            connectionId,
            database,
            schema,
            tableName: table,
            meta: fk,
          })),
        );
        node.isExpanded = true;
      } catch (e) {
        recordMetadataLoadError(connectionId, e);
        throw e;
      } finally {
        node.isLoading = false;
      }
    },

    async loadTriggers(connectionId: string, database: string, table: string, schema?: string, nodeId?: string) {
      const parentId = nodeId ?? (schema ? `${connectionId}:${database}:${schema}:${table}:__triggers` : `${connectionId}:${database}:${table}:__triggers`);
      const node = findNode(get().treeNodes, parentId);
      if (!node) return;

      node.isLoading = true;
      try {
        const metadataCapabilities = getTableMetadataCapabilities(effectiveDatabaseTypeForConnection(get().getConfig(connectionId)));
        if (!metadataCapabilities.triggers) {
          setChildren(node, []);
          node.isExpanded = true;
          return;
        }
        const querySchema = metadataQuerySchema(connectionId, database, schema);
        const triggers = await api.listTriggers(connectionId, database, querySchema, table);
        setChildren(
          node,
          triggers.map((tr) => ({
            id: `${parentId}:${tr.name}`,
            label: `${tr.name} (${tr.timing} ${tr.event})`,
            type: "trigger" as const,
            connectionId,
            database,
            schema,
            tableName: table,
            meta: tr,
          })),
        );
        node.isExpanded = true;
      } catch (e) {
        recordMetadataLoadError(connectionId, e);
        throw e;
      } finally {
        node.isLoading = false;
      }
    },

    loadTreeNodeChildren,

    async refreshTreeNode(node: TreeNode) {
      if (objectTypesForGroupNode(node.type)) {
        get().clearLoadedChildrenCache(node.id);
        await get().loadObjectGroupChildren(node, { force: true });
        return;
      }

      const parentId = objectGroupRefreshParentId(node);
      const parentNode = parentId ? findNode(get().treeNodes, parentId) : null;
      if (parentNode) {
        await get().refreshTreeNode(parentNode);
        return;
      }

      if (node.connectionId && !get().connectedIds.has(node.connectionId)) return;
      const expandedIds = collectExpandedNodeIds([node]);
      expandedIds.add(node.id);
      const treeNodes = get().treeNodes;
      const targetNode = findNode(treeNodes, node.id);
      if (targetNode) {
        targetNode.children = [];
      }
      await get().clearLoadedChildrenCache(node.id);
      await loadTreeNodeChildren(node, { force: true });
      await restoreExpandedChildren(node, expandedIds, { force: true });
    },

    async refreshDatabaseTreeNode(connectionId: string, database: string) {
      const node = findDatabaseTreeNode(get().treeNodes, connectionId, database);
      if (node) {
        await get().refreshTreeNode(node);
        return;
      }
      await get().loadDatabases(connectionId, { force: true });
    },

    async refreshObjectListTreeNode(connectionId: string, database: string, schema?: string) {
      const config = get().getConfig(connectionId);
      const shouldRefreshSchemaNode = schema && !(config?.db_type === "sqlserver" && schema.toLowerCase() === "dbo");
      const node = shouldRefreshSchemaNode ? findNode(get().treeNodes, `${connectionId}:${database}:${schema}`) : null;
      if (node) {
        await get().refreshTreeNode(node);
        return;
      }
      await get().refreshDatabaseTreeNode(connectionId, database);
    },

    invalidateCompletionCache(connectionId: string, database?: string) {
      const cachePrefix = database == null ? `${connectionId}:` : `${connectionId}:${database}:`;
      const exactCacheKey = database == null ? null : `${connectionId}:${database}`;
      const completionTablesCache = { ...get().completionTablesCache };
      const completionObjectsCache = { ...get().completionObjectsCache };
      const completionColumnsCache = { ...get().completionColumnsCache };
      const completionForeignKeysCache = { ...get().completionForeignKeysCache };
      const completionDatabasesCache = { ...get().completionDatabasesCache };
      const elasticsearchCompletionIndicesCache = { ...get().elasticsearchCompletionIndicesCache };
      const redisCompletionKeysCache = { ...get().redisCompletionKeysCache };
      const schemaListCache = { ...get().schemaListCache };

      for (const key of Object.keys(completionTablesCache)) {
        if (key === exactCacheKey || key.startsWith(cachePrefix)) delete completionTablesCache[key];
      }
      for (const key of Object.keys(completionObjectsCache)) {
        if (key === exactCacheKey || key.startsWith(cachePrefix)) delete completionObjectsCache[key];
      }
      for (const key of Object.keys(completionColumnsCache)) {
        if (key === exactCacheKey || key.startsWith(cachePrefix)) delete completionColumnsCache[key];
      }
      for (const key of Object.keys(completionForeignKeysCache)) {
        if (key === exactCacheKey || key.startsWith(cachePrefix)) delete completionForeignKeysCache[key];
      }
      for (const key of Object.keys(schemaListCache)) {
        if (key === exactCacheKey || key.startsWith(cachePrefix)) delete schemaListCache[key];
      }
      for (const key of Object.keys(elasticsearchCompletionIndicesCache)) {
        if (key === exactCacheKey || key.startsWith(cachePrefix)) delete elasticsearchCompletionIndicesCache[key];
      }
      for (const key of Object.keys(redisCompletionKeysCache)) {
        if (key === exactCacheKey || key.startsWith(cachePrefix)) delete redisCompletionKeysCache[key];
      }
      for (const key of completionTableIndex.keys()) {
        if (key.startsWith(cachePrefix)) completionTableIndex.delete(key);
      }
      for (const key of completionObjectIndex.keys()) {
        if (key.startsWith(cachePrefix)) completionObjectIndex.delete(key);
      }
      for (const key of completionColumnIndex.keys()) {
        if (key.startsWith(cachePrefix)) completionColumnIndex.delete(key);
      }
      for (const key of completionForeignKeyIndex.keys()) {
        if (key.startsWith(cachePrefix)) completionForeignKeyIndex.delete(key);
      }
      for (const key of completionInFlight.keys()) {
        if (key.startsWith(cachePrefix)) completionInFlight.delete(key);
      }
      set({ completionTablesCache, completionObjectsCache, completionColumnsCache, completionForeignKeysCache, completionDatabasesCache, elasticsearchCompletionIndicesCache, redisCompletionKeysCache, schemaListCache });
    },

    async listCompletionDatabases(connectionId: string): Promise<string[]> {
      if (get().completionDatabasesCache[connectionId]) {
        return get().completionDatabasesCache[connectionId];
      }
      return withCompletionInFlight(`${connectionId}:completion-databases`, async () => {
        await get().ensureConnected(connectionId);
        const config = get().getConfig(connectionId);
        const databases = await api.listDatabases(connectionId);
        const completionDatabasesCache = {
          ...get().completionDatabasesCache,
          [connectionId]: filterDatabaseNamesForConnection(databases.map((database) => database.name), config),
        };
        set({ completionDatabasesCache });
        return completionDatabasesCache[connectionId];
      });
    },

    async listCompletionSchemas(connectionId: string, database: string): Promise<string[]> {
      const cacheKey = `${connectionId}:${database}`;
      if (get().schemaListCache[cacheKey]) {
        return get().schemaListCache[cacheKey];
      }
      return withCompletionInFlight(`${cacheKey}:schemas`, async () => {
        const schemas = await api.listSchemas(connectionId, database);
        const schemaListCache = { ...get().schemaListCache, [cacheKey]: schemas };
        set({ schemaListCache });
        return schemas;
      });
    },

    async listElasticsearchCompletionIndices(connectionId: string, database: string): Promise<string[]> {
      const cacheKey = `${connectionId}:${database}`;
      if (get().elasticsearchCompletionIndicesCache[cacheKey]) {
        return get().elasticsearchCompletionIndicesCache[cacheKey];
      }
      await get().ensureConnected(connectionId);
      const indices = await api.elasticsearchListIndices(connectionId);
      const elasticsearchCompletionIndicesCache = { ...get().elasticsearchCompletionIndicesCache, [cacheKey]: indices };
      set({ elasticsearchCompletionIndicesCache });
      evictOldestCacheEntries(completionTablesCache, COMPLETION_CACHE_MAX);
      return indices;
    },

    async listRedisCompletionKeys(connectionId: string, database: string): Promise<string[]> {
      if (!database) return [];
      const cacheKey = `${connectionId}:${database}`;
      const cached = get().redisCompletionKeysCache[cacheKey];
      if (cached) return cached;
      return withCompletionInFlight(`${cacheKey}:redis-keys`, async () => {
        await get().ensureConnected(connectionId);
        const pageSize = useSettingsStore().editorSettings.redisScanPageSize;
        const result = await api.redisScanKeysBatch(connectionId, Number(database), 0, "*", pageSize, 6);
        const keys = result.keys.map((key) => key.key_display).slice(0, REDIS_COMPLETION_KEYS_MAX);
        const redisCompletionKeysCache = { ...get().redisCompletionKeysCache, [cacheKey]: keys };
        set({ redisCompletionKeysCache });
        evictOldestCacheEntries(redisCompletionKeysCache, COMPLETION_CACHE_MAX);
        return keys;
      });
    },

    async listCompletionTables(connectionId: string, database: string, filter = "", limit?: number, schema?: string): Promise<SqlCompletionTable[]> {
      const normalizedFilter = filter.trim().toLowerCase();
      const relaxedFilter = relaxedCompletionTableFilter(normalizedFilter);
      const cacheKey = `${connectionId}:${database}:${normalizedFilter}:${limit ?? ""}:${schema ?? ""}`;
      if (get().completionTablesCache[cacheKey]) {
        return get().completionTablesCache[cacheKey];
      }

      return withCompletionInFlight(`${cacheKey}:tables`, async () => {
        await get().ensureConnected(connectionId);

        if (isSchemaAwareDatabase(connectionId)) {
          const schemas = schema ? [schema] : await listCompletionSchemas(connectionId, database);
          if (normalizedFilter || limit) {
            const batchSize = 5;
            const results: SqlCompletionTable[] = [];
            const maxResults = limit ?? Infinity;
            for (let i = 0; i < schemas.length && results.length < maxResults; i += batchSize) {
              const batch = schemas.slice(i, i + batchSize);
              const batchResults = await Promise.all(
                batch.map(async (s) => {
                  try {
                    const tables = await api.listTables(connectionId, database, s, normalizedFilter, limit);
                    return tables.map((table) => ({
                      name: table.name,
                      schema: s,
                      type: table.table_type === "VIEW" || table.table_type === "MATERIALIZED_VIEW" ? ("view" as const) : ("table" as const),
                    })) as SqlCompletionTable[];
                  } catch {
                    return [] as SqlCompletionTable[];
                  }
                }),
              );
              for (const group of batchResults) {
                results.push(...group);
                indexCompletionTables(connectionId, database, undefined, group);
              }
            }
            const limitedTables = limit ? dedupeCompletionTables(results).slice(0, limit) : results;
            const completionTablesCache = { ...get().completionTablesCache, [cacheKey]: limitedTables };
            set({ completionTablesCache });
            indexCompletionTables(connectionId, database, schema, limitedTables);
            evictOldestCacheEntries(completionTablesCache, COMPLETION_CACHE_MAX);
            return limitedTables;
          }

          const tableGroups = await Promise.all(
            schemas.map(async (schema) => {
              try {
                const tables = await api.listTables(connectionId, database, schema);
                return tables.map((table) => ({
                  name: table.name,
                  schema,
                  type: table.table_type === "VIEW" || table.table_type === "MATERIALIZED_VIEW" ? ("view" as const) : ("table" as const),
                }));
              } catch {
                return [];
              }
            }),
          );
          const allTables = tableGroups.flat();
          const completionTablesCache = { ...get().completionTablesCache, [cacheKey]: allTables };
          set({ completionTablesCache });
          indexCompletionTables(connectionId, database, schema, allTables);
          evictOldestCacheEntries(completionTablesCache, COMPLETION_CACHE_MAX);
          return allTables;
        }

        let tables = await api.listTables(connectionId, database, database, normalizedFilter, limit);
        if (tables.length === 0 && relaxedFilter) {
          tables = await api.listTables(connectionId, database, database, relaxedFilter, expandedCompletionLimit(limit));
        }
        const resultTables = tables.map((table) => ({
          name: table.name,
          type: table.table_type === "VIEW" || table.table_type === "MATERIALIZED_VIEW" ? ("view" as const) : ("table" as const),
        }));
        const completionTablesCache = { ...get().completionTablesCache, [cacheKey]: resultTables };
        set({ completionTablesCache });
        indexCompletionTables(connectionId, database, schema, resultTables);
        evictOldestCacheEntries(completionTablesCache, COMPLETION_CACHE_MAX);
        return resultTables;
      });
    },

    async listCompletionObjects(connectionId: string, database: string, filter = "", limit?: number, schema?: string): Promise<SqlCompletionObject[]> {
      const normalizedFilter = filter.trim().toLowerCase();
      const cacheKey = `${connectionId}:${database}:${schema ?? ""}`;
      const existing = get().completionObjectsCache[cacheKey];
      if (!existing) {
        await withCompletionInFlight(`${cacheKey}:objects`, async () => {
          await get().ensureConnected(connectionId);
          const objects = isSchemaAwareDatabase(connectionId) ? await listSchemaAwareCompletionObjects(connectionId, database, schema) : await api.listCompletionObjects(connectionId, database, schema || database);
          const completionObjectsCache = {
            ...get().completionObjectsCache,
            [cacheKey]: dedupeCompletionObjects(objects.map(toSqlCompletionObject).filter((object): object is SqlCompletionObject => object != null)),
          };
          set({ completionObjectsCache });
          indexCompletionObjects(connectionId, database, schema, completionObjectsCache[cacheKey]);
          evictOldestCacheEntries(completionObjectsCache, COMPLETION_CACHE_MAX);
        });
      }

      const objects = get().completionObjectsCache[cacheKey];
      const filtered = normalizedFilter ? objects.filter((object) => fuzzyCompletionObjectMatch(object, normalizedFilter)) : objects;
      return typeof limit === "number" ? filtered.slice(0, limit) : filtered;
    },

    async listCompletionColumns(connectionId: string, database: string, table: string, schema?: string): Promise<SqlCompletionColumn[]> {
      if (isSchemaAwareDatabase(connectionId) && !connectionUsesDatabaseObjectTreeMode(get().getConfig(connectionId)) && !schema) {
        return [];
      }
      const cacheKey = `${connectionId}:${database}:${schema || ""}:${table}`;
      if (!get().completionColumnsCache[cacheKey]) {
        await withCompletionInFlight(`${cacheKey}:columns`, async () => {
          await get().ensureConnected(connectionId);
          const querySchema = metadataQuerySchema(connectionId, database, schema);
          const columns = await api.getColumns(connectionId, database, querySchema, table);
          const completionColumnsCache = { ...get().completionColumnsCache, [cacheKey]: columns };
          set({ completionColumnsCache });
          evictOldestCacheEntries(completionColumnsCache, COMPLETION_CACHE_MAX);
        });
      }

      const columns = get().completionColumnsCache[cacheKey].map((column) => ({
        name: column.name,
        table,
        schema,
        dataType: column.data_type,
        isNullable: column.is_nullable,
        comment: column.comment,
      }));
      indexCompletionColumns(connectionId, database, table, schema, columns);
      return columns;
    },

    async listCompletionForeignKeys(connectionId: string, database: string, table: string, schema?: string): Promise<SqlCompletionForeignKey[]> {
      if (isSchemaAwareDatabase(connectionId) && !connectionUsesDatabaseObjectTreeMode(get().getConfig(connectionId)) && !schema) {
        return [];
      }
      const metadataCapabilities = getTableMetadataCapabilities(effectiveDatabaseTypeForConnection(get().getConfig(connectionId)));
      if (!metadataCapabilities.foreignKeys) return [];

      const cacheKey = `${connectionId}:${database}:${schema || ""}:${table}`;
      if (!get().completionForeignKeysCache[cacheKey]) {
        await withCompletionInFlight(`${cacheKey}:fkeys`, async () => {
          await get().ensureConnected(connectionId);
          const querySchema = metadataQuerySchema(connectionId, database, schema);
          const foreignKeys = await api.listForeignKeys(connectionId, database, querySchema, table);
          const completionForeignKeysCache = { ...get().completionForeignKeysCache, [cacheKey]: foreignKeys };
          set({ completionForeignKeysCache });
          evictOldestCacheEntries(completionForeignKeysCache, COMPLETION_CACHE_MAX);
        });
      }

      const foreignKeys = sqlCompletionForeignKeys(get().completionForeignKeysCache[cacheKey]);
      indexCompletionForeignKeys(connectionId, database, table, schema, foreignKeys);
      return foreignKeys;
    },

    lookupLocalCompletionTables,

    lookupLocalCompletionObjects,

    lookupLocalCompletionColumns,

    lookupLocalCompletionForeignKeys,

    lookupLocalCompletionSchemas,

    lookupLocalCompletionDatabases,

    refreshCompletionTables: (connectionId: string, database: string, filter?: string, limit?: number, schema?: string) => get().listCompletionTables(connectionId, database, filter, limit, schema),

    refreshCompletionObjects: (connectionId: string, database: string, filter?: string, limit?: number, schema?: string) => get().listCompletionObjects(connectionId, database, filter, limit, schema),

    refreshCompletionSchemas: (connectionId: string, database: string) => get().listCompletionSchemas(connectionId, database),

    refreshCompletionDatabases: (connectionId: string) => get().listCompletionDatabases(connectionId),

    refreshCompletionColumns: (connectionId: string, database: string, table: string, schema?: string) => get().listCompletionColumns(connectionId, database, table, schema),

    refreshCompletionForeignKeys: (connectionId: string, database: string, table: string, schema?: string) => get().listCompletionForeignKeys(connectionId, database, table, schema),

    async refreshAllTree() {
      const expandedIds = collectExpandedNodeIds(get().treeNodes);
      const refreshExpandedNodes = async (nodes: TreeNode[]) => {
        for (const node of nodes) {
          if (node.type === "connection-group") {
            if (node.children) await refreshExpandedNodes(node.children);
            continue;
          }
          if (!expandedIds.has(node.id)) continue;
          if (node.connectionId && !get().connectedIds.has(node.connectionId)) continue;
          get().clearLoadedChildrenCache(node.id);
          node.children = [];
          await loadTreeNodeChildren(node, { force: true });
          await restoreExpandedChildren(node, expandedIds, { force: true });
        }
      };
      await refreshExpandedNodes(get().treeNodes);
    },

    async exportConnectionsToFile(passphrase: string) {
      await exportConnectionsToFileImpl(passphrase);
    },

    async readImportFile(source?: ImportSource) {
      return readImportFileImpl(source);
    },

    async importConnectionsFromFile(content: string, passphrase: string | null) {
      return importConnectionsFromFileImpl(content, passphrase);
    },

    async applyDataGripKeychainPasswords() {
      return applyDataGripKeychainPasswordsImpl();
    },

    applySidebarLayout(layout: SidebarLayout) {
      const reconciledLayout = reconcileLayout(get().connections.map((c) => c.id), layout);
      updateLayoutAndRebuild(reconciledLayout);
    },

    createConnectionGroup(name: string, parentGroupId?: string | null) {
      const result = createGroupOp(get().sidebarLayout, name, parentGroupId);
      updateLayoutAndRebuild(result.layout);
      return result.groupId;
    },

    renameConnectionGroup(groupId: string, name: string) {
      updateLayoutAndRebuild(renameGroupOp(get().sidebarLayout, groupId, name));
    },

    deleteConnectionGroup(groupId: string) {
      updateLayoutAndRebuild(deleteGroupOp(get().sidebarLayout, groupId));
    },

    toggleConnectionGroupCollapsed(groupId: string) {
      updateLayoutAndRebuild(toggleGroupCollapsedOp(get().sidebarLayout, groupId));
    },

    moveConnectionToGroup(connectionId: string, groupId: string | null) {
      updateLayoutAndRebuild(moveConnectionToGroupOp(get().sidebarLayout, connectionId, groupId));
    },

    reorderSidebarEntry(draggedId: string, targetId: string, position: DropPosition) {
      updateLayoutAndRebuild(reorderEntryOp(get().sidebarLayout, draggedId, targetId, position));
    },

    reorderSidebarEntries(draggedIds: string[], targetId: string, position: DropPosition) {
      let layout = get().sidebarLayout;
      let changed = false;
      for (const id of draggedIds) {
        if (id === targetId) continue;
        layout = reorderEntryOp(layout, id, targetId, position);
        changed = true;
      }
      if (changed) updateLayoutAndRebuild(layout);
    },

    startEditing(id: string) {
      set({ editingConnectionId: id });
    },

    stopEditing() {
      set({ editingConnectionId: null });
    },

    startCreatingConnectionInGroup(groupId: string) {
      get().stopEditing();
      set({ newConnectionGroupId: groupId });
    },

    stopCreatingConnectionInGroup() {
      set({ newConnectionGroupId: null });
    },
    rebuildTreeNodes,
    reloadConnectionDatabaseChildren,
  };
}));

export type { DropPosition };
