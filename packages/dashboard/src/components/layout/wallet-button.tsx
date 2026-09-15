import {
    Check,
    ChevronDown,
    Copy,
    ExternalLink,
    KeyRound,
    Loader2,
    LogOut,
    TriangleAlert,
    Wallet,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { type Address, BaseError } from "viem";
import {
    type Connector,
    useAccount,
    useConnect,
    useConnectors,
    useDisconnect,
    useSwitchChain,
} from "wagmi";
import { AddressAvatar } from "@/components/shared/address-avatar";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { chain } from "@/config/wagmi";
import { useAccountLabel } from "@/hooks/use-account-label";
import { useRestoreViewer, useViewKey, type ViewKeyStatus } from "@/hooks/use-viewer";
import { getExplorerAddressUrl } from "@/lib/explorer";
import { cn } from "@/lib/utils";
import { isUserRejection } from "@/lib/viewer/disclose";
import { sessionRecords } from "@/lib/viewer/session-records";
import { viewKey } from "@/lib/viewer/view-key";

function truncate(address: string) {
    return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** Wallet connection and the viewing-key setup that disclosures need. Lives in the header. */
export function WalletButton() {
    useRestoreViewer();
    const { address, chainId, status } = useAccount();

    if (status === "reconnecting" || status === "connecting") {
        return (
            <Button size="sm" disabled>
                <Loader2 className="animate-spin" />
                Connecting
            </Button>
        );
    }
    if (!address) return <ConnectButton />;
    if (chainId !== chain.id) return <SwitchChainButton />;
    return <WalletMenu address={address} />;
}

function ConnectButton() {
    const connectors = useConnectors();
    const { connectAsync, isPending } = useConnect();
    // Wallets announcing themselves (EIP-6963) carry a name and icon; the generic injected
    // connector is only the fallback when none did.
    const announced = connectors.filter((connector) => connector.id !== "injected");
    const wallets = announced.length > 0 ? announced : connectors;

    async function connect(connector: Connector) {
        try {
            await connectAsync({ connector, chainId: chain.id });
        } catch (error) {
            if (isUserRejection(error)) return;
            const missing = error instanceof Error && error.name === "ProviderNotFoundError";
            toast.error(missing ? "No browser wallet found" : "Could not connect", {
                description: missing
                    ? "Install a wallet extension such as MetaMask to request disclosures."
                    : error instanceof BaseError
                      ? error.shortMessage
                      : String(error),
            });
        }
    }

    const icon = isPending ? <Loader2 className="animate-spin" /> : <Wallet />;

    if (wallets.length <= 1) {
        return (
            <Button
                size="sm"
                disabled={isPending}
                onClick={() => wallets[0] && void connect(wallets[0])}
            >
                {icon}
                Connect wallet
            </Button>
        );
    }

    return (
        <Popover>
            <PopoverTrigger render={<Button size="sm" disabled={isPending} />}>
                {icon}
                Connect wallet
                <ChevronDown />
            </PopoverTrigger>
            <PopoverContent align="end" className="w-56 gap-0.5 rounded-2xl p-1.5">
                {wallets.map((connector) => (
                    <button
                        key={connector.uid}
                        type="button"
                        onClick={() => void connect(connector)}
                        className="hover:bg-muted focus-visible:bg-muted flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm outline-none transition-colors"
                    >
                        {connector.icon ? (
                            <img src={connector.icon} alt="" className="size-5 rounded" />
                        ) : (
                            <Wallet className="text-muted-foreground size-5" />
                        )}
                        {connector.name}
                    </button>
                ))}
            </PopoverContent>
        </Popover>
    );
}

function SwitchChainButton() {
    const { switchChainAsync, isPending } = useSwitchChain();
    return (
        <Button
            size="sm"
            variant="destructive"
            disabled={isPending}
            onClick={() =>
                void switchChainAsync({ chainId: chain.id }).catch((error) => {
                    if (!isUserRejection(error)) toast.error(`Could not switch to ${chain.name}`);
                })
            }
        >
            {isPending ? <Loader2 className="animate-spin" /> : <TriangleAlert />}
            Switch to {chain.name}
        </Button>
    );
}

const SETUP_LABEL: Partial<Record<ViewKeyStatus, string>> = {
    locked: "Set up viewing key",
    unregistered: "Register viewing key",
    mismatch: "Replace viewing key",
};

function WalletMenu({ address }: { address: Address }) {
    const [open, setOpen] = useState(false);
    const viewer = useViewKey();
    const { disconnect } = useDisconnect();
    const setupLabel = SETUP_LABEL[viewer.status];
    const ready = viewer.status === "ready";

    // Signing and registering are one click each from the header. Replacing a key someone
    // else may depend on always goes through the menu, where the consequence is spelled out.
    function runNextStep() {
        if (viewer.status === "locked") void viewer.unlock();
        else if (viewer.status === "unregistered") void viewer.register();
        else setOpen(true);
    }

    function handleDisconnect() {
        viewKey.forget(address);
        sessionRecords.clear(address);
        disconnect();
        setOpen(false);
    }

    return (
        <div className="flex items-center gap-2">
            {setupLabel && (
                <Button size="sm" onClick={runNextStep} disabled={!!viewer.busy}>
                    {viewer.busy ? <Loader2 className="animate-spin" /> : <KeyRound />}
                    {viewer.busy === "signing"
                        ? "Check your wallet"
                        : viewer.busy === "registering"
                          ? "Registering"
                          : setupLabel}
                </Button>
            )}
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger
                    render={<Button variant="outline" size="sm" className="gap-2 pl-1.5" />}
                >
                    <AddressAvatar address={address} size={20} />
                    <span className="font-medium">You</span>
                    <span className="text-muted-foreground hidden font-mono text-xs sm:inline">
                        {truncate(address)}
                    </span>
                    <span
                        aria-hidden="true"
                        className={cn(
                            "size-2 rounded-full",
                            ready ? "bg-emerald-500" : "bg-amber-500",
                        )}
                    />
                    <span className="sr-only">
                        {ready ? "Viewing key ready" : "Viewing key not set up"}
                    </span>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-80 gap-3">
                    <AccountSection address={address} />
                    <ViewKeySection viewer={viewer} />
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleDisconnect}
                        className="text-muted-foreground self-start"
                    >
                        <LogOut />
                        Disconnect
                    </Button>
                </PopoverContent>
            </Popover>
        </div>
    );
}

function AccountSection({ address }: { address: Address }) {
    const known = useAccountLabel(address);
    const [copied, setCopied] = useState(false);
    const explorerUrl = getExplorerAddressUrl(address);

    function copy() {
        void navigator.clipboard.writeText(address);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    }

    return (
        <div className="flex items-start gap-3">
            <AddressAvatar address={address} size={32} />
            <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{known?.name ?? "You"}</p>
                <p className="text-muted-foreground mt-0.5 font-mono text-[11px] break-all">
                    {address}
                </p>
            </div>
            <div className="flex shrink-0 items-center">
                <Button variant="ghost" size="icon-xs" onClick={copy} aria-label="Copy address">
                    {copied ? <Check /> : <Copy />}
                </Button>
                {explorerUrl && (
                    <a
                        href={explorerUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="View wallet in explorer"
                        className="text-muted-foreground hover:text-foreground hover:bg-muted flex size-6 items-center justify-center rounded-full transition-colors"
                    >
                        <ExternalLink className="size-3" />
                    </a>
                )}
            </div>
        </div>
    );
}

const STATUS_COPY: Record<ViewKeyStatus, string> = {
    disconnected: "Connect a wallet to set up a viewing key.",
    "wrong-chain": `Switch your wallet to ${chain.name}.`,
    locked: "Sign a message to create this tab's viewing key. Signing is not a transaction.",
    checking: "Checking the key registry…",
    unregistered:
        "Register the key's public half so channels can encrypt disclosures to it. One transaction.",
    mismatch:
        "This wallet already has a different viewing key registered, perhaps by an agent or the CLI. Replacing it stops that key from opening new disclosures.",
    ready: "Messages disclosed to your wallet decrypt here, in this tab only.",
};

function ViewKeySection({ viewer }: { viewer: ReturnType<typeof useViewKey> }) {
    const { status, busy } = viewer;
    const steps = [
        { label: "Sign to create the key", done: status !== "locked" },
        { label: "Register it on-chain", done: status === "ready" },
    ];

    return (
        <div className="bg-muted/40 space-y-2.5 rounded-2xl p-3">
            <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">Viewing key</p>
                <span
                    className={cn(
                        "rounded-full px-2 py-0.5 text-[11px]",
                        status === "ready"
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                            : "bg-amber-500/10 text-amber-600 dark:text-amber-400",
                    )}
                >
                    {status === "ready" ? "Ready" : "Not ready"}
                </span>
            </div>

            <ol className="space-y-1">
                {steps.map((step, index) => (
                    <li key={step.label} className="flex items-center gap-2 text-xs">
                        <span
                            className={cn(
                                "flex size-4 items-center justify-center rounded-full text-[10px] tabular-nums",
                                step.done
                                    ? "bg-emerald-500 text-white"
                                    : "bg-muted-foreground/15 text-muted-foreground",
                            )}
                        >
                            {step.done ? <Check className="size-2.5" /> : index + 1}
                        </span>
                        <span className={step.done ? "text-muted-foreground" : "text-foreground"}>
                            {step.label}
                        </span>
                    </li>
                ))}
            </ol>

            <p
                className={cn(
                    "text-xs leading-relaxed",
                    status === "mismatch"
                        ? "text-amber-700 dark:text-amber-400"
                        : "text-muted-foreground",
                )}
            >
                {STATUS_COPY[status]}
            </p>

            {status === "locked" && (
                <Button size="sm" className="w-full" onClick={viewer.unlock} disabled={!!busy}>
                    {busy ? <Loader2 className="animate-spin" /> : <KeyRound />}
                    {busy ? "Check your wallet" : "Sign to create key"}
                </Button>
            )}
            {(status === "unregistered" || status === "mismatch") && (
                <Button
                    size="sm"
                    variant={status === "mismatch" ? "destructive" : "default"}
                    className="w-full"
                    onClick={viewer.register}
                    disabled={!!busy}
                >
                    {busy ? <Loader2 className="animate-spin" /> : <KeyRound />}
                    {busy
                        ? "Registering"
                        : status === "mismatch"
                          ? "Replace registered key"
                          : "Register key"}
                </Button>
            )}

            <p className="text-muted-foreground/70 text-[11px] leading-relaxed">
                Demo only: the key is sealed in this tab's session storage and cleared when you
                close the tab or disconnect. It can read disclosures, never move funds.
            </p>
        </div>
    );
}
