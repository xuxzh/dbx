"use client";

import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, Maximize2, X, ZoomIn, ZoomOut } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { imagePreviewTransform, nextImagePreviewScale, imagePreviewFitScale } from "@/lib/imagePreviewViewer";

interface ImagePreviewDialogProps {
  open: boolean;
  src: string;
  title?: string;
  onOpenChange: (open: boolean) => void;
}

export function ImagePreviewDialog({
  open,
  src,
  title,
  onOpenChange,
}: ImagePreviewDialogProps) {
  const { t } = useTranslation();
  const [scale, setScale] = useState(1);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const [naturalWidth, setNaturalWidth] = useState(0);
  const [naturalHeight, setNaturalHeight] = useState(0);
  const dragStart = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);

  const hostLabel = (() => {
    try {
      const url = new URL(src);
      return url.protocol === "data:" ? "data:image" : url.host;
    } catch {
      return "";
    }
  })();

  const imageTitle = title || t("grid.imagePreview");
  const zoomLabel = `${Math.round(scale * 100)}%`;

  const imageStyle: React.CSSProperties = {
    width: naturalWidth ? `${naturalWidth}px` : "auto",
    height: naturalHeight ? `${naturalHeight}px` : "auto",
    transform: `translate(-50%, -50%) ${imagePreviewTransform({
      scale,
      offsetX,
      offsetY,
    })}`,
  };

  function resetViewer() {
    setScale(1);
    setOffsetX(0);
    setOffsetY(0);
    setImageLoaded(false);
    setImageError(false);
    setNaturalWidth(0);
    setNaturalHeight(0);
    dragStart.current = null;
  }

  function close() {
    onOpenChange(false);
  }

  function zoomIn() {
    setScale(nextImagePreviewScale(scale, "in"));
  }

  function zoomOut() {
    setScale(nextImagePreviewScale(scale, "out"));
  }

  function fitImage() {
    const fitScale = currentFitScale();
    setScale(fitScale);
    setOffsetX(0);
    setOffsetY(0);
  }

  function currentFitScale(): number {
    const stage = stageRef.current;
    if (!stage) return 1;
    return imagePreviewFitScale({
      imageWidth: naturalWidth,
      imageHeight: naturalHeight,
      viewportWidth: stage.clientWidth,
      viewportHeight: stage.clientHeight,
    });
  }

  function onImageLoad(event: React.SyntheticEvent<HTMLImageElement>) {
    const img = event.currentTarget;
    setNaturalWidth(img.naturalWidth);
    setNaturalHeight(img.naturalHeight);
    setImageLoaded(true);
    fitImage();
  }

  function onWheel(event: React.WheelEvent) {
    event.preventDefault();
    setScale(nextImagePreviewScale(scale, event.deltaY < 0 ? "in" : "out"));
  }

  function onImagePointerDown(event: React.PointerEvent) {
    if (event.button !== 0) return;
    dragStart.current = { x: event.clientX, y: event.clientY, offsetX, offsetY };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function onImagePointerMove(event: React.PointerEvent) {
    if (!dragStart.current) return;
    setOffsetX(dragStart.current.offsetX + event.clientX - dragStart.current.x);
    setOffsetY(dragStart.current.offsetY + event.clientY - dragStart.current.y);
  }

  function onImagePointerUp(event: React.PointerEvent) {
    dragStart.current = null;
    (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
  }

  function onDoubleClick() {
    setScale(scale === 1 ? 2 : 1);
    setOffsetX(0);
    setOffsetY(0);
  }

  async function openExternal() {
    try {
      const { open } = await import("@tauri-apps/plugin-shell");
      await open(src);
    } catch {
      window.open(src, "_blank", "noopener,noreferrer");
    }
  }

  useEffect(() => {
    if (open) {
      resetViewer();
    }
  }, [open, src]);

  return (
    <Dialog open={open} onOpenChange={(value) => onOpenChange(value)}>
      <DialogContent
        showCloseButton={false}
        className="image-preview-dialog h-[min(86vh,920px)] w-[min(92vw,1280px)] max-w-none gap-0 overflow-hidden rounded-xl border-white/10 bg-[#090b0f] p-0 text-white shadow-2xl"
        onEscapeKeyDown={close}
      >
        <div className="flex h-12 shrink-0 items-center gap-3 border-b border-white/10 bg-white/[0.035] px-4">
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-sm font-semibold text-white">
              {imageTitle}
            </DialogTitle>
            <div className="truncate text-[11px] text-white/45">{hostLabel || src}</div>
          </div>
          <div className="flex items-center gap-1 rounded-md border border-white/10 bg-black/20 p-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-white/75 hover:bg-white/10 hover:text-white"
              title={t("grid.zoomOut")}
              onClick={zoomOut}
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </Button>
            <div className="w-12 text-center text-[11px] tabular-nums text-white/65">
              {zoomLabel}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-white/75 hover:bg-white/10 hover:text-white"
              title={t("grid.zoomIn")}
              onClick={zoomIn}
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-white/75 hover:bg-white/10 hover:text-white"
              title={t("grid.fitImage")}
              onClick={fitImage}
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-white/75 hover:bg-white/10 hover:text-white"
              title={t("grid.openImage")}
              onClick={openExternal}
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-white/70 hover:bg-white/10 hover:text-white"
            title={t("dangerDialog.cancel")}
            onClick={close}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div
          ref={stageRef}
          className={`image-preview-stage relative min-h-0 flex-1 overflow-hidden ${
            dragStart.current ? "cursor-grabbing" : imageLoaded && !imageError ? "cursor-grab" : ""
          }`}
          onWheel={onWheel}
        >
          {!imageLoaded && !imageError && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="h-16 w-16 animate-pulse rounded-full border border-white/10 bg-white/10 shadow-[0_0_80px_rgba(255,255,255,0.12)]" />
            </div>
          )}
          {imageError && (
            <div className="absolute inset-0 flex items-center justify-center px-8 text-center text-sm text-white/55">
              {t("grid.imageLoadFailed")}
            </div>
          )}
          <img
            src={src}
            alt={imageTitle}
            draggable={false}
            decoding="async"
            referrerPolicy="no-referrer"
            className={`absolute left-1/2 top-1/2 max-w-none select-none object-contain transition-opacity duration-150 ${
              imageLoaded ? "opacity-100" : "opacity-0"
            }`}
            style={imageStyle}
            onLoad={onImageLoad}
            onError={() => setImageError(true)}
            onPointerDown={onImagePointerDown}
            onPointerMove={onImagePointerMove}
            onPointerUp={onImagePointerUp}
            onPointerCancel={onImagePointerUp}
            onDoubleClick={onDoubleClick}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
