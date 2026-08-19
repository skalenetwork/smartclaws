import { expect } from "chai";
import { ethers as ethersLib } from "ethers";
import { getConnection, loadFixture, ONE_MB } from "./helpers/deploy.js";

const SUBMIT_CTX_ADDRESS = "0x000000000000000000000000000000000000001b";
const ENCRYPT_ECIES_ADDRESS = "0x000000000000000000000000000000000000001c";
const ENCRYPT_TE_ADDRESS = "0x000000000000000000000000000000000000001d";

const PUBLISHER_ROLE = ethersLib.id("PUBLISHER_ROLE");
const MASTER_ROLE = ethersLib.id("MASTER_ROLE");
const SENDER_ROLE = ethersLib.id("SENDER_ROLE");

async function deployEncryptedWrapperFixture() {
    const { ethers, networkHelpers } = await getConnection();
    const [owner, publisher, sender, master] = await ethers.getSigners();

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

    const pkRegistry = await (await ethers.getContractFactory("PublicKeyRegistry")).deploy();
    await pkRegistry.waitForDeployment();

    const registryStub = await (
        await ethers.getContractFactory("MockRegistryWithPublicKeyRegistry")
    ).deploy(await pkRegistry.getAddress());
    await registryStub.waitForDeployment();

    const channelFactory = await (
        await ethers.getContractFactory("EncryptedChannelFactory")
    ).deploy();
    await channelFactory.waitForDeployment();

    const agent = await (
        await ethers.getContractFactory("SmartClawsAgent")
    ).deploy(
        owner.address,
        ONE_MB,
        await registryStub.getAddress(),
        await channelFactory.getAddress(),
        "agent-1",
        "metadata",
    );
    await agent.waitForDeployment();

    const mockGroup = await (await ethers.getContractFactory("MockDeviceGroup")).deploy();
    await mockGroup.waitForDeployment();

    const device = await (
        await ethers.getContractFactory("SmartClawsDevice")
    ).deploy(
        await mockGroup.getAddress(),
        owner.address,
        await registryStub.getAddress(),
        await channelFactory.getAddress(),
        ONE_MB,
        "device-1",
    );
    await device.waitForDeployment();

    const gasPrice = (await ethers.provider.getFeeData()).gasPrice as bigint;

    const encryptFor = async (who: string, text: string) => {
        const envelope = ethersLib.AbiCoder.defaultAbiCoder().encode(
            ["address", "bytes"],
            [who, ethersLib.toUtf8Bytes(text)],
        );
        return bite.encryptTE(envelope);
    };

    return {
        owner,
        publisher,
        sender,
        master,
        bite,
        agent,
        device,
        gasPrice,
        encryptFor,
        ethers,
    };
}

describe("Encrypted Wrapper Scheduling Events", function () {
    it("agent emits scheduled events for encrypted outbound and inbound", async function () {
        const { agent, owner, sender, bite, gasPrice, encryptFor, ethers } = await loadFixture(
            deployEncryptedWrapperFixture,
        );
        await agent.grantRole(SENDER_ROLE, sender.address);

        const outChannelAddr = await agent.getOutgoingMessagesChannel();
        const inChannelAddr = await agent.getIncomingMessagesChannel();
        const outChannel = await ethers.getContractAt("SmartClawsChannelEncrypted", outChannelAddr);
        const inChannel = await ethers.getContractAt("SmartClawsChannelEncrypted", inChannelAddr);

        const outboundPayload = await encryptFor(owner.address, "agent outbound");
        const outboundFee =
            (await outChannel.getPublishCallbackGas(ethersLib.getBytes(outboundPayload).length)) * gasPrice;

        await expect(agent.publishOutbound(outboundPayload, { value: outboundFee, gasPrice }))
            .to.emit(agent, "AgentOutboundScheduled")
            .withArgs(await agent.getAddress(), outChannelAddr, owner.address);
        await expect(bite.sendCallback()).to.emit(outChannel, "MessagePublished");

        const inboundPayload = await encryptFor(sender.address, "agent inbound");
        const inboundFee =
            (await inChannel.getPublishCallbackGas(ethersLib.getBytes(inboundPayload).length)) * gasPrice;

        await expect(
            agent.connect(sender).publishInbound(inboundPayload, { value: inboundFee, gasPrice }),
        )
            .to.emit(agent, "AgentInboundScheduled")
            .withArgs(await agent.getAddress(), inChannelAddr, sender.address);
        await expect(bite.sendCallback()).to.emit(inChannel, "MessagePublished");
    });

    it("device emits scheduled events for encrypted telemetry and command", async function () {
        const { device, owner, publisher, master, bite, gasPrice, encryptFor, ethers } =
            await loadFixture(deployEncryptedWrapperFixture);

        await device.grantRole(PUBLISHER_ROLE, publisher.address);
        await device.grantRole(MASTER_ROLE, master.address);

        const outChannelAddr = await device.getOutgoingMessagesChannel();
        const inChannelAddr = await device.getIncomingMessagesChannel();
        const outChannel = await ethers.getContractAt("SmartClawsChannelEncrypted", outChannelAddr);
        const inChannel = await ethers.getContractAt("SmartClawsChannelEncrypted", inChannelAddr);

        const telemetryPayload = await encryptFor(publisher.address, "device telemetry");
        const telemetryFee =
            (await outChannel.getPublishCallbackGas(ethersLib.getBytes(telemetryPayload).length)) * gasPrice;

        await expect(
            device.connect(publisher).publishTelemetry(telemetryPayload, { value: telemetryFee, gasPrice }),
        )
            .to.emit(device, "DeviceTelemetryScheduled")
            .withArgs(await device.getAddress(), outChannelAddr, publisher.address);
        await expect(bite.sendCallback()).to.emit(outChannel, "MessagePublished");

        const commandPayload = await encryptFor(master.address, "device command");
        const commandFee =
            (await inChannel.getPublishCallbackGas(ethersLib.getBytes(commandPayload).length)) * gasPrice;

        await expect(
            device.connect(master).publishCommand(commandPayload, { value: commandFee, gasPrice }),
        )
            .to.emit(device, "DeviceCommandScheduled")
            .withArgs(await device.getAddress(), inChannelAddr, master.address);
        await expect(bite.sendCallback()).to.emit(inChannel, "MessagePublished");
    });
});
