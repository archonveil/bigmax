"use client";

/**
 * `<BranchLocationPicker>` — advanced map UI для ввода координат филиала
 * на admin-форме. Возможности:
 *   - Click по карте → ставим маркер, отдаём lat/lng в parent.
 *   - Drag маркера → real-time обновление координат.
 *   - "Найти меня" → browser geolocation API.
 *   - Поиск адреса через Nominatim (OpenStreetMap geocoder, free tier).
 *     Debounced 600ms; результаты в выпадающем списке; click → центрирует
 *     карту + ставит маркер.
 *   - Compact display текущих координат + clear-кнопка.
 *
 * Default export — для `next/dynamic({ ssr: false })`. Leaflet тянет
 * `window`, так что SSR ему противопоказан.
 */

import L from "leaflet";
import { Loader2, LocateFixed, Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  LayersControl,
  MapContainer,
  Marker,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDebounce } from "@/lib/use-debounce";
import { cn } from "@/lib/utils";

import "leaflet/dist/leaflet.css";

interface Props {
  latitude: number | null;
  longitude: number | null;
  onChange: (lat: number | null, lng: number | null) => void;
  disabled?: boolean;
}

const TASHKENT_CENTER: [number, number] = [41.3111, 69.2797];
const DEFAULT_ZOOM = 12;
const MARKER_ZOOM = 16;

interface NominatimResult {
  place_id: number;
  lat: string;
  lon: string;
  display_name: string;
}

