import hre from "hardhat";
import { verifyContract } from "@nomicfoundation/hardhat-verify/verify";

async function main() {
    const address = process.env.VERIFY_ADDRESS;
    if (!address) {
        throw new Error("Set VERIFY_ADDRESS env var");
    }

    const constructorArgs = process.env.VERIFY_ARGS ? JSON.parse(process.env.VERIFY_ARGS) : [];

    const contract = process.env.VERIFY_CONTRACT;

    console.log(`Verifying ${contract ?? "auto-detect"} at ${address}...`);

    await verifyContract(
        {
            address,
            constructorArgs,
            contract,
            provider: "etherscan",
        },
        hre,
    );
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
