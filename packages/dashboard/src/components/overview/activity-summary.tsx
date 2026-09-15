import { useMemo } from "react";
import {
    Bar,
    BarChart,
    CartesianGrid,
    ResponsiveContainer,
    Tooltip,
    type TooltipProps,
    XAxis,
    YAxis,
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import type { FailedReadAttempt } from "@/hooks/use-failed-read-attempts";
import { ACTIVITY_WINDOW_SECONDS, type ActivityEvent } from "@/hooks/use-network-activity";
import type { Sender } from "@/hooks/use-senders";
import { cn } from "@/lib/utils";

// Categorical slots from the validated reference palette, stepped per theme. Four slots
// pass the adjacent-pair checks on this dashboard's card surfaces in both modes; a fifth
// agent folds into "Other". Light-mode aqua and yellow sit under 3:1 contrast, so the
// legend always carries each agent's count as text beside its swatch.
const SERIES_TOKENS =
    "[--series-1:#2a78d6] [--series-2:#eb6834] [--series-3:#1baf7a] [--series-4:#eda100] [--series-other:#898781] dark:[--series-1:#3987e5] dark:[--series-2:#d95926] dark:[--series-3:#199e70] dark:[--series-4:#c98500]";
const SLOT_COLORS = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)"];
const OTHER: Series = {
    key: "other",
    name: "Other agents",
    color: "var(--series-other)",
    registered: null,
};

const LEGEND_GROUPS = [
    { registered: true, label: "Registered agents" },
    { registered: false, label: "Unregistered agents" },
    { registered: null, label: undefined },
] as const;

const HOURS = 24;

const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat();

