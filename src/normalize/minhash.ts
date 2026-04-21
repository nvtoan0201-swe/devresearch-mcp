const MERSENNE_PRIME = 2147483647; // 2^31 - 1

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0);
}

function hash32(s: string, seed: number): number {
  let h = 2166136261 ^ seed;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % MERSENNE_PRIME;
}

export function minhashSignature(text: string, numHashes = 128): number[] {
  const tokens = tokenize(text);
  const sig = new Array<number>(numHashes).fill(MERSENNE_PRIME);
  if (tokens.length === 0) return sig;
  for (let h = 0; h < numHashes; h++) {
    let min = MERSENNE_PRIME;
    for (const tok of tokens) {
      const v = hash32(tok, h + 1);
      if (v < min) min = v;
    }
    sig[h] = min;
  }
  return sig;
}

export function jaccardSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`signature length mismatch: ${a.length} vs ${b.length}`);
  }
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) matches += 1;
  }
  return matches / a.length;
}
