import hre from "hardhat";
import { verifyAllContracts, type VerificationTarget } from "./verification-utils.js";

async function main() {
    const { ethers } = await hre.network.create();
    const [deployer] = await ethers.getSigners();
    console.log("Deploying with account:", deployer.address);

    const verificationCapacity = 1024 * 1024;
    const verificationAgentId = "verification-agent";
    const verificationAgentMetadata = "Deployment-time verification sample";
    const verificationGroupName = "verification-device-group";
    const verificationGroupSkills = "Deployment-time verification sample";
    const verificationDeviceId = "verification-device";
    const verificationEncryptedAgentId = "verification-encrypted-agent";
    const verificationEncryptedDeviceId = "verification-encrypted-device";

    // --- Deploy factories ---
    // SmartClaws delegates all contract creation to these factories, so they must
    // be deployed first and their addresses passed into the registry constructor.
    const deployFactory = async (name: string): Promise<string> => {
        const factory = await ethers.getContractFactory(name);
        const instance = await factory.deploy();
        await instance.waitForDeployment();
        const address = await instance.getAddress();
        console.log(`${name} deployed to:`, address);
        return address;
    };

    const channelFactory = await deployFactory("ChannelFactory");
    const encryptedChannelFactory = await deployFactory("EncryptedChannelFactory");
    const deviceFactory = await deployFactory("DeviceFactory");
    const deviceGroupFactory = await deployFactory("DeviceGroupFactory");
    const agentFactory = await deployFactory("AgentFactory");
    const publicKeyRegistryFactory = await deployFactory("PublicKeyRegistryFactory");
    const publicKeyRegistryAddress = await deployFactory("PublicKeyRegistry");

    // --- Deploy registry ---
    const SmartClaws = await ethers.getContractFactory("SmartClaws");
    const registry = await SmartClaws.deploy(
        channelFactory,
        encryptedChannelFactory,
        deviceFactory,
        deviceGroupFactory,
        agentFactory,
        publicKeyRegistryFactory,
        publicKeyRegistryAddress,
    );
    await registry.waitForDeployment();
    const registryAddress = await registry.getAddress();
    console.log("SmartClaws registry deployed to:", registryAddress);

    const getEventAddress = (
        receipt: { logs: readonly any[] } | null,
        contract: { interface: { parseLog(log: any): any } },
        eventName: string,
        argumentName: string,
    ): string => {
        if (!receipt) throw new Error(`Transaction receipt missing for ${eventName}`);

        for (const log of receipt.logs) {
            try {
                const parsed = contract.interface.parseLog({
                    topics: log.topics as string[],
                    data: log.data,
                });
                if (parsed?.name === eventName) return parsed.args[argumentName] as string;
            } catch {
                // Ignore logs emitted by other contracts in the same transaction.
            }
        }

        throw new Error(`${eventName} event was not found`);
    };

    // Deploy representative instances for each factory-created contract type.
    // Besides making the complete deployment inspectable, this seeds Blockscout's
    // bytecode database with verified Agent and Device implementations.
    const channelTx = await registry.createChannel(deployer.address, verificationCapacity);
    const channelAddress = getEventAddress(
        await channelTx.wait(),
        registry,
        "ChannelCreated",
        "channel",
    );
    console.log("Channel deployed to:", channelAddress);

    const agentTx = await registry.registerAgent(
        verificationAgentId,
        verificationAgentMetadata,
        verificationCapacity,
    );
    const agentAddress = getEventAddress(
        await agentTx.wait(),
        registry,
        "AgentRegistered",
        "agent",
    );
    const agent = await ethers.getContractAt("SmartClawsAgent", agentAddress);
    const agentIncomingChannelAddress = await agent.getIncomingMessagesChannel();
    const agentOutgoingChannelAddress = await agent.getOutgoingMessagesChannel();
    console.log("Verification Agent deployed to:", agentAddress);
    console.log("Agent incoming channel deployed to:", agentIncomingChannelAddress);
    console.log("Agent outgoing channel deployed to:", agentOutgoingChannelAddress);

    const groupTx = await registry.registerDeviceGroup(
        verificationGroupName,
        verificationGroupSkills,
    );
    const groupAddress = getEventAddress(
        await groupTx.wait(),
        registry,
        "DeviceGroupRegistered",
        "deviceGroup",
    );
    const group = await ethers.getContractAt("SmartClawsDeviceGroup", groupAddress);
    console.log("Verification DeviceGroup deployed to:", groupAddress);

    const deviceTx = await group.registerDevice(
        verificationDeviceId,
        deployer.address,
        verificationCapacity,
    );
    const deviceAddress = getEventAddress(
        await deviceTx.wait(),
        group,
        "DeviceRegistered",
        "device",
    );
    const device = await ethers.getContractAt("SmartClawsDevice", deviceAddress);
    const deviceIncomingChannelAddress = await device.getIncomingMessagesChannel();
    const deviceOutgoingChannelAddress = await device.getOutgoingMessagesChannel();
    console.log("Verification Device deployed to:", deviceAddress);
    console.log("Device incoming channel deployed to:", deviceIncomingChannelAddress);
    console.log("Device outgoing channel deployed to:", deviceOutgoingChannelAddress);


    const encryptedChannelTx = await registry.createEncryptedChannel(
        deployer.address,
        verificationCapacity,
    );
    const encryptedChannelAddress = getEventAddress(
        await encryptedChannelTx.wait(),
        registry,
        "ChannelCreated",
        "channel",
    );
    console.log("Encrypted channel deployed to:", encryptedChannelAddress);

    // Registering an encrypted entity deploys two SmartClawsChannelEncrypted instances. Hardhat's
    // in-memory runtime enforces a 2^24 (16,777,216) per-transaction gas cap, and the *multiplied*
    // automatic estimate for these registrations lands above it, so a local dry-run is rejected
    // before the transaction is ever sent. That cap is not the block gas limit (which reports
    // 60M here) and cannot be read from a block; explicit estimation does not avoid it either,
    // because the estimation request is itself filled in with the multiplied value.
    //
    // Scope the workaround to the dev chain. SKALE's cap is ~230M, far above the estimate, so
    // real deployments must keep normal estimation — pinning a constant there could under-provision
    // the transaction and run it out of gas.
    const { chainId } = await ethers.provider.getNetwork();
    const encryptedDeployOverrides = chainId === 31337n ? { gasLimit: 16_000_000 } : {};
    console.log(
        `Chain ${chainId}:`,
        "gasLimit" in encryptedDeployOverrides
            ? "capping encrypted registrations for the local runtime"
            : "using gas estimation for encrypted registrations",
    );

    const encryptedAgentTx = await registry.registerEncryptedAgent(
        verificationEncryptedAgentId,
        verificationAgentMetadata,
        verificationCapacity,
        encryptedDeployOverrides,
    );
    const encryptedAgentAddress = getEventAddress(
        await encryptedAgentTx.wait(),
        registry,
        "AgentRegistered",
        "agent",
    );
    const encryptedAgent = await ethers.getContractAt("SmartClawsAgent", encryptedAgentAddress);
    const encryptedAgentIncomingChannelAddress =
        await encryptedAgent.getIncomingMessagesChannel();
    const encryptedAgentOutgoingChannelAddress =
        await encryptedAgent.getOutgoingMessagesChannel();
    console.log("Verification encrypted Agent deployed to:", encryptedAgentAddress);
    console.log(
        "Encrypted agent incoming channel deployed to:",
        encryptedAgentIncomingChannelAddress,
    );
    console.log(
        "Encrypted agent outgoing channel deployed to:",
        encryptedAgentOutgoingChannelAddress,
    );

    // Registered into the same group as the plain device: a group holds both factories, so
    // this also proves mixed groups deploy and enumerate correctly.
    const encryptedDeviceTx = await group.registerEncryptedDevice(
        verificationEncryptedDeviceId,
        deployer.address,
        verificationCapacity,
        encryptedDeployOverrides,
    );
    const encryptedDeviceAddress = getEventAddress(
        await encryptedDeviceTx.wait(),
        group,
        "DeviceRegistered",
        "device",
    );
    const encryptedDevice = await ethers.getContractAt(
        "SmartClawsDevice",
        encryptedDeviceAddress,
    );
    const encryptedDeviceIncomingChannelAddress =
        await encryptedDevice.getIncomingMessagesChannel();
    const encryptedDeviceOutgoingChannelAddress =
        await encryptedDevice.getOutgoingMessagesChannel();
    console.log("Verification encrypted Device deployed to:", encryptedDeviceAddress);
    console.log(
        "Encrypted device incoming channel deployed to:",
        encryptedDeviceIncomingChannelAddress,
    );
    console.log(
        "Encrypted device outgoing channel deployed to:",
        encryptedDeviceOutgoingChannelAddress,
    );

    // Verify every contract deployed by this script, including contracts created
    // internally by a factory call.

    const channelContract = "contracts/SmartClawsChannel.sol:SmartClawsChannel";
    const channelConstructorArgs = [deployer.address, verificationCapacity, registryAddress];
    const ownedChannelConstructorArgs = (owner: string) => [
        owner,
        verificationCapacity,
        registryAddress,
    ];

    // Encrypted channels take the PublicKeyRegistry as a fourth constructor argument, so
    // they cannot reuse the plain channel's args or contract path.
    const encryptedChannelContract =
        "contracts/SmartClawsChannelEncrypted.sol:SmartClawsChannelEncrypted";
    const ownedEncryptedChannelConstructorArgs = (owner: string) => [
        owner,
        verificationCapacity,
        registryAddress,
        publicKeyRegistryAddress,
    ];

    const verificationTargets: VerificationTarget[] = [
        {
            label: "ChannelFactory",
            address: channelFactory,
            constructorArgs: [],
            contract: "contracts/factories/ChannelFactory.sol:ChannelFactory",
        },
        {
            label: "EncryptedChannelFactory",
            address: encryptedChannelFactory,
            constructorArgs: [],
            contract: "contracts/factories/EncryptedChannelFactory.sol:EncryptedChannelFactory",
        },
        {
            label: "DeviceFactory",
            address: deviceFactory,
            constructorArgs: [],
            contract: "contracts/factories/DeviceFactory.sol:DeviceFactory",
        },
        {
            label: "DeviceGroupFactory",
            address: deviceGroupFactory,
            constructorArgs: [],
            contract: "contracts/factories/DeviceGroupFactory.sol:DeviceGroupFactory",
        },
        {
            label: "AgentFactory",
            address: agentFactory,
            constructorArgs: [],
            contract: "contracts/factories/AgentFactory.sol:AgentFactory",
        },
        {
            label: "PublicKeyRegistryFactory",
            address: publicKeyRegistryFactory,
            constructorArgs: [],
            contract:
                "contracts/factories/PublicKeyRegistryFactory.sol:PublicKeyRegistryFactory",
        },
        {
            label: "SmartClaws",
            address: registryAddress,
            constructorArgs: [
                channelFactory,
                encryptedChannelFactory,
                deviceFactory,
                deviceGroupFactory,
                agentFactory,
                publicKeyRegistryFactory,
                publicKeyRegistryAddress,
            ],
            contract: "contracts/SmartClaws.sol:SmartClaws",
        },
        {
            label: "PublicKeyRegistry",
            address: publicKeyRegistryAddress,
            constructorArgs: [],
            contract: "contracts/PublicKeyRegistry.sol:PublicKeyRegistry",
        },
        {
            label: "Channel",
            address: channelAddress,
            constructorArgs: channelConstructorArgs,
            contract: channelContract,
        },
        {
            label: "SmartClawsAgent",
            address: agentAddress,
            constructorArgs: [
                deployer.address,
                verificationCapacity,
                registryAddress,
                channelFactory,
                verificationAgentId,
                verificationAgentMetadata,
            ],
            contract: "contracts/SmartClawsAgent.sol:SmartClawsAgent",
        },
        {
            label: "Agent incoming channel",
            address: agentIncomingChannelAddress,
            constructorArgs: ownedChannelConstructorArgs(agentAddress),
            contract: channelContract,
        },
        {
            label: "Agent outgoing channel",
            address: agentOutgoingChannelAddress,
            constructorArgs: ownedChannelConstructorArgs(agentAddress),
            contract: channelContract,
        },
        {
            label: "SmartClawsDeviceGroup",
            address: groupAddress,
            constructorArgs: [
                deployer.address,
                verificationGroupName,
                verificationGroupSkills,
                registryAddress,
                channelFactory,
                encryptedChannelFactory,
                deviceFactory,
            ],
            contract: "contracts/SmartClawsDeviceGroup.sol:SmartClawsDeviceGroup",
        },
        {
            label: "SmartClawsDevice",
            address: deviceAddress,
            constructorArgs: [
                groupAddress,
                deployer.address,
                registryAddress,
                channelFactory,
                verificationCapacity,
                verificationDeviceId,
            ],
            contract: "contracts/SmartClawsDevice.sol:SmartClawsDevice",
        },
        {
            label: "Device incoming channel",
            address: deviceIncomingChannelAddress,
            constructorArgs: ownedChannelConstructorArgs(deviceAddress),
            contract: channelContract,
        },
        {
            label: "Device outgoing channel",
            address: deviceOutgoingChannelAddress,
            constructorArgs: ownedChannelConstructorArgs(deviceAddress),
            contract: channelContract,
        },
        {
            label: "Encrypted channel",
            address: encryptedChannelAddress,
            constructorArgs: ownedEncryptedChannelConstructorArgs(deployer.address),
            contract: encryptedChannelContract,
        },
        {
            label: "SmartClawsAgent (encrypted)",
            address: encryptedAgentAddress,
            constructorArgs: [
                deployer.address,
                verificationCapacity,
                registryAddress,
                encryptedChannelFactory,
                verificationEncryptedAgentId,
                verificationAgentMetadata,
            ],
            contract: "contracts/SmartClawsAgent.sol:SmartClawsAgent",
        },
        {
            label: "Encrypted agent incoming channel",
            address: encryptedAgentIncomingChannelAddress,
            constructorArgs: ownedEncryptedChannelConstructorArgs(encryptedAgentAddress),
            contract: encryptedChannelContract,
        },
        {
            label: "Encrypted agent outgoing channel",
            address: encryptedAgentOutgoingChannelAddress,
            constructorArgs: ownedEncryptedChannelConstructorArgs(encryptedAgentAddress),
            contract: encryptedChannelContract,
        },
        {
            label: "SmartClawsDevice (encrypted)",
            address: encryptedDeviceAddress,
            constructorArgs: [
                groupAddress,
                deployer.address,
                registryAddress,
                encryptedChannelFactory,
                verificationCapacity,
                verificationEncryptedDeviceId,
            ],
            contract: "contracts/SmartClawsDevice.sol:SmartClawsDevice",
        },
        {
            label: "Encrypted device incoming channel",
            address: encryptedDeviceIncomingChannelAddress,
            constructorArgs: ownedEncryptedChannelConstructorArgs(encryptedDeviceAddress),
            contract: encryptedChannelContract,
        },
        {
            label: "Encrypted device outgoing channel",
            address: encryptedDeviceOutgoingChannelAddress,
            constructorArgs: ownedEncryptedChannelConstructorArgs(encryptedDeviceAddress),
            contract: encryptedChannelContract,
        },
    ];

    await verifyAllContracts(hre, verificationTargets);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
