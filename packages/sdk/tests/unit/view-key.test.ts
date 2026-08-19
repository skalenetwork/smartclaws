import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generatePrivateKey } from "viem/accounts";
import {
    publicKeyFromPrivateKey,
    publicKeyMatches,
    viewingPrivateKey,
} from "../../src/services/keys.js";
import {
    generateViewKey,
    importWallet,
    loadWallet,
    removeViewKey,
    setViewKey,
} from "../../src/wallet.js";

function withHome<T>(run: (home: string) => T): T {
    const home = mkdtempSync(join(tmpdir(), "smartclaws-viewkey-"));
    try {
        return run(home);
    } finally {
        rmSync(home, { recursive: true, force: true });
    }
}

describe("viewingPrivateKey", () => {
    test("requires a stored viewing key and never falls back to the signing key", () => {
        const privateKey = generatePrivateKey();
        try {
            viewingPrivateKey({ privateKey });
            throw new Error("expected throw");
        } catch (error) {
            expect((error as { code?: string }).code).toBe("NO_VIEW_KEY");
        }
    });

    test("returns the view key once one is set", () => {
        const privateKey = generatePrivateKey();
        const viewPrivateKey = generatePrivateKey();
        expect(viewingPrivateKey({ privateKey, viewPrivateKey })).toBe(viewPrivateKey);
    });
});

describe("view key storage", () => {
    test("a generated view key is distinct from the signing key and leaves the address alone", () => {
        withHome((home) => {
            const signing = generatePrivateKey();
            const before = importWallet(signing, home);
            // The whole point of separating them: rotating must not move the address,
            // because reader ACLs are keyed by address and would lose every grant.
            const after = generateViewKey(home);
            expect(after.address).toBe(before.address);
            expect(after.privateKey).toBe(signing);
            expect(after.viewPrivateKey).toBeDefined();
            expect(after.viewPrivateKey).not.toBe(signing);
        });
    });

    test("the view key persists to the wallet file the init reset salvages", () => {
        withHome((home) => {
            importWallet(generatePrivateKey(), home);
            const viewPrivateKey = generatePrivateKey();
            setViewKey(viewPrivateKey, home);

            const path = join(home, "wallets", "default.json");
            const onDisk = JSON.parse(readFileSync(path, "utf-8"));
            expect(onDisk.viewPrivateKey).toBe(viewPrivateKey);
            expect(loadWallet(home)?.viewPrivateKey).toBe(viewPrivateKey);
        });
    });

    test("an unusable view key is rejected on the free path, not at disclosure time", () => {
        withHome((home) => {
            importWallet(generatePrivateKey(), home);
            expect(() => setViewKey("0x00", home)).toThrow();
            expect(() => setViewKey(`0x${"f".repeat(64)}`, home)).toThrow();
            expect(loadWallet(home)?.viewPrivateKey).toBeUndefined();
        });
    });

    test("accepts a key without the 0x prefix and stores it normalized", () => {
        withHome((home) => {
            importWallet(generatePrivateKey(), home);
            const viewPrivateKey = generatePrivateKey();
            setViewKey(viewPrivateKey.slice(2), home);
            expect(loadWallet(home)?.viewPrivateKey).toBe(viewPrivateKey);
        });
    });

    test("forgetting the view key leaves disclose without a key", () => {
        withHome((home) => {
            const signing = generatePrivateKey();
            importWallet(signing, home);
            generateViewKey(home);
            const wallet = removeViewKey(home);
            expect(wallet.viewPrivateKey).toBeUndefined();
            try {
                viewingPrivateKey(wallet);
                throw new Error("expected throw");
            } catch (error) {
                expect((error as { code?: string }).code).toBe("NO_VIEW_KEY");
            }
        });
    });

    test("rotating replaces the key without touching the wallet identity", () => {
        withHome((home) => {
            const signing = generatePrivateKey();
            importWallet(signing, home);
            const first = generateViewKey(home).viewPrivateKey;
            const second = generateViewKey(home).viewPrivateKey;
            expect(second).not.toBe(first);
            expect(loadWallet(home)?.privateKey).toBe(signing);
        });
    });
});

