"use client";

/**
 * `<YandexLocationPicker>` — карта-пикер на Yandex Maps JS API v3 для
 * админ-формы филиалов.
 *
 * UX (map-first layout):
 *   - Поверх карты — floating-карточки: поиск (top-left), слои (top-right),
 *     "Найти меня" (bottom-right). Стандартный Google/Yandex maps look.
 *   - Под картой — карточка с разрешённым адресом (reverse-geocode через
 *     Nominatim) + координаты + кнопка copy + clear.
 *   - Над картой — chips быстрого перехода по крупным городам Узбекистана
 *     (Ташкент / Самарканд / Бухара / Наманган / Андижан / Фергана).
 *   - Click → ставим pin. Drag pin → real-time onChange. Locate-me →
 *     browser geolocation. Search через Nominatim (debounced).
 *   - Layer toggle: схема / гибрид / спутник.
 *
 * Без `NEXT_PUBLIC_YANDEX_MAPS_API_KEY` рендерим fallback-сообщение —
 * caller (`branch-form.tsx`) подменяет на Leaflet picker.
 *
 * Default export для `next/dynamic({ ssr: false })`.
 */

import {
  Check,
  Copy,
  Layers,
  Loader2,
  LocateFixed,
  Map as MapIcon,
  MapPin,
  Satellite,
  Search,
  X,
} from "lucide-react";
import Script from "next/script";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDebounce } from "@/lib/use-debounce";
import { cn } from "@/lib/utils";

interface Props {
  latitude: number | null;
  longitude: number | null;
  onChange: (lat: number | null, lng: number | null) => void;
  disabled?: boolean;
}

const TASHKENT_CENTER: [number, number] = [69.2797, 41.3111]; // [lng, lat] для Yandex
const DEFAULT_ZOOM = 12;
const MARKER_ZOOM = 16;

type LayerKind = "scheme" | "hybrid" | "satellite";

interface NominatimResult {
  place_id: number;
  lat: string;
  lon: string;
  display_name: string;
}

interface NominatimReverse {
  display_name?: string;
  error?: string;
}

type CityKey = "tashkent" | "samarkand" | "bukhara" | "namangan" | "andijan" | "fergana";

interface QuickCity {
  key: CityKey;
  coords: [number, number]; // [lng, lat]
  zoom: number;
}

const QUICK_CITIES: readonly QuickCity[] = [
  { key: "tashkent", coords: [69.2797, 41.3111], zoom: 11 },
  { key: "samarkand", coords: [66.975, 39.6542], zoom: 12 },
  { key: "bukhara", coords: [64.425, 39.7681], zoom: 12 },
  { key: "namangan", coords: [71.6726, 40.9983], zoom: 12 },
  { key: "andijan", coords: [72.3442, 40.7821], zoom: 12 },
  { key: "fergana", coords: [71.7864, 40.3842], zoom: 12 },
];

declare global {
  interface Window {
    ymaps3?: {
      ready: Promise<void>;
      YMap: new (...args: unknown[]) => YMapInstance;
      YMapDefaultSchemeLayer: new (opts: { source?: LayerKind }) => unknown;
      YMapDefaultFeaturesLayer: new (...args: unknown[]) => unknown;
      YMapMarker: new (...args: unknown[]) => YMapMarkerInstance;
      YMapListener: new (opts: {
        layer?: string;
        onClick?: (object: unknown, event: { coordinates: [number, number] }) => void;
      }) => unknown;
    };
  }
}

interface YMapInstance {
  addChild: (child: unknown) => unknown;
  removeChild: (child: unknown) => unknown;
  setLocation: (loc: { center?: [number, number]; zoom?: number; duration?: number }) => void;
  destroy: () => void;
}

interface YMapMarkerInstance {
  update: (props: { coordinates: [number, number] }) => void;
}

