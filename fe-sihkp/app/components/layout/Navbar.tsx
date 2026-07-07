import { useState, useEffect, useRef } from "react";
import { Menu, X, Moon, Sun, ChevronDown } from "lucide-react";
import { cn } from "~/lib/utils";
import { NavLink, useLocation } from "react-router";
import Logo from "../logo";

function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const isDark = document.documentElement.classList.toggle("dark");
    setDark(isDark);
    localStorage.setItem("theme", isDark ? "dark" : "light");
  }

  return (
    <button
      onClick={toggle}
      className="p-2 rounded-md text-steel hover:text-ink transition-colors"
      aria-label={dark ? "Aktifkan mode terang" : "Aktifkan mode gelap"}
    >
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}

const SIMPLE_NAV_LINKS = [
  { to: "/", label: "Beranda", end: true },
  { to: "/pantau-harga", label: "Pantau Harga" },
  { to: "/prediksi", label: "Prediksi" },
];

const ANALISIS_SUB_LINKS = [
  { to: "/analisis-harga", label: "Antar Kota", end: true },
  { to: "/analisis-harga/detail-pasar", label: "Analisis Pasar Grosir" },
];

export function Navbar() {
  const [open, setOpen] = useState(false);
  const [analisisOpen, setAnalisisOpen] = useState(false);
  const analisisRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const analisisActive = location.pathname.startsWith("/analisis-harga");

  // Close dropdown on click outside (passive listener per client-passive-event-listeners)
  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (analisisRef.current && !analisisRef.current.contains(e.target as Node)) {
        setAnalisisOpen(false);
      }
    }
    document.addEventListener("mousedown", handleMouseDown, { passive: true });
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, []);

  // Close analisis dropdown when route changes
  useEffect(() => {
    setAnalisisOpen(false);
  }, [location.pathname]);

  return (
    <header className="shrink-0 sticky top-0 z-50 bg-background">
      <nav className="flex h-16 items-center justify-between px-6 border-b border-border">
        {/* Logo Area */}
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-background">
            <Logo />
          </div>
          <div className="space-y-0.5">
            <h1 className="text-[var(--ink)] font-semibold text-sm leading-tight">
              Sistem Informasi Harga Komoditas
            </h1>
            <p className="text-[var(--brand-blue)] dark:text-blue-400 text-xs font-medium">
              Provinsi Maluku
            </p>
          </div>
        </div>

        {/* Desktop Nav */}
        <div className="hidden md:flex items-center gap-6">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              cn("text-sm font-medium transition-colors", isActive ? "text-ink underline underline-offset-6" : "text-steel hover:text-ink")
            }
          >
            Beranda
          </NavLink>

          <NavLink
            to="/pantau-harga"
            className={({ isActive }) =>
              cn("text-sm font-medium transition-colors", isActive ? "text-ink underline underline-offset-6" : "text-steel hover:text-ink")
            }
          >
            Pantau Harga
          </NavLink>

          {/* Analisis Harga dropdown */}
          <div ref={analisisRef} className="relative">
            <button
              type="button"
              onClick={() => setAnalisisOpen(o => !o)}
              className={cn(
                "flex items-center gap-1 text-sm font-medium transition-colors",
                analisisActive ? "text-ink underline underline-offset-6" : "text-steel hover:text-ink"
              )}
            >
              Analisis Harga
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-150", analisisOpen && "rotate-180")} />
            </button>

            {analisisOpen && (
              <div className="absolute top-full left-0 mt-2 w-56 bg-background rounded-lg border border-border shadow-md py-1 z-50">
                {ANALISIS_SUB_LINKS.map(({ to, label, end }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={end}
                    onClick={() => setAnalisisOpen(false)}
                    className={({ isActive }) =>
                      cn(
                        "block px-4 py-2 text-sm transition-colors",
                        isActive ? "text-ink font-semibold bg-muted" : "text-steel hover:text-ink hover:bg-muted/60"
                      )
                    }
                  >
                    {label}
                  </NavLink>
                ))}
              </div>
            )}
          </div>

          <NavLink
            to="/prediksi"
            className={({ isActive }) =>
              cn("text-sm font-medium transition-colors", isActive ? "text-ink underline underline-offset-6" : "text-steel hover:text-ink")
            }
          >
            Prediksi
          </NavLink>

          <ThemeToggle />
        </div>

        {/* Mobile Hamburger */}
        <div className="md:hidden flex items-center gap-1">
          <ThemeToggle />
          <button
            className="p-2 rounded-md text-steel hover:text-ink transition-colors"
            onClick={() => setOpen(o => !o)}
            aria-label={open ? "Tutup menu" : "Buka menu"}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </nav>

      {/* Mobile Menu */}
      {open && (
        <div className="md:hidden border-b bg-background px-4 py-3 flex flex-col gap-1">
          <NavLink
            to="/"
            end
            onClick={() => setOpen(false)}
            className={({ isActive }) =>
              cn("px-2 py-2 rounded-md text-sm font-medium transition-colors", isActive ? "bg-muted text-ink" : "text-steel hover:text-ink hover:bg-muted")
            }
          >
            Beranda
          </NavLink>

          <NavLink
            to="/pantau-harga"
            onClick={() => setOpen(false)}
            className={({ isActive }) =>
              cn("px-2 py-2 rounded-md text-sm font-medium transition-colors", isActive ? "bg-muted text-ink" : "text-steel hover:text-ink hover:bg-muted")
            }
          >
            Pantau Harga
          </NavLink>

          {/* Analisis Harga sub-group */}
          <div>
            <p className="px-2 pt-2 pb-1 text-xs font-semibold uppercase tracking-wider text-steel/50">
              Analisis Harga
            </p>
            {ANALISIS_SUB_LINKS.map(({ to, label, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  cn("block px-4 py-2 rounded-md text-sm font-medium transition-colors", isActive ? "bg-muted text-ink" : "text-steel hover:text-ink hover:bg-muted")
                }
              >
                {label}
              </NavLink>
            ))}
          </div>

          <NavLink
            to="/prediksi"
            onClick={() => setOpen(false)}
            className={({ isActive }) =>
              cn("px-2 py-2 rounded-md text-sm font-medium transition-colors", isActive ? "bg-muted text-ink" : "text-steel hover:text-ink hover:bg-muted")
            }
          >
            Prediksi
          </NavLink>
        </div>
      )}
    </header>
  );
}
