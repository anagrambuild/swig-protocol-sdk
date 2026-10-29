import {
  AUTHORIZATION_LOCK_LENGTH,
  getAuthorizationLockDecoder,
  getPositionDecoder,
  getSwigTailHeaderDecoder,
  POSITION_LENGTH,
  SwigTailKind,
  TAIL_HEADER_LENGTH,
  type AuthorizationLock,
  type SwigAccount,
  type SwigTailHeader,
} from '@swig-wallet/coder';
import { SolPublicKey } from '../solana';

/** Byte length of the rent claimer tail entry's value. */
const RENT_CLAIMER_VALUE_LENGTH = 32;
const ACTIVE_SUB_ACCOUNT_COUNT_VALUE_LENGTH = 8;
const MAX_CONFIG_SEED_PREFIX_LENGTH = 32;
const MAX_AUTHORIZATION_LOCKS = 32;
const TAIL_VERSION = 1;

/** One typed entry from the swig config account's tail. */
export type SwigTailEntry = {
  header: SwigTailHeader;
  value: Uint8Array;
};

/** Authorization locks stored on a swig, including expired ones. */
export type SwigAuthorizationLocks = {
  /** Id the next created lock will receive. Ids are never reused. */
  nextLockId: number;
  locks: AuthorizationLock[];
};

/**
 * Returns the tail bytes of a swig config account: everything stored after
 * the last role.
 * @param account Decoded swig account
 * @returns tail bytes (empty when the wallet has no tail)
 */
export function getSwigTail(account: SwigAccount): Uint8Array {
  const rolesBuffer = Uint8Array.from(account.roles_buffer);
  let cursor = 0;

  for (let i = 0; i < account.roles; i++) {
    if (cursor + POSITION_LENGTH > rolesBuffer.length) {
      throw new Error('Invalid swig account: role position out of bounds');
    }
    const position = getPositionDecoder().decode(
      rolesBuffer.subarray(cursor, cursor + POSITION_LENGTH),
    );
    if (
      position.boundary < cursor + POSITION_LENGTH ||
      position.boundary > rolesBuffer.length
    ) {
      throw new Error('Invalid swig account: role boundary out of bounds');
    }
    cursor = position.boundary;
  }

  return rolesBuffer.slice(cursor);
}

/**
 * Parses every entry in a swig tail without validating the entry kinds or
 * values. Use the typed readers below when reading account state.
 * @param tail Tail bytes, see {@link getSwigTail}
 * @returns tail entries in stored order
 */
export function decodeSwigTail(tail: Uint8Array): SwigTailEntry[] {
  const entries: SwigTailEntry[] = [];
  let cursor = 0;

  while (cursor < tail.length) {
    if (cursor + TAIL_HEADER_LENGTH > tail.length) {
      throw new Error('Invalid swig tail: truncated entry header');
    }
    const header = getSwigTailHeaderDecoder().decode(
      tail.subarray(cursor, cursor + TAIL_HEADER_LENGTH),
    );
    const end = cursor + TAIL_HEADER_LENGTH + header.valueLen;
    if (end > tail.length) {
      throw new Error('Invalid swig tail: truncated entry value');
    }
    entries.push({
      header,
      value: tail.slice(cursor + TAIL_HEADER_LENGTH, end),
    });
    cursor = end;
  }

  return entries;
}

