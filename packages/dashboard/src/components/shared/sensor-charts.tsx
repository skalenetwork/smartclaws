import type { DecodedMessage } from "@/hooks/use-channel-messages";
import { useChartData } from "@/hooks/use-chart-data";
import { SensorChart } from "@/components/shared/sensor-chart";

const COLORS = [
  "#0ea5e9", // sky-500
  "#f59e0b", // amber-500
  "#10b981", // emerald-500
  "#8b5cf6", // violet-500
  "#6366f1", // indigo-500
  "#f43f5e", // rose-500
];

interface SensorChartsProps {
  messages: DecodedMessage[];
}

export function SensorCharts({ messages }: SensorChartsProps) {
  const series = useChartData(messages);

  if (series.length === 0) return null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {series.map((s, i) => (
        <SensorChart
          key={s.key}
          title={s.key}
          data={s.data}
          color={COLORS[i % COLORS.length]}
        />
      ))}
    </div>
  );
}
