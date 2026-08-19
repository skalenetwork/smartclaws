import { KeyRound, ShieldCheck } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router";
import { AddressAvatar } from "@/components/shared/address-avatar";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { type SubjectRef, useAccessMatrix } from "@/hooks/use-access-matrix";
import { READER_META, roleMeta } from "@/lib/roles";

function SubjectLink({ subject }: { subject: SubjectRef }) {
    const path =
        subject.kind === "device" ? `/devices/${subject.address}` : `/agents/${subject.address}`;
    return (
        <Link
            to={path}
            className="hover:bg-muted/50 flex items-center gap-1.5 rounded-md px-1.5 py-0.5 transition-colors"
        >
            <AddressAvatar address={subject.address} size={14} kind={subject.kind} />
            <span className="text-xs">{subject.label}</span>
        </Link>
    );
}

export function AccessPage() {
    const { rows, subjectCount, isLoading } = useAccessMatrix();

    const writers = useMemo(() => rows.filter((row) => row.canWriteSomewhere), [rows]);

    if (isLoading && rows.length === 0) {
        return (
            <div className="space-y-3">
                <Skeleton className="h-8 w-48" />
                <Skeleton className="h-24 rounded-xl" />
                <Skeleton className="h-24 rounded-xl" />
            </div>
        );
    }

    return (
        <div>
            <PageHeader
                title="Access"
                description={
                    rows.length === 0
                        ? "No permissions found"
                        : `${writers.length} of ${rows.length} accounts can write, across ${subjectCount} devices and agents`
                }
            />

            {rows.length === 0 ? (
                <EmptyState message="No role holders found across the registry" icon={KeyRound} />
            ) : (
                <div className="space-y-2">
                    {rows.map((row) => (
                        <Card key={row.account}>
                            <CardContent className="flex items-start gap-3 py-3">
                                {row.canWriteSomewhere ? (
                                    <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                                ) : (
                                    <ShieldCheck className="text-muted-foreground/50 mt-0.5 h-4 w-4 shrink-0" />
                                )}
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-sm font-medium">{row.label}</span>
                                        <span className="text-muted-foreground/60 text-[11px]">
                                            controls {row.grants.length} · reads{" "}
                                            {row.readerGrants.length}
                                        </span>
                                    </div>
                                    {row.readerGrants.length > 0 && (
                                        <div className="mt-3 border-t pt-2">
                                            <p className="text-muted-foreground mb-1.5 text-[10px] font-medium uppercase tracking-wide">
                                                Encrypted channel reader ACLs
                                            </p>
                                            <div className="space-y-1.5">
                                                {row.readerGrants.map((grant) => (
                                                    <div
                                                        key={`reader-${grant.subject.address}-${grant.subject.kind}`}
                                                        className="flex flex-wrap items-center gap-1.5"
                                                    >
                                                        <SubjectLink subject={grant.subject} />
                                                        {grant.directions.map((direction) => (
                                                            <Badge
                                                                key={direction}
                                                                variant="outline"
                                                                className="px-2 py-0.5 text-[10px]"
                                                                title={
                                                                    READER_META[direction].grants
                                                                }
                                                            >
                                                                {READER_META[direction].label}
                                                            </Badge>
                                                        ))}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                    <p className="text-muted-foreground/70 mt-0.5 font-mono text-[11px] break-all">
                                        {row.account}
                                    </p>

                                    <div className="mt-2 space-y-1.5">
                                        {row.grants.map((grant) => (
                                            <div
                                                key={`${grant.subject.address}-${grant.subject.kind}`}
                                                className="flex flex-wrap items-center gap-1.5"
                                            >
                                                <SubjectLink subject={grant.subject} />
                                                {grant.roles.map((role) => {
                                                    const meta = roleMeta(grant.subject.kind, role);
                                                    return (
                                                        <Badge
                                                            key={role}
                                                            variant={
                                                                meta.write ? "secondary" : "outline"
                                                            }
                                                            className="px-2 py-0.5 text-[10px]"
                                                            title={meta.grants}
                                                        >
                                                            {meta.label}
                                                        </Badge>
                                                    );
                                                })}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}
        </div>
    );
}
