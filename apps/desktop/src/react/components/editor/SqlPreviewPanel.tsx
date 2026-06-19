import { useState, useEffect, useCallback, useRef } from "react";
import { AlignLeft, Copy, ChevronDown } from "lucide-react";
import { Button } from "@/react/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/react/components/ui/tooltip";
import { useTheme } from "@/react/hooks/useTheme";
import { useToast } from "@/react/hooks/useToast";
import { copyToClipboard } from "@/lib/clipboard";
import { formatSqlText, type SqlFormatDialect } from "@/lib/sqlFormatter";
import type { Highlighter } from "shiki";

interface SqlPreviewPanelProps {
  sql: string;
  sqlFormatDialect?: SqlFormatDialect;
  loading?: boolean;
  onClose: () => void;
  t: (key: string) => string;
}

export function SqlPreviewPanel({
  sql,
  sqlFormatDialect,
  loading = false,
  onClose,
  t,
}: SqlPreviewPanelProps) {
  const { isDark } = useTheme();
  const { toast } = useToast();

  const [isFormatted, setIsFormatted] = useState(false);
  const [formattedSql, setFormattedSql] = useState("");
  const [formatting, setFormatting] = useState(false);
  const [highlightedHtml, setHighlightedHtml] = useState("");
  const [highlighterReady, setHighlighterReady] = useState(false);

  const highlighterRef = useRef<Highlighter | null>(null);

  const displaySql = isFormatted && formattedSql ? formattedSql : sql;
  const hasSql = sql.trim().length > 0;

  const initHighlighter = useCallback(async () => {
    if (highlighterRef.current) return;
    try {
      const { createHighlighter } = await import("shiki");
      highlighterRef.current = await createHighlighter({
        themes: ["dark-plus", "min-light"],
        langs: ["sql"],
      });
      setHighlighterReady(true);
      await highlightSql();
    } catch (e) {
      console.error("[DBX][SqlPreviewPanel] Failed to init shiki:", e);
    }
  }, []);

  const highlightSql = useCallback(async () => {
    if (!highlighterRef.current || !displaySql) {
      setHighlightedHtml("");
      return;
    }
    try {
      const theme = isDark ? "dark-plus" : "min-light";
      const html = highlighterRef.current.codeToHtml(displaySql, {
        lang: "sql",
        theme,
      });
      setHighlightedHtml(html);
    } catch {
      setHighlightedHtml("");
    }
  }, [displaySql, isDark]);

  const toggleFormat = useCallback(async () => {
    if (formatting || !hasSql) return;

    if (isFormatted) {
      setIsFormatted(false);
      await highlightSql();
      return;
    }

    setFormatting(true);
    try {
      const formatted = await formatSqlText(sql, sqlFormatDialect ?? "generic");
      setFormattedSql(formatted);
      setIsFormatted(true);
      await highlightSql();
    } catch {
      toast(t("toolbar.formatSqlFailed"), 3000);
    } finally {
      setFormatting(false);
    }
  }, [formatting, hasSql, isFormatted, sql, sqlFormatDialect, highlightSql, toast, t]);

  const handleCopy = useCallback(async () => {
    const text = displaySql;
    if (!text.trim()) return;
    try {
      await copyToClipboard(text);
      toast(t("grid.copied"));
    } catch (e: any) {
      toast(t("grid.copyFailed", { message: e?.message || String(e) }), 5000);
    }
  }, [displaySql, toast, t]);

  useEffect(() => {
    setIsFormatted(false);
    setFormattedSql("");
    if (highlighterReady && sql.trim()) {
      highlightSql();
    }
  }, [sql, highlighterReady, highlightSql]);

  useEffect(() => {
    if (isDark && highlighterReady && displaySql) {
      highlightSql();
    }
  }, [isDark, highlighterReady, displaySql, highlightSql]);

  useEffect(() => {
    if (displaySql && highlighterReady) {
      highlightSql();
    }
  }, [displaySql, highlighterReady, highlightSql]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void initHighlighter();
    }, 0);
    return () => {
      clearTimeout(timer);
      highlighterRef.current?.dispose();
      highlighterRef.current = null;
      setHighlighterReady(false);
    };
  }, [initHighlighter]);

  return (
    <div className="h-full flex flex-col bg-background border-t">
      {/* Header bar */}
      <div className="h-8 shrink-0 border-b bg-muted/30 px-2 flex items-center gap-1 text-xs text-muted-foreground">
        <span className="font-medium text-muted-foreground/70 select-none">SQL</span>
        <span className="flex-1 min-w-0" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={`h-6 w-6 ${
                isFormatted
                  ? "text-amber-600 bg-amber-500/10"
                  : "text-amber-600/60 hover:text-amber-700 hover:bg-amber-500/10"
              }`}
              disabled={formatting || !hasSql}
              onClick={toggleFormat}
            >
              <AlignLeft className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("toolbar.formatSql")}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground/60 hover:text-foreground hover:bg-accent"
              disabled={!hasSql}
              onClick={handleCopy}
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("grid.copy")}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground/60 hover:text-foreground hover:bg-accent"
              onClick={onClose}
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("toolbar.hidePreviewSql")}</TooltipContent>
        </Tooltip>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
            {t("common.loading")}
          </div>
        ) : !hasSql ? (
          <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
            {t("editor.pressToExecute", { mod: "Cmd/Ctrl" })}
          </div>
        ) : highlightedHtml ? (
          <div
            className="p-3 text-xs leading-relaxed [&_pre]:!bg-transparent [&_pre]:!p-0 [&_code]:!font-mono [&_code]:text-xs"
            dangerouslySetInnerHTML={{ __html: highlightedHtml }}
          />
        ) : (
          <pre className="p-3 text-xs font-mono whitespace-pre-wrap select-text">
            {displaySql}
          </pre>
        )}
      </div>
    </div>
  );
}
