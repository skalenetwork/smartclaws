import { Info, KeyRound, ShieldCheck } from "lucide-react";
import { Link } from "react-router";
import type { Address } from "viem";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAccessRoles } from "@/hooks/use-access-roles";
import type { ChannelKind } from "@/hooks/use-channel-kind";
import { READER_META, roleMeta, type SubjectKind } from "@/lib/roles";

interface AccessPanelProps {
    subject: Address | undefined;
    kind: SubjectKind;
    channelKind?: ChannelKind;
}

export function AccessPanel({ subject, kind, channelKind }: AccessPanelProps) {
    const { holders, readers, candidateCount, isLoading } = useAccessRoles(
        subject,
        kind,
        channelKind,
    );

    if (isLoading && holders.length === 0) {
        return (
            <div className="space-y-2">
                <Skeleton className="h-16 rounded-xl" />
                <Skeleton className="h-16 rounded-xl" />
            </div>
        );
    }

    const writers = holders.filter((holder) => holder.canWrite);

    return (
        <div className="space-y-4">
            <div className="space-y-2">
                <h3 className="text-sm font-medium">AccessControl roles</h3>
                <Card>
                    <CardContent className="flex items-start gap-2 py-3 text-xs">
                        <Info className="text-muted-foreground/60 mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span className="text-muted-foreground">
                            {writers.length === 0
                                ? "No account can currently write to this "
                                : `${writers.length} account${writers.length === 1 ? "" : "s"} can write to this `}
                            {kind}. Checked {candidateCount} known account
                            {candidateCount === 1 ? "" : "s"} from the registry — an address outside
                            the registry graph would not be listed.
                        </span>
                    </CardContent>
                </Card>

                {holders.length === 0 ? (
                    <Card>
                        <CardContent className="text-muted-foreground py-8 text-center text-sm">
                            No role holders found
                        </CardContent>
                    </Card>
                ) : (
                    holders.map((holder) => (
                        <Card key={holder.account}>
                            <CardContent className="flex items-start gap-3 py-3">
                                {holder.canWrite ? (
                                    <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                                ) : (
                                    <ShieldCheck className="text-muted-foreground/50 mt-0.5 h-4 w-4 shrink-0" />
                                )}
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-sm font-medium">{holder.label}</span>
                                        {holder.roles.map((role) => {
                                            const meta = roleMeta(kind, role);
                                            return (
                                                <Badge
                                                    key={role}
                                                    variant={meta.write ? "secondary" : "outline"}
                                                    className="px-2 py-0.5 text-[10px]"
                                                    title={meta.grants}
                                                >
                                                    {meta.label}
                                                </Badge>
                                            );
                                        })}
                                    </div>
                                    {holder.kind === "agent" ? (
                                        <Link
                                            to={`/agents/${holder.account}`}
                                            className="text-muted-foreground/70 hover:text-foreground mt-1 block font-mono text-[11px] break-all transition-colors"
                                        >
                                            {holder.account}
                                        </Link>
                                    ) : (
                                        <p className="text-muted-foreground/70 mt-1 font-mono text-[11px] break-all">
                                            {holder.account}
                                        </p>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    ))
                )}
            </div>

            <div className="space-y-2">
                <h3 className="text-sm font-medium">Encrypted channel reader ACLs</h3>
                <Card>
                    <CardContent className="flex items-start gap-2 py-3 text-xs">
                        <Info className="text-muted-foreground/60 mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span className="text-muted-foreground">
                            Reader permissions are channel ACL entries, not AccessControl roles.
                            They authorize paid disclosure requests; this dashboard only observes
                            them.
                        </span>
                    </CardContent>
                </Card>
                {readers.length === 0 ? (
                    <Card>
                        <CardContent className="text-muted-foreground py-8 text-center text-sm">
                            No encrypted channel readers found
                        </CardContent>
                    </Card>
                ) : (
                    readers.map((reader) => (
                        <Card key={reader.account}>
                            <CardContent className="flex items-start gap-3 py-3">
                                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-sky-500" />
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-sm font-medium">{reader.label}</span>
                                        {reader.directions.map((direction) => (
                                            <Badge
                                                key={direction}
                                                variant="outline"
                                                className="px-2 py-0.5 text-[10px]"
                                                title={READER_META[direction].grants}
                                            >
                                                {READER_META[direction].label}
                                            </Badge>
                                        ))}
                                    </div>
                                    <p className="text-muted-foreground/70 mt-1 font-mono text-[11px] break-all">
                                        {reader.account}
                                    </p>
                                </div>
                            </CardContent>
                        </Card>
                    ))
                )}
            </div>
        </div>
    );
}
