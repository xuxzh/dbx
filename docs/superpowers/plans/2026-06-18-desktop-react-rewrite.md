# Desktop React 重写实施计划

> **给 agentic workers：** 实施本计划时必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，并按任务逐项执行。步骤使用 checkbox（`- [ ]`）语法追踪进度。

**目标：** 将 `apps/desktop` 从 Vue 重写为 React，同时保持当前桌面端行为、视觉布局、Tauri 集成和用户工作流不变。

**架构：** 采用分阶段迁移。迁移期通过环境变量临时保留 Vue/React 双入口；框架无关的 TypeScript 业务逻辑继续放在 `src/lib`，Tauri API 边界保持稳定；UI 组件、stores、hooks 和框架适配层按模块切换。只有在 React 版通过功能等价验收后，才切换默认入口并删除 Vue 相关依赖和源码。

**技术栈：** Vite、Tauri 2、React、TypeScript、Tailwind v4、shadcn/ui React、Radix UI、lucide-react、Zustand、i18next/react-i18next、CodeMirror 6、ECharts、@tanstack/react-virtual、Vitest。

---

## 基本原则

- 迁移目标是功能和视觉等价，不在迁移过程中顺手 redesign。
- 除非某个任务明确要求，否则不修改 Rust/Tauri commands、API payload、数据库类型、localStorage key 或持久化 tab 格式。
- 优先复用 `apps/desktop/src/lib` 和 `apps/desktop/src/types` 中已有的纯 TypeScript 模块。
- 每个迁移模块只有在 React build/typecheck 通过，并完成对应用户工作流验证后，才算完成。
- 在 cutover 前，Vue 仍作为默认入口，React 通过显式环境变量启用。

## 目标文件结构

- 修改 `package.json`：加入 React 依赖、脚本，并在最终阶段移除 Vue 依赖。
- 修改 `apps/desktop/vite.config.ts`：迁移期支持 Vue/React 双入口，cutover 后改为 React-only。
- 修改 `apps/desktop/tsconfig.json`：支持 React JSX，并在最终阶段移除 Vue include。
- 新建 `apps/desktop/src/main.shared.ts`：承载启动错误展示、debug capture、全局 input 属性等框架无关逻辑。
- 保留 `apps/desktop/src/main.ts` 作为迁移期 Vue 入口；新增 `apps/desktop/src/react/main.tsx` 作为 React 入口。
- 新建 `apps/desktop/src/react/App.tsx`、`apps/desktop/src/react/providers`、`apps/desktop/src/react/hooks`、`apps/desktop/src/react/stores`、`apps/desktop/src/react/components`。
- 继续复用 `apps/desktop/src/styles/globals.css`；最终清理时移除 Vue-only Tailwind source/import。
- 先把组件迁移到 React 路径，只有在最终清理阶段才删除 `.vue` 文件。

## Task 1: 建立基线

**文件：**
- 读取：`package.json`
- 读取：`apps/desktop/vite.config.ts`
- 读取：`apps/desktop/tsconfig.json`
- 读取：`apps/desktop/src/main.ts`
- 读取：`apps/desktop/src/App.vue`

- [ ] **Step 1: 记录当前 git 状态**

运行：

```bash
rtk git status --short
```

预期：记录所有已有用户改动。不要回退无关改动。

- [ ] **Step 2: 执行当前验证命令**

运行：

```bash
rtk pnpm typecheck
rtk pnpm test
rtk pnpm build
```

预期：记录通过/失败状态。如果迁移前已有命令失败，保留准确失败信息，并判断是已有问题还是迁移阻塞项。

- [ ] **Step 3: 记录当前 UI 工作流基线**

手动或通过浏览器/Tauri 自动化验证：

```text
1. 桌面端启动时没有 startup error。
2. Web mode 可通过 `pnpm dev:web` 启动。
3. Sidebar 能渲染已保存连接。
4. 可以创建新的 query tab。
5. Query editor 可以输入 SQL，并能追踪选区变化。
6. SQL 执行、取消、分页、排序、chart/result tab 行为保持正常。
7. Settings、connection dialog、SQL library、history、AI panel、update dialog 可以打开且布局无明显回归。
8. 主题和语言能在 reload 后保持。
9. Web mode 下 Tauri-only 功能被隐藏或有 guard。
```

预期：该清单作为后续 React 等价验收清单。

- [ ] **Step 4: 如需 checkpoint，则提交基线文档**

只有团队需要为计划或基线记录建立 checkpoint 时才提交。

```bash
rtk git add docs/superpowers/plans/2026-06-18-desktop-react-rewrite.md
rtk git commit -m "docs: add desktop react rewrite plan"
```

预期：仅文档提交。本任务不要 stage 应用源码。

## Task 2: 添加 React 基础设施，但不改变默认运行时

