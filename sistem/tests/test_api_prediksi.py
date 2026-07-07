"""
Blackbox tests for the HargaPrediksi API endpoint.

Covers test scenarios:
  16 — Valid prediction request → JSON H+1–H+4 with direction
  17 — Invalid kabupaten code → 404
  18 — Invalid komoditas ID → 404
"""

from datetime import date
from unittest.mock import patch

from django.test import TestCase, Client

from sistem.services.predictor import HorizonPrediction, PrediksiResult


# ===========================================================================
# Test 17 & 18 — Validation & 404 error paths
# ===========================================================================

class HargaPrediksiErrorTest(TestCase):
    """Tests 17, 18: Parameter validation and 404 handling."""

    def setUp(self):
        self.client = Client()

    # -- 400: Missing required params --------------------------------------

    def test_missing_komoditas_id(self):
        """Tanpa komoditas_id → 400."""
        resp = self.client.get("/api/harga/prediksi/")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("komoditas_id", resp.json().get("error", ""))

    def test_missing_kabupaten(self):
        """Tanpa kabupaten → 400."""
        resp = self.client.get("/api/harga/prediksi/?komoditas_id=13")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("kabupaten", resp.json().get("error", ""))

    def test_invalid_tipe(self):
        """Tipe tidak dikenal → 400."""
        resp = self.client.get(
            "/api/harga/prediksi/?komoditas_id=13&kabupaten=8171&tipe=hourly"
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("tipe", resp.json().get("error", ""))

    def test_invalid_horizon_too_large(self):
        """Horizon > 6 → 400."""
        resp = self.client.get(
            "/api/harga/prediksi/?komoditas_id=13&kabupaten=8171&horizon=99"
        )
        self.assertEqual(resp.status_code, 400)

    def test_invalid_horizon_not_int(self):
        """Horizon bukan integer → 400."""
        resp = self.client.get(
            "/api/harga/prediksi/?komoditas_id=13&kabupaten=8171&horizon=abc"
        )
        self.assertEqual(resp.status_code, 400)

    def test_invalid_tipe_pasar(self):
        """tipe_pasar bukan integer → 400."""
        resp = self.client.get(
            "/api/harga/prediksi/?komoditas_id=13&kabupaten=8171&tipe_pasar=abc"
        )
        self.assertEqual(resp.status_code, 400)

    # -- 404: model_not_available ------------------------------------------

    def test_nonexistent_kabupaten(self):
        """Test 17: Kode kabupaten tidak valid → 404 model_not_available."""
        resp = self.client.get(
            "/api/harga/prediksi/?komoditas_id=13&kabupaten=0000"
        )
        self.assertEqual(resp.status_code, 404)
        self.assertEqual(resp.json().get("error"), "model_not_available")

    def test_nonexistent_komoditas(self):
        """Test 18: ID komoditas tidak ada → 404 model_not_available."""
        resp = self.client.get(
            "/api/harga/prediksi/?komoditas_id=99999&kabupaten=8171"
        )
        self.assertEqual(resp.status_code, 404)
        self.assertEqual(resp.json().get("error"), "model_not_available")


# ===========================================================================
# Test 16 — Valid prediction response (mocked predictor)
# ===========================================================================

class HargaPrediksiMockTest(TestCase):
    """Test 16: Valid request → prediksi H+1–H+4 dengan arah."""

    def setUp(self):
        self.client = Client()

    @patch("sistem.views.prediksi_predict")
    def test_valid_prediction_returns_h1_to_h4(self, mock_predict):
        """Response JSON berisi 4 horizon prediksi dengan indikator arah."""
        mock_predict.return_value = PrediksiResult(
            pangan_id=13,
            pangan_nama="Bawang Merah",
            pangan_satuan="kg",
            pangan_harga_acuan=50000.0,
            kabupaten_kode="8171",
            kabupaten_nama="Kota Ambon",
            periode_tipe="weekly",
            current_harga_lkv=50000.0,
            current_change_pct=2.5,
            current_periode_start=date(2024, 6, 1),
            current_periode_end=date(2024, 6, 7),
            predictions=[
                HorizonPrediction(1, 1.5, 50750.0, True,
                                  date(2024, 6, 8), date(2024, 6, 14)),
                HorizonPrediction(2, 2.0, 51000.0, True,
                                  date(2024, 6, 15), date(2024, 6, 21)),
                HorizonPrediction(3, -0.5, 49750.0, False,
                                  date(2024, 6, 22), date(2024, 6, 28)),
                HorizonPrediction(4, -1.0, 49500.0, False,
                                  date(2024, 6, 29), date(2024, 7, 5)),
            ],
            model_trained_at="2024-05-01",
            train_periods=52,
            eval_mae_h1=2.5,
            eval_mae_h4=3.0,
            eval_mape_h1=None,
            eval_mape_h4=None,
            eval_rmse_h1=3.5,
            eval_rmse_h4=4.0,
        )

        resp = self.client.get(
            "/api/harga/prediksi/?komoditas_id=13&kabupaten=8171"
        )
        self.assertEqual(resp.status_code, 200)

        data = resp.json()

        # Top-level keys
        self.assertIn("predictions", data)
        self.assertIn("komoditas", data)
        self.assertIn("kabupaten", data)
        self.assertIn("current", data)
        self.assertIn("model_meta", data)

        # Exactly 4 prediction horizons
        self.assertEqual(len(data["predictions"]), 4)

        # Each prediction has required fields
        h1 = data["predictions"][0]
        self.assertEqual(h1["horizon"], 1)
        self.assertIn("is_up", h1)
        self.assertIn("predicted_change_pct", h1)
        self.assertIn("predicted_harga_lkv", h1)
        self.assertIn("periode_start", h1)
        self.assertIn("periode_end", h1)

        # Direction indicators
        self.assertTrue(h1["is_up"])                   # H+1 naik
        self.assertFalse(data["predictions"][3]["is_up"])  # H+4 turun

        # Current price data
        self.assertEqual(data["current"]["harga_lkv"], 50000.0)
        self.assertEqual(data["current"]["change_pct"], 2.5)

        # Meta
        self.assertEqual(data["model_meta"]["train_periods"], 52)
        self.assertEqual(data["model_meta"]["eval_mae_h1"], 2.5)

    @patch("sistem.views.prediksi_predict")
    def test_prediction_horizon_default_is_4(self, mock_predict):
        """Tanpa parameter horizon → default 4 prediksi."""
        mock_predict.return_value = PrediksiResult(
            pangan_id=13, pangan_nama="Test", pangan_satuan="kg",
            pangan_harga_acuan=None,
            kabupaten_kode="8171", kabupaten_nama="Test",
            periode_tipe="weekly",
            current_harga_lkv=50000, current_change_pct=None,
            current_periode_start=date(2024, 6, 1),
            current_periode_end=date(2024, 6, 7),
            predictions=[
                HorizonPrediction(i, float(i), 50000 + i * 500, True,
                                  date(2024, 6, 1), date(2024, 6, 7))
                for i in range(1, 5)
            ],
            model_trained_at="2024-05-01", train_periods=52,
            eval_mae_h1=None, eval_mae_h4=None,
            eval_mape_h1=None, eval_mape_h4=None,
            eval_rmse_h1=None, eval_rmse_h4=None,
        )
        resp = self.client.get(
            "/api/harga/prediksi/?komoditas_id=13&kabupaten=8171"
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.json()["predictions"]), 4)

    @patch("sistem.views.prediksi_predict")
    def test_prediction_horizon_2(self, mock_predict):
        """horizon=2 → hanya 2 prediksi."""
        mock_predict.return_value = PrediksiResult(
            pangan_id=13, pangan_nama="Test", pangan_satuan="kg",
            pangan_harga_acuan=None,
            kabupaten_kode="8171", kabupaten_nama="Test",
            periode_tipe="weekly",
            current_harga_lkv=50000, current_change_pct=None,
            current_periode_start=date(2024, 6, 1),
            current_periode_end=date(2024, 6, 7),
            predictions=[
                HorizonPrediction(i, float(i), 50000 + i * 500, True,
                                  date(2024, 6, 1), date(2024, 6, 7))
                for i in range(1, 3)
            ],
            model_trained_at="2024-05-01", train_periods=52,
            eval_mae_h1=None, eval_mae_h4=None,
            eval_mape_h1=None, eval_mape_h4=None,
            eval_rmse_h1=None, eval_rmse_h4=None,
        )
        resp = self.client.get(
            "/api/harga/prediksi/?komoditas_id=13&kabupaten=8171&horizon=2"
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.json()["predictions"]), 2)
