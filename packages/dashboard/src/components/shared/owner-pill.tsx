import { ExternalLink, User } from "lucide-react";
import { useAccountLabel } from "@/hooks/use-account-label";
import { getExplorerAddressUrl } from "@/lib/explorer";

function truncate(address: string) {
    return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

interface OwnerPillProps {
    address: string | undefined;
    /**
     * What the contract calls this account. Groups and agents expose `owner()`;
     * devices are AccessControl-governed and have no owner, so their controlling
     * account is labelled by the role it holds.
     */
    label?: string;
    /** Where the address comes from on-chain — shown on hover. */
    title?: string;
    /**
     * `pill` (default) is the standalone chip used in a page header. `inline` drops the
     * chrome so the address can sit inside a denser row — and with it the explorer link,
     * since those rows are themselves links and an anchor cannot nest inside one.
     */
    variant?: "pill" | "inline";
}

/** The account that controls a contract, shown alongside the contract's own address. */
export function OwnerPill({ address, label = "Owner", title, variant = "pill" }: OwnerPillProps) {
    const known = useAccountLabel(address);
    if (!address) return null;

    const explorerUrl = getExplorerAddressUrl(address);
    const isPill = variant === "pill";
    // A named account still shows its address on hover, so the name never hides which
    // key it is.
    const hover = [title, address].filter(Boolean).join("\n");

    return (
        <span
            title={hover}
            className={
                isPill
                    ? "bg-muted/50 text-muted-foreground flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-2 text-xs"
                    : "text-muted-foreground/70 inline-flex items-center gap-1 text-[11px]"
            }
        >
            <User className={isPill ? "h-3.5 w-3.5" : "h-3 w-3"} />
            {label}:{" "}
            {known?.name ? (
                <span className="text-foreground/80 font-medium">{known.name}</span>
            ) : (
                <span className="font-mono">{truncate(address)}</span>
            )}
            {isPill && explorerUrl && (
                <a
                    href={explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground/60 hover:text-foreground transition-colors"
                    aria-label={`View ${label.toLowerCase()} in explorer`}
                    onClick={(e) => e.stopPropagation()}
                >
                    <ExternalLink className="h-3 w-3" />
                </a>
            )}
        </span>
    );
}