function buildPin(): L.DivIcon {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="36" height="36"
         fill="hsl(var(--primary))" stroke="white" stroke-width="1.5">
      <path d="M12 2C7.6 2 4 5.6 4 10c0 5.5 7 11.5 7.3 11.8a1 1 0 0 0 1.4 0C13 21.5 20 15.5 20 10c0-4.4-3.6-8-8-8Zm0 11a3 3 0 1 1 0-6 3 3 0 0 1 0 6Z"/>
    </svg>`;
  return L.divIcon({
    html: svg,
    className: "",
    iconSize: [36, 36],
    iconAnchor: [18, 36],
  });
}

function ClickHandler({
  onPick,
  disabled,
}: {
  onPick: (lat: number, lng: number) => void;
  disabled: boolean;
}): null {
  useMapEvents({
    click(e) {
      if (disabled) return;
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

/**
 * Hybrid base layer — satellite imagery + transparent labels overlay.
 * Esri's `Reference/World_Boundaries_and_Places` рендерит только подписи
 * (страны / города / районы / улицы), без подложки — кладём поверх
 * `World_Imagery` чтобы admin видел фото-карту с поясняющими названиями.
 */
function HybridSatellite(): JSX.Element {
  return (
    <>
      <TileLayer
        attribution="Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics"
        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        maxZoom={19}
      />
      <TileLayer
        attribution="Labels &copy; Esri"
        url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
        maxZoom={19}
      />
    </>
  );
}

function FlyTo({ position, zoom }: { position: [number, number] | null; zoom: number }): null {
  const map = useMap();
  useEffect(() => {
    if (!position) return;
    map.flyTo(position, zoom, { duration: 0.6 });
  }, [position, zoom, map]);
  return null;
}

export default function BranchLocationPicker({
  latitude,
  longitude,
  onChange,
  disabled = false,
}: Props): JSX.Element {
  const t = useTranslations("admin.branches.form.locationPicker");
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<NominatimResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const debouncedSearch = useDebounce(search, 600);
  const lastQueryRef = useRef("");

  const hasCoords = latitude !== null && longitude !== null;
  const markerPos: [number, number] | null = hasCoords ? [latitude, longitude] : null;
  const center: [number, number] = markerPos ?? TASHKENT_CENTER;
  const icon = useMemo(buildPin, []);

  // Nominatim search (OpenStreetMap geocoder). Free tier — debounced & only
  // when query length >= 3, чтобы не спамить.
  useEffect(() => {
    const q = debouncedSearch.trim();
    if (q === lastQueryRef.current) return;
    lastQueryRef.current = q;
    if (q.length < 3) {
      setResults([]);
      setSearching(false);
      return;
    }
    const ctrl = new AbortController();
    setSearching(true);
    fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5&addressdetails=0`,
      { signal: ctrl.signal, headers: { "Accept-Language": "ru,en;q=0.8" } },
    )
      .then((r) => r.json() as Promise<NominatimResult[]>)
      .then((data) => {
        setResults(Array.isArray(data) ? data : []);
        setShowResults(true);
      })
      .catch(() => {
        // ignore aborted / network errors silently
      })
      .finally(() => setSearching(false));
    return () => ctrl.abort();
  }, [debouncedSearch]);

  const onMapClick = (lat: number, lng: number): void => {
    onChange(round6(lat), round6(lng));
  };

  const onMarkerDragEnd = (e: L.DragEndEvent): void => {
    const ll = e.target.getLatLng();
    onChange(round6(ll.lat), round6(ll.lng));
  };

  const onLocateMe = (): void => {
    if (typeof window === "undefined" || !navigator.geolocation || disabled) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onChange(round6(pos.coords.latitude), round6(pos.coords.longitude));
        setLocating(false);
      },
      () => {
        toast.error(t("locateError"));
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const onClear = (): void => {
    onChange(null, null);
    setSearch("");
    setResults([]);
  };

  const onSelectResult = (r: NominatimResult): void => {
    onChange(round6(Number.parseFloat(r.lat)), round6(Number.parseFloat(r.lon)));
    setSearch(r.display_name);
    setShowResults(false);
  };

  return (
    <div className="space-y-2" data-testid="branch-location-picker">
      {/* Search + locate-me row */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onFocus={() => setShowResults(results.length > 0)}
            onBlur={() => window.setTimeout(() => setShowResults(false), 150)}
            placeholder={t("searchPlaceholder")}
            disabled={disabled}
            data-testid="branch-location-search"
            className="pl-8"
          />
          {searching ? (
            <Loader2
              aria-hidden
              className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground"
            />
          ) : null}
          {showResults && results.length > 0 ? (
            <ul
              className="absolute left-0 right-0 top-full z-[1000] mt-1 max-h-60 overflow-y-auto rounded-md border bg-popover shadow-md"
              data-testid="branch-location-results"
            >
              {results.map((r) => (
                <li key={r.place_id}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => onSelectResult(r)}
                    className="block w-full truncate px-3 py-2 text-left text-xs hover:bg-muted"
                  >
                    {r.display_name}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={onLocateMe}
          disabled={disabled || locating}
          aria-label={t("locateMe")}
          title={t("locateMe")}
          data-testid="branch-location-locate-me"
        >
          {locating ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <LocateFixed className="h-4 w-4" aria-hidden />
          )}
        </Button>
      </div>

      {/* Map */}
      <div
        className={cn(
          "overflow-hidden rounded-md border",
          disabled && "pointer-events-none opacity-60",
        )}
      >
        <MapContainer
          center={center}
          zoom={hasCoords ? MARKER_ZOOM : DEFAULT_ZOOM}
          scrollWheelZoom
          className="h-[320px] w-full"
          aria-label={t("mapAria")}
        >
          {/*
            Layer switcher. Default — "Esri Streets" (commercial HERE+TomTom
            data, для CIS обычно свежее community-driven OSM). Альтернативы:
              - OSM Detailed: house numbers + POI labels (z17+).
              - Voyager: clean modern style.
              - Satellite: Esri World Imagery (фото зданий).
              - Hybrid: satellite + transparent labels overlay (Esri Reference).
          */}
          <LayersControl position="topright">
            <LayersControl.BaseLayer checked name={t("layers.esriStreets")}>
              <TileLayer
                attribution="Tiles &copy; Esri &mdash; Source: HERE, Garmin, &copy; OpenStreetMap contributors"
                url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}"
                maxZoom={19}
              />
            </LayersControl.BaseLayer>
            <LayersControl.BaseLayer name={t("layers.detailed")}>
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
                maxZoom={19}
              />
            </LayersControl.BaseLayer>
            <LayersControl.BaseLayer name={t("layers.streets")}>
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
                subdomains={["a", "b", "c", "d"]}
                maxZoom={20}
              />
            </LayersControl.BaseLayer>
            <LayersControl.BaseLayer name={t("layers.satellite")}>
              <TileLayer
                attribution="Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics"
                url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                maxZoom={19}
              />
            </LayersControl.BaseLayer>
            <LayersControl.BaseLayer name={t("layers.hybrid")}>
              <HybridSatellite />
            </LayersControl.BaseLayer>
          </LayersControl>
          <FlyTo position={markerPos} zoom={MARKER_ZOOM} />
          <ClickHandler onPick={onMapClick} disabled={disabled} />
          {markerPos ? (
            <Marker
              position={markerPos}
              icon={icon}
              draggable={!disabled}
              eventHandlers={{ dragend: onMarkerDragEnd }}
            />
          ) : null}
        </MapContainer>
      </div>

      {/* Coords readout + hint */}
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        {hasCoords ? (
          <span className="font-mono" data-testid="branch-location-readout">
            {latitude.toFixed(6)}, {longitude.toFixed(6)}
          </span>
        ) : (
          <span>{t("hint")}</span>
        )}
        {hasCoords ? (
          <button
            type="button"
            onClick={onClear}
            disabled={disabled}
            data-testid="branch-location-clear"
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] hover:bg-muted disabled:opacity-50"
          >
            <X className="h-3 w-3" aria-hidden />
            {t("clear")}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
