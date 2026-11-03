import { bytesToHex, hexToBytes } from '@noble/curves/abstract/utils';
import { ed25519 } from '@noble/curves/ed25519';
import { p256 } from '@noble/curves/p256';
import { secp256k1 } from '@noble/curves/secp256k1';
import { AccountRole, address } from '@solana/kit';
import { PublicKey } from '@solana/web3.js';
import {
  AuthorityType,
  identifySwigInstruction,
  SwigInstructionDiscriminator,
} from '@swig-wallet/coder';
import { describe, expect, expectTypeOf, test } from 'bun:test';
import { SWIG_PROGRAM_ADDRESS_STRING } from '../../src/consts';
import {
  ReservationV1,
  type CreateReservationArgs,
  type ReservationAddressOptions,
  type ReservationOwnerType,
} from '../../src/reservation';
import { findSwigPdaRaw } from '../../src/utils';
// Canonical swig-wallet interface vectors at 869f5ebbe01a11e102d40e7ac5e5ce4575a8a2d9.
import vectors from './data/reservation-v1.json';

const programId = SWIG_PROGRAM_ADDRESS_STRING;
const publicKey = hexToBytes(
  'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a',
);
const payer = new PublicKey(ed25519.getPublicKey(new Uint8Array(32).fill(7)));

function reserve(addressOptions?: ReservationAddressOptions): ReservationV1 {
  return ReservationV1.create({
    programId,
    authorityType: AuthorityType.Ed25519,
    publicKey,
    addressOptions,
  });
}

