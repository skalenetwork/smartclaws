import { ExternalLink } from "lucide-react";
import { getExplorerAddressUrl } from "@/lib/explorer";
import { AddressAvatar, type AvatarKind } from "./address-avatar";

function truncate(address: string) {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

interface AddressBadgeProps {
    address: string;
    avatarSize?: number;
    kind?: AvatarKind;
}

export function AddressBadge({ address, avatarSize = 20, kind }: AddressBadgeProps) {
    const explorerUrl = getExplorerAddressUrl(address);

    return (
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <AddressAvatar address={address} size={avatarSize} kind={kind} />
            {truncate(address)}
            {explorerUrl && (
                <a
                    href={explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground/60 hover:text-foreground transition-colors"
                    onClick={(e) => e.stopPropagation()}
                >
                    <ExternalLink className="h-3 w-3" />
                </a>
            )}
        </span>
    );
}
