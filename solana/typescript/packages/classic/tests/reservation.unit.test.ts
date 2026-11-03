import { PublicKey, Transaction } from '@solana/web3.js';
import { expect, test } from 'bun:test';
import {
  getCreateReservedSwigInstruction,
  ReservationV1,
  SWIG_PROGRAM_ADDRESS_STRING,
} from '../src';

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
