import { Tag } from "lucide-react";
import { useMemo } from "react";
import type { DecodedMessage } from "@/hooks/use-channel-messages";
import { useChartData } from "@/hooks/use-chart-data";
import { SensorChart } from "@/components/shared/sensor-chart";
import { StatCard } from "@/components/shared/stat-card";

const COLORS = [
  "#0ea5e9", // sky-500
  "#f59e0b", // amber-500
  "#10b981", // emerald-500
  "#8b5cf6", // violet-500
  "#6366f1", // indigo-500
  "#f43f5e", // rose-500
];

const TIMESTAMP_KEYS = new Set(["ts", "timestamp"]);

function useTextFields(messages: DecodedMessage[]): { key: string; value: string }[] {
  return useMemo(() => {
    const latest = messages.find((m) => m.envelope);
    if (!latest?.envelope) return [];
    return Object.entries(latest.envelope.p)
      .filter(([key, val]) => {
        if (typeof val === "number") return false;
        if (TIMESTAMP_KEYS.has(key.toLowerCase())) return false;
        return val != null;
      })
      .map(([key, val]) => ({ key, value: String(val) }));
  }, [messages]);
}

interface SensorChartsProps {
  messages: DecodedMessage[];
}

export function SensorCharts({ messages }: SensorChartsProps) {
  const series = useChartData(messages);
  const textFields = useTextFields(messages);

  if (series.length === 0 && textFields.length === 0) return null;

  return (
    <div className="space-y-4">
      {textFields.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
          {textFields.map((f) => (
            <StatCard key={f.key} title={f.key} value={f.value} icon={Tag} accent="violet" />
          ))}
        </div>
      )}
      {series.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {series.map((s, i) => (
            <SensorChart
              key={s.key}
              title={s.key}
              data={s.data}
              color={COLORS[i % COLORS.length]}
            />
          ))}
        </div>
      )}
    </div>
  );
}
