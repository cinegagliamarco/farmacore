import { CredentialEncryptionService } from './credential-encryption.service';

describe('CredentialEncryptionService', () => {
  const key = Buffer.alloc(32);
  const svc = new CredentialEncryptionService({ integrationDbKey: key } as never);

  it('roundtrips plaintext', async () => {
    const cipher = svc.encrypt('hunter2');
    expect(cipher).toBeInstanceOf(Buffer);
    expect(cipher.length).toBeGreaterThan(12 + 16);
    await expect(svc.decrypt(cipher)).resolves.toBe('hunter2');
  });

  it('produces different ciphertext each time (random nonce)', () => {
    const a = svc.encrypt('hunter2');
    const b = svc.encrypt('hunter2');
    expect(a.equals(b)).toBe(false);
  });

  it('rejects tampered ciphertext', async () => {
    const cipher = svc.encrypt('hunter2');
    cipher[cipher.length - 1] ^= 0x01;
    await expect(svc.decrypt(cipher)).rejects.toThrow();
  });
});
