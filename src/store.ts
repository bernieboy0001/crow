import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { config } from "./config";
import type { WatchRule } from "./rules";

export interface WatchStore {
  load(): Promise<WatchRule[]>;
  save(rules: WatchRule[]): Promise<void>;
}

export function createStore(): WatchStore {
  return new FileStore(config.storePath);
}

export class MemoryStore implements WatchStore {
  private rules: WatchRule[] = [];
  async load() {
    return this.rules;
  }
  async save(rules: WatchRule[]) {
    this.rules = rules;
  }
}

export class FileStore implements WatchStore {
  constructor(private readonly path: string) {}
  async load(): Promise<WatchRule[]> {
    try {
      const raw = await readFile(this.path, "utf8");
      return JSON.parse(raw) as WatchRule[];
    } catch {
      return [];
    }
  }
  async save(rules: WatchRule[]) {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(rules, null, 2), "utf8");
  }
}