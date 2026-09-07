export interface MemoryRecord {
  role: "user" | "assistant";
  text: string;
  at: number;
}

/** Rolling short-term memory per chat. Resets on restart (kept in RAM). */
export class ChatMemory {
  private buf: MemoryRecord[] = [];

  constructor(private readonly max = 10) {}

  add(role: MemoryRecord["role"], text: string) {
    this.buf.push({ role, text, at: Date.now() });
    if (this.buf.length > this.max) this.buf.shift();
  }

  lines(): string[] {
    return this.buf.map((r) => `${r.role}: ${r.text}`);
  }
}