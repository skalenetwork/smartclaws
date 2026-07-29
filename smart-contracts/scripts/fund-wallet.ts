import hre from "hardhat";
import { createInterface } from "node:readline";

function prompt(question: string): Promise<string> {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });
}

async function main() {
    const { ethers } = await hre.network.create();
    const [deployer] = await ethers.getSigners();

    const balance = await ethers.provider.getBalance(deployer.address);
    console.log(`Deployer: ${deployer.address}`);
    console.log(`Balance:  ${ethers.formatEther(balance)} CREDITS\n`);

    const recipient = await prompt("Recipient wallet address: ");
    if (!ethers.isAddress(recipient)) {
        throw new Error(`Invalid address: ${recipient}`);
    }

    const amountInput = await prompt("Amount to send (CREDITS, e.g. 1.5): ");
    const amount = ethers.parseEther(amountInput);
    if (amount <= 0n) {
        throw new Error("Amount must be greater than 0");
    }

    console.log(`\nSending ${ethers.formatEther(amount)} CREDITS to ${recipient} ...`);

    const tx = await deployer.sendTransaction({ to: recipient, value: amount });
    console.log(`Tx hash: ${tx.hash}`);

    const receipt = await tx.wait();
    if (receipt?.status !== 1) {
        throw new Error("Transaction failed");
    }

    const newBalance = await ethers.provider.getBalance(recipient);
    console.log(`Done. Recipient balance: ${ethers.formatEther(newBalance)} CREDITS`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
