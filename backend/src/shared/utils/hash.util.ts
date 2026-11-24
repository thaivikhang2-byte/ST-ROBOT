// ═══════════════════════════════════════════
// Shared Utils — Hash
// ═══════════════════════════════════════════

import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { Algorithm, hash, verify, Version } from '@node-rs/argon2';

const SALT_ROUNDS = 12;
const ARGON_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  version: Version.V0x13,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
  outputLen: 32,
} as const;

// At most two 64 MiB native jobs may allocate memory at once. Reserve a released
// slot for its queued waiter so a new request cannot bypass the queue.
let activeArgonJobs = 0;
const argonWaiters: Array<() => void> = [];
async function withArgonCapacity<T>(work: () => Promise<T>): Promise<T> {
  if (activeArgonJobs === 2) {
    await new Promise<void>((resolve) => argonWaiters.push(resolve));
  } else {
    activeArgonJobs++;
  }
  try {
    return await work();
  } finally {
    const next = argonWaiters.shift();
    if (next) next();
    else activeArgonJobs--;
  }
}

function isBcryptPasswordHash(value: string): boolean {
  // Existing application hashes used cost 12. Accept older supported costs,
  // while refusing malformed or excessive encoded work before native parsing.
  return typeof value === 'string' && /^\$2[ab]\$(0[4-9]|1[0-2])\$[./A-Za-z0-9]{53}$/.test(value);
}

export function isArgon2PasswordHash(value: string): boolean {
  if (typeof value !== 'string') return false;
  // Only this application's current profile is accepted. Unknown profiles fail
  // closed rather than trusting encoded memory/time costs or downgrading them.
  const parts = /^\$argon2id\$v=19\$m=65536,t=3,p=1\$([A-Za-z0-9+/]{22})\$([A-Za-z0-9+/]{43})$/.exec(value);
  if (!parts) return false;
  // Buffer's decoder accepts noncanonical trailing bits; check the round trip.
  return parts.slice(1).every((part) => Buffer.from(part, 'base64').toString('base64').replace(/=+$/, '') === part);
}

export function needsPasswordRehash(value: string): boolean {
  return isBcryptPasswordHash(value);
}

export async function hashPassword(password: string): Promise<string> {
  return withArgonCapacity(() => hash(password, ARGON_OPTIONS));
}

export async function comparePassword(
  password: string,
  hash: string,
): Promise<boolean> {
  try {
    if (isBcryptPasswordHash(hash)) return await bcrypt.compare(password, hash);
    if (isArgon2PasswordHash(hash)) return await withArgonCapacity(() => verify(hash, password));
    return false;
  } catch {
    return false;
  }
}

/** Complete the missing KDF work after a failed login comparison. */
export async function consumeFailedPasswordBudget(password: string, storedHash: string): Promise<void> {
  if (isBcryptPasswordHash(storedHash)) {
    await hashPassword(password);
  } else if (isArgon2PasswordHash(storedHash)) {
    await bcrypt.hash(password, SALT_ROUNDS);
  } else {
    await consumeMissingPasswordBudget(password);
  }
}

/** Unknown accounts perform the same two KDFs as either invalid-password path. */
export async function consumeMissingPasswordBudget(password: string): Promise<void> {
  await bcrypt.hash(password, SALT_ROUNDS);
  await hashPassword(password);
}

export function sha256(data: string | Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export function generateToken(length = 32): string {
  return crypto.randomBytes(length).toString('hex');
}
