from decimal import Decimal

from django.contrib.gis.db import models
from django.core.validators import MinValueValidator



class WilayahKabupaten(models.Model):
    nama = models.CharField(max_length=200,default="")
    kode_kabupaten = models.CharField(max_length=100,primary_key=True)
    lat = models.FloatField()
    long = models.FloatField()
    koordinat = models.TextField()
    geom = models.MultiPolygonField(srid=4326,blank=True,null=True)


    def __str__(self):
        return self.nama


class WilayahKecamatan(models.Model):
    nama = models.CharField(max_length=200,default="")
    kabupaten = models.ForeignKey(WilayahKabupaten,null=True,blank=True,on_delete=models.CASCADE)
    kode_kecamatan = models.CharField(max_length=100,primary_key=True)
    lat = models.FloatField()
    long = models.FloatField()
    koordinat = models.TextField()
    geom = models.MultiPolygonField(srid=4326,blank=True,null=True)


    def __str__(self):
        return self.nama


    class Meta:
        unique_together = ['kabupaten','kode_kecamatan']


class WilayahDesa(models.Model):
    nama = models.CharField(max_length=200,default="")
    kabupaten = models.ForeignKey(WilayahKabupaten,null=True,blank=True,on_delete=models.CASCADE,related_name="relasi_wil_kabupaten")
    kecamatan = models.ForeignKey(WilayahKecamatan,null=True,blank=True,on_delete=models.CASCADE,related_name="relasi_wil_kecamatan")
    kode_desa = models.CharField(max_length=100,primary_key=True)
    lat = models.FloatField()
    long = models.FloatField()
    koordinat = models.TextField()
    geom = models.MultiPolygonField(srid=4326,blank=True,null=True)


    def __str__(self):
        return self.nama


    class Meta:
        unique_together = ['kabupaten','kecamatan','kode_desa']

class Pangan(models.Model):
    """
    Master Komoditas Pangan
    """
    nama = models.CharField(max_length=255, null=False)
    slug = models.CharField(max_length=100, default="", blank=True)
    harga_acuan = models.DecimalField(max_digits=12, decimal_places=3, null=True, blank=True)
    satuan = models.CharField(max_length=255,blank=True,null=True)
    master_id = models.CharField(max_length=20)
    sumber_id = models.PositiveSmallIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['sumber_id', 'master_id'], name='unique_master_per_sumber'),
            models.UniqueConstraint(fields=['sumber_id', 'slug'], name='unique_slug_per_sumber'),
            models.UniqueConstraint(fields=['sumber_id', 'nama'], name='unique_nama_per_sumber'),
        ]



class HargaPangan(models.Model):
    """
    Harga harian pangan
    """
    pangan = models.ForeignKey(Pangan, on_delete=models.CASCADE)
    tanggal_update = models.DateField()
    harga_sekarang = models.DecimalField(
        max_digits=12, decimal_places=3,
        validators=[MinValueValidator(Decimal("0.001"))],
    )
    # untuk harga terakhir nullablle karena first entry belum ada
    # harga terakhir
    harga_terakhir = models.DecimalField(max_digits=12,decimal_places=3, null=True,blank=True,default=None)
    tanggal_terakhir = models.DateField(null=True,blank=True, default=None)
    # di nullkan dulu akan update not null/empty setelah di seeding
    # is_up jika harga_sekarang > harga_terakhir which usually means bad/price increase
    is_up = models.BooleanField(name='is_up',blank=True,null=True)
    kabupaten = models.ForeignKey(WilayahKabupaten, on_delete=models.DO_NOTHING)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['pangan', 'tanggal_update', 'kabupaten'],
                name='unique_pangan_harian_kabupaten',
                nulls_distinct=False
            )
        ]
        indexes = [
            models.Index(
                fields=['pangan', 'kabupaten', 'tanggal_update'],
                name='idx_hargapangan_stream',
            ),
            models.Index(
                fields=['pangan', 'tanggal_update'],
                name='idx_hargapangan_pangan_date',
            ),
        ]