**文件：**
- 修改：`package.json`
- 修改：`apps/desktop/vite.config.ts`
- 修改：`apps/desktop/tsconfig.json`
- 新建：`apps/desktop/src/main.shared.ts`
- 新建：`apps/desktop/src/react/main.tsx`
- 新建：`apps/desktop/src/react/App.tsx`
- 新建：`apps/desktop/src/react/providers/AppProviders.tsx`

- [ ] **Step 1: 添加 React 依赖**

添加 runtime dependencies：

```bash
rtk pnpm add react react-dom zustand i18next react-i18next lucide-react @tanstack/react-virtual
```

添加 dev dependencies：

```bash
rtk pnpm add -D @vitejs/plugin-react @types/react @types/react-dom
```

预期：`package.json` 和 lockfile 包含 React 栈。迁移期保留 Vue 依赖。

- [ ] **Step 2: 拆出共享启动代码**

将 `apps/desktop/src/main.ts` 中框架无关的函数移到 `apps/desktop/src/main.shared.ts`：

```ts
export function startupErrorMessage(error: unknown): string;
export function renderStartupError(error: unknown): void;
export function installStartupErrorHandlers(): void;
export function installGlobalInputAttrs(): void;
export function installFrontendDiagnostics(): void;
```

预期：Vue 入口改为导入这些 helper，运行行为与之前一致。

- [ ] **Step 3: 创建 React 入口**

实现 `apps/desktop/src/react/main.tsx`：

```tsx
import React from "react";
import { createRoot } from "react-dom/client";
import "../styles/globals.css";
import { installFrontendDiagnostics, installGlobalInputAttrs, renderStartupError } from "../main.shared";
import { App } from "./App";

async function bootstrap() {
  installFrontendDiagnostics();
  const root = document.querySelector<HTMLDivElement>("#root");
  if (!root) throw new Error("Missing #root element");
  createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
  installGlobalInputAttrs();
}

void bootstrap().catch(renderStartupError);
```

预期：React 入口可以渲染最小 app，但默认入口仍是 Vue。

- [ ] **Step 4: 添加双入口 Vite 开关**

更新 `apps/desktop/vite.config.ts`，使 `VITE_DESKTOP_UI=react` 时使用 `src/react/main.tsx`，默认仍使用 Vue。

预期：

```bash
rtk pnpm build
rtk env VITE_DESKTOP_UI=react pnpm build
```

两个 build 都能完成；React build 渲染最小 shell。

- [ ] **Step 5: 更新 TypeScript 配置**

设置 React JSX，同时保留 Vue include：

```json
{
  "compilerOptions": {
    "jsx": "react-jsx"
  },
  "include": ["src/**/*.ts", "src/**/*.tsx", "src/**/*.vue"]
}
```

预期：

```bash
rtk pnpm typecheck
```

当前 Vue typecheck 保持通过。如果 `vue-tsc` 不接受 React JSX，则临时新增 `typecheck:react`，使用 `tsc --noEmit --project apps/desktop/tsconfig.react.json`；cutover 前保持 `pnpm typecheck` 不变。

## Task 3: 安装 React shadcn/ui 基础组件

**文件：**
- 修改：`apps/desktop/components.json`
- 修改：`apps/desktop/src/styles/globals.css`
- 新建/修改：`apps/desktop/src/react/components/ui/*`
- 复用：`apps/desktop/src/lib/utils.ts`

- [ ] **Step 1: 检查 shadcn 配置**

运行：

```bash
rtk pnpm dlx shadcn@latest info --json
```

预期：确认当前 app 使用 Tailwind v4，alias 与 `@/` 兼容。

- [ ] **Step 2: 转换或新增 React shadcn 配置**

迁移期推荐保留 Vue `components.json`，另建 React 专用配置 `apps/desktop/components.react.json`。只有在 CLI 能保证不破坏 Vue 生成路径时，才直接更新 `components.json`。

