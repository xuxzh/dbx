import { useState, useCallback, type Ref } from 'react';
import { safeLocalStorageGet, safeLocalStorageSet } from "@/lib/safeStorage";

interface PanelResizeResult {
  sidebarWidth: number;
  aiPanelWidth: number;
  historyWidth: number;
  sqlLibraryWidth: number;
  startSidebarResize: (e: MouseEvent) => void;
  startAiPanelResize: (e: MouseEvent) => void;
  startHistoryResize: (e: MouseEvent) => void;
  startSqlLibraryResize: (e: MouseEvent) => void;
}

function startPanelResize(
  width: number,
  storageKey: string,
  direction: "left" | "right"
): (e: MouseEvent) => void {
  return (e: MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;

    const onMouseMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      const newWidth = Math.max(180, Math.min(800, startWidth + (direction === "right" ? delta : -delta)));
      // We need to update the state, so this returns a function that takes the setter
      return newWidth;
    };

    const onMouseUp = (finalWidth: number) => {
      document.removeEventListener("mousemove", onMouseMove as any);
      document.removeEventListener("mouseup", onMouseUp as any);
      safeLocalStorageSet(storageKey, String(finalWidth));
    };

    // Store the current newWidth for onMouseUp
    let currentWidth = startWidth;

    const mouseMoveHandler = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      currentWidth = Math.max(180, Math.min(800, startWidth + (direction === "right" ? delta : -delta)));
    };

    const mouseUpHandler = () => {
      document.removeEventListener("mousemove", mouseMoveHandler);
      document.removeEventListener("mouseup", mouseUpHandler);
      safeLocalStorageSet(storageKey, String(currentWidth));
    };

    document.addEventListener("mousemove", mouseMoveHandler);
    document.addEventListener("mouseup", mouseUpHandler);
  };
}

export function usePanelResize(): PanelResizeResult {
  const [sidebarWidth, setSidebarWidth] = useState(() => Number(safeLocalStorageGet("dbx-sidebar-width")) || 260);
  const [aiPanelWidth, setAiPanelWidth] = useState(() => Number(safeLocalStorageGet("dbx-ai-panel-width")) || 360);
  const [historyWidth, setHistoryWidth] = useState(() => Number(safeLocalStorageGet("dbx-history-width")) || 288);
  const [sqlLibraryWidth, setSqlLibraryWidth] = useState(() => Number(safeLocalStorageGet("dbx-sql-library-width")) || 288);

  const startSidebarResize = useCallback((e: MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const onMouseMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      const newWidth = Math.max(180, Math.min(800, startWidth + delta));
      setSidebarWidth(newWidth);
    };

    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      safeLocalStorageSet("dbx-sidebar-width", String(sidebarWidth));
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [sidebarWidth]);

  const startAiPanelResize = useCallback((e: MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = aiPanelWidth;

    const onMouseMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      const newWidth = Math.max(180, Math.min(800, startWidth - delta));
      setAiPanelWidth(newWidth);
    };

    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      safeLocalStorageSet("dbx-ai-panel-width", String(aiPanelWidth));
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [aiPanelWidth]);

  const startHistoryResize = useCallback((e: MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = historyWidth;

    const onMouseMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      const newWidth = Math.max(180, Math.min(800, startWidth - delta));
      setHistoryWidth(newWidth);
    };

    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      safeLocalStorageSet("dbx-history-width", String(historyWidth));
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [historyWidth]);

  const startSqlLibraryResize = useCallback((e: MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sqlLibraryWidth;

    const onMouseMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      const newWidth = Math.max(180, Math.min(800, startWidth - delta));
      setSqlLibraryWidth(newWidth);
    };

    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      safeLocalStorageSet("dbx-sql-library-width", String(sqlLibraryWidth));
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [sqlLibraryWidth]);

  return {
    sidebarWidth,
    aiPanelWidth,
    historyWidth,
    sqlLibraryWidth,
    startSidebarResize,
    startAiPanelResize,
    startHistoryResize,
    startSqlLibraryResize,
  };
}
