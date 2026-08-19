import { BITE } from "@skalenetwork/bite";
import { type Address, encodeAbiParameters, type Hex, isAddress, toHex } from "viem";

export interface EncryptionProvider {
    encryptMessageForCTX(message: Hex, ctxSubmitterAddress: Address): Promise<string>;
}

export class BiteEncryptionProvider implements EncryptionProvider {
    private readonly client: BITE;

    constructor(rpcUrl: string) {
        this.client = new BITE(rpcUrl);
    }

    encryptMessageForCTX(message: Hex, ctxSubmitterAddress: Address): Promise<string> {
        return this.client.encryptMessageForCTX(message, ctxSubmitterAddress);
    }
}

function requireHexBytes(value: string, label: string): asserts value is Hex {
    if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) {
        throw new TypeError(`${label} must be a 0x-prefixed, byte-aligned hex string`);
    }
}

export function ciphertextByteLength(ciphertext: string): number {
    requireHexBytes(ciphertext, "ciphertext");
    return (ciphertext.length - 2) / 2;
}

export function frameEncryptedPublication(
    publisherWallet: Address,
    envelope: Hex | Uint8Array,
): Hex {
    if (!isAddress(publisherWallet)) throw new TypeError("publisherWallet must be an address");
    const envelopeHex = envelope instanceof Uint8Array ? toHex(envelope) : envelope;
    requireHexBytes(envelopeHex, "envelope");

    // The wallet is the encrypted identity checked by the callback. A mediated device or
    // agent remains the separately authorized publisher and must never replace it here.
    return encodeAbiParameters(
        [{ type: "address" }, { type: "bytes" }],
        [publisherWallet, envelopeHex],
    );
}

export async function encryptForChannel(
    provider: EncryptionProvider,
    envelope: Hex | Uint8Array,
    publisherWallet: Address,
    channelAddress: Address,
): Promise<Hex> {
    if (!isAddress(channelAddress)) throw new TypeError("channelAddress must be an address");
    const framed = frameEncryptedPublication(publisherWallet, envelope);

    // aadTE must name the contract that calls submitCTX. On mediated publishes that is still
    // the channel, even though the outer transaction is sent to a device or agent contract.
    const ciphertext = await provider.encryptMessageForCTX(framed, channelAddress);
    requireHexBytes(ciphertext, "ciphertext");
    return ciphertext;
}

export interface CallbackFeeQuote {
    callbackGas: bigint;
    gasPrice: bigint;
    value: bigint;
}

export function computeCallbackFee(callbackGas: bigint, gasPrice: bigint): bigint {
    if (callbackGas < 0n || gasPrice < 0n) {
        throw new RangeError("callback gas and gas price must not be negative");
    }
    return callbackGas * gasPrice;
}

export async function quotePublishFee(
    ciphertext: Hex,
    getGasPrice: () => Promise<bigint>,
    getPublishCallbackGas: (ciphertextBytes: bigint) => Promise<bigint>,
): Promise<CallbackFeeQuote> {
    const gasPrice = await getGasPrice();
    const callbackGas = await getPublishCallbackGas(BigInt(ciphertextByteLength(ciphertext)));
    return { callbackGas, gasPrice, value: computeCallbackFee(callbackGas, gasPrice) };
}

export async function quoteReadFee(
    ciphertexts: readonly Hex[],
    getGasPrice: () => Promise<bigint>,
    getReadCallbackGas: (totalCiphertextBytes: bigint, count: bigint) => Promise<bigint>,
): Promise<CallbackFeeQuote> {
    const gasPrice = await getGasPrice();
    const totalBytes = ciphertexts.reduce(
        (sum, ciphertext) => sum + BigInt(ciphertextByteLength(ciphertext)),
        0n,
    );
    const callbackGas = await getReadCallbackGas(totalBytes, BigInt(ciphertexts.length));
    return { callbackGas, gasPrice, value: computeCallbackFee(callbackGas, gasPrice) };
}

export async function submitWithCallbackFee<T>(
    getGasPrice: () => Promise<bigint>,
    getCallbackGas: () => Promise<bigint>,
    submit: (fee: { gasPrice: bigint; value: bigint }) => Promise<T>,
): Promise<{ result: T; fee: CallbackFeeQuote }> {
    // A second estimation at send time can differ from the value calculation and underfund
    // the callback, so the one fetched price is passed explicitly into the outer contract tx.
    const gasPrice = await getGasPrice();
    const callbackGas = await getCallbackGas();
    const value = computeCallbackFee(callbackGas, gasPrice);
    const result = await submit({ gasPrice, value });
    return { result, fee: { callbackGas, gasPrice, value } };
}
