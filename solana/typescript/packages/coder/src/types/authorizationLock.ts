import {
  combineCodec,
  fixDecoderSize,
  fixEncoderSize,
  getBytesDecoder,
  getBytesEncoder,
  getStructDecoder,
  getStructEncoder,
  getU32Decoder,
  getU32Encoder,
  getU64Decoder,
  getU64Encoder,
  type Codec,
  type Decoder,
  type Encoder,
  type ReadonlyUint8Array,
} from '@solana/kit';

/** Serialized size of one stored {@link AuthorizationLock}. */
export const AUTHORIZATION_LOCK_LENGTH = 88;

/** Mint value stored for locks on the wallet address's native SOL balance. */
export const NATIVE_SOL_LOCK_MINT: ReadonlyUint8Array = new Uint8Array(32);

/**
 * A reservation of `amount` in `assetAccount` until `expirySlot`, held by
 * `roleId`. Stored in the swig config account's authorization-lock tail entry.
 *
 * Locks act like card authorization holds: other roles (`All` included) may
 * not spend the account below the amount reserved by locks they do not hold,
 * while the holder may spend its reserved funds. That spending captures the
 * holder's locks by lowering `amount`, and is charged to its limits then.
 */
export type AuthorizationLock = {
  /** Swig wallet address (native SOL) or a token account it owns. */
  assetAccount: ReadonlyUint8Array;
  /** Token mint, or 32 zero bytes for native SOL. */
  mint: ReadonlyUint8Array;
  /**
   * Amount still reserved, in base units. Falls as the holder spends; a
   * fully captured lock stays stored with amount 0 and is inactive.
   */
  amount: bigint;
  /** First slot at which the lock no longer applies. */
  expirySlot: bigint;
  /** Role that created and holds the lock; it may spend and release it. */
  roleId: number;
  /** Wallet-unique, never-reused lock identifier. */
  lockId: number;
};

export type AuthorizationLockArgs = Omit<
  AuthorizationLock,
  'amount' | 'expirySlot'
> & {
  amount: number | bigint;
  expirySlot: number | bigint;
};

export function getAuthorizationLockEncoder(): Encoder<AuthorizationLockArgs> {
  return getStructEncoder([
    ['assetAccount', fixEncoderSize(getBytesEncoder(), 32)],
    ['mint', fixEncoderSize(getBytesEncoder(), 32)],
    ['amount', getU64Encoder()],
    ['expirySlot', getU64Encoder()],
    ['roleId', getU32Encoder()],
    ['lockId', getU32Encoder()],
  ]);
}

export function getAuthorizationLockDecoder(): Decoder<AuthorizationLock> {
  return getStructDecoder([
    ['assetAccount', fixDecoderSize(getBytesDecoder(), 32)],
    ['mint', fixDecoderSize(getBytesDecoder(), 32)],
    ['amount', getU64Decoder()],
    ['expirySlot', getU64Decoder()],
    ['roleId', getU32Decoder()],
    ['lockId', getU32Decoder()],
  ]);
}

export function getAuthorizationLockCodec(): Codec<
  AuthorizationLockArgs,
  AuthorizationLock
> {
  return combineCodec(
    getAuthorizationLockEncoder(),
    getAuthorizationLockDecoder(),
  );
}
