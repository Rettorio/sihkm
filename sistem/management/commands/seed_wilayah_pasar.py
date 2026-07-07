import json
import re
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from sistem.models import WilayahKabupaten, WilayahPasar

BASE_DIR = Path(__file__).resolve().parents[3]
PROJEK_DIR = BASE_DIR / "raw_data" / "projek_akhir_data"
PASAR_JSON = BASE_DIR / "raw_data" / "pasar" / "pasar_81.json"

KAB_MAP = {
    "31_77": "8171",
    "31_78": "8172",
}


def _make_slug(name: str) -> str:
    name = name.strip().lower()
    name = re.sub(r"[^a-z0-9\s]", "", name)
    name = re.sub(r"\s+", "_", name)
    return name.strip("_") or "unknown"


WHOLESALE_SOURCES = [
    ("Ambon", PROJEK_DIR / "pihps_pedagang_ambon.json", "31_77", 3),
    ("Tual", PROJEK_DIR / "pihps_pedagang_tual.json", "31_78", 3),
]


class Command(BaseCommand):
    help = "Seed WilayahPasar from wholesale/pasar JSON files."

    def add_arguments(self, parser):
        parser.add_argument(
            "--reset", action="store_true",
            help="Delete all WilayahPasar rows before seeding.",
        )
        parser.add_argument(
            "--noinput", action="store_true",
            help="Skip confirmation prompt.",
        )

    def handle(self, *args, reset=False, noinput=False, **opts):
        if reset:
            if not noinput:
                ans = input("This will DELETE all WilayahPasar rows. Type 'yes' to continue: ")
                if ans.strip().lower() != "yes":
                    self.stdout.write("Aborted.")
                    return
            deleted, _ = WilayahPasar.objects.all().delete()
            self.stdout.write(f"WilayahPasar cleared ({deleted} rows deleted).")

        totals = {"created": 0, "updated": 0}

        for label, json_path, pihps_kab, tipe_pasar in WHOLESALE_SOURCES:
            if not json_path.exists():
                self.stdout.write(self.style.WARNING(f"  skip {label}: {json_path} not found"))
                continue
            kode_kab = KAB_MAP.get(pihps_kab)
            if not kode_kab:
                self.stdout.write(self.style.WARNING(f"  skip {label}: unknown kab mapping for {pihps_kab}"))
                continue
            try:
                kab = WilayahKabupaten.objects.get(kode_kabupaten=kode_kab)
            except WilayahKabupaten.DoesNotExist:
                self.stdout.write(self.style.WARNING(f"  skip {label}: kab {kode_kab} not in DB"))
                continue

            created, updated = self._seed_from_json(json_path, kab, tipe_pasar)
            totals["created"] += created
            totals["updated"] += updated
            self.stdout.write(f"  {label}: {created} created, {updated} updated")

        # ── Optional: seed traditional markets from pasar_81.json ──────────
        if PASAR_JSON.exists():
            created, updated = self._seed_traditional_markets()
            totals["created"] += created
            totals["updated"] += updated
            self.stdout.write(f"  Traditional markets (pasar_81): {created} created, {updated} updated")
        else:
            self.stdout.write(self.style.WARNING(f"  skip traditional markets: {PASAR_JSON} not found"))

        self.stdout.write(self.style.SUCCESS(
            f"Done. Total: {totals['created']} created, {totals['updated']} updated."
        ))

    def _seed_from_json(self, json_path: Path, kab: WilayahKabupaten, tipe_pasar: int) -> tuple[int, int]:
        with json_path.open() as f:
            data = json.load(f)

        entries = data.get("data", [])
        if not entries:
            return 0, 0

        created = updated = 0
        with transaction.atomic():
            for entry in entries:
                market_id = entry["id"]
                nama = entry["name"].strip()
                slug = _make_slug(nama)

                _, was_created = WilayahPasar.objects.update_or_create(
                    market_id=market_id,
                    defaults={
                        "nama": nama,
                        "slug": slug,
                        "kabupaten": kab,
                        "tipe_pasar": tipe_pasar,
                    },
                )
                if was_created:
                    created += 1
                else:
                    updated += 1
        return created, updated

    def _seed_traditional_markets(self) -> tuple[int, int]:
        with PASAR_JSON.open() as f:
            data = json.load(f)

        entries = data.get("data", [])
        if not entries:
            return 0, 0

        created = updated = 0
        kab_cache = {k.kode_kabupaten: k for k in WilayahKabupaten.objects.all()}

        with transaction.atomic():
            for entry in entries:
                market_id = entry["id"]
                nama = entry["nama"].strip()
                slug = _make_slug(nama)
                kode_kab = entry.get("kode_kab_kota", "")
                kab = kab_cache.get(kode_kab)
                if kab is None:
                    self.stdout.write(self.style.WARNING(f"    skip pasar '{nama}': kab {kode_kab} not found"))
                    continue

                _, was_created = WilayahPasar.objects.update_or_create(
                    market_id=market_id,
                    defaults={
                        "nama": nama,
                        "slug": slug,
                        "kabupaten": kab,
                        "tipe_pasar": 1,
                    },
                )
                if was_created:
                    created += 1
                else:
                    updated += 1
        return created, updated
