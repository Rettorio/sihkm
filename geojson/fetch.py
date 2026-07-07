import requests
import json

def download_maluku_geojson(admin_level, filename):
    print(f"Downloading Admin Level {admin_level} for Maluku...")
    
    # Query Overpass
    # level 4 = Provinsi, 5 = Kab/Kota, 6 = Kecamatan, 8 = Desa
    query = f"""
    [out:json][timeout:900][maxsize:1073741824];
    area["name"="Maluku"]["admin_level"="4"]->.searchArea;
    (
      relation["admin_level"="{admin_level}"](area.searchArea);
    );
    out geom;
    """
    
    url = "https://overpass-api.de/api/interpreter"
    headers = {
        'User-Agent': 'DjangoApp-Manggurebe-Extractor/1.0 (ardiansyahrukua07@gmail.com)',
        'Content-Type': 'application/x-www-form-urlencoded'
    }
    response = requests.post(url, data={'data': query}, headers=headers)
    
    if response.status_code == 200:
        data = response.json()
        # Simpan sementara sebagai JSON asli OSM
        with open(f"raw_{filename}", 'w') as f:
            json.dump(data, f)
        print(f"Success saving raw_{filename}")
    else:
        print(f"Error: {response.status_code}")

# Eksekusi untuk 3 level
download_maluku_geojson(5, "maluku_kabkota.json")
# download_maluku_geojson(6, "maluku_kecamatan.json")
# download_maluku_geojson(8, "maluku_desa.json")