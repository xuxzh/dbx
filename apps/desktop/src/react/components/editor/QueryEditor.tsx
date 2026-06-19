import {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
  type Ref,
} from "react";
import { EditorState, Compartment } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLineGutter,
  highlightActiveLine,
  tooltips,
  rectangularSelection,
  dropCursor,
  crosshairCursor,
  ViewPlugin,
  Decoration,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentMore,
  indentLess,
  insertNewlineKeepIndent,
  moveLineUp,
  moveLineDown,
  copyLineDown,
  copyLineUp,
  deleteLine,
  undo,
  redo,
  selectAll,
} from "@codemirror/commands";
import { sql, SQLDialect, PostgreSQL, MSSQL, MySQL } from "@codemirror/lang-sql";
import { search as cmSearch } from "@codemirror/search";
import {
  autocompletion,
  completionStatus,
  acceptCompletion,
  closeBrackets,
  closeBracketsKeymap,
  snippetCompletion,
} from "@codemirror/autocomplete";
import { searchKeymap, closeBrackets as closeBracketsPlugin } from "@codemirror/search";
import {
  bracketMatching,
  foldGutter,
  indentOnInput,
  syntaxHighlighting,
  defaultHighlightStyle,
  foldKeymap,
} from "@codemirror/language";
import type { CompletionContext } from "@codemirror/autocomplete";
import { EditorSelection } from "@codemirror/state";
import type {
  SqlExecutionSnapshot,
  SqlSemanticDiagnostic,
} from "@/lib/sqlExecutionTarget";
import {
  resolveExecutableSql,
  type SqlFormatDialect,
} from "@/lib/sqlFormatter";
import { useConnectionStore } from "@/react/stores/connectionStore";
import { useSettingsStore } from "@/react/stores/settingsStore";
import { useTheme } from "@/react/hooks/useTheme";
import { useToast } from "@/react/hooks/useToast";
import {
  buildSqlCompletionItemsFromContext,
  getSqlFunctionSignatureHelp,
  getSqlCompletionContext,
  getSqlCompletionResultValidFor,
  isSqlLikeCompletionStatement,
  recordCompletionSelection,
  shouldAutoOpenSqlCompletion,
  extractCteDefinitions,
} from "@/lib/sqlCompletion";
import {
  buildElasticsearchCompletionItemsFromContext,
  getElasticsearchCompletionContext,
  getElasticsearchCompletionResultValidFor,
  shouldAutoOpenElasticsearchCompletion,
  type ElasticsearchCompletionItem,
} from "@/lib/elasticsearchCompletion";
import {
  extractIdentifierAt,
  isSqlKeyword,
  matchTable,
} from "@/lib/sqlNavigation";
import {
  lineColumnToOffset,
  parseSqlErrorLocation,
} from "@/lib/sqlDiagnostics";
import {
  DBX_TABLE_REFERENCE_MIME,
  DBX_TABLE_REFERENCE_DROP_EVENT,
  activeTableReferencePayloadValue,
  clearActiveTableReferencePayload,
  hasTableReferencePayloadType,
  parseTableReferencePayload,
  tableReferenceInsertText,
  type QueryEditorTableReferenceDropDetail,
  type QueryEditorTableReferencePayload,
} from "@/lib/queryEditorTableDrop";
import {
  EDITOR_FONT_FAMILY_CSS_VAR,
  EDITOR_FONT_SIZE_CSS_VAR,
  loadEditorTheme,
  editorFontTheme,
  sqlCompletionTheme,
} from "@/lib/editorThemes";
import {
  clampEditorFontSize,
  createEditorZoomCommitScheduler,
  fontSizeFromGestureScale,
  fontSizeFromWheelDelta,
} from "@/lib/editorZoom";
import { normalizeShortcutSettings, shortcutToCodeMirrorKey } from "@/lib/shortcutRegistry";
import { trimmedSelectionLayer } from "@/lib/codemirrorTrimmedSelectionLayer";
import { selectionMatchOccurrences } from "@/lib/codemirrorSelectionMatches";
import { isSchemaAware, isSingleDatabase } from "@/lib/databaseFeatureSupport";
import { qualifiedTableNameAtSqlPosition } from "@/lib/queryCursorTableTarget";
import * as api from "@/lib/api";
import {
  areSqlSemanticDiagnosticsEqual,
  buildSqlParserErrorDiagnostic,
  buildSqlSemanticDiagnostics,
  shouldRunSqlSemanticDiagnostics,
} from "@/lib/sqlSemanticDiagnostics";
import {
  buildRedisSyntaxDiagnostics,
  shouldRunRedisDiagnostics,
} from "@/lib/redisSyntaxDiagnostics";
import {
  buildRedisCompletionItemsFromContext,
  getRedisCompletionContext,
  getRedisCompletionResultValidFor,
  shouldAutoOpenRedisCompletion,
  takesKeyArgument,
  type RedisCompletionItem,
} from "@/lib/redisCompletion";
import type {
  SqlCompletionColumn,
  SqlCompletionForeignKey,
  SqlCompletionObject,
} from "@/lib/sqlCompletion";
import type { DatabaseType, SqlReferenceAnalysis, SqlTableReference } from "@/types/database";
import { EditorSearchPanel } from "./EditorSearchPanel";
import { Play, Copy, Table2, TextSelect } from "lucide-react";
import { copyToClipboard } from "@/lib/clipboard";

interface QueryEditorProps {
  value: string;
  onChange: (value: string) => void;
  onSelectionChange?: (selection: string) => void;
  onCursorChange?: (pos: number) => void;
  onFormatError?: (message: string) => void;
  onExecute?: (snapshot: SqlExecutionSnapshot) => void;
  onSave?: () => void;
  onClickTable?: (tableName: string) => void;
  onViewTableData?: (tableName: string) => void;
  onClickColumn?: (
    columns: Array<{ name: string; table: string; schema?: string }>,
    error?: string
  ) => void;
  onCloseColumnPanel?: () => void;
  onViewportChange?: (viewport: { scrollTop: number; scrollLeft: number }) => void;
  onSelectionStateChange?: (selection: { anchor: number; head: number }) => void;
  connectionId?: string;
  database?: string;
  schema?: string;
  databaseType?: DatabaseType;
  dialect?: "mysql" | "postgres" | "sqlserver";
  formatDialect?: SqlFormatDialect;
  formatRequestId?: number;
  executionError?: string;
  readOnly?: boolean;
  forceWordWrap?: boolean;
  initialViewport?: { scrollTop: number; scrollLeft: number };
  initialSelection?: { anchor: number; head: number };
  t: (key: string) => string;
}

const MAX_COMPLETION_TABLES = 200;
const MAX_JOIN_FK_PREFETCH_TABLES = 24;

const SQL_FUNCTION_NAMES = [
  "COUNT", "SUM", "AVG", "MIN", "MAX", "GROUP_CONCAT", "STRING_AGG",
  "CONCAT", "CONCAT_WS", "SUBSTRING", "REPLACE", "TRIM", "UPPER", "LOWER",
  "LENGTH", "REGEXP_REPLACE", "DATE_FORMAT", "DATEDIFF", "DATE_ADD",
  "DATE_SUB", "EXTRACT", "NOW", "ROUND", "FLOOR", "CEIL", "ABS", "MOD",
  "COALESCE", "IFNULL", "NULLIF", "CAST", "JSON_EXTRACT", "JSON_VALUE",
  "JSON_OBJECT", "JSON_ARRAY",
] as const;

