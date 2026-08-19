import hre from "hardhat";
import { verifyAllContracts } from "./verification-utils.js";

async function main() {
    const address = process.env.VERIFY_ADDRESS;
    if (!address) {
        throw new Error("Set VERIFY_ADDRESS env var");
    }

    const constructorArgs = process.env.VERIFY_ARGS ? JSON.parse(process.env.VERIFY_ARGS) : [];
    const contract = process.env.VERIFY_CONTRACT;
    if (!contract) {
        throw new Error("Set VERIFY_CONTRACT env var (fully qualified name)");
    }

    await verifyAllContracts(hre, [
        {
            label: contract.split(":").pop() ?? contract,
            address,
            constructorArgs,
            contract,
            force: process.env.VERIFY_FORCE === "1",
        },
    ]);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
