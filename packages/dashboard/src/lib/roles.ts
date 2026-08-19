import { type Hex, keccak256, toBytes } from "viem";

/**
 * Role identifiers for SmartClawsDevice / SmartClawsAgent.
 *
 * Device roles live in the `DeviceRoles` Solidity library as `internal constant`,
 * so they are not exposed as ABI getters and must be hashed here. The hashes
 * mirror `contracts/DeviceRoles.sol` exactly — keep the strings in sync.
 */
export const DEFAULT_ADMIN_ROLE: Hex =
    "0x0000000000000000000000000000000000000000000000000000000000000000";

export const DEVICE_ROLES = {
    DEFAULT_ADMIN_ROLE,
    DEVICE_ADMIN_ROLE: keccak256(toBytes("DEVICE_ADMIN_ROLE")),
    PUBLISHER_ROLE: keccak256(toBytes("PUBLISHER_ROLE")),
    MASTER_ROLE: keccak256(toBytes("MASTER_ROLE")),
} as const;

export const AGENT_ROLES = {
    DEFAULT_ADMIN_ROLE,
    AGENT_ADMIN_ROLE: keccak256(toBytes("AGENT_ADMIN_ROLE")),
    PUBLISHER_ROLE: keccak256(toBytes("PUBLISHER_ROLE")),
    SENDER_ROLE: keccak256(toBytes("SENDER_ROLE")),
} as const;

export type SubjectKind = "device" | "agent";
export type RoleName = keyof typeof DEVICE_ROLES | keyof typeof AGENT_ROLES;
export type ReaderDirection = "incoming" | "outgoing";

export interface ReaderMeta {
    label: string;
    grants: string;
}

export const READER_META: Record<ReaderDirection, ReaderMeta> = {
    incoming: {
        label: "Incoming reader",
        grants: "May request paid disclosure of encrypted incoming-channel messages",
    },
    outgoing: {
        label: "Outgoing reader",
        grants: "May request paid disclosure of encrypted outgoing-channel messages",
    },
};

export interface RoleMeta {
    /** Short label shown on the badge. */
    label: string;
    /** What the role actually authorises — shown as a tooltip. */
    grants: string;
    /** True when the role permits writing messages, not just administering. */
    write: boolean;
}

const DEVICE_ROLE_META: Record<keyof typeof DEVICE_ROLES, RoleMeta> = {
    DEFAULT_ADMIN_ROLE: {
        label: "Group admin",
        grants: "Administers DEVICE_ADMIN; held by the owning group",
        write: false,
    },
    DEVICE_ADMIN_ROLE: {
        label: "Device admin",
        grants: "Grants/revokes publisher and master; can pause the device",
        write: false,
    },
    PUBLISHER_ROLE: {
        label: "Publisher",
        grants: "Publishes telemetry to the device outgoing channel",
        write: true,
    },
    MASTER_ROLE: {
        label: "Master",
        grants: "Sends commands to the device incoming channel",
        write: true,
    },
};

const AGENT_ROLE_META: Record<keyof typeof AGENT_ROLES, RoleMeta> = {
    DEFAULT_ADMIN_ROLE: {
        label: "Admin",
        grants: "Root admin of the agent; administers AGENT_ADMIN",
        write: false,
    },
    AGENT_ADMIN_ROLE: {
        label: "Agent admin",
        grants: "Grants/revokes publisher and sender; can pause the agent",
        write: false,
    },
    PUBLISHER_ROLE: {
        label: "Publisher",
        grants: "Publishes to the agent outgoing channel",
        write: true,
    },
    SENDER_ROLE: {
        label: "Sender",
        grants: "Publishes inbound messages to the agent incoming channel",
        write: true,
    },
};

/** Roles to probe for a subject, in display order (write roles first). */
export const ROLE_ORDER: Record<SubjectKind, RoleName[]> = {
    device: ["MASTER_ROLE", "PUBLISHER_ROLE", "DEVICE_ADMIN_ROLE", "DEFAULT_ADMIN_ROLE"],
    agent: ["SENDER_ROLE", "PUBLISHER_ROLE", "AGENT_ADMIN_ROLE", "DEFAULT_ADMIN_ROLE"],
};

export function roleHash(kind: SubjectKind, role: RoleName): Hex {
    const table: Record<string, Hex> = kind === "device" ? DEVICE_ROLES : AGENT_ROLES;
    return table[role];
}

export function roleMeta(kind: SubjectKind, role: RoleName): RoleMeta {
    const table = (kind === "device" ? DEVICE_ROLE_META : AGENT_ROLE_META) as Record<
        string,
        RoleMeta
    >;
    return table[role] ?? { label: role, grants: role, write: false };
}
