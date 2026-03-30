import { describe, expect, test } from "bun:test";
import { generateName } from "../../src/names.ts";

describe("names", () => {
  test("generates adjective-noun format", () => {
    const name = generateName();
    expect(name).toMatch(/^[a-z]+-[a-z]+$/);
  });

  test("generates different names", () => {
    const names = new Set(Array.from({ length: 20 }, () => generateName()));
    expect(names.size).toBeGreaterThan(1);
  });
});
