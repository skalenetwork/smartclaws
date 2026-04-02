import { ChevronRight, Database, Hash, Loader2, MessageSquare } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import { EmptyState } from "@/components/shared/empty-state";
import { StatCard } from "@/components/shared/stat-card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { type DecodedMessage, useChannelMessages } from "@/hooks/use-channel-messages";
import { SensorCharts } from "@/components/shared/sensor-charts";

function formatBytes(bytes: bigint): string {
  const n = Number(bytes);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTimestamp(ts: number): string {
  return new Date(ts * 1000).toLocaleString();
}

function compactJson(obj: Record<string, unknown>): ReactNode {
  const entries = Object.entries(obj);
  const visible = entries.slice(0, 4);
  return (
    <span>
      <span className="text-muted-foreground">{"{ "}</span>
      {visible.map(([k, v], i) => (
        <span key={k}>
          <span className="text-sky-400">{k}</span>
          <span className="text-muted-foreground">: </span>
          {typeof v === "string" ? (
            <span className="text-emerald-400">"{v}"</span>
          ) : typeof v === "number" ? (
            <span className="text-amber-400">{v}</span>
          ) : typeof v === "boolean" ? (
            <span className="text-violet-400">{String(v)}</span>
          ) : v === null ? (
            <span className="text-violet-400">null</span>
          ) : (
            <span className="text-muted-foreground">{JSON.stringify(v)}</span>
          )}
          {i < visible.length - 1 && <span className="text-muted-foreground">, </span>}
        </span>
      ))}
      {entries.length > 4 && <span className="text-muted-foreground">, …</span>}
      <span className="text-muted-foreground">{" }"}</span>
    </span>
  );
}

function highlightJson(json: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const regex = /("(?:\\.|[^"\\])*")\s*(:)?|(\b(?:true|false|null)\b)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([{}[\],:])/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(json)) !== null) {
    if (match.index > lastIndex) {
      parts.push(json.slice(lastIndex, match.index));
    }
    const [full, str, colon, bool, num, punct] = match;
    if (str) {
      if (colon) {
        parts.push(
          <span key={match.index} className="text-sky-400">{str}</span>,
          <span key={`${match.index}c`} className="text-muted-foreground">:</span>,
        );
      } else {
        parts.push(<span key={match.index} className="text-emerald-400">{str}</span>);
      }
    } else if (bool) {
      parts.push(<span key={match.index} className="text-violet-400">{full}</span>);
    } else if (num) {
      parts.push(<span key={match.index} className="text-amber-400">{full}</span>);
    } else if (punct) {
      parts.push(<span key={match.index} className="text-muted-foreground">{full}</span>);
    }
    lastIndex = match.index + full.length;
  }
  if (lastIndex < json.length) {
    parts.push(json.slice(lastIndex));
  }
  return parts;
}

export interface ChannelData {
  messages: DecodedMessage[];
  messageCount: bigint | undefined;
  maxCapacity: bigint | undefined;
  totalBytes: bigint | undefined;
  isLoading: boolean;
  hasMore: boolean;
  isLoadingMore: boolean;
  loadMore: () => void;
}

interface ChannelViewProps {
  address: Address;
  data?: ChannelData;
}