class WilayahPasar(models.Model):
    market_id = models.IntegerField(unique=True)
    nama = models.CharField(max_length=255)
    slug = models.CharField(max_length=100)
    kabupaten = models.ForeignKey(WilayahKabupaten, on_delete=models.CASCADE)
    tipe_pasar = models.PositiveSmallIntegerField(default=3)

    def __str__(self):
        return f"{self.nama} ({self.market_id})"


class HargaPanganWholesaleMarket(models.Model):
    pangan = models.ForeignKey(Pangan, on_delete=models.CASCADE)
    pasar = models.ForeignKey(WilayahPasar, on_delete=models.CASCADE)
    tanggal_update = models.DateField()
    harga = models.DecimalField(max_digits=12, decimal_places=3)
    kabupaten = models.ForeignKey(WilayahKabupaten, on_delete=models.DO_NOTHING)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['pangan', 'pasar', 'tanggal_update'],
                name='unique_wholesale_market_daily',
            )
        ]
        indexes = [
            models.Index(
                fields=['pangan', 'kabupaten', 'tanggal_update'],
                name='idx_wholesale_market_stream',
            ),
        ]


class HargaSnapshot(models.Model):
    """
    Gold table: pre-computed LPIT snapshots per (pangan, kabupaten, periode).
    Written by the aggregator; read by the API and forecasting feature.
    """
    pangan        = models.ForeignKey(Pangan, on_delete=models.CASCADE, db_index=False)
    kabupaten     = models.ForeignKey(WilayahKabupaten, on_delete=models.DO_NOTHING, db_index=False)
    pasar         = models.ForeignKey(WilayahPasar, on_delete=models.CASCADE, null=True, blank=True, db_index=False)
    periode_tipe  = models.CharField(max_length=12)          # 'weekly'|'monthly'|'quarterly'|'semesterly'
    periode_tahun = models.PositiveSmallIntegerField()        # ISO year (weekly) or calendar year
    periode_nomor = models.PositiveSmallIntegerField()        # week#, month#, quarter#, semester#

    periode_start = models.DateField()
    periode_end   = models.DateField()

    harga_lkv   = models.DecimalField(max_digits=12, decimal_places=3)
    tanggal_lkv = models.DateField()
    is_locf     = models.BooleanField(default=False)

    harga_lkv_prev = models.DecimalField(max_digits=12, decimal_places=3, null=True, blank=True)
    harga_delta    = models.DecimalField(max_digits=12, decimal_places=3, null=True, blank=True)
    change_pct     = models.DecimalField(max_digits=8,  decimal_places=4, null=True, blank=True)
    is_up          = models.BooleanField(null=True, blank=True)

    harga_lag1 = models.DecimalField(max_digits=12, decimal_places=3, null=True, blank=True)
    harga_lag2 = models.DecimalField(max_digits=12, decimal_places=3, null=True, blank=True)
    harga_lag3 = models.DecimalField(max_digits=12, decimal_places=3, null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['pangan', 'kabupaten', 'pasar', 'periode_tipe', 'periode_tahun', 'periode_nomor'],
                name='unique_snapshot_periode',
                nulls_distinct=False,
            )
        ]
        indexes = [
            models.Index(
                fields=['pangan', 'kabupaten', 'periode_tipe', 'periode_tahun', 'periode_nomor'],
                name='idx_snapshot_stream',
            ),
            models.Index(
                fields=['kabupaten', 'periode_tipe', 'periode_tahun', 'periode_nomor'],
                name='idx_snapshot_kab_period',
            ),
        ]