function hourLabel(seconds: number) {
    return new Date(seconds * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

interface Series {
    key: string;
    name: string;
    color: string;
    registered: boolean | null;
}

interface HourRow {
    start: number;
    label: string;
    [series: string]: number | string;
}

function Figure({
    label,
    value,
    detail,
    isLoading,
}: {
    label: string;
    value: string;
    detail: string;
    isLoading: boolean;
}) {
    return (
        <div className="min-w-0 sm:border-l sm:pl-5 sm:first:border-l-0 sm:first:pl-0">
            <p className="text-xs text-muted-foreground">{label}</p>
            {isLoading ? (
                <Skeleton className="mt-1.5 h-7 w-16" />
            ) : (
                <p className="mt-0.5 text-2xl font-semibold tracking-tight">{value}</p>
            )}
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground/80">{detail}</p>
        </div>
    );
}

function ActivityTooltip({ active, payload }: TooltipProps<number, string>) {
    if (!active || !payload?.length) return null;
    const row = payload[0].payload as HourRow;
    const present = payload.filter((item) => Number(item.value) > 0);
    return (
        <div className="rounded-xl border bg-popover px-3 py-2 text-xs shadow-md backdrop-blur-md">
            <p className="mb-1 text-muted-foreground">
                {hourLabel(row.start)} – {hourLabel(row.start + 3600)}
            </p>
            {present.length === 0 ? (
                <p>No messages</p>
            ) : (
                present.map((item) => (
                    <div key={item.dataKey as string} className="flex items-center gap-2 py-0.5">
                        <span
                            className="h-0.5 w-3 rounded-full"
                            style={{ background: item.color }}
                        />
                        <span className="font-semibold tabular-nums">{item.value}</span>
                        <span className="text-muted-foreground">{item.name}</span>
                    </div>
                ))
            )}
        </div>
    );
}

interface ActivitySummaryProps {
    events: ActivityEvent[];
    refused: FailedReadAttempt[];
    /** Who each channel's messages are credited to, keyed by lowercase channel address. */
    senderByChannel: Map<string, Sender>;
    totals: { transactions: bigint; gasUsed: bigint; isLoading: boolean; complete: boolean };
    isLoading: boolean;
    isFetching: boolean;
}

/** The overview's lead: what the network did today, and who did it. */
export function ActivitySummary({
    events,
    refused,
    senderByChannel,
    totals,
    isLoading,
    isFetching,
}: ActivitySummaryProps) {
    const summary = useMemo(() => {
        const now = Math.floor(Date.now() / 1000);
        const since = now - ACTIVITY_WINDOW_SECONDS;
        const firstHour = Math.floor(now / 3600) * 3600 - (HOURS - 1) * 3600;

        // An agent keeps its colour for as long as it exists: slots follow the directory's
        // order, not how busy an agent was today. A channel with no writer on record takes no
        // slot; anything it publishes folds into "Other".
        const ranked = [
            ...new Map(
                [...senderByChannel.values()]
                    .filter((sender) => sender.key !== "unknown" && !sender.key.startsWith("none:"))
                    .map((sender) => [sender.key, sender]),
            ).values(),
        ];
        const overflow = ranked.length > SLOT_COLORS.length;
        const seriesBySender = new Map<string, Series>();
        ranked.forEach((sender, index) => {
            const inSlot = !overflow || index < SLOT_COLORS.length - 1;
            seriesBySender.set(
                sender.key,
                inSlot
                    ? {
                          key: `s${index}`,
                          name: sender.name,
                          color: SLOT_COLORS[index],
                          registered: sender.registered,
                      }
                    : OTHER,
            );
        });

        const rows: HourRow[] = Array.from({ length: HOURS }, (_, index) => {
            const start = firstHour + index * 3600;
            return { start, label: hourLabel(start) };
        });
        const totalsBySeries = new Map<string, number>();
        let published = 0;
        let disclosed = 0;
        let accessChanges = 0;

        for (const event of events) {
            if (event.kind === "disclosed") disclosed += 1;
            else if (event.kind !== "published") accessChanges += 1;
            if (event.kind !== "published") continue;
            published += 1;
            const sender = senderByChannel.get(event.channel.toLowerCase());
            const series = (sender && seriesBySender.get(sender.key)) || OTHER;
            totalsBySeries.set(series.key, (totalsBySeries.get(series.key) ?? 0) + 1);
            const bucket = Math.floor((event.timestamp - firstHour) / 3600);
            const row = rows[bucket];
            if (row) row[series.key] = ((row[series.key] as number | undefined) ?? 0) + 1;
        }

        const series = [
            ...new Map([...seriesBySender.values(), OTHER].map((s) => [s.key, s])).values(),
        ]
            .filter((s) => totalsBySeries.has(s.key))
            .map((s) => ({ ...s, total: totalsBySeries.get(s.key) ?? 0 }));
        for (const row of rows) for (const s of series) row[s.key] ??= 0;

        return {
            rows,
            series,
            published,
            disclosed,
            accessChanges,
            refusedCount: refused.filter((attempt) => (attempt.timestamp ?? 0) >= since).length,
        };
    }, [events, refused, senderByChannel]);

    return (
        <section
            aria-labelledby="activity-heading"
            className={cn("rounded-xl border bg-card p-4 shadow-sm sm:p-5", SERIES_TOKENS)}
        >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                    <h2 id="activity-heading" className="text-base font-semibold">
                        Agent activity
                    </h2>
                    <p className="text-xs text-muted-foreground">
                        Last 24 hours, across every channel
                    </p>
                </div>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="relative flex size-2">
                        {isFetching && (
                            <span className="absolute inline-flex size-full rounded-full bg-emerald-500 opacity-60 motion-safe:animate-ping" />
                        )}
                        <span className="relative size-2 rounded-full bg-emerald-500" />
                    </span>
                    Live · checks every 30s
                </span>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-4">
                <Figure
                    label="Messages published"
                    value={whole.format(summary.published)}
                    detail="last 24 hours"
                    isLoading={isLoading}
                />
                <Figure
                    label="Disclosures"
                    value={whole.format(summary.disclosed)}
                    detail={
                        summary.refusedCount > 0
                            ? `${summary.refusedCount} refused`
                            : "last 24 hours"
                    }
                    isLoading={isLoading}
                />
                <Figure
                    label="Access changes"
                    value={whole.format(summary.accessChanges)}
                    detail="reader grants and revokes"
                    isLoading={isLoading}
                />
                <Figure
                    label="Transactions"
                    value={`${compact.format(totals.transactions)}${totals.complete ? "" : "+"}`}
                    detail={`all time, ${compact.format(totals.gasUsed)} gas used`}
                    isLoading={totals.isLoading && totals.transactions === 0n}
                />
            </div>

            <div className="mt-5 h-[220px]">
                {isLoading ? (
                    <Skeleton className="h-full w-full rounded-lg" />
                ) : summary.published === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center rounded-lg bg-muted/30 text-center">
                        <p className="text-sm text-muted-foreground">
                            No messages published in the last 24 hours
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground/70">
                            Agents show up here as soon as they publish.
                        </p>
                    </div>
                ) : (
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={summary.rows} barCategoryGap="18%" margin={{ left: -12 }}>
                            <CartesianGrid vertical={false} stroke="var(--border)" />
                            <XAxis
                                dataKey="label"
                                tickLine={false}
                                axisLine={{ stroke: "var(--border)" }}
                                tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                                interval={3}
                            />
                            <YAxis
                                allowDecimals={false}
                                tickLine={false}
                                axisLine={false}
                                width={40}
                                tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                            />
                            <Tooltip
                                cursor={{ fill: "var(--muted)", opacity: 0.6 }}
                                content={<ActivityTooltip />}
                            />
                            {summary.series.map((series, index) => (
                                <Bar
                                    key={series.key}
                                    dataKey={series.key}
                                    name={series.name}
                                    stackId="published"
                                    fill={series.color}
                                    maxBarSize={24}
                                    // The surface-coloured stroke is the gap between stacked
                                    // segments, not an outline.
                                    stroke="var(--card)"
                                    strokeWidth={1}
                                    radius={index === summary.series.length - 1 ? [4, 4, 0, 0] : 0}
                                    isAnimationActive={false}
                                />
                            ))}
                        </BarChart>
                    </ResponsiveContainer>
                )}
            </div>

            {summary.series.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-xs">
                    {LEGEND_GROUPS.map(({ registered, label }) => {
                        const members = summary.series.filter(
                            (series) => series.registered === registered,
                        );
                        if (members.length === 0) return null;
                        return (
                            <div
                                key={label ?? "ungrouped"}
                                className="flex flex-wrap items-center gap-x-4 gap-y-1.5"
                            >
                                {label && <span className="text-muted-foreground">{label}</span>}
                                <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                                    {members.map((series) => (
                                        <li key={series.key} className="flex items-center gap-1.5">
                                            <span
                                                aria-hidden="true"
                                                className="size-2.5 rounded-[3px]"
                                                style={{ background: series.color }}
                                            />
                                            <span>{series.name}</span>
                                            <span className="text-muted-foreground tabular-nums">
                                                {whole.format(series.total)}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* The wrapper is what hides it: a table caption renders outside the table's
                own box, so `sr-only` on the table alone leaves the caption visible. */}
            {summary.series.length > 0 && (
                <div className="sr-only">
                    <table>
                        <caption>Messages published per hour, by agent</caption>
                        <thead>
                            <tr>
                                <th scope="col">Hour</th>
                                {summary.series.map((series) => (
                                    <th key={series.key} scope="col">
                                        {series.name}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {summary.rows.map((row) => (
                                <tr key={row.start}>
                                    <th scope="row">{row.label}</th>
                                    {summary.series.map((series) => (
                                        <td key={series.key}>{row[series.key]}</td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    );
}
