import hre from "hardhat";

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

  if (event) {
    const parsed = registry.interface.parseLog({
      topics: event.topics as string[],
      data: event.data,
    });
    console.log("Channel deployed to:", parsed?.args.channel);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
