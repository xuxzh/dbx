import { useState, useEffect, useRef, useCallback } from "react";
import { ChevronUp, ChevronDown, ChevronRight, X } from "lucide-react";
import { EditorSelection } from "@codemirror/state";
import {
  SearchQuery,
  setSearchQuery,
  findNext,
  findPrevious,
  replaceNext,
  replaceAll,
} from "@codemirror/search";
import type { EditorView } from "@codemirror/view";

interface EditorSearchPanelProps {
  view: EditorView | null;
  t: (key: string) => string;
}

const SEARCH_UPDATE_DELAY_MS = 120;
const MATCH_COUNT_LIMIT = 1000;

export function EditorSearchPanel({ view, t }: EditorSearchPanelProps) {
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [showReplace, setShowReplace] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [matchCount, setMatchCount] = useState(0);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const [matchCountLimited, setMatchCountLimited] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const searchUpdateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dispatchSearchQuery = useCallback(() => {
    const v = view;
    if (!v) return;
    const q = new SearchQuery({
      search: searchText,
      caseSensitive,
      regexp: useRegex,
      replace: replaceText,
    });
    v.dispatch({ effects: setSearchQuery.of(q) });
  }, [view, searchText, caseSensitive, useRegex, replaceText]);

  const clearSearchQuery = useCallback(() => {
    const v = view;
    if (!v) return;
    const selection = v.state.selection.main;
    v.dispatch({
      selection: EditorSelection.single(selection.head),
      effects: setSearchQuery.of(new SearchQuery({ search: "" })),
    });
    setMatchCount(0);
    setCurrentMatchIndex(0);
    setMatchCountLimited(false);
  }, [view]);

  const updateMatchInfo = useCallback(
    (autoSelect = false) => {
      const v = view;
      if (!v || !searchText) {
        setMatchCount(0);
        setCurrentMatchIndex(0);
        setMatchCountLimited(false);
        return;
      }
      try {
        const q = new SearchQuery({
          search: searchText,
          caseSensitive,
          regexp: useRegex,
        });
        if (!q.valid) {
          setMatchCount(0);
          setCurrentMatchIndex(0);
          setMatchCountLimited(false);
          return;
        }
        if (autoSelect) {
          findNext(v);
        }
        const iter = q.getCursor(v.state);
        let count = 0;
        let curIdx = 0;
        const selFrom = v.state.selection.main.from;
        const selTo = v.state.selection.main.to;
        let r = iter.next();
        while (!r.done) {
          count++;
          if (r.value.from === selFrom && r.value.to === selTo) curIdx = count;
          if (count >= MATCH_COUNT_LIMIT) break;
          r = iter.next();
        }
        setMatchCount(count);
        setMatchCountLimited(count >= MATCH_COUNT_LIMIT && !r.done);
        setCurrentMatchIndex(curIdx || (count > 0 ? 1 : 0));
      } catch {
        setMatchCount(0);
        setCurrentMatchIndex(0);
        setMatchCountLimited(false);
      }
    },
    [view, searchText, caseSensitive, useRegex]
  );

  const scheduleSearchUpdate = useCallback(
    (autoSelect = false) => {
      if (searchUpdateTimerRef.current) {
        clearTimeout(searchUpdateTimerRef.current);
        searchUpdateTimerRef.current = null;
      }
      if (!searchText) {
        clearSearchQuery();
        return;
      }
      dispatchSearchQuery();
      searchUpdateTimerRef.current = setTimeout(() => {
        searchUpdateTimerRef.current = null;
        updateMatchInfo(autoSelect);
      }, SEARCH_UPDATE_DELAY_MS);
    },
    [searchText, clearSearchQuery, dispatchSearchQuery, updateMatchInfo]
  );

  const openSearch = useCallback((): boolean => {
    setSearchVisible(true);
    const v = view;
    if (v) {
      const sel = v.state.sliceDoc(v.state.selection.main.from, v.state.selection.main.to);
      if (sel && !sel.includes("\n")) setSearchText(sel);
    }
    setTimeout(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    }, 0);
    if (searchText) scheduleSearchUpdate(true);
    return true;
  }, [view, searchText, scheduleSearchUpdate]);

  const openReplace = useCallback((): boolean => {
    openSearch();
    setShowReplace(true);
    setTimeout(() => {
      replaceInputRef.current?.focus();
      replaceInputRef.current?.select();
    }, 0);
    return true;
  }, [openSearch]);

  const closeSearch = useCallback((): boolean => {
    const wasVisible = searchVisible;
    setSearchVisible(false);
    setShowReplace(false);
    const v = view;
    if (v) {
      clearSearchQuery();
      v.focus();
    }
    return wasVisible;
  }, [searchVisible, view, clearSearchQuery]);

  const nextMatch = useCallback(() => {
    const v = view;
    if (!v || !searchText) return;
    findNext(v);
    updateMatchInfo();
  }, [view, searchText, updateMatchInfo]);

  const prevMatch = useCallback(() => {
    const v = view;
    if (!v || !searchText) return;
    findPrevious(v);
    updateMatchInfo();
  }, [view, searchText, updateMatchInfo]);

  const doReplace = useCallback(() => {
    const v = view;
    if (!v || !searchText) return;
    replaceNext(v);
    updateMatchInfo();
  }, [view, searchText, updateMatchInfo]);

  const doReplaceAll = useCallback(() => {
    const v = view;
    if (!v || !searchText) return;
    replaceAll(v);
    updateMatchInfo();
  }, [view, searchText, updateMatchInfo]);

  const onSearchKeydown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeSearch();
      } else if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        nextMatch();
      } else if (e.key === "Enter" && e.shiftKey) {
        e.preventDefault();
        prevMatch();
      }
    },
    [closeSearch, nextMatch, prevMatch]
  );

  useEffect(() => {
    if (searchVisible) scheduleSearchUpdate(true);
  }, [searchText, caseSensitive, useRegex, searchVisible, scheduleSearchUpdate]);

  useEffect(() => {
    if (searchVisible) dispatchSearchQuery();
  }, [replaceText, searchVisible, dispatchSearchQuery]);

  useEffect(() => {
    return () => {
      if (searchUpdateTimerRef.current) {
        clearTimeout(searchUpdateTimerRef.current);
      }
    };
  }, []);

  if (!searchVisible) return null;

  return (
    <div className="absolute top-1 right-4 z-[9999] isolate flex flex-col gap-1 rounded-md border bg-popover p-1.5 text-popover-foreground shadow-lg transition-all duration-150 ease-out">
      <div className="flex items-center gap-0.5">
        <button
          className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          title={showReplace ? t("editor.search.collapseReplace") : t("editor.search.expandReplace")}
          onClick={() => setShowReplace(!showReplace)}
        >
          <ChevronRight
            className={`w-3 h-3 transition-transform ${showReplace && "rotate-90"}`}
          />
        </button>
        <input
          ref={searchInputRef}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          autocapitalize="off"
          autocorrect="off"
          spellcheck={false}
          className="w-48 h-6 text-xs bg-input border rounded px-2 outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
          placeholder={t("editor.search.find")}
          onKeyDown={onSearchKeydown}
        />
        <button
          className={`w-6 h-6 flex items-center justify-center rounded text-xs font-mono ${
            caseSensitive ? "bg-accent text-accent-foreground" : "text-muted-foreground"
          } hover:bg-accent`}
          title={t("editor.search.caseSensitive")}
          onClick={() => setCaseSensitive(!caseSensitive)}
        >
          Aa
        </button>
        <button
          className={`w-6 h-6 flex items-center justify-center rounded text-xs font-mono ${
            useRegex ? "bg-accent text-accent-foreground" : "text-muted-foreground"
          } hover:bg-accent`}
          title={t("editor.search.regex")}
          onClick={() => setUseRegex(!useRegex)}
        >
          .*
        </button>
        <span className="text-xs text-muted-foreground min-w-[3rem] text-center shrink-0">
          {searchText && matchCount > 0
            ? `${currentMatchIndex}/${matchCount}${matchCountLimited ? "+" : ""}`
            : t("editor.search.noResults")}
        </span>
        <button
          className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          title={t("editor.search.prevMatch")}
          onClick={prevMatch}
        >
          <ChevronUp className="w-3.5 h-3.5" />
        </button>
        <button
          className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          title={t("editor.search.nextMatch")}
          onClick={nextMatch}
        >
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
        <button
          className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          title={t("editor.search.close")}
          onClick={() => closeSearch()}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      {showReplace && (
        <div className="flex items-center gap-0.5">
          <div className="w-5 h-5 shrink-0" />
          <input
            ref={replaceInputRef}
            value={replaceText}
            onChange={(e) => setReplaceText(e.target.value)}
            autocapitalize="off"
            autocorrect="off"
            spellcheck={false}
            className="w-48 h-6 text-xs bg-input border rounded px-2 outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
            placeholder={t("editor.search.replace")}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                doReplace();
              } else if (e.key === "Escape") {
                e.preventDefault();
                closeSearch();
              }
            }}
          />
          <button
            className="h-6 px-1.5 flex items-center justify-center rounded text-xs text-muted-foreground hover:bg-accent hover:text-foreground border"
            title={t("editor.search.replace")}
            onClick={doReplace}
          >
            {t("editor.search.replace")}
          </button>
          <button
            className="h-6 px-1.5 flex items-center justify-center rounded text-xs text-muted-foreground hover:bg-accent hover:text-foreground border"
            title={t("editor.search.replaceAll")}
            onClick={doReplaceAll}
          >
            {t("editor.search.replaceAll")}
          </button>
        </div>
      )}
    </div>
  );
}
