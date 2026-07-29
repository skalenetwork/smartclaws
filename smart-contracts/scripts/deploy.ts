import hre from "hardhat";
import { verifyContract } from "@nomicfoundation/hardhat-verify/verify";

async function main() {
    const { ethers } = await hre.network.create();
    const [deployer] = await ethers.getSigners();
    console.log("Deploying with account:", deployer.address);

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
    const deviceFactory = await deployFactory("DeviceFactory");
    const deviceGroupFactory = await deployFactory("DeviceGroupFactory");
    const agentFactory = await deployFactory("AgentFactory");

    // --- Deploy registry ---
    const SmartClaws = await ethers.getContractFactory("SmartClaws");
    const registry = await SmartClaws.deploy(
        channelFactory,
        deviceFactory,
        deviceGroupFactory,
        agentFactory,
    );
    await registry.waitForDeployment();
    const registryAddress = await registry.getAddress();
    console.log("SmartClaws registry deployed to:", registryAddress);

    const tx = await registry.createChannel(deployer.address, 1024 * 1024);
    const receipt = await tx.wait();

    const event = receipt?.logs.find((log) => {
        try {
            return (
                registry.interface.parseLog({
                    topics: log.topics as string[],
                    data: log.data,
                })?.name === "ChannelCreated"
            );
        } catch {
            return false;
        }
    });

    let channelAddress: string | undefined;
    if (event) {
        const parsed = registry.interface.parseLog({
            topics: event.topics as string[],
            data: event.data,
        });
        channelAddress = parsed?.args.channel;
        console.log("Channel deployed to:", channelAddress);
    }

    // Verify contracts on Blockscout
    console.log("\nWaiting for Blockscout to index contracts...");
    await new Promise((r) => setTimeout(r, 10_000));

    const verifyNoArgs = async (address: string, label: string) => {
        try {
            await verifyContract({ address, provider: "etherscan" }, hre);
            console.log(`${label} verified on Blockscout`);
        } catch (e: any) {
            console.warn(`${label} verification:`, e.message);
        }
    };

    await verifyNoArgs(channelFactory, "ChannelFactory");
    await verifyNoArgs(deviceFactory, "DeviceFactory");
    await verifyNoArgs(deviceGroupFactory, "DeviceGroupFactory");
    await verifyNoArgs(agentFactory, "AgentFactory");

    try {
        await verifyContract(
            {
                address: registryAddress,
                constructorArgs: [channelFactory, deviceFactory, deviceGroupFactory, agentFactory],
                provider: "etherscan",
            },
            hre,
        );
        console.log("SmartClaws registry verified on Blockscout");
    } catch (e: any) {
        console.warn("Registry verification:", e.message);
    }

    if (channelAddress) {
        try {
            await verifyContract(
                {
                    address: channelAddress,
                    constructorArgs: [deployer.address, 1024 * 1024, registryAddress],
                    contract: "contracts/SmartClawsChannel.sol:SmartClawsChannel",
                    provider: "etherscan",
                },
                hre,
            );
            console.log("Channel verified on Blockscout");
        } catch (e: any) {
            console.warn("Channel verification:", e.message);
        }
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
