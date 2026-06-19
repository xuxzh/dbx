"use client";

import { Loader2, Square } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button";

interface QueryLoadingStateProps {
  labelKey?: string;
  elapsedSeconds?: number | string;
  showCancel?: boolean;
  cancelDisabled?: boolean;
  cancelling?: boolean;
  cancelLabelKey?: string;
  onCancel?: () => void;
}

export function QueryLoadingState({
  labelKey = "common.loading",
  elapsedSeconds,
  showCancel = false,
  cancelDisabled = false,
  cancelling = false,
  cancelLabelKey = "toolbar.stopQuery",
  onCancel,
}: QueryLoadingStateProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
      <div className="flex items-center">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        {t(labelKey)}
        {elapsedSeconds !== undefined && (
          <span className="ml-1 tabular-nums text-muted-foreground/80">
            · {elapsedSeconds}s
          </span>
        )}
      </div>
      {showCancel && (
        <Button
          variant="destructive"
          size="sm"
          className="h-7 gap-1.5"
          disabled={cancelDisabled}
          onClick={onCancel}
        >
          {cancelling ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Square className="h-3.5 w-3.5 fill-current" />
          )}
          {t(cancelLabelKey)}
        </Button>
      )}
    </div>
  );
}
