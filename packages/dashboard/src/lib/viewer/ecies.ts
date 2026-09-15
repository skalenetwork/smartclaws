import { secp256k1 } from "@noble/curves/secp256k1";
import { type Hex, hexToBytes } from "viem";

/**
 * Opens a payload sealed by `BITE.encryptECIES`, in the layout the SDK's `decryptEcies`
 * reads: IV (16 bytes) ‖ compressed ephemeral public key (33) ‖ AES-256-CBC ciphertext,
 * keyed by SHA-256 of the ECDH shared point's x coordinate.
 *
 * There is no MAC. A wrong key usually fails on padding but can yield garbage, so callers
 * must validate the plaintext.
 */
export async function decryptEcies(privateKey: Uint8Array, payload: Hex): Promise<Uint8Array> {
    const bytes = hexToBytes(payload);
    const iv = bytes.slice(0, 16);
    const ephemeralPublicKey = bytes.slice(16, 49);
    const ciphertext = bytes.slice(49);
    if (ciphertext.length === 0 || ciphertext.length % 16 !== 0) {
        throw new Error("Malformed ECIES payload");
    }

    // The compressed shared point is one prefix byte followed by the 32-byte x coordinate.
    const sharedX = secp256k1.getSharedSecret(privateKey, ephemeralPublicKey, true).slice(1);
    const digest = await crypto.subtle.digest("SHA-256", sharedX);
    const key = await crypto.subtle.importKey("raw", digest, "AES-CBC", false, ["decrypt"]);
    // WebCrypto strips PKCS#7 padding and rejects bad padding, as the SDK does by hand.
    const plaintext = await crypto.subtle.decrypt({ name: "AES-CBC", iv }, key, ciphertext);
    return new Uint8Array(plaintext);
}
