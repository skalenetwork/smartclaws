import { Check, Copy, ExternalLink } from "lucide-react";
import { useState } from "react";
import { AddressAvatar } from "@/components/shared/address-avatar";
import { getExplorerAddressUrl } from "@/lib/explorer";

/** Address strip shown above a channel view, with copy + explorer links. */
export function ChannelAddressBar({ address }: { address: string }) {
    const [copied, setCopied] = useState(false);
    const explorerUrl = getExplorerAddressUrl(address);

    function handleCopy() {
        navigator.clipboard.writeText(address);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }

    return (
        <div className="bg-card flex items-center gap-2 rounded-lg border px-3 py-1.5">
            <AddressAvatar address={address} size={16} kind="channel" />
            <code className="text-muted-foreground min-w-0 flex-1 truncate font-mono text-xs">
                {address}
            </code>
            <button
                type="button"
                onClick={handleCopy}
                className="text-muted-foreground/60 hover:text-foreground hover:bg-muted shrink-0 rounded-md p-1 transition-colors"
                title="Copy address"
            >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
            {explorerUrl && (
                <a
                    href={explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground/60 hover:text-foreground hover:bg-muted shrink-0 rounded-md p-1 transition-colors"
                    title="View in Explorer"
                >
                    <ExternalLink className="h-3.5 w-3.5" />
                </a>
            )}
        </div>
    );
}
