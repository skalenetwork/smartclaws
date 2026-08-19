import { BarChart3, TrendingUp } from "lucide-react";
import { useMemo, useState } from "react";
import {
    Area,
    Bar,
    Brush,
    CartesianGrid,
    ComposedChart,
    ReferenceLine,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";

type ChartType = "line" | "bar";

interface SensorChartProps {
    title: string;
    data: { ts: number; value: number | null }[];
    color: string;
}

function formatTime(ms: number): string {
    const d = new Date(ms);
    const time = `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
    return `${(d.getMonth() + 1).toString().padStart(2, "0")}/${d.getDate().toString().padStart(2, "0")} ${time}`;
}

function formatTooltipTime(ms: number): string {
    return new Date(ms).toLocaleString();
}

const CHART_TYPES: { value: ChartType; icon: typeof TrendingUp }[] = [
    { value: "line", icon: TrendingUp },
    { value: "bar", icon: BarChart3 },
];

/** Downsample data for bar chart to avoid rendering hundreds of invisible thin bars */
function downsample(
    data: { ts: number; value: number | null }[],
    maxBars: number,
): { ts: number; value: number | null }[] {
    const real = data.filter((d) => d.value !== null);
    if (real.length <= maxBars) return real;
    const step = Math.ceil(real.length / maxBars);
    const result: { ts: number; value: number | null }[] = [];
    for (let i = 0; i < real.length; i += step) {
        const chunk = real.slice(i, i + step);
        const avg = chunk.reduce((s, d) => s + (d.value as number), 0) / chunk.length;
        result.push({
            ts: chunk[Math.floor(chunk.length / 2)].ts,
            value: Math.round(avg * 100) / 100,
        });
    }
    return result;
}

export function SensorChart({ title, data, color }: SensorChartProps) {
    const [chartType, setChartType] = useState<ChartType>("line");

    const stats = useMemo(() => {
        const values = data.filter((d) => d.value !== null).map((d) => d.value as number);
        if (values.length === 0) return null;
        const min = Math.min(...values);
        const max = Math.max(...values);
        const avg = values.reduce((s, v) => s + v, 0) / values.length;
        return { min, max, avg };
    }, [data]);

    const barData = useMemo(() => downsample(data, 60), [data]);
    const chartData = chartType === "bar" ? barData : data;

    return (
        <div className="bg-card rounded-xl border p-4 shadow-sm min-w-0">
            <div className="flex items-center justify-between mb-3 gap-2">
                <h3 className="text-sm font-medium text-muted-foreground capitalize shrink-0">
                    {title}
                </h3>
                <div className="flex items-center gap-3 min-w-0">
                    {stats && (
                        <div className="hidden sm:flex gap-3 text-[10px] text-muted-foreground/70 shrink-0">
                            <span>
                                min:{" "}
                                <span className="text-foreground/70">{stats.min.toFixed(2)}</span>
                            </span>
                            <span>
                                avg:{" "}
                                <span className="text-foreground/70">{stats.avg.toFixed(2)}</span>
                            </span>
                            <span>
                                max:{" "}
                                <span className="text-foreground/70">{stats.max.toFixed(2)}</span>
                            </span>
                        </div>
                    )}
                    <div className="flex gap-0.5 rounded-lg bg-muted/50 p-0.5">
                        {CHART_TYPES.map((ct) => (
                            <button
                                key={ct.value}
                                type="button"
                                onClick={() => setChartType(ct.value)}
                                className={`rounded-md p-1.5 transition-colors ${
                                    chartType === ct.value
                                        ? "bg-card text-foreground shadow-sm"
                                        : "text-muted-foreground/60 hover:text-muted-foreground"
                                }`}
                                title={ct.value === "line" ? "Line chart" : "Bar chart"}
                            >
                                <ct.icon className="h-3 w-3" />
                            </button>
                        ))}
                    </div>
                </div>
            </div>
            <ResponsiveContainer width="100%" height={240}>
                <ComposedChart data={chartData} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
                    <defs>
                        <linearGradient id={`gradient-${title}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={color} stopOpacity={0.15} />
                            <stop offset="100%" stopColor={color} stopOpacity={0} />
                        </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.1} />
                    <XAxis
                        dataKey="ts"
                        type="number"
                        scale={chartType === "bar" ? "auto" : "time"}
                        domain={["dataMin", "dataMax"]}
                        tickFormatter={formatTime}
                        tick={{ fontSize: 11, fill: "currentColor", opacity: 0.5 }}
                        stroke="currentColor"
                        opacity={0.2}
                    />
                    <YAxis
                        domain={["auto", "auto"]}
                        tick={{ fontSize: 11, fill: "currentColor", opacity: 0.5 }}
                        stroke="currentColor"
                        opacity={0.2}
                        width={45}
                    />
                    <Tooltip
                        labelFormatter={formatTooltipTime}
                        formatter={(value: number) => [value, title]}
                        contentStyle={{
                            backgroundColor: "var(--color-card, #1c1c1c)",
                            border: "1px solid var(--color-border, #333)",
                            borderRadius: "8px",
                            fontSize: "12px",
                        }}
                    />
                    {stats && (
                        <ReferenceLine
                            y={stats.avg}
                            stroke={color}
                            strokeDasharray="4 4"
                            strokeOpacity={0.5}
                            label={{
                                value: "avg",
                                position: "right",
                                fontSize: 10,
                                fill: color,
                                opacity: 0.7,
                            }}
                        />
                    )}
                    <Area
                        type="monotone"
                        dataKey={chartType === "line" ? "value" : "none"}
                        stroke={color}
                        strokeWidth={2}
                        fill={`url(#gradient-${title})`}
                        connectNulls={false}
                        isAnimationActive={false}
                        activeDot={{ r: 3, strokeWidth: 0, fill: color }}
                    />
                    <Bar
                        dataKey={chartType === "bar" ? "value" : "none"}
                        fill={color}
                        opacity={0.7}
                        radius={[2, 2, 0, 0]}
                        isAnimationActive={false}
                    />
                    <Brush
                        dataKey="ts"
                        height={28}
                        stroke="transparent"
                        fill="var(--color-muted, #262626)"
                        tickFormatter={formatTime}
                        travellerWidth={10}
                    >
                        <ComposedChart>
                            <Area
                                type="monotone"
                                dataKey="value"
                                stroke={color}
                                strokeWidth={1}
                                fill={color}
                                fillOpacity={0.15}
                                isAnimationActive={false}
                            />
                        </ComposedChart>
                    </Brush>
                </ComposedChart>
            </ResponsiveContainer>
        </div>
    );
}