推荐临时配置：

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "css": "apps/desktop/src/styles/globals.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/react/components",
    "utils": "@/lib/utils",
    "ui": "@/react/components/ui",
    "lib": "@/lib",
    "hooks": "@/react/hooks"
  },
  "iconLibrary": "lucide"
}
```

预期：React UI 文件生成到 `src/react/components/ui`，不要混入 Vue UI 目录。

- [ ] **Step 3: 添加初始 UI primitives**

添加当前 Vue app 大量使用的 React 等价组件：

```bash
rtk pnpm dlx shadcn@latest add button dialog input select tooltip dropdown-menu context-menu badge sheet popover tabs separator scroll-area checkbox switch textarea alert progress skeleton
```

预期：生成组件使用 `className`，从 `@/lib/utils` 导入 `cn`，如有图标则使用 `lucide-react`。

- [ ] **Step 4: 保持全局 CSS 兼容**

保留已有主题变量和字体。Vue 删除前不要删除：

```css
@import "shadcn-vue/tailwind.css";
```

只有生成的 React 组件需要额外 CSS 时，才添加 React shadcn 所需 CSS。

预期：Vue/React build 都保持相同颜色、圆角、字体和 `.dark` 行为。

## Task 4: React i18n 适配层

**文件：**
- 新建：`apps/desktop/src/react/i18n/index.ts`
- 必要时修改：`apps/desktop/src/i18n/locales/*.ts`
- 修改并复用：`apps/desktop/src/i18n/backend-errors.ts`

- [ ] **Step 1: 构建 React i18n setup**

创建 `apps/desktop/src/react/i18n/index.ts`：

```ts
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import en from "@/i18n/locales/en";
import { safeLocalStorageGet, safeLocalStorageSet } from "@/lib/safeStorage";

export type Locale = "en" | "es" | "it" | "ja" | "pt-BR" | "zh-CN" | "zh-TW";

const supportedLocales: Locale[] = ["en", "es", "it", "ja", "pt-BR", "zh-CN", "zh-TW"];
const defaultLocale: Locale = "en";
const loadedLocales = new Set<Locale>([defaultLocale]);

export function normalizeLocale(value: string | null): Locale | null {
  return value && supportedLocales.includes(value as Locale) ? (value as Locale) : null;
}

const localeLoaders: Record<Exclude<Locale, "en">, () => Promise<{ default: Record<string, unknown> }>> = {
  es: () => import("@/i18n/locales/es"),
  it: () => import("@/i18n/locales/it"),
  ja: () => import("@/i18n/locales/ja"),
  "pt-BR": () => import("@/i18n/locales/pt-BR"),
  "zh-CN": () => import("@/i18n/locales/zh-CN"),
  "zh-TW": () => import("@/i18n/locales/zh-TW"),
};

export async function loadLocaleMessages(locale: Locale) {
  if (loadedLocales.has(locale)) return;
  const messages = await localeLoaders[locale as Exclude<Locale, "en">]?.();
  if (!messages) return;
  i18next.addResourceBundle(locale, "translation", messages.default, true, true);
  loadedLocales.add(locale);
}

export async function setLocale(locale: Locale) {
  await loadLocaleMessages(locale);
  await i18next.changeLanguage(locale);
  safeLocalStorageSet("dbx-locale", locale);
}

export async function initReactI18n() {
  const initialLocale = normalizeLocale(safeLocalStorageGet("dbx-locale")) ?? defaultLocale;
  await i18next.use(initReactI18next).init({
    lng: initialLocale,
    fallbackLng: defaultLocale,
    resources: { en: { translation: en } },
    interpolation: { escapeValue: false },
  });
  await loadLocaleMessages(initialLocale);
  return i18next;
}
```

预期：React 组件可以使用 `useTranslation()`，并复用现有 locale keys。

- [ ] **Step 2: 移除共享模块中的 Vue-only 翻译类型**

将 `ComposerTranslation` 之类类型替换为框架无关函数类型：

```ts
export type Translate = (key: string, named?: Record<string, unknown>) => string;
```

预期：Vue 和 React 调用方都能传入自己的翻译函数，共享业务模块不再导入 `vue-i18n` 类型。

- [ ] **Step 3: 验证 locale 加载**

运行：

```bash
rtk env VITE_DESKTOP_UI=react pnpm build
rtk pnpm test -- apps/desktop/src/lib/__tests__/shortcutRegistry.spec.ts
```

预期：React build 包含 lazy locale chunks，现有测试保持通过。

## Task 5: Zustand Store 迁移

**文件：**
- 新建：`apps/desktop/src/react/stores/connectionStore.ts`
- 新建：`apps/desktop/src/react/stores/queryStore.ts`
- 新建：`apps/desktop/src/react/stores/settingsStore.ts`
- 新建：`apps/desktop/src/react/stores/historyStore.ts`
- 新建：`apps/desktop/src/react/stores/savedSqlStore.ts`
- 测试：`apps/desktop/src/react/stores/__tests__/*.spec.ts`

- [ ] **Step 1: 定义 store 迁移模式**

每个现有 Pinia store 对应一个 Zustand store。尽量保留 state 名称和 action 名称：

```ts
import { create } from "zustand";

export interface QueryStoreState {
  tabs: QueryTab[];
  activeTabId: string | null;
  createTab: (connectionId: string, database: string, title: string) => string;
  updateSql: (id: string, sql: string) => void;
}

export const useQueryStore = create<QueryStoreState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  createTab(connectionId, database, title) {
    const id = uuid();
    set((state) => ({
      tabs: [...state.tabs, { id, connectionId, database, title, mode: "query", sql: "" }],
      activeTabId: id,
    }));
    return id;
  },
  updateSql(id, sql) {
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, sql } : tab)),
    }));
  },
}));
```

预期：store 文件不导入 `vue` 或 `pinia`。

- [ ] **Step 2: 先迁移 settings store**

迁移 settings defaults、localStorage 持久化、editor settings、desktop settings、AI settings。

预期测试：

```text
1. 默认 settings 与 Vue store 默认值一致。
2. 已存储 settings 能恢复。
3. 部分缺失或损坏的 settings 能安全 fallback。
4. theme、update notification、editor options 使用原 storage key 持久化。
```

- [ ] **Step 3: 迁移 query store**

迁移 tab 创建、关闭行为、SQL 更新、result projection、execution state、cache eviction、open tabs 持久化。

预期测试：

```text
1. open tabs 从现有 `dbx-open-tabs` storage 恢复。
2. active tab 使用现有 key 持久化。
3. close all / close others 行为与当前 lib helpers 一致。
4. data tab result payload cleanup 会调用 cache delete 路径。
5. query result run activation 能投影正确 result state。
```

- [ ] **Step 4: 迁移 connection store**

迁移 connection list、active connection、sidebar layout、tree nodes、pinning、selection、connection errors、metadata cache、dialog source state。

预期测试：

```text
1. active connection 仍持久化到 `dbx-active-connection`。
2. sidebar layout reconcile 后生成的 tree shape 与 Vue store 一致。
3. connection errors 可记录和清除。
4. MQ 相关现有测试通过 React store adapter 或共享 helper。
5. tree selection 和 pinning 在 refresh 后保持稳定。
```

- [ ] **Step 5: 迁移 history 和 saved SQL stores**

迁移 saved SQL folder/file CRUD、import/export state、history loading/deletion。

预期测试：

```text
1. saved SQL folder path 和 ranking 与现有 helpers 一致。
2. file open count 和 timestamp 能更新。
3. import/export 保持现有序列化格式。
4. history clear/restore actions 调用现有 API wrappers。
```

- [ ] **Step 6: 执行 store 验证**

运行：

```bash
rtk pnpm test -- apps/desktop/src/react/stores
rtk env VITE_DESKTOP_UI=react pnpm build
```

预期：React stores 通过，且不依赖 Vue runtime。

## Task 6: 将共享 composables 迁移为 React hooks

**文件：**
- 新建：`apps/desktop/src/react/hooks/useTheme.ts`
- 新建：`apps/desktop/src/react/hooks/useToast.ts`
- 新建：`apps/desktop/src/react/hooks/usePanelResize.ts`
- 新建：`apps/desktop/src/react/hooks/useFileDrop.ts`
- 新建：`apps/desktop/src/react/hooks/useVisibilityChange.ts`
- 新建：`apps/desktop/src/react/hooks/useTauriEvents.ts`
- 新建：`apps/desktop/src/react/hooks/useSqlExecution.ts`
- 复用/修改：`apps/desktop/src/lib/*` 中框架无关逻辑

- [ ] **Step 1: 先迁移低风险 hooks**

迁移 `useTheme`、`useToast`、`useVisibilityChange`、`usePanelResize`。

预期：

```text
1. Hook state 使用 React `useState`、`useMemo`、`useEffect`、`useRef`。
2. localStorage key 不变。
3. effect 返回 cleanup function。
4. hook 不导入 `vue`。
```

- [ ] **Step 2: 迁移 Tauri 和 file-drop hooks**

迁移 `useTauriEvents` 和 `useFileDrop`，保持事件名和 cleanup 行为一致。

预期：

```text
1. Tauri listener 只在 Tauri runtime 注册。
2. 组件 unmount 时执行所有 unlisten callbacks。
3. Web mode 避免调用 desktop-only API。
```

- [ ] **Step 3: 迁移 SQL execution hook**

用 React state/callbacks 迁移 `useSqlExecution`，保持 dangerous SQL confirmation、explain mode、cancel、active output view 更新逻辑。

预期：

```bash
rtk env VITE_DESKTOP_UI=react pnpm build
```

React build 通过，hook tests 覆盖 confirm/cancel/execute 路径。

## Task 7: 构建 React App Shell

**文件：**
- 修改：`apps/desktop/src/react/App.tsx`
- 新建：`apps/desktop/src/react/components/layout/AppToolbar.tsx`
- 新建：`apps/desktop/src/react/components/layout/AppTabBar.tsx`
- 新建：`apps/desktop/src/react/components/layout/AppSidebar.tsx`
- 新建：`apps/desktop/src/react/components/layout/EditorToolbar.tsx`
- 新建：`apps/desktop/src/react/components/layout/ContentArea.tsx`
- 新建：`apps/desktop/src/react/components/layout/AppDialogs.tsx`
- 新建：`apps/desktop/src/react/components/layout/WelcomeScreen.tsx`
- 新建：`apps/desktop/src/react/components/layout/WindowControls.tsx`

- [ ] **Step 1: 迁移 root app 编排逻辑**

将 `App.vue` 的顶层编排迁移到 React，保持以下状态：

```text
needsAuth, authenticated, setupRequired, showConnectionDialog,
showSettingsDialog, showDriverStore, showHistory, showAiPanel,
showSqlLibraryPanel, sidebarOpen, selectedSql, cursorPos,
activeOutputView, save SQL dialog state, update state, dialog sources.
```

预期：React app shell 渲染出相同的高层布局区域。

- [ ] **Step 2: 迁移布局组件**

迁移 toolbar、tab bar、sidebar container、editor toolbar、content area shell、dialogs container、welcome screen、window controls。

预期：

```text
1. 图标使用 lucide-react 等价图标。
2. Tailwind `class` 转为 `className`。
3. Vue events 转为 typed React props。
4. Vue slots 转为明确 props 或 children。
5. v-model 对转为 `value/onChange` 或 `open/onOpenChange`。
```

- [ ] **Step 3: 保持快捷键行为**

在 React 中绑定全局 shortcut handlers，并复用 `apps/desktop/src/lib/keyboardShortcuts.ts`。

预期：

```text
1. New query、close tab、execute SQL、save、refresh、sidebar toggle、zoom、settings 快捷键与 Vue 行为一致。
2. 快捷键在 input/editor target 中按现有逻辑忽略。
```

- [ ] **Step 4: 验证 shell**

运行：

```bash
rtk env VITE_DESKTOP_UI=react pnpm build
```

手动检查：

```text
1. App 能打开到 welcome 或已保存 tabs。
2. Sidebar 可折叠和 resize。
3. Toolbar actions 能打开 placeholder 或已迁移 dialog，且不崩溃。
4. Theme 和 locale controls 能更新 UI。
```

## Task 8: 迁移核心 Dialog 和连接工作流

**文件：**
- 新建：`apps/desktop/src/react/components/connection/ConnectionDialog.tsx`
- 新建：`apps/desktop/src/react/components/connection/ConnectionErrorIndicator.tsx`
- 新建：`apps/desktop/src/react/components/sidebar/ConnectionTree.tsx`
- 新建：`apps/desktop/src/react/components/sidebar/TreeItem.tsx`
- 新建：`apps/desktop/src/react/components/sidebar/VisibleDatabasesDialog.tsx`
- 新建：`apps/desktop/src/react/components/icons/DatabaseIcon.tsx`

- [ ] **Step 1: 迁移 connection dialog**

迁移连接创建、编辑、导入、测试行为。保持现有 connection config 类型和 API 调用不变。

预期：

```text
1. 数据库类型选项和 driver profile 行为不变。
2. password/keychain 行为不变。
3. DBX/Navicat/DBeaver/DataGrip import flows 的 payload 处理不变。
4. Test connection、save、duplicate、delete、driver-store links 可用。
```

- [ ] **Step 2: 迁移 connection tree**

使用 `@tanstack/react-virtual` 迁移虚拟化树渲染。

预期：

```text
1. 节点展开/折叠、lazy metadata load、selection、multi-selection、pinning、rename、drag/drop、context menu 可用。
2. 现有 tree node IDs 不变。
3. Search/filter 行为与当前 sidebar helpers 一致。
```

- [ ] **Step 3: 验证连接工作流**

运行：

```bash
rtk pnpm test -- apps/desktop/src/lib/__tests__/connectionOpenTarget.spec.ts apps/desktop/src/stores/__tests__/connectionStore.mq.spec.ts
rtk env VITE_DESKTOP_UI=react pnpm build
```

手动检查：

```text
1. 创建连接。
2. 连接并加载 metadata。
3. 从 tree 打开 table/query target。
4. Rename/move/pin sidebar nodes。
5. 重开 app 后确认状态已持久化。
```

## Task 9: 迁移 Query Editor 和执行工作流

**文件：**
- 新建：`apps/desktop/src/react/components/editor/QueryEditor.tsx`
- 新建：`apps/desktop/src/react/components/editor/EditorSearchPanel.tsx`
- 新建：`apps/desktop/src/react/components/editor/DangerConfirmDialog.tsx`
- 新建：`apps/desktop/src/react/components/editor/QueryHistory.tsx`
- 新建：`apps/desktop/src/react/components/editor/SqlPreviewPanel.tsx`
- 新建：`apps/desktop/src/react/components/layout/SqlLibraryPanel.tsx`

- [ ] **Step 1: 迁移 CodeMirror editor**

使用 app 已有的 CodeMirror 6 packages。保持 SQL completion、diagnostics、search、selection tracking、table-drop、formatter request、editor theme 行为。

预期：

```text
1. Full SQL 和 selected SQL 分开追踪。
2. Cursor position 更新驱动 executable SQL resolution。
3. Editor theme/font/zoom settings 生效。
4. Redis/Mongo/SQL-specific diagnostics 和 completion 行为保持。
```

- [ ] **Step 2: 迁移执行 controls**

连接 React editor、toolbar、dangerous SQL dialog 和 `useSqlExecution`。

预期：

```text
1. 执行当前 statement/selection。
2. Explain query。
3. Cancel active execution。
4. Dangerous Redis/SQL confirmation 行为与 Vue 一致。
5. Execution result 更新 active tab store。
```

- [ ] **Step 3: 迁移 history 和 SQL library**

迁移 history list 和 saved SQL panel；大列表场景使用 `@tanstack/react-virtual`。

预期：

```text
1. SQL 可恢复到当前或新 tab。
2. Search、delete、clear、AI analysis action、save、rename、folder move、import、export 可用。
3. 现有 saved SQL storage 格式兼容。
```

- [ ] **Step 4: 验证 query 工作流**

运行：

```bash
rtk pnpm test -- apps/desktop/src/lib/__tests__/sqlCompletion.context.spec.ts apps/desktop/src/lib/__tests__/sqlCompletion.snippet.spec.ts apps/desktop/src/lib/__tests__/sqlFormatterConfig.spec.ts
rtk env VITE_DESKTOP_UI=react pnpm build
```

手动检查：

```text
1. 创建 query tab。
2. 输入 SQL 并使用 completion。
3. 执行 selection 和 full statement。
4. 打开 query history 并恢复 SQL。
5. 保存 SQL 到 library，并重新打开。
```

## Task 10: 迁移 Results、Data Grid 和预览 Dialogs

**文件：**
- 新建：`apps/desktop/src/react/components/grid/DataGrid.tsx`
- 新建：`apps/desktop/src/react/components/grid/EnumCellEditor.tsx`
- 新建：`apps/desktop/src/react/components/grid/TemporalCellEditor.tsx`
- 新建：`apps/desktop/src/react/components/grid/ImagePreviewDialog.tsx`
- 新建：`apps/desktop/src/react/components/grid/LayerPreviewDialog.tsx`
- 新建：`apps/desktop/src/react/components/chart/QueryChart.tsx`
- 新建：`apps/desktop/src/react/components/common/QueryLoadingState.tsx`

- [ ] **Step 1: 迁移前先抽取框架无关 grid 逻辑**

将 `DataGrid.vue` 中尚未抽到 `apps/desktop/src/lib` 的可复用计算逻辑抽出：

```text
column measurement, selection math, row status, clipboard formatting,
filter/sort descriptors, cell coercion, preview selection, export payloads.
```

预期：React rendering code 依赖这些纯函数前，先补 Vitest 覆盖。

- [ ] **Step 2: 按切片迁移 grid rendering**

按以下顺序实现 React grid：

```text
1. read-only table rendering。
2. selection 和 keyboard navigation。
3. sorting/filtering/pagination controls。
4. inline editing 和 pending changes。
5. enum/temporal editors。
6. copy/export/transposed view。
7. image/geometry/layer preview dialogs。
```

预期：每个切片都能 build 并手动验证，再继续下一个切片。

- [ ] **Step 3: 迁移 chart rendering**

用 React ECharts wrapper 或直接 ECharts lifecycle hook 替换 `vue-echarts`。

预期：

```text
1. 现有 `chartData` helpers 生成的 chart options 可渲染。
2. Resize 和 theme change 会更新 chart。
3. Empty/error states 与 Vue 行为一致。
```

- [ ] **Step 4: 验证 results 工作流**

运行：

```bash
rtk pnpm test -- apps/desktop/src/lib/__tests__/chartData.spec.ts apps/desktop/src/lib/__tests__/tableEditing.spec.ts
rtk env VITE_DESKTOP_UI=react pnpm build
```

手动检查：

```text
1. Query result table 能渲染大结果集。
2. Sort、paginate、edit、save、revert、copy、export 可用。
3. Preview dialogs 能渲染 image/geometry/layer 值。
4. Chart view 能渲染和 resize。
```

## Task 11: 迁移高级功能模块

**文件：**
- 在 `apps/desktop/src/react/components` 下创建以下模块的 React 等价实现：
  - `admin`
  - `config`
  - `diagram`
  - `diff`
  - `document`
  - `etcd`
  - `export`
  - `generate`
  - `import`
  - `lineage`
  - `mq`
  - `objects`
  - `redis`
  - `search`
  - `sql-file`
  - `structure`
  - `transfer`

- [ ] **Step 1: 按工作流迁移，不按文件名机械迁移**

推荐顺序：

```text
1. Settings 和 driver store。
2. Object browser、DDL view、procedure execution。
3. Table structure editor 和 import/export。
4. Redis browser/value/pubsub。
5. MQ admin panels。
6. Schema diff/data compare/diagram/lineage/search。
7. Data generation、transfer、document、etcd、SQL file execution。
```

预期：每个 workflow 独立可用后，再开始下一个 workflow。

- [ ] **Step 2: 明确 public props**

每个迁移组件都把 Vue props/emits 转成 typed React interface：

```ts
interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}
```

预期：需要通过 prop callback 表达的事件，不依赖隐式全局 mutation。

- [ ] **Step 3: 验证高级模块**

运行已有共享逻辑测试：

```bash
rtk pnpm test -- apps/desktop/src/lib/__tests__/mqListPanels.spec.ts apps/desktop/src/lib/__tests__/mqPolicyForms.spec.ts apps/desktop/src/lib/__tests__/mqTenantForm.spec.ts apps/desktop/src/lib/__tests__/etcdKeyTree.spec.ts apps/desktop/src/lib/__tests__/tableDependencySort.spec.ts
rtk env VITE_DESKTOP_UI=react pnpm build
```

每个迁移 workflow 都需要手动检查后再标记完成。

## Task 12: React 等价验收

**文件：**
- 如需自动化覆盖，仅修改测试文件
- 读取：全部已迁移 React workflow 文件

- [ ] **Step 1: 运行完整自动化验证**

运行：

```bash
rtk pnpm typecheck
rtk pnpm test
rtk env VITE_DESKTOP_UI=react pnpm build
```

预期：全部通过。

- [ ] **Step 2: 运行桌面端验证**

运行：

```bash
rtk env VITE_DESKTOP_UI=react pnpm dev:tauri
```

预期手动检查：

```text
1. Desktop runtime 启动成功。
2. Window controls 可用。
3. File dialog、clipboard、shell、updater、fs、process、drag/drop 路径有 guard 且功能可用。
4. Tauri events 能打开 SQL files、DB files、deep links、query result archives。
5. App 关闭/重开后 tabs/settings/connections 不丢失。
```

- [ ] **Step 3: 对比 Vue 和 React 截图**

捕获以下等价截图：

```text
1. Welcome screen。
2. 带 connected database tree 的 sidebar。
3. Query editor + result grid。
4. Connection dialog。
5. Settings dialog。
6. SQL library 和 history panels。
7. Dark mode variants。
```

预期：布局、间距、文本可见性和主交互等价。任何有意差异都要在 cutover 前记录。

## Task 13: 切换默认入口到 React

**文件：**
- 修改：`apps/desktop/vite.config.ts`
- 修改：`apps/desktop/src/main.ts`
- 修改：`package.json`
- 修改：`apps/desktop/tsconfig.json`
- 修改：`apps/desktop/src/env.d.ts`
- 修改：`apps/desktop/src/styles/globals.css`

- [ ] **Step 1: 将 React 设为默认入口**

默认 frontend entry 指向 React，移除对 `VITE_DESKTOP_UI=react` 的依赖。

预期：

```bash
rtk pnpm build
```

默认构建 React app。

- [ ] **Step 2: 替换 Vue typecheck**

将 `typecheck` 脚本从 `vue-tsc` 改为 TypeScript：

```json
{
  "scripts": {
    "typecheck": "tsc --noEmit --project apps/desktop/tsconfig.json"
  }
}
```

更新 `tsconfig.json` include：

```json
{
  "include": ["src/**/*.ts", "src/**/*.tsx"]
}
```

预期：

```bash
rtk pnpm typecheck
```

在不依赖 Vue SFC 支持的情况下通过。

- [ ] **Step 3: 移除 Vue-specific CSS 和声明**

删除：

```css
@source "../**/*.{vue,ts,tsx,js,jsx,html}";
@import "shadcn-vue/tailwind.css";
```

替换为：

```css
@source "../**/*.{ts,tsx,js,jsx,html}";
```

从 `env.d.ts` 删除 `declare module "*.vue"`。

预期：Tailwind 仍能扫描所有 React classes。

- [ ] **Step 4: 删除 Vue 相关依赖**

删除不再使用的 runtime/dev dependencies：

```bash
rtk pnpm remove vue pinia vue-i18n @vueuse/core @lucide/vue reka-ui shadcn-vue vue-echarts vue-virtual-scroller @vitejs/plugin-vue vue-tsc
```

预期：

```bash
rtk rg -n "from ['\"]vue['\"]|from ['\"]pinia['\"]|vue-i18n|@lucide/vue|reka-ui|shadcn-vue|vue-echarts|vue-virtual-scroller" apps/desktop/src package.json apps/desktop/vite.config.ts apps/desktop/components.json
```

没有生产引用残留。

## Task 14: 删除 Vue 源码

**文件：**
- 删除：`apps/desktop/src/**/*.vue`
- 删除或归档：`apps/desktop/src/composables` 下 Vue-only composables
- 删除或归档：`apps/desktop/src/components` 下 Vue-only UI components
- 保留：纯共享模块 `apps/desktop/src/lib`、`apps/desktop/src/types`、`apps/desktop/src/i18n/locales`

- [ ] **Step 1: 确认 React 替代实现已存在**

删除每个 Vue 目录前，确认对应 React workflow 已实现并测试。

预期：

```bash
rtk proxy find apps/desktop/src/react/components -type f -name '*.tsx' | wc -l
rtk proxy find apps/desktop/src/components -type f -name '*.vue' | wc -l
```

React component 数量足以覆盖等价功能；Vue count 准备归零。

- [ ] **Step 2: 删除 Vue-only 文件**

确认等价后，使用非交互命令删除：

```bash
rtk rm -f apps/desktop/src/App.vue
rtk proxy find apps/desktop/src/components -type f -name '*.vue' -delete
rtk proxy find apps/desktop/src/composables -type f -name '*.ts' -delete
```

预期：desktop source 下不再有 `.vue` 文件。

- [ ] **Step 3: 删除空目录**

运行：

```bash
rtk proxy find apps/desktop/src/components apps/desktop/src/composables -type d -empty -delete
```

预期：desktop source tree 只包含 React 实现和共享 TS 模块。

## Task 15: 最终验证和文档更新

**文件：**
- 如项目文档提到 Vue frontend 命令或架构，则修改对应文档
- 如 `README.md` 或 app docs 记录了 desktop frontend setup，则同步更新

- [ ] **Step 1: 运行最终 checks**

运行：

```bash
rtk pnpm typecheck
rtk pnpm test
rtk pnpm build
rtk pnpm lint
```

预期：全部通过。如果 `pnpm lint` 需要 TSX 配置调整，只更新 lint 配置，不弱化现有规则。

- [ ] **Step 2: 运行 Tauri build smoke check**

如果仓库支持正常桌面打包，运行：

```bash
rtk pnpm tauri build
```

预期：桌面打包成功；如果失败，只能是环境或签名等与 React 迁移无关的已记录前置条件。

- [ ] **Step 3: 更新文档**

文档需说明：

```text
1. Desktop frontend 已改为 React。
2. UI components 使用 shadcn/ui React 和 Radix。
3. State stores 使用 Zustand。
4. Typecheck 使用 TypeScript，不再使用 vue-tsc。
5. Vue migration flag 已移除。
```

预期：文档中不再指导贡献者向 `apps/desktop` 添加 Vue 组件。

- [ ] **Step 4: 最终 commit 分组建议**

推荐 commit 分组：

```bash
rtk git add package.json pnpm-lock.yaml apps/desktop/vite.config.ts apps/desktop/tsconfig.json apps/desktop/src/main.shared.ts apps/desktop/src/react
rtk git commit -m "feat(desktop): add react desktop foundation"

