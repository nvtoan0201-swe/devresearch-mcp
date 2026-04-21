import { describe, it, expect } from "vitest";
import {
  minhashSignature,
  jaccardSimilarity,
  tokenize,
} from "../../src/normalize/minhash.js";

describe("tokenize", () => {
  it("lowercases and splits on non-word chars", () => {
    expect(tokenize("Hello, World!  Bun-1.2")).toEqual([
      "hello",
      "world",
      "bun",
      "1",
      "2",
    ]);
  });

  it("drops empty tokens", () => {
    expect(tokenize("   ")).toEqual([]);
  });
});

describe("minhashSignature", () => {
  it("produces deterministic signature for same input", () => {
    const a = minhashSignature("Bun 1.2 is out", 64);
    const b = minhashSignature("Bun 1.2 is out", 64);
    expect(a).toEqual(b);
    expect(a).toHaveLength(64);
  });

  it("produces different signatures for unrelated inputs", () => {
    const a = minhashSignature("Bun 1.2 is out", 64);
    const b = minhashSignature("Rust async runtime internals", 64);
    expect(a).not.toEqual(b);
  });
});

describe("jaccardSimilarity", () => {
  it("returns 1 for identical signatures", () => {
    const a = minhashSignature("Bun 1.2 is out", 64);
    expect(jaccardSimilarity(a, a)).toBe(1);
  });

  it("returns high similarity for near-duplicates", () => {
    const a = minhashSignature("Bun 1.2 is out today", 128);
    const b = minhashSignature("Bun 1.2 is out", 128);
    expect(jaccardSimilarity(a, b)).toBeGreaterThan(0.4);
  });

  it("returns low similarity for unrelated inputs", () => {
    const a = minhashSignature("Bun 1.2 is out today", 128);
    const b = minhashSignature("Rust async runtime internals", 128);
    expect(jaccardSimilarity(a, b)).toBeLessThan(0.3);
  });

  it("throws on mismatched signature lengths", () => {
    expect(() =>
      jaccardSimilarity(minhashSignature("a", 64), minhashSignature("a", 128)),
    ).toThrow();
  });
});
