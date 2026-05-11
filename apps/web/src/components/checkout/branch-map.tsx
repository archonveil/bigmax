"use client";

import L from "leaflet";
import { useEffect } from "react";
import { MapContainer, Marker, TileLayer, useMap } from "react-leaflet";

import type { Branch } from "@/components/checkout/checkout-page";

import "leaflet/dist/leaflet.css";

interface BranchMapProps {
  branches: Branch[];
  selectedId: string;
  onSelect: (id: string) => void;
}

/** Центр Ташкента — fallback если у филиалов нет координат. */
const TASHKENT_CENTER: [number, number] = [41.3111, 69.2797];

/**
 * SVG-пин как divIcon — не тянем img-ассеты Leaflet (`marker-icon.png`),
 * которые ломаются в бандлере Next.js без дополнительной конфигурации.
 */
function buildPin(variant: "default" | "active"): L.DivIcon {
  const fill = variant === "active" ? "#0ea5e9" : "#475569";
  const size = variant === "active" ? 36 : 28;
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}"
         fill="${fill}" stroke="white" stroke-width="1.5">
      <path d="M12 2C7.6 2 4 5.6 4 10c0 5.5 7 11.5 7.3 11.8a1 1 0 0 0 1.4 0C13 21.5 20 15.5 20 10c0-4.4-3.6-8-8-8Zm0 11a3 3 0 1 1 0-6 3 3 0 0 1 0 6Z"/>
    </svg>`;
  return L.divIcon({
    html: svg,
    className: "", // убираем дефолтные leaflet-классы со своим фоном
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
  });
}

function RecenterOnSelected({
  branches,
  selectedId,
}: {
  branches: Branch[];
  selectedId: string;
}): null {
  const map = useMap();
  useEffect(() => {
    const b = branches.find((x) => x.id === selectedId);
    if (!b || b.latitude === null || b.longitude === null) return;
    map.flyTo([b.latitude, b.longitude], 14, { duration: 0.6 });
  }, [selectedId, branches, map]);
  return null;
}

export default function BranchMap({ branches, selectedId, onSelect }: BranchMapProps): JSX.Element {
  // Центр по среднему координат всех филиалов, с фолбеком на Ташкент.
  const withCoords = branches.filter(
    (b): b is Branch & { latitude: number; longitude: number } =>
      b.latitude !== null && b.longitude !== null,
  );
  const center: [number, number] =
    withCoords.length > 0
      ? [
          withCoords.reduce((s, b) => s + b.latitude, 0) / withCoords.length,
          withCoords.reduce((s, b) => s + b.longitude, 0) / withCoords.length,
        ]
      : TASHKENT_CENTER;

  return (
    <MapContainer
      center={center}
      zoom={12}
      scrollWheelZoom={false}
      className="h-full w-full rounded-md"
      style={{ minHeight: 320 }}
      aria-label="Map of Bigmax store branches"
    >
      {/* CartoDB Voyager — fresher rendering than default OSM tiles + retina-ready. */}
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
        url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
        subdomains={["a", "b", "c", "d"]}
        maxZoom={20}
      />
      <RecenterOnSelected branches={branches} selectedId={selectedId} />
      {withCoords.map((b) => (
        <Marker
          key={b.id}
          position={[b.latitude, b.longitude]}
          icon={buildPin(b.id === selectedId ? "active" : "default")}
          eventHandlers={{ click: () => onSelect(b.id) }}
        />
      ))}
    </MapContainer>
  );
}
