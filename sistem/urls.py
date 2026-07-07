from django.urls import path
from django.conf import settings
from django.conf.urls.static import static

from sistem.views import (
    AnalisisSnapshotView,
    HargaPetaOptionsView,
    HargaPetaView,
    HargaPrediksiView,
    HargaSnapshotListView,
    HargaSnapshotWideView,
    HargaUpdateView,
    KabupatenGeoJSONView,
    KabupatenListView,
    KomoditasListView,
    ModelFoldEvaluationView,
    PantauHargaInitialView,
    PasarListView,
    PrediksiReconciliationView,
    WholesaleSideBySideView,
)

urlpatterns = [
    path("kabupaten/", KabupatenListView.as_view(), name="kabupaten-list"),
    path("kabupaten/geojson/", KabupatenGeoJSONView.as_view(), name="kabupaten-geojson"),
    path("komoditas/", KomoditasListView.as_view(), name="komoditas-list"),
    path("harga/update/", HargaUpdateView.as_view(), name="harga-update"),
    path("harga/peta/", HargaPetaView.as_view(), name="harga-peta"),
    path("harga/peta/options/", HargaPetaOptionsView.as_view(), name="harga-peta-options"),
    path("harga/peta/initial/", PantauHargaInitialView.as_view(), name="harga-peta-initial"),
    path("harga/snapshot/", HargaSnapshotListView.as_view(), name="harga-snapshot-list"),
    path("harga/snapshot/wide/", HargaSnapshotWideView.as_view(), name="harga-snapshot-wide"),
    path("harga/prediksi/", HargaPrediksiView.as_view(), name="harga-prediksi"),
    path("harga/prediksi/reconciliation/", PrediksiReconciliationView.as_view(), name="harga-prediksi-reconciliation"),
    path("harga/prediksi/evaluation/", ModelFoldEvaluationView.as_view(), name="harga-prediksi-evaluation"),
    path("harga/pasar/", PasarListView.as_view(), name="pasar-list"),
    path("harga/wholesale/side-by-side/", WholesaleSideBySideView.as_view(), name="wholesale-side-by-side"),
    path("harga/analisis/snapshot/", AnalisisSnapshotView.as_view(), name="analisis-snapshot"),
]

if settings.DEBUG:
    urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)
