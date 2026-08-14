import hre from "hardhat";
import { verifyContract } from "@nomicfoundation/hardhat-verify/verify";

interface VerificationTarget {
    address: string;
    constructorArgs: unknown[];
    contract: string;
    label: string;
}

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

    const channelFactoryKind =
        (process.env.SMARTCLAWS_CHANNEL_FACTORY ?? "plain").toLowerCase() === "encrypted"
            ? "encrypted"
            : "plain";
    const channelFactoryContract =
        channelFactoryKind === "encrypted" ? "EncryptedChannelFactory" : "ChannelFactory";
    console.log("Channel factory mode:", channelFactoryKind);

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

    const channelFactory = await deployFactory(channelFactoryContract);
    const deviceFactory = await deployFactory("DeviceFactory");
    const deviceGroupFactory = await deployFactory("DeviceGroupFactory");
    const agentFactory = await deployFactory("AgentFactory");
    const publicKeyRegistryFactory = await deployFactory("PublicKeyRegistryFactory");

    // --- Deploy registry ---
    const SmartClaws = await ethers.getContractFactory("SmartClaws");
    const registry = await SmartClaws.deploy(
        channelFactory,
        deviceFactory,
        deviceGroupFactory,
        agentFactory,
        publicKeyRegistryFactory,
    );
    await registry.waitForDeployment();
    const registryAddress = await registry.getAddress();
    console.log("SmartClaws registry deployed to:", registryAddress);
    const publicKeyRegistryAddress = await registry.publicKeyRegistry();
    console.log("PublicKeyRegistry deployed to:", publicKeyRegistryAddress);

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

    // Verify every contract deployed by this script, including contracts created
    // internally by a factory call.
    console.log("\nWaiting for Blockscout to index contracts...");
    await new Promise((r) => setTimeout(r, 10_000));

    const channelContract =
        channelFactoryKind === "encrypted"
            ? "contracts/SmartClawsChannelEncrypted.sol:SmartClawsChannelEncrypted"
            : "contracts/SmartClawsChannel.sol:SmartClawsChannel";
    const channelConstructorArgs =
        channelFactoryKind === "encrypted"
            ? [deployer.address, verificationCapacity, registryAddress, publicKeyRegistryAddress]
            : [deployer.address, verificationCapacity, registryAddress];
    const ownedChannelConstructorArgs = (owner: string) =>
        channelFactoryKind === "encrypted"
            ? [owner, verificationCapacity, registryAddress, publicKeyRegistryAddress]
            : [owner, verificationCapacity, registryAddress];

    const verificationTargets: VerificationTarget[] = [
        {
            label: channelFactoryContract,
            address: channelFactory,
            constructorArgs: [],
            contract: `contracts/factories/${channelFactoryContract}.sol:${channelFactoryContract}`,
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
                deviceFactory,
                deviceGroupFactory,
                agentFactory,
                publicKeyRegistryFactory,
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
            label: channelFactoryKind === "encrypted" ? "Encrypted channel" : "Channel",
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
    ];

    const verificationFailures: string[] = [];
    for (const target of verificationTargets) {
        try {
            await verifyContract(
                {
                    address: target.address,
                    constructorArgs: target.constructorArgs,
                    contract: target.contract,
                    provider: "etherscan",
                },
                hre,
            );
            console.log(`${target.label} verified on Blockscout`);
        } catch (e: any) {
            verificationFailures.push(
                `${target.label} (${target.address}): ${e?.message ?? String(e)}`,
            );
        }
    }

    if (verificationFailures.length !== 0) {
        throw new Error(`Blockscout verification failed:\n${verificationFailures.join("\n")}`);
    }

    console.log(`\nVerified all ${verificationTargets.length} deployed contracts on Blockscout`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
