import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface SendMail {
  to: string;
  text: string;
  subject?: string;
}

export interface Sender {
  send(mail: SendMail): Promise<void>;
}

/** Dry-run sender: prints the mail to stdout instead of sending it. */
export class DebugSender implements Sender {
  async send(mail: SendMail) {
    console.log(`[debug-mail] to=${mail.to}${mail.subject ? ` subject=${mail.subject}` : ""}`);
    console.log(mail.text);
    console.log("---");
  }

  /** Dry-run card delivery: writes the PNG under data/cards/ so it can be eyeballed. */
  sendCard(png: Buffer, name: string): void {
    const dir = join(process.cwd(), "data", "cards");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, name);
    writeFileSync(file, png);
    console.log(`[debug-card] wrote ${file} (${png.length} bytes)`);
  }
}