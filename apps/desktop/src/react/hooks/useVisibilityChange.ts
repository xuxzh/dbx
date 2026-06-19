import { useEffect, useRef } from 'react';
import { refreshConnections } from "@/lib/api";
import { useQueryStore } from '@/react/stores/queryStore';

let hiddenAt: number | null = null;

function handleVisibilityChange(onVisible: () => void) {
  if (document.hidden) {
    hiddenAt = Date.now();
  } else {
    const wasHidden = hiddenAt;
    hiddenAt = null;
    if (wasHidden && Date.now() - wasHidden > 30_000) {
      refreshConnections().catch(() => {});
      const queryStore = useQueryStore.getState();
      const stuckTabs = queryStore.tabs.filter((t) => t.isExecuting);
      if (stuckTabs.length > 0) {
        queryStore.notifyConnectionMayBeLost();
      }
    }
    onVisible();
  }
}

export function useVisibilityChange(onVisible?: () => void) {
  const onVisibleRef = useRef(onVisible);
  onVisibleRef.current = onVisible;

  useEffect(() => {
    const handler = () => handleVisibilityChange(() => onVisibleRef.current?.());

    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, []);
}
