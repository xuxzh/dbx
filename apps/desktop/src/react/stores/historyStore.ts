import { create } from 'zustand';
import { uuid } from "@/lib/utils";
import * as api from "@/lib/api";
import type { HistoryEntry } from "@/lib/api";

export interface HistoryStoreState {
  entries: HistoryEntry[];
  loading: boolean;
  load: () => Promise<void>;
  add: (entry: Omit<HistoryEntry, "id" | "executed_at">) => Promise<void>;
  remove: (id: string) => Promise<void>;
  clear: () => Promise<void>;
}

export const useHistoryStore = create((set, get) => ({
  entries: [],
  loading: false,

  async load() {
    set({ loading: true });
    try {
      const entries = await api.loadHistory(200, 0);
      set({ entries });
    } finally {
      set({ loading: false });
    }
  },

  async add(entry: Omit<HistoryEntry, "id" | "executed_at">) {
    const full: HistoryEntry = {
      ...entry,
      id: uuid(),
      executed_at: new Date().toISOString(),
    };
    await api.saveHistory(full);
    set({ entries: [full, ...get().entries].slice(0, 200) });
  },

  async remove(id: string) {
    await api.deleteHistoryEntry(id);
    set({ entries: get().entries.filter((e) => e.id !== id) });
  },

  async clear() {
    await api.clearHistory();
    set({ entries: [] });
  },
}));
