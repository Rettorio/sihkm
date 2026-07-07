import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from sistem.models import Pangan

BASE_DIR = Path(__file__).resolve().parents[3]
KOMODITAS_JSON = BASE_DIR / "raw_data" / "komoditas.json"
class Command(BaseCommand):
    help = "Seed PIHPS Pangan master data from raw_data/komoditas.json (pihps section, level=2)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--sumber_id", type=int, default=2, choices=[2, 3],
            help="Target sumber_id (2=pasar-modern, 3=wholesale). Default: 2.",
        )
        parser.add_argument(
            "--reset",
            action="store_true",
            help="Delete all Pangan rows with the given sumber_id before seeding.",
        )
        parser.add_argument(
            "--noinput",
            action="store_true",
            help="Skip the confirmation prompt when used with --reset.",
        )

    def handle(self, *args, sumber_id=2, reset=False, noinput=False, **opts):
        if not KOMODITAS_JSON.exists():
            raise CommandError(f"Required input missing: {KOMODITAS_JSON}")

        if reset:
            if not noinput:
                ans = input(
                    f"This will DELETE all PIHPS Pangan rows (sumber_id={sumber_id}). "
                    "Type 'yes' to continue: "
                )
                if ans.strip().lower() != "yes":
                    self.stdout.write("Aborted.")
                    return
            deleted, _ = Pangan.objects.filter(sumber_id=sumber_id).delete()
            self.stdout.write(f"PIHPS Pangan table cleared ({deleted} rows deleted).")

        with KOMODITAS_JSON.open() as f:
            data = json.load(f)

        entries = [e for e in data.get("pihps", []) if e.get("level") == 2]
        if not entries:
            raise CommandError("No level-2 'pihps' entries found in komoditas.json.")

        created = updated = 0
        with transaction.atomic():
            for entry in entries:
                harga_acuan = entry.get("harga_acuan")
                if harga_acuan is not None:
                    harga_acuan = float(harga_acuan)
                _, was_created = Pangan.objects.update_or_create(
                    sumber_id=sumber_id,
                    master_id=entry["master_id"],
                    defaults={
                        "nama": entry["name"],
                        "slug": entry["slug"],
                        "satuan": entry.get("satuan"),
                        "harga_acuan": harga_acuan,
                    },
                )
                if was_created:
                    created += 1
                else:
                    updated += 1

        self.stdout.write(self.style.SUCCESS(
            f"Seed complete (sumber_id={sumber_id}): {created} created, {updated} updated ({created + updated} total)."
        ))
