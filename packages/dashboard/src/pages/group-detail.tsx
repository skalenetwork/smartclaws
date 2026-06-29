import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpRight,
  Box,
  Calendar,
  ExternalLink,
  User,
  Wrench,
} from "lucide-react";
import { Link, useParams } from "react-router";
import type { Address } from "viem";
import { AddressAvatar } from "@/components/shared/address-avatar";
import { EmptyState } from "@/components/shared/empty-state";
import { SkillsView } from "@/components/shared/skills-view";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useGroupDetail } from "@/hooks/use-group-detail";
import { getExplorerAddressUrl } from "@/lib/explorer";
import { timeAgo, timeAgoColors } from "@/lib/time-ago";

export function GroupDetailPage() {
  const { address } = useParams<{ address: string }>();
  if (!address) return null;

  return <GroupDetailContent address={address} />;
}

function GroupDetailContent({ address }: { address: string }) {
  const { groupName, skills, owner, devices, isLoading } = useGroupDetail(address as Address);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  const explorerUrl = getExplorerAddressUrl(address);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link
          to="/groups"
          className="flex items-center justify-center h-7 w-7 rounded-full bg-muted/50 hover:bg-muted text-muted-foreground transition-colors shrink-0"
          title="Back to groups"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </Link>
        <AddressAvatar address={address} size={36} kind="group" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold">{groupName || "Unnamed"}</h1>
            <Badge variant="secondary" className="text-[10px] px-2 py-0.5">
              Device group
            </Badge>
          </div>
          <p className="text-muted-foreground/80 text-xs truncate">{address}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {owner && (
            <div className="flex items-center gap-1.5 bg-muted/50 rounded-full px-3.5 py-2 text-xs text-muted-foreground">
              <User className="h-3.5 w-3.5" />
              Owner: {owner.slice(0, 6)}…{owner.slice(-4)}
            </div>
          )}
          {explorerUrl && (
            <a
              href={explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 bg-muted/50 hover:bg-muted rounded-full px-3.5 py-2 text-xs text-muted-foreground transition-colors"
            >
              View in Explorer
              <ExternalLink className="h-3 w-3 opacity-50" />
            </a>
          )}
        </div>
      </div>

      <Tabs defaultValue="devices">
        <TabsList>
          <TabsTrigger value="devices">
            <Box className="h-4 w-4" />
            Devices ({devices.length})
          </TabsTrigger>
          <TabsTrigger value="skills">
            <Wrench className="h-4 w-4" />
            Skills
          </TabsTrigger>
        </TabsList>

        <TabsContent value="devices">
          {devices.length === 0 ? (
            <EmptyState message="No devices in this group" />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {devices.map((device) => (
                <Link key={device.address} to={`/devices/${device.address}`}>
                  <Card className="hover:shadow-md transition-shadow duration-200 cursor-pointer p-0 relative">
                    <CardContent className="p-4 space-y-3">
                      {(() => {
                        const { label, color } = timeAgo(device.lastMessageTs);
                        return (
                          <span
                            className={`absolute top-3 right-3 text-[10px] font-medium rounded-full px-2 py-0.5 ${timeAgoColors[color]}`}
                          >
                            {label}
                          </span>
                        );
                      })()}
                      <div className="flex items-center gap-3 pr-16">
                        <AddressAvatar address={device.address} size={40} kind="device" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">
                            {device.devName ||
                              `${device.address.slice(0, 14)}...${device.address.slice(-4)}`}
                          </p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <Calendar className="h-3 w-3 text-muted-foreground" />
                            <span className="text-xs text-muted-foreground truncate">
                              {device.createdAt
                                ? new Date(Number(device.createdAt) * 1000).toLocaleDateString()
                                : "Registered device"}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/50 rounded-md px-2 py-1 min-w-0">
                          <ArrowUpRight className="h-3 w-3 text-emerald-500 shrink-0" />
                          <span className="truncate">
                            {device.outgoingChannel.slice(0, 8)}...
                            {device.outgoingChannel.slice(-4)}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/50 rounded-md px-2 py-1 min-w-0">
                          <ArrowDownLeft className="h-3 w-3 text-blue-500 shrink-0" />
                          <span className="truncate">
                            {device.incomingChannel.slice(0, 8)}...
                            {device.incomingChannel.slice(-4)}
                          </span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="skills">
          <SkillsView skills={skills || ""} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