export function ChannelView({ address, data }: ChannelViewProps) {
  const hookData = useChannelMessages(address);
  const { messages, messageCount, maxCapacity, totalBytes, isLoading, hasMore, isLoadingMore, loadMore } =
    data ?? hookData;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const sentinelRef = useRef<HTMLTableRowElement>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !isLoadingMore) {
          loadMore();
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, isLoadingMore, loadMore]);

  const toggleExpand = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (isLoading && messages.length === 0) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3 sm:gap-4">
          <Skeleton className="h-14 rounded-lg" />
          <Skeleton className="h-14 rounded-lg" />
          <Skeleton className="h-14 rounded-lg" />
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  const capacityPercent =
    maxCapacity !== undefined && totalBytes !== undefined && Number(maxCapacity) > 0
      ? Math.round((Number(totalBytes) / Number(maxCapacity)) * 100)
      : null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        <StatCard
          title="Messages"
          value={messageCount?.toString() ?? "0"}
          icon={MessageSquare}
          accent="indigo"
        />
        <StatCard
          title="Storage Used"
          value={totalBytes !== undefined ? formatBytes(totalBytes) : "0 B"}
          icon={Database}
          accent="amber"
        />
        <div className="bg-card rounded-lg border p-3 sm:p-3 sm:px-4 sm:pl-5 shadow-sm">
          <div className="flex items-center justify-between gap-3 sm:gap-4">
            <div className="min-w-0 shrink-0">
              <div className="text-lg sm:text-xl font-bold text-foreground leading-tight">
                {capacityPercent !== null ? `${capacityPercent}%` : "N/A"}
              </div>
              <span className="text-[10px] sm:text-xs text-muted-foreground/80">Capacity</span>
            </div>
            {maxCapacity !== undefined && (
              <div className="flex-1 min-w-0">
                <div className="h-2 rounded-full bg-primary/20 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                    style={{ width: `${Math.min(capacityPercent ?? 0, 100)}%` }}
                  />
                </div>
                <p className="text-[10px] text-muted-foreground/60 mt-1">
                  {totalBytes !== undefined ? formatBytes(totalBytes) : "0 B"} / {formatBytes(maxCapacity)}
                </p>
              </div>
            )}
            <div className="rounded-full p-1.5 sm:p-2.5 shrink-0 bg-emerald-50 dark:bg-emerald-700/30">
              <Hash className="h-4 w-4 sm:h-5 sm:w-5 text-emerald-500 dark:text-emerald-400" size={20} />
            </div>
          </div>
        </div>
      </div>

      <SensorCharts messages={messages} />

      {messages.length === 0 ? (
        <EmptyState message="No messages in this channel" />
      ) : (
        <div className="rounded-xl border overflow-hidden bg-card shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16 px-3">#</TableHead>
                <TableHead className="px-3">Topic</TableHead>
                <TableHead className="px-3">Payload</TableHead>
                <TableHead className="px-3">Timestamp</TableHead>
                <TableHead className="px-3">Device</TableHead>
                <TableHead className="w-10 px-3" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {messages.map((msg) => {
                const key = msg.offset.toString();
                const isExpanded = expanded.has(key);
                return (
                  <>
                    <TableRow
                      key={key}
                      className="cursor-pointer"
                      onClick={() => toggleExpand(key)}
                    >
                      <TableCell className="py-2 px-3 text-xs text-muted-foreground">
                        #{key}
                      </TableCell>
                      <TableCell className="py-2 px-3">
                        {msg.envelope ? (
                          <Badge variant="secondary" className="text-xs">
                            {msg.envelope.topic}
                          </Badge>
                        ) : (
                          <Badge variant="destructive" className="text-xs">
                            {msg.error ?? "Raw"}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="py-2 px-3 text-xs font-mono text-muted-foreground max-w-72 truncate">
                        {msg.envelope ? compactJson(msg.envelope.p) : msg.raw.slice(0, 40) + "…"}
                      </TableCell>
                      <TableCell className="py-2 px-3 text-xs text-muted-foreground whitespace-nowrap">
                        {msg.envelope ? formatTimestamp(msg.envelope.ts) : "—"}
                      </TableCell>
                      <TableCell className="py-2 px-3 text-xs text-muted-foreground">
                        {msg.envelope?.dev ?? "—"}
                      </TableCell>
                      <TableCell className="py-2 px-3">
                        <ChevronRight
                          className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${isExpanded ? "rotate-90" : ""}`}
                        />
                      </TableCell>
                    </TableRow>
                    {isExpanded && (
                      <TableRow key={`${key}-expand`} className="hover:bg-transparent">
                        <TableCell colSpan={6} className="p-0">
                          <pre className="text-xs font-mono bg-muted/30 rounded-lg p-3 m-2 overflow-x-auto leading-relaxed">
                            {highlightJson(
                              msg.envelope
                                ? JSON.stringify(msg.envelope, null, 2)
                                : msg.raw,
                            )}
                          </pre>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                );
              })}
              {(hasMore || isLoadingMore) && (
                <TableRow ref={sentinelRef} className="hover:bg-transparent">
                  <TableCell colSpan={6} className="py-3 text-center">
                    {isLoadingMore ? (
                      <Loader2 className="h-4 w-4 animate-spin inline-block text-muted-foreground" />
                    ) : (
                      <span className="text-xs text-muted-foreground">Scroll for older messages</span>
                    )}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
