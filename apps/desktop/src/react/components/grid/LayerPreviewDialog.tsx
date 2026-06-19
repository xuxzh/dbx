"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Camera, Loader2, Map, Maximize2, Minimize2, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import "leaflet/dist/leaflet.css";

interface BasemapOption {
  id: string;
  label: string;
  url: string;
  attribution: string;
}

const basemaps: BasemapOption[] = [
  {
    id: "osm",
    label: "OpenStreetMap",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  {
    id: "satellite",
    label: "Satellite",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "&copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community",
  },
  {
    id: "street",
    label: "World Street",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
    attribution: "&copy; Esri, HERE, Garmin, and the GIS User Community",
  },
  {
    id: "topo",
    label: "World Topo",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
    attribution: "&copy; Esri, HERE, FAO, NOAA, and the GIS User Community",
  },
  {
    id: "light",
    label: "Light",
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
  },
];

interface LayerPreviewDialogProps {
  open: boolean;
  title?: string;
  geojson: string;
  onOpenChange: (open: boolean) => void;
}

export function LayerPreviewDialog({
  open,
  title,
  geojson,
  onOpenChange,
}: LayerPreviewDialogProps) {
  const { t } = useTranslation();
  const mapContainer = useRef<HTMLDivElement>(null);
  const [mapError, setMapError] = useState("");
  const [isExporting, setIsExporting] = useState(false);

  // Resize / maximise
  const [customSize, setCustomSize] = useState<{ w: number; h: number } | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const resizeEdge = useRef<"e" | "s" | "se" | null>(null);
  const resizeStart = useRef<{ x: number; y: number; w: number; h: number } | null>(null);

  // Leaflet refs
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const geoLayerRef = useRef<import("leaflet").GeoJSON | null>(null);
  const labelLayerRef = useRef<import("leaflet").LayerGroup | null>(null);
  const tileLayerRef = useRef<import("leaflet").TileLayer | null>(null);
  const mapResizeObserverRef = useRef<ResizeObserver | null>(null);
  const geojsonDataRef = useRef<any>(null);

  const [selectedBasemap, setSelectedBasemap] = useState(basemaps[0]);
  const [selectedBasemapId, setSelectedBasemapId] = useState(basemaps[0].id);
  const dialogTitle = title || t("grid.layerPreview");

  // Label property
  const [labelProperties, setLabelProperties] = useState<string[]>([]);
  const [labelProperty, setLabelProperty] = useState("");

  const contentStyle: React.CSSProperties = isMaximized
    ? { width: "100vw", height: "100vh", maxWidth: "none", maxHeight: "none" }
    : customSize
      ? { width: `${customSize.value.w}px`, height: `${customSize.value.h}px`, maxWidth: "none", maxHeight: "none" }
      : {};

  function toggleMaximize() {
    setIsMaximized(!isMaximized);
  }

  function onResizePointerDown(event: React.PointerEvent, edge: "e" | "s" | "se") {
    const el = (event.currentTarget as HTMLElement).closest("[data-slot='dialog-content']") as HTMLElement;
    if (!el) return;
    resizeEdge.current = edge;
    const rect = el.getBoundingClientRect();
    resizeStart.current = {
      x: event.clientX,
      y: event.clientY,
      w: rect.width,
      h: rect.height,
    };
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function onResizePointerMove(event: React.PointerEvent) {
    if (!resizeStart.current || !resizeEdge.current) return;
    const dx = event.clientX - resizeStart.current.x;
    const dy = event.clientY - resizeStart.current.y;
    let w = resizeStart.current.w;
    let h = resizeStart.current.h;
    if (resizeEdge.current === "e" || resizeEdge.current === "se") w += dx;
    if (resizeEdge.current === "s" || resizeEdge.current === "se") h += dy;
    w = Math.max(640, Math.min(w, window.innerWidth - 32));
    h = Math.max(400, Math.min(h, window.innerHeight - 32));
    setCustomSize({ w, h });
  }

  function onResizePointerUp() {
    resizeEdge.current = null;
    resizeStart.current = null;
  }

  function parseLabelProperties(data: any) {
    const keys = new Set<string>();
    const features = data.features || (data.type === "Feature" ? [data] : []);
    for (const f of features) {
      if (f.properties) Object.keys(f.properties).forEach((k) => keys.add(k));
      if (keys.size >= 20) break;
    }
    setLabelProperties(Array.from(keys).sort());
    setLabelProperty("");
  }

  function escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function getLabelCoords(geom: any): [number, number] | null {
    if (!geom) return null;
    if (geom.type === "Point") return [geom.coordinates[1], geom.coordinates[0]];
    if (geom.type === "MultiPoint") return [geom.coordinates[0][1], geom.coordinates[0][0]];
    const flat = geom.coordinates?.flat(Infinity) ?? [];
    const pts: [number, number][] = [];
    for (let i = 0; i + 1 < flat.length; i += 2) {
      if (typeof flat[i] === "number" && typeof flat[i + 1] === "number") {
        pts.push([flat[i], flat[i + 1]]);
      }
    }
    if (pts.length === 0) return null;
    const avgLng = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const avgLat = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    return [avgLat, avgLng];
  }

  function updateLabels() {
    const map = mapRef.current;
    const geojsonData = geojsonDataRef.current;
    const L = leafletRef.current;
    if (!map || !geojsonData || !L) return;
    if (labelLayerRef.current) {
      map.removeLayer(labelLayerRef.current);
      labelLayerRef.current = null;
    }
    const prop = labelProperty;
    if (!prop) return;
    labelLayerRef.current = L.layerGroup().addTo(map);
    const features = geojsonData.features || [];
    for (const f of features) {
      const value = f.properties?.[prop];
      if (value == null) continue;
      const coords = getLabelCoords(f.geometry);
      if (!coords) continue;
      const icon = L.divIcon({
        className: "layer-preview-label",
        html: `<span>${escapeHtml(String(value))}</span>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      });
      L.marker(coords, { icon, interactive: false }).addTo(labelLayerRef.current);
    }
  }

  function onLabelPropertyChange() {
    updateLabels();
  }

  async function loadLeaflet() {
    if (!leafletRef.current) {
      const mod = await import("leaflet");
      leafletRef.current = mod.default as unknown as typeof import("leaflet");
    }
    return leafletRef.current;
  }

  function cleanupMap() {
    mapResizeObserverRef.current?.disconnect();
    mapResizeObserverRef.current = null;
    labelLayerRef.current = null;
    geoLayerRef.current = null;
    tileLayerRef.current = null;
    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }
    geojsonDataRef.current = null;
    setLabelProperty("");
  }

  async function initMap() {
    const container = mapContainer.current;
    if (!container) return;
    cleanupMap();
    setMapError("");

    const placeholder = container.querySelector("[data-map-placeholder]");
    if (placeholder) placeholder.remove();

    try {
      const L = await loadLeaflet();
      mapRef.current = L.map(container, {
        zoomControl: true,
        attributionControl: true,
        center: [35, 110],
        zoom: 4,
      });

      tileLayerRef.current = L.tileLayer(selectedBasemap.url, {
        attribution: selectedBasemap.attribution,
        maxZoom: 19,
        crossOrigin: true,
      }).addTo(mapRef.current);

      addGeoJsonToMap();
      parseLabelProperties(geojsonDataRef.current);

      mapResizeObserverRef.current = new ResizeObserver(() => {
        mapRef.current?.invalidateSize();
      });
      mapResizeObserverRef.current.observe(container);
      setTimeout(() => mapRef.current?.invalidateSize(), 500);
    } catch (err) {
      setMapError(String(err));
    }
  }

  function addGeoJsonToMap() {
    const map = mapRef.current;
    const L = leafletRef.current;
    if (!map || geoLayerRef.current || !L) return;
    try {
      geojsonDataRef.current = JSON.parse(geojson);
    } catch {
      return;
    }
    let data = geojsonDataRef.current;
    if (data.type === "Feature") data = { type: "FeatureCollection", features: [data] };
    else if (data.type && data.coordinates) {
      data = { type: "FeatureCollection", features: [{ type: "Feature", geometry: data, properties: {} }] };
    }
    if (!data.features?.length) return;

    const popupContent = (feature: any): string => {
      const rows: string[] = [];
      if (feature.properties) {
        for (const [k, v] of Object.entries(feature.properties)) {
          rows.push(`<tr><td class="pr-2 font-medium">${escapeHtml(k)}</td><td>${escapeHtml(String(v ?? ""))}</td></tr>`);
        }
      }
      const geom = feature.geometry?.type ?? "?";
      return `<div class="text-xs leading-relaxed"><div class="mb-1 font-semibold text-[#ff6600]">${geom}</div><table>${rows.join("")}</table></div>`;
    };

    const pointToCircle = (_feature: any, latlng: any) => {
      return L.circleMarker(latlng, {
        radius: 7,
        color: "#ff6600",
        weight: 3,
        opacity: 0.95,
        fillColor: "#ff6600",
        fillOpacity: 0.5,
      });
    };

    geoLayerRef.current = L.geoJSON(data, {
      style: {
        color: "#ff6600",
        weight: 3,
        opacity: 0.95,
        fillColor: "#ff6600",
        fillOpacity: 0.25,
      },
      pointToLayer: pointToCircle,
      onEachFeature: (feature, layer) => {
        layer.bindPopup(popupContent(feature));
      },
    }).addTo(map);

    const bounds = geoLayerRef.current.getBounds();
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [30, 30], maxZoom: 18 });
    }
  }

  function switchBasemap(basemap: BasemapOption) {
    const map = mapRef.current;
    const L = leafletRef.current;
    if (!map || !L) return;
    setSelectedBasemap(basemap);
    setSelectedBasemapId(basemap.id);
    if (tileLayerRef.current) map.removeLayer(tileLayerRef.current);
    tileLayerRef.current = L.tileLayer(basemap.url, {
      attribution: basemap.attribution,
      maxZoom: 19,
      crossOrigin: true,
    }).addTo(map);
  }

  function close() {
    onOpenChange(false);
  }

  async function saveAsImage() {
    if (!mapRef.current || !mapContainer.current || isExporting) return;
    setIsExporting(true);
    try {
      const defaultName = `map-${Date.now()}.png`;
      const domtoimage = (await import("dom-to-image-more")).default;
      const dataUrl = await domtoimage.toPng(mapContainer.current, {
        quality: 1,
        width: mapContainer.current.offsetWidth,
        height: mapContainer.current.offsetHeight,
      });
      const blob = await (await fetch(dataUrl)).blob();
      if (!blob) return;

      try {
        const { save } = await import("@tauri-apps/plugin-dialog");
        const { writeFile } = await import("@tauri-apps/plugin-fs");
        const path = await save({
          defaultPath: defaultName,
          filters: [{ name: "PNG", extensions: ["png"] }],
        });
        if (!path) return;
        await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
      } catch {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = defaultName;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error("[LayerPreview] saveAsImage error:", err);
    } finally {
      setIsExporting(false);
    }
  }

  useEffect(() => {
    if (open) {
      setTimeout(() => {
        if (mapContainer.current) initMap();
      }, 100);
    } else {
      cleanupMap();
    }
  }, [open]);

  useEffect(() => {
    return () => cleanupMap();
  }, []);

  return (
    <Dialog open={open} onOpenChange={(value) => onOpenChange(value)}>
      <DialogContent
        showCloseButton={false}
        style={contentStyle}
        className="layer-preview-dialog flex w-[96vw] max-w-[1800px] h-[88vh] max-h-[960px] min-w-[640px] min-h-[400px] flex-col gap-0 overflow-hidden rounded-xl border p-0 shadow-2xl"
        onEscapeKeyDown={close}
      >
        {/* Header */}
        <div className="flex h-12 shrink-0 items-center gap-2 border-b bg-muted/20 px-3">
          <div className="flex min-w-0 shrink-0 items-center gap-2">
            <Map className="h-4 w-4 shrink-0 text-muted-foreground" />
            <DialogTitle className="truncate text-sm font-semibold">{dialogTitle}</DialogTitle>
          </div>

          {/* Label property selector */}
          {labelProperties.length > 0 && (
            <select
              value={labelProperty}
              className="h-6 shrink-0 rounded border bg-background px-1.5 text-[11px] outline-none"
              onChange={onLabelPropertyChange}
            >
              <option value="">— 标签 —</option>
              {labelProperties.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          )}

          <div className="flex flex-1" />

          {/* Basemap selector */}
          <select
            value={selectedBasemapId}
            className="h-6 shrink-0 rounded border bg-background px-1.5 text-[11px] outline-none"
            onChange={(e) => {
              const bm = basemaps.find((b) => b.id === e.target.value);
              if (bm) switchBasemap(bm);
            }}
          >
            {basemaps.map((bm) => (
              <option key={bm.id} value={bm.id}>
                {bm.label}
              </option>
            ))}
          </select>

          {/* Save as image */}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            title="导出图片"
            disabled={isExporting}
            onClick={saveAsImage}
          >
            {isExporting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Camera className="h-3.5 w-3.5" />
            )}
          </Button>

          {/* Maximise */}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            title={isMaximized ? "还原" : "最大化"}
            onClick={toggleMaximize}
          >
            {isMaximized ? (
              <Minimize2 className="h-3.5 w-3.5" />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" />
            )}
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            title={t("dangerDialog.cancel")}
            onClick={close}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Map */}
        <div ref={mapContainer} className="relative w-full flex-1" style={{ minHeight: 200 }} data-map-container>
          <div
            className="absolute inset-0 z-10 flex items-center justify-center text-xs text-muted-foreground pointer-events-none"
            data-map-placeholder
          >
            Loading map...
          </div>
        </div>
        {mapError && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80 p-4 text-sm text-destructive">
            {mapError}
          </div>
        )}

        {/* Resize handles */}
        <div
          className="absolute bottom-0 right-0 z-50 h-5 w-5 cursor-se-resize"
          onPointerDown={(e) => onResizePointerDown(e, "se")}
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerUp}
          onPointerCancel={onResizePointerUp}
        >
          <div
            className="absolute bottom-0.5 right-0.5 h-2.5 w-2.5"
            style={{ borderRight: "2px solid", borderBottom: "2px solid", opacity: 0.3 }}
          />
        </div>
        <div
          className="absolute bottom-0 left-2 right-6 z-50 h-2 cursor-s-resize opacity-0 hover:opacity-25"
          onPointerDown={(e) => onResizePointerDown(e, "s")}
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerUp}
          onPointerCancel={onResizePointerUp}
        />
        <div
          className="absolute right-0 top-2 bottom-6 z-50 w-2 cursor-e-resize opacity-0 hover:opacity-25"
          onPointerDown={(e) => onResizePointerDown(e, "e")}
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerUp}
          onPointerCancel={onResizePointerUp}
        />
      </DialogContent>
    </Dialog>
  );
}
