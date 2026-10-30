import React from "react";
import ReactDOM from "react-dom/client";
import { setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import App from "./App";
import "maplibre-gl/dist/maplibre-gl.css";
import "./style.css";

// MapLibre GL JS 6 worker dosyasını Vite üzerinden açıkça sun.
setWorkerUrl(workerUrl);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
