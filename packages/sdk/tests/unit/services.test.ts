import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDefaultConfig, ensureConfigDir } from "../../src/config.js";
import { saveDevice } from "../../src/device.js";
import { SmartClawsError } from "../../src/errors.js";
import { readMessages, resolveChannel } from "../../src/services/channels.js";
import { getWalletInfo } from "../../src/services/wallet.js";

describe("resolveChannel", () => {
  let tempDir: string;

  afterEach(() => {
    delete process.env.SMARTCLAWS_HOME;
    if (tempDir && existsSync(tempDir)) rmSync(tempDir, { recursive: true });
  });

  test("returns the channel address for a direct channel target", () => {
    const addr = "0x1111111111111111111111111111111111111111";
    expect(resolveChannel({ channel: addr }).channelAddress).toBe(addr);
  });

  test("throws INVALID_TARGET when neither device nor channel is provided", () => {
    try {
      resolveChannel({});
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(SmartClawsError);
      expect((e as SmartClawsError).code).toBe("INVALID_TARGET");
    }
  });

  test("throws INVALID_TARGET when both device and channel are provided", () => {
    try {
      resolveChannel({ device: "d", channel: "0x2" });
      throw new Error("expected throw");
    } catch (e) {
      expect((e as SmartClawsError).code).toBe("INVALID_TARGET");
    }
  });

  test("throws DEVICE_NOT_FOUND for an unknown device", () => {
    tempDir = mkdtempSync(join(tmpdir(), "smartclaws-test-"));
    process.env.SMARTCLAWS_HOME = tempDir;
    try {
      resolveChannel({ device: "ghost" });
      throw new Error("expected throw");
    } catch (e) {
      expect((e as SmartClawsError).code).toBe("DEVICE_NOT_FOUND");
    }
  });

  test("resolves a registered device to its outgoing channel", () => {
    tempDir = mkdtempSync(join(tmpdir(), "smartclaws-test-"));
    process.env.SMARTCLAWS_HOME = tempDir;
    ensureConfigDir();
    saveDevice({
      name: "sensor-1",
      deviceContract: "0xdev",
      incomingChannel: "0xin",
      outgoingChannel: "0xout",
    });
    const resolved = resolveChannel({ device: "sensor-1" });
    expect(resolved.channelAddress).toBe("0xout");
    expect(resolved.device).toBe("sensor-1");
  });

  test("threads homeDir explicitly without using SMARTCLAWS_HOME", () => {
    tempDir = mkdtempSync(join(tmpdir(), "smartclaws-test-"));
    // Note: env is intentionally NOT set; the explicit homeDir must be honored.
    ensureConfigDir(tempDir);
    saveDevice(
      { name: "sensor-2", deviceContract: "0xd", incomingChannel: "0xi", outgoingChannel: "0xo2" },
      tempDir,
    );
    const resolved = resolveChannel({ device: "sensor-2" }, tempDir);
    expect(resolved.channelAddress).toBe("0xo2");
  });
});

describe("getWalletInfo", () => {
  test("throws NO_RPC when no RPC is configured", async () => {
    const config = createDefaultConfig("base-testnet", "", 0, "");
    const wallet = {
      address: "0x0000000000000000000000000000000000000001",
      privateKey: "0x00",
    };
    try {
      await getWalletInfo(config, wallet);
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(SmartClawsError);
      expect((e as SmartClawsError).code).toBe("NO_RPC");
    }
  });
});

describe("readMessages input validation", () => {
  // rpcUrl is empty: a valid limit/offset would reach the network, but invalid
  // values must be rejected up front, before any client is created.
  const config = createDefaultConfig("base-testnet", "", 0, "");
  const channelAddress = "0x0000000000000000000000000000000000000abc" as const;

  for (const limit of [0, -1, 1.5, Number.NaN]) {
    test(`rejects limit=${limit} with INVALID_RANGE`, async () => {
      try {
        await readMessages({ channelAddress, limit }, config);
        throw new Error("expected throw");
      } catch (e) {
        expect((e as SmartClawsError).code).toBe("INVALID_RANGE");
      }
    });
  }

  for (const offset of [-1, 2.5]) {
    test(`rejects offset=${offset} with INVALID_RANGE`, async () => {
      try {
        await readMessages({ channelAddress, offset }, config);
        throw new Error("expected throw");
      } catch (e) {
        expect((e as SmartClawsError).code).toBe("INVALID_RANGE");
      }
    });
  }
});
