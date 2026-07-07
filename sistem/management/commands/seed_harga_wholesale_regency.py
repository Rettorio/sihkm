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

KAB_MAP = {
    "77": "8171",  # Kota Ambon
    "78": "8172",  # Kota Tual
}


class Command(BaseCommand):
    help = "Seed HargaPangan (sumber_id=3) from PIHPS wholesale regency-aggregate CSVs."

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
                    "This will DELETE all HargaPangan rows linked to sumber_id=3. "
                    "Type 'yes' to continue: "
                )
                if ans.strip().lower() != "yes":
                    self.stdout.write("Aborted.")
                    return
            deleted, _ = HargaPangan.objects.filter(pangan__sumber_id=3).delete()
            self.stdout.write(f"Wholesale-regency HargaPangan cleared ({deleted} rows deleted).")

        if not PER_REGENCY_DIR.exists():
            self.stdout.write(self.style.ERROR(f"Directory not found: {PER_REGENCY_DIR}"))
            return

        pangan_cache = {p.slug: p for p in Pangan.objects.filter(sumber_id=3)}
        if not pangan_cache:
            self.stdout.write(self.style.ERROR(
                "No Pangan records found for sumber_id=3. "
                "Run: python manage.py seed_komoditas_pihps --sumber_id 3"
            ))
            return

        kab_cache = {k.kode_kabupaten: k for k in WilayahKabupaten.objects.all()}

        grand_created = grand_updated = 0

        for kab_dir in sorted(PER_REGENCY_DIR.iterdir()):
            if not kab_dir.is_dir():
                continue
            kode_kab = KAB_MAP.get(kab_dir.name)
            if not kode_kab:
                self.stderr.write(f"skip dir {kab_dir.name}: not in KAB_MAP")
                continue
            kabupaten = kab_cache.get(kode_kab)
            if kabupaten is None:
                self.stderr.write(f"skip dir {kab_dir.name}: kode_kabupaten '{kode_kab}' not in DB")
                continue

            self.stdout.write(f"Processing {kab_dir.name} → {kabupaten.nama}")

            for csv_path in sorted(kab_dir.glob(f"*{SUFFIX}.csv")):
                slug = csv_path.stem.removesuffix(SUFFIX)
                pangan = pangan_cache.get(slug)
                if pangan is None:
                    self.stdout.write(self.style.WARNING(
                        f"  skip {csv_path.name}: slug '{slug}' not in sumber_id=3"
                    ))
                    continue

                rows = self._load_sorted_rows(csv_path)
                if not rows:
                    continue

                created, updated = self._seed_commodity(pangan, kabupaten, rows)
                grand_created += created
                grand_updated += updated
                self.stdout.write(f"  {csv_path.name}: {created} created, {updated} updated")

        self.stdout.write(self.style.SUCCESS(
            f"Seed complete: {grand_created} created, {grand_updated} updated "
            f"({grand_created + grand_updated} total)."
        ))

    def _load_sorted_rows(self, csv_path: Path) -> list[dict]:
        rows = []
        with csv_path.open(newline="") as f:
            for row in csv.DictReader(f):
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

    def _seed_commodity(self, pangan: Pangan, kabupaten, rows: list[dict]) -> tuple[int, int]:
        _BATCH = 500
        objs = []
        prev = None

        for row in rows:
            harga_terakhir = prev["harga"] if prev else None
            tanggal_terakhir = prev["date"] if prev else None
            is_up = (row["harga"] > harga_terakhir) if harga_terakhir is not None else None

            objs.append(HargaPangan(
                pangan=pangan,
                tanggal_update=row["date"],
                harga_sekarang=row["harga"],
                harga_terakhir=harga_terakhir,
                tanggal_terakhir=tanggal_terakhir,
                is_up=is_up,
                kabupaten=kabupaten,
            ))
            prev = {"harga": row["harga"], "date": row["date"]}

        if not objs:
            return 0, 0

        created = 0
        with transaction.atomic():
            for i in range(0, len(objs), _BATCH):
                batch = objs[i : i + _BATCH]
                results = HargaPangan.objects.bulk_create(
                    batch,
                    update_conflicts=True,
                    unique_fields=["pangan", "tanggal_update", "kabupaten"],
                    update_fields=[
                        "harga_sekarang", "harga_terakhir",
                        "tanggal_terakhir", "is_up",
                    ],
                )
                for obj in results:
                    if obj._state.adding:
                        created += 1
        updated = len(objs) - created
        return created, updated
