import { describe, expect, it } from "vitest";
import { hashPassword, randomSlug, validateTarget, verifyPassword } from "./security.js";

describe("security helpers", () => {
  it("hashes and verifies passwords", async () => {
    const encoded = await hashPassword("correct horse battery staple");
    expect(encoded).not.toContain("correct horse");
    expect(await verifyPassword("correct horse battery staple", encoded)).toBe(true);
    expect(await verifyPassword("wrong password", encoded)).toBe(false);
  });

  it("accepts web and app protocols while blocking executable protocols", () => {
    expect(validateTarget("https://example.com/path")).toEqual({ target: "https://example.com/path", protocol: "https" });
    expect(validateTarget("weixin://qr/group/example").protocol).toBe("weixin");
    expect(() => validateTarget("javascript:alert(1)")).toThrow("不允许");
    expect(() => validateTarget("plain text")).toThrow("必须包含协议");
  });

  it("creates URL-safe random slugs", () => {
    const slugs = new Set(Array.from({ length: 100 }, () => randomSlug()));
    expect(slugs.size).toBe(100);
    expect([...slugs].every((slug) => /^[A-Za-z0-9]{10}$/.test(slug))).toBe(true);
  });
});
