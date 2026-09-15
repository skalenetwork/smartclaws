import { useMemo } from "react";
import { ActivityFeed } from "@/components/overview/activity-feed";
import { ActivitySummary } from "@/components/overview/activity-summary";
import { ChannelList } from "@/components/overview/channel-list";
import { UnregisteredAgents } from "@/components/overview/unregistered-agents";
import { registryAddress } from "@/config/wagmi";
import { useChannelDirectory } from "@/hooks/use-channel-directory";
import { useExplorerTotals } from "@/hooks/use-explorer-totals";
import { useFailedReadAttemptsForChannels } from "@/hooks/use-failed-read-attempts";
import { useNetworkActivity } from "@/hooks/use-network-activity";
import { useSenders } from "@/hooks/use-senders";

export function OverviewPage() {
    const directory = useChannelDirectory();

    const channelAddresses = useMemo(
        () => directory.channels.map((channel) => channel.address),
        [directory.channels],
    );
    const encryptedChannels = useMemo(
        () =>
            directory.channels
                .filter((channel) => channel.kind === "encrypted")
                .map((channel) => channel.address),
        [directory.channels],
    );
    const channelsByAddress = useMemo(
        () =>
            new Map(directory.channels.map((channel) => [channel.address.toLowerCase(), channel])),
        [directory.channels],
    );

    const senders = useSenders(directory.channels);
    const senderByChannel = useMemo(
        () =>
            new Map(
                directory.channels.map((channel) => [
                    channel.address.toLowerCase(),
                    senders.channel(channel),
                ]),
            ),
        [directory.channels, senders],
    );

    const activity = useNetworkActivity(channelAddresses);
    const refused = useFailedReadAttemptsForChannels(encryptedChannels);

    // Every contract the registry knows about; the explorer counts transactions sent to each.
    const counted = useMemo(
        () => [
            registryAddress,
            ...directory.groupAddresses,
            ...directory.subjects.map((subject) => subject.address),
            ...channelAddresses,
        ],
        [directory.groupAddresses, directory.subjects, channelAddresses],
    );
    const totals = useExplorerTotals(counted);

    const events = activity.data ?? [];
    const isLoading = directory.isLoading || activity.isLoading;

    return (
        <div className="space-y-3">
            <ActivitySummary
                events={events}
                refused={refused.attempts}
                senderByChannel={senderByChannel}
                totals={totals}
                isLoading={isLoading}
                isFetching={activity.isFetching}
            />
            <div className="grid gap-3 lg:grid-cols-3">
                <ActivityFeed
                    className="lg:col-span-2"
                    events={events}
                    refused={refused.attempts}
                    channels={channelsByAddress}
                    senders={senders}
                    senderByChannel={senderByChannel}
                    isLoading={isLoading}
                />
                <div className="space-y-3 self-start">
                    <ChannelList
                        channels={directory.channels}
                        senderByChannel={senderByChannel}
                        events={events}
                        groupCount={directory.groupAddresses.length}
                        isLoading={directory.isLoading}
                    />
                    <UnregisteredAgents agents={senders.unregistered} events={events} />
                </div>
            </div>
        </div>
    );
}
