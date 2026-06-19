import { create } from 'zustand';
import { uuid } from "@/lib/utils";
import * as api from "@/lib/api";
import { isTauriRuntime } from "@/lib/tauriRuntime";
import { useSettingsStore } from "./settingsStore";
import type { SavedSqlFile, SavedSqlFolder, SavedSqlLibrary } from "@/types/database";

const LEGACY_STORAGE_KEY = "dbx-saved-sql-library";

interface SavedSqlState {
  folders: SavedSqlFolder[];
  files: SavedSqlFile[];
}

function nowIso() {
  return new Date().toISOString();
}

function sortFoldersByOrder(items: SavedSqlFolder[]) {
  return [...items].sort((a, b) => {
    const orderDiff = (a.orderIndex ?? 0) - (b.orderIndex ?? 0);
    if (orderDiff !== 0) return orderDiff;
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  });
}

function sortFilesByOrder(items: SavedSqlFile[]) {
  return [...items].sort((a, b) => {
    const orderDiff = (a.orderIndex ?? 0) - (b.orderIndex ?? 0);
    if (orderDiff !== 0) return orderDiff;
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  });
}

function reindexFolders(items: SavedSqlFolder[]) {
  return items.map((folder, index) => ({ ...folder, orderIndex: index }));
}

function reindexFiles(items: SavedSqlFile[], folderId?: string) {
  return items.map((file, index) => ({
    ...file,
    folderId,
    orderIndex: index,
  }));
}

function maxOrderIndex(values: Array<{ orderIndex?: number }>) {
  return values.reduce((max, item) => Math.max(max, item.orderIndex ?? -1), -1);
}

function folderDepth(items: SavedSqlFolder[], folderId: string) {
  const byId = new Map(items.map((folder) => [folder.id, folder]));
  const seen = new Set<string>();
  let depth = 0;
  let current = byId.get(folderId);
  while (current?.parentFolderId && !seen.has(current.parentFolderId)) {
    seen.add(current.parentFolderId);
    depth++;
    current = byId.get(current.parentFolderId);
  }
  return depth;
}

function loadLegacyState(): SavedSqlState {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return { folders: [], files: [] };
    const parsed = JSON.parse(raw) as Partial<SavedSqlState>;
    return {
      folders: Array.isArray(parsed.folders) ? parsed.folders.filter((item) => item?.id && item?.connectionId) : [],
      files: Array.isArray(parsed.files) ? parsed.files.filter((item) => item?.id && item?.connectionId) : [],
    };
  } catch {
    return { folders: [], files: [] };
  }
}

export interface SavedSqlStoreState {
  folders: SavedSqlFolder[];
  files: SavedSqlFile[];
  isLoaded: boolean;
  version: number;
  initFromStorage: () => Promise<void>;
  listFolders: (connectionId: string) => SavedSqlFolder[];
  listChildFolders: (connectionId: string, parentFolderId?: string) => SavedSqlFolder[];
  listFiles: (connectionId: string, folderId?: string) => SavedSqlFile[];
  getFile: (id: string) => SavedSqlFile | undefined;
  createFolder: (connectionId: string, name: string, parentFolderId?: string) => Promise<SavedSqlFolder>;
  renameFolder: (id: string, name: string) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  saveFile: (input: { id?: string; connectionId: string; folderId?: string; name: string; database: string; schema?: string; sql: string }) => Promise<SavedSqlFile>;
  renameFile: (id: string, name: string) => Promise<void>;
  recordFileUsage: (id: string) => Promise<SavedSqlFile | undefined>;
  deleteFile: (id: string) => Promise<void>;
  reorderFolders: (draggedId: string, targetId: string, position: "before" | "after") => Promise<void>;
  moveFolderToFolder: (folderId: string, parentFolderId?: string) => Promise<void>;
  moveFileToFolder: (fileId: string, folderId?: string) => Promise<void>;
  reorderFiles: (draggedId: string, targetId: string, position: "before" | "after") => Promise<void>;
  syncToLocalDirectory: () => Promise<void>;
  allFolders: () => SavedSqlFolder[];
  allFoldersTreeOrder: () => SavedSqlFolder[];
  allFiles: () => SavedSqlFile[];
  filesInFolder: (folderId: string) => SavedSqlFile[];
  filesWithoutFolder: () => SavedSqlFile[];
  orphanedFileIds: (activeConnectionIds: Set<string>) => Set<string>;
}

