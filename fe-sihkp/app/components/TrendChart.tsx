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
import { useEffect, useState } from "react";
import { stripWilayahPrefix, type Kabupaten } from "~/lib/map-utils";

type ChartPoint = Record<string, string | number | boolean | null>;
const CITY_COLORS = ["#1456f0", "#16a34a", "#FB923C", "#8b5cf6", "#ec4899", "#06b6d4", "#a16207", "#dc2626"] as const;
const HET_COLOR = "#f59e0b";

function useDark() {
  const [dark, setDark] = useState(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("dark"),
  );
  useEffect(() => {
    const obs = new MutationObserver(
      () => setDark(document.documentElement.classList.contains("dark")),
    );
    obs.observe(document.documentElement, { attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

function fmtPrice(v: number | null): string {
  if (v == null) return "—";
  return `Rp ${Math.round(v).toLocaleString("id-ID")}`;
}
function fmtYAxis(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}jt`;
  if (v >= 1_000) return `${Math.round(v / 1_000)}rb`;
  return String(v);
}

export interface TrendChartProps {
  chartData: ChartPoint[];
  selectedKodes: string[];
  kabupatenList: Kabupaten[];
  hetHA: number | null;
  yTicks: number[] | undefined;
  yDomain: [number, number] | undefined;
}

export default function TrendChart({
  chartData,
  selectedKodes,
  kabupatenList,
  hetHA,
  yTicks,
  yDomain,
}: TrendChartProps) {
  const dark = useDark();

  const GRID   = dark ? "#262626" : "#f0f0f0";
  const TICK   = dark ? "#71717a" : "#5f5f5f";
  const AXIS   = dark ? "#3f3f46" : "#e5e7eb";
  const TIP_BG = dark ? "#18181b" : "#ffffff";
  const TIP_BD = dark ? "#3f3f46" : "#e5e7eb";
  const TIP_SH = dark ? "0 2px 10px rgba(0,0,0,0.5)" : "0 2px 8px rgba(0,0,0,0.08)";

  const periodFrom = chartData[0]?.label as string | undefined;
  const periodTo   = chartData.at(-1)?.label as string | undefined;
  const showPeriod = periodFrom && periodTo && chartData.length > 1;

  return (
    <div>
      {showPeriod && (
        <div className="px-3 pb-2 flex items-center gap-2 select-none">
          <span className="font-mono text-[10px] tabular-nums text-steel/60">{periodFrom}</span>
          <span className="text-[10px] text-steel/30">—</span>
          <span className="font-mono text-[10px] tabular-nums text-steel/60">{periodTo}</span>
          <span className="ml-auto font-mono text-[10px] tabular-nums text-steel/30">
            {chartData.length} periode
          </span>
        </div>
      )}

      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={chartData} margin={{ top: 4, right: 24, bottom: 4, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: TICK }}
            tickLine={false}
            axisLine={{ stroke: AXIS }}
            interval="preserveStartEnd"
            padding={{ left: 8, right: 8 }}
          />
          <YAxis
            domain={yDomain ?? ["auto", "auto"]}
            ticks={yTicks}
            tickCount={yTicks ? undefined : 7}
            tick={{ fontSize: 10, fill: TICK }}
            tickLine={false}
            axisLine={false}
            tickFormatter={fmtYAxis}
            width={48}
          />
          <Tooltip
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            formatter={(value: any, name: any) => {
              const kab = kabupatenList.find(k => k.kode === String(name));
              const cityName = kab ? stripWilayahPrefix(kab.nama).name : String(name);
              const price = typeof value === "number" ? value : null;
              return [
                <span key={name} className="font-semibold">{fmtPrice(price)}</span>,
                cityName,
              ];
            }}
            labelStyle={{ fontWeight: 600, fontSize: 11, marginBottom: 4 }}
            contentStyle={{
              fontSize: 11,
              borderRadius: 8,
              border: `1px solid ${TIP_BD}`,
              boxShadow: TIP_SH,
              padding: "6px 10px",
              backgroundColor: TIP_BG,
              color: dark ? "#e4e4e7" : "#3f3f46",
            }}
            cursor={{ stroke: AXIS, strokeWidth: 1 }}
          />
          {hetHA != null && (
            <ReferenceLine
              y={hetHA}
              stroke={HET_COLOR}
              strokeDasharray="5 3"
              strokeWidth={1.5}
              label={{
                value: `HET/HA ${fmtPrice(hetHA)}`,
                position: "insideTopRight",
                fontSize: 9,
                fill: HET_COLOR,
                fontWeight: 600,
              }}
            />
          )}
          {selectedKodes.map((kode, idx) => {
            const color = CITY_COLORS[idx % CITY_COLORS.length];
            return (
              <Line
                key={kode}
                type="monotone"
                dataKey={kode}
                stroke={color}
                strokeWidth={2}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                dot={(props: any) => {
                  const { cx = 0, cy = 0, payload } = props as { cx?: number; cy?: number; payload: ChartPoint };
                  const isLocf = payload[`${kode}_locf`];
                  return (
                    <circle
                      key={`${kode}-${payload.key}`}
                      cx={cx} cy={cy}
                      r={isLocf ? 3 : 2}
                      fill={isLocf ? (dark ? "#18181b" : "white") : color}
                      stroke={color}
                      strokeWidth={isLocf ? 1.5 : 0}
                    />
                  );
                }}
                activeDot={{ r: 4, strokeWidth: 0 }}
                connectNulls
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
