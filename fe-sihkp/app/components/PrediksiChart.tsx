import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";
import { TrendingUp, RefreshCw, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { formatPrice, stripWilayahPrefix } from "~/lib/map-utils";

type Tipe = "weekly" | "monthly" | "quarterly" | "semesterly";

interface HorizonPrediction {
  horizon: number;
  predicted_change_pct: number;
  predicted_harga_lkv: number;
  is_up: boolean;
  periode_start: string;
  periode_end: string;
}

interface PrediksiResponse {
  komoditas: { id: number; nama: string; satuan: string; harga_acuan: number };
  kabupaten: { kode: string; nama: string };
  periode_tipe: Tipe;
  current: { harga_lkv: number; change_pct: number | null; periode_start: string; periode_end: string };
  predictions: HorizonPrediction[];
  model_meta: { trained_at: string; train_periods: number; eval_mae_h1: number | null; eval_mae_h4: number | null };
}

type ChartPoint = { label: string; historical: number | null; predicted: number | null };

function fmtYAxis(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}jt`;
  if (v >= 1_000)     return `${Math.round(v / 1_000)}rb`;
  return String(v);
}

export interface PrediksiChartProps {
  chartData: ChartPoint[];
  yDomain: [number, number] | undefined;
  prediksi: PrediksiResponse | null;
  prediksiError: "no_model" | "error" | null;
  isLoading: boolean;
  hasFilters: boolean;
  selectedKomNama?: string;
  selectedKomSatuan?: string;
  selectedKabNama?: string;
  komoditasId: number | null;
  kabupatenKode: string | null;
  tipe: Tipe;
}

export default function PrediksiChart({
  chartData,
  yDomain,
  prediksi,
  prediksiError,
  isLoading,
  hasFilters,
  selectedKomNama,
  selectedKomSatuan,
  selectedKabNama,
  komoditasId,
  kabupatenKode,
  tipe,
}: PrediksiChartProps) {
  return (
    <Card className="gap-0 py-3">
      <CardHeader className="py-0 px-4 pb-2 block">
        <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
          Tren &amp; Prediksi Harga
          {selectedKomNama && (
            <span className="font-normal text-steel text-xs">
              {selectedKomNama}{selectedKomSatuan ? ` · ${selectedKomSatuan}` : ""}
            </span>
          )}
          {selectedKabNama && (
            <span className="font-normal text-steel text-xs">
              — {stripWilayahPrefix(selectedKabNama).name}
            </span>
          )}
        </CardTitle>
      </CardHeader>

      <CardContent className="px-2 pb-3">
        {isLoading ? (
          <div className="h-[340px] flex items-center justify-center">
            <RefreshCw className="h-5 w-5 animate-spin text-steel" />
          </div>
        ) : !hasFilters ? (
          <div className="h-[340px] flex flex-col items-center justify-center gap-2 text-center px-6">
            <TrendingUp className="h-8 w-8 text-steel/30" />
            <p className="text-sm text-steel">Pilih komoditas dan kabupaten untuk melihat prediksi.</p>
          </div>
        ) : prediksiError === "no_model" ? (
          <div className="h-[340px] flex flex-col items-center justify-center gap-3 text-center px-6">
            <AlertTriangle className="h-8 w-8 text-amber-400" />
            <p className="text-sm font-medium text-ink">Model belum tersedia</p>
            <p className="text-xs text-steel max-w-xs">
              Jalankan perintah berikut untuk melatih model pada stream ini:
            </p>
            <code className="text-xs bg-muted px-3 py-2 rounded-md font-mono text-steel">
              python manage.py train_prediksi --pangan_id {komoditasId} --kabupaten {kabupatenKode} --tipe {tipe}
            </code>
          </div>
        ) : chartData.length === 0 ? (
          <div className="h-[340px] flex items-center justify-center text-sm text-steel">
            Tidak ada data untuk filter yang dipilih.
          </div>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={340}>
              <LineChart data={chartData} margin={{ top: 8, right: 24, bottom: 4, left: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: "#5f5f5f" }}
                  tickLine={false}
                  axisLine={{ stroke: "#e5e7eb" }}
                  interval="preserveStartEnd"
                  padding={{ left: 8, right: 8 }}
                />
                <YAxis
                  domain={yDomain ?? ["auto", "auto"]}
                  tickCount={6}
                  tick={{ fontSize: 10, fill: "#5f5f5f" }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={fmtYAxis}
                  width={48}
                />
                <Tooltip
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formatter={(value: any, name: any) => {
                    const label = name === "historical" ? "Harga aktual" : "Prediksi";
                    return [
                      <span key={name} className="font-semibold">
                        {formatPrice(typeof value === "number" ? value : null)}
                      </span>,
                      label,
                    ];
                  }}
                  labelStyle={{ fontWeight: 600, fontSize: 11, marginBottom: 4 }}
                  contentStyle={{
                    fontSize: 11,
                    borderRadius: 8,
                    border: "1px solid #e5e7eb",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                    padding: "6px 10px",
                  }}
                  cursor={{ stroke: "#e5e7eb", strokeWidth: 1 }}
                />
                {prediksi?.komoditas.harga_acuan && (
                  <ReferenceLine
                    y={prediksi.komoditas.harga_acuan}
                    stroke="#f59e0b"
                    strokeDasharray="4 2"
                    label={{ value: "HET", position: "insideTopRight", fontSize: 10, fill: "#f59e0b" }}
                  />
                )}
                <Line
                  type="monotone"
                  dataKey="historical"
                  stroke="#1456f0"
                  strokeWidth={2}
                  dot={{ r: 2, fill: "#1456f0", strokeWidth: 0 }}
                  activeDot={{ r: 4 }}
                  connectNulls={false}
                  name="historical"
                />
                <Line
                  type="monotone"
                  dataKey="predicted"
                  stroke="#f97316"
                  strokeWidth={2}
                  strokeDasharray="6 3"
                  dot={{ r: 3, fill: "white", stroke: "#f97316", strokeWidth: 2 }}
                  activeDot={{ r: 4 }}
                  connectNulls={false}
                  name="predicted"
                />
              </LineChart>
            </ResponsiveContainer>

            {/* Legend */}
            <div className="flex items-center gap-5 px-3 pt-3 mt-1 border-t flex-wrap">
              <div className="flex items-center gap-1.5 text-xs text-steel">
                <svg width="20" height="10" viewBox="0 0 20 10" fill="none">
                  <line x1="0" y1="5" x2="20" y2="5" stroke="#1456f0" strokeWidth="2.5" strokeLinecap="round" />
                </svg>
                Harga aktual
              </div>
              <div className="flex items-center gap-1.5 text-xs text-steel">
                <svg width="20" height="10" viewBox="0 0 20 10" fill="none">
                  <line x1="0" y1="5" x2="20" y2="5" stroke="#f97316" strokeWidth="2" strokeDasharray="6 3" />
                </svg>
                Prediksi model
              </div>
              {prediksi?.komoditas.harga_acuan && (
                <div className="flex items-center gap-1.5 text-xs text-steel">
                  <svg width="20" height="10" viewBox="0 0 20 10" fill="none">
                    <line x1="0" y1="5" x2="20" y2="5" stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="4 2" />
                  </svg>
                  HET/HPP
                </div>
              )}
              {prediksi && (
                <span className="text-xs text-steel/60 ml-auto">
                  {prediksi.model_meta.train_periods} periode pelatihan
                </span>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
