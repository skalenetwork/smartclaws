import { createDecipheriv, createHash } from "node:crypto";
import PublicKeyRegistryABI from "@smartclaws/core/abi/PublicKeyRegistry.json" with {
    type: "json",
};
import type { WalletFile } from "@smartclaws/core/types";
import type { Address, Hex } from "viem";
import { SmartClawsError } from "../errors.js";

const SECP256K1_FIELD = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const SECP256K1_ORDER = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const GENERATOR = {
    x: 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n,
    y: 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n,
};

interface CurvePoint {
    x: bigint;
    y: bigint;
}

export interface Secp256k1PublicKey {
    x: Hex;
    y: Hex;
}

export interface PublicKeyRegistryClient {
    readContract(parameters: Record<string, unknown>): Promise<unknown>;
    writeContract(parameters: Record<string, unknown>): Promise<Hex>;
}

export class InvalidEciesPayloadError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "InvalidEciesPayloadError";
    }
}

export class EciesDecryptionError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "EciesDecryptionError";
    }
}

export class InvalidDecryptedEnvelopeError extends Error {
    readonly plaintext: Uint8Array;

    constructor(plaintext: Uint8Array) {
        super("ECIES plaintext is not a valid SmartClaws envelope");
        this.name = "InvalidDecryptedEnvelopeError";
        this.plaintext = plaintext;
    }
}

