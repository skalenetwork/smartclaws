import hre from "hardhat";
import { verifyContract } from "@nomicfoundation/hardhat-verify/verify";

async function main() {
  const { ethers } = await hre.network.connect();
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  const SmartClaws = await ethers.getContractFactory("SmartClaws");
  const registry = await SmartClaws.deploy();
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log("SmartClaws registry deployed to:", registryAddress);

  const tx = await registry.createChannel(
    deployer.address,
    1024 * 1024
  );
  const receipt = await tx.wait();

  const event = receipt?.logs.find((log) => {
    try {
      return registry.interface.parseLog({
        topics: log.topics as string[],
        data: log.data,
      })?.name === "ChannelCreated";
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

  try {
    await verifyContract({ address: registryAddress, provider: "etherscan" }, hre);
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
