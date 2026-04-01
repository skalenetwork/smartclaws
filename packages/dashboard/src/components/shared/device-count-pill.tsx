import { Cpu } from "lucide-react";

interface DeviceCountPillProps {
  count: bigint;
}

export function DeviceCountPill({ count }: DeviceCountPillProps) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-emerald/10 px-3 py-1 text-sm font-semibold text-accent-emerald">
      <Cpu className="h-3.5 w-3.5" />
      {count.toString()} {Number(count) === 1 ? "device" : "devices"}
    </span>
  );
}
