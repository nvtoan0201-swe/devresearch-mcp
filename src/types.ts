export type Platform = "hn" | "reddit" | "lobsters";

export interface NormalizedItem {
  id: string;
  platform: Platform;
  url: string;
  title: string;
  author: string;
  score: number;
  ts: string;
  raw: unknown;
}

export interface NormalizedComment {
  id: string;
  itemId: string;
  author: string;
  authorKarma?: number;
  text: string;
  parentId?: string;
  score: number;
  ts: string;
}
