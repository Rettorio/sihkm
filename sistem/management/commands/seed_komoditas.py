import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from sistem.models import Pangan

BASE_DIR = Path(__file__).resolve().parents[3]
KOMODITAS_JSON = BASE_DIR / "raw_data" / "komoditas.json"

SUMBER_SP2KP = 1


class Command(BaseCommand):
    help = "Seed Pangan master data from raw_data/komoditas.json (sp2kp source)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--reset",
            action="store_true",
            help="Delete all Pangan rows before seeding (prompts for confirmation).",
        )
        parser.add_argument(
            "--noinput",
            action="store_true",
            help="Skip the confirmation prompt when used with --reset.",
        )

    def handle(self, *args, reset=False, noinput=False, **opts):
        if not KOMODITAS_JSON.exists():
            raise CommandError(f"Required input missing: {KOMODITAS_JSON}")

        if reset:
            if not noinput:
                ans = input("This will DELETE all rows in Pangan. Type 'yes' to continue: ")
                if ans.strip().lower() != "yes":
                    self.stdout.write("Aborted.")
                    return
            Pangan.objects.all().delete()
            self.stdout.write("Pangan table cleared.")

        with KOMODITAS_JSON.open() as f:
            data = json.load(f)

        entries = data.get("sp2kp", [])
        if not entries:
            raise CommandError("No 'sp2kp' entries found in komoditas.json.")

        created = updated = 0
        with transaction.atomic():
            for entry in entries:
                harga_acuan = entry.get("harga_acuan")
                if harga_acuan is not None:
                    harga_acuan = float(harga_acuan)
                _, was_created = Pangan.objects.update_or_create(
                    nama=entry["nama"],
                    defaults={
                        "satuan": entry.get("satuan"),
                        "master_id": entry["komoditas_id"],
                        "sumber_id": SUMBER_SP2KP,
                        "harga_acuan": harga_acuan,
                        "slug": entry["slug"]
                    },
                )
                if was_created:
                    created += 1
                else:
                    updated += 1

        self.stdout.write(self.style.SUCCESS(
            f"Seed complete: {created} created, {updated} updated ({created + updated} total)."
        ))
