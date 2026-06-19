"use client";

import { useState, useRef, useEffect } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

interface EnumCellEditorProps {
  value: string;
  values: string[];
  nullable?: boolean;
  cellLayout?: "grid" | "transpose";
  onUpdate: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}

export function EnumCellEditor({
  value,
  values,
  nullable = false,
  cellLayout = "grid",
  onUpdate,
  onCommit,
  onCancel,
}: EnumCellEditorProps) {
  const [open, setOpen] = useState(true);
  const triggerRef = useRef<HTMLButtonElement>(null);
  let closeHandled = false;

  const triggerClass = [
    "cell-edit-input absolute inset-0 z-10 flex items-center gap-1 border-2 border-primary bg-background py-0 text-left text-xs outline-none",
    cellLayout === "transpose" ? "px-1.5" : "px-2.5",
  ].join(" ");

  const displayValue = value || "(NULL)";

  useEffect(() => {
    triggerRef.current?.focus();
  }, []);

  function selectEnumValue(enumValue: string) {
    onUpdate(enumValue);
    finishCommit();
  }

  function finishCommit() {
    closeHandled = true;
    onCommit();
  }

  function finishCancel() {
    closeHandled = true;
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

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v && !closeHandled) finishCommit();
      }}
    >
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
          <span className="min-w-0 flex-1 truncate">{displayValue}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        className="w-auto min-w-[120px] rounded-md p-1"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          onKeydown(e);
        }}
      >
        <div className="flex flex-col gap-0.5">
          {nullable && (
            <button
              type="button"
              className={`flex items-center rounded-sm px-2 py-1 text-xs hover:bg-accent hover:text-accent-foreground ${
                value === "" ? "bg-accent text-accent-foreground" : "text-muted-foreground"
              }`}
              onClick={() => selectEnumValue("")}
            >
              (NULL)
            </button>
          )}
          {values.map((val) => (
            <button
              key={val}
              type="button"
              className={`flex items-center rounded-sm px-2 py-1 text-xs hover:bg-accent hover:text-accent-foreground ${
                value === val ? "bg-accent text-accent-foreground" : ""
              }`}
              onClick={() => selectEnumValue(val)}
            >
              {val}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
