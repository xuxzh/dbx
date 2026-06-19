import { useState } from "react";
import { Upload, Download, FolderPlus, RefreshCw, ChevronsLeft } from "lucide-react";
import { Button } from "@/react/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/react/components/ui/tooltip";

interface AppSidebarProps {
  sidebarWidth: number;
  classicLayout?: boolean;
  onImport: (source: "dbx" | "navicat" | "dbeaver" | "datagrip") => void;
  onExport: () => void;
  onStartResize: (event: React.MouseEvent) => void;
  onCollapse: () => void;
  t: (key: string) => string;
}

// Placeholder - ConnectionTree component needs migration
function ConnectionTreePlaceholder() {
  return (
    <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
      {/* ConnectionTree will be migrated in a future task */}
      Connection Tree
    </div>
  );
}

const importSources = [
  { value: "dbx", label: "DBX" },
  { value: "navicat", label: "Navicat" },
  { value: "dbeaver", label: "DBeaver" },
  { value: "datagrip", label: "DataGrip" },
];

export function AppSidebar({
  sidebarWidth,
  classicLayout = false,
  onImport,
  onExport,
  onStartResize,
  onCollapse,
  t,
}: AppSidebarProps) {
  const [importMenuOpen, setImportMenuOpen] = useState(false);

  return (
    <div
      className={`h-full shrink-0 relative select-none ${
        classicLayout ? "" : "rounded-md border border-border/80 bg-background"
      }`}
      style={{ width: `${sidebarWidth}px` }}
    >
      <div className="h-full flex flex-col overflow-hidden">
        {/* Header */}
        <div
          className={`flex items-center gap-px px-3 text-xs font-medium text-muted-foreground border-b bg-muted/20 ${
            classicLayout ? "h-9" : "h-10"
          }`}
        >
          <span className="flex self-stretch items-center truncate">{t("sidebar.connections")}</span>
          <span className="flex-1 self-stretch" />

          {/* Import dropdown */}
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="inline-flex">
                <div className="relative">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5"
                    onClick={() => setImportMenuOpen(!importMenuOpen)}
                  >
                    <Download className="h-3 w-3" />
                  </Button>
                  {importMenuOpen && (
                    <div className="absolute right-0 top-full mt-1 w-44 rounded-md border bg-popover p-1 text-popover-foreground shadow-lg z-50">
                      {importSources.map((source) => (
                        <button
                          key={source.value}
                          className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent rounded"
                          onClick={() => {
                            onImport(source.value as "dbx" | "navicat" | "dbeaver" | "datagrip");
                            setImportMenuOpen(false);
                          }}
                        >
                          {source.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </TooltipTrigger>
            <TooltipContent>{t("sidebar.import")}</TooltipContent>
          </Tooltip>

          {/* Export */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-5 w-5" onClick={onExport}>
                <Upload className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("sidebar.export")}</TooltipContent>
          </Tooltip>

          {/* New Group */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-5 w-5">
                <FolderPlus className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("connectionGroup.createGroup")}</TooltipContent>
          </Tooltip>

          {/* Refresh */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-5 w-5">
                <RefreshCw className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("contextMenu.refreshChildren")}</TooltipContent>
          </Tooltip>

          {/* Collapse */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onCollapse}>
                <ChevronsLeft className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("sidebar.collapse")}</TooltipContent>
          </Tooltip>
        </div>

        {/* Connection Tree */}
        <div className="flex-1 min-h-0">
          <ConnectionTreePlaceholder />
        </div>
      </div>

      {/* Resize Handle */}
      <div
        className="panel-resize-handle panel-resize-handle--right"
        onMouseDown={(e) => {
          e.preventDefault();
          onStartResize(e);
        }}
      />
    </div>
  );
}
