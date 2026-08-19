import { createBackup, presentCreatedBackup } from "../backup.js";
import { SmartClawsError } from "../errors.js";
import { generateViewKey, loadWallet, removeViewKey } from "../wallet.js";
import { publicKeyFingerprint, publicKeyFromPrivateKey, viewingPrivateKey } from "./keys.js";

function requireWallet(homeDir: string) {
    const wallet = loadWallet(homeDir);
    if (!wallet) {
        throw new SmartClawsError("NO_WALLET", "No wallet in this SmartClaws HOME.");
    }
    return wallet;
}

function activeFingerprint(homeDir: string): string {
    const wallet = requireWallet(homeDir);
    return publicKeyFingerprint(publicKeyFromPrivateKey(viewingPrivateKey(wallet)));
}

export function generateViewKeyIfAbsent(homeDir: string): {
    fingerprint: string;
    registrationRequired: true;
    viewKeyMissing: false;
} {
    const wallet = requireWallet(homeDir);
    if (wallet.viewPrivateKey !== undefined) {
        throw new SmartClawsError(
            "INVALID_TARGET",
            "A separate viewing key already exists. Use smartclaws_view_key_rotate to replace it.",
        );
    }
    generateViewKey(homeDir);
    return {
        fingerprint: activeFingerprint(homeDir),
        registrationRequired: true,
        viewKeyMissing: false,
    };
}

export function rotateViewKeyChecked(input: {
    homeDir: string;
    expectedCurrentKeyFingerprint: string;
    confirmAbandonInflightDisclosures: boolean;
}): {
    fingerprint: string;
    backupName: string;
    registrationRequired: true;
    abandonedInflightDisclosures: true;
} {
    if (input.confirmAbandonInflightDisclosures !== true) {
        throw new SmartClawsError(
            "INVALID_TARGET",
            "Rotating a viewing key abandons in-flight disclosures. Pass confirmAbandonInflightDisclosures: true.",
        );
    }
    const current = activeFingerprint(input.homeDir);
    if (current !== input.expectedCurrentKeyFingerprint) {
        throw new SmartClawsError(
            "STATE_CHANGED",
            "Current viewing-key fingerprint does not match expectedCurrentKeyFingerprint.",
            { expected: input.expectedCurrentKeyFingerprint, actual: current },
        );
    }
    const backup = createBackup(input.homeDir);
    generateViewKey(input.homeDir);
    return {
        fingerprint: activeFingerprint(input.homeDir),
        backupName: presentCreatedBackup(backup, input.homeDir).name,
        registrationRequired: true,
        abandonedInflightDisclosures: true,
    };
}

export function forgetViewKeyChecked(homeDir: string): {
    fingerprint: string;
    backupName: string;
    registrationRequired: true;
    viewKeyMissing: true;
} {
    const wallet = requireWallet(homeDir);
    if (wallet.viewPrivateKey === undefined) {
        throw new SmartClawsError("INVALID_TARGET", "No viewing key is stored.");
    }
    const fingerprint = activeFingerprint(homeDir);
    const backup = createBackup(homeDir);
    removeViewKey(homeDir);
    return {
        fingerprint,
        backupName: presentCreatedBackup(backup, homeDir).name,
        registrationRequired: true,
        viewKeyMissing: true,
    };
}
