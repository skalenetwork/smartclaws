import { describe, expect, test } from "bun:test";
import entry from "../src/index.js";
import type { RuntimeModelLike } from "../src/transport.js";

interface RegisteredProvider {
  id: string;
  auth: unknown[];
  catalog: { run: (ctx: unknown) => Promise<unknown> };
  createStreamFn?: (ctx: { model: RuntimeModelLike }) => unknown;
}

interface RegisteredCommand {
  name: string;
}

interface RegisteredLifecycle {
  id: string;
  cleanup?: () => void | Promise<void>;
}

/** Drive the plugin entry's register hook with a minimal fake plugin API. */
function collectRegistrations(): {
  provider?: RegisteredProvider;
  command?: RegisteredCommand;
  lifecycle?: RegisteredLifecycle;
} {
  let provider: RegisteredProvider | undefined;
  let command: RegisteredCommand | undefined;
  let lifecycle: RegisteredLifecycle | undefined;
  const api = {
    registerProvider: (value: RegisteredProvider) => {
      provider = value;
    },
    registerModelCatalogProvider: () => {},
    registerCommand: (value: RegisteredCommand) => {
      command = value;
    },
    lifecycle: {
      registerRuntimeLifecycle: (value: RegisteredLifecycle) => {
        lifecycle = value;
      },
    },
  };
  (entry as unknown as { register: (api: unknown) => void }).register(api);
  return { provider, command, lifecycle };
}

function requireProvider(): RegisteredProvider {
  const { provider } = collectRegistrations();
  if (!provider) throw new Error("provider was not registered");
  return provider;
}

const DIRECT: RuntimeModelLike = {
  id: "deepseek-ai/DeepSeek-V4-Flash",
  provider: "nearai",
  api: "openai-completions",
  baseUrl: "https://node1.completions.near.ai/v1",
};
const GATEWAY: RuntimeModelLike = {
  id: "deepseek-ai/DeepSeek-V4-Flash",
  provider: "nearai",
  api: "openai-completions",
  baseUrl: "https://api.near.ai/v1",
};

describe("plugin registration smoke test", () => {
  test("exposes provider identity metadata", () => {
    const identity = entry as unknown as { id: string; name: string };
    expect(identity.id).toBe("nearai-verify");
    expect(identity.name).toBeTruthy();
  });

  test("registers the nearai provider with api-key auth", () => {
    const provider = requireProvider();
    expect(provider.id).toBe("nearai");
    expect(provider.auth.length).toBeGreaterThanOrEqual(1);
  });

  test("selects the verified transport only for supported direct routes", () => {
    const provider = requireProvider();
    expect(typeof provider.createStreamFn?.({ model: DIRECT })).toBe("function");
    expect(provider.createStreamFn?.({ model: GATEWAY })).toBeUndefined();
  });

  test("registers the /nearai-verify runtime command", () => {
    const { command } = collectRegistrations();
    expect(command?.name).toBe("nearai-verify");
  });

  test("registers a runtime lifecycle whose cleanup is safe to call", () => {
    const { lifecycle } = collectRegistrations();
    expect(lifecycle?.id).toBe("nearai-verify-runtime");
    expect(() => lifecycle?.cleanup?.()).not.toThrow();
  });

  test("catalog preserves the configured provider verbatim and refuses when absent", async () => {
    const provider = requireProvider();
    await expect(provider.catalog.run({ config: {} })).rejects.toThrow();
    const configured = {
      api: "openai-completions",
      baseUrl: "https://node1.completions.near.ai/v1",
      models: [],
    };
    const result = await provider.catalog.run({
      config: { models: { providers: { nearai: configured } } },
    });
    expect(result).toEqual({ provider: configured });
  });
});
