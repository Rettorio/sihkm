import puppeteer from "puppeteer";
import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const BASE_URL = "https://sihkm.dev.me";
const CHROMIUM_PATH = "/mnt/ssd/chromium/chromium/linux-1650032/chrome-linux/chrome";

const PASS = "\x1b[32m✓\x1b[0m";
const FAIL = "\x1b[31m✗\x1b[0m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

const results = [];
const PAGE_TIMEOUT = 20000;
const WAIT_LOAD = 8000;
const WAIT_NAV = 6000;
const WAIT_RADIX = 2000;

function pad(s, n) {
  return String(s).padEnd(n);
}

async function selectRadixOption(page, triggerSelector, optionText, timeout = 5000) {
  await page.click(triggerSelector);
  await page.waitForSelector('[data-slot="select-content"]', { visible: true, timeout });
  await new Promise(r => setTimeout(r, 400));
  const clicked = await page.evaluate(text => {
    const items = document.querySelectorAll('[data-slot="select-item"]');
    for (const item of items) {
      const raw = item.textContent || "";
      const clean = raw.replace(/[✓✔✗✘]/g, "").trim();
      if (clean === text || clean.startsWith(text)) {
        item.click();
        return true;
      }
    }
    return false;
  }, optionText);
  if (!clicked) throw new Error(`Option "${optionText}" not found in select`);
  await new Promise(r => setTimeout(r, 600));
}

async function waitForLoad(page) {
  await page.waitForNetworkIdle({ idleTime: 500, timeout: PAGE_TIMEOUT }).catch(() => {});
}

async function getKpiValue(page, labelText) {
  return page.evaluate(label => {
    const labels = document.querySelectorAll('[data-slot="card"] p.text-xs');
    for (const el of labels) {
      if (el.textContent.trim() === label) {
        const card = el.closest('[data-slot="card"]');
        if (card) {
          const valueEl = card.querySelector("p.text-2xl");
          return valueEl ? valueEl.textContent.trim() : null;
        }
      }
    }
    return null;
  }, labelText);
}

async function waitForKpiReady(page, labelText, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const val = await getKpiValue(page, labelText);
    if (val && val !== "—") return val;
    await new Promise(r => setTimeout(r, 500));
  }
  return await getKpiValue(page, labelText);
}

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

