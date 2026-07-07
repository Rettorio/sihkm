"""View recent pipeline logs in a human-readable format."""

from django.core.management.base import BaseCommand

from sistem.services.logging import PipelineLogger


class Command(BaseCommand):
    help = "View recent pipeline execution logs (success/failure events only)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--limit",
            type=int,
            default=20,
            metavar="N",
            help="Show last N log entries (default: 20).",
        )
        parser.add_argument(
            "--json",
            action="store_true",
            help="Output raw JSON (one line per entry) for parsing.",
        )
        parser.add_argument(
            "--level",
            choices=["success", "failure", "all"],
            default="all",
            help="Filter by success/failure/all (default: all).",
        )

    def handle(self, *args, limit=20, json=False, level="all", **opts):
        logger = PipelineLogger()
        entries = logger.read_recent(limit * 2)

        if level != "all":
            entries = [e for e in entries if e.get("level") == level]

        entries = entries[-limit:]

        if not entries:
            self.stdout.write(self.style.WARNING("No logs found."))
            return

        if json:
            import json as json_module

            for entry in entries:
                self.stdout.write(json_module.dumps(entry, separators=(",", ":")))
            return

        for entry in entries:
            ts = entry.get("ts", "?")
            level_val = entry.get("level", "?").upper()
            source = entry.get("source", "?")
            step = entry.get("step", "?")
            msg = entry.get("msg", "?")

            if level_val == "SUCCESS":
                line = self.style.SUCCESS(f"✓ {ts} | {source:15} | {step:10} | {msg}")
            else:
                line = self.style.ERROR(f"✗ {ts} | {source:15} | {step:10} | {msg}")

            self.stdout.write(line)

            if entry.get("details"):
                for k, v in entry["details"].items():
                    self.stdout.write(f"    {k}={v}")