describe("publicKeyMatches", () => {
    test("accepts the key derived from the same private key", () => {
        const privateKey = generatePrivateKey();
        expect(publicKeyMatches(publicKeyFromPrivateKey(privateKey), privateKey)).toBe(true);
    });

    test("rejects a key derived from a different private key", () => {
        const publicKey = publicKeyFromPrivateKey(generatePrivateKey());
        expect(publicKeyMatches(publicKey, generatePrivateKey())).toBe(false);
    });

    test("compares case-insensitively rather than by string identity", () => {
        const privateKey = generatePrivateKey();
        const publicKey = publicKeyFromPrivateKey(privateKey);
        const shouted = {
            x: publicKey.x.toUpperCase().replace("0X", "0x") as `0x${string}`,
            y: publicKey.y.toUpperCase().replace("0X", "0x") as `0x${string}`,
        };
        expect(publicKeyMatches(shouted, privateKey)).toBe(true);
    });

    test("returns false instead of throwing on an unusable private key", () => {
        const publicKey = publicKeyFromPrivateKey(generatePrivateKey());
        expect(publicKeyMatches(publicKey, "0xnothex")).toBe(false);
    });
});

describe("registration and decryption agree", () => {
    /**
     * The invariant the whole feature rests on: whatever key gets registered must be the key
     * disclosure decrypts with. If these ever diverge the fee is spent on an unreadable
     * payload, and unauthenticated ECIES reports it as a decode error rather than a key error.
     */
    test("the registered public key is always derived from the viewing key", () => {
        const wallet = {
            privateKey: generatePrivateKey(),
            viewPrivateKey: generatePrivateKey(),
        };
        const registered = publicKeyFromPrivateKey(viewingPrivateKey(wallet));
        expect(publicKeyMatches(registered, viewingPrivateKey(wallet))).toBe(true);
    });

    test("a wallet whose signing key was registered cannot open a separate view key", () => {
        const signing = generatePrivateKey();
        const registeredWithSigningKey = publicKeyFromPrivateKey(signing);
        const wallet = { privateKey: signing, viewPrivateKey: generatePrivateKey() };
        // Exactly the state `key generate` leaves behind before `key register` is re-run.
        expect(publicKeyMatches(registeredWithSigningKey, viewingPrivateKey(wallet))).toBe(false);
    });
});

describe("view-key lifecycle helpers", () => {
    test("generate refuses a second key and rotate requires the current fingerprint", async () => {
        const { generateViewKeyIfAbsent, rotateViewKeyChecked, forgetViewKeyChecked } =
            await import("../../src/services/view-key-lifecycle.ts");
        withHome((home) => {
            importWallet(generatePrivateKey(), home);
            const first = generateViewKeyIfAbsent(home);
            expect(first.registrationRequired).toBe(true);
            expect(first.fingerprint).toHaveLength(16);
            expect(() => generateViewKeyIfAbsent(home)).toThrow(/already exists/);
            expect(() =>
                rotateViewKeyChecked({
                    homeDir: home,
                    expectedCurrentKeyFingerprint: first.fingerprint,
                    confirmAbandonInflightDisclosures: false,
                }),
            ).toThrow(/confirmAbandonInflightDisclosures/);
            const rotated = rotateViewKeyChecked({
                homeDir: home,
                expectedCurrentKeyFingerprint: first.fingerprint,
                confirmAbandonInflightDisclosures: true,
            });
            expect(rotated.fingerprint).not.toBe(first.fingerprint);
            expect(rotated.backupName).toMatch(/^backup-/);
            const forgotten = forgetViewKeyChecked(home);
            expect(forgotten.viewKeyMissing).toBe(true);
            expect(JSON.stringify(forgotten)).not.toContain("privateKey");
        });
    });
});
