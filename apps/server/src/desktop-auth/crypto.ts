import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';
import { hostname, userInfo } from 'node:os';

const KEY_LEN = 32;
const IV_LEN = 12;
const PBKDF2_ITERS = 120_000;

export type EncryptedBlob = {
  alg: 'aes-256-gcm';
  salt: string;
  iv: string;
  ciphertext: string;
  tag: string;
};

function machineMaterial(): string {
  let username = 'unknown';
  try {
    username = userInfo().username || 'unknown';
  } catch {
    // ignore
  }
  return `veylin-desktop-auth-v1|${hostname()}|${username}`;
}

function deriveKey(salt: Buffer): Buffer {
  return pbkdf2Sync(machineMaterial(), salt, PBKDF2_ITERS, KEY_LEN, 'sha256');
}

export function encryptJson(value: unknown): EncryptedBlob {
  const salt = randomBytes(16);
  const iv = randomBytes(IV_LEN);
  const key = deriveKey(salt);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    alg: 'aes-256-gcm',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    tag: tag.toString('base64'),
  };
}

export function decryptJson<T>(blob: EncryptedBlob): T {
  if (blob.alg !== 'aes-256-gcm') {
    throw new Error('unsupported token cipher');
  }
  const salt = Buffer.from(blob.salt, 'base64');
  const iv = Buffer.from(blob.iv, 'base64');
  const key = deriveKey(salt);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(Buffer.from(blob.tag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(blob.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString('utf8')) as T;
}
