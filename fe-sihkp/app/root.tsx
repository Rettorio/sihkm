import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  Link,
} from "react-router";
import { useEffect } from "react";

import type { Route } from "./+types/root";
import "./app.css";
import { TooltipProvider } from "~/components/ui/tooltip";
import { Navbar } from "~/components/layout/Navbar";
import { NavigationProgress } from "~/components/NavigationProgress";

export const links: Route.LinksFunction = () => [
  // Preload Inter Latin — stable filename set in vite.config.ts so this path never changes
  { rel: "preload", href: "/assets/inter-latin-wght-normal.woff2", as: "font", type: "font/woff2", crossOrigin: "anonymous" },
  { rel: "preconnect", href: "https://basemaps.cartocdn.com", crossOrigin: "anonymous" },
  { rel: "manifest", href: "/manifest.webmanifest" },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
        {/* Inline script runs before React hydrates to prevent flash of wrong theme */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var t=localStorage.getItem('theme');if(t==='dark'||(t===null&&window.matchMedia('(prefers-color-scheme:dark)').matches)){document.documentElement.classList.add('dark')}})()`,
          }}
        />
      </head>
      <body>
        <TooltipProvider>
          {children}
        </TooltipProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  useEffect(() => {
    if ("serviceWorker" in navigator && import.meta.env.PROD) {
      import("virtual:pwa-register").then(({ registerSW }) => {
        registerSW({ immediate: false });
      });
    }
  }, []);

  return (
    <>
      <NavigationProgress />
      <Outlet />
    </>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let status = 500;
  let title = "Terjadi Kesalahan";
  let description = "Sistem mengalami gangguan tak terduga. Tim kami sudah diberitahu.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    status = error.status;
    if (status === 404) {
      title = "Halaman Tidak Ditemukan";
      description = "Halaman yang Anda cari tidak ada atau telah dipindahkan.";
    } else if (status >= 400 && status < 500) {
      title = "Permintaan Tidak Valid";
      description = error.statusText || "Terjadi kesalahan pada permintaan Anda.";
    } else {
      description = error.statusText || description;
    }
  } else if (import.meta.env.DEV && error instanceof Error) {
    stack = error.stack;
  }

  const is4xx = status >= 400 && status < 500;

  return (
    <div className="flex flex-col min-h-screen bg-surface">
      <Navbar />
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          {/* Status badge */}
          <div className="flex justify-center mb-6">
            <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold border ${
              is4xx
                ? "bg-amber-50 text-amber-700 border-amber-200"
                : "bg-red-50 text-red-600 border-red-200"
            }`}>
              <span className={`h-1.5 w-1.5 rounded-full ${is4xx ? "bg-amber-500" : "bg-red-500"}`} />
              Error {status}
            </span>
          </div>

          {/* Card */}
          <div className="bg-card border border-border rounded-2xl shadow-sm px-8 py-10 text-center space-y-4">
            {/* Large status number */}
            <p className={`text-7xl font-bold tabular-nums leading-none ${
              is4xx ? "text-amber-400" : "text-red-400"
            }`}>
              {status}
            </p>

            <div className="space-y-2">
              <h1 className="text-lg font-semibold text-[var(--ink)]">{title}</h1>
              <p className="text-sm text-[var(--steel)] leading-relaxed">{description}</p>
            </div>

            <div className="flex flex-col sm:flex-row gap-2 justify-center pt-2">
              <Link
                to="/"
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--brand-blue)] text-white text-sm font-medium px-4 py-2 hover:opacity-90 transition-opacity"
              >
                Ke Beranda
              </Link>
              <button
                type="button"
                onClick={() => window.history.back()}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-background text-[var(--steel)] text-sm font-medium px-4 py-2 hover:text-[var(--ink)] hover:bg-muted transition-colors"
              >
                Kembali
              </button>
            </div>
          </div>

          {/* Dev stack trace */}
          {stack && (
            <details className="mt-4 rounded-lg border border-border bg-card text-left">
              <summary className="px-4 py-2 text-xs font-medium text-[var(--steel)] cursor-pointer select-none">
                Stack trace (dev only)
              </summary>
              <pre className="px-4 pb-4 text-xs text-[var(--steel)] overflow-x-auto whitespace-pre-wrap break-all">
                {stack}
              </pre>
            </details>
          )}

          {/* Footer note */}
          <p className="mt-6 text-center text-xs text-[var(--steel)]/60">
            Sistem Informasi Harga Komoditas · Provinsi Maluku
          </p>
        </div>
      </div>
    </div>
  );
}
