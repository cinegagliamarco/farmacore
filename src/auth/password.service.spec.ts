import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const svc = new PasswordService();

  it('hash returns a different string than the input', async () => {
    const hash = await svc.hash('secret123');
    expect(hash).not.toBe('secret123');
    expect(hash.startsWith('$argon2id$')).toBe(true);
  });

  it('verify returns true for the right password', async () => {
    const hash = await svc.hash('secret123');
    await expect(svc.verify(hash, 'secret123')).resolves.toBe(true);
  });

  it('verify returns false for the wrong password', async () => {
    const hash = await svc.hash('secret123');
    await expect(svc.verify(hash, 'wrong')).resolves.toBe(false);
  });
});
