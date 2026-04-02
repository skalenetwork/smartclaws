import { useMemo } from "react";
import type { DecodedMessage } from "@/hooks/use-channel-messages";

export interface ChartPoint {
  ts: number;
  value: number | null;
}

export interface ChartSeries {
  key: string;
  data: ChartPoint[];
}

export function useChartData(messages: DecodedMessage[]): ChartSeries[] {
  return useMemo(() => {
    const seriesMap = new Map<string, { ts: number; value: number }[]>();

    for (const msg of messages) {
      if (!msg.envelope) continue;
      const { ts, p } = msg.envelope;
      for (const [key, val] of Object.entries(p)) {
        if (typeof val !== "number") continue;
        let arr = seriesMap.get(key);
        if (!arr) {
          arr = [];
          seriesMap.set(key, arr);
        }
        arr.push({ ts: ts * 1000, value: val });
      }
    }

    const result: ChartSeries[] = [];
    for (const [key, data] of seriesMap) {
      if (data.length < 2) continue;
      data.sort((a, b) => a.ts - b.ts);

      // Compute median interval to detect gaps
      const intervals: number[] = [];
      for (let i = 1; i < data.length; i++) {
        intervals.push(data[i].ts - data[i - 1].ts);
      }
      intervals.sort((a, b) => a - b);
      const median = intervals[Math.floor(intervals.length / 2)];
      const gapThreshold = median * 3;

      // Insert nulls at gaps to break the line
      const withGaps: ChartPoint[] = [data[0]];
      for (let i = 1; i < data.length; i++) {
        if (data[i].ts - data[i - 1].ts > gapThreshold) {
          withGaps.push({ ts: data[i - 1].ts + 1, value: null });
        }
        withGaps.push(data[i]);
      }

      result.push({ key, data: withGaps });
    }

    return result;
  }, [messages]);
}
