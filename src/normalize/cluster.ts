import type { NormalizedItem } from "../types.js";
import { minhashSignature, jaccardSimilarity } from "./minhash.js";

export interface ClusterOptions {
  titleThreshold?: number;
  numHashes?: number;
}

export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    u.hostname = u.hostname.toLowerCase();
    const keep: [string, string][] = [];
    u.searchParams.forEach((v, k) => {
      if (!k.toLowerCase().startsWith("utm_")) keep.push([k, v]);
    });
    keep.sort(([a], [b]) => a.localeCompare(b));
    const query = keep.map(([k, v]) => `${k}=${v}`).join("&");
    let pathname = u.pathname;
    if (pathname.length > 1 && pathname.endsWith("/")) {
      pathname = pathname.slice(0, -1);
    }
    const base = `${u.protocol}//${u.hostname}${pathname}`;
    return query.length > 0 ? `${base}?${query}` : base;
  } catch {
    return raw;
  }
}

function shortHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

interface DSU {
  parent: number[];
  find(i: number): number;
  union(a: number, b: number): void;
}

function makeDSU(n: number): DSU {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  return { parent, find, union };
}

export function clusterItems(
  items: NormalizedItem[],
  options: ClusterOptions = {},
): Map<string, string> {
  const titleThreshold = options.titleThreshold ?? 0.7;
  const numHashes = options.numHashes ?? 128;

  const dsu = makeDSU(items.length);
  const normUrls = items.map((i) => normalizeUrl(i.url));
  const sigs = items.map((i) => minhashSignature(i.title, numHashes));

  const urlBucket = new Map<string, number>();
  for (let i = 0; i < items.length; i++) {
    const prev = urlBucket.get(normUrls[i]);
    if (prev !== undefined) {
      dsu.union(i, prev);
    } else {
      urlBucket.set(normUrls[i], i);
    }
  }

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (dsu.find(i) === dsu.find(j)) continue;
      if (jaccardSimilarity(sigs[i], sigs[j]) >= titleThreshold) {
        dsu.union(i, j);
      }
    }
  }

  const rootToCluster = new Map<number, string>();
  const out = new Map<string, string>();
  for (let i = 0; i < items.length; i++) {
    const root = dsu.find(i);
    let cid = rootToCluster.get(root);
    if (!cid) {
      const rootItem = items[root];
      cid = `cl_${shortHash(normalizeUrl(rootItem.url) + "|" + rootItem.title.toLowerCase())}`;
      rootToCluster.set(root, cid);
    }
    out.set(items[i].id, cid);
  }
  return out;
}
