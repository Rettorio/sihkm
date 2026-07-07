import csv
import json
from pathlib import Path

import osm2geojson
from django.contrib.gis.geos import GEOSGeometry, MultiPolygon
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from sistem.models import WilayahDesa, WilayahKabupaten, WilayahKecamatan

BASE_DIR = Path(__file__).resolve().parents[3]
RAW_DATA = BASE_DIR / "raw_data"
GEOJSON = BASE_DIR / "geojson"

CSV_KAB = RAW_DATA / "kabupaten_provinsi_maluku.csv"
CSV_KEC = RAW_DATA / "kecamatan_provinsi_maluku.csv"
CSV_DESA = RAW_DATA / "desa_provinsi_maluku.csv"
OSM_KAB = GEOJSON / "raw_maluku_kabkota.json"


def _swap_lnglat_to_latlng(coords):
    """Recursively walk a GeoJSON coordinate tree and swap each leaf [lng, lat] to [lat, lng]."""
    if (
        isinstance(coords, list)
        and len(coords) >= 2
        and all(isinstance(c, (int, float)) for c in coords[:2])
    ):
        return [coords[1], coords[0]]
    return [_swap_lnglat_to_latlng(c) for c in coords]


def load_kab_polygons():
    """Return {NORMALIZED_OFFICIAL_NAME: (GEOSGeometry MultiPolygon, koordinat_json_str)}."""
    with OSM_KAB.open() as f:
        raw = json.load(f)
    fc = osm2geojson.json2geojson(raw)

    polys = {}
    for feature in fc.get("features", []):
        tags = feature.get("properties", {}).get("tags", {})
        official = tags.get("official_name") or tags.get("name")
        if not official:
            continue
        key = official.strip().upper()

        geom_dict = feature.get("geometry")
        if not geom_dict:
            continue

        geom = GEOSGeometry(json.dumps(geom_dict), srid=4326)
        if geom.geom_type == "Polygon":
            geom = MultiPolygon([geom], srid=4326)
        elif geom.geom_type != "MultiPolygon":
            continue

        koord = json.dumps(_swap_lnglat_to_latlng(geom_dict["coordinates"]))
        polys[key] = (geom, koord)
    return polys


def _iter_csv(path):
    with path.open(newline="") as f:
        for row in csv.reader(f):
            yield row


