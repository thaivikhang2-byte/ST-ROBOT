import { Algorithm, parseOptions, Version } from '@node-rs/argon2';
import {
  comparePassword,
  consumeFailedPasswordBudget,
  consumeMissingPasswordBudget,
  hashPassword,
  isArgon2PasswordHash,
  needsPasswordRehash,
} from './hash.util';

const argon = require('@node-rs/argon2') as typeof import('@node-rs/argon2');
const bcrypt = require('bcrypt') as typeof import('bcrypt');

describe('password hashing', () => {
  const password = 'A private test password';
  let legacyHash: string;
  let currentHash: string;

  beforeAll(async () => {
    legacyHash = await bcrypt.hash(password, 12);
    currentHash = await hashPassword(password);
  });
  afterEach(() => jest.restoreAllMocks());

  it('uses salted Argon2id with the explicit 64 MiB policy for new passwords', async () => {
    const secondHash = await hashPassword(password);
    expect(secondHash).not.toBe(currentHash);
    expect(parseOptions(secondHash)).toEqual({
      algorithm: Algorithm.Argon2id,
      version: Version.V0x13,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 1,
      outputLen: 32,
      saltLen: 16,
    });
    expect(isArgon2PasswordHash(secondHash)).toBe(true);
    expect(needsPasswordRehash(secondHash)).toBe(false);
    expect(await comparePassword(password, secondHash)).toBe(true);
    expect(await comparePassword('wrong password', secondHash)).toBe(false);
  });

  it('keeps legacy bcrypt accounts verifiable and identifies only bcrypt for migration', async () => {
    expect(needsPasswordRehash(legacyHash)).toBe(true);
    expect(isArgon2PasswordHash(legacyHash)).toBe(false);
    expect(await comparePassword(password, legacyHash)).toBe(true);
    expect(await comparePassword('wrong password', legacyHash)).toBe(false);
    expect(needsPasswordRehash('invalid')).toBe(false);
  });

  it('uses every UTF-8 byte of new passwords while preserving bcrypt verification semantics', async () => {
    const prefix = '界'.repeat(24); // 72 UTF-8 bytes.
    const argonHash = await hashPassword(prefix + 'first suffix');
    expect(await comparePassword(prefix + 'first suffix', argonHash)).toBe(true);
    expect(await comparePassword(prefix + 'other suffix', argonHash)).toBe(false);
    const bcryptHash = await bcrypt.hash(prefix + 'first suffix', 12);
    expect(await comparePassword(prefix + 'other suffix', bcryptHash)).toBe(true);
  });

  it('rejects malformed and excessive-work encodings before calling a native verifier', async () => {
    const argonVerify = jest.spyOn(argon, 'verify');
    const bcryptCompare = jest.spyOn(bcrypt, 'compare');
    const malformed = [
      '',
      'plaintext',
      legacyHash.replace('$12$', '$31$'),
      currentHash.replace('m=65536', 'm=999999999'),
      currentHash.replace('t=3', 't=999'),
      currentHash.replace('p=1', 'p=4'),
      currentHash.replace('argon2id', 'argon2d'),
      currentHash + '=',
      currentHash.slice(0, -1),
    ];
    for (const storedHash of malformed) {
      expect(isArgon2PasswordHash(storedHash)).toBe(false);
      expect(needsPasswordRehash(storedHash)).toBe(false);
      expect(await comparePassword(password, storedHash)).toBe(false);
    }
    expect(argonVerify).not.toHaveBeenCalled();
    expect(bcryptCompare).not.toHaveBeenCalled();
  });

  it('fails closed if native verification rejects an encoding', async () => {
    jest.spyOn(argon, 'verify').mockRejectedValue(new Error('invalid encoding'));
    expect(await comparePassword(password, currentHash)).toBe(false);
  });

  it('limits simultaneous Argon allocations to two and releases capacity after failures', async () => {
    let active = 0;
    let maximum = 0;
    let calls = 0;
    jest.spyOn(argon, 'hash').mockImplementation(async () => {
      const call = calls++;
      maximum = Math.max(maximum, ++active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      if (call === 0) throw new Error('native failure');
      return currentHash;
    });
    const outcomes = await Promise.allSettled(Array.from({ length: 6 }, () => hashPassword(password)));
    expect(maximum).toBe(2);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(5);
    expect(active).toBe(0);
    expect(await hashPassword(password)).toBe(currentHash);
  });

  it('completes both KDF budgets for invalid and missing login identities', async () => {
    const work: string[] = [];
    const argonHash = jest.spyOn(argon, 'hash').mockImplementation(async () => {
      work.push('argon-start');
      await Promise.resolve();
      work.push('argon-end');
      return currentHash;
    });
    const bcryptHash = jest.spyOn(bcrypt, 'hash').mockImplementation(async () => {
      work.push('bcrypt-start');
      await Promise.resolve();
      work.push('bcrypt-end');
      return legacyHash;
    });
    await consumeFailedPasswordBudget(password, legacyHash);
    expect(argonHash).toHaveBeenCalledTimes(1);
    expect(bcryptHash).not.toHaveBeenCalled();
    argonHash.mockClear();

    await consumeFailedPasswordBudget(password, currentHash);
    expect(argonHash).not.toHaveBeenCalled();
    expect(bcryptHash).toHaveBeenCalledWith(password, 12);
    bcryptHash.mockClear();
    work.length = 0;

    await consumeMissingPasswordBudget(password);
    expect(argonHash).toHaveBeenCalledTimes(1);
    expect(bcryptHash).toHaveBeenCalledTimes(1);
    expect(work).toEqual(['bcrypt-start', 'bcrypt-end', 'argon-start', 'argon-end']);
    argonHash.mockClear();
    bcryptHash.mockClear();

    await consumeFailedPasswordBudget(password, 'malformed');
    expect(argonHash).toHaveBeenCalledTimes(1);
    expect(bcryptHash).toHaveBeenCalledTimes(1);
  });
});
