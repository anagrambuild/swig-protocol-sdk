import { PublicKey, Transaction } from '@solana/web3.js';
import { ReservationV1 as LibReservationV1 } from '@swig-wallet/lib';
import { expect, expectTypeOf, test } from 'bun:test';
import vectors from '../../lib/tests/reservation/data/reservation-v1.json';
import {
  fetchSwig,
  getCreateReservedSwigInstruction,
  ReservationV1,
  SWIG_PROGRAM_ADDRESS_STRING,
} from '../src';

test('creates and restores native Web3.js addresses for each supported owner', async () => {
  const payer = PublicKey.default;
  for (const vector of vectors) {
    const reservation = ReservationV1.create({
      programId: SWIG_PROGRAM_ADDRESS_STRING,
      authorityType: vector.authorityType,
      publicKey: Buffer.from(vector.publicKeyHex, 'hex'),
    });
    expect(Buffer.from(reservation.toBytes()).toString('hex')).toBe(
      vector.packageHex,
    );
    const restored = ReservationV1.fromBytes(
      reservation.toBytes(),
      SWIG_PROGRAM_ADDRESS_STRING,
    );
    const core = LibReservationV1.fromBytes(
      reservation.toBytes(),
      SWIG_PROGRAM_ADDRESS_STRING,
    );
    const expectedInstruction = await getCreateReservedSwigInstruction({
      reservation: core,
      payer,
    });
    for (const value of [reservation, restored]) {
      const addresses = await value.addresses();
      expectTypeOf(addresses.swigAddress).toEqualTypeOf<
        Parameters<typeof fetchSwig>[1]
      >();
      expectTypeOf(addresses.walletAddress).toEqualTypeOf<PublicKey>();
      expect(addresses.swigAddress).toBeInstanceOf(PublicKey);
      expect(addresses.walletAddress).toBeInstanceOf(PublicKey);
      expect(addresses.swigAddress.equals(new PublicKey(vector.config))).toBe(
        true,
      );
      expect(addresses.walletAddress.toBase58()).toBe(vector.deposit);
      expect(
        await getCreateReservedSwigInstruction({ reservation: value, payer }),
      ).toEqual(expectedInstruction);
      await expect(
        getCreateReservedSwigInstruction({
          reservation: value,
          payer: addresses.walletAddress,
        }),
      ).rejects.toThrow('payer must be external');
    }
  }
});

test('restores a Rust package and builds an instruction usable in Web3.js', async () => {
  const packageBytes = Buffer.from(
    '010d0ce942e1e7c506e218df0d7df1c52fafdc3529e48d674d1db24c75b54cccbe00000000000000000000000000000000000000000000000000000000000000000100d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a',
    'hex',
  );
  const reservation = ReservationV1.fromBytes(
    packageBytes,
    SWIG_PROGRAM_ADDRESS_STRING,
  );
  const payer = new PublicKey(packageBytes.subarray(67));
  const instruction = await getCreateReservedSwigInstruction({
    reservation,
    payer,
  });
  expect(instruction.programId).toBeInstanceOf(PublicKey);
  expect(instruction.programId.toBase58()).toBe(SWIG_PROGRAM_ADDRESS_STRING);
  expect(Buffer.isBuffer(instruction.data)).toBe(true);
  expect(instruction.data.subarray(2)).toEqual(packageBytes);
  expect(
    instruction.keys.map((meta) => [
      meta.pubkey.toBase58(),
      meta.isSigner,
      meta.isWritable,
    ]),
  ).toEqual([
    ['F9PtypZzCwh4rrgJDGezwXibk1TnpGmfKvq9NLBk84ms', false, true],
    [payer.toBase58(), true, true],
    ['27HrTtgqMiugAqSzGjr5sFBD6GSCKXzydtNV1aFoAXt9', false, true],
    ['11111111111111111111111111111111', false, false],
  ]);
  const transaction = new Transaction({
    feePayer: payer,
    recentBlockhash: PublicKey.default.toBase58(),
  }).add(instruction);
  expect(transaction.compileMessage().header.numRequiredSignatures).toBe(1);
});
