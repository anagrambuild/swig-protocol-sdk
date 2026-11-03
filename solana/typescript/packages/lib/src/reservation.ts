import { ed25519 } from '@noble/curves/ed25519';
import { p256 } from '@noble/curves/p256';
import { secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { getProgramDerivedAddress } from '@solana/kit';
import {
  AuthorityType,
  SwigInstructionDiscriminator,
} from '@swig-wallet/coder';
import { SYSTEM_PROGRAM_ADDRESS_STRING } from './consts';
import {
  SolAccountMeta,
  SolInstruction,
  SolPublicKey,
  type SolPublicKeyData,
} from './solana';
import { uint8ArraysEqual } from './utils';

const DOMAIN = new TextEncoder().encode('rsv');
const HEADER_LENGTH = 67;

/** Defaults to index zero. An explicit salt and index are mutually exclusive. */
export type ReservationAddressOptions =
  | { accountIndex: number; salt?: never }
  | { salt: Uint8Array; accountIndex?: never };

/** Direct signing-key owners supported by reservation V1. */
export type ReservationOwnerType =
  | AuthorityType.Ed25519
  | AuthorityType.Secp256k1
  | AuthorityType.Secp256r1;

export interface CreateReservationArgs {
  programId: SolPublicKeyData;
  authorityType: ReservationOwnerType;
  publicKey: Uint8Array;
  addressOptions?: ReservationAddressOptions;
}

export interface ReservationAddresses {
  commitment: Uint8Array;
  swigAddress: SolPublicKey;
  swigBump: number;
  walletAddress: SolPublicKey;
  walletBump: number;
}

/** Local, immutable activation package for a direct signing-key owner. */
export class ReservationV1 {
  #packageBytes: Uint8Array;

  private constructor(bytes: Uint8Array, expectedProgramId: SolPublicKeyData) {
    if (
      !(bytes instanceof Uint8Array) ||
      (bytes.length !== 99 && bytes.length !== 100) ||
      bytes[0] !== 1
    ) {
      throw new Error('Invalid reservation V1 package');
    }
    const expected = new SolPublicKey(expectedProgramId).toBytes();
    if (!uint8ArraysEqual(bytes.subarray(1, 33), expected)) {
      throw new Error(
        'Reservation program ID differs from the expected program',
      );
    }
    const authorityType = new DataView(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength,
    ).getUint16(65, true);
    if (
      (authorityType === AuthorityType.Ed25519 && bytes.length !== 99) ||
      ((authorityType === AuthorityType.Secp256k1 ||
        authorityType === AuthorityType.Secp256r1) &&
        bytes.length !== 100)
    ) {
      throw new Error('Invalid reservation V1 package');
    }
    const publicKey = bytes.subarray(HEADER_LENGTH);
    const canonical = canonicalPublicKey(authorityType, publicKey);
    if (!uint8ArraysEqual(publicKey, canonical)) {
      throw new Error(
        'Reservation package requires a canonical owner public key',
      );
    }
    this.#packageBytes = Uint8Array.from(bytes);
  }

  /** Derives the canonical package without RPC, signing, or a random salt. */
  static create(args: CreateReservationArgs): ReservationV1 {
    const program = new SolPublicKey(args.programId);
    const publicKey = canonicalPublicKey(args.authorityType, args.publicKey);
    const salt = new Uint8Array(32);
    const options = args.addressOptions;
    if (options !== undefined) {
      if (options === null || typeof options !== 'object') {
        throw new Error('Invalid reservation address options');
      }
      if ('salt' in options) {
        if (
          'accountIndex' in options ||
          !(options.salt instanceof Uint8Array) ||
          options.salt.length !== 32
        ) {
          throw new Error(
            'Reservation requires either a u32 index or a 32-byte salt',
          );
        }
        salt.set(options.salt);
      } else {
        const index = options.accountIndex;
        if (!Number.isInteger(index) || index < 0 || index > 0xffffffff) {
          throw new Error('Reservation account index must be a u32');
        }
        new DataView(salt.buffer).setUint32(28, index, true);
      }
    }
    const bytes = new Uint8Array(HEADER_LENGTH + publicKey.length);
    bytes[0] = 1;
    bytes.set(program.toBytes(), 1);
    bytes.set(salt, 33);
    new DataView(bytes.buffer).setUint16(65, args.authorityType, true);
    bytes.set(publicKey, HEADER_LENGTH);
    return new ReservationV1(bytes, program);
  }

  /** Imports one exact canonical package for the caller-selected program. */
  static fromBytes(
    bytes: Uint8Array,
    expectedProgramId: SolPublicKeyData,
  ): ReservationV1 {
    return new ReservationV1(bytes, expectedProgramId);
  }

  /** A detached copy to persist; modifying it cannot change this reservation. */
  toBytes(): Uint8Array {
    return Uint8Array.from(this.#packageBytes);
  }

  /** Derives the config and deposit wallet using their canonical PDA bumps. */
  async addresses(): Promise<ReservationAddresses> {
    const programAddress = new SolPublicKey(
      this.#packageBytes.slice(1, 33),
    ).toAddress();
    const commitment = sha256
      .create()
      .update(DOMAIN)
      .update(this.#packageBytes)
      .digest();
    const [swigAddress, swigBump] = await getProgramDerivedAddress({
      programAddress,
      seeds: [DOMAIN, commitment],
    });
    const [walletAddress, walletBump] = await getProgramDerivedAddress({
      programAddress,
      seeds: [
        new TextEncoder().encode('swig-wallet-address'),
        new SolPublicKey(swigAddress).toBytes(),
      ],
    });
    return {
      commitment,
      swigAddress: new SolPublicKey(swigAddress),
      swigBump,
      walletAddress: new SolPublicKey(walletAddress),
      walletBump,
    };
  }

  /**
   * Builds CreateReservedV1. Only the external payer signs; role zero is fixed
   * to the committed owner with All. Include a 600,000-unit transaction compute
   * budget for P-256 owners. This method does not submit a transaction.
   */
  async createInstruction(payer: SolPublicKeyData): Promise<SolInstruction> {
    const payerKey = new SolPublicKey(
      Uint8Array.from(new SolPublicKey(payer).toBytes()),
    );
    const addresses = await this.addresses();
    if (
      payerKey.toBase58() === addresses.swigAddress.toBase58() ||
      payerKey.toBase58() === addresses.walletAddress.toBase58()
    ) {
      throw new Error(
        'Reservation payer must be external to the reserved wallet',
      );
    }
    const data = new Uint8Array(2 + this.#packageBytes.length);
    new DataView(data.buffer).setUint16(
      0,
      SwigInstructionDiscriminator.CreateReservedV1,
      true,
    );
    data.set(this.#packageBytes, 2);
    return new SolInstruction({
      program: new SolPublicKey(this.#packageBytes.slice(1, 33)),
      data,
      accounts: [
        SolAccountMeta.writable(addresses.swigAddress),
        SolAccountMeta.writableSigner(payerKey),
        SolAccountMeta.writable(addresses.walletAddress),
        SolAccountMeta.readonly(
          new SolPublicKey(SYSTEM_PROGRAM_ADDRESS_STRING),
        ),
      ],
    });
  }
}

function canonicalPublicKey(type: AuthorityType, key: Uint8Array): Uint8Array {
  if (
    type !== AuthorityType.Ed25519 &&
    type !== AuthorityType.Secp256k1 &&
    type !== AuthorityType.Secp256r1
  ) {
    throw new Error(
      'Reservation V1 requires a direct Ed25519, secp256k1, or secp256r1 owner',
    );
  }
  try {
    if (!(key instanceof Uint8Array))
      throw new Error('Expected public key bytes');
    if (type === AuthorityType.Ed25519) {
      const point = ed25519.ExtendedPoint.fromHex(key, false);
      const canonical = point.toRawBytes();
      if (point.isSmallOrder() || !uint8ArraysEqual(key, canonical)) {
        throw new Error('Noncanonical or small-order Ed25519 key');
      }
      return canonical;
    }
    let sec1 = key;
    if (type === AuthorityType.Secp256k1 && key.length === 64) {
      sec1 = new Uint8Array([4, ...key]);
    }
    if (
      !(
        (sec1.length === 33 && (sec1[0] === 2 || sec1[0] === 3)) ||
        (sec1.length === 65 && sec1[0] === 4)
      )
    ) {
      throw new Error('Invalid SEC1 encoding');
    }
    const curve = type === AuthorityType.Secp256k1 ? secp256k1 : p256;
    return curve.ProjectivePoint.fromHex(sec1).toRawBytes(true);
  } catch (cause) {
    throw new Error('Invalid reservation owner public key', { cause });
  }
}
