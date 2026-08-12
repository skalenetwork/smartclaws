import { ChevronRight, Cpu, KeyRound, LayoutDashboard, Rocket, Wrench } from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "react-router";
import type { Address } from "viem";
import logoSvg from "@/assets/logo.svg";
import { AddressAvatar } from "@/components/shared/address-avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { useAgents } from "@/hooks/use-agents";
import { useDeviceGroups } from "@/hooks/use-device-groups";
import { type DeviceInfo, useGroupDetail } from "@/hooks/use-group-detail";
import { timeAgo } from "@/lib/time-ago";
import { cn } from "@/lib/utils";

const dotColors = {
    emerald: "bg-emerald-500",
    amber: "bg-amber-500",
    red: "bg-red-500",
    muted: "bg-muted-foreground/40",
} as const;

function SectionLabel({ children }: { children: React.ReactNode }) {
    return <p className="text-xs font-medium text-muted-foreground/60 pt-4 pb-1">{children}</p>;
}

function SidebarGroup({ address, name }: { address: Address; name: string }) {
    const [open, setOpen] = useState(true);
    const location = useLocation();
    const { devices, isLoading } = useGroupDetail(address);

    const isGroupActive = location.pathname === `/groups/${address}`;

    return (
        <div>
            <div
                className={cn(
                    "flex items-center rounded-md transition-colors",
                    isGroupActive
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
            >
                <Link
                    to={`/groups/${address}`}
                    className={cn(
                        "flex-1 min-w-0 flex items-center gap-2 pl-2 py-1.5 text-sm truncate",
                    )}
                >
                    <AddressAvatar address={address} size={18} kind="group" />
                    <span className="truncate">{name || "Unnamed"}</span>
                </Link>
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        setOpen(!open);
                    }}
                    className="flex items-center justify-center px-2.5 py-1.5 shrink-0"
                >
                    <ChevronRight
                        className={cn(
                            "h-3.5 w-3.5 transition-transform duration-200",
                            open && "rotate-90",
                        )}
                    />
                </button>
            </div>
            {open && (
                <div className="ml-4 pl-3 border-l border-border/50 space-y-0.5 py-1">
                    {isLoading ? (
                        <>
                            <Skeleton className="h-7 w-24 rounded" />
                            <Skeleton className="h-7 w-20 rounded" />
                        </>
                    ) : devices.length === 0 ? (
                        <span className="text-xs text-muted-foreground/50 px-3">No devices</span>
                    ) : (
                        devices.map((device: DeviceInfo) => {
                            const isDeviceActive =
                                location.pathname === `/devices/${device.address}`;
                            const { color, label } = timeAgo(device.lastMessageTs);
                            return (
                                <Link
                                    key={device.address}
                                    to={`/devices/${device.address}`}
                                    className={cn(
                                        "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                                        isDeviceActive
                                            ? "bg-accent text-accent-foreground"
                                            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                                    )}
                                >
                                    <AddressAvatar
                                        address={device.address}
                                        size={18}
                                        kind="device"
                                    />
                                    <span className="truncate flex-1">
                                        {device.devName ||
                                            `${device.address.slice(0, 8)}…${device.address.slice(-4)}`}
                                    </span>
                                    <span
                                        title={label}
                                        className={cn(
                                            "h-1.5 w-1.5 rounded-full shrink-0 mr-1.5",
                                            dotColors[color],
                                        )}
                                    />
                                </Link>
                            );
                        })
                    )}
                </div>
            )}
        </div>
    );
}

function SidebarAgents() {
    const location = useLocation();
    const { agents, isLoading } = useAgents();

    if (isLoading) {
        return (
            <div className="px-3 space-y-2 py-1">
                <Skeleton className="h-7 w-28 rounded" />
                <Skeleton className="h-7 w-24 rounded" />
            </div>
        );
    }

    if (agents.length === 0) {
        return <span className="text-xs text-muted-foreground/50 px-3">No agents</span>;
    }

    return (
        <div className="space-y-0.5">
            {agents.map((agent) => {
                const isActive = location.pathname === `/agents/${agent.address}`;
                const { color, label } = timeAgo(agent.lastMessageTs);
                return (
                    <Link
                        key={agent.address}
                        to={`/agents/${agent.address}`}
                        className={cn(
                            "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                            isActive
                                ? "bg-accent text-accent-foreground"
                                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                        )}
                    >
                        <AddressAvatar address={agent.address} size={18} kind="agent" />
                        <span className="truncate flex-1">
                            {agent.agentId ||
                                `${agent.address.slice(0, 8)}…${agent.address.slice(-4)}`}
                        </span>
                        <span
                            title={label}
                            className={cn(
                                "h-1.5 w-1.5 rounded-full shrink-0 mr-1.5",
                                dotColors[color],
                            )}
                        />
                    </Link>
                );
            })}
        </div>
    );
}

