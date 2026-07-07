"""
Test report generator for SIHPM — outputs structured JSON suitable for
paper appendices.

Usage:
    python -m sistem.tests.report
    python -m sistem.tests.report --output paper/fig4.json

Groups 27 Django test methods into the 6 paper scenarios (Tests 13–18).
Each paper-table row shows PASS/FAIL with per-sub-test breakdown.
"""

import argparse
import json
import os
import sys
import time
import unittest
from datetime import datetime
from pathlib import Path

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "shppm.settings")

import django

django.setup()

from django.test.runner import DiscoverRunner

# ── Custom test result collector ───────────────────────────────────────────


class CollectingTestResult(unittest.TestResult):
    """Captures per-test status and timing from a Django test run."""

    def __init__(self, stream=None, descriptions=None, verbosity=None):
        super().__init__(stream, descriptions, verbosity)
        self.results: dict[str, dict] = {}
        self._timers: dict[int, float] = {}

    def startTest(self, test):
        self._timers[id(test)] = time.perf_counter()
        super().startTest(test)

    def _record(self, test, status):
        elapsed = (
            time.perf_counter()
            - self._timers.pop(id(test), time.perf_counter())
        )
        self.results[test.id()] = {
            "test_id": test.id(),
            "method_name": test._testMethodName,
            "class_name": type(test).__qualname__,
            "docstring": (test._testMethodDoc or "").strip(),
            "status": status,
            "duration_ms": round(elapsed * 1000, 1),
        }

    def addSuccess(self, test):
        self._record(test, "PASS")
        super().addSuccess(test)

    def addFailure(self, test, err):
        self._record(test, "FAIL")
        super().addFailure(test, err)

    def addError(self, test, err):
        self._record(test, "ERROR")
        super().addError(test, err)

    def addSkip(self, test, reason):
        self._record(test, "SKIP")
        super().addSkip(test, reason)


class ReportingTestRunner(DiscoverRunner):
    """DiscoverRunner subclass that returns the result object for inspection."""

    def get_resultclass(self):
        return CollectingTestResult

    def suite_result(self, suite, result, **kwargs):
        return result


# ── Paper-table row definitions ────────────────────────────────────────────
# Each row maps to one numbered scenario in the paper (Tests 13–18).
# filter_methods — only include these method names (None = all in class).

PAPER_ROWS = [
    {
        "no": 13,
        "modul": "ETL / Scraping",
        "skenario_uji": (
            "seed_harga_harian reads CSV and persists HargaPangan rows"
        ),
        "input": "CSV with daily prices (harga > 0, known kabupaten, known slug)",
        "hasil_yang_diharapkan": (
            "3 rows created, zero-harga skipped, unknown-kabupaten skipped, "
            "is_up flag computed (None → True → False)"
        ),
        "test_module": "sistem.tests.test_commands",
        "test_classes": ["SeedHargaHarianTest"],
    },
    {
        "no": 14,
        "modul": "ETL — LOCF (Last Observation Carried Forward)",
        "skenario_uji": (
            "Gap handling: no data or zero harga → is_locf=True with carry-forward"
        ),
        "input": (
            "Empty table, zero-price row, multiple rows, row after bucket_end, "
            "seed snapshot with prev_price"
        ),
        "hasil_yang_diharapkan": (
            "None on empty, zero excluded, latest date selected, row after ignored, "
            "is_locf=True with prev_price carried forward"
        ),
        "test_module": "sistem.tests.test_aggregator",
        "test_classes": ["LOCFTests"],
    },
    {
        "no": 15,
        "modul": "Aggregasi — Weekly / Monthly",
        "skenario_uji": (
            "Week/month boundary functions + LKV computation across weeks"
        ),
        "input": (
            "Known dates for week 1 2024/2025, February leap/non-leap, "
            "1–2 weeks of daily prices"
        ),
        "hasil_yang_diharapkan": (
            "Correct Mon/Fri bounds for 2024/2025, Feb 29/28, "
            "LKV = Friday price, correct change_pct and is_up across weeks"
        ),
        "test_module": "sistem.tests.test_aggregator",
        "test_classes": [
            "PeriodBoundaryTests",
            "AggregationWeeklyLVKTests",
        ],
    },
    {
        "no": 16,
        "modul": "API — Prediction (valid request)",
        "skenario_uji": (
            "GET /api/harga/prediksi/ with valid params returns 200 + H+1–H+4"
        ),
        "input": "komoditas_id=13, kabupaten=8171 (mocked predictor)",
        "hasil_yang_diharapkan": (
            "200 OK, 4 predictions with horizon/is_up/predicted_harga_lkv, "
            "model_meta fields present"
        ),
        "test_module": "sistem.tests.test_api_prediksi",
        "test_classes": ["HargaPrediksiMockTest"],
    },
    {
        "no": 17,
        "modul": "API — Prediction (invalid kabupaten)",
        "skenario_uji": (
            "GET /api/harga/prediksi/ with invalid kabupaten → 404"
        ),
        "input": "komoditas_id=13, kabupaten=0000",
        "hasil_yang_diharapkan": "404 with error='model_not_available'",
        "test_module": "sistem.tests.test_api_prediksi",
        "test_classes": ["HargaPrediksiErrorTest"],
        "exclude_methods": ["test_nonexistent_komoditas"],
    },
    {
        "no": 18,
        "modul": "API — Prediction (invalid komoditas)",
        "skenario_uji": (
            "GET /api/harga/prediksi/ with invalid komoditas → 404"
        ),
        "input": "komoditas_id=99999, kabupaten=8171",
        "hasil_yang_diharapkan": "404 with error='model_not_available'",
        "test_module": "sistem.tests.test_api_prediksi",
        "test_classes": ["HargaPrediksiErrorTest"],
        "filter_methods": ["test_nonexistent_komoditas"],
    },
]


