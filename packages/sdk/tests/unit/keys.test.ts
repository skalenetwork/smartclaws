import { describe, expect, test } from "bun:test";
import type { Address, Hex } from "viem";
import { SmartClawsError } from "../../src/errors.js";
import {
    decryptDisclosedEnvelope,
    decryptEcies,
    EciesDecryptionError,
    getPublicKey,
    hasPublicKey,
    InvalidDecryptedEnvelopeError,
    InvalidEciesPayloadError,
    isValidSecp256k1PublicKey,
    type PublicKeyRegistryClient,
    publicKeyFromPrivateKey,
    registerPublicKey,
} from "../../src/services/keys.js";

const privateKey = `0x${"11".repeat(32)}` as Hex;
const registry = "0x1111111111111111111111111111111111111111" as Address;
const account = "0x2222222222222222222222222222222222222222" as Address;
const fixture =
    "0x000102030405060708090a0b0c0d0e0f02466d7fcae563e5cb09a0d1870bb580344804617879a14949cf22285f1bae3f270d1ae1d7508b688fe312325133f2ce62" as Hex;
const paddingFixture =
    "0x000102030405060708090a0b0c0d0e0f02466d7fcae563e5cb09a0d1870bb580344804617879a14949cf22285f1bae3f27830c80ed680bb9241c341b5f1741ad64" as Hex;
const invalidEnvelopeFixture =
    "0x000102030405060708090a0b0c0d0e0f02466d7fcae563e5cb09a0d1870bb580344804617879a14949cf22285f1bae3f2703d5bf90be4e1c70307b6682c801090f" as Hex;

describe("public keys", () => {
    test("derives and validates the same on-curve point registered on-chain", () => {
        const publicKey = publicKeyFromPrivateKey(privateKey);
        expect(isValidSecp256k1PublicKey(publicKey)).toBe(true);
        expect(
            isValidSecp256k1PublicKey({ x: `0x${"00".repeat(32)}`, y: `0x${"00".repeat(32)}` }),
        ).toBe(false);
    });

    test("registers, checks, and gets keys through the registry ABI", async () => {
        const publicKey = publicKeyFromPrivateKey(privateKey);
        const calls: Array<Record<string, unknown>> = [];
        const client: PublicKeyRegistryClient = {
            async readContract(parameters) {
                calls.push(parameters);
                return parameters.functionName === "hasPublicKey" ? true : publicKey;
            },
            async writeContract(parameters) {
                calls.push(parameters);
                return `0x${"aa".repeat(32)}`;
            },
        };

        expect(await hasPublicKey(client, registry, account)).toBe(true);
        expect(await getPublicKey(client, registry, account)).toEqual(publicKey);
        await registerPublicKey(client, registry, publicKey);
        expect(calls.map((call) => call.functionName)).toEqual([
            "hasPublicKey",
            "hasPublicKey",
            "getPublicKey",
            "registerPublicKey",
        ]);
    });

    test("reports an unregistered key with NO_PUBLIC_KEY", async () => {
        const client: Pick<PublicKeyRegistryClient, "readContract"> = {
            async readContract() {
                return false;
            },
        };
        try {
            await getPublicKey(client, registry, account);
            throw new Error("expected throw");
        } catch (error) {
            expect(error).toBeInstanceOf(SmartClawsError);
            expect((error as SmartClawsError).code).toBe("NO_PUBLIC_KEY");
        }
    });
});

describe("ECIES disclosure decryption", () => {
    test("decrypts IV + compressed point + ciphertext and passes raw envelope bytes directly", () => {
        const envelope = new Uint8Array([1, 2, 3, 4, 5, 0, 255]);

        expect(decryptEcies(privateKey, fixture)).toEqual(envelope);
        const decoded = decryptDisclosedEnvelope(privateKey, fixture, (plaintext) => {
            expect(plaintext).toEqual(envelope);
            return { decoded: [...plaintext] };
        });
        expect(decoded).toEqual({ decoded: [...envelope] });
    });

    test("rejects every malformed layout component", () => {
        const shortIv = `0x${"00".repeat(15)}` as Hex;
        const shortEphemeral = `0x${"00".repeat(16 + 32)}` as Hex;
        const invalidPrefix = `0x${"00".repeat(16)}04${"00".repeat(32)}${"00".repeat(16)}` as Hex;
        const invalidPoint = `0x${"00".repeat(16)}02${"ff".repeat(32)}${"00".repeat(16)}` as Hex;
        const compressedPoint = fixture.slice(2 + 16 * 2, 2 + (16 + 33) * 2);
        const prefix = `0x${"00".repeat(16)}${compressedPoint}`;
        const emptyCiphertext = prefix as Hex;
        const unalignedCiphertext = `${prefix}00` as Hex;

        for (const malformed of [
            shortIv,
            shortEphemeral,
            invalidPrefix,
            invalidPoint,
            emptyCiphertext,
            unalignedCiphertext,
        ]) {
            expect(() => decryptEcies(privateKey, malformed)).toThrow(InvalidEciesPayloadError);
        }
    });

    test("verifies PKCS#7 padding", () => {
        const bytes = Buffer.from(paddingFixture.slice(2), "hex");
        bytes[15] = (bytes[15] ?? 0) ^ 0xff;
        expect(() => decryptEcies(privateKey, `0x${bytes.toString("hex")}`)).toThrow(
            EciesDecryptionError,
        );
    });

    test("uses a distinct expected error when plaintext is not an envelope", () => {
        expect(() =>
            decryptDisclosedEnvelope(privateKey, invalidEnvelopeFixture, () => {
                throw new Error("decode failed");
            }),
        ).toThrow(InvalidDecryptedEnvelopeError);
    });
});
