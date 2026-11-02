import "server-only";

import crypto from "node:crypto";
import { config } from "../config";

const SEALED_PREFIX = "dfsec1:";

/** AES-256-GCM encryption for integration tokens and other DB-stored secrets. */
export class AtRestCipher {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) {
      throw new Error("At-rest cipher key must be 32 bytes");
    }
  }

  static fromConfig(): AtRestCipher {
    return new AtRestCipher(config.secrets.masterKeyBytes());
  }

  isSealed(value: string): boolean {
    return value.startsWith(SEALED_PREFIX);
  }

  seal(plaintext: string): string {
    if (!plaintext) return plaintext;
    if (this.isSealed(plaintext)) return plaintext;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${SEALED_PREFIX}${iv.toString("base64url")}:${tag.toString("base64url")}:${ciphertext.toString("base64url")}`;
  }

  /** Opens sealed values; legacy plaintext passes through until migration seals them. */
  open(stored: string): string {
    if (!stored || !this.isSealed(stored)) return stored;
    const payload = stored.slice(SEALED_PREFIX.length);
    const [ivPart, tagPart, dataPart] = payload.split(":");
    if (!ivPart || !tagPart || !dataPart) {
      throw new Error("Invalid sealed secret format");
    }
    const iv = Buffer.from(ivPart, "base64url");
    const tag = Buffer.from(tagPart, "base64url");
    const data = Buffer.from(dataPart, "base64url");
    const decipher = crypto.createDecipheriv("aes-256-gcm", this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  }
}