# ── Helpers ────────────────────────────────────────────────────────────────


def _parse_test_id(test_id: str) -> dict:
    """Parse a fully qualified test ID into module, class, method."""
    *module_parts, class_name, method_name = test_id.split(".")
    return {
        "module": ".".join(module_parts),
        "class_name": class_name,
        "method_name": method_name,
    }


def _matches_row(test_id: str, row: dict) -> bool:
    """Check whether a test ID belongs to the given paper-table row."""
    parsed = _parse_test_id(test_id)
    if parsed["module"] != row["test_module"]:
        return False
    if parsed["class_name"] not in row["test_classes"]:
        return False
    exclude = set(row.get("exclude_methods") or [])
    if parsed["method_name"] in exclude:
        return False
    include = row.get("filter_methods")
    if include and parsed["method_name"] not in include:
        return False
    return True


# ── Report builder ─────────────────────────────────────────────────────────


def build_report() -> dict:
    """Run all sistem.tests and return a structured report dict."""

    runner = ReportingTestRunner(verbosity=0)
    raw_result: CollectingTestResult = runner.run_tests(["sistem.tests"])
    raw: dict[str, dict] = raw_result.results

    # ── all_tests (flat, sorted) ───────────────────────────────────────
    all_tests = sorted(raw.values(), key=lambda r: r["test_id"])

    # ── paper_table (grouped) ──────────────────────────────────────────
    paper_table = []
    for row in PAPER_ROWS:
        sub_tests = sorted(
            (rec for tid, rec in raw.items() if _matches_row(tid, row)),
            key=lambda r: r["method_name"],
        )
        passed = sum(1 for t in sub_tests if t["status"] == "PASS")
        failed = sum(1 for t in sub_tests if t["status"] != "PASS")
        paper_table.append(
            {
                "no": row["no"],
                "modul": row["modul"],
                "skenario_uji": row["skenario_uji"],
                "input": row["input"],
                "hasil_yang_diharapkan": row["hasil_yang_diharapkan"],
                "status": "PASS" if failed == 0 else "FAIL",
                "passed": passed,
                "failed": failed,
                "total": len(sub_tests),
                "sub_tests": sub_tests,
            }
        )

    total = raw_result.testsRun
    n_fail = len(raw_result.failures)
    n_err = len(raw_result.errors)

    return {
        "report_metadata": {
            "generated_at": datetime.now().isoformat(),
            "project": "SIHPM (Sistem Informasi Harga Pangan Maluku)",
            "python_version": sys.version.split()[0],
            "django_version": django.get_version(),
            "total_tests": total,
            "passed": total - n_fail - n_err,
            "failed": n_fail,
            "errors": n_err,
        },
        "paper_table": paper_table,
        "all_tests": all_tests,
    }


def main():
    parser = argparse.ArgumentParser(
        description="Generate SIHPM test report for paper appendix",
    )
    parser.add_argument(
        "--output",
        "-o",
        default="test_report.json",
        help="Output JSON file path (default: test_report.json)",
    )
    args = parser.parse_args()

    t0 = time.perf_counter()
    report = build_report()
    build_elapsed = time.perf_counter() - t0

    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps(report, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    meta = report["report_metadata"]
    print(f"\nReport written → {out_path.resolve()}")
    print(
        f"  {meta['passed']}/{meta['total_tests']} passed, "
        f"{meta['failed']} failed, "
        f"{meta['errors']} errors "
        f"({meta['total_tests']} total tests)"
    )
    print(f"  Generated in {build_elapsed:.2f}s ({meta.get('duration_seconds', '?')}s test time)")


if __name__ == "__main__":
    main()
