import { Link } from "react-router";
import { AddressAvatar } from "@/components/shared/address-avatar";
import { DeviceCountPill } from "@/components/shared/device-count-pill";
import { EmptyState } from "@/components/shared/empty-state";
import { SkillChips } from "@/components/shared/skill-chips";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useDeviceGroups } from "@/hooks/use-device-groups";

export function DeviceGroupsPage() {
    const { groups, isLoading } = useDeviceGroups();

    return (
        <div>
            {isLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {[1, 2, 3].map((i) => (
                        <Skeleton key={i} className="h-40 rounded-xl" />
                    ))}
                </div>
            ) : groups.length === 0 ? (
                <EmptyState message="No device groups registered" />
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {groups.map((group) => (
                        <Link key={group.address} to={`/groups/${group.address}`}>
                            <Card className="hover:shadow-md transition-shadow duration-200 cursor-pointer p-0">
                                <CardContent className="p-4 space-y-3">
                                    <div className="flex items-center gap-3">
                                        <AddressAvatar
                                            address={group.address}
                                            size={40}
                                            kind="group"
                                        />
                                        <div className="min-w-0 flex-1">
                                            <h3 className="text-base font-semibold leading-tight truncate">
                                                {group.groupName || "Unnamed"}
                                            </h3>
                                            <StatusBadge active={group.active} />
                                        </div>
                                    </div>
                                    <SkillChips skills={group.skills || ""} />
                                    <DeviceCountPill count={group.deviceCount} />
                                </CardContent>
                            </Card>
                        </Link>
                    ))}
                </div>
            )}
        </div>
    );
}