rtk git add apps/desktop/src/react/stores apps/desktop/src/react/hooks apps/desktop/src/lib
rtk git commit -m "feat(desktop): migrate desktop state and hooks to react"

rtk git add apps/desktop/src/react/components
rtk git commit -m "feat(desktop): migrate desktop ui to react"

rtk git add package.json pnpm-lock.yaml apps/desktop apps README.md docs
rtk git commit -m "refactor(desktop): remove vue desktop implementation"
```

预期：每个 commit 都能 build，或者明确属于已 review 的迁移分支步骤。

## 验收标准

- cutover 后 `pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm lint` 全部通过。
- Tauri 桌面 app 能启动，并通过基线工作流清单。
- 生产代码中不再引用 Vue、Pinia、vue-i18n、shadcn-vue、reka-ui、@lucide/vue、vue-echarts、vue-virtual-scroller。
- 现有 localStorage keys 和序列化用户数据保持兼容。
- React 实现保持视觉布局、快捷键、主题、语言、连接管理、查询编辑/执行、结果表格和高级功能工作流等价。
- 只有在 React 等价验收通过后，才删除 Vue 源码。

## 回滚方案

- Cutover 前，回滚方式是把 `VITE_DESKTOP_UI` 或默认 Vite entry 切回 Vue。
- Cutover 后但 Vue 删除前，回滚方式是恢复 Vue 默认入口和脚本。
- Vue 删除后，回滚需要 revert 最终 cleanup commit。
- 迁移 commit 应尽量小，使单个 workflow 回归可以 bisect 到模块级 commit。
