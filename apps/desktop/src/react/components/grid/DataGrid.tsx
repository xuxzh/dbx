"use client";

import { useRef, useMemo, useCallback, useState, useEffect } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Rows3,
} from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import type { QueryResult, ColumnInfo } from "@/types/database";
import { displayCellValue, type CellValue } from "@/lib/cellValue";
import { applyColumnFormatter, resolveColumnFormatter, type ColumnFormatterConfig } from "@/lib/columnFormatter";
import { MAX_RESULT_PAGE_SIZE, MIN_RESULT_PAGE_SIZE, normalizeResultPageSize, resultPageSizeMenuOptions } from "@/lib/paginationPageSize";
import { dataGridCellDisplayText, coerceDataGridCellValue } from "@/lib/dataGridCellCoercion";
import { nextDataGridSortState, type DataGridSortDirection } from "@/lib/dataGridSort";

const ROW_HEIGHT = 32;
const HEADER_HEIGHT = 36;
const ROW_NUM_WIDTH = 48;

interface DataGridProps {
  result: QueryResult;
  sql?: string;
  editable?: boolean;
  tableMeta?: {
    schema?: string;
    tableName: string;
    columns: ColumnInfo[];
    primaryKeys: string[];
  };
  pageOffset?: number;
  pageLimit?: number;
  totalRowCount?: number;
  totalRowCountLoading?: boolean;
  loading?: boolean;
  onPageChange?: (offset: number, limit: number) => void;
  onSort?: (column: string, columnIndex: number, direction: "asc" | "desc" | null, whereInput?: string) => void;
  onFilter?: (filters: Record<string, string>) => void;
}

