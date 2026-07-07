import csv
from pathlib import Path

PROVINCE_CODE = "81"
RAW = Path(__file__).parent


def filter_kabupaten():
    codes = set()
    with (RAW / "kabupaten.csv").open(newline="") as src, \
         (RAW / "kabupaten_provinsi_maluku.csv").open("w", newline="") as dst:
        reader, writer = csv.reader(src), csv.writer(dst)
        n = 0
        for row in reader:
            if row[1] == PROVINCE_CODE:
                writer.writerow(row)
                codes.add(row[0])
                n += 1
        print(f"kabupaten_provinsi_maluku.csv — {n} rows")
    return codes


def filter_kecamatan(kab_codes):
    with (RAW / "kecamatan.csv").open(newline="") as src, \
         (RAW / "kecamatan_provinsi_maluku.csv").open("w", newline="") as dst:
        reader, writer = csv.reader(src), csv.writer(dst)
        n = 0
        for row in reader:
            if row[1] in kab_codes:
                writer.writerow(row)
                n += 1
        print(f"kecamatan_provinsi_maluku.csv — {n} rows")


if __name__ == "__main__":
    filter_kecamatan(filter_kabupaten())