class PrediksiArtifact(models.Model):
    """
    Tracks trained XGBoost model artifacts for the Prediksi forecasting feature.
    One artifact per (pangan, kabupaten, periode_tipe) stream.
    The actual model bytes live in artifact_path on disk.
    """
    pangan       = models.ForeignKey(Pangan, on_delete=models.CASCADE)
    kabupaten    = models.ForeignKey(WilayahKabupaten, on_delete=models.CASCADE)
    periode_tipe = models.CharField(max_length=12)

    artifact_path            = models.CharField(max_length=255)
    trained_at               = models.DateField()
    train_periods            = models.PositiveIntegerField()
    last_snapshot_period_end = models.DateField()
    eval_mae_h1              = models.DecimalField(max_digits=8, decimal_places=4, null=True, blank=True)
    eval_mae_h4              = models.DecimalField(max_digits=8, decimal_places=4, null=True, blank=True)
    eval_mape_h1             = models.DecimalField(max_digits=8, decimal_places=4, null=True, blank=True)
    eval_mape_h4             = models.DecimalField(max_digits=8, decimal_places=4, null=True, blank=True)
    eval_rmse_h1             = models.DecimalField(max_digits=10, decimal_places=4, null=True, blank=True)
    eval_rmse_h4             = models.DecimalField(max_digits=10, decimal_places=4, null=True, blank=True)
    is_available             = models.BooleanField(default=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [("pangan", "kabupaten", "periode_tipe")]

    def __str__(self):
        return f"PrediksiArtifact({self.pangan.nama}, {self.kabupaten.kode_kabupaten}, {self.periode_tipe})"


class ModelFoldEvaluation(models.Model):
    """
    Per-row walk-forward validation results for one (artifact, horizon, fold).
    Captures the individual prediction-vs-actual comparison that was previously
    discarded after aggregate metric computation. Enables error-pattern analysis,
    bias detection, and accuracy-over-time plots.
    """
    artifact  = models.ForeignKey(PrediksiArtifact, on_delete=models.CASCADE, related_name="fold_evaluations")
    horizon   = models.PositiveSmallIntegerField()
    fold      = models.PositiveSmallIntegerField()

    periode_start = models.DateField()
    periode_end   = models.DateField()
    periode_tahun = models.PositiveSmallIntegerField()
    periode_nomor = models.PositiveSmallIntegerField()

    actual_log_return     = models.FloatField()
    predicted_log_return  = models.FloatField()
    actual_harga_lkv      = models.FloatField()
    predicted_harga_lkv   = models.FloatField()
    abs_pct_error         = models.FloatField()

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [("artifact", "horizon", "fold", "periode_tahun", "periode_nomor")]
        indexes = [
            models.Index(fields=["artifact", "horizon"], name="idx_foldeval_artifact_horizon"),
        ]


class PredictionLog(models.Model):
    """
    Logs forward predictions so they can be reconciled with actual data when it
    arrives. Each row represents one horizon step from one prediction request.
    `actual_harga_lkv` / `actual_change_pct` are filled in later by the
    `reconcile_predictions` management command once the corresponding snapshot
    exists in HargaSnapshot.
    """
    artifact   = models.ForeignKey(PrediksiArtifact, on_delete=models.CASCADE, related_name="prediction_logs")
    horizon    = models.PositiveSmallIntegerField()
    predicted_at = models.DateTimeField(auto_now_add=True)

    periode_start   = models.DateField()
    periode_end     = models.DateField()
    periode_tahun   = models.PositiveSmallIntegerField()
    periode_nomor   = models.PositiveSmallIntegerField()

    predicted_harga_lkv    = models.DecimalField(max_digits=12, decimal_places=3)
    predicted_change_pct   = models.DecimalField(max_digits=8, decimal_places=4)

    actual_harga_lkv       = models.DecimalField(max_digits=12, decimal_places=3, null=True, blank=True)
    actual_change_pct      = models.DecimalField(max_digits=8, decimal_places=4, null=True, blank=True)
    is_reconciled          = models.BooleanField(default=False)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [("artifact", "horizon", "periode_tahun", "periode_nomor", "predicted_at")]
        indexes = [
            models.Index(fields=["artifact", "is_reconciled"], name="idx_predlog_reconcile"),
        ]
