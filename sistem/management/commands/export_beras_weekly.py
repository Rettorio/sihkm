import csv
import os

from django.core.management.base import BaseCommand

from sistem.models import HargaSnapshot

COMMODITY_NAMES = ["Beras Medium", "Beras Premium"]
SLUG_MAP = {
    "Beras Medium": "beras_medium",
    "Beras Premium": "beras_premium",
}

COLUMNS = [
    "periode_tahun",
    "periode_nomor",
    "periode_start",
    "periode_end",
    "kabupaten_kode",
    "kabupaten_nama",
    "harga_lkv",
    "is_locf",
    "is_up",
    "harga_delta",
    "change_pct",
    "harga_lag1",
    "harga_lag2",
    "harga_lag3",
]


class Command(BaseCommand):
    help = "Export weekly HargaSnapshot for Beras Medium and Beras Premium to CSV."

    def add_arguments(self, parser):
        parser.add_argument(
            "--sumber_id",
            type=int,
            default=1,
            help="Market source ID on Pangan (default: 1).",
        )
        parser.add_argument(
            "--out_dir",
            default="notebooks/data",
            help="Output directory for CSV files (default: notebooks/data).",
        )

    def handle(self, *args, **options):
        sumber_id = options["sumber_id"]
        out_dir = options["out_dir"]

        os.makedirs(out_dir, exist_ok=True)

        for nama in COMMODITY_NAMES:
            slug = SLUG_MAP[nama]
            out_path = os.path.join(out_dir, f"{slug}_weekly.csv")

            qs = (
                HargaSnapshot.objects
                .filter(
                    pangan__nama=nama,
                    pangan__sumber_id=sumber_id,
                    periode_tipe="weekly",
                )
                .select_related("pangan", "kabupaten")
                .order_by("kabupaten__kode_kabupaten", "periode_tahun", "periode_nomor")
                .values(
                    "periode_tahun",
                    "periode_nomor",
                    "periode_start",
                    "periode_end",
                    "kabupaten__kode_kabupaten",
                    "kabupaten__nama",
                    "harga_lkv",
                    "is_locf",
                    "is_up",
                    "harga_delta",
                    "change_pct",
                    "harga_lag1",
                    "harga_lag2",
                    "harga_lag3",
                )
            )

            rows = list(qs)
            if not rows:
                self.stdout.write(self.style.WARNING(f"  No data for {nama}, skipping."))
                continue

            with open(out_path, "w", newline="", encoding="utf-8") as f:
                writer = csv.DictWriter(f, fieldnames=COLUMNS)
                writer.writeheader()
                for row in rows:
                    writer.writerow({
                        "periode_tahun": row["periode_tahun"],
                        "periode_nomor": row["periode_nomor"],
                        "periode_start": row["periode_start"],
                        "periode_end":   row["periode_end"],
                        "kabupaten_kode": row["kabupaten__kode_kabupaten"],
                        "kabupaten_nama": row["kabupaten__nama"],
                        "harga_lkv":   row["harga_lkv"],
                        "is_locf":     int(row["is_locf"]),
                        "is_up":       int(row["is_up"]) if row["is_up"] is not None else "",
                        "harga_delta": row["harga_delta"] if row["harga_delta"] is not None else "",
                        "change_pct":  row["change_pct"]  if row["change_pct"]  is not None else "",
                        "harga_lag1":  row["harga_lag1"]  if row["harga_lag1"]  is not None else "",
                        "harga_lag2":  row["harga_lag2"]  if row["harga_lag2"]  is not None else "",
                        "harga_lag3":  row["harga_lag3"]  if row["harga_lag3"]  is not None else "",
                    })

            self.stdout.write(
                self.style.SUCCESS(f"  {nama}: {len(rows)} rows → {out_path}")
            )
