import {
  address,
  appendTransactionMessageInstruction,
  createTransactionMessage,
  getAddressDecoder,
  pipe,
  setTransactionMessageFeePayer,
} from '@solana/kit';
import { expect, test } from 'bun:test';
import {
  getCreateReservedSwigInstruction,
  ReservationV1,
  SWIG_PROGRAM_ADDRESS_STRING,
} from '../src';

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