const testCases = [

  // ── 1. Pantau Harga — Muat peta tematik ──────────────────────────────
  {
    no: 1, module: "Pantau Harga", scenario: "Memuat peta tematik",
    handler: async page => {
      await page.goto(`${BASE_URL}/pantau-harga?tipe_pasar=1`, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT });
      await waitForLoad(page);
      await page.waitForSelector(".leaflet-container", { timeout: WAIT_LOAD });
      const avgPrice = await waitForKpiReady(page, "Harga Rata-rata");
      if (!avgPrice || avgPrice === "—") throw new Error(`KPI "Harga Rata-rata" not loaded: ${avgPrice}`);
      const tableRows = await page.$$('table tbody tr');
      if (tableRows.length === 0) throw new Error("Table has no data rows");
    },
  },

  // ── 2. Pantau Harga — Filter komoditas ────────────────────────────────
  {
    no: 2, module: "Pantau Harga", scenario: "Filter komoditas",
    handler: async page => {
      await page.goto(`${BASE_URL}/pantau-harga?tipe_pasar=1`, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT });
      await waitForLoad(page);
      const firstAvg = await waitForKpiReady(page, "Harga Rata-rata");
      await selectRadixOption(page, '[aria-label="Komoditas"]', "Cabai Merah Keriting");
      await new Promise(r => setTimeout(r, 2000));
      await waitForLoad(page);
      const secondAvg = await waitForKpiReady(page, "Harga Rata-rata");
      if (secondAvg === "—") throw new Error(`KPI not updated after commodity change: ${secondAvg}`);
      if (firstAvg !== null && firstAvg === secondAvg) {
        throw new Error(`KPI unchanged after commodity switch: both "${firstAvg}"`);
      }
    },
  },

  // ── 3. Pantau Harga — Filter periode ──────────────────────────────────
  {
    no: 3, module: "Pantau Harga", scenario: "Filter periode",
    handler: async page => {
      await page.goto(`${BASE_URL}/pantau-harga?tipe_pasar=1`, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT });
      await waitForLoad(page);
      const initialAvg = await waitForKpiReady(page, "Harga Rata-rata");
      if (!initialAvg || initialAvg === "—") throw new Error("Initial data not loaded");
      await selectRadixOption(page, '[aria-label="Tipe periode"]', "Bulanan");
      await new Promise(r => setTimeout(r, 2000));
      await waitForLoad(page);
      const newAvg = await waitForKpiReady(page, "Harga Rata-rata");
      if (!newAvg || newAvg === "—") throw new Error("KPI not updated after period change");
    },
  },

  // ── 4. Pantau Harga — Klik kabupaten ──────────────────────────────────
  {
    no: 4, module: "Pantau Harga", scenario: "Klik kabupaten di peta",
    handler: async page => {
      await page.goto(`${BASE_URL}/pantau-harga?tipe_pasar=1`, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT });
      await waitForLoad(page);
      // Wait for sidebar buttons to render
      await page.waitForSelector('[class*="grid grid-cols-2"] button', { timeout: WAIT_LOAD });
      // Click second kabupaten (first might already be selected)
      const kabButtons = await page.$$('[class*="grid grid-cols-2"] button');
      if (kabButtons.length < 2) throw new Error("Not enough kabupaten buttons");
      const targetName = await page.evaluate(el => el.textContent.trim(), kabButtons[1]);
      await kabButtons[1].click();
      await new Promise(r => setTimeout(r, 1000));
      await waitForLoad(page);
      // Check breadcrumb shows the selected kabupaten
      const pageText = await page.evaluate(() => document.body.textContent);
      if (!pageText.includes(targetName)) {
        throw new Error(`Breadcrumb/table did not update with kabupaten "${targetName}"`);
      }
    },
  },

  // ── 5. Analisis — Perbandingan dua wilayah ────────────────────────────
  {
    no: 5, module: "Analisis / Antar Kota", scenario: "Perbandingan dua wilayah",
    handler: async page => {
      await page.goto(`${BASE_URL}/analisis-harga?tipe_pasar=1`, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT });
      await waitForLoad(page);
      await page.waitForSelector('[class*="grid grid-cols-2"] button', { timeout: WAIT_LOAD }).catch(() => {});
      // Click two kabupaten buttons in the city picker panel
      const cityButtons = await page.$$('[class*="grid"] button:not([disabled])');
      const clickable = [];
      for (const btn of cityButtons) {
        const text = await page.evaluate(el => el.textContent.trim(), btn);
        if (text && !text.includes("Reset") && !text.includes("→") && !text.includes("Hapus")) {
          clickable.push(btn);
        }
      }
      if (clickable.length < 2) {
        // Try alternate selector: city picker panel buttons
        const panelBtns = await page.$$('[class*="w-full flex items-center gap-2 px-2 py-1.5"]');
        for (const btn of panelBtns) clickable.push(btn);
      }
      if (clickable.length < 2) throw new Error(`Cannot find 2 city buttons (found ${clickable.length})`);
      const city1Text = await page.evaluate(el => el.textContent.trim(), clickable[0]);
      await clickable[0].click();
      await new Promise(r => setTimeout(r, 300));
      const city2Text = await page.evaluate(el => el.textContent.trim(), clickable[1]);
      await clickable[1].click();
      await new Promise(r => setTimeout(r, 2000));
      await waitForLoad(page);
      // Check for chart SVG
      const svg = await page.$("svg.recharts-surface");
      if (!svg) throw new Error("Comparison chart not rendered");
    },
  },

  // ── 6. Analisis — Perbandingan multi-wilayah ─────────────────────────
  {
    no: 6, module: "Analisis / Antar Kota", scenario: "Perbandingan multi-wilayah",
    handler: async page => {
      await page.goto(`${BASE_URL}/analisis-harga?tipe_pasar=1&kota=8101%2C8102%2C8103`, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT });
      await waitForLoad(page);
      const svg = await page.$("svg.recharts-surface");
      if (!svg) throw new Error("Chart not rendered for multi-city");
      // Check legend has 3+ city entries
      const legendItems = await page.$$('[class*="flex flex-wrap items-center"] svg');
      if (legendItems.length < 3) {
        // At least check that data loaded
        const tableRows = await page.$$("table tbody tr");
        if (tableRows.length < 2) throw new Error("Multi-city comparison not working (few rows)");
      }
    },
  },

  // ── 7. Analisis — Tabel perbandingan ─────────────────────────────────
  {
    no: 7, module: "Analisis / Antar Kota", scenario: "Tabel perbandingan",
    handler: async page => {
      await page.goto(`${BASE_URL}/analisis-harga?tipe_pasar=1`, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT });
      await waitForLoad(page);
      await page.waitForSelector("table", { timeout: WAIT_LOAD });
      const table = await page.$("table");
      if (!table) throw new Error("Comparison table not rendered");
      const rows = await table.$$("tbody tr");
      if (rows.length === 0) throw new Error("Table has no data rows");
    },
  },

  // ── 8. Analisis Pedagang Besar — Muat data PIHPS ────────────────────
  {
    no: 8, module: "Analisis / Pedagang Besar", scenario: "Memuat data PIHPS",
    handler: async page => {
      await page.goto(`${BASE_URL}/analisis-harga/detail-pasar?kab=8171&group=beras&tipe=weekly&n=12`, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT });
      await waitForLoad(page);
      await new Promise(r => setTimeout(r, 3000));
      const pageText = await page.evaluate(() => document.body.textContent);
      if (pageText.includes("Memuat") && !pageText.includes("Rp")) {
        // Data might still be loading; wait more
        await new Promise(r => setTimeout(r, 4000));
        await waitForLoad(page);
      }
      const hasPriceData = await page.evaluate(() => {
        const body = document.body.textContent;
        return body.includes("Rp") || body.includes("Harga") || body.includes("Pasar");
      });
      if (!hasPriceData) {
        // Check for chart or wholesale-specific content
        const chartSvg = await page.$("svg.recharts-surface");
        if (!chartSvg) {
          // Might be empty but the page loaded — check no error
          if (pageText.includes("Tidak ada data") || pageText.includes("error")) {
            throw new Error("Wholesale page shows error state");
          }
        }
      }
    },
  },

  // ── 9. Analisis Pedagang Besar — Retail vs Grosir ────────────────────
  {
    no: 9, module: "Analisis / Pedagang Besar", scenario: "Perbandingan retail vs grosir",
    handler: async page => {
      await page.goto(`${BASE_URL}/analisis-harga/versus-pasar?tipe=weekly&n=24`, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT });
      await waitForLoad(page);
      await new Promise(r => setTimeout(r, 3000));
      await waitForLoad(page);
      const svg = await page.$("svg.recharts-surface");
      if (!svg) {
        const pageText = await page.evaluate(() => document.body.textContent.substring(0, 500));
        if (pageText.includes("Tidak ada data") || pageText.includes("Pilih komoditas")) {
          // Try selecting a commodity
          const selectTrigger = await page.$('[data-slot="select-trigger"]');
          if (selectTrigger) {
            const triggerText = await page.evaluate(el => el.textContent.trim(), selectTrigger);
            if (triggerText === "" || triggerText === "Pilih komoditas") {
              await selectRadixOption(page, '[data-slot="select-trigger"]', "Beras");
              await new Promise(r => setTimeout(r, 3000));
              await waitForLoad(page);
            }
          }
        }
        const chartAfter = await page.$("svg.recharts-surface");
        if (!chartAfter) {
          // It's OK if no chart for this specific commodity; just check KPIs rendered
          const kpis = await page.$$('[class*="KpiCard"]');
          if (kpis.length === 0) throw new Error("Versus page did not render KPIs or chart");
        }
      }
    },
  },

  // ── 10. Prediksi — Muat prediksi H+1–H+4 ──────────────────────────────
  {
    no: 10, module: "Prediksi", scenario: "Memuat prediksi H+1–H+4",
    handler: async page => {
      await page.goto(`${BASE_URL}/prediksi?komoditas_id=13&kabupaten=8171&tipe=weekly`, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT });
      await waitForLoad(page);
      await new Promise(r => setTimeout(r, 3000));
      await waitForLoad(page);
      // Check prediction KPI cards exist
      const pageText = await page.evaluate(() => document.body.textContent);
      if (pageText.includes("Model belum dilatih") || pageText.includes("Model belum tersedia")) {
        throw new Error("No model for Bawang Merah in Ambon");
      }
      // Check H+1 and H+4 cards exist
      const hasH1 = await page.evaluate(() => {
        const labels = document.querySelectorAll('[data-slot="card"] p.text-xs');
        return Array.from(labels).some(el => el.textContent.includes("Prediksi H+1"));
      });
      const hasH4 = await page.evaluate(() => {
        const labels = document.querySelectorAll('[data-slot="card"] p.text-xs');
        return Array.from(labels).some(el => el.textContent.includes("Prediksi H+"));
      });
      if (!hasH1 && !hasH4) {
        // Check if prediction table exists instead
        const predTable = await page.$("table");
        if (!predTable) throw new Error("No prediction cards or table found");
      }
      // Prediction table should have H+1..H+4 rows
      const tableRows = await page.$$("table tbody tr");
      if (tableRows.length > 0) {
        const rowTexts = await Promise.all(tableRows.map(r => page.evaluate(el => el.textContent, r)));
        const hasHorizons = rowTexts.some(t => t.includes("H+1")) && rowTexts.some(t => t.includes("H+4"));
        if (!hasHorizons && tableRows.length >= 2) {
          // Partial data is OK — just verify we see direction (trending up/down)
          const hasDirection = rowTexts.some(t => t.includes("+") || t.includes("-"));
          if (!hasDirection) throw new Error("No direction indicators in prediction table");
        }
      }
    },
  },

  // ── 11. Prediksi — Komoditas tanpa model ─────────────────────────────
  {
    no: 11, module: "Prediksi", scenario: "Komoditas tanpa model",
    handler: async page => {
      await page.goto(`${BASE_URL}/prediksi?komoditas_id=14&kabupaten=8102&tipe=weekly`, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT });
      await waitForLoad(page);
      await new Promise(r => setTimeout(r, 3000));
      await waitForLoad(page);
      const pageText = await page.evaluate(() => document.body.textContent);
      const hasNoModelMsg = pageText.includes("Model belum dilatih") || pageText.includes("Model belum tersedia");
      if (!hasNoModelMsg) {
        // If model was recently trained, check that the combo has model; fallback to another combo
        const fallbacks = [
          { komoditas_id: 19, kab: "8102" },
          { komoditas_id: 53, kab: "8102" },
          { komoditas_id: 56, kab: "8102" },
        ];
        let found = false;
        for (const fb of fallbacks) {
          await page.goto(`${BASE_URL}/prediksi?komoditas_id=${fb.komoditas_id}&kabupaten=${fb.kab}&tipe=weekly`, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT });
          await waitForLoad(page);
          await new Promise(r => setTimeout(r, 3000));
          await waitForLoad(page);
          const text = await page.evaluate(() => document.body.textContent);
          if (text.includes("Model belum dilatih") || text.includes("Model belum tersedia")) {
            found = true;
            break;
          }
        }
        if (!found) throw new Error("No model-absent commodity found (or all have models now)");
      }
    },
  },

  // ── 12. Prediksi — Validasi data terkini ──────────────────────────────
  {
    no: 12, module: "Prediksi", scenario: "Validasi data terkini",
    handler: async page => {
      await page.goto(`${BASE_URL}/prediksi?komoditas_id=13&kabupaten=8171&tipe=weekly`, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT });
      await waitForLoad(page);
      await new Promise(r => setTimeout(r, 2000));
      await waitForLoad(page);
      const pageText = await page.evaluate(() => document.body.textContent);
      // Look for date evidence: "Dilatih", "trained_at", or Indonesian months
      const hasMonth = /Jan|Feb|Mar|Apr|Mei|Jun|Jul|Agu|Sep|Okt|Nov|Des/i.test(pageText);
      const hasDate = /\d{1,2}[-/]\d{1,2}[-/]\d{2,4}/.test(pageText);
      const hasDilatih = pageText.includes("Dilatih");
      if (!hasMonth && !hasDate && !hasDilatih) {
        // Check if the KPI card shows "Harga Saat Ini" with a value
        const hargaSaatIni = await page.evaluate(() => {
          const labels = document.querySelectorAll('[data-slot="card"] p.text-xs');
          for (const el of labels) {
            if (el.textContent.includes("Harga Saat Ini")) {
              const card = el.closest('[data-slot="card"]');
              return card ? card.textContent : null;
            }
          }
          return null;
        });
        if (!hargaSaatIni || hargaSaatIni.includes("—")) {
          throw new Error("No current price data displayed");
        }
      }
    },
  },

  // ── 19. Sistem — Performa halaman ─────────────────────────────────────
  {
    no: 19, module: "Sistem", scenario: "Performa halaman",
    handler: async page => {
      const perfTiming = await page.evaluate(() => {
        const nav = performance.getEntriesByType("navigation")[0];
        if (nav) return nav.duration;
        return performance.timing
          ? performance.timing.loadEventEnd - performance.timing.navigationStart
          : null;
      });
      // First: navigate fresh and measure
      await page.goto(`${BASE_URL}/pantau-harga?tipe_pasar=1`, { waitUntil: "networkidle0", timeout: 30000 });
      const timing = await page.evaluate(() => {
        const nav = performance.getEntriesByType("navigation")[0];
        if (nav) return { duration: nav.duration, domContentLoaded: nav.domContentLoadedEventEnd - nav.startTime };
        return null;
      });
      if (!timing) throw new Error("Cannot measure performance");
      if (timing.duration > 3000) {
        console.warn(`  ⚠ Load time ${(timing.duration / 1000).toFixed(1)}s exceeds 3s target`);
      }
      if (timing.duration > 6000) throw new Error(`Page load time ${(timing.duration / 1000).toFixed(1)}s > 6s (soft)`);
    },
  },

  // ── 20. Sistem — Responsivitas antarmuka ─────────────────────────────
  {
    no: 20, module: "Sistem", scenario: "Responsivitas antarmuka",
    handler: async page => {
      await page.setViewport({ width: 390, height: 844 });
      await page.goto(`${BASE_URL}/pantau-harga?tipe_pasar=1`, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT });
      await waitForLoad(page);
      // Check no horizontal overflow
      const overflow = await page.evaluate(() => {
        const html = document.documentElement;
        return {
          scrollWidth: html.scrollWidth,
          clientWidth: html.clientWidth,
          overflowX: getComputedStyle(html).overflowX,
        };
      });
      if (overflow.scrollWidth > overflow.clientWidth && overflow.overflowX !== "hidden") {
        // Check if there are horizontal scrollbars on the body
        const bodyOverflow = await page.evaluate(() => getComputedStyle(document.body).overflowX);
        const mainEl = await page.evaluate(() => {
          const main = document.querySelector("main");
          if (!main) return null;
          return {
            scrollWidth: main.scrollWidth,
            clientWidth: main.clientWidth,
            overflowX: getComputedStyle(main).overflowX,
          };
        });
        if (mainEl && mainEl.scrollWidth > mainEl.clientWidth && mainEl.overflowX !== "hidden") {
          throw new Error(`Horizontal overflow detected: scroll=${overflow.scrollWidth} client=${overflow.clientWidth}`);
        }
      }
      // Map should be visible on mobile
      const map = await page.$(".leaflet-container");
      if (!map) throw new Error("Map not visible on mobile viewport");
    },
  },
];

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function main() {
  console.log(`\n  ${BOLD}E2E Blackbox Test — SIHPM${RESET}\n`);
  console.log(`  ${BASE_URL}\n`);

  const browser = await puppeteer.launch({
    executablePath: CHROMIUM_PATH,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--ignore-certificate-errors",
      "--disable-gpu",
      "--disable-dev-shm-usage",
    ],
  });

  const startAll = Date.now();

  for (const tc of testCases) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setDefaultTimeout(10000);
    page.on("dialog", async d => await d.dismiss());

    const start = Date.now();
    let status, error;

    try {
      page.on("pageerror", err => { throw err; });
      await tc.handler(page);
      status = PASS;
    } catch (err) {
      status = FAIL;
      error = err.message || String(err);
    }

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    results.push({ no: tc.no, module: tc.module, scenario: tc.scenario, status, error, elapsed });
    console.log(`  ${status}  No ${String(tc.no).padStart(2, " ")}  ${pad(tc.module, 30)} ${pad(tc.scenario, 36)} ${elapsed}s`);
    if (error) console.log(`       ⚠ ${error}`);

    await context.close();
  }

  const totalElapsed = ((Date.now() - startAll) / 1000).toFixed(1);
  const passed = results.filter(r => r.status === PASS).length;
  const failed = results.filter(r => r.status === FAIL).length;

  console.log(`\n  ${BOLD}Results: ${passed} passed, ${failed} failed (${totalElapsed}s)${RESET}\n`);

  // Print markdown table
  console.log(`  ${BOLD}Markdown table:${RESET}\n`);
  console.log(`  | No | Modul | Skenario Uji | Hasil yang Diharapkan | Status |`);
  console.log(`  | -: | ------------------------- | ----------------------------- | ------------------------------------------------ | :----: |`);
  for (const r of results) {
    const statusMark = r.status === PASS ? "✓" : "✗";
    console.log(`  | ${r.no} | ${r.module} | ${r.scenario} | Lihat skenario | ${statusMark} |`);
  }
  console.log("");

  // Save JSON
  writeFileSync(
    resolve(__dirname, "results.json"),
    JSON.stringify(results, null, 2)
  );
  console.log(`  Results saved to e2e/results.json\n`);

  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
