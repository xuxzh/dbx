"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import * as echarts from "echarts";
import { BarChart3, ChevronDown } from "lucide-react";
import { Button } from "./ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import type { QueryResult } from "@/types/database";
import { useTheme } from "@/composables/useTheme";
import { axisColumnLabel, chartableColumnIndexes, toChartNumber } from "@/lib/chartData";

type ChartType = "line" | "bar" | "pie";

interface QueryChartProps {
  result: QueryResult;
}

export function QueryChart({ result }: QueryChartProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<echarts.ECharts>();

  const [chartType, setChartType] = useState<ChartType>("bar");
  const [xColumnIndex, setXColumnIndex] = useState(0);
  const [yColumnIndexes, setYColumnIndexes] = useState<number[]>([]);

  const numericColumnIndexes = chartableColumnIndexes(result);

  const allColumnOptions = result.columns.map((_, index) => ({
    index,
    label: axisColumnLabel(result.columns, index),
  }));
  const numericColumnOptions = numericColumnIndexes.map((index) => ({
    index,
    label: axisColumnLabel(result.columns, index),
  }));

  useEffect(() => {
    const cols = result.columns;
    const numCols = numericColumnIndexes;
    const newXIndex = cols.findIndex((_, index) => !numCols.includes(index));
    setXColumnIndex(newXIndex >= 0 ? newXIndex : cols.length > 0 ? 0 : -1);
    setYColumnIndexes(numCols.length > 0 ? [numCols[0]] : []);
  }, [result]);

  useEffect(() => {
    if (!chartRef.current) return;

    chartInstance.current = echarts.init(chartRef.current);

    return () => {
      chartInstance.current?.dispose();
    };
  }, []);

  useEffect(() => {
    const observer = new ResizeObserver(() => {
      chartInstance.current?.resize();
    });
    if (chartRef.current) observer.observe(chartRef.current);
    return () => observer.disconnect();
  }, []);

  const chartOption = useCallback((): echarts.EChartsOption | null => {
    const xIdx = xColumnIndex;
    if (xIdx < 0 || yColumnIndexes.length === 0) return null;

    const xData = result.rows.map((row) => String(row[xIdx] ?? ""));

    if (chartType === "pie") {
      const yIdx = yColumnIndexes[0];
      if (yIdx < 0) return null;
      return {
        tooltip: { trigger: "item" },
        legend: { bottom: 0, textStyle: { color: isDark ? "#ccc" : "#333" } },
        series: [
          {
            type: "pie",
            radius: ["30%", "60%"],
            data: xData.map((name, i) => ({
              name,
              value: toChartNumber(result.rows[i][yIdx]) ?? 0,
            })),
          },
        ],
      };
    }

    const yIndices = yColumnIndexes.filter((index) => index >= 0 && index < result.columns.length);
    const textColor = isDark ? "#aaa" : "#666";

    return {
      tooltip: { trigger: "axis" },
      legend: {
        bottom: 0,
        textStyle: { color: isDark ? "#ccc" : "#333" },
      },
      grid: { left: 60, right: 20, top: 20, bottom: 40 },
      xAxis: {
        type: "category" as const,
        data: xData,
        axisLabel: { color: textColor },
      },
      yAxis: {
        type: "value" as const,
        axisLabel: { color: textColor },
      },
      series: yIndices.map((yIdx) => ({
        name: axisColumnLabel(result.columns, yIdx),
        type: chartType,
        data: result.rows.map((row) => toChartNumber(row[yIdx]) ?? 0),
        smooth: chartType === "line",
      })),
    };
  }, [result, chartType, xColumnIndex, yColumnIndexes, isDark]);

  useEffect(() => {
    const option = chartOption();
    if (option && chartInstance.current) {
      chartInstance.current.setOption(option);
    }
  }, [chartOption]);

  function toggleYColumn(index: number) {
    const idx = yColumnIndexes.indexOf(index);
    if (idx >= 0) {
      setYColumnIndexes(yColumnIndexes.filter((selected) => selected !== index));
    } else {
      setYColumnIndexes([...yColumnIndexes, index]);
    }
  }

  const hasData = result.rows.length > 0 && numericColumnIndexes.length > 0;
  const yColumnLabel =
    yColumnIndexes.length === 0
      ? "0"
      : (() => {
          const [first, ...rest] = yColumnIndexes;
          const label = axisColumnLabel(result.columns, first);
          return rest.length > 0 ? `${label} +${rest.length}` : label;
        })();

  if (!hasData) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground text-sm">
          <BarChart3 className="h-10 w-10 opacity-30" />
          <span>{t("chart.noNumericData")}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="h-9 shrink-0 border-b bg-muted/20 px-3 flex items-center gap-3 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">{t("chart.type")}</span>
          <div className="flex gap-0.5">
            {(["bar", "line", "pie"] as ChartType[]).map((ct) => (
              <Button
                key={ct}
                size="sm"
                variant={chartType === ct ? "secondary" : "ghost"}
                className="h-6 px-2 text-xs"
                onClick={() => setChartType(ct)}
              >
                {t(`chart.${ct}`)}
              </Button>
            ))}
          </div>
        </div>
        <span className="h-4 w-px bg-border" />
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">X</span>
          <Select
            value={String(xColumnIndex)}
            onValueChange={(value) => setXColumnIndex(Number(value))}
          >
            <SelectTrigger className="h-6 w-auto max-w-40 border-0 bg-transparent px-1 text-xs shadow-none focus:ring-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {allColumnOptions.map((col) => (
                <SelectItem key={col.index} value={String(col.index)}>
                  {col.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <span className="h-4 w-px bg-border" />
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Y</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-6 max-w-48 gap-1 px-2 text-xs">
                <span className="truncate">{yColumnLabel}</span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56" align="start">
              {numericColumnOptions.map((col) => (
                <DropdownMenuCheckboxItem
                  key={col.index}
                  checked={yColumnIndexes.includes(col.index)}
                  onCheckedChange={() => toggleYColumn(col.index)}
                >
                  <span className="truncate text-xs">{col.label}</span>
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="flex-1 min-h-0 p-2">
        <div ref={chartRef} style={{ width: "100%", height: "100%" }} />
      </div>
    </div>
  );
}
