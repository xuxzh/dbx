import { useState, useCallback } from "react";
import { AlertTriangle, Loader2, TextWrap } from "lucide-react";
import { Button } from "@/react/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/react/components/ui/dialog";
import { Label } from "@/react/components/ui/label";
import { Switch } from "@/react/components/ui/switch";

interface DangerConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sql?: string;
  title?: string;
  message?: string;
  details?: string;
  confirmLabel?: string;
  showSuppressToggle?: boolean;
  suppressToggleLabel?: string;
  loading?: boolean;
  closeOnConfirm?: boolean;
  onConfirm: () => void;
  t: (key: string) => string;
  highlightSql?: (sql: string) => string;
}

export function DangerConfirmDialog({
  open,
  onOpenChange,
  sql = "",
  title = "",
  message = "",
  details = "",
  confirmLabel = "",
  showSuppressToggle = false,
  suppressToggleLabel = "",
  loading = false,
  closeOnConfirm = true,
  onConfirm,
  t,
  highlightSql,
}: DangerConfirmDialogProps) {
  const [suppressFuturePrompts, setSuppressFuturePrompts] = useState(false);
  const [wrap, setWrap] = useState(false);

  const code = details || sql;
  const highlightedCode = highlightSql ? highlightSql(code) : code;

  const handleConfirm = useCallback(() => {
    if (loading) return;
    if (closeOnConfirm) onOpenChange(false);
    onConfirm();
  }, [loading, closeOnConfirm, onOpenChange, onConfirm]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            {title || t("dangerDialog.title")}
          </DialogTitle>
        </DialogHeader>

        <div className="py-4 min-w-0">
          <p className="text-sm text-muted-foreground mb-3">
            {message || t("dangerDialog.message")}
          </p>
          {code && (
            <div className="relative">
              <Button
                variant="ghost"
                size="icon"
                className={`absolute top-1 right-1 z-10 h-6 w-6 ${
                  wrap ? "text-foreground bg-accent" : "text-muted-foreground"
                }`}
                title={t("dangerDialog.wrapLines")}
                onClick={() => setWrap(!wrap)}
              >
                <TextWrap className="h-3.5 w-3.5" />
              </Button>
              <pre
                className={`text-xs bg-muted px-3 pt-3 pb-3 pr-7 rounded overflow-auto max-h-40 min-w-0 font-mono ${
                  wrap ? "whitespace-pre-wrap" : "whitespace-pre"
                }`}
                dangerouslySetInnerHTML={{
                  __html: highlightedCode || code,
                }}
              />
            </div>
          )}
          {showSuppressToggle && (
            <div className="mt-3 flex items-center justify-between gap-4 rounded-md border bg-muted/20 px-3 py-2">
              <Label
                htmlFor="danger-confirm-suppress"
                className="text-sm leading-5"
              >
                {suppressToggleLabel || t("dangerDialog.suppressFuturePrompts")}
              </Label>
              <Switch
                id="danger-confirm-suppress"
                checked={suppressFuturePrompts}
                onCheckedChange={setSuppressFuturePrompts}
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={loading} onClick={() => onOpenChange(false)}>
            {t("dangerDialog.cancel")}
          </Button>
          <Button
            variant="destructive"
            className="gap-1.5"
            disabled={loading}
            onClick={handleConfirm}
          >
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {confirmLabel || t("dangerDialog.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
