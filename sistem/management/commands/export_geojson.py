import json
from pathlib import Path

from django.core.management.base import BaseCommand

from sistem.models import WilayahKabupaten
from sistem.serializers import KabupatenGeoJSONSerializer


class Command(BaseCommand):
    help = "Export kabupaten GeoJSON to fe-sihkp/public/kabupaten.geojson"

    def handle(self, *args, **options):
        qs = WilayahKabupaten.objects.all()
        serializer = KabupatenGeoJSONSerializer(qs, many=True)
        output_path = (
            Path(__file__).resolve().parents[4] / "shppm" / "fe-sihkp" / "public" / "kabupaten.geojson"
        )
        output_path.write_text(json.dumps(serializer.data), encoding="utf-8")
        self.stdout.write(self.style.SUCCESS(f"Exported {qs.count()} features → {output_path}"))
