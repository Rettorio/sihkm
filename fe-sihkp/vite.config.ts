import { reactRouter } from "@react-router/dev/vite";
import { reactRouterHonoServer } from "react-router-hono-server/dev";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vite";

export default defineConfig({
  server: {
    allowedHosts: ["sihkm.dev.me", "127.0.0.1", "localhost", "chef-lanes-space-wallpapers.trycloudflare.com"],
  },
  plugins: [
    tailwindcss(),
    reactRouterHonoServer({ runtime: "bun" }),
    reactRouter(),
    VitePWA({
      registerType: "autoUpdate",
      devOptions: { enabled: false },
      workbox: {
        globPatterns: ["**/*.{js,css,woff2,png,ico,svg}"],
        navigateFallback: null,
        runtimeCaching: [
          {
            urlPattern: /\/kabupaten\.geojson$/,
            handler: "CacheFirst",
            options: {
              cacheName: "shell-v1",
              expiration: { maxEntries: 1, maxAgeSeconds: 604800 },
            },
          },
          {
            urlPattern: /^\/api\/kabupaten\/$/,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "api-static-v1",
              expiration: { maxEntries: 5, maxAgeSeconds: 86400 },
            },
          },
          {
            urlPattern: /^\/api\/komoditas\//,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "api-static-v1",
              expiration: { maxEntries: 20, maxAgeSeconds: 3600 },
            },
          },
          {
            urlPattern: /^\/api\/harga\/snapshot\//,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "api-data-v1",
              expiration: { maxEntries: 100, maxAgeSeconds: 1800 },
            },
          },
          {
            urlPattern: /^\/api\/harga\/peta\//,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "api-data-v1",
              expiration: { maxEntries: 50, maxAgeSeconds: 600 },
            },
          },
          {
            urlPattern: /^\/api\/harga\/prediksi\//,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "api-data-v1",
              expiration: { maxEntries: 50, maxAgeSeconds: 1800 },
            },
          },
          {
            urlPattern: /^\/api\/harga\/analisis\//,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "api-data-v1",
              expiration: { maxEntries: 50, maxAgeSeconds: 1800 },
            },
          },
          {
            urlPattern: /^\/api\/harga\/wholesale\//,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "api-data-v1",
              expiration: { maxEntries: 50, maxAgeSeconds: 1800 },
            },
          },
          {
            urlPattern: /^\/api\/harga\/update\//,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "api-data-v1",
              expiration: { maxEntries: 50, maxAgeSeconds: 600 },
            },
          },
          {
            urlPattern: /^\/api\/harga\/peta\/initial\//,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "api-data-v1",
              expiration: { maxEntries: 20, maxAgeSeconds: 600 },
            },
          },
          {
            urlPattern: /^\/api\/harga\/peta\/options\//,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "api-data-v1",
              expiration: { maxEntries: 50, maxAgeSeconds: 3600 },
            },
          },
        ],
      },
      manifest: {
        name: "SIHKP - Sistem Informasi Harga Komoditas",
        short_name: "SIHKP",
        description: "Sistem Informasi Harga Komoditas Maluku",
        theme_color: "#1456f0",
        background_color: "#ffffff",
        display: "standalone",
        start_url: "/",
        scope: "/",
        icons: [
          { src: "/icon-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
          { src: "/favicon.ico", sizes: "64x64", type: "image/x-icon" },
        ],
      },
    }),
    {
      name: "static-cache-headers",
      configureServer(server) {
        server.middlewares.use("/kabupaten.geojson", (_req, res, next) => {
          res.setHeader("Cache-Control", "public, max-age=604800, immutable");
          next();
        });
      },
    },
  ],
  resolve: {
    tsconfigPaths: true,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes("/node_modules/leaflet/") || id.includes("/node_modules/react-leaflet/") || id.includes("MapChoropleth")) {
            return "map-choropleth";
          }
        },
        chunkFileNames: (info) => {
          if (info.name === "map-choropleth") return "assets/map-choropleth.js";
          return "assets/[name]-[hash].js";
        },
        assetFileNames: (info) => {
          if (info.name === "inter-latin-wght-normal.woff2") return "assets/inter-latin-wght-normal.woff2";
          return "assets/[name]-[hash][extname]";
        },
      },
    },
  },
});
