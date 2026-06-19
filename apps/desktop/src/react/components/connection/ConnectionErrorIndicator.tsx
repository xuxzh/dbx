import { AlertTriangle, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/react/components/ui/popover";
import { useConnectionStore } from "@/react/stores/connectionStore";
import { useTranslation } from "react-i18next";

interface ConnectionErrorIndicatorProps {
  connectionId?: string | null;
  triggerClass?: string;
}

export function ConnectionErrorIndicator({
  connectionId,
  triggerClass = "",
}: ConnectionErrorIndicatorProps) {
  const { t } = useTranslation();
  const connectionStore = useConnectionStore();

  const errorMessage = connectionId
    ? connectionStore.connectionErrors[connectionId]
    : "";

  function clearError() {
    if (connectionId) {
      connectionStore.clearConnectionError(connectionId);
    }
  }

  if (!errorMessage) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-amber-500 hover:bg-amber-500/10 hover:text-amber-600 focus:outline-none focus:ring-1 focus:ring-amber-500/40 ${triggerClass}`}
          title={t("connection.lastError")}
          onClick={(e) => e.stopPropagation()}
        >
          <AlertTriangle className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        className="w-72 gap-2 p-2 text-xs"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="font-medium text-foreground">
              {t("connection.lastError")}
            </div>
            <div className="mt-1 max-h-36 overflow-auto whitespace-pre-wrap break-words text-muted-foreground">
              {errorMessage}
            </div>
          </div>
          <button
            type="button"
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            title={t("connection.clearError")}
            onClick={clearError}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