function parseFixedHex(value: string, bytes: number, label: string): Buffer {
    if (!new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`).test(value)) {
        throw new TypeError(`${label} must be exactly ${bytes} bytes`);
    }
    return Buffer.from(value.slice(2), "hex");
}

function coordinate(value: Hex, label: string): bigint {
    const bytes = parseFixedHex(value, 32, label);
    return BigInt(`0x${bytes.toString("hex")}`);
}

export function isValidSecp256k1PublicKey(publicKey: Secp256k1PublicKey): boolean {
    let x: bigint;
    let y: bigint;
    try {
        x = coordinate(publicKey.x, "public key x");
        y = coordinate(publicKey.y, "public key y");
    } catch {
        return false;
    }
    if (x >= SECP256K1_FIELD || y >= SECP256K1_FIELD || (x === 0n && y === 0n)) {
        return false;
    }
    return (y * y) % SECP256K1_FIELD === (x * x * x + 7n) % SECP256K1_FIELD;
}

/**
 * The private key that opens this wallet's disclosures.
 *
 * Registration and decryption must agree on this, so both go through here rather than
 * reaching for `wallet.privateKey` directly. Falling back to the signing key keeps the
 * single-key setup working unchanged.
 */
export function viewingPrivateKey(wallet: Pick<WalletFile, "privateKey" | "viewPrivateKey">): Hex {
    return (wallet.viewPrivateKey ?? wallet.privateKey) as Hex;
}

/** Whether a registered public key is the one `viewingPrivateKey` can actually open. */
export function publicKeyMatches(publicKey: Secp256k1PublicKey, privateKey: Hex): boolean {
    let derived: Secp256k1PublicKey;
    try {
        derived = publicKeyFromPrivateKey(privateKey);
    } catch {
        return false;
    }
    return (
        derived.x.toLowerCase() === publicKey.x.toLowerCase() &&
        derived.y.toLowerCase() === publicKey.y.toLowerCase()
    );
}

export function publicKeyFromPrivateKey(privateKey: Hex): Secp256k1PublicKey {
    const scalar = privateScalar(privateKey);
    const point = multiplyPoint(GENERATOR, scalar);
    if (!point) throw new TypeError("private key is not valid for secp256k1");
    return {
        x: toCoordinateHex(point.x),
        y: toCoordinateHex(point.y),
    };
}

export async function hasPublicKey(
    client: Pick<PublicKeyRegistryClient, "readContract">,
    registryAddress: Address,
    account: Address,
): Promise<boolean> {
    return (await client.readContract({
        address: registryAddress,
        abi: PublicKeyRegistryABI.abi,
        functionName: "hasPublicKey",
        args: [account],
    })) as boolean;
}

export async function getPublicKey(
    client: Pick<PublicKeyRegistryClient, "readContract">,
    registryAddress: Address,
    account: Address,
): Promise<Secp256k1PublicKey> {
    if (!(await hasPublicKey(client, registryAddress, account))) {
        throw new SmartClawsError("NO_PUBLIC_KEY", "Account has no registered public key", {
            account,
        });
    }
    const result = await client.readContract({
        address: registryAddress,
        abi: PublicKeyRegistryABI.abi,
        functionName: "getPublicKey",
        args: [account],
    });
    const value = result as Secp256k1PublicKey | readonly [Hex, Hex];
    const publicKey = Array.isArray(value) ? { x: value[0], y: value[1] } : value;
    if (!isValidSecp256k1PublicKey(publicKey as Secp256k1PublicKey)) {
        throw new TypeError("Registry returned an invalid secp256k1 public key");
    }
    return publicKey as Secp256k1PublicKey;
}

export async function registerPublicKey(
    client: Pick<PublicKeyRegistryClient, "writeContract">,
    registryAddress: Address,
    publicKey: Secp256k1PublicKey,
): Promise<Hex> {
    if (!isValidSecp256k1PublicKey(publicKey)) {
        throw new TypeError("public key must be a valid secp256k1 point");
    }
    return client.writeContract({
        address: registryAddress,
        abi: PublicKeyRegistryABI.abi,
        functionName: "registerPublicKey",
        args: [publicKey],
    });
}

function parseEciesPayload(encryptedPayload: Hex): {
    iv: Buffer;
    ephemeralPublicKey: CurvePoint;
    ciphertext: Buffer;
} {
    if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(encryptedPayload)) {
        throw new InvalidEciesPayloadError("ECIES payload must be byte-aligned hex");
    }
    const encrypted = Buffer.from(encryptedPayload.slice(2), "hex");
    if (encrypted.length < 16) {
        throw new InvalidEciesPayloadError("ECIES IV must be exactly 16 bytes");
    }
    if (encrypted.length < 49) {
        throw new InvalidEciesPayloadError("ECIES ephemeral public key must be exactly 33 bytes");
    }

    const iv = encrypted.subarray(0, 16);
    const compressedPublicKey = encrypted.subarray(16, 49);
    const ciphertext = encrypted.subarray(49);
    if (compressedPublicKey.length !== 33 || ![2, 3].includes(compressedPublicKey[0] ?? -1)) {
        throw new InvalidEciesPayloadError(
            "ECIES ephemeral public key must be a 33-byte compressed point",
        );
    }
    let ephemeralPublicKey: CurvePoint;
    try {
        ephemeralPublicKey = decompressPoint(compressedPublicKey);
    } catch {
        throw new InvalidEciesPayloadError("ECIES ephemeral public key is not on secp256k1");
    }
    if (ciphertext.length === 0) {
        throw new InvalidEciesPayloadError("ECIES ciphertext must not be empty");
    }
    if (ciphertext.length % 16 !== 0) {
        throw new InvalidEciesPayloadError("ECIES ciphertext must be block-aligned");
    }
    return { iv, ephemeralPublicKey, ciphertext };
}

function modulo(value: bigint): bigint {
    const result = value % SECP256K1_FIELD;
    return result >= 0n ? result : result + SECP256K1_FIELD;
}

function modPow(base: bigint, exponent: bigint): bigint {
    let result = 1n;
    let factor = modulo(base);
    let power = exponent;
    while (power > 0n) {
        if (power & 1n) result = modulo(result * factor);
        factor = modulo(factor * factor);
        power >>= 1n;
    }
    return result;
}

function addPoints(left: CurvePoint | null, right: CurvePoint | null): CurvePoint | null {
    if (!left) return right;
    if (!right) return left;
    if (left.x === right.x && left.y !== right.y) return null;
    if (left.y === 0n && left.x === right.x) return null;

    const slope =
        left.x === right.x
            ? modulo(3n * left.x * left.x * modPow(2n * left.y, SECP256K1_FIELD - 2n))
            : modulo((right.y - left.y) * modPow(right.x - left.x, SECP256K1_FIELD - 2n));
    const x = modulo(slope * slope - left.x - right.x);
    return { x, y: modulo(slope * (left.x - x) - left.y) };
}

function multiplyPoint(point: CurvePoint, scalar: bigint): CurvePoint | null {
    let result: CurvePoint | null = null;
    let addend: CurvePoint | null = point;
    let remaining = scalar;
    while (remaining > 0n) {
        if (remaining & 1n) result = addPoints(result, addend);
        addend = addPoints(addend, addend);
        remaining >>= 1n;
    }
    return result;
}

function decompressPoint(compressed: Buffer): CurvePoint {
    const x = BigInt(`0x${compressed.subarray(1).toString("hex")}`);
    if (x >= SECP256K1_FIELD) throw new TypeError("point x coordinate is outside the field");
    const ySquared = modulo(x * x * x + 7n);
    let y = modPow(ySquared, (SECP256K1_FIELD + 1n) / 4n);
    if (modulo(y * y) !== ySquared) throw new TypeError("point is not on secp256k1");
    const odd = compressed[0] === 3;
    if ((y & 1n) === (odd ? 0n : 1n)) y = SECP256K1_FIELD - y;
    return { x, y };
}

function privateScalar(privateKey: Hex): bigint {
    const scalar = BigInt(`0x${parseFixedHex(privateKey, 32, "private key").toString("hex")}`);
    if (scalar === 0n || scalar >= SECP256K1_ORDER) {
        throw new TypeError("private key is not valid for secp256k1");
    }
    return scalar;
}

function toCoordinateHex(value: bigint): Hex {
    return `0x${value.toString(16).padStart(64, "0")}`;
}

/** Short public identifier for a secp256k1 key. Never derived from the private scalar. */
export function publicKeyFingerprint(publicKey: Secp256k1PublicKey): string {
    return createHash("sha256")
        .update(`${publicKey.x.toLowerCase()}:${publicKey.y.toLowerCase()}`)
        .digest("hex")
        .slice(0, 16);
}

function stripPkcs7(bytes: Buffer): Uint8Array {
    const padding = bytes.at(-1) ?? 0;
    if (padding < 1 || padding > 16 || padding > bytes.length) {
        throw new EciesDecryptionError("ECIES plaintext has invalid PKCS#7 padding");
    }
    for (let index = bytes.length - padding; index < bytes.length; index += 1) {
        if (bytes[index] !== padding) {
            throw new EciesDecryptionError("ECIES plaintext has invalid PKCS#7 padding");
        }
    }
    return bytes.subarray(0, bytes.length - padding);
}

export function decryptEcies(privateKey: Hex, encryptedPayload: Hex): Uint8Array {
    const scalar = privateScalar(privateKey);
    const { iv, ephemeralPublicKey, ciphertext } = parseEciesPayload(encryptedPayload);
    const sharedPoint = multiplyPoint(ephemeralPublicKey, scalar);
    if (!sharedPoint) throw new EciesDecryptionError("ECIES shared secret is invalid");
    const sharedSecret = Buffer.from(sharedPoint.x.toString(16).padStart(64, "0"), "hex");
    const key = createHash("sha256").update(sharedSecret).digest();
    const decipher = createDecipheriv("aes-256-cbc", key, iv);
    decipher.setAutoPadding(false);
    const padded = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return stripPkcs7(padded);
}

export function decryptDisclosedEnvelope<T>(
    privateKey: Hex,
    encryptedPayload: Hex,
    decodeEnvelope: (plaintext: Uint8Array) => T,
): T {
    // The contract already removes abi.encode(bytes); the decrypted bytes go straight to
    // the envelope decoder. Decode failure is expected for unauthenticated/tampered ECIES.
    const plaintext = decryptEcies(privateKey, encryptedPayload);
    try {
        return decodeEnvelope(plaintext);
    } catch {
        throw new InvalidDecryptedEnvelopeError(plaintext);
    }
}
