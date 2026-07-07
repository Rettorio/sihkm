import csv
from datetime import date
from decimal import Decimal
from pathlib import Path

from django.core.management.base import BaseCommand
from django.db import transaction

from sistem.models import HargaPangan, Pangan, WilayahKabupaten

BASE_DIR = Path(__file__).resolve().parents[3]
PER_REGENCY_DIR = BASE_DIR / "raw_data" / "harga_harian_pedagang_besar" / "per_regency"
SUFFIX = "_harga_harian"

# Maps per_regency directory name → PIHPS kabupaten code → kode_kabupaten in DB
REGENCY_MAP = {
    "77": ("31_77", "8171"),
    "78": ("31_78", "8172"),
}


class Command(BaseCommand):
    help = "Seed HargaPangan wholesale prices (sumber_id=3) from per-regency CSVs."

    def add_arguments(self, parser):
        parser.add_argument(
            "--reset", action="store_true",
            help="Delete all HargaPangan rows with sumber_id=3 before seeding.",
        )
        parser.add_argument(
            "--noinput", action="store_true",
            help="Skip confirmation prompt.",
        )

    def handle(self, *args, reset=False, noinput=False, **opts):
        if reset:
            if not noinput:
                ans = input(
                    "This will DELETE all HargaPangan rows with sumber_id=3 (wholesale). "
                    "Type 'yes' to continue: "
                )
                if ans.strip().lower() != "yes":
                    self.stdout.write("Aborted.")
                    return
            deleted, _ = HargaPangan.objects.filter(pangan__sumber_id=3).delete()
            self.stdout.write(f"Cleared {deleted} wholesale HargaPangan rows.")

        if not PER_REGENCY_DIR.exists():
            self.stdout.write(self.style.ERROR(f"Directory not found: {PER_REGENCY_DIR}"))
            return

        pangan_cache = {p.slug: p for p in Pangan.objects.filter(sumber_id=3)}
        kab_cache = {k.kode_kabupaten: k for k in WilayahKabupaten.objects.all()}

        grand_created = grand_updated = 0

        for dir_name, (pihps_code, kode_kab) in REGENCY_MAP.items():
            regency_dir = PER_REGENCY_DIR / dir_name
            if not regency_dir.exists():
                self.stdout.write(self.style.WARNING(f"  skip {dir_name}: directory not found"))
                continue

            kab = kab_cache.get(kode_kab)
            if kab is None:
                self.stdout.write(self.style.WARNING(
                    f"  skip {dir_name}: WilayahKabupaten kode={kode_kab} not found"
                ))
                continue

            csv_files = sorted(regency_dir.glob(f"*{SUFFIX}.csv"))
            if not csv_files:
                self.stdout.write(self.style.WARNING(f"  {dir_name}: no CSV files found"))
                continue

            reg_created = reg_updated = 0
            for csv_path in csv_files:
                slug = csv_path.stem.removesuffix(SUFFIX)
                pangan = pangan_cache.get(slug)
                if pangan is None:
                    self.stdout.write(self.style.WARNING(
                        f"    skip {csv_path.name}: Pangan slug='{slug}' not found for sumber_id=3"
                    ))
                    continue

                rows = self._load_sorted_rows(csv_path, pihps_code)
                if not rows:
                    continue

                created, updated = self._seed_commodity(pangan, kab, rows)
                reg_created += created
                reg_updated += updated

            grand_created += reg_created
            grand_updated += reg_updated
            self.stdout.write(f"  regency {dir_name}: {reg_created} created, {reg_updated} updated")

        self.stdout.write(self.style.SUCCESS(
            f"Seed complete: {grand_created} created, {grand_updated} updated "
            f"({grand_created + grand_updated} total)."
        ))

    def _load_sorted_rows(self, csv_path: Path, pihps_code: str) -> list[dict]:
        rows = []
        with csv_path.open(newline="") as f:
            for row in csv.DictReader(f):
                if row.get("kabupaten_kota", "").strip() != pihps_code:
                    continue
                try:
                    d = date.fromisoformat(row["date"])
                except (ValueError, KeyError):
                    continue
                harga_str = row.get("harga", "").strip()
                if not harga_str:
                    continue
                try:
                    harga = Decimal(harga_str)
                except Exception:
                    continue
                if harga <= 0:
                    continue
                rows.append({"date": d, "harga": harga})
        rows.sort(key=lambda r: r["date"])
        return rows

    def _seed_commodity(self, pangan: Pangan, kab, rows: list[dict]) -> tuple[int, int]:
        created = updated = 0
        prev_harga = None
        prev_date = None

        with transaction.atomic():
            for row in rows:
                is_up = (row["harga"] > prev_harga) if prev_harga is not None else None
                _, was_created = HargaPangan.objects.update_or_create(
                    pangan=pangan,
                    tanggal_update=row["date"],
                    kabupaten=kab,
                    defaults={
                        "harga_sekarang": row["harga"],
                        "harga_terakhir": prev_harga,
                        "tanggal_terakhir": prev_date,
                        "is_up": is_up,
                    },
                )
                prev_harga = row["harga"]
                prev_date = row["date"]
                if was_created:
                    created += 1
                else:
                    updated += 1

        return created, updated
