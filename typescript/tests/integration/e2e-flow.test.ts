import { beforeAll, describe, expect, test } from "bun:test";
import {
  type Address,
  createWalletClient,
  decodeEventLog,
  formatEther,
  getContract,
  http,
  parseEther,
  toBytes,
  toHex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import SmartClawsABI from "../../../abi/SmartClaws.json";
import SmartClawsChannelABI from "../../../abi/SmartClawsChannel.json";
import SmartClawsDeviceABI from "../../../abi/SmartClawsDevice.json";
import SmartClawsDeviceGroupABI from "../../../abi/SmartClawsDeviceGroup.json";
import { decode, encode } from "../../src/envelope.ts";
import { deployRegistry, publicClient, walletClient } from "../setup.ts";

const ANVIL_RPC = "http://127.0.0.1:8545";

function userWalletClient(privateKey: `0x${string}`) {
  return createWalletClient({
    account: privateKeyToAccount(privateKey),
    chain: foundry,
    transport: http(ANVIL_RPC),
  });
}

describe("e2e: wallet → register → publish → read", () => {
  let registryAddress: Address;
  let userPrivateKey: `0x${string}`;
  let userAddress: Address;
  let groupAddress: Address;
  let deviceAddress: Address;
  let outgoingChannel: Address;

  beforeAll(async () => {
    registryAddress = await deployRegistry();
  });

  test("1. generate new wallet", () => {
    userPrivateKey = generatePrivateKey();
    userAddress = privateKeyToAccount(userPrivateKey).address;
    expect(userAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  test("2. fund wallet from anvil base account", async () => {
    const amount = parseEther("10");
    const hash = await walletClient.sendTransaction({ to: userAddress, value: amount });
    await publicClient.waitForTransactionReceipt({ hash });

    const balance = await publicClient.getBalance({ address: userAddress });
    expect(balance).toBe(amount);
    expect(formatEther(balance)).toBe("10");
  });

  test("3. register device group", async () => {
    const registry = getContract({
      address: registryAddress,
      abi: SmartClawsABI.abi,
      client: { public: publicClient, wallet: userWalletClient(userPrivateKey) },
    });

    const hash = await registry.write.registerDeviceGroup(["home-sensors", "temperature,humidity"]);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== registryAddress.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({
          abi: SmartClawsABI.abi,
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName === "DeviceGroupRegistered") {
          groupAddress = (decoded.args as unknown as { deviceGroup: Address }).deviceGroup;
        }
      } catch {}
    }

    expect(groupAddress).toBeDefined();
  });

  test("4. register device in group", async () => {
    const userWallet = userWalletClient(userPrivateKey);
    const group = getContract({
      address: groupAddress,
      abi: SmartClawsDeviceGroupABI.abi,
      client: { public: publicClient, wallet: userWallet },
    });

    const hash = await group.write.registerDevice([
      "temp-sensor-01",
      userWallet.account.address,
      BigInt(1024 * 1024),
    ]);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== groupAddress.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({
          abi: SmartClawsDeviceGroupABI.abi,
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName === "DeviceRegistered") {
          deviceAddress = (decoded.args as unknown as { device: Address }).device;
        }
      } catch {}
    }

    expect(deviceAddress).toBeDefined();

    const device = getContract({
      address: deviceAddress,
      abi: SmartClawsDeviceABI.abi,
      client: publicClient,
    });
    outgoingChannel = (await device.read.outgoingChannel()) as Address;
    expect(outgoingChannel).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  test("5. publish sensor readings", async () => {
    const channel = getContract({
      address: outgoingChannel,
      abi: SmartClawsChannelABI.abi,
      client: { public: publicClient, wallet: userWalletClient(userPrivateKey) },
    });

    const readings = [
      { ts: 1711324800, topic: "temperature", p: { temp: 22.1, unit: "C" } },
      { ts: 1711324860, topic: "temperature", p: { temp: 22.4, unit: "C" } },
      { ts: 1711324920, topic: "humidity", p: { rh: 45.2, unit: "%" } },
    ];

    for (const r of readings) {
      const encoded = encode(r.topic, r.p, "temp-sensor-01", r.ts);
      const hash = await channel.write.publishMessage([toHex(encoded)]);
      await publicClient.waitForTransactionReceipt({ hash });
    }

    const count = await channel.read.getMessageCount();
    expect(count).toBe(3n);
  });

  test("6. read and decode sensor data", async () => {
    const channel = getContract({
      address: outgoingChannel,
      abi: SmartClawsChannelABI.abi,
      client: publicClient,
    });

    const count = await channel.read.getMessageCount();
    const [payloads] = (await channel.read.readMessages([0n, count])) as [
      readonly `0x${string}`[],
      readonly bigint[],
    ];
    expect(payloads.length).toBe(3);

    const env0 = decode(toBytes(payloads[0]));
    expect(env0.v).toBe(1);
    expect(env0.dev).toBe("temp-sensor-01");
    expect(env0.topic).toBe("temperature");
    expect(env0.ts).toBe(1711324800);
    expect(env0.p).toEqual({ temp: 22.1, unit: "C" });

    const env1 = decode(toBytes(payloads[1]));
    expect(env1.topic).toBe("temperature");
    expect(env1.ts).toBe(1711324860);
    expect(env1.p).toEqual({ temp: 22.4, unit: "C" });

    const env2 = decode(toBytes(payloads[2]));
    expect(env2.topic).toBe("humidity");
    expect(env2.ts).toBe(1711324920);
    expect(env2.p).toEqual({ rh: 45.2, unit: "%" });
  });
});
