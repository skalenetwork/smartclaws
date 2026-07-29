type TimeAgoResult = {
    label: string;
    color: "emerald" | "amber" | "red" | "muted";
};

export function timeAgo(timestampSeconds: number | undefined): TimeAgoResult {
    if (!timestampSeconds) {
        return { label: "N/A", color: "muted" };
    }

    const now = Math.floor(Date.now() / 1000);
    const diff = now - timestampSeconds;

    if (diff < 0) {
        return { label: "just now", color: "emerald" };
    }

    const minutes = Math.floor(diff / 60);
    const hours = Math.floor(diff / 3600);
    const days = Math.floor(diff / 86400);

    let label: string;
    if (diff < 60) {
        label = "just now";
    } else if (minutes < 60) {
        label = `${minutes}m ago`;
    } else if (hours < 24) {
        label = `${hours}h ago`;
    } else if (days < 30) {
        label = `${days}d ago`;
    } else {
        label = `${Math.floor(days / 30)}mo ago`;
    }

    let color: TimeAgoResult["color"];
    if (diff <= 300) {
        color = "emerald"; // <= 5 min
    } else if (diff <= 3600) {
        color = "amber"; // <= 1 hour
    } else {
        color = "red"; // > 1 hour
    }

    return { label, color };
}

export const timeAgoColors = {
    emerald: "bg-emerald-500/15 text-emerald-500 dark:text-emerald-400",
    amber: "bg-amber-500/15 text-amber-500 dark:text-amber-400",
    red: "bg-red-500/15 text-red-500 dark:text-red-400",
    muted: "bg-muted/50 text-muted-foreground",
} as const;
