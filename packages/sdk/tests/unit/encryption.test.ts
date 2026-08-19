import { describe, expect, test } from "bun:test";
import { type Address, decodeAbiParameters, encodeAbiParameters, type Hex } from "viem";
import {
    ciphertextByteLength,
    type EncryptionProvider,
    encryptForChannel,
    frameEncryptedPublication,
    quotePublishFee,
    submitWithCallbackFee,
} from "../../src/services/encryption.js";

const wallet = "0x1111111111111111111111111111111111111111" as Address;
const device = "0x2222222222222222222222222222222222222222" as Address;
const agent = "0x3333333333333333333333333333333333333333" as Address;
const channel = "0x4444444444444444444444444444444444444444" as Address;

class FakeEncryptionProvider implements EncryptionProvider {
    calls: Array<{ message: Hex; ctxSubmitterAddress: Address }> = [];

    async encryptMessageForCTX(message: Hex, ctxSubmitterAddress: Address): Promise<Hex> {
        this.calls.push({ message, ctxSubmitterAddress });
        return "0xaabbcc";
    }
}

describe("encrypted publication framing", () => {
    test("is exactly abi.encode(signing wallet, envelope bytes)", () => {
        // This envelope deliberately contains device and agent-looking addresses. Neither is
        // the encrypted publisher identity, even on their mediated publication paths.
        const envelope = `0x01${device.slice(2)}${agent.slice(2)}` as Hex;
        const framed = frameEncryptedPublication(wallet, envelope);
        const expected = encodeAbiParameters(
            [{ type: "address" }, { type: "bytes" }],
            [wallet, envelope],
        );

        expect(framed).toBe(expected);
        const [encodedPublisher, encodedEnvelope] = decodeAbiParameters(
            [{ type: "address" }, { type: "bytes" }],
            framed,
        );
        expect(encodedPublisher.toLowerCase()).toBe(wallet);
        expect(encodedPublisher.toLowerCase()).not.toBe(device);
        expect(encodedPublisher.toLowerCase()).not.toBe(agent);
        expect(encodedEnvelope).toBe(envelope);
    });

    test("binds encryptMessageForCTX to the channel address", async () => {
        const provider = new FakeEncryptionProvider();
        const ciphertext = await encryptForChannel(provider, "0x010203", wallet, channel);

        expect(ciphertext).toBe("0xaabbcc");
        expect(provider.calls).toHaveLength(1);
        expect(provider.calls[0]?.ctxSubmitterAddress).toBe(channel);
        expect(provider.calls[0]?.ctxSubmitterAddress).not.toBe(device);
        expect(provider.calls[0]?.ctxSubmitterAddress).not.toBe(agent);
    });
});

describe("callback fees", () => {
    test("measures ciphertext bytes rather than hex characters", async () => {
        const ciphertext = "0x00112233445566778899" as Hex;
        let measured = -1n;
        const quote = await quotePublishFee(
            ciphertext,
            async () => 3n,
            async (ciphertextBytes) => {
                measured = ciphertextBytes;
                return 150_000n + 800n * ciphertextBytes;
            },
        );

        expect(ciphertextByteLength(ciphertext)).toBe(10);
        expect(measured).toBe(10n);
        expect(measured).not.toBe(BigInt(ciphertext.length));
        expect(quote.value).toBe(158_000n * 3n);
    });

    test("fetches gas price once and sends that exact price with its coupled value", async () => {
        const fetchedGasPrice = Object(7n) as unknown as bigint;
        let gasPriceCalls = 0;
        let submitted: { gasPrice: bigint; value: bigint } | undefined;

        const { result, fee } = await submitWithCallbackFee(
            async () => {
                gasPriceCalls += 1;
                return fetchedGasPrice;
            },
            async () => 123n,
            async (parameters) => {
                submitted = parameters;
                return "0xorigin";
            },
        );

        expect(gasPriceCalls).toBe(1);
        expect(submitted?.gasPrice).toBe(fetchedGasPrice);
        expect(submitted?.value).toBe(861n);
        expect(fee.gasPrice).toBe(fetchedGasPrice);
        expect(result).toBe("0xorigin");
    });
});
