import csv
from datetime import date
from decimal import Decimal
from pathlib import Path

from django.core.management.base import BaseCommand
from django.db import transaction

from sistem.models import HargaPangan, Pangan, WilayahKabupaten

BASE_DIR = Path(__file__).resolve().parents[3]
HARGA_HARIAN_DIR = BASE_DIR / "raw_data" / "harga_harian_pihps"
SUFFIX = "_harga_harian"

KAB_MAP = {
    "31_77": "8171",
    "31_78": "8172",
}


class Command(BaseCommand):
    help = "Seed HargaPangan (sumber_id=2) from PIHPS pasar-modern CSVs."

    def add_arguments(self, parser):
        parser.add_argument(
            "--reset", action="store_true",
            help="Delete all HargaPangan rows with sumber_id=2 before seeding.",
        )
        parser.add_argument(
            "--noinput", action="store_true",
            help="Skip confirmation prompt.",
        )

    def handle(self, *args, reset=False, noinput=False, **opts):
        if reset:
            if not noinput:
                ans = input(
                    "This will DELETE all HargaPangan rows linked to sumber_id=2. "
                    "Type 'yes' to continue: "
                )
                if ans.strip().lower() != "yes":
                    self.stdout.write("Aborted.")
                    return
            deleted, _ = HargaPangan.objects.filter(pangan__sumber_id=2).delete()
            self.stdout.write(f"PIHPS HargaPangan cleared ({deleted} rows deleted).")

        if not HARGA_HARIAN_DIR.exists():
            self.stdout.write(self.style.ERROR(f"Directory not found: {HARGA_HARIAN_DIR}"))
            return

        csv_files = sorted(HARGA_HARIAN_DIR.glob(f"*{SUFFIX}.csv"))
        if not csv_files:
            self.stdout.write(self.style.WARNING(f"No CSV files found in {HARGA_HARIAN_DIR}"))
            return

        pangan_cache = {
            p.slug: p
            for p in Pangan.objects.filter(sumber_id=2)
        }
        kab_cache = {k.kode_kabupaten: k for k in WilayahKabupaten.objects.all()}

        grand_created = grand_updated = 0

        for csv_path in csv_files:
            slug = csv_path.stem.removesuffix(SUFFIX)
            pangan = pangan_cache.get(slug)
            if pangan is None:
                self.stdout.write(self.style.WARNING(
                    f"  skip {csv_path.name}: Pangan slug='{slug}' not found for sumber_id=2"
                ))
                continue

            rows = self._load_sorted_rows(csv_path, kab_cache)
            if not rows:
                continue

            created, updated = self._seed_commodity(pangan, rows)
            grand_created += created
            grand_updated += updated
            self.stdout.write(f"  {csv_path.name}: {created} created, {updated} updated")

        self.stdout.write(self.style.SUCCESS(
            f"Seed complete: {grand_created} created, {grand_updated} updated "
            f"({grand_created + grand_updated} total)."
        ))

    def _load_sorted_rows(self, csv_path: Path, kab_cache: dict) -> list[dict]:
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

                pihps_kab = row.get("kabupaten_kota", "").strip()
                kode_kab = KAB_MAP.get(pihps_kab)
                if not kode_kab:
                    continue
                kab = kab_cache.get(kode_kab)
                if kab is None:
                    continue

                rows.append({
                    "date": d,
                    "kab": kab,
                    "harga": harga,
                })
        rows.sort(key=lambda r: (r["kab"].kode_kabupaten, r["date"]))
        return rows

    def _seed_commodity(self, pangan: Pangan, rows: list[dict]) -> tuple[int, int]:
        _BATCH = 500
        objs = []
        prev: dict[str, dict] = {}

        for row in rows:
            kode = row["kab"].kode_kabupaten
            last = prev.get(kode)
            harga_terakhir = last["harga"] if last else None
            tanggal_terakhir = last["date"] if last else None
            is_up = (row["harga"] > harga_terakhir) if harga_terakhir is not None else None

            objs.append(HargaPangan(
                pangan=pangan,
                tanggal_update=row["date"],
                harga_sekarang=row["harga"],
                harga_terakhir=harga_terakhir,
                tanggal_terakhir=tanggal_terakhir,
                is_up=is_up,
                kabupaten=row["kab"],
            ))
            prev[kode] = {"harga": row["harga"], "date": row["date"]}

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