/** Applies the on-chain tail invariants before exposing typed wallet state. */
function validatedTailEntries(tail: Uint8Array): SwigTailEntry[] {
  const entries = decodeSwigTail(tail);
  const seen = new Set<number>();

  for (const entry of entries) {
    const { header, value } = entry;
    if (seen.has(header.kind)) {
      throw new Error(`Duplicate swig tail kind: ${header.kind}`);
    }
    seen.add(header.kind);
    if (header.version !== TAIL_VERSION) {
      throw new Error(`Unsupported swig tail version: ${header.version}`);
    }

    switch (header.kind) {
      case SwigTailKind.RentClaimer:
        if (
          value.length !== RENT_CLAIMER_VALUE_LENGTH ||
          header.payload.some((byte) => byte !== 0)
        ) {
          throw new Error('Invalid rent claimer tail layout');
        }
        break;
      case SwigTailKind.ActiveSubAccountCount:
        if (
          value.length !== ACTIVE_SUB_ACCOUNT_COUNT_VALUE_LENGTH ||
          header.payload.some((byte) => byte !== 0) ||
          value.subarray(4).some((byte) => byte !== 0)
        ) {
          throw new Error('Invalid active sub-account count tail layout');
        }
        break;
      case SwigTailKind.ConfigSeedPrefix:
        if (
          value.length === 0 ||
          value.length > MAX_CONFIG_SEED_PREFIX_LENGTH ||
          header.payload.some((byte) => byte !== 0)
        ) {
          throw new Error('Invalid config seed prefix tail layout');
        }
        break;
      case SwigTailKind.AuthorizationLocks: {
        if (
          value.length % AUTHORIZATION_LOCK_LENGTH !== 0 ||
          value.length > MAX_AUTHORIZATION_LOCKS * AUTHORIZATION_LOCK_LENGTH
        ) {
          throw new Error('Invalid authorization lock tail length');
        }
        const payload = Uint8Array.from(header.payload);
        const nextLockId = new DataView(
          payload.buffer,
          payload.byteOffset,
          payload.byteLength,
        ).getUint32(0, true);
        const decoder = getAuthorizationLockDecoder();
        let previousId = -1;
        for (
          let offset = 0;
          offset < value.length;
          offset += AUTHORIZATION_LOCK_LENGTH
        ) {
          const lock = decoder.decode(
            value.subarray(offset, offset + AUTHORIZATION_LOCK_LENGTH),
          );
          if (
            lock.amount === 0n ||
            lock.lockId <= previousId ||
            lock.lockId >= nextLockId
          ) {
            throw new Error('Invalid authorization lock tail record');
          }
          previousId = lock.lockId;
        }
        break;
      }
      default:
        throw new Error(`Unknown swig tail kind: ${header.kind}`);
    }
  }

  return entries;
}

/**
 * Decodes the authorization locks stored in a swig tail after validating every
 * entry against the program's stored-state contract.
 * @param tail Tail bytes, see {@link getSwigTail}
 * @returns `{ nextLockId, locks }`; `{ nextLockId: 0, locks: [] }` when the
 * wallet has never had a lock
 */
export function decodeAuthorizationLocks(
  tail: Uint8Array,
): SwigAuthorizationLocks {
  const entry = validatedTailEntries(tail).find(
    (e) => e.header.kind === SwigTailKind.AuthorizationLocks,
  );
  if (!entry) return { nextLockId: 0, locks: [] };

  const payload = Uint8Array.from(entry.header.payload);
  const nextLockId = new DataView(
    payload.buffer,
    payload.byteOffset,
    payload.byteLength,
  ).getUint32(0, true);

  const decoder = getAuthorizationLockDecoder();
  const locks: AuthorizationLock[] = [];
  for (
    let offset = 0;
    offset < entry.value.length;
    offset += AUTHORIZATION_LOCK_LENGTH
  ) {
    locks.push(
      decoder.decode(
        entry.value.subarray(offset, offset + AUTHORIZATION_LOCK_LENGTH),
      ),
    );
  }

  return { nextLockId, locks };
}

/**
 * Decodes the authorization locks stored on a swig config account.
 * @param account Decoded swig account
 * @returns `{ nextLockId, locks }`
 */
export function getSwigAuthorizationLocks(
  account: SwigAccount,
): SwigAuthorizationLocks {
  return decodeAuthorizationLocks(getSwigTail(account));
}

/**
 * A lock is enforced while `currentSlot < expirySlot`.
 */
export function isAuthorizationLockActive(
  lock: AuthorizationLock,
  currentSlot: bigint,
): boolean {
  return currentSlot < lock.expirySlot;
}

/**
 * Filters locks to those still enforced at `currentSlot`.
 * @param locks Locks, or the result of {@link decodeAuthorizationLocks}
 * @param currentSlot Current slot
 * @returns active locks
 */
export function getActiveAuthorizationLocks(
  locks: AuthorizationLock[] | SwigAuthorizationLocks,
  currentSlot: bigint,
): AuthorizationLock[] {
  const list = Array.isArray(locks) ? locks : locks.locks;
  return list.filter((lock) => isAuthorizationLockActive(lock, currentSlot));
}

/**
 * Check if a lock reserves native SOL (its mint is all zeros).
 */
export function isNativeSolAuthorizationLock(lock: AuthorizationLock): boolean {
  return lock.mint.every((byte) => byte === 0);
}

/**
 * Reads the configured rent claimer from a swig tail.
 * @param tail Tail bytes, see {@link getSwigTail}
 * @returns the rent claimer, or `null` when none is configured
 */
export function decodeRentClaimer(tail: Uint8Array): SolPublicKey | null {
  const entry = validatedTailEntries(tail).find(
    (e) => e.header.kind === SwigTailKind.RentClaimer,
  );
  if (!entry) return null;
  return new SolPublicKey(entry.value);
}
