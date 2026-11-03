import {
  address,
  appendTransactionMessageInstruction,
  createTransactionMessage,
  getAddressDecoder,
  pipe,
  setTransactionMessageFeePayer,
  type Address,
} from '@solana/kit';
import { ReservationV1 as LibReservationV1 } from '@swig-wallet/lib';
import { expect, expectTypeOf, test } from 'bun:test';
import vectors from '../../lib/tests/reservation/data/reservation-v1.json';
import {
  fetchSwig,
  getCreateReservedSwigInstruction,
  ReservationV1,
  SWIG_PROGRAM_ADDRESS_STRING,
} from '../src';

test('creates and restores native Kit addresses for each supported owner', async () => {
  const payer = address('11111111111111111111111111111111');
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
      expectTypeOf(addresses.walletAddress).toEqualTypeOf<Address>();
      expect(addresses.swigAddress).toBe(address(vector.config));
      expect(addresses.walletAddress).toBe(address(vector.deposit));
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

test('restores a Rust package and builds an instruction usable in Kit', async () => {
  const packageBytes = Buffer.from(
    '010d0ce942e1e7c506e218df0d7df1c52fafdc3529e48d674d1db24c75b54cccbe00000000000000000000000000000000000000000000000000000000000000000100d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a',
    'hex',
  );
  const reservation = ReservationV1.fromBytes(
    packageBytes,
    SWIG_PROGRAM_ADDRESS_STRING,
  );
  const payer = getAddressDecoder().decode(packageBytes.subarray(67));
  const instruction = await getCreateReservedSwigInstruction({
    reservation,
    payer,
  });
  expect(instruction.programAddress).toBe(address(SWIG_PROGRAM_ADDRESS_STRING));
  expect(Uint8Array.from(instruction.data).subarray(2)).toEqual(
    Uint8Array.from(packageBytes),
  );
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (message) => setTransactionMessageFeePayer(payer, message),
    (message) => appendTransactionMessageInstruction(instruction, message),
  );
  expect(message.instructions).toEqual([instruction]);
  expect(instruction.accounts.map((meta) => meta.role)).toEqual([1, 3, 1, 0]);
});
