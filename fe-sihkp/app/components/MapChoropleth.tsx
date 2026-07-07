import { useEffect, useState } from "react";
import { MapContainer, GeoJSON, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { PathOptions } from "leaflet";
import type { GeoJsonObject, Feature } from "geojson";

function useDarkMode() {
  const [dark, setDark] = useState(() =>
    typeof document !== "undefined" && document.documentElement.classList.contains("dark")
  );
  useEffect(() => {
    const obs = new MutationObserver(() =>
      setDark(document.documentElement.classList.contains("dark"))
    );
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

const DEFAULT_CENTER: [number, number] = [-5.3555, 129.5];
const DEFAULT_ZOOM = 7;

const CROSSHAIR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>`;

interface Props {
  geoJsonData: GeoJsonObject;
  styleFeature: (feature: Feature) => PathOptions;
  onEachFeature: (feature: Feature, layer: L.Layer) => void;
  mapKey: string;
  onMapReady?: (map: L.Map) => void;
}

function MapReadyReporter({ onReady }: { onReady: (map: L.Map) => void }) {
  const map = useMap();
  useEffect(() => { onReady(map); }, []);
  return null;
}

function ResetCenterControl() {
  const map = useMap();

  useEffect(() => {
    const Control = L.Control.extend({
      onAdd() {
        const container = L.DomUtil.create("div", "leaflet-bar leaflet-control");
        const btn = L.DomUtil.create("a", "", container) as HTMLAnchorElement;
        btn.href = "#";
        btn.title = "Reset tampilan peta";
        btn.setAttribute("role", "button");
        btn.setAttribute("aria-label", "Reset tampilan peta");
        btn.innerHTML = CROSSHAIR_SVG;
        btn.style.cssText = "display:flex;align-items:center;justify-content:center;";
        L.DomEvent.on(btn, "click", (e) => {
          L.DomEvent.stopPropagation(e);
          L.DomEvent.preventDefault(e);
          map.flyTo(DEFAULT_CENTER, DEFAULT_ZOOM, { animate: true, duration: 0.6 });
        });
        return container;
      },
    });

    const ctrl = new Control({ position: "topleft" });
    ctrl.addTo(map);
    return () => { ctrl.remove(); };
  }, [map]);

  return null;
}

export default function MapChoropleth({ geoJsonData, styleFeature, onEachFeature, mapKey, onMapReady }: Props) {
  const dark = useDarkMode();
  const tileUrl = dark
    ? "https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png"
    : "https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png";

  return (
    <MapContainer
      center={DEFAULT_CENTER}
      zoom={DEFAULT_ZOOM}
      style={{ height: "100%", width: "100%", zIndex: 0 }}
      zoomControl={true}
    >
      <TileLayer
        key={tileUrl}
        url={tileUrl}
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
        subdomains="abcd"
        maxZoom={19}
        keepBuffer={4}
        updateWhenIdle={true}
        updateWhenZooming={false}
      />
      <GeoJSON
        key={mapKey}
        data={geoJsonData}
        style={styleFeature as any}
        onEachFeature={onEachFeature as any}
      />
      <ResetCenterControl />
      {onMapReady && <MapReadyReporter onReady={onMapReady} />}
    </MapContainer>
  );
}
