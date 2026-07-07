"""
LoggingService — minimal, structured JSON logging for scraping pipelines.

Logs only success/failure events as single-line JSON (compact, easily parseable).
Uses Python's built-in handlers (RotatingFileHandler) to keep file sizes under control.

Schema per log line:
  {
    "ts": "2026-06-14T19:00:15.123456+00:00",  # ISO 8601 UTC
    "level": "success" | "failure",
    "source": "sp2kp" | "pihps_modern" | "pihps_wholesale",
    "step": "scrape" | "transform" | "seed" | "aggregate",
    "msg": "Short human-readable message",
    "details": {...}  # only present on failure or if extra data needed
  }

Usage:
  from sistem.services.logging import PipelineLogger
  logger = PipelineLogger()
  logger.log_success("sp2kp", "scrape", "Scraped 150 records")
  logger.log_failure("sp2kp", "seed", "DB constraint violation", {"error": str(e)})
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Literal, Any

BASE_DIR = Path(__file__).resolve().parents[2]
LOGS_DIR = BASE_DIR / "logs"
LOGS_DIR.mkdir(exist_ok=True)

_LOG_FILE = LOGS_DIR / "pipeline.jsonl"
_MAX_BYTES = 10 * 1024 * 1024  # 10 MB per file
_BACKUP_COUNT = 5  # keep 5 rotated files


Source = Literal["sp2kp", "pihps_modern", "pihps_wholesale"]
Step = Literal["scrape", "transform", "seed", "aggregate"]
Level = Literal["success", "failure"]


class PipelineLogger:
    """Minimal structured logger for scraping pipelines."""

    def __init__(self):
        self._handler = RotatingFileHandler(
            _LOG_FILE,
            maxBytes=_MAX_BYTES,
            backupCount=_BACKUP_COUNT,
        )
        self._handler.setFormatter(logging.Formatter("%(message)s"))
        self._logger = logging.getLogger("pipeline")
        self._logger.setLevel(logging.INFO)
        self._logger.handlers.clear()
        self._logger.addHandler(self._handler)
        self._logger.propagate = False

    def log_success(
        self,
        source: Source,
        step: Step,
        msg: str,
        details: dict[str, Any] | None = None,
    ) -> None:
        """Log a successful step."""
        self._log("success", source, step, msg, details)

    def log_failure(
        self,
        source: Source,
        step: Step,
        msg: str,
        details: dict[str, Any] | None = None,
    ) -> None:
        """Log a failed step."""
        self._log("failure", source, step, msg, details)

    def _log(
        self,
        level: Level,
        source: Source,
        step: Step,
        msg: str,
        details: dict[str, Any] | None = None,
    ) -> None:
        entry = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "level": level,
            "source": source,
            "step": step,
            "msg": msg,
        }
        if details:
            entry["details"] = details

        self._logger.info(json.dumps(entry, separators=(",", ":")))

    @staticmethod
    def read_recent(limit: int = 50) -> list[dict]:
        """
        Read the most recent N log entries (for status checks / dashboards).
        Returns in chronological order (oldest first).
        """
        if not _LOG_FILE.exists():
            return []

        lines = _LOG_FILE.read_text().strip().split("\n")
        entries = []
        for line in lines:
            if line.strip():
                try:
                    entries.append(json.loads(line))
                except json.JSONDecodeError:
                    pass

        return entries[-limit:] if len(entries) > limit else entries
