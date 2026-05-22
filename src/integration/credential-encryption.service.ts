import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { AppConfigService } from '../config/app-config.service';

const NONCE_BYTES = 12;
const TAG_BYTES = 16;

@Injectable()
export class CredentialEncryptionService {
  private readonly key: Buffer;

  constructor(config: AppConfigService) {
    const key = config.integrationDbKey;
    if (key.length !== 32) throw new Error('INTEGRATION_DB_KEY must decode to 32 bytes');
    this.key = key;
  }

  public encrypt(plain: string): Buffer {
    const nonce = crypto.randomBytes(NONCE_BYTES);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, nonce);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([nonce, tag, ct]);
  }

  public decrypt(payload: Buffer): Promise<string> {
    if (payload.length < NONCE_BYTES + TAG_BYTES) {
      return Promise.reject(new Error('ciphertext too short'));
    }
    const nonce = payload.subarray(0, NONCE_BYTES);
    const tag = payload.subarray(NONCE_BYTES, NONCE_BYTES + TAG_BYTES);
    const ct = payload.subarray(NONCE_BYTES + TAG_BYTES);
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, nonce);
      decipher.setAuthTag(tag);
      const plain = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
      return Promise.resolve(plain);
    } catch (err) {
      return Promise.reject(err as Error);
    }
  }
}
