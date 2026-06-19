import { Minus, Square, Copy, X } from "lucide-react";

interface WindowControlsProps {
  isMaximized: boolean;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
}

export function WindowControls({ isMaximized, onMinimize, onToggleMaximize, onClose }: WindowControlsProps) {
  return (
    <div className="flex items-stretch -mr-2 ml-1">
      <button
        className="inline-flex items-center justify-center w-11.5 h-10 hover:bg-foreground/10 transition-colors"
        onClick={onMinimize}
      >
        <Minus className="h-4 w-4" />
      </button>
      <button
        className="inline-flex items-center justify-center w-11.5 h-10 hover:bg-foreground/10 transition-colors"
        onClick={onToggleMaximize}
      >
        {isMaximized ? <Copy className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
      </button>
      <button
        className="inline-flex items-center justify-center w-11.5 h-10 hover:bg-red-500 hover:text-white transition-colors"
        onClick={onClose}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