class Command(BaseCommand):
    help = "Seed WilayahKabupaten/Kecamatan/Desa from raw_data CSVs and geojson/ OSM JSON."

    def add_arguments(self, parser):
        parser.add_argument(
            "--reset",
            action="store_true",
            help="Delete all rows in the three tables before seeding (prompts for confirmation).",
        )
        parser.add_argument(
            "--noinput",
            action="store_true",
            help="Skip the confirmation prompt when used with --reset.",
        )

    def handle(self, *args, reset=False, noinput=False, **opts):
        for p in (CSV_KAB, CSV_KEC, CSV_DESA, OSM_KAB):
            if not p.exists():
                raise CommandError(f"Required input missing: {p}")

        if reset:
            if not noinput:
                ans = input(
                    "This will DELETE all rows in WilayahDesa/Kecamatan/Kabupaten. Type 'yes' to continue: "
                )
                if ans.strip().lower() != "yes":
                    self.stdout.write("Aborted.")
                    return
            WilayahDesa.objects.all().delete()
            WilayahKecamatan.objects.all().delete()
            WilayahKabupaten.objects.all().delete()

        self.stdout.write("Loading kabupaten polygons from OSM JSON…")
        kab_polys = load_kab_polygons()
        self.stdout.write(f"  {len(kab_polys)} polygons indexed by official_name")

        with transaction.atomic():
            kab_total, kab_with_geom, kab_skipped = self._seed_kabupaten(kab_polys)
            kec_total, kec_skipped = self._seed_kecamatan()
            desa_total, desa_skipped = self._seed_desa()

        self.stdout.write(self.style.SUCCESS("Seed complete:"))
        self.stdout.write(
            f"  kabupaten — {kab_total} rows  (geom: {kab_with_geom}, skipped: {kab_skipped})"
        )
        self.stdout.write(f"  kecamatan — {kec_total} rows  (geom: 0, skipped: {kec_skipped})")
        self.stdout.write(f"  desa      — {desa_total} rows  (geom: 0, skipped: {desa_skipped})")

    def _parse_latlon(self, lat, lon):
        if lat == "" or lon == "":
            return None
        return float(lat), float(lon)

    def _seed_kabupaten(self, kab_polys):
        total = with_geom = skipped = 0
        for row in _iter_csv(CSV_KAB):
            kode_kab, _kode_prov, nama, lat, lon = row[0], row[1], row[2].strip(), row[3], row[4]
            latlon = self._parse_latlon(lat, lon)
            if latlon is None:
                self.stdout.write(
                    self.style.WARNING(f"  skip kabupaten {kode_kab} ({nama}): missing lat/lon")
                )
                skipped += 1
                continue

            poly = kab_polys.get(nama.upper())
            if poly is None:
                self.stdout.write(
                    self.style.WARNING(f"  no polygon match for kabupaten '{nama}' ({kode_kab})")
                )
                geom, koordinat = None, ""
            else:
                geom, koordinat = poly
                with_geom += 1

            WilayahKabupaten.objects.update_or_create(
                kode_kabupaten=kode_kab,
                defaults={
                    "nama": nama,
                    "lat": latlon[0],
                    "long": latlon[1],
                    "koordinat": koordinat,
                    "geom": geom,
                },
            )
            total += 1
        return total, with_geom, skipped

    def _seed_kecamatan(self):
        kab_cache = {k.pk: k for k in WilayahKabupaten.objects.all()}
        total = skipped = 0
        for row in _iter_csv(CSV_KEC):
            kode_kec, kode_kab, nama, lat, lon = row[0], row[1], row[2].strip(), row[3], row[4]
            latlon = self._parse_latlon(lat, lon)
            if latlon is None:
                self.stdout.write(
                    self.style.WARNING(f"  skip kecamatan {kode_kec} ({nama}): missing lat/lon")
                )
                skipped += 1
                continue

            kab = kab_cache.get(kode_kab)
            if kab is None:
                raise CommandError(
                    f"kecamatan {kode_kec} references unknown kabupaten {kode_kab}"
                )
            WilayahKecamatan.objects.update_or_create(
                kode_kecamatan=kode_kec,
                defaults={
                    "nama": nama,
                    "kabupaten": kab,
                    "lat": latlon[0],
                    "long": latlon[1],
                    "koordinat": "",
                    "geom": None,
                },
            )
            total += 1
        return total, skipped

    def _seed_desa(self):
        kec_cache = {k.pk: k for k in WilayahKecamatan.objects.select_related("kabupaten").all()}
        total = skipped = 0
        for row in _iter_csv(CSV_DESA):
            kode_desa, kode_kec, nama, lat, lon = row[0], row[1], row[2].strip(), row[3], row[4]
            latlon = self._parse_latlon(lat, lon)
            if latlon is None:
                self.stdout.write(
                    self.style.WARNING(f"  skip desa {kode_desa} ({nama}): missing lat/lon")
                )
                skipped += 1
                continue

            kec = kec_cache.get(kode_kec)
            if kec is None:
                self.stdout.write(
                    self.style.WARNING(
                        f"  skip desa {kode_desa} ({nama}): parent kecamatan {kode_kec} not seeded"
                    )
                )
                skipped += 1
                continue

            WilayahDesa.objects.update_or_create(
                kode_desa=kode_desa,
                defaults={
                    "nama": nama,
                    "kabupaten": kec.kabupaten,
                    "kecamatan": kec,
                    "lat": latlon[0],
                    "long": latlon[1],
                    "koordinat": "",
                    "geom": None,
                },
            )
            total += 1
        return total, skipped
