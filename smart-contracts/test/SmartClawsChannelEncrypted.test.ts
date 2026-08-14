import { expect } from "chai";
import { ethers as ethersLib } from "ethers";
import { getConnection, loadFixture, ONE_MB } from "./helpers/deploy.js";

const SUBMIT_CTX_ADDRESS = "0x000000000000000000000000000000000000001b";
const ENCRYPT_ECIES_ADDRESS = "0x000000000000000000000000000000000000001c";
const ENCRYPT_TE_ADDRESS = "0x000000000000000000000000000000000000001d";

const SECP256K1_GENERATOR = {
    x: "0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
    y: "0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8",
};

async function deployEncryptedChannelFixture() {
    return deployEncryptedChannelFixtureWithCapacity(ONE_MB);
}

async function deployEncryptedChannelFixtureWithCapacity(capacity: number | bigint) {
    const { ethers, networkHelpers } = await getConnection();
    const [owner, publisher, reader, other] = await ethers.getSigners();

    const bite = await (await ethers.getContractFactory("TestBiteMock")).deploy();
    await bite.waitForDeployment();

    const installPrecompile = async (name: string, address: string) => {
        const shim = await (await ethers.getContractFactory(name)).deploy(await bite.getAddress());
        await shim.waitForDeployment();
        const code = await ethers.provider.getCode(await shim.getAddress());
        await networkHelpers.setCode(address, code);
    };

    await installPrecompile("TestSubmitCTXMock", SUBMIT_CTX_ADDRESS);
    await installPrecompile("TestEncryptECIESMock", ENCRYPT_ECIES_ADDRESS);
    await installPrecompile("TestEncryptTEMock", ENCRYPT_TE_ADDRESS);

    const publicKeyRegistry = await (
        await ethers.getContractFactory("PublicKeyRegistry")
    ).deploy();
    await publicKeyRegistry.waitForDeployment();

    const channel = await (
        await ethers.getContractFactory("SmartClawsChannelEncrypted")
    ).deploy(owner.address, capacity, owner.address, await publicKeyRegistry.getAddress());
    await channel.waitForDeployment();

    const gasPrice = (await ethers.provider.getFeeData()).gasPrice as bigint;

    const encrypt = async (
        payload: Uint8Array | string,
        publisherAddress = owner.address,
    ): Promise<string> => {
        const bytes = typeof payload === "string" ? ethersLib.toUtf8Bytes(payload) : payload;
        const envelope = ethersLib.AbiCoder.defaultAbiCoder().encode(
            ["address", "bytes"],
            [publisherAddress, bytes],
        );
        return bite.encryptTE(envelope);
    };

    const publish = async (signer: any, payload: string, refundRecipient?: string) => {
        const callbackGas = await channel.getPublishCallbackGas(ethersLib.getBytes(payload).length);
        const value = callbackGas * gasPrice;
        if (refundRecipient !== undefined) {
            return channel
                .connect(signer)
                .publishMessageFor(payload, refundRecipient, { value, gasPrice });
        }
        return channel.connect(signer).publishMessage(payload, { value, gasPrice });
    };

    return {
        ethers,
        networkHelpers,
        owner,
        publisher,
        reader,
        other,
        bite,
        publicKeyRegistry,
        channel,
        gasPrice,
        encrypt,
        publish,
    };
}

async function deployEncryptedTightCapacityFixture() {
    // Tight capacity chosen to be above canonical stored ciphertext size for
    // short messages, but below submitted envelope ciphertext size.
    return deployEncryptedChannelFixtureWithCapacity(400);
}