export function QueryEditor({
  value,
  onChange,
  onSelectionChange,
  onCursorChange,
  onFormatError,
  onExecute,
  onSave,
  onClickTable,
  onViewTableData,
  onClickColumn,
  onCloseColumnPanel,
  onViewportChange,
  onSelectionStateChange,
  connectionId,
  database,
  schema,
  databaseType,
  dialect,
  formatDialect,
  formatRequestId,
  executionError,
  readOnly = false,
  forceWordWrap = false,
  initialViewport,
  initialSelection,
  t,
}: QueryEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const searchPanelRef = useRef<{ openSearch: () => boolean; openReplace: () => boolean; closeSearch: () => boolean } | null>(null);

  const connectionStore = useConnectionStore();
  const settingsStore = useSettingsStore();
  const { isDark } = useTheme();
  const { toast } = useToast();

  // State
  const [selectedSql, setSelectedSql] = useState("");
  const [executableSql, setExecutableSql] = useState("");
  const [contextTableName, setContextTableName] = useState<string | null>(null);

  // Refs for values that need to be accessed in closures
  const viewRefInternal = useRef<EditorView | null>(null);
  const settingsRef = useRef(settingsStore.editorSettings);
  const connectionRef = useRef(connectionStore);
  const propsRef = useRef({
    connectionId, database, schema, databaseType, dialect, readOnly, formatDialect
  });

  // Keep refs in sync
  useEffect(() => {
    settingsRef.current = settingsStore.editorSettings;
    connectionRef.current = connectionStore;
    propsRef.current = { connectionId, database, schema, databaseType, dialect, readOnly, formatDialect };
  });

  const completionTranslations = useMemo(() => ({
    nullValue: t("editor.completion.nullValue"),
    isNull: t("editor.completion.isNull"),
    isNotNull: t("editor.completion.isNotNull"),
    stringLiteral: t("editor.completion.stringLiteral"),
    numericLiteral: t("editor.completion.numericLiteral"),
    booleanValue: t("editor.completion.booleanValue"),
    starExpansionColumns: t("editor.completion.starExpansionColumns"),
    functionDescriptions: Object.fromEntries(
      SQL_FUNCTION_NAMES.map((name) => [name, t(`editor.completion.functionDescriptions.${name}`)])
    ) as Record<string, string>,
  }), [t]);

  const [liveFontSize, setLiveFontSize] = useState(settingsStore.editorSettings.fontSize);
  const [gestureStartFontSize, setGestureStartFontSize] = useState(settingsStore.editorSettings.fontSize);
  const [isGestureZooming, setIsGestureZooming] = useState(false);

  // Viewport/selection tracking
  const viewportEmitFrameRef = useRef<number | null>(null);
  const viewportRestoreFrameRef = useRef<number | null>(null);
  const latestViewportRef = useRef(initialViewport);
  const latestSelectionRef = useRef(initialSelection);
  const editorIsActiveRef = useRef(true);
  const tableReferenceDropListenerRef = useRef(false);
  const imeCompositionActiveRef = useRef(false);
  const pendingImeModelEmitRef = useRef(false);

  // Semantic diagnostics
  const semanticDiagnosticsRef = useRef<SqlSemanticDiagnostic[]>([]);
  const semanticDiagnosticTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const semanticDiagnosticRunIdRef = useRef(0);

  // Completion
  const completionEpochRef = useRef(0);
  const completionDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cached tables/columns
  const cachedTablesRef = useRef<Array<{ name: string; schema?: string; type?: "table" | "view" }>>([]);
  const cachedCompletionObjectsRef = useRef<SqlCompletionObject[]>([]);
  const cachedColumnsByTableRef = useRef(new Map<string, SqlCompletionColumn[]>());
  const cachedForeignKeysByTableRef = useRef(new Map<string, SqlCompletionForeignKey[]>());

  const zoomCommitSchedulerRef = useRef(createEditorZoomCommitScheduler((fontSize) => {
    if (settingsStore.editorSettings.fontSize === fontSize) return;
    settingsStore.updateEditorSettings({ fontSize });
  }));

  const tableNavigationHoverClass = "query-editor--table-navigation-hover";

  // Helper functions
  function selectedSqlFromView(currentView: EditorView): string {
    const selection = currentView.state.selection.main;
    return currentView.state.sliceDoc(selection.from, selection.to);
  }

  function executableSqlFromView(currentView: EditorView): string {
    return resolveExecutableSql(currentView.state.doc.toString(), selectedSqlFromView(currentView));
  }

  function sqlExecutionSnapshotFromView(currentView: EditorView): SqlExecutionSnapshot {
    return {
      fullSql: currentView.state.doc.toString(),
      selectedSql: selectedSqlFromView(currentView),
      cursorPos: currentView.state.selection.main.head,
    };
  }

  function syncContextMenuState(currentView: EditorView) {
    setSelectedSql(selectedSqlFromView(currentView));
    setExecutableSql(executableSqlFromView(currentView));
  }

  function syncContextMenuStateAtEvent(currentView: EditorView, event: MouseEvent) {
    syncContextMenuState(currentView);
    const pos = currentView.posAtCoords({ x: event.clientX, y: event.clientY });
    setContextTableName(
      pos == null ? null : qualifiedTableNameAtSqlPosition(currentView.state.doc.toString(), pos)
    );
  }

  // Editor theme
  function editorThemeAppearance() {
    return isDark ? "dark" : "light";
  }

  function syncEditorFontCssVars(fontSize?: number, fontFamily?: string) {
    if (!editorRef.current) return;
    const size = fontSize ?? liveFontSize;
    const family = fontFamily ?? settingsStore.editorSettings.fontFamily;
    editorRef.current.style.setProperty(EDITOR_FONT_SIZE_CSS_VAR, `${clampEditorFontSize(size)}px`);
    editorRef.current.style.setProperty(EDITOR_FONT_FAMILY_CSS_VAR, family);
  }

  function reconfigureFontTheme(view: EditorView, fontThemeComp: Compartment, size: number, family: string) {
    view.dispatch({
      effects: fontThemeComp.reconfigure(
        editorFontTheme(EditorView, size, family, { fixedHeight: true, scrollable: true })
      ),
    });
  }

  let pendingFontReconfigRef = useRef<{ size: number; family: string } | null>(null);
  let fontReconfigScheduledRef = useRef(false);

  function scheduleFontThemeReconfig(size: number, family: string) {
    pendingFontReconfigRef.current = { size, family };
    if (fontReconfigScheduledRef.current) return;
    fontReconfigScheduledRef.current = true;
    requestAnimationFrame(() => {
      fontReconfigScheduledRef.current = false;
      const p = pendingFontReconfigRef.current;
      if (p && viewRefInternal.current && fontThemeCompRef.current) {
        reconfigureFontTheme(viewRefInternal.current, fontThemeCompRef.current, p.size, p.family);
      }
    });
  }

  function applyLiveFontSize(size: number) {
    const next = clampEditorFontSize(size);
    if (liveFontSize === next) return;
    setLiveFontSize(next);
    syncEditorFontCssVars(next);
    scheduleFontThemeReconfig(next, settingsStore.editorSettings.fontFamily);
  }

  function onEditorGestureStart(event: React.GestureEvent) {
    event.preventDefault();
    setIsGestureZooming(true);
    setGestureStartFontSize(liveFontSize);
  }

  function onEditorGestureChange(event: React.GestureEvent) {
    if (typeof event.scale !== "number") return;
    event.preventDefault();
    applyLiveFontSize(fontSizeFromGestureScale(gestureStartFontSize, event.scale));
  }

  function onEditorGestureEnd(event: React.GestureEvent) {
    event.preventDefault();
    setIsGestureZooming(false);
    zoomCommitSchedulerRef.current.flush(liveFontSize);
  }

  function handleTab(view: EditorView): boolean {
    if (completionStatus(view.state) === "active") return false;
    const { state, dispatch } = view;
    const sel = state.selection.main;
    if (!sel.empty) return indentMore(view);
    const line = state.doc.lineAt(sel.from);
    const before = line.text.slice(0, sel.from - line.from);
    if (/^\s*$/.test(before)) return indentMore(view);
    dispatch(state.update(state.replaceSelection("  "), { userEvent: "input.type" }));
    return true;
  }

  function executeCurrentSql() {
    if (viewRefInternal.current) {
      onExecute?.(sqlExecutionSnapshotFromView(viewRefInternal.current));
    }
    return true;
  }

  function focusEditor() {
    viewRefInternal.current?.focus();
  }

  function clearTableNavigationHover() {
    editorRef.current?.classList.remove(tableNavigationHoverClass);
  }

  function tableNavigationIdentifierAt(currentView: EditorView, event: MouseEvent): string | null {
    if (!propsRef.current.connectionId || propsRef.current.database == null) return null;
    const pos = currentView.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos == null) return null;
    const identifier = extractIdentifierAt(currentView.state.doc.toString(), pos);
    if (!identifier || isSqlKeyword(identifier)) return null;
    return identifier;
  }

  function updateTableNavigationHover(currentView: EditorView, event: MouseEvent) {
    if (!event.metaKey && !event.ctrlKey) {
      clearTableNavigationHover();
      return false;
    }
    const identifier = tableNavigationIdentifierAt(currentView, event);
    editorRef.current?.classList.toggle(tableNavigationHoverClass, !!identifier);
    return !!identifier;
  }

  function clearTableNavigationHoverOnModifierRelease(event: KeyboardEvent) {
    if (!event.metaKey && !event.ctrlKey) clearTableNavigationHover();
  }

  async function copySelectedSqlFromContextMenu() {
    if (!selectedSql) return;
    try {
      await copyToClipboard(selectedSql);
      toast(t("grid.copied"));
      focusEditor();
    } catch (e: any) {
      toast(t("grid.copyFailed", { message: e?.message || String(e) }), 5000);
    }
  }

  function selectAllSqlFromContextMenu() {
    const currentView = viewRefInternal.current;
    if (!currentView) return;
    currentView.dispatch({
      selection: { anchor: 0, head: currentView.state.doc.length },
      scrollIntoView: true,
    });
    focusEditor();
  }

  function openTableFromContextMenu() {
    if (!contextTableName) return;
    onViewTableData?.(contextTableName);
    focusEditor();
  }

  // Refs for CodeMirror compartments and extensions
  const fontThemeCompRef = useRef<Compartment | null>(null);
  const codeMirrorThemeRef = useRef<Compartment | null>(null);
  const wordWrapCompRef = useRef<Compartment | null>(null);
  const readOnlyCompRef = useRef<Compartment | null>(null);
  const runKeymapCompRef = useRef<Compartment | null>(null);
  const completionCompRef = useRef<Compartment | null>(null);
  const diagnosticCompRef = useRef<Compartment | null>(null);
  const setSqlDiagnosticsEffectRef = useRef<ReturnType<typeof EditorState["effect"]> | null>(null);
  const buildSqlDiagnosticExtensionRef = useRef<(() => import("@codemirror/state").Extension) | null>(null);
  const buildSqlSignatureExtensionRef = useRef<(() => import("@codemirror/state").Extension) | null>(null);
  const buildSqlCompletionExtensionRef = useRef<(() => import("@codemirror/state").Extension) | null>(null);

  // Refs for CodeMirror functions
  const indentMoreRef = useRef(indentMore);
  const indentLessRef = useRef(indentLess);
  const copyLineDownRef = useRef(copyLineDown);
  const copyLineUpRef = useRef(copyLineUp);
  const deleteLineRef = useRef(deleteLine);
  const moveLineUpRef = useRef(moveLineUp);
  const moveLineDownRef = useRef(moveLineDown);
  const undoRef = useRef(undo);
  const redoRef = useRef(redo);
  const selectAllRef = useRef(selectAll);
  const insertNewlineKeepIndentRef = useRef(insertNewlineKeepIndent);
  const acceptCompletionRef = useRef(acceptCompletion);
  const completionStatusRef = useRef(completionStatus);
  const startCompletionRef = useRef<(() => void) | null>(null);

  // Computed values
  const hasSelectedSql = selectedSql.trim().length > 0;
  const canCopySelectedSql = selectedSql.length > 0;
  const canExecuteContextSql = executableSql.trim().length > 0;
  const executeContextMenuLabel = hasSelectedSql ? t("editor.contextMenu.executeSelection") : t("editor.contextMenu.executeCurrent");

  // Context menu items
  const contextMenuItems = useMemo(() => [
    {
      label: executeContextMenuLabel,
      action: executeCurrentSql,
      disabled: !canExecuteContextSql,
      icon: Play,
    },
    {
      label: t("contextMenu.viewData"),
      action: openTableFromContextMenu,
      disabled: !contextTableName,
      icon: Table2,
    },
    { label: "", separator: true },
    {
      label: t("editor.contextMenu.copySelection"),
      action: copySelectedSqlFromContextMenu,
      disabled: !canCopySelectedSql,
      icon: Copy,
    },
    { label: t("editor.contextMenu.selectAll"), action: selectAllSqlFromContextMenu, icon: TextSelect },
  ], [executeContextMenuLabel, canExecuteContextSql, contextTableName, canCopySelectedSql, t]);

  // Run keymap extension
  function runKeymapExtension(codemirrorKeymap: typeof import("@codemirror/view").keymap) {
    const shortcuts = normalizeShortcutSettings(settingsStore.editorSettings.shortcuts);
    const binding = (shortcut: string, run: (view: EditorView) => boolean) =>
      shortcut ? [{ key: shortcutToCodeMirrorKey(shortcut), preventDefault: true, run }] : [];

    return [
      EditorView.keymap.of([
        {
          key: "Enter",
          run: insertNewlineKeepIndentRef.current,
          shift: insertNewlineKeepIndentRef.current,
        },
        ...binding(shortcuts.find, () => searchPanelRef.current?.openSearch() ?? false),
        ...binding(shortcuts.replace, () => searchPanelRef.current?.openReplace() ?? false),
        ...binding(shortcuts.executeSql, executeCurrentSql),
        ...binding(shortcuts.saveSql, () => { onSave?.(); return true; }),
        ...binding(shortcuts.formatSql, () => { void formatCurrentSql(); return true; }),
        ...binding(shortcuts.indentMore, (view) => indentMoreRef.current(view)),
        ...binding(shortcuts.indentLess, (view) => indentLessRef.current(view)),
        ...binding(shortcuts.duplicateLine, (view) => copyLineDownRef.current(view)),
        ...binding(shortcuts.deleteLine, (view) => deleteLineRef.current(view)),
        ...binding(shortcuts.moveLineUp, (view) => moveLineUpRef.current(view)),
        ...binding(shortcuts.moveLineDown, (view) => moveLineDownRef.current(view)),
        ...binding(shortcuts.copyLineUp, (view) => copyLineUpRef.current(view)),
        ...binding(shortcuts.copyLineDown, (view) => copyLineDownRef.current(view)),
        ...binding(shortcuts.undo, (view) => undoRef.current(view)),
        ...binding(shortcuts.redo, (view) => redoRef.current(view)),
        ...binding(shortcuts.selectAll, (view) => selectAllRef.current(view)),
      ]) as unknown as import("@codemirror/state").Extension,
      codemirrorKeymap.of(
        binding(shortcuts.acceptCompletion, (view) => acceptCompletionRef.current?.(view) ?? false).map((item) => ({
          ...item,
          preventDefault: false,
        }))
      ) as unknown as import("@codemirror/state").Extension,
    ];
  }

  function wordWrapExtension() {
    return forceWordWrap || settingsStore.editorSettings.wordWrap ? EditorView.lineWrapping : [];
  }

  // SQL completion helpers
  function completionCacheKey(table: { name: string; schema?: string | null }) {
    const s = table.schema ?? propsRef.current.schema;
    return s ? `${s}.${table.name}` : table.name;
  }

  function supportsDatabaseQualifierCompletion() {
    return !!propsRef.current.databaseType && !isSchemaAware(propsRef.current.databaseType) && !isSingleDatabase(propsRef.current.databaseType);
  }

  function completionMetadataTarget(table: { name: string; schema?: string | null }) {
    if (propsRef.current.database == null) return null;
    if (supportsDatabaseQualifierCompletion() && table.schema) {
      return { database: table.schema };
    }
    return { database: propsRef.current.database, schema: table.schema ?? propsRef.current.schema };
  }

  function completionQualifiedTableTarget(completionContext: ReturnType<typeof getSqlCompletionContext>) {
    if (!completionContext.suggestColumns) return null;
    const parts = completionContext.qualifierParts ?? completionContext.qualifier?.split(".").filter(Boolean) ?? [];
    if (parts.length < 2) return null;
    const name = parts[parts.length - 1];
    const schema = parts[parts.length - 2];
    if (!name || !schema) return null;
    return { name, schema };
  }

  function completionTablesMatch(left: { name: string; schema?: string | null }, right: { name: string; schema?: string | null }) {
    if (left.name.toLowerCase() !== right.name.toLowerCase()) return false;
    if (!left.schema || !right.schema) return true;
    return left.schema.toLowerCase() === right.schema.toLowerCase();
  }

  async function ensureColumnsForTable(table: { name: string; schema?: string | null }) {
    const cacheKey = completionCacheKey(table);
    if (cachedColumnsByTableRef.current.has(cacheKey) || !propsRef.current.connectionId || propsRef.current.database == null) return;
    const target = completionMetadataTarget(table);
    if (!target) return;
    const columns = await connectionStore.listCompletionColumns(propsRef.current.connectionId, target.database, table.name, target.schema);
    if (columns.length === 0) return;
    cachedColumnsByTableRef.current.set(cacheKey, columns);
  }

  async function ensureForeignKeysForTable(table: { name: string; schema?: string | null }) {
    const cacheKey = completionCacheKey(table);
    if (cachedForeignKeysByTableRef.current.has(cacheKey) || !propsRef.current.connectionId || propsRef.current.database == null) return;
    const target = completionMetadataTarget(table);
    if (!target) return;
    try {
      const foreignKeys = await connectionStore.listCompletionForeignKeys(propsRef.current.connectionId, target.database, table.name, target.schema);
      cachedForeignKeysByTableRef.current.set(cacheKey, foreignKeys);
    } catch (e) {
      cachedForeignKeysByTableRef.current.set(cacheKey, []);
    }
  }

  async function ensureForeignKeysForTables(tables: Array<{ name: string; schema?: string | null }>) {
    const seen = new Set<string>();
    const uniqueTables = tables.filter((table) => {
      const key = completionCacheKey(table).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    await Promise.all(uniqueTables.map((table) => ensureForeignKeysForTable(table)));
  }

  function createHoverDom(title: string, detail: string, rows: string[] = []) {
    const dom = document.createElement("div");
    dom.className = "rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md";
    const heading = document.createElement("div");
    heading.className = "font-medium";
    heading.textContent = title;
    dom.appendChild(heading);
    const detailNode = document.createElement("div");
    detailNode.className = "mt-1 text-muted-foreground";
    detailNode.textContent = detail;
    dom.appendChild(detailNode);
    for (const row of rows) {
      const rowNode = document.createElement("div");
      rowNode.className = "mt-1 font-mono text-muted-foreground";
      rowNode.textContent = row;
      dom.appendChild(rowNode);
    }
    return dom;
  }

  function createSignatureDom(signature: ReturnType<typeof getSqlFunctionSignatureHelp>) {
    const dom = document.createElement("div");
    dom.className = "rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md";
    if (!signature) return dom;
    const signatureNode = document.createElement("div");
    signatureNode.className = "font-mono";
    const nameNode = document.createElement("span");
    nameNode.className = "text-muted-foreground";
    nameNode.textContent = `${signature.name}(`;
    signatureNode.appendChild(nameNode);
    signature.parameters.forEach((parameter, index) => {
      if (index > 0) {
        const comma = document.createElement("span");
        comma.className = "text-muted-foreground";
        comma.textContent = ", ";
        signatureNode.appendChild(comma);
      }
      const parameterNode = document.createElement("span");
      parameterNode.className = index === signature.activeParameter ? "font-semibold text-foreground" : "text-muted-foreground";
      parameterNode.textContent = parameter;
      signatureNode.appendChild(parameterNode);
    });
    const closeNode = document.createElement("span");
    closeNode.className = "text-muted-foreground";
    closeNode.textContent = ")";
    signatureNode.appendChild(closeNode);
    dom.appendChild(signatureNode);
    return dom;
  }

  function identifierRangeAt(sql: string, pos: number): { from: number; to: number; text: string } | null {
    const isIdentifierChar = (ch: string | undefined) => !!ch && /[\w$.]/.test(ch);
    if (!isIdentifierChar(sql[pos]) && !isIdentifierChar(sql[pos - 1])) return null;
    let from = pos;
    while (from > 0 && isIdentifierChar(sql[from - 1])) from--;
    let to = pos;
    while (to < sql.length && isIdentifierChar(sql[to])) to++;
    const text = sql.slice(from, to).replace(/^\.+|\.+$/g, "");
    if (!text || isSqlKeyword(text)) return null;
    return { from, to, text };
  }

  async function resolveSqlHoverTooltip(currentView: EditorView, pos: number) {
    if (!propsRef.current.connectionId || propsRef.current.database == null) return null;
    const sql = currentView.state.doc.toString();
    const range = identifierRangeAt(sql, pos);
    if (!range) return null;
    const identifier = range.text;
    const parts = identifier.split(".");
    const name = parts[parts.length - 1] ?? identifier;
    const qualifier = parts.length > 1 ? parts[parts.length - 2] : undefined;

    try {
      if (cachedTablesRef.current.length === 0) {
        cachedTablesRef.current = await connectionStore.listCompletionTables(
          propsRef.current.connectionId,
          propsRef.current.database,
          name,
          MAX_COMPLETION_TABLES,
          propsRef.current.schema
        );
      }
      let table = matchTable(identifier, cachedTablesRef.current) ?? matchTable(name, cachedTablesRef.current);
      if (!table) {
        const hoverTables = await connectionStore.listCompletionTables(
          propsRef.current.connectionId,
          propsRef.current.database,
          name,
          MAX_COMPLETION_TABLES,
          propsRef.current.schema
        );
        cachedTablesRef.current = [...cachedTablesRef.current, ...hoverTables];
        table = matchTable(identifier, hoverTables) ?? matchTable(name, hoverTables);
      }
      if (table && (!qualifier || table.schema?.toLowerCase() === qualifier.toLowerCase() || table.name === name)) {
        return {
          pos: range.from,
          end: range.to,
          create: () => ({
            dom: createHoverDom(table.name, table.schema ? `table in ${table.schema}` : "table"),
          }),
        };
      }
      const context = getSqlCompletionContext(sql, pos);
      const candidates = qualifier
        ? context.referencedTables.filter(
            (rt) => rt.alias?.toLowerCase() === qualifier.toLowerCase() || rt.name.toLowerCase() === qualifier.toLowerCase()
          )
        : context.referencedTables;
      for (const refTable of candidates) {
        await ensureColumnsForTable(refTable);
        const columns = cachedColumnsByTableRef.current.get(completionCacheKey(refTable)) ?? [];
        const column = columns.find((col) => col.name.toLowerCase() === name.toLowerCase());
        if (!column) continue;
        return {
          pos: range.from,
          end: range.to,
          create: () => ({
            dom: createHoverDom(
              column.name,
              column.dataType || "column",
              [
                column.schema ? `${column.schema}.${column.table}` : column.table,
                ...(column.comment?.trim() ? [column.comment.trim()] : []),
              ]
            ),
          }),
        };
      }
    } catch { return null; }
    return null;
  }

  function sqlErrorDecorationRange(currentState: EditorState) {
    if (!executionError) return [];
    const location = parseSqlErrorLocation(executionError);
    if (!location) return [];
    const offset = lineColumnToOffset(currentState.doc.toString(), location);
    if (offset == null) return [];
    return [{ from: offset, to: Math.min(offset + 1, currentState.doc.length), message: executionError }];
  }

  function sqlTextSpanToRange(sql: string, span: { start_line?: number; start_column?: number; end_line?: number; end_column?: number }): { from: number; to: number } | null {
    if (!span.start_line || !span.start_column) return null;
    const from = lineColumnToOffset(sql, { line: span.start_line - 1, column: span.start_column - 1 });
    const to = lineColumnToOffset(sql, {
      line: Math.max(span.end_line - 1, span.start_line - 1),
      column: Math.max(span.end_column, span.start_column),
    });
    if (from == null || to == null || to <= from) return null;
    return { from, to };
  }

  function sqlSemanticDecorationRanges(currentState: EditorState) {
    const sql = currentState.doc.toString();
    return semanticDiagnosticsRef.current
      .map((diagnostic) => {
        const range = sqlTextSpanToRange(sql, diagnostic.span);
        return range ? { ...range, message: diagnostic.message, severity: diagnostic.severity } : null;
      })
      .filter((range): range is { from: number; to: number; message: string; severity: "error" | "warning" } => !!range);
  }

  function reconfigureDiagnostics() {
    const view = viewRefInternal.current;
    if (!view) return;
    if (setSqlDiagnosticsEffectRef.current) {
      view.dispatch({
        effects: setSqlDiagnosticsEffectRef.current.of(semanticDiagnosticsRef.current),
      });
      return;
    }
    if (!diagnosticCompRef.current || !buildSqlDiagnosticExtensionRef.current) return;
    view.dispatch({
      effects: diagnosticCompRef.current.reconfigure(buildSqlDiagnosticExtensionRef.current()),
    });
  }

  function setSemanticDiagnostics(next: SqlSemanticDiagnostic[]) {
    if (areSqlSemanticDiagnosticsEqual(semanticDiagnosticsRef.current, next)) return;
    semanticDiagnosticsRef.current = next;
    reconfigureDiagnostics();
  }

  async function enrichSemanticDiagnosticTables(tables: SqlTableReference[]) {
    if (!propsRef.current.connectionId || propsRef.current.database == null) return tables;
    const enriched: SqlTableReference[] = [];
    for (const table of tables) {
      if (table.schema) {
        enriched.push(table);
        continue;
      }
      const cached = cachedTablesRef.current.find((item) => item.name.toLowerCase() === table.name.toLowerCase());
      if (cached?.schema) {
        enriched.push({ ...table, schema: cached.schema });
        continue;
      }
      try {
        const matches = await connectionStore.listCompletionTables(
          propsRef.current.connectionId,
          propsRef.current.database,
          table.name,
          MAX_COMPLETION_TABLES,
          propsRef.current.schema
        );
        cachedTablesRef.current = [...cachedTablesRef.current, ...matches];
        const match = matches.find((item) => item.name.toLowerCase() === table.name.toLowerCase());
        enriched.push(match?.schema ? { ...table, schema: match.schema } : table);
      } catch {
        enriched.push(table);
      }
    }
    return enriched;
  }

  async function refreshSemanticDiagnostics() {
    const currentView = viewRefInternal.current;
    const runId = ++semanticDiagnosticRunIdRef.current;
    if (!currentView || !propsRef.current.connectionId || propsRef.current.database == null) {
      setSemanticDiagnostics([]);
      return;
    }
    const sql = currentView.state.doc.toString();
    if (!sql.trim()) {
      setSemanticDiagnostics([]);
      return;
    }
    if (propsRef.current.databaseType === "mongodb" || propsRef.current.databaseType === "elasticsearch") {
      setSemanticDiagnostics([]);
      return;
    }
    if (propsRef.current.databaseType === "redis") {
      if (!shouldRunRedisDiagnostics(sql, currentView.state.selection.main.head)) {
        scheduleSemanticDiagnostics(900);
        return;
      }
      setSemanticDiagnostics(buildRedisSyntaxDiagnostics(sql));
      return;
    }
    if (!shouldRunSqlSemanticDiagnostics(sql, currentView.state.selection.main.head, { databaseType: propsRef.current.databaseType })) {
      scheduleSemanticDiagnostics(1200);
      return;
    }
    if (completionStatusRef.current?.(currentView.state)) {
      scheduleSemanticDiagnostics(900);
      return;
    }
    try {
      const analysis = await api.analyzeSqlReferences(sql, propsRef.current.formatDialect ?? propsRef.current.dialect ?? "generic");
      if (runId !== semanticDiagnosticRunIdRef.current) return;
      const tables = await enrichSemanticDiagnosticTables(analysis.tables);
      await Promise.all(tables.map((table) => ensureColumnsForTable(table)));
      if (runId !== semanticDiagnosticRunIdRef.current) return;
      const enrichedAnalysis: SqlReferenceAnalysis = { ...analysis, tables };
      setSemanticDiagnostics(
        buildSqlSemanticDiagnostics(enrichedAnalysis, {
          tables: cachedTablesRef.current,
          columnsByTable: cachedColumnsByTableRef.current,
        })
      );
    } catch (error) {
      if (runId === semanticDiagnosticRunIdRef.current) {
        const diagnostic = buildSqlParserErrorDiagnostic(error, sql);
        setSemanticDiagnostics(diagnostic ? [diagnostic] : []);
      }
    }
  }

  function scheduleSemanticDiagnostics(delay = 500) {
    if (!editorIsActiveRef.current) return;
    if (semanticDiagnosticTimerRef.current) clearTimeout(semanticDiagnosticTimerRef.current);
    semanticDiagnosticTimerRef.current = setTimeout(() => {
      semanticDiagnosticTimerRef.current = null;
      void refreshSemanticDiagnostics();
    }, delay);
  }

  async function formatCurrentSql() {
    if (propsRef.current.readOnly) return;
    const currentView = viewRefInternal.current;
    if (!currentView) return;
    const originalState = currentView.state;
    const selection = originalState.selection.main;
    const formatsSelection = !selection.empty;
    const from = formatsSelection ? selection.from : 0;
    const to = formatsSelection ? selection.to : originalState.doc.length;
    const source = originalState.sliceDoc(from, to);
    if (!source.trim()) return;
    try {
      const formatted = await formatSqlText(source, propsRef.current.formatDialect ?? propsRef.current.dialect ?? "generic", settingsStore.editorSettings.sqlFormatter);
      if (viewRefInternal.current !== currentView || currentView.state !== originalState || currentView.state.sliceDoc(from, to) !== source) return;
      if (formatted === source) return;
      currentView.dispatch({
        changes: { from, to, insert: formatted },
        selection: formatsSelection ? { anchor: from, head: from + formatted.length } : { anchor: from + formatted.length },
      });
    } catch (e: any) {
      onFormatError?.(String(e?.message || e));
    }
  }

  // Table drop handling
  function droppedTableReference(event: DragEvent) {
    return activeTableReferencePayloadValue() ?? parseTableReferencePayload(event.dataTransfer?.getData(DBX_TABLE_REFERENCE_MIME));
  }

  function hasDroppedTableReference(event: DragEvent) {
    return !!activeTableReferencePayloadValue() || hasTableReferencePayloadType(event.dataTransfer?.types);
  }

  function insertTableReferencePayload(currentView: EditorView, payload: QueryEditorTableReferencePayload, coords?: { clientX: number; clientY: number }): boolean {
    if (propsRef.current.readOnly) return false;
    const insertText = tableReferenceInsertText(payload, propsRef.current.databaseType);
    const dropPos = coords ? currentView.posAtCoords({ x: coords.clientX, y: coords.clientY }) : null;
    const selection = currentView.state.selection.main;
    const from = dropPos ?? selection.from;
    const to = dropPos == null && !selection.empty ? selection.to : from;
    currentView.dispatch({
      changes: { from, to, insert: insertText },
      selection: { anchor: from + insertText.length },
      scrollIntoView: true,
      userEvent: "input.drop",
    });
    clearActiveTableReferencePayload(payload);
    currentView.focus();
    return true;
  }

  function insertDroppedTableReference(currentView: EditorView, event: DragEvent): boolean {
    const payload = droppedTableReference(event);
    if (!payload) return false;
    event.preventDefault();
    event.stopPropagation();
    return insertTableReferencePayload(currentView, payload, { clientX: event.clientX, clientY: event.clientY });
  }

  function onTableReferenceDropEvent(event: Event) {
    const currentView = viewRefInternal.current;
    if (!currentView || propsRef.current.readOnly || !(event instanceof CustomEvent)) return;
    const detail = event.detail as QueryEditorTableReferenceDropDetail | undefined;
    if (!detail?.payload) return;
    const target = document.elementFromPoint(detail.clientX, detail.clientY);
    if (target instanceof Element && editorRef.current?.contains(target)) {
      insertTableReferencePayload(currentView, detail.payload, detail);
    }
  }

  function registerTableReferenceDropListener() {
    if (tableReferenceDropListenerRef.current) return;
    window.addEventListener(DBX_TABLE_REFERENCE_DROP_EVENT, onTableReferenceDropEvent);
    tableReferenceDropListenerRef.current = true;
  }

  function unregisterTableReferenceDropListener() {
    if (!tableReferenceDropListenerRef.current) return;
    window.removeEventListener(DBX_TABLE_REFERENCE_DROP_EVENT, onTableReferenceDropEvent);
    tableReferenceDropListenerRef.current = false;
  }

  // Completion functions
  type QueryCompletionItem = SqlCompletionItem | ElasticsearchCompletionItem | RedisCompletionItem;

  function buildCompletionResult(items: QueryCompletionItem[], from: number, validFor?: RegExp) {
    if (items.length === 0) return null;
    return {
      from,
      filter: false,
      options: items.map((item) => completionOptionForItem(item)),
      validFor,
    };
  }

  function findExactName(names: string[], value: string): string | undefined {
    return names.find((name) => name.toLowerCase() === value.toLowerCase());
  }

  function mergeCompletionQualifierNames(primary: string[], secondary: string[]): string[] {
    const seen = new Set<string>();
    const merged: string[] = [];
    for (const name of [...primary, ...secondary]) {
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(name);
    }
    return merged;
  }

  function completionOptionForItem(item: QueryCompletionItem) {
    const record = () => { recordCompletionSelection(item.label, item.type); };
    if ((item.type === "snippet" || item.type === "function") && item.apply) {
      const completion = snippetCompletion(item.apply, {
        label: item.label,
        type: item.type,
        detail: item.detail,
        info: item.info,
        boost: item.boost,
      });
      const originalApply = completion.apply;
      return {
        ...completion,
        apply(view: EditorView, completionItem: unknown, from: number, to: number) {
          record();
          if (typeof originalApply === "function") {
            originalApply(view, completionItem as never, from, to);
          } else {
            const insert = String(originalApply ?? item.label);
            view.dispatch({
              changes: { from, to, insert },
              selection: { anchor: from + insert.length },
            });
          }
        },
      };
    }
    return {
      label: item.label,
      type: item.type,
      detail: item.detail,
      info: item.info,
      boost: item.boost,
      apply(view: EditorView, _completionItem: unknown, from: number, to: number) {
        record();
        const insert = item.apply ?? item.label;
        view.dispatch({
          changes: { from, to, insert },
          selection: { anchor: from + insert.length },
        });
      },
    };
  }

  async function provideElasticsearchCompletions(currentState: EditorState, position: number, explicit: boolean) {
    if (!propsRef.current.connectionId) return null;
    const epoch = ++completionEpochRef.current;
    const fullDoc = currentState.doc.toString();
    if (!explicit && !shouldAutoOpenElasticsearchCompletion(fullDoc, position)) return null;
    const completionContext = getElasticsearchCompletionContext(fullDoc, position);
    let indices: string[] = [];
    if (propsRef.current.database != null && completionContext.mode === "path") {
      try {
        indices = await connectionStore.listElasticsearchCompletionIndices(propsRef.current.connectionId, propsRef.current.database);
      } catch { indices = []; }
    }
    if (epoch !== completionEpochRef.current) return null;
    const items = buildElasticsearchCompletionItemsFromContext(completionContext, { indices });
    return buildCompletionResult(items, completionContext.from, getElasticsearchCompletionResultValidFor());
  }

  async function _provideRedisCompletions(currentState: EditorState, position: number, explicit: boolean) {
    if (!propsRef.current.connectionId) return null;
    const epoch = ++completionEpochRef.current;
    const fullDoc = currentState.doc.toString();
    if (!explicit && !shouldAutoOpenRedisCompletion(fullDoc, position)) return null;
    const completionContext = getRedisCompletionContext(fullDoc, position);
    let keys: string[] = [];
    if (completionContext.mode === "argument" && propsRef.current.database && takesKeyArgument(completionContext.mainCommand)) {
      try {
        keys = await connectionStore.listRedisCompletionKeys(propsRef.current.connectionId, propsRef.current.database);
      } catch { keys = []; }
    }
    if (epoch !== completionEpochRef.current) return null;
    const items = buildRedisCompletionItemsFromContext(completionContext, { keys });
    if (items.length === 0) return null;
    return {
      from: completionContext.from,
      options: items.map((item) => completionOptionForItem(item)),
      validFor: getRedisCompletionResultValidFor(),
    };
  }

  function isEditorComposing(currentView: EditorView): boolean {
    return imeCompositionActiveRef.current || currentView.compositionStarted || currentView.composing;
  }

  function flushImeComposition() {
    const currentView = viewRefInternal.current;
    if (!currentView || !pendingImeModelEmitRef.current) return;
    pendingImeModelEmitRef.current = false;
    onChange?.(currentView.state.doc.toString());
    scheduleSemanticDiagnostics();
    syncContextMenuState(currentView);
    onSelectionChange?.(selectedSqlFromView(currentView));
    onCursorChange?.(currentView.state.selection.main.head);
    latestSelectionRef.current = readEditorSelection(currentView);
    if (editorIsActiveRef.current) emitEditorSelection(latestSelectionRef.current!);
  }

  // Viewport/selection management
  function readEditorViewport(currentView: EditorView) {
    return {
      scrollTop: Math.max(0, currentView.scrollDOM.scrollTop),
      scrollLeft: Math.max(0, currentView.scrollDOM.scrollLeft),
    };
  }

  function normalizedEditorSelection(selection: { anchor: number; head: number } | undefined, docLength: number) {
    if (!selection) return undefined;
    return {
      anchor: Math.min(Math.max(0, selection.anchor), docLength),
      head: Math.min(Math.max(0, selection.head), docLength),
    };
  }

  function readEditorSelection(currentView: EditorView) {
    const selection = currentView.state.selection.main;
    return { anchor: selection.anchor, head: selection.head };
  }

  function emitEditorSelection(selection: { anchor: number; head: number }) {
    onSelectionStateChange?.(selection);
  }

  function flushEditorSelection() {
    if (viewRefInternal.current) latestSelectionRef.current = readEditorSelection(viewRefInternal.current);
    if (latestSelectionRef.current) emitEditorSelection(latestSelectionRef.current);
  }

  function restoreEditorSelection() {
    const selection = normalizedEditorSelection(propsRef.current.initialSelection ?? latestSelectionRef.current, value.length);
    if (!viewRefInternal.current || !selection) return;
    viewRefInternal.current.dispatch({ selection });
  }

  function restoreEditorFocus() {
    const focusEditorAcrossFrames = () => {
      if (!viewRefInternal.current || viewRefInternal.current.hasFocus) return;
      viewRefInternal.current.focus();
    };
    focusEditorAcrossFrames();
    setTimeout(focusEditorAcrossFrames, 0);
    requestAnimationFrame(focusEditorAcrossFrames);
  }

  function emitEditorViewport(viewport: { scrollTop: number; scrollLeft: number }) {
    onViewportChange?.(viewport);
  }

  function scheduleEditorViewportEmit() {
    if (!viewRefInternal.current || !editorIsActiveRef.current) return;
    latestViewportRef.current = readEditorViewport(viewRefInternal.current);
    if (viewportEmitFrameRef.current !== null) return;
    viewportEmitFrameRef.current = requestAnimationFrame(() => {
      viewportEmitFrameRef.current = null;
      if (latestViewportRef.current) emitEditorViewport(latestViewportRef.current);
    });
  }

  function flushEditorViewport() {
    if (viewportEmitFrameRef.current !== null) {
      cancelAnimationFrame(viewportEmitFrameRef.current);
      viewportEmitFrameRef.current = null;
    }
    if (latestViewportRef.current) emitEditorViewport(latestViewportRef.current);
  }

  function restoreEditorViewport() {
    const viewport = initialViewport ?? latestViewportRef.current;
    if (!viewRefInternal.current || !viewport) return;
    const restoreScroll = () => {
      if (!viewRefInternal.current) return;
      viewRefInternal.current.scrollDOM.scrollTo({
        top: viewport.scrollTop,
        left: viewport.scrollLeft,
      });
      viewRefInternal.current.scrollDOM.scrollTop = viewport.scrollTop;
      viewRefInternal.current.scrollDOM.scrollLeft = viewport.scrollLeft;
    };
    if (viewportRestoreFrameRef.current !== null) cancelAnimationFrame(viewportRestoreFrameRef.current);
    restoreScroll();
    setTimeout(restoreScroll, 0);
    let attempts = 0;
    const restoreNextFrame = () => {
      restoreScroll();
      attempts += 1;
      if (attempts >= 8) {
        viewportRestoreFrameRef.current = null;
        return;
      }
      viewportRestoreFrameRef.current = requestAnimationFrame(restoreNextFrame);
    };
    viewportRestoreFrameRef.current = requestAnimationFrame(restoreNextFrame);
  }

  function pauseQueryEditorBackgroundWork() {
    flushEditorViewport();
    flushEditorSelection();
    clearTableNavigationHover();
    editorIsActiveRef.current = false;
    semanticDiagnosticRunIdRef.current++;
    if (semanticDiagnosticTimerRef.current) clearTimeout(semanticDiagnosticTimerRef.current);
    semanticDiagnosticTimerRef.current = null;
    completionEpochRef.current++;
    unregisterTableReferenceDropListener();
  }

  function _resumeQueryEditorBackgroundWork() {
    editorIsActiveRef.current = true;
    registerTableReferenceDropListener();
    scheduleSemanticDiagnostics();
    restoreEditorSelection();
    restoreEditorFocus();
    restoreEditorViewport();
  }

  // Initialize editor
  useEffect(() => {
    if (!editorRef.current) return;

    let view: EditorView | null = null;

    const initEditor = async () => {
      const [
        { EditorView: EV, keymap: evKeymap, rectangularSelection: rectSel, hoverTooltip, showTooltip, Decoration: Dec, tooltips: tp, lineNumbers: ln, highlightActiveLineGutter: halg, highlightSpecialChars, drawSelection, dropCursor: dc, crosshairCursor, ViewPlugin: VP },
        { EditorState: ES, Compartment: Comp, Prec, StateEffect: _StateEffect, StateField },
        { sql: sqlLang, MSSQL: mssqlDialect, MySQL: mysqlDialect, PostgreSQL: pgDialect, SQLDialect: SqlDialectDef },
        { autocompletion: ac, startCompletion: sc, acceptCompletion: acc, closeBrackets: cb, completionStatus: cs, completionKeymap },
        { cmHistory, defaultKeymap: dmKeymap, historyKeymap, indentMore: im, indentLess: il, insertNewlineKeepIndent: inli, moveLineDown: mld, moveLineUp: mlu, copyLineDown: cld, copyLineUp: clu, deleteLine: dl, undo: u, redo: r, selectAll: sa },
        { bracketMatching: bm, foldGutter: fg, indentOnInput: ioi, syntaxHighlighting: sh, defaultHighlightStyle: dhs, foldKeymap: fk },
        { searchKeymap: sk },
      ] = await Promise.all([
        import("@codemirror/view"),
        import("@codemirror/state"),
        import("@codemirror/lang-sql"),
        import("@codemirror/autocomplete"),
        import("@codemirror/commands"),
        import("@codemirror/language"),
        import("@codemirror/search"),
      ]);

      // Initialize refs
      fontThemeCompRef.current = new Comp();
      codeMirrorThemeRef.current = new Comp();
      wordWrapCompRef.current = new Comp();
      readOnlyCompRef.current = new Comp();
      runKeymapCompRef.current = new Comp();
      completionCompRef.current = new Comp();
      diagnosticCompRef.current = new Comp();

      indentMoreRef.current = im;
      indentLessRef.current = il;
      copyLineDownRef.current = cld;
      copyLineUpRef.current = clu;
      deleteLineRef.current = dl;
      moveLineUpRef.current = mlu;
      moveLineDownRef.current = mld;
      undoRef.current = u;
      redoRef.current = r;
      selectAllRef.current = sa;
      insertNewlineKeepIndentRef.current = inli;
      acceptCompletionRef.current = acc;
      completionStatusRef.current = cs;
      startCompletionRef.current = sc;

      // Diagnostic extension
      const diagnosticTheme = EV.baseTheme({
        ".cm-sql-error": {
          textDecoration: "underline wavy var(--destructive)",
          textUnderlineOffset: "3px",
        },
        ".cm-sql-semantic-warning": {
          textDecoration: "underline wavy hsl(var(--warning, 38 92% 50%))",
          textUnderlineOffset: "3px",
        },
      });

      buildSqlDiagnosticExtensionRef.current = () => {
        const buildDecorations = (state: EditorState) => {
          const errorDecorations = sqlErrorDecorationRange(state).map((range) =>
            Dec.mark({ class: "cm-sql-error", attributes: { title: range.message } }).range(range.from, range.to)
          );
          const semanticDecorations = sqlSemanticDecorationRanges(state).map((range) =>
            Dec.mark({
              class: range.severity === "error" ? "cm-sql-error" : "cm-sql-semantic-warning",
              attributes: { title: range.message },
            }).range(range.from, range.to)
          );
          return Dec.set([...errorDecorations, ...semanticDecorations], true);
        };

        const field = StateField.define({
          create: buildDecorations,
          update(value, transaction) {
            const diagnosticsChanged = !!setSqlDiagnosticsEffectRef.current && transaction.effects.some((effect) => effect.is(setSqlDiagnosticsEffectRef.current));
            return transaction.docChanged || diagnosticsChanged ? buildDecorations(transaction.state) : value;
          },
          provide: (field) => EV.decorations.from(field),
        });

        return [field, diagnosticTheme];
      };

      buildSqlSignatureExtensionRef.current = () =>
        showTooltip.compute(["doc", "selection"], (currentState) => {
          const signature = getSqlFunctionSignatureHelp(currentState.doc.toString(), currentState.selection.main.head);
          if (!signature) return null;
          return {
            pos: currentState.selection.main.head,
            above: false,
            clip: false,
            create: () => ({ dom: createSignatureDom(signature) }),
          };
        });

      buildSqlCompletionExtensionRef.current = () =>
        ac({
          activateOnTyping: true,
          override: [async (context: CompletionContext) => {
            const result = await provideSqlCompletions(context.state, context.pos, context.explicit);
            return result;
          }],
        });

      const baseDialect = propsRef.current.dialect === "postgres" ? pgDialect : propsRef.current.dialect === "sqlserver" ? mssqlDialect : mysqlDialect;
      const extraKeywords = "PIVOT UNPIVOT EXCLUDE REPLACE QUALIFY ASOF POSITIONAL ANTI SEMI SAMPLE TABLESAMPLE STRUCT MAP LIST ARRAY LAMBDA UNNEST LATERAL FILTER RECURSIVE SUMMARIZE PRAGMA READ_CSV READ_PARQUET READ_JSON DESCRIBE SHOW COPY EXPORT IMPORT";
      const isPostgres = propsRef.current.dialect === "postgres";
      const plpgsqlKeywords = isPostgres ? "PERFORM" : "";
      const plpgsqlTypes = isPostgres ? " RECORD JSON JSONB" : "";
      const plpgsqlBuiltin = isPostgres ? "SQLERRM TG_NAME TG_WHEN TG_LEVEL TG_OP TG_RELID TG_RELNAME TG_TABLE_NAME TG_TABLE_SCHEMA TG_NARGS TG_ARGV" : "";

      const dialect = SqlDialectDef.define({
        ...baseDialect.spec,
        keywords: [baseDialect.spec.keywords || "", extraKeywords, plpgsqlKeywords].filter(Boolean).join(" "),
        types: [baseDialect.spec.types || "", plpgsqlTypes].filter(Boolean).join(" ") || undefined,
        builtin: [baseDialect.spec.builtin || "", plpgsqlBuiltin].filter(Boolean).join(" ") || undefined,
        doubleDollarQuotedStrings: false,
      });

      const initialSettings = settingsRef.current;
      const theme = await loadEditorTheme(initialSettings.theme, editorThemeAppearance(), getCurrentCustomThemeColors());

      const activeLineHighlighter = VP.fromClass(
        class {
          decorations: DecorationSet;
          constructor(view: EditorView) {
            this.decorations = this.getDeco(view);
          }
          update(update: { docChanged: boolean; selectionSet: boolean; view: EditorView }) {
            if (update.docChanged || update.selectionSet) this.decorations = this.getDeco(update.view);
          }
          getDeco(view: EditorView) {
            if (!view.state.selection.main.empty) return Decoration.none;
            let lastLineStart = -1;
            const deco: any[] = [];
            for (const r of view.state.selection.ranges) {
              if (!r.empty) continue;
              const line = view.lineBlockAt(r.head);
              if (line.from > lastLineStart) {
                deco.push(Decoration.line({ class: "cm-activeLine" }).range(line.from));
                lastLineStart = line.from;
              }
            }
            return Decoration.set(deco);
          }
        },
        { decorations: (v) => (v as any).decorations }
      );

      const cmSearchExtension = cmSearch({
        top: true,
        createPanel: () => ({ dom: document.createElement("span"), mount: () => {}, destroy: () => {} }),
      });

      const state = ES.create({
        doc: value,
        selection: normalizedEditorSelection(initialSelection, value.length),
        extensions: [
          cmSearchExtension,
          ln({
            domEventHandlers: {
              mousedown: (e, view) => {
                const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
                if (pos == null) return false;
                const line = view.state.doc.lineAt(pos);
                if (e.button === 0) {
                  view.dispatch({
                    selection: { anchor: line.from, head: line.to },
                    scrollIntoView: true,
                    userEvent: "select.pointer",
                  });
                  view.focus();
                  return true;
                }
                return false;
              },
            },
          }),
          halg(),
          highlightSpecialChars(),
          cmHistory(),
          fg(),
          drawSelection(),
          trimmedSelectionLayer(),
          selectionMatchOccurrences(),
          dc(),
          ES.allowMultipleSelections.of(true),
          ioi(),
          sh(dhs, { fallback: true }),
          crosshairCursor(),
          activeLineHighlighter,
          evKeymap.of([...dmKeymap, ...sk, ...historyKeymap, ...fk, ...completionKeymap]),
          sqlLang({ dialect }),
          tp({ parent: document.body }),
          completionCompRef.current!.of(buildSqlCompletionExtensionRef.current!()),
          sqlCompletionTheme(EV),
          codeMirrorThemeRef.current!.of(theme),
          cb(),
          bm(),
          hoverTooltip((currentView, pos) => resolveSqlHoverTooltip(currentView, pos)),
          buildSqlSignatureExtensionRef.current!(),
          diagnosticCompRef.current!.of(buildSqlDiagnosticExtensionRef.current!()),
          Prec.highest(
            evKeymap.of([
              ...closeBracketsKeymap,
              { key: "Tab", run: handleTab },
              {
                key: "Escape",
                run: () => searchPanelRef.current?.closeSearch() ?? false,
              },
            ])
          ),
          runKeymapCompRef.current!.of(runKeymapExtension(evKeymap)),
          wordWrapCompRef.current!.of(forceWordWrap || initialSettings.wordWrap ? EV.lineWrapping : []),
          readOnlyCompRef.current!.of([ES.readOnly.of(!!readOnly), EV.editable.of(!readOnly)]),
          rectSel({ eventFilter: (e: MouseEvent) => e.altKey || e.button === 1 }),
          EV.updateListener.of((update) => {
            if (update.docChanged) {
              if (isEditorComposing(update.view)) {
                pendingImeModelEmitRef.current = true;
                completionEpochRef.current++;
              } else {
                onChange?.(update.state.doc.toString());
                scheduleSemanticDiagnostics();
                let insertedText = "";
                update.changes.iterChanges((_fromA, _toA, _fromB, _toB, inserted) => {
                  insertedText += inserted.toString();
                });
                if (insertedText.endsWith(".")) {
                  startCompletionRef.current?.(update.view);
                }
              }
            }
            if (update.selectionSet || update.docChanged) {
              syncContextMenuState(update.view);
              onSelectionChange?.(selectedSqlFromView(update.view));
              onCursorChange?.(update.state.selection.main.head);
              latestSelectionRef.current = readEditorSelection(update.view);
              if (editorIsActiveRef.current) emitEditorSelection(latestSelectionRef.current!);
            }
          }),
          fontThemeCompRef.current!.of(
            editorFontTheme(EV, liveFontSize, initialSettings.fontFamily, { fixedHeight: true, scrollable: true })
          ),
          EV.domEventHandlers({
            dragover(event) {
              if (readOnly || !hasDroppedTableReference(event as unknown as DragEvent)) return false;
              event.preventDefault();
              if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
              return true;
            },
            drop(event, currentView) {
              return insertDroppedTableReference(currentView, event as unknown as DragEvent);
            },
            blur(_event, currentView) {
              latestSelectionRef.current = readEditorSelection(currentView);
              if (editorIsActiveRef.current) emitEditorSelection(latestSelectionRef.current!);
              return false;
            },
            compositionstart() {
              imeCompositionActiveRef.current = true;
              completionEpochRef.current++;
              return false;
            },
            compositionend() {
              imeCompositionActiveRef.current = false;
              setTimeout(flushImeComposition, 0);
              return false;
            },
            wheel(event) {
              if (!event.metaKey && !event.ctrlKey) return false;
              event.preventDefault();
              const next = fontSizeFromWheelDelta(liveFontSize, event.deltaY);
              applyLiveFontSize(next);
              zoomCommitSchedulerRef.current.schedule(next);
              return true;
            },
            mousemove: (event: MouseEvent) => {
              const currentView = viewRefInternal.current;
              if (!currentView) return false;
              updateTableNavigationHover(currentView, event);
              return false;
            },
            mouseleave: () => {
              clearTableNavigationHover();
              return false;
            },
            mousedown: (event: MouseEvent) => {
              clearTableNavigationHover();
              if (!event.metaKey && !event.ctrlKey) {
                if (event.button === 0) {
                  onCloseColumnPanel?.();
                }
                return false;
              }
              if (event.button !== 0) return false;
              const currentView = viewRefInternal.current;
              if (!currentView || !propsRef.current.connectionId || propsRef.current.database == null) return false;
              const coords = { x: event.clientX, y: event.clientY };
              const pos = currentView.posAtCoords(coords);
              if (pos == null) return false;
              const doc = currentView.state.doc.toString();
              const identifier = extractIdentifierAt(doc, pos);
              if (!identifier || isSqlKeyword(identifier)) return false;
              event.preventDefault();
              setTimeout(async () => {
                try {
                  if (cachedTablesRef.current.length === 0) {
                    cachedTablesRef.current = await connectionStore.listCompletionTables(
                      propsRef.current.connectionId!,
                      propsRef.current.database!,
                      identifier,
                      MAX_COMPLETION_TABLES,
                      propsRef.current.schema
                    );
                  }
                  const matchedTable = matchTable(identifier, cachedTablesRef.current);
                  if (matchedTable) {
                    onClickTable?.(matchedTable.schema ? `${matchedTable.schema}.${matchedTable.name}` : matchedTable.name);
                    return;
                  }
                  const context = getSqlCompletionContext(doc, pos);
                  let referencedTables = context.referencedTables;
                  referencedTables = referencedTables.map((rt) => {
                    const cached = cachedTablesRef.current.find((ct) => ct.name.toLowerCase() === rt.name.toLowerCase());
                    if (cached && cached.schema && !rt.schema) return { ...rt, schema: cached.schema };
                    return rt;
                  });
                  const qualifierMatch = /^(.+)\.(.+)$/.exec(identifier);
                  const qualifier = qualifierMatch ? qualifierMatch[1] : null;
                  const colName = qualifierMatch ? qualifierMatch[2] : identifier;
                  const colLower = colName.toLowerCase();
                  if (referencedTables.length === 0) return;
                  const tablesToCheck = qualifier
                    ? referencedTables.filter(
                        (rt) => rt.alias?.toLowerCase() === qualifier.toLowerCase() || rt.name.toLowerCase() === qualifier.toLowerCase()
                      )
                    : referencedTables;
                  if (tablesToCheck.length === 0 && qualifier) return;
                  const matchedCols: Array<{ name: string; table: string; schema?: string }> = [];
                  for (const refTable of tablesToCheck) {
                    const cacheKey = refTable.schema ? `${refTable.schema}.${refTable.name}` : refTable.name;
                    let cols = cachedColumnsByTableRef.current.get(cacheKey);
                    if (!cols) {
                      try {
                        cols = await connectionStore.listCompletionColumns(
                          propsRef.current.connectionId!,
                          propsRef.current.database!,
                          refTable.name,
                          refTable.schema ?? propsRef.current.schema
                        );
                        cachedColumnsByTableRef.current.set(cacheKey, cols);
                      } catch { continue; }
                    }
                    for (const col of cols) {
                      if (col.name.toLowerCase() === colLower) {
                        matchedCols.push({ name: col.name, table: refTable.name, schema: col.schema || refTable.schema });
                      }
                    }
                  }
                  if (matchedCols.length > 0) onClickColumn?.(matchedCols);
                } catch (e) {
                  console.error("[DBX] Ctrl+click error:", e);
                }
              }, 0);
              return true;
            },
          }),
        ],
      });

      view = new EV({ state, parent: editorRef.current! });
      viewRef.current = view;
      viewRefInternal.current = view;

      view.scrollDOM.addEventListener("scroll", scheduleEditorViewportEmit, { passive: true });
      restoreEditorViewport();
      syncContextMenuState(view);
      syncEditorFontCssVars();
      registerTableReferenceDropListener();

      cachedTablesRef.current = [];
      cachedCompletionObjectsRef.current = [];
      scheduleSemanticDiagnostics();
    };

    initEditor();

    // Global event listeners
    window.addEventListener("keyup", clearTableNavigationHoverOnModifierRelease);
    window.addEventListener("blur", clearTableNavigationHover);

    return () => {
      pauseQueryEditorBackgroundWork();
      if (viewportEmitFrameRef.current !== null) {
        cancelAnimationFrame(viewportEmitFrameRef.current);
        viewportEmitFrameRef.current = null;
      }
      if (viewportRestoreFrameRef.current !== null) {
        cancelAnimationFrame(viewportRestoreFrameRef.current);
        viewportRestoreFrameRef.current = null;
      }
      view?.scrollDOM.removeEventListener("scroll", scheduleEditorViewportEmit);
      window.removeEventListener("keyup", clearTableNavigationHoverOnModifierRelease);
      window.removeEventListener("blur", clearTableNavigationHover);
      zoomCommitSchedulerRef.current.dispose();
      view?.destroy();
      viewRef.current = null;
      viewRefInternal.current = null;
    };
  }, []);

  // Sync value from props
  useEffect(() => {
    const view = viewRefInternal.current;
    if (view && value !== view.state.doc.toString()) {
      if (isEditorComposing(view)) return;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
      });
    }
  }, [value]);

  // Format request
  useEffect(() => {
    if (formatRequestId) {
      void formatCurrentSql();
    }
  }, [formatRequestId]);

  // Execution error
  useEffect(() => {
    reconfigureDiagnostics();
  }, [executionError]);

  // Connection/database/schema changes
  useEffect(() => {
    cachedTablesRef.current = [];
    cachedCompletionObjectsRef.current = [];
    cachedColumnsByTableRef.current.clear();
    cachedForeignKeysByTableRef.current.clear();
    setSemanticDiagnostics([]);
    scheduleSemanticDiagnostics();
  }, [connectionId, database, schema]);

  // Force word wrap
  useEffect(() => {
    if (!viewRefInternal.current || !wordWrapCompRef.current) return;
    viewRefInternal.current.dispatch({
      effects: wordWrapCompRef.current.reconfigure(wordWrapExtension()),
    });
  }, [forceWordWrap]);

  // Get current custom theme colors
  function getCurrentCustomThemeColors() {
    const settings = settingsRef.current;
    if (settings.theme !== "custom") return settings.customThemeColors;
    const activeTheme = settings.customThemes?.find((t: { id: string }) => t.id === settings.activeCustomThemeId) || settings.customThemes?.[0];
    return activeTheme?.colors ?? settings.customThemeColors;
  }

  // Editor settings changes
  useEffect(() => {
    const view = viewRefInternal.current;
    if (!view || !codeMirrorThemeRef.current || !fontThemeCompRef.current || !wordWrapCompRef.current || !runKeymapCompRef.current) return;
    if (!isGestureZooming && !zoomCommitSchedulerRef.current.hasPendingCommit() && liveFontSize !== settingsStore.editorSettings.fontSize) {
      setLiveFontSize(settingsStore.editorSettings.fontSize);
    }
    syncEditorFontCssVars();
    const themeColors = getCurrentCustomThemeColors();
    void loadEditorTheme(settingsStore.editorSettings.theme, editorThemeAppearance(), themeColors).then((themeExt) => {
      view.dispatch({
        effects: [
          codeMirrorThemeRef.current!.reconfigure(themeExt),
          wordWrapCompRef.current!.reconfigure(wordWrapExtension()),
          runKeymapCompRef.current!.reconfigure(runKeymapExtension(keymap)),
        ],
      });
    });
  }, [settingsStore.editorSettings, isDark]);

  // Snippets changes
  useEffect(() => {
    completionEpochRef.current++;
    if (!viewRefInternal.current || !completionCompRef.current || !buildSqlCompletionExtensionRef.current) return;
    viewRefInternal.current.dispatch({
      effects: completionCompRef.current.reconfigure(buildSqlCompletionExtensionRef.current!()),
    });
    if (completionStatusRef.current?.(viewRefInternal.current.state) === "active") {
      startCompletionRef.current?.(viewRefInternal.current);
    }
  }, [settingsStore.editorSettings.snippets]);

  function _openSearch(): boolean {
    return searchPanelRef.current?.openSearch() ?? false;
  }

  function _openReplace(): boolean {
    return searchPanelRef.current?.openReplace() ?? false;
  }

  function _scrollCursorIntoView() {
    if (!viewRefInternal.current || !editorIsActiveRef.current) return;
    const pos = viewRefInternal.current.state.selection.main.head;
    viewRefInternal.current.dispatch({
      effects: EditorView.scrollIntoView(pos, { y: "nearest" }),
    });
  }

  return (
    <div
      className="h-full w-full overflow-hidden relative"
      onGestureStart={onEditorGestureStart}
      onGestureChange={onEditorGestureChange}
      onGestureEnd={onEditorGestureEnd}
    >
      <div
        ref={editorRef}
        data-query-editor-root
        className="h-full w-full overflow-hidden"
        onContextMenu={(e) => {
          const view = viewRefInternal.current;
          if (view) syncContextMenuStateAtEvent(view, e.nativeEvent as MouseEvent);
        }}
      />
      <EditorSearchPanel
        ref={searchPanelRef}
        view={viewRef.current}
        t={t}
      />
      <style>{`
        .query-editor--table-navigation-hover .cm-content,
        .query-editor--table-navigation-hover .cm-line {
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}

// Provide SQL completions - extracted to separate function
async function _provideSqlCompletions(currentState: EditorState, position: number, explicit: boolean) {
  // This is a simplified version - full implementation would need access to all the completion logic
  return null;
}