export default function YandexLocationPicker({
  latitude,
  longitude,
  onChange,
  disabled = false,
}: Props): JSX.Element {
  const t = useTranslations("admin.branches.form.locationPicker");
  const apiKey = process.env["NEXT_PUBLIC_YANDEX_MAPS_API_KEY"];
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<YMapInstance | null>(null);
  const markerRef = useRef<YMapMarkerInstance | null>(null);
  const schemeLayerRef = useRef<unknown>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [scriptReady, setScriptReady] = useState(
    typeof window !== "undefined" && Boolean(window.ymaps3),
  );
  const [layer, setLayer] = useState<LayerKind>("scheme");
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<NominatimResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [locating, setLocating] = useState(false);
  const [resolvedAddress, setResolvedAddress] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [copied, setCopied] = useState(false);
  const debouncedSearch = useDebounce(search, 600);
  const lastQueryRef = useRef("");

  const hasCoords = latitude !== null && longitude !== null;

  // ----- Init map once script + container are ready -----
  useEffect(() => {
    if (!scriptReady || !containerRef.current) return;
    let cancelled = false;
    const init = async (): Promise<void> => {
      const ymaps3 = window.ymaps3;
      if (!ymaps3) return;
      await ymaps3.ready;
      if (cancelled || !containerRef.current) return;

      const map = new ymaps3.YMap(containerRef.current, {
        location: {
          center: hasCoords ? [longitude, latitude] : TASHKENT_CENTER,
          zoom: hasCoords ? MARKER_ZOOM : DEFAULT_ZOOM,
        },
      });

      const schemeLayer = new ymaps3.YMapDefaultSchemeLayer({ source: layer });
      schemeLayerRef.current = schemeLayer;
      map.addChild(schemeLayer);
      map.addChild(new ymaps3.YMapDefaultFeaturesLayer());

      // Click listener — set marker at clicked spot.
      map.addChild(
        new ymaps3.YMapListener({
          onClick: (_, event) => {
            if (disabled) return;
            const [lng, lat] = event.coordinates;
            onChangeRef.current(round6(lat), round6(lng));
          },
        }),
      );

      mapRef.current = map;

      // Initial marker if coords already set.
      if (hasCoords && latitude !== null && longitude !== null) {
        const marker = new ymaps3.YMapMarker(
          {
            coordinates: [longitude, latitude],
            draggable: !disabled,
            onDragEnd: (coords: [number, number]) => {
              onChangeRef.current(round6(coords[1]), round6(coords[0]));
            },
          },
          buildPinElement(),
        );
        map.addChild(marker);
        markerRef.current = marker;
      }
    };
    void init();
    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.destroy();
        mapRef.current = null;
        markerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scriptReady]);

  // ----- Sync marker / center when lat/lng change externally -----
  useEffect(() => {
    if (!mapRef.current || !window.ymaps3) return;
    const map = mapRef.current;
    if (latitude !== null && longitude !== null) {
      // Place / move marker.
      if (markerRef.current) {
        markerRef.current.update({ coordinates: [longitude, latitude] });
      } else {
        const marker = new window.ymaps3.YMapMarker(
          {
            coordinates: [longitude, latitude],
            draggable: !disabled,
            onDragEnd: (coords: [number, number]) => {
              onChangeRef.current(round6(coords[1]), round6(coords[0]));
            },
          },
          buildPinElement(),
        );
        map.addChild(marker);
        markerRef.current = marker;
      }
      map.setLocation({
        center: [longitude, latitude],
        zoom: MARKER_ZOOM,
        duration: 600,
      });
    } else if (markerRef.current) {
      // Coords cleared — remove marker.
      map.removeChild(markerRef.current);
      markerRef.current = null;
    }
  }, [latitude, longitude, disabled]);

  // ----- Layer toggle -----
  useEffect(() => {
    if (!mapRef.current || !window.ymaps3 || !schemeLayerRef.current) return;
    const map = mapRef.current;
    map.removeChild(schemeLayerRef.current);
    const next = new window.ymaps3.YMapDefaultSchemeLayer({ source: layer });
    schemeLayerRef.current = next;
    map.addChild(next);
  }, [layer]);

  // ----- Address search via Nominatim (forward) -----
  useEffect(() => {
    const q = debouncedSearch.trim();
    if (q === lastQueryRef.current) return;
    lastQueryRef.current = q;
    if (q.length < 3) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    const ctrl = new AbortController();
    setSearching(true);
    fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5`,
      { signal: ctrl.signal, headers: { "Accept-Language": "ru,en;q=0.8" } },
    )
      .then((r) => r.json() as Promise<NominatimResult[]>)
      .then((data) => {
        setSearchResults(Array.isArray(data) ? data : []);
        setShowResults(true);
      })
      .catch(() => {
        /* aborted / network error: ignore */
      })
      .finally(() => setSearching(false));
    return () => ctrl.abort();
  }, [debouncedSearch]);

  // ----- Reverse geocode → human-readable address (debounced) -----
  useEffect(() => {
    if (latitude === null || longitude === null) {
      setResolvedAddress(null);
      setResolving(false);
      return;
    }
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => {
      setResolving(true);
      fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`,
        { signal: ctrl.signal, headers: { "Accept-Language": "ru,en;q=0.8" } },
      )
        .then((r) => r.json() as Promise<NominatimReverse>)
        .then((data) => {
          setResolvedAddress(typeof data.display_name === "string" ? data.display_name : null);
        })
        .catch(() => {
          /* aborted / network error: keep prev */
        })
        .finally(() => setResolving(false));
    }, 600);
    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [latitude, longitude]);

  const flyTo = (coords: [number, number], zoom: number): void => {
    if (mapRef.current) {
      mapRef.current.setLocation({ center: coords, zoom, duration: 600 });
    }
  };

  const onCitySelect = (city: QuickCity): void => {
    flyTo(city.coords, city.zoom);
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
    setSearchResults([]);
    setResolvedAddress(null);
  };

  const onSelectResult = (r: NominatimResult): void => {
    onChange(round6(Number.parseFloat(r.lat)), round6(Number.parseFloat(r.lon)));
    setSearch(r.display_name);
    setShowResults(false);
  };

  const onCopyCoords = async (): Promise<void> => {
    if (latitude === null || longitude === null) return;
    const text = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(text);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(t("copyCoordsError"));
    }
  };

  // ---------------------------------------------------------------------------
  // Missing API key — caller should fall back to Leaflet via branch-form.
  // ---------------------------------------------------------------------------
  if (!apiKey) {
    return (
      <div
        className="flex h-[320px] flex-col items-center justify-center gap-2 rounded-md border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground"
        data-testid="yandex-picker-missing-key"
      >
        <p className="font-medium text-foreground">{t("yandexMissingKey")}</p>
        <p className="max-w-md text-xs">{t("yandexMissingKeyHint")}</p>
        <code className="rounded bg-background px-2 py-1 font-mono text-[11px]">
          NEXT_PUBLIC_YANDEX_MAPS_API_KEY
        </code>
      </div>
    );
  }

  const layerOptions = [
    { kind: "scheme" as const, Icon: MapIcon, label: t("yandexLayers.scheme") },
    { kind: "hybrid" as const, Icon: Layers, label: t("yandexLayers.hybrid") },
    { kind: "satellite" as const, Icon: Satellite, label: t("yandexLayers.satellite") },
  ];

  return (
    <>
      <Script
        src={`https://api-maps.yandex.ru/v3/?apikey=${apiKey}&lang=ru_RU`}
        strategy="lazyOnload"
        onLoad={() => setScriptReady(true)}
        onReady={() => setScriptReady(true)}
        data-testid="yandex-maps-script"
      />
      <div className="space-y-3" data-testid="yandex-location-picker">
        {/* --- Quick city jump chips ------------------------------------- */}
        <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
          <span className="shrink-0 text-[11px] uppercase tracking-wide text-muted-foreground">
            {t("quickCitiesLabel")}
          </span>
          {QUICK_CITIES.map((city) => (
            <button
              key={city.key}
              type="button"
              onClick={() => onCitySelect(city)}
              disabled={disabled || !scriptReady}
              data-testid={`yandex-quick-city-${city.key}`}
              className={cn(
                "shrink-0 rounded-full border border-input bg-background px-3 py-1 text-xs",
                "transition-colors hover:bg-muted disabled:opacity-50",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            >
              {t(`cities.${city.key}`)}
            </button>
          ))}
        </div>

        {/* --- Map with floating overlays -------------------------------- */}
        <div
          className={cn(
            "relative h-[460px] overflow-hidden rounded-lg border bg-muted/30",
            disabled && "pointer-events-none opacity-60",
          )}
        >
          <div
            ref={containerRef}
            className="absolute inset-0"
            aria-label={t("mapAria")}
            role="application"
          />

          {/* Loading overlay until Yandex script is ready */}
          {!scriptReady ? (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-muted/40 backdrop-blur-sm">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
            </div>
          ) : null}

          {/* --- Top-left: search box ----------------------------------- */}
          <div className="pointer-events-none absolute inset-x-3 top-3 z-10 sm:right-auto sm:w-[360px]">
            <div className="pointer-events-auto overflow-hidden rounded-lg bg-background shadow-md ring-1 ring-black/5">
              <div className="relative">
                <Search
                  aria-hidden
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onFocus={() => setShowResults(searchResults.length > 0)}
                  onBlur={() => window.setTimeout(() => setShowResults(false), 150)}
                  placeholder={t("searchPlaceholder")}
                  disabled={disabled}
                  className="h-10 border-0 pl-9 pr-9 shadow-none focus-visible:ring-0"
                  data-testid="yandex-location-search"
                />
                {searching ? (
                  <Loader2
                    aria-hidden
                    className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground"
                  />
                ) : search ? (
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setSearch("");
                      setSearchResults([]);
                      setShowResults(false);
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted"
                    aria-label={t("clear")}
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </button>
                ) : null}
              </div>
              {showResults && searchResults.length > 0 ? (
                <ul className="max-h-60 overflow-y-auto border-t border-border/60">
                  {searchResults.map((r) => (
                    <li key={r.place_id}>
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => onSelectResult(r)}
                        className="flex w-full items-start gap-2 px-3 py-2 text-left text-xs hover:bg-muted"
                      >
                        <MapPin
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground"
                          aria-hidden
                        />
                        <span className="line-clamp-2">{r.display_name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>

          {/* --- Top-right: layer toggle pills -------------------------- */}
          <div className="pointer-events-auto absolute right-3 top-3 z-10 flex gap-0.5 rounded-lg bg-background p-1 shadow-md ring-1 ring-black/5">
            {layerOptions.map(({ kind, Icon, label }) => {
              const active = layer === kind;
              return (
                <button
                  key={kind}
                  type="button"
                  onClick={() => setLayer(kind)}
                  aria-pressed={active}
                  disabled={disabled}
                  title={label}
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active
                      ? "bg-primary/10 text-foreground"
                      : "text-muted-foreground hover:bg-muted",
                  )}
                  data-testid={`yandex-layer-${kind}`}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden />
                  <span className="hidden sm:inline">{label}</span>
                </button>
              );
            })}
          </div>

          {/* --- Bottom-right: locate me FAB ---------------------------- */}
          <div className="pointer-events-auto absolute bottom-4 right-3 z-10">
            <Button
              type="button"
              variant="secondary"
              size="icon"
              onClick={onLocateMe}
              disabled={disabled || locating}
              aria-label={t("locateMe")}
              title={t("locateMe")}
              className="h-10 w-10 rounded-full shadow-md ring-1 ring-black/5"
              data-testid="yandex-locate-me"
            >
              {locating ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <LocateFixed className="h-4 w-4" aria-hidden />
              )}
            </Button>
          </div>

          {/* --- Centered hint when no coords selected ------------------ */}
          {scriptReady && !hasCoords ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-5 z-10 flex justify-center px-3">
              <div className="rounded-full bg-background/95 px-4 py-1.5 text-center text-[11px] text-muted-foreground shadow-md ring-1 ring-black/5">
                {t("hint")}
              </div>
            </div>
          ) : null}
        </div>

        {/* --- Address + coords readout (when picked) ------------------- */}
        {hasCoords ? (
          <div
            className="rounded-lg border bg-card p-3 shadow-sm"
            data-testid="yandex-location-readout"
          >
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
                <MapPin className="h-4 w-4 text-primary" aria-hidden />
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t("resolvedAddress")}
                </p>
                {resolving ? (
                  <p className="flex items-center gap-1.5 text-sm italic text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                    {t("resolvingAddress")}
                  </p>
                ) : resolvedAddress ? (
                  <p className="text-sm leading-snug" data-testid="yandex-resolved-address">
                    {resolvedAddress}
                  </p>
                ) : (
                  <p className="text-sm italic text-muted-foreground">{t("unresolvedAddress")}</p>
                )}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <span
                    className="font-mono text-[11px] text-muted-foreground"
                    data-testid="yandex-location-coords"
                  >
                    {latitude.toFixed(6)}, {longitude.toFixed(6)}
                  </span>
                  <button
                    type="button"
                    onClick={() => void onCopyCoords()}
                    disabled={disabled}
                    data-testid="yandex-copy-coords"
                    className={cn(
                      "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px]",
                      "text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      copied && "text-emerald-600 dark:text-emerald-400",
                    )}
                  >
                    {copied ? (
                      <>
                        <Check className="h-3 w-3" aria-hidden />
                        {t("copyCoordsDone")}
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" aria-hidden />
                        {t("copyCoords")}
                      </>
                    )}
                  </button>
                </div>
              </div>
              <button
                type="button"
                onClick={onClear}
                disabled={disabled}
                data-testid="yandex-location-clear"
                title={t("clear")}
                aria-label={t("clear")}
                className={cn(
                  "shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors",
                  "hover:bg-muted hover:text-foreground disabled:opacity-50",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}

function buildPinElement(): HTMLElement {
  const wrap = document.createElement("div");
  wrap.style.cssText = "transform: translate(-50%, -100%); pointer-events: auto;";
  wrap.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="36" height="36"
         fill="hsl(var(--primary))" stroke="white" stroke-width="1.5"
         style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));">
      <path d="M12 2C7.6 2 4 5.6 4 10c0 5.5 7 11.5 7.3 11.8a1 1 0 0 0 1.4 0C13 21.5 20 15.5 20 10c0-4.4-3.6-8-8-8Zm0 11a3 3 0 1 1 0-6 3 3 0 0 1 0 6Z"/>
    </svg>`;
  return wrap;
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