export function Sidebar() {
    const location = useLocation();
    const { groups, isLoading } = useDeviceGroups();

    return (
        <aside className="hidden md:flex w-56 flex-col border-r border-border">
            <Link
                to="/"
                className="flex items-center gap-2 px-4 h-12 border-b border-border shrink-0"
            >
                <img src={logoSvg} alt="SmartClaws" className="h-4 w-4" />
                <span
                    className="font-semibold text-sm tracking-tight"
                    style={{
                        background: "linear-gradient(to right, #FF444D, #00B7A3)",
                        WebkitBackgroundClip: "text",
                        WebkitTextFillColor: "transparent",
                    }}
                >
                    SmartClaws
                </span>
            </Link>
            <nav className="flex-1 px-2 pb-3 overflow-y-auto">
                <div className="pt-2">
                    <Link
                        to="/overview"
                        className={cn(
                            "flex items-center gap-2.5 rounded-md px-3 py-1.5 text-sm transition-colors",
                            location.pathname === "/overview"
                                ? "bg-accent text-accent-foreground font-medium"
                                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                        )}
                    >
                        <LayoutDashboard className="h-4 w-4 shrink-0" />
                        Overview
                    </Link>
                </div>
                <SectionLabel>Device Groups</SectionLabel>
                <div className="space-y-0.5">
                    {isLoading ? (
                        <div className="px-3 space-y-2 py-1">
                            <Skeleton className="h-7 w-32 rounded" />
                            <Skeleton className="h-7 w-28 rounded" />
                        </div>
                    ) : groups.length === 0 ? (
                        <span className="text-xs text-muted-foreground/50 px-3">No groups</span>
                    ) : (
                        groups.map((group) => (
                            <SidebarGroup
                                key={group.address}
                                address={group.address}
                                name={group.groupName}
                            />
                        ))
                    )}
                </div>

                <SectionLabel>Agents</SectionLabel>
                <Link
                    to="/agents"
                    className={cn(
                        "flex items-center gap-2.5 rounded-md px-3 py-1.5 text-sm transition-colors",
                        location.pathname === "/agents"
                            ? "bg-accent text-accent-foreground font-medium"
                            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                    )}
                >
                    <Cpu className="h-4 w-4 shrink-0" />
                    All Agents
                </Link>
                <div className="ml-4 pl-3 border-l border-border/50 py-1">
                    <SidebarAgents />
                </div>
                <Link
                    to="/access"
                    className={cn(
                        "flex items-center gap-2.5 rounded-md px-3 py-1.5 text-sm transition-colors",
                        location.pathname === "/access"
                            ? "bg-accent text-accent-foreground font-medium"
                            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                    )}
                >
                    <KeyRound className="h-4 w-4 shrink-0" />
                    Access
                </Link>

                <SectionLabel>Skills</SectionLabel>
                <Link
                    to="/skills"
                    className={cn(
                        "flex items-center gap-2.5 rounded-md px-3 py-1.5 text-sm transition-colors",
                        location.pathname === "/skills"
                            ? "bg-accent text-accent-foreground font-medium"
                            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                    )}
                >
                    <Wrench className="h-4 w-4 shrink-0" />
                    All Skills
                </Link>
                <Link
                    to="/setup"
                    className={cn(
                        "flex items-center gap-2.5 rounded-md px-3 py-1.5 text-sm transition-colors",
                        location.pathname === "/setup"
                            ? "bg-accent text-accent-foreground font-medium"
                            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                    )}
                >
                    <Rocket className="h-4 w-4 shrink-0" />
                    Setup
                </Link>
            </nav>
        </aside>
    );
}
