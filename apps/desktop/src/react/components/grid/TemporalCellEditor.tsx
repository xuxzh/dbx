"use client";

import { useState, useRef, useEffect } from "react";
import type { FocusOutsideEvent, PointerDownOutsideEvent } from "reka-ui";
import { CalendarClock, ChevronDown, ChevronUp, CircleSlash } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { formatTemporalInputValue, type TemporalCellEditorKind } from "@/lib/dataGridTemporalEditor";

interface TemporalCellEditorProps {
  kind: TemporalCellEditorKind;
  value: string;
  variant?: "cell" | "inline";
  cellLayout?: "grid" | "transpose";
  commitOnClose?: boolean;
  onUpdate: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}

export function TemporalCellEditor({
  kind,
  value,
  variant = "cell",
  cellLayout = "grid",
  commitOnClose = true,
  onUpdate,
  onCommit,
  onCancel,
}: TemporalCellEditorProps) {
  const [open, setOpen] = useState(true);
  const triggerRef = useRef<HTMLButtonElement>(null);
  let closeHandled = false;
  let isCommitting = false;

  const hasDate = kind !== "time";
  const hasTime = kind !== "date";

  const displayValue = value || "NULL";

  const triggerClass =
    variant === "inline"
      ? "cell-edit-input flex h-9 w-full items-center gap-2 rounded border bg-background px-2 text-left text-xs outline-none hover:border-primary/60 focus:border-primary"
      : [
          "cell-edit-input absolute inset-0 z-10 flex items-center gap-1 border-2 border-primary bg-background py-0 text-left text-xs outline-none",
          cellLayout === "transpose" ? "px-1.5" : "px-2.5",
        ].join(" ");

  const dateParts = (() => {
    const text = formatTemporalInputValue(value, "date");
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (!match) {
      const now = new Date();
      return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
    }
    return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  })();

  const timeValue =
    kind === "time"
      ? formatTemporalInputValue(value, "time") || "00:00:00"
      : formatTemporalInputValue(value, "datetime").split("T")[1] || "00:00:00";

  const timeParts = (() => {
    const [hour = "00", minute = "00", second = "00"] = timeValue.split(":");
    return { hour, minute, second };
  })();

  useEffect(() => {
    triggerRef.current?.focus();
  }, []);

  function setOpenValue(openValue: boolean) {
    setOpen(openValue);
    if (!openValue && commitOnClose && !closeHandled) {
      finishCommit();
    }
  }

  function setModelValue(newValue: string) {
    onUpdate(newValue);
  }

  function updateDate(part: "day" | "month" | "year", rawValue: string | number) {
    const numberValue = Number(rawValue);
    const next = { ...dateParts };
    if (Number.isNaN(numberValue)) return;
    if (part === "year") next.year = Math.max(1, Math.min(9999, numberValue));
    else if (part === "month") next.month = Math.max(1, Math.min(12, numberValue));
    else next.day = Math.max(1, Math.min(31, numberValue));
    const maxDay = daysInMonth(next.year, next.month);
    next.day = Math.max(1, Math.min(maxDay, next.day));
    setDateTimeValue(next.year, next.month, next.day, timeValue);
  }

  function updateDateFromInput(part: "day" | "month" | "year", event: React.ChangeEvent<HTMLInputElement>) {
    updateDate(part, event.target.value);
  }

  function stepDate(part: "day" | "month" | "year", delta: number) {
    updateDate(part, dateParts[part] + delta);
  }

  function updateTime(part: "hour" | "minute" | "second", rawValue: string | number) {
    const parts = { ...timeParts, [part]: normalizeTimePart(rawValue, part === "hour" ? 23 : 59) };
    const nextTime = `${parts.hour}:${parts.minute}:${parts.second}`;
    if (kind === "time") {
      setModelValue(nextTime);
      return;
    }
    setDateTimeValue(dateParts.year, dateParts.month, dateParts.day, nextTime);
  }

  function updateTimeFromInput(part: "hour" | "minute" | "second", event: React.ChangeEvent<HTMLInputElement>) {
    updateTime(part, event.target.value);
  }

  function stepTime(part: "hour" | "minute" | "second", delta: number) {
    const max = part === "hour" ? 23 : 59;
    const current = Number(timeParts[part]) || 0;
    updateTime(part, (current + delta + max + 1) % (max + 1));
  }

  function setNull() {
    setModelValue("NULL");
  }

  function setNow() {
    const now = new Date();
    const dateText = [
      String(now.getFullYear()).padStart(4, "0"),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
    ].join("-");
    const nextTime = [
      String(now.getHours()).padStart(2, "0"),
      String(now.getMinutes()).padStart(2, "0"),
      String(now.getSeconds()).padStart(2, "0"),
    ].join(":");
    if (kind === "date") setModelValue(dateText);
    else if (kind === "time") setModelValue(nextTime);
    else setModelValue(`${dateText} ${nextTime}`);
  }

  function finishCommit() {
    if (isCommitting) return;
    closeHandled = true;
    isCommitting = true;
    onCommit();
  }

  function finishCancel() {
    if (isCommitting) return;
    closeHandled = true;
    isCommitting = true;
    onCancel();
  }

  function onKeydown(event: React.KeyboardEvent) {
    if (event.key === "Enter") {
      event.preventDefault();
      finishCommit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      finishCancel();
    }
  }

  function normalizeTimePart(value: string | number, max: number): string {
    const parsed = Number(value);
    const numberValue = Math.max(0, Math.min(max, Number.isNaN(parsed) ? 0 : parsed));
    return String(numberValue).padStart(2, "0");
  }

  function setDateTimeValue(year: number, month: number, day: number, time: string) {
    const dateText = [
      String(year).padStart(4, "0"),
      String(month).padStart(2, "0"),
      String(day).padStart(2, "0"),
    ].join("-");
    if (kind === "date") setModelValue(dateText);
    else setModelValue(`${dateText} ${time}`);
  }

  function daysInMonth(year: number, month: number): number {
    return new Date(year, month, 0).getDate();
  }

  function twoDigit(value: string | number): string {
    return String(value).padStart(2, "0");
  }

  return (
    <Popover open={open} onOpenChange={setOpenValue}>
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          className={triggerClass}
          onKeyDown={(e) => {
            e.stopPropagation();
            onKeydown(e);
          }}
          onClick={(e) => {
            e.stopPropagation();
          }}
        >
          <CalendarClock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">{displayValue}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        className="w-auto gap-1.5 rounded-md p-1.5"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          onKeydown(e);
        }}
      >
        {hasDate && (
          <div className="grid grid-cols-[4.5rem_4.5rem_4.5rem] gap-1.5">
            <div className="grid h-7 min-w-0 grid-cols-[1fr_1.35rem] overflow-hidden rounded-md border border-input bg-background">
              <input
                value={dateParts.year}
                data-temporal-part="year"
                inputMode="numeric"
                className="min-w-0 bg-transparent px-1 text-center text-[13px] tabular-nums outline-none"
                onChange={(e) => updateDateFromInput("year", e)}
              />
              <div className="grid border-l">
                <button
                  type="button"
                  className="flex items-center justify-center hover:bg-muted"
                  onClick={() => stepDate("year", 1)}
                >
                  <ChevronUp className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  className="flex items-center justify-center border-t hover:bg-muted"
                  onClick={() => stepDate("year", -1)}
                >
                  <ChevronDown className="h-3 w-3" />
                </button>
              </div>
            </div>

            <div className="grid h-7 min-w-0 grid-cols-[1fr_1.35rem] overflow-hidden rounded-md border border-input bg-background">
              <input
                value={twoDigit(dateParts.month)}
                data-temporal-part="month"
                inputMode="numeric"
                className="min-w-0 bg-transparent px-1 text-center text-[13px] tabular-nums outline-none"
                onChange={(e) => updateDateFromInput("month", e)}
              />
              <div className="grid border-l">
                <button
                  type="button"
                  className="flex items-center justify-center hover:bg-muted"
                  onClick={() => stepDate("month", 1)}
                >
                  <ChevronUp className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  className="flex items-center justify-center border-t hover:bg-muted"
                  onClick={() => stepDate("month", -1)}
                >
                  <ChevronDown className="h-3 w-3" />
                </button>
              </div>
            </div>

            <div className="grid h-7 min-w-0 grid-cols-[1fr_1.35rem] overflow-hidden rounded-md border border-input bg-background">
              <input
                value={twoDigit(dateParts.day)}
                data-temporal-part="day"
                inputMode="numeric"
                className="min-w-0 bg-transparent px-1 text-center text-[13px] tabular-nums outline-none"
                onChange={(e) => updateDateFromInput("day", e)}
              />
              <div className="grid border-l">
                <button
                  type="button"
                  className="flex items-center justify-center hover:bg-muted"
                  onClick={() => stepDate("day", 1)}
                >
                  <ChevronUp className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  className="flex items-center justify-center border-t hover:bg-muted"
                  onClick={() => stepDate("day", -1)}
                >
                  <ChevronDown className="h-3 w-3" />
                </button>
              </div>
            </div>
          </div>
        )}

        {hasTime && (
          <div className="grid grid-cols-[3.5rem_0.5rem_3.5rem_0.5rem_3.5rem] items-center gap-1.5">
            <div className="grid h-7 min-w-0 grid-cols-[1fr_1.35rem] overflow-hidden rounded-md border border-input bg-background">
              <input
                value={twoDigit(timeParts.hour)}
                data-temporal-part="hour"
                inputMode="numeric"
                className="min-w-0 bg-transparent px-1 text-center text-[13px] tabular-nums outline-none"
                onChange={(e) => updateTimeFromInput("hour", e)}
              />
              <div className="grid border-l">
                <button
                  type="button"
                  className="flex items-center justify-center hover:bg-muted"
                  onClick={() => stepTime("hour", 1)}
                >
                  <ChevronUp className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  className="flex items-center justify-center border-t hover:bg-muted"
                  onClick={() => stepTime("hour", -1)}
                >
                  <ChevronDown className="h-3 w-3" />
                </button>
              </div>
            </div>
            <span className="text-center text-xs text-muted-foreground">:</span>
            <div className="grid h-7 min-w-0 grid-cols-[1fr_1.35rem] overflow-hidden rounded-md border border-input bg-background">
              <input
                value={twoDigit(timeParts.minute)}
                data-temporal-part="minute"
                inputMode="numeric"
                className="min-w-0 bg-transparent px-1 text-center text-[13px] tabular-nums outline-none"
                onChange={(e) => updateTimeFromInput("minute", e)}
              />
              <div className="grid border-l">
                <button
                  type="button"
                  className="flex items-center justify-center hover:bg-muted"
                  onClick={() => stepTime("minute", 1)}
                >
                  <ChevronUp className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  className="flex items-center justify-center border-t hover:bg-muted"
                  onClick={() => stepTime("minute", -1)}
                >
                  <ChevronDown className="h-3 w-3" />
                </button>
              </div>
            </div>
            <span className="text-center text-xs text-muted-foreground">:</span>
            <div className="grid h-7 min-w-0 grid-cols-[1fr_1.35rem] overflow-hidden rounded-md border border-input bg-background">
              <input
                value={twoDigit(timeParts.second)}
                data-temporal-part="second"
                inputMode="numeric"
                className="min-w-0 bg-transparent px-1 text-center text-[13px] tabular-nums outline-none"
                onChange={(e) => updateTimeFromInput("second", e)}
              />
              <div className="grid border-l">
                <button
                  type="button"
                  className="flex items-center justify-center hover:bg-muted"
                  onClick={() => stepTime("second", 1)}
                >
                  <ChevronUp className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  className="flex items-center justify-center border-t hover:bg-muted"
                  onClick={() => stepTime("second", -1)}
                >
                  <ChevronDown className="h-3 w-3" />
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-1">
          <button
            type="button"
            className="flex items-center rounded-sm px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-accent-foreground h-6"
            onClick={setNull}
          >
            <CircleSlash className="h-3 w-3 mr-1" />
            NULL
          </button>
          <button
            type="button"
            className="flex items-center rounded-sm px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-accent-foreground h-6"
            onClick={setNow}
          >
            Now
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