describe("SmartClawsChannelEncrypted", function () {
    it("quotes callback gas from fixed and size-dependent components", async function () {
        const { channel } = await loadFixture(deployEncryptedChannelFixture);

        expect(await channel.getPublishCallbackGas(400)).to.equal(150_000n + 400n * 800n);
        expect(await channel.getReadCallbackGas(800, 2)).to.equal(
            150_000n + 800n * 100n + 2n * 30_000n,
        );
    });

    it("rejects a publish that does not fund its size-derived callback gas", async function () {
        const { channel, owner, gasPrice, encrypt } = await loadFixture(
            deployEncryptedChannelFixture,
        );
        const encryptedPayload = await encrypt("short");
        const callbackGas = await channel.getPublishCallbackGas(
            ethersLib.getBytes(encryptedPayload).length,
        );
        const requiredFee = callbackGas * gasPrice;

        await expect(
            channel.connect(owner).publishMessage(encryptedPayload, {
                value: requiredFee - 1n,
                gasPrice,
            }),
        )
            .to.be.revertedWithCustomError(channel, "InsufficientCallbackFee")
            .withArgs(requiredFee, requiredFee - 1n);
    });

    it("accepts payloads whose submitted envelope is larger than capacity but canonical stored ciphertext fits", async function () {
        const { channel, owner, bite, encrypt, publish } = await loadFixture(
            deployEncryptedTightCapacityFixture,
        );
        const encryptedPayload = await encrypt("x");
        const submittedSize = BigInt(ethersLib.getBytes(encryptedPayload).length);
        const capacity = (await channel.maxCapacityBytes()) as bigint;

        expect(submittedSize > capacity).to.equal(true);
        expect(submittedSize - 32n <= capacity).to.equal(true);

        await publish(owner, encryptedPayload);
        await bite.sendCallback();
        expect(await channel.getMessageCount()).to.equal(1);
    });

    it("publishes only after the authenticated callback succeeds", async function () {
        const { channel, owner, bite, encrypt, publish } = await loadFixture(
            deployEncryptedChannelFixture,
        );
        const plaintext = ethersLib.toUtf8Bytes("short encrypted telemetry");
        const encryptedPayload = await encrypt(plaintext);

        await publish(owner, encryptedPayload);
        expect(await channel.getMessageCount()).to.equal(0);

        await expect(bite.sendCallback()).to.emit(channel, "MessagePublished");
        expect(await channel.getMessageCount()).to.equal(1);
        const storedEnvelope = await bite.decryptTE(await channel.readMessage(0));
        const [storedPayload] = ethersLib.AbiCoder.defaultAbiCoder().decode(
            ["bytes"],
            storedEnvelope,
        );
        expect(storedPayload).to.equal(ethersLib.hexlify(plaintext));
    });

    it("queues a refund recipient only when the callback succeeds", async function () {
        const { channel, publisher, bite, encrypt, publish } = await loadFixture(
            deployEncryptedChannelFixture,
        );
        await channel.addPublisher(publisher.address);
        const encryptedPayload = await encrypt("revoked before callback", publisher.address);
        await publish(publisher, encryptedPayload);
        await channel.removePublisher(publisher.address);

        await expect(bite.sendCallback()).to.be.revertedWithCustomError(
            channel,
            "Unauthorized",
        );
        expect(await channel.hasToRefund()).to.equal(false);
        expect(await channel.getMessageCount()).to.equal(0);
    });

    it("rejects ciphertext bound to a different publisher", async function () {
        const { channel, owner, publisher, bite, encrypt, publish } = await loadFixture(
            deployEncryptedChannelFixture,
        );
        const encryptedPayload = await encrypt("replayed payload", owner.address);
        await channel.addPublisher(publisher.address);
        await publish(publisher, encryptedPayload);

        await expect(bite.sendCallback())
            .to.be.revertedWithCustomError(channel, "EncryptedPublisherMismatch")
            .withArgs(publisher.address, owner.address);
        expect(await channel.getMessageCount()).to.equal(0);
    });

    it("pays existing refund residue to the first successful callback recipient", async function () {
        const { channel, owner, other, bite, networkHelpers, encrypt, publish } =
            await loadFixture(deployEncryptedChannelFixture);
        const encryptedPayload = await encrypt("successful after residue");
        await publish(owner, encryptedPayload);

        const residue = 12_345n;
        await networkHelpers.setBalance(await channel.getAddress(), residue);
        const balanceBefore = await channel.runner.provider.getBalance(owner.address);
        await bite.connect(other).sendCallback();

        expect(await channel.runner.provider.getBalance(owner.address)).to.equal(
            balanceBefore + residue,
        );
        expect(await channel.hasToRefund()).to.equal(false);
    });

    it("keeps publishMessageFor owner-only and sends its refund to the named wallet", async function () {
        const { channel, owner, publisher, bite, networkHelpers, encrypt, publish } =
            await loadFixture(deployEncryptedChannelFixture);
        await channel.addPublisher(publisher.address);
        const encryptedPayload = await encrypt("mediated publish", publisher.address);

        await expect(
            publish(publisher, encryptedPayload, publisher.address),
        ).to.be.revertedWithCustomError(channel, "OwnableUnauthorizedAccount");

        await publish(owner, encryptedPayload, publisher.address);
        const residue = 4_321n;
        await networkHelpers.setBalance(await channel.getAddress(), residue);
        const balanceBefore = await channel.runner.provider.getBalance(publisher.address);
        await bite.sendCallback();
        expect(await channel.runner.provider.getBalance(publisher.address)).to.equal(
            balanceBefore + residue,
        );
    });

    it("discloses a requested message only through ECIES to a registered reader", async function () {
        const {
            channel,
            owner,
            reader,
            bite,
            publicKeyRegistry,
            gasPrice,
            encrypt,
            publish,
        } = await loadFixture(deployEncryptedChannelFixture);
        const plaintext = ethersLib.toUtf8Bytes("reader secret");
        await publish(owner, await encrypt(plaintext));
        await bite.sendCallback();

        await channel.addReader(reader.address);
        await publicKeyRegistry.connect(reader).registerPublicKey(SECP256K1_GENERATOR);
        const encryptedStoredPayload = await channel.readMessage(0);
        const callbackGas = await channel.getReadCallbackGas(
            ethersLib.getBytes(encryptedStoredPayload).length,
            1,
        );

        await channel.connect(reader).requestMessages(0, 1, {
            value: callbackGas * gasPrice,
            gasPrice,
        });
        const receipt = await (await bite.sendCallback()).wait();
        const disclosure = receipt.logs
            .map((log: any) => {
                try {
                    return channel.interface.parseLog(log);
                } catch {
                    return null;
                }
            })
            .find((log: any) => log?.name === "MessageDisclosed");

        expect(disclosure?.args.reader).to.equal(reader.address);
        const key = await bite.pubKeyToUint256(
            SECP256K1_GENERATOR.x,
            SECP256K1_GENERATOR.y,
        );
        expect(await bite.decryptECIES(disclosure?.args.encryptedPayload, key)).to.equal(
            ethersLib.hexlify(plaintext),
        );
    });
});