export const useSavedSqlStore = create((set, get): SavedSqlStoreState => {
  // Track pending sync promise
  let pendingSync: Promise<void> | null = null;
  const pendingFolderCreates = new Map<string, Promise<SavedSqlFolder>>();

  function bumpVersion() {
    set({ version: (get().version || 0) + 1 });
  }

  function applyLibrary(library: SavedSqlLibrary) {
    set({ folders: library.folders, files: library.files });
    bumpVersion();
  }

  async function migrateLegacyLocalStorage() {
    const legacy = loadLegacyState();
    if (legacy.folders.length === 0 && legacy.files.length === 0) return;

    for (const folder of legacy.folders) {
      await api.saveSavedSqlFolder(folder);
    }
    for (const file of legacy.files) {
      await api.saveSavedSqlFile(file);
    }
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  }

  function descendantFolderIds(folderId: string): Set<string> {
    const ids = new Set<string>([folderId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const folder of get().folders) {
        if (folder.parentFolderId && ids.has(folder.parentFolderId) && !ids.has(folder.id)) {
          ids.add(folder.id);
          changed = true;
        }
      }
    }
    return ids;
  }

  function syncEntries() {
    const folderById = new Map(get().folders.map((folder) => [folder.id, folder]));
    const folderPath = (folderId?: string): string | undefined => {
      if (!folderId) return undefined;
      const parts: string[] = [];
      const seen = new Set<string>();
      let current = folderById.get(folderId);
      while (current && !seen.has(current.id)) {
        seen.add(current.id);
        parts.unshift(current.name);
        current = current.parentFolderId ? folderById.get(current.parentFolderId) : undefined;
      }
      return parts.join("/");
    };
    return sortFilesByOrder(get().files).map((file) => ({
      folderName: folderPath(file.folderId),
      fileName: file.name,
      sql: file.sql,
    }));
  }

  async function syncToLocalDirectory() {
    if (!isTauriRuntime()) return;
    const settingsStore = useSettingsStore();
    const targetDir = settingsStore.desktopSettings.saved_sql_sync_dir?.trim();
    if (!targetDir) return;

    const entries = syncEntries();
    const syncPromise = pendingSync?.catch(() => {}).then(() => api.syncSavedSqlDirectory({ targetDir, entries })) ?? api.syncSavedSqlDirectory({ targetDir, entries });
    pendingSync = syncPromise;
    try {
      await syncPromise;
    } catch (error) {
      console.warn("[DBX][saved-sql:sync:error]", error);
    } finally {
      if (pendingSync === syncPromise) {
        pendingSync = null;
      }
    }
  }

  async function persistFolders(nextFolders: SavedSqlFolder[]) {
    const reindexed = nextFolders.map((folder) => ({ ...folder, updatedAt: folder.updatedAt || nowIso() }));
    await Promise.all(reindexed.map((folder) => api.saveSavedSqlFolder(folder)));
    set({ folders: reindexed });
    bumpVersion();
    await syncToLocalDirectory();
  }

  async function persistFiles(nextFiles: SavedSqlFile[]) {
    await Promise.all(nextFiles.map((file) => api.saveSavedSqlFile(file)));
    set({ files: nextFiles });
    bumpVersion();
    await syncToLocalDirectory();
  }

  return {
    folders: [],
    files: [],
    isLoaded: false,
    version: 0,

    async initFromStorage() {
      await migrateLegacyLocalStorage();
      const library = await api.loadSavedSqlLibrary();
      applyLibrary(library);
      set({ isLoaded: true });
      await syncToLocalDirectory();
    },

    listFolders(connectionId: string) {
      return get().listChildFolders(connectionId);
    },

    listChildFolders(connectionId: string, parentFolderId?: string) {
      return sortFoldersByOrder(get().folders.filter((folder) => folder.connectionId === connectionId && (folder.parentFolderId || "") === (parentFolderId || "")));
    },

    listFiles(connectionId: string, folderId?: string) {
      return sortFilesByOrder(get().files.filter((file) => file.connectionId === connectionId && (file.folderId || "") === (folderId || "")));
    },

    getFile(id: string) {
      return get().files.find((file) => file.id === id);
    },

    async createFolder(connectionId: string, name: string, parentFolderId?: string) {
      const key = JSON.stringify([connectionId, parentFolderId || "", name]);
      const pending = pendingFolderCreates.get(key);
      if (pending) return pending;

      const createPromise = (async () => {
        const timestamp = nowIso();
        const currentFolders = get().folders;
        const folder: SavedSqlFolder = {
          id: uuid(),
          connectionId,
          parentFolderId: parentFolderId || undefined,
          name,
          orderIndex: maxOrderIndex(currentFolders.filter((item) => item.connectionId === connectionId && (item.parentFolderId || "") === (parentFolderId || ""))) + 1,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        const saved = await api.saveSavedSqlFolder(folder);
        set({ folders: [...currentFolders.filter((item) => item.id !== saved.id), saved] });
        bumpVersion();
        await syncToLocalDirectory();
        return saved;
      })();

      pendingFolderCreates.set(key, createPromise);
      try {
        return await createPromise;
      } finally {
        if (pendingFolderCreates.get(key) === createPromise) {
          pendingFolderCreates.delete(key);
        }
      }
    },

    async renameFolder(id: string, name: string) {
      const existing = get().folders.find((folder) => folder.id === id);
      if (!existing) return;
      const saved = await api.saveSavedSqlFolder({ ...existing, name, updatedAt: nowIso() });
      set({ folders: get().folders.map((folder) => (folder.id === id ? saved : folder)) });
      bumpVersion();
      await syncToLocalDirectory();
    },

    async deleteFolder(id: string) {
      const removedIds = descendantFolderIds(id);
      await api.deleteSavedSqlFolder(id);
      set({
        folders: get().folders.filter((folder) => !removedIds.has(folder.id)),
        files: get().files.filter((file) => !file.folderId || !removedIds.has(file.folderId)),
      });
      bumpVersion();
      await syncToLocalDirectory();
    },

    async saveFile(input: { id?: string; connectionId: string; folderId?: string; name: string; database: string; schema?: string; sql: string }) {
      const timestamp = nowIso();
      const currentFiles = get().files;
      const existing = input.id ? currentFiles.find((file) => file.id === input.id) : undefined;
      const file: SavedSqlFile = existing
        ? {
            ...existing,
            folderId: input.folderId || undefined,
            name: input.name,
            database: input.database,
            schema: input.schema,
            sql: input.sql,
            updatedAt: timestamp,
          }
        : {
            id: uuid(),
            connectionId: input.connectionId,
            folderId: input.folderId || undefined,
            name: input.name,
            database: input.database,
            schema: input.schema,
            sql: input.sql,
            orderIndex: maxOrderIndex(currentFiles.filter((file) => file.connectionId === input.connectionId && (file.folderId || "") === (input.folderId || undefined || ""))) + 1,
            createdAt: timestamp,
            updatedAt: timestamp,
          };
      const saved = await api.saveSavedSqlFile(file);
      set({ files: [...currentFiles.filter((item) => item.id !== saved.id), saved] });
      bumpVersion();
      await syncToLocalDirectory();
      return saved;
    },

    async renameFile(id: string, name: string) {
      const existing = get().files.find((file) => file.id === id);
      if (!existing) return;
      const saved = await api.saveSavedSqlFile({ ...existing, name, updatedAt: nowIso() });
      set({ files: get().files.map((file) => (file.id === id ? saved : file)) });
      bumpVersion();
      await syncToLocalDirectory();
    },

    async recordFileUsage(id: string) {
      const existing = get().files.find((file) => file.id === id);
      if (!existing) return;
      try {
        const saved = await api.saveSavedSqlFile({
          ...existing,
          openCount: (existing.openCount ?? 0) + 1,
          openedAt: nowIso(),
        });
        set({ files: get().files.map((file) => (file.id === id ? saved : file)) });
        bumpVersion();
        return saved;
      } catch (error) {
        console.warn("[DBX][saved-sql:usage:error]", error);
        return existing;
      }
    },

    async deleteFile(id: string) {
      await api.deleteSavedSqlFile(id);
      set({ files: get().files.filter((file) => file.id !== id) });
      bumpVersion();
      await syncToLocalDirectory();
    },

    async reorderFolders(draggedId: string, targetId: string, position: "before" | "after") {
      const dragged = get().folders.find((folder) => folder.id === draggedId);
      const target = get().folders.find((folder) => folder.id === targetId);
      if (!dragged || !target || dragged.id === target.id) return;
      if (descendantFolderIds(draggedId).has(targetId)) return;

      const timestamp = nowIso();
      const targetParentFolderId = target.parentFolderId || undefined;
      const previousParentFolderId = dragged.parentFolderId || undefined;
      const ordered = sortFoldersByOrder(get().folders.filter((folder) => (folder.parentFolderId || "") === (targetParentFolderId || "")));
      const remaining = ordered.filter((folder) => folder.id !== draggedId);
      const targetIndex = remaining.findIndex((folder) => folder.id === targetId);
      const insertIndex = position === "before" ? targetIndex : targetIndex + 1;
      remaining.splice(insertIndex, 0, { ...dragged, parentFolderId: targetParentFolderId, updatedAt: timestamp });

      const updatedTargetGroup = reindexFolders(remaining).map((folder) => ({
        ...folder,
        parentFolderId: targetParentFolderId,
        updatedAt: timestamp,
      }));
      const updatedSourceGroup =
        previousParentFolderId === targetParentFolderId
          ? []
          : reindexFolders(sortFoldersByOrder(get().folders.filter((folder) => folder.id !== draggedId && (folder.parentFolderId || "") === (previousParentFolderId || "")))).map((folder) => ({
              ...folder,
              updatedAt: timestamp,
            }));
      const untouched = get().folders.filter((folder) => folder.id !== draggedId && (folder.parentFolderId || "") !== (targetParentFolderId || "") && (folder.parentFolderId || "") !== (previousParentFolderId || ""));
      await persistFolders([...untouched, ...updatedSourceGroup, ...updatedTargetGroup]);
    },

    async moveFolderToFolder(folderId: string, parentFolderId?: string) {
      const target = get().folders.find((folder) => folder.id === folderId);
      if (!target) return;
      const nextParentFolderId = parentFolderId || undefined;
      if ((target.parentFolderId || undefined) === nextParentFolderId) return;
      if (nextParentFolderId && descendantFolderIds(folderId).has(nextParentFolderId)) return;

      const timestamp = nowIso();
      const previousParentFolderId = target.parentFolderId || undefined;
      const sourceGroup = reindexFolders(sortFoldersByOrder(get().folders.filter((folder) => folder.id !== folderId && (folder.parentFolderId || "") === (previousParentFolderId || "")))).map((folder) => ({ ...folder, updatedAt: timestamp }));
      const destinationGroup = reindexFolders([...sortFoldersByOrder(get().folders.filter((folder) => folder.id !== folderId && (folder.parentFolderId || "") === (nextParentFolderId || ""))), { ...target, parentFolderId: nextParentFolderId, updatedAt: timestamp }]).map((folder) => ({
        ...folder,
        parentFolderId: nextParentFolderId,
        updatedAt: timestamp,
      }));
      const untouched = get().folders.filter((folder) => folder.id !== folderId && (folder.parentFolderId || "") !== (previousParentFolderId || "") && (folder.parentFolderId || "") !== (nextParentFolderId || ""));
      await persistFolders([...untouched, ...sourceGroup, ...destinationGroup]);
    },

    async moveFileToFolder(fileId: string, folderId?: string) {
      const target = get().files.find((file) => file.id === fileId);
      if (!target) return;
      const targetFolderId = folderId || undefined;
      if ((target.folderId || undefined) === targetFolderId) return;

      const timestamp = nowIso();
      const sourceGroup = sortFilesByOrder(get().files.filter((file) => (file.folderId || "") === (target.folderId || ""))).filter((file) => file.id !== fileId);
      const destinationGroup = sortFilesByOrder(get().files.filter((file) => file.id !== fileId && (file.folderId || "") === (targetFolderId || "")));

      const movedFile: SavedSqlFile = {
        ...target,
        folderId: targetFolderId,
        updatedAt: timestamp,
      };

      const nextSource = reindexFiles(sourceGroup, target.folderId || undefined).map((file) => ({
        ...file,
        updatedAt: timestamp,
      }));
      const nextDestination = reindexFiles([...destinationGroup, movedFile], targetFolderId).map((file) => ({
        ...file,
        updatedAt: timestamp,
      }));

      const untouched = get().files.filter((file) => file.id !== fileId && (file.folderId || "") !== (target.folderId || "") && (file.folderId || "") !== (targetFolderId || ""));

      await persistFiles([...untouched, ...nextSource, ...nextDestination]);
    },

    async reorderFiles(draggedId: string, targetId: string, position: "before" | "after") {
      const dragged = get().files.find((file) => file.id === draggedId);
      const target = get().files.find((file) => file.id === targetId);
      if (!dragged || !target || dragged.id === target.id) return;

      const targetFolderId = target.folderId || undefined;
      const groupFiles = sortFilesByOrder(get().files.filter((file) => (file.folderId || "") === (targetFolderId || "")));
      const remainingGroup = groupFiles.filter((file) => file.id !== draggedId);
      const draggedNext: SavedSqlFile = {
        ...dragged,
        folderId: targetFolderId,
        updatedAt: nowIso(),
      };
      const targetIndex = remainingGroup.findIndex((file) => file.id === targetId);
      const insertIndex = position === "before" ? targetIndex : targetIndex + 1;
      remainingGroup.splice(insertIndex, 0, draggedNext);

      const updatedGroup = reindexFiles(remainingGroup, targetFolderId).map((file) => ({
        ...file,
        updatedAt: draggedNext.updatedAt,
      }));

      const previousGroupId = dragged.folderId || undefined;
      const sourceGroup = previousGroupId === targetFolderId ? [] : reindexFiles(sortFilesByOrder(get().files.filter((file) => file.id !== draggedId && (file.folderId || "") === (previousGroupId || ""))), previousGroupId).map((file) => ({ ...file, updatedAt: draggedNext.updatedAt }));

      const untouched = get().files.filter((file) => file.id !== draggedId && (file.folderId || "") !== (targetFolderId || "") && (file.folderId || "") !== (previousGroupId || ""));

      await persistFiles([...untouched, ...sourceGroup, ...updatedGroup]);
    },

    syncToLocalDirectory() { return syncToLocalDirectory(); },

    allFolders() {
      return sortFoldersByOrder(get().folders);
    },

    allFoldersTreeOrder() {
      const folders = get().folders;
      return [...folders].sort((a, b) => {
        const depthDiff = folderDepth(folders, a.id) - folderDepth(folders, b.id);
        if (depthDiff !== 0) return depthDiff;
        const orderDiff = (a.orderIndex ?? 0) - (b.orderIndex ?? 0);
        if (orderDiff !== 0) return orderDiff;
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
      });
    },

    allFiles() {
      return sortFilesByOrder(get().files);
    },

    filesInFolder(folderId: string) {
      return get().allFiles().filter((f) => f.folderId === folderId);
    },

    filesWithoutFolder() {
      return get().allFiles().filter((f) => !f.folderId);
    },

    orphanedFileIds(activeConnectionIds: Set<string>) {
      return new Set(get().files.filter((f) => !activeConnectionIds.has(f.connectionId)).map((f) => f.id));
    },
  };
}));
