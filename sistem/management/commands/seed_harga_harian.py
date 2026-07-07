import csv
from datetime import date
from decimal import Decimal
from pathlib import Path

from django.core.management.base import BaseCommand
from django.db import transaction

from sistem.models import HargaPangan, Pangan, WilayahKabupaten

BASE_DIR = Path(__file__).resolve().parents[3]
HARGA_HARIAN_DIR = BASE_DIR / "raw_data" / "harga_harian"
SUFFIX = "_harga_harian.csv"


def _filename_to_nama(filename: str) -> str:
    """Convert e.g. 'beras_medium_harga_harian.csv' → 'Beras Medium'."""
    stem = filename.removesuffix(SUFFIX)
    return stem.replace("_", " ").title()


class Command(BaseCommand):
    help = "Seed HargaPangan daily price data from raw_data/harga_harian/ CSVs."

    def add_arguments(self, parser):
        parser.add_argument(
            "--reset",
            action="store_true",
            help="Delete all HargaPangan rows before seeding (prompts for confirmation).",
        )
        parser.add_argument(
            "--noinput",
            action="store_true",
            help="Skip the confirmation prompt when used with --reset.",
        )

    def handle(self, *args, reset=False, noinput=False, **opts):
        if reset:
            if not noinput:
                ans = input("This will DELETE all rows in HargaPangan. Type 'yes' to continue: ")
                if ans.strip().lower() != "yes":
                    self.stdout.write("Aborted.")
                    return
            deleted, _ = HargaPangan.objects.all().delete()
            self.stdout.write(f"HargaPangan table cleared ({deleted} rows deleted).")

        csv_files = sorted(HARGA_HARIAN_DIR.glob(f"*{SUFFIX}"))
        if not csv_files:
            self.stdout.write(self.style.WARNING(f"No CSV files found in {HARGA_HARIAN_DIR}"))
            return

        pangan_cache = {p.nama: p for p in Pangan.objects.filter(sumber_id=1)}
        kab_cache = {k.kode_kabupaten: k for k in WilayahKabupaten.objects.all()}

        grand_created = grand_updated = 0

        for csv_path in csv_files:
            pangan_nama = _filename_to_nama(csv_path.name)
            pangan = pangan_cache.get(pangan_nama)
            if pangan is None:
                self.stdout.write(
                    self.style.WARNING(
                        f"  skip {csv_path.name}: Pangan '{pangan_nama}' not found — run seed_komoditas first."
                    )
                )
                continue

            rows = self._load_sorted_rows(csv_path)
            created, updated = self._seed_file(pangan, rows, kab_cache)
            grand_created += created
            grand_updated += updated
            self.stdout.write(
                f"  {csv_path.name}: {created} created, {updated} updated"
            )

        self.stdout.write(self.style.SUCCESS(
            f"Seed complete: {grand_created} created, {grand_updated} updated "
            f"({grand_created + grand_updated} total)."
        ))

    def _load_sorted_rows(self, csv_path: Path) -> list[dict]:
        rows = []
        with csv_path.open(newline="") as f:
            for row in csv.DictReader(f):
                rows.append({
                    "date": date.fromisoformat(row["date"]),
                    "kode_kab": str(int(row["kabupaten_kota"])),
                    "harga": Decimal(row["harga"]),
                })
        rows.sort(key=lambda r: (r["kode_kab"], r["date"]))
        return rows

    def _seed_file(self, pangan: Pangan, rows: list[dict], kab_cache: dict) -> tuple[int, int]:
        created = updated = 0
        prev: dict[str, dict] = {}

        with transaction.atomic():
            for row in rows:
                kab = kab_cache.get(row["kode_kab"])
                if kab is None:
                    self.stdout.write(
                        self.style.WARNING(
                            f"    skip row date={row['date']} kab={row['kode_kab']}: kabupaten not found."
                        )
                    )
                    continue

                if not row["harga"] or float(row["harga"]) <= 0:
                    continue

                last = prev.get(row["kode_kab"])
                harga_terakhir = last["harga"] if last else None
                tanggal_terakhir = last["date"] if last else None
                is_up = (row["harga"] > harga_terakhir) if harga_terakhir is not None else None

                _, was_created = HargaPangan.objects.update_or_create(
                    pangan=pangan,
                    tanggal_update=row["date"],
                    kabupaten=kab,
                    defaults={
                        "harga_sekarang": row["harga"],
                        "harga_terakhir": harga_terakhir,
                        "tanggal_terakhir": tanggal_terakhir,
                        "is_up": is_up,
                    },
                )

                prev[row["kode_kab"]] = {"harga": row["harga"], "date": row["date"]}

                if was_created:
                    created += 1
                else:
                    updated += 1

        return created, updated