export function DataGrid({
  result,
  sql,
  editable = false,
  tableMeta,
  pageOffset = 0,
  pageLimit = 100,
  totalRowCount,
  totalRowCountLoading = false,
  loading = false,
  onPageChange,
  onSort,
}: DataGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [columnWidths, setColumnWidths] = useState<number[]>([]);
  const [sortColumnIndex, setSortColumnIndex] = useState<number | null>(null);
  const [sortDirection, setSortDirection] = useState<DataGridSortDirection>("asc");
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(Math.floor(pageOffset / pageLimit));
  const [pageSize, setPageSize] = useState(normalizeResultPageSize(pageLimit));

  // Initialize column widths based on content
  useEffect(() => {
    if (result.columns.length > 0 && columnWidths.length !== result.columns.length) {
      const minWidth = 80;
      const maxWidth = 400;
      const widths = result.columns.map((col, idx) => {
        // Estimate width based on column name and sample values
        let maxColWidth = Math.max(col.name.length, 10) * 8;
        for (let i = 0; i < Math.min(10, result.rows.length); i++) {
          const cellText = dataGridCellDisplayText(result.rows[i][idx], result.column_types?.[idx]);
          maxColWidth = Math.max(maxColWidth, cellText.length * 8);
        }
        return Math.min(maxWidth, Math.max(minWidth, maxColWidth));
      });
      setColumnWidths(widths);
    }
  }, [result]);

  const totalWidth = useMemo(() => {
    return ROW_NUM_WIDTH + columnWidths.reduce((a, b) => a + b, 0);
  }, [columnWidths]);

  const totalRows = totalRowCount ?? result.rows.length;
  const totalPages = Math.ceil(totalRows / pageSize);
  const canGoNextPage = currentPage < totalPages - 1;
  const canGoPrevPage = currentPage > 0;

  function handleSort(columnIndex: number) {
    const newDirection = nextDataGridSortState(
      sortColumnIndex === columnIndex ? sortDirection : null,
      "asc"
    );
    setSortColumnIndex(newDirection ? columnIndex : null);
    setSortDirection(newDirection ?? "asc");
    if (onSort && result.columns[columnIndex]) {
      onSort(result.columns[columnIndex], columnIndex, newDirection);
    }
  }

  function handlePageChange(newPage: number) {
    const clampedPage = Math.max(0, Math.min(totalPages - 1, newPage));
    setCurrentPage(clampedPage);
    if (onPageChange) {
      onPageChange(clampedPage * pageSize, pageSize);
    }
  }

  function handlePageSizeChange(newSize: number) {
    const normalizedSize = normalizeResultPageSize(newSize);
    setPageSize(normalizedSize);
    setCurrentPage(0);
    if (onPageChange) {
      onPageChange(0, normalizedSize);
    }
  }

  // Keyboard navigation
  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedRowIndex((prev) =>
        prev === null ? 0 : Math.min(result.rows.length - 1, prev + 1)
      );
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedRowIndex((prev) =>
        prev === null ? 0 : Math.max(0, prev - 1)
      );
    } else if (event.key === "PageDown") {
      event.preventDefault();
      handlePageChange(currentPage + 1);
    } else if (event.key === "PageUp") {
      event.preventDefault();
      handlePageChange(currentPage - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      setSelectedRowIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setSelectedRowIndex(result.rows.length - 1);
    }
  }

  const rowVirtualizer = useVirtualizer({
    count: result.rows.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  });

  function getSortIcon(columnIndex: number) {
    if (sortColumnIndex !== columnIndex) {
      return <ArrowUpDown className="h-3.5 w-3.5 opacity-30" />;
    }
    return sortDirection === "asc" ? (
      <ArrowUp className="h-3.5 w-3.5" />
    ) : (
      <ArrowDown className="h-3.5 w-3.5" />
    );
  }

  function typeColorClass(columnIndex: number): string {
    const typeName = result.column_types?.[columnIndex] ?? "";
    const s = typeName.replace(/\(.*\)$/, "").toLowerCase();
    if (["int", "int2", "int4", "int8", "smallint", "bigint", "integer", "serial", "bigserial", "tinyint", "mediumint"].includes(s))
      return "text-blue-500";
    if (["float4", "float8", "double", "decimal", "numeric", "real", "float", "money"].includes(s))
      return "text-cyan-500";
    if (["varchar", "text", "char", "character varying", "character", "string", "nvarchar", "nchar", "ntext", "longtext", "mediumtext", "tinytext", "clob"].includes(s))
      return "text-green-500";
    if (["bool", "boolean", "bit"].includes(s))
      return "text-orange-500";
    if (["timestamp", "timestamptz", "datetime", "date", "time", "timetz", "datetime2", "smalldatetime"].includes(s))
      return "text-purple-500";
    if (["json", "jsonb", "xml", "array"].includes(s))
      return "text-pink-500";
    if (["uuid", "uniqueidentifier"].includes(s))
      return "text-amber-500";
    if (["bytea", "blob", "binary", "varbinary", "image"].includes(s))
      return "text-red-400";
    if (["geometry", "geography"].includes(s))
      return "text-emerald-500";
    return "text-muted-foreground";
  }

  const virtualItems = rowVirtualizer.getVirtualItems();

  if (loading && result.rows.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (result.columns.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        No data
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full" onKeyDown={handleKeyDown} tabIndex={0}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/20">
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Rows3 className="h-3.5 w-3.5" />
            {result.rows.length.toLocaleString()} rows
          </span>
          {totalRowCount !== undefined && (
            <span>Total: {totalRowCount.toLocaleString()}</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Rows per page:</span>
          <Select
            value={String(pageSize)}
            onValueChange={(value) => handlePageSizeChange(Number(value))}
          >
            <SelectTrigger className="h-7 w-auto border-0 bg-transparent px-1 text-xs shadow-none focus:ring-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {resultPageSizeMenuOptions.map((opt) => (
                <SelectItem key={opt.value} value={String(opt.value)}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 min-h-0 relative">
        {/* Header */}
        <div
          className="flex absolute top-0 left-0 right-0 z-10 bg-muted/50 border-b"
          style={{ height: HEADER_HEIGHT }}
        >
          <div
            className="flex items-center justify-center text-xs text-muted-foreground font-medium border-r"
            style={{ width: ROW_NUM_WIDTH }}
          >
            #
          </div>
          {result.columns.map((col, colIndex) => (
            <div
              key={colIndex}
              className="flex items-center px-2 border-r cursor-pointer hover:bg-muted/70 select-none"
              style={{ width: columnWidths[colIndex] || 120 }}
              onClick={() => handleSort(colIndex)}
            >
              <span className={`truncate flex-1 text-xs ${typeColorClass(colIndex)}`}>
                {col}
              </span>
              <span className="ml-1">{getSortIcon(colIndex)}</span>
            </div>
          ))}
        </div>

        {/* Body */}
        <div
          ref={containerRef}
          className="absolute inset-0 overflow-auto"
          style={{ paddingTop: HEADER_HEIGHT }}
        >
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              width: `${totalWidth}px`,
              position: "relative",
            }}
          >
            {virtualItems.map((virtualRow) => {
              const rowIndex = virtualRow.index;
              const row = result.rows[rowIndex];
              const isSelected = selectedRowIndex === rowIndex;

              return (
                <div
                  key={virtualRow.key}
                  className={`flex absolute left-0 right-0 items-center border-b ${
                    isSelected ? "bg-primary/10" : "hover:bg-muted/30"
                  }`}
                  style={{
                    height: ROW_HEIGHT,
                    top: virtualRow.start,
                    width: totalWidth,
                  }}
                  onClick={() => setSelectedRowIndex(rowIndex)}
                >
                  <div
                    className="flex items-center justify-center text-xs text-muted-foreground border-r"
                    style={{ width: ROW_NUM_WIDTH }}
                  >
                    {rowIndex + 1 + pageOffset}
                  </div>
                  {result.columns.map((_, colIndex) => {
                    const cellValue = row[colIndex];
                    const displayText = dataGridCellDisplayText(cellValue, result.column_types?.[colIndex]);
                    const isNull = cellValue === null;

                    return (
                      <div
                        key={colIndex}
                        className="flex items-center px-2 border-r truncate text-xs"
                        style={{ width: columnWidths[colIndex] || 120 }}
                      >
                        <span className={`truncate ${isNull ? "text-muted-foreground italic" : ""}`}>
                          {isNull ? "NULL" : displayText}
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between px-3 py-2 border-t bg-muted/20">
        <div className="text-xs text-muted-foreground">
          Page {currentPage + 1} of {totalPages || 1}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={!canGoPrevPage}
            onClick={() => handlePageChange(0)}
          >
            <ChevronsLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={!canGoPrevPage}
            onClick={() => handlePageChange(currentPage - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={!canGoNextPage}
            onClick={() => handlePageChange(currentPage + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={!canGoNextPage}
            onClick={() => handlePageChange(totalPages - 1)}
          >
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
