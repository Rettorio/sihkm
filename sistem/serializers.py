from rest_framework import serializers
from rest_framework_gis.serializers import GeoFeatureModelSerializer

from sistem.models import HargaPanganWholesaleMarket, HargaSnapshot, ModelFoldEvaluation, Pangan, WilayahKabupaten, WilayahPasar
from sistem.services.predictor import HorizonPrediction, PrediksiResult


class KabupatenSerializer(serializers.ModelSerializer):
    kode = serializers.CharField(source="kode_kabupaten")

    class Meta:
        model = WilayahKabupaten
        fields = ["kode", "nama"]


class KabupatenGeoJSONSerializer(GeoFeatureModelSerializer):
    class Meta:
        model = WilayahKabupaten
        geo_field = "geom"
        fields = ["kode_kabupaten", "nama"]


class KomoditasSerializer(serializers.ModelSerializer):
    id = serializers.CharField(source="master_id")

    class Meta:
        model = Pangan
        fields = ["id", "nama", "satuan", "harga_acuan", "slug"]


class PasarSerializer(serializers.ModelSerializer):
    kabupaten = serializers.CharField(source="kabupaten.kode_kabupaten")

    class Meta:
        model = WilayahPasar
        fields = ["id", "market_id", "nama", "slug", "kabupaten"]


class HargaUpdateRequestSerializer(serializers.Serializer):
    tipe_pasar = serializers.IntegerField()
    kabupaten = serializers.CharField()
    start_date = serializers.DateField(input_formats=["%d-%m-%Y"])
    end_date = serializers.DateField(input_formats=["%d-%m-%Y"])

    def validate(self, data):
        if data["start_date"] > data["end_date"]:
            raise serializers.ValidationError("start_date must be before or equal to end_date.")
        return data


class HorizonPredictionSerializer(serializers.Serializer):
    horizon              = serializers.IntegerField()
    predicted_change_pct = serializers.FloatField()
    predicted_harga_lkv  = serializers.FloatField()
    is_up                = serializers.BooleanField()
    periode_start        = serializers.DateField()
    periode_end          = serializers.DateField()


class PrediksiResultSerializer(serializers.Serializer):
    komoditas   = serializers.SerializerMethodField()
    kabupaten   = serializers.SerializerMethodField()
    periode_tipe = serializers.CharField()
    current     = serializers.SerializerMethodField()
    predictions = HorizonPredictionSerializer(many=True)
    model_meta  = serializers.SerializerMethodField()

    def get_komoditas(self, obj: PrediksiResult):
        return {
            "id": obj.pangan_id,
            "nama": obj.pangan_nama,
            "satuan": obj.pangan_satuan,
            "harga_acuan": obj.pangan_harga_acuan,
        }

    def get_kabupaten(self, obj: PrediksiResult):
        return {"kode": obj.kabupaten_kode, "nama": obj.kabupaten_nama}

    def get_current(self, obj: PrediksiResult):
        return {
            "harga_lkv": obj.current_harga_lkv,
            "change_pct": obj.current_change_pct,
            "periode_start": str(obj.current_periode_start),
            "periode_end": str(obj.current_periode_end),
        }

    def get_model_meta(self, obj: PrediksiResult):
        return {
            "trained_at": obj.model_trained_at,
            "train_periods": obj.train_periods,
            "eval_mae_h1": obj.eval_mae_h1,
            "eval_mae_h4": obj.eval_mae_h4,
            "eval_mape_h1": obj.eval_mape_h1,
            "eval_mape_h4": obj.eval_mape_h4,
            "eval_rmse_h1": obj.eval_rmse_h1,
            "eval_rmse_h4": obj.eval_rmse_h4,
        }


class ModelFoldEvaluationSerializer(serializers.ModelSerializer):
    class Meta:
        model  = ModelFoldEvaluation
        fields = [
            "id", "horizon", "fold",
            "periode_start", "periode_end",
            "actual_log_return", "predicted_log_return",
            "actual_harga_lkv", "predicted_harga_lkv",
            "abs_pct_error",
        ]


class HargaSnapshotSerializer(serializers.ModelSerializer):
    pangan_id   = serializers.CharField(source="pangan.master_id")
    pangan_nama = serializers.CharField(source="pangan.nama")
    kabupaten   = serializers.CharField(source="kabupaten.kode_kabupaten")

    class Meta:
        model  = HargaSnapshot
        fields = [
            "pangan_id", "pangan_nama", "kabupaten",
            "periode_tipe", "periode_tahun", "periode_nomor",
            "periode_start", "periode_end",
            "harga_lkv", "tanggal_lkv", "is_locf",
            "harga_lkv_prev", "harga_delta", "change_pct", "is_up",
            "harga_lag1", "harga_lag2", "harga_lag3",
        ]
