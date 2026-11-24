import { z } from 'zod';

const format = 'nocturne-encrypted-v1';
const envelope = z.object({
  format: z.literal(format), salt: z.string().length(24), iv: z.string().length(16),
  payload: z.string().min(24).max(107_000_000),
});
const encoder = new TextEncoder();

function base64(bytes: Uint8Array) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}

const decode = (safe: string) => Uint8Array.from(atob(safe), char => char.charCodeAt(0));

async function key(password: string, salt: Uint8Array<ArrayBuffer>) {
  if (!crypto.subtle) throw new Error('请在 HTTPS 或本地预览中使用加密备份。');
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 600_000, hash: 'SHA-256' },
    material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encryptBackup(plain: string, password: string) {
  if (Array.from(password).length < 12 || password.length > 256) throw new Error('请使用 12–256 个字符的密码。');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(format) },
    await key(password, salt), encoder.encode(plain));
  return JSON.stringify({ format, salt: base64(salt), iv: base64(iv), payload: base64(new Uint8Array(encrypted)) });
}

export function isEncrypted(text: string) {
  return /^\s*\{\s*"format"\s*:\s*"nocturne-encrypted-v1"/.test(text);
}

export async function decryptBackup(text: string, password: string) {
  if (text.length > 108_000_000) throw new Error('备份文件过大。');
  try {
    const value = envelope.parse(JSON.parse(text));
    const salt = decode(value.salt);
    const iv = decode(value.iv);
    if (salt.length !== 16 || iv.length !== 12) throw new Error('invalid metadata');
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(format) },
      await key(password, salt), decode(value.payload));
    return new TextDecoder('utf-8', { fatal: true }).decode(plain);
  } catch {
    throw new Error('无法解密。请检查密码和备份文件。');
  }
}
