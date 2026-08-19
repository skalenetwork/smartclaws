import { getAddress } from "viem";
import { SmartClawsError } from "../errors.js";

const ADMINISTRATIVE_ROLES = new Set(["master", "agent-admin"]);

export function sameAccount(left: string, right: string): boolean {
    return left.toLowerCase() === right.toLowerCase();
}

/**
 * Stale-state protection for revoking an administrative role from the active wallet.
 * This is not authorization — OpenClaw tool gating still has to deny the tool.
 */
export function assertNotSelfLockout(params: {
    walletAddress: string;
    account: string;
    role: string;
    allowSelfRevocation?: boolean;
}): void {
    if (!sameAccount(params.walletAddress, params.account)) return;
    if (!ADMINISTRATIVE_ROLES.has(params.role)) return;
    if (params.allowSelfRevocation) return;
    throw new SmartClawsError(
        "SELF_LOCKOUT_RISK",
        `Refusing to revoke ${params.role} from the active wallet without allowSelfRevocation.`,
        {
            account: getAddress(params.account),
            role: params.role,
            lockout: "possible",
        },
    );
}

export function assertNotSelfReaderRevocation(params: {
    walletAddress: string;
    account: string;
    allowSelfRevocation?: boolean;
}): void {
    if (!sameAccount(params.walletAddress, params.account)) return;
    if (params.allowSelfRevocation) return;
    throw new SmartClawsError(
        "SELF_LOCKOUT_RISK",
        "Refusing to remove the active wallet's own reader access without allowSelfRevocation.",
        { account: getAddress(params.account), lockout: "possible" },
    );
}