describe('reservation V1 cross-language contract', () => {
  test('accepts only direct signing-key owner types', () => {
    expectTypeOf<CreateReservationArgs['authorityType']>().toEqualTypeOf<
      AuthorityType.Ed25519 | AuthorityType.Secp256k1 | AuthorityType.Secp256r1
    >();
    for (const authorityType of [
      AuthorityType.None,
      AuthorityType.Ed25519Session,
      AuthorityType.Secp256k1Session,
      AuthorityType.Secp256r1Session,
      AuthorityType.ProgramExec,
      AuthorityType.ProgramExecSession,
    ] satisfies AuthorityType[]) {
      expect(() =>
        // @ts-expect-error unsupported owners must fail at compile time and runtime
        ReservationV1.create({ programId, authorityType, publicKey }),
      ).toThrow('requires a direct');
    }
  });

  for (const vector of vectors) {
    test(`matches Rust package, commitment, addresses and instruction for owner ${vector.authorityType}`, async () => {
      const reservation = ReservationV1.create({
        programId,
        authorityType: vector.authorityType,
        publicKey: hexToBytes(vector.publicKeyHex),
      });
      expect(bytesToHex(reservation.toBytes())).toBe(vector.packageHex);
      const addresses = await reservation.addresses();
      expect(bytesToHex(addresses.commitment)).toBe(vector.commitmentHex);
      expect(addresses.swigAddress.toBase58()).toBe(vector.config);
      expect(addresses.swigBump).toBe(vector.configBump);
      expect(addresses.walletAddress.toBase58()).toBe(vector.deposit);
      expect(addresses.walletBump).toBe(vector.depositBump);
      expect(
        (await findSwigPdaRaw(addresses.commitment))[0].toBase58(),
      ).not.toBe(vector.config);

      const restored = ReservationV1.fromBytes(
        reservation.toBytes(),
        programId,
      );
      expect((await restored.addresses()).walletAddress.toBase58()).toBe(
        vector.deposit,
      );
      const instruction = (
        await restored.createInstruction(payer)
      ).toKitInstruction();
      expect(instruction.programAddress).toBe(address(programId));
      expect(bytesToHex(Uint8Array.from(instruction.data))).toBe(
        `1800${vector.packageHex}`,
      );
      expect(identifySwigInstruction(instruction)).toBe(
        SwigInstructionDiscriminator.CreateReservedV1,
      );
      expect(instruction.accounts).toEqual([
        { address: address(vector.config), role: AccountRole.WRITABLE },
        {
          address: address(payer.toBase58()),
          role: AccountRole.WRITABLE_SIGNER,
        },
        { address: address(vector.deposit), role: AccountRole.WRITABLE },
        {
          address: address('11111111111111111111111111111111'),
          role: AccountRole.READONLY,
        },
      ]);
    });

    test(`rejects noncanonical packages for owner ${vector.authorityType}`, () => {
      const bytes = hexToBytes(vector.packageHex);
      for (let length = 0; length < bytes.length; length++) {
        expect(() =>
          ReservationV1.fromBytes(bytes.subarray(0, length), programId),
        ).toThrow();
      }
      expect(() =>
        ReservationV1.fromBytes(new Uint8Array([...bytes, 0]), programId),
      ).toThrow('Invalid reservation V1 package');
      for (const version of [0, 2, 255]) {
        const bad = bytes.slice();
        bad[0] = version;
        expect(() => ReservationV1.fromBytes(bad, programId)).toThrow(
          'Invalid reservation V1 package',
        );
      }
      for (const tag of [0, 2, 4, 6, 7, 8, 0x101, 65535]) {
        const bad = bytes.slice();
        new DataView(bad.buffer).setUint16(65, tag, true);
        expect(() => ReservationV1.fromBytes(bad, programId)).toThrow(
          'requires a direct',
        );
      }
      expect(() => ReservationV1.fromBytes(bytes, payer)).toThrow(
        'differs from the expected program',
      );
      const unaligned = new Uint8Array([0, ...bytes]);
      expect(
        ReservationV1.fromBytes(unaligned.subarray(1), programId).toBytes(),
      ).toEqual(bytes);
    });
  }

  test('indices map to exactly the Rust salt encoding and custom salts are preserved', async () => {
    const first = await reserve().addresses();
    for (const index of [0, 1, 255, 256, 0xffffffff]) {
      const salt = new Uint8Array(32);
      new DataView(salt.buffer).setUint32(28, index, true);
      const indexed = reserve({ accountIndex: index });
      expect(indexed.toBytes()).toEqual(reserve({ salt }).toBytes());
      if (index === 0) expect(indexed.toBytes()).toEqual(reserve().toBytes());
      else
        expect((await indexed.addresses()).walletAddress.toBase58()).not.toBe(
          first.walletAddress.toBase58(),
        );
    }
    const salt = new Uint8Array(32).fill(0xa5);
    expect(reserve({ salt }).toBytes().subarray(33, 65)).toEqual(salt);
    for (const accountIndex of [-1, 0x100000000, 0.5, NaN, Infinity]) {
      expect(() => reserve({ accountIndex })).toThrow('index must be a u32');
    }
    expect(() => reserve({ salt: new Uint8Array(31) })).toThrow('32-byte salt');
    // Runtime callers can bypass TypeScript's mutually exclusive options.
    // @ts-expect-error salt and index cannot be combined
    expect(() => reserve({ salt, accountIndex: 0 })).toThrow('either');
  });

  test('normalizes valid SEC1 constructor input but rejects expanded imports', () => {
    for (const type of [
      AuthorityType.Secp256k1,
      AuthorityType.Secp256r1,
    ] satisfies ReservationOwnerType[]) {
      const curve = type === AuthorityType.Secp256k1 ? secp256k1 : p256;
      const compressed = curve.ProjectivePoint.BASE.toRawBytes(true);
      const expanded = curve.ProjectivePoint.BASE.toRawBytes(false);
      const args = { programId, authorityType: type };
      const expected = ReservationV1.create({ ...args, publicKey: compressed });
      expect(
        ReservationV1.create({ ...args, publicKey: expanded }).toBytes(),
      ).toEqual(expected.toBytes());
      if (type === AuthorityType.Secp256k1) {
        expect(
          ReservationV1.create({
            ...args,
            publicKey: expanded.subarray(1),
          }).toBytes(),
        ).toEqual(expected.toBytes());
      } else {
        expect(() =>
          ReservationV1.create({ ...args, publicKey: expanded.subarray(1) }),
        ).toThrow('Invalid reservation owner public key');
      }
      expect(() =>
        ReservationV1.fromBytes(
          new Uint8Array([...expected.toBytes().subarray(0, 67), ...expanded]),
          programId,
        ),
      ).toThrow('Invalid reservation V1 package');
    }
  });

  test('rejects unsupported owners, invalid curve points and small-order Ed25519 keys', () => {
    for (const authorityType of [0, 2, 4, 6, 7, 8]) {
      expect(() =>
        ReservationV1.create({ programId, authorityType, publicKey }),
      ).toThrow('requires a direct');
    }
    const offCurve = PublicKey.findProgramAddressSync(
      [Buffer.from('owner')],
      new PublicKey(programId),
    )[0].toBytes();
    const identity = new Uint8Array(32);
    identity[0] = 1;
    const noncanonical = new Uint8Array(32).fill(255);
    noncanonical[0] = 0xee;
    noncanonical[31] = 0x7f;
    for (const key of [
      new Uint8Array(0),
      new Uint8Array(32),
      identity,
      noncanonical,
      offCurve,
    ]) {
      expect(() =>
        ReservationV1.create({
          programId,
          authorityType: AuthorityType.Ed25519,
          publicKey: key,
        }),
      ).toThrow('Invalid reservation owner public key');
      const bad = reserve().toBytes();
      if (key.length === 32) {
        bad.set(key, 67);
        expect(() => ReservationV1.fromBytes(bad, programId)).toThrow(
          'Invalid reservation owner public key',
        );
      }
    }
    for (const authorityType of [
      AuthorityType.Secp256k1,
      AuthorityType.Secp256r1,
    ] satisfies ReservationOwnerType[]) {
      const key = new Uint8Array(33).fill(255);
      key[0] = 2;
      expect(() =>
        ReservationV1.create({ programId, authorityType, publicKey: key }),
      ).toThrow('Invalid reservation owner public key');
    }
  });

  test('binds owner, program, salt and authority type independently', async () => {
    const original = await reserve().addresses();
    for (const args of [
      { programId: payer, authorityType: AuthorityType.Ed25519, publicKey },
      {
        programId,
        authorityType: AuthorityType.Ed25519,
        publicKey: payer.toBytes(),
      },
      {
        programId,
        authorityType: AuthorityType.Ed25519,
        publicKey,
        addressOptions: { accountIndex: 1 },
      },
    ] satisfies CreateReservationArgs[]) {
      const changed = await ReservationV1.create(args).addresses();
      expect(changed.commitment).not.toEqual(original.commitment);
      expect(changed.walletAddress.toBase58()).not.toBe(
        original.walletAddress.toBase58(),
      );
    }
    // x=6 with even y is valid on both curves: isolate the authority tag.
    const key = new Uint8Array(33);
    key[0] = 2;
    key[32] = 6;
    const k1 = await ReservationV1.create({
      programId,
      authorityType: 3,
      publicKey: key,
    }).addresses();
    const r1 = await ReservationV1.create({
      programId,
      authorityType: 5,
      publicKey: key,
    }).addresses();
    expect(k1.commitment).not.toEqual(r1.commitment);
    expect(k1.walletAddress.toBase58()).not.toBe(r1.walletAddress.toBase58());
  });

  test('keeps package ownership across input, exported bytes and returned instructions', async () => {
    const salt = Buffer.alloc(32);
    const owner = Buffer.from(publicKey);
    const created = ReservationV1.create({
      programId,
      authorityType: 1,
      publicKey: owner,
      addressOptions: { salt },
    });
    salt.fill(1);
    owner.fill(0);
    expect(created.toBytes()).toEqual(reserve().toBytes());
    const backup = Buffer.from(created.toBytes());
    const restored = ReservationV1.fromBytes(backup, programId);
    backup.fill(0);
    restored.toBytes().fill(0);
    const instruction = await restored.createInstruction(payer);
    instruction.data.fill(0);
    expect(restored.toBytes()).toEqual(reserve().toBytes());
    const addresses = await restored.addresses();
    for (const alias of [addresses.swigAddress, addresses.walletAddress]) {
      await expect(restored.createInstruction(alias)).rejects.toThrow(
        'payer must be external',
      );
    }
  });
});
