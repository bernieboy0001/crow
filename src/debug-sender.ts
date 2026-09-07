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
}