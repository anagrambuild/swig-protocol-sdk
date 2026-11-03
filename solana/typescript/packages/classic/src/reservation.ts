import { PublicKey } from '@solana/web3.js';
import {
  ReservationV1 as LibReservationV1,
  type CreateReservationArgs,
  type SolInstruction,
  type SolPublicKeyData,
} from '@swig-wallet/lib';

export interface ReservationAddresses {
  commitment: Uint8Array;
  swigAddress: PublicKey;
  swigBump: number;
  walletAddress: PublicKey;
  walletBump: number;
}

/** A reservation package with native Web3.js addresses. */
export class ReservationV1 {
  readonly #reservation: LibReservationV1;

  private constructor(reservation: LibReservationV1) {
    this.#reservation = reservation;
  }

  static create(args: CreateReservationArgs): ReservationV1 {
    return new ReservationV1(LibReservationV1.create(args));
  }

  static fromBytes(
    bytes: Uint8Array,
    expectedProgramId: SolPublicKeyData,
  ): ReservationV1 {
    return new ReservationV1(
      LibReservationV1.fromBytes(bytes, expectedProgramId),
    );
  }

  toBytes(): Uint8Array {
    return this.#reservation.toBytes();
  }

  async addresses(): Promise<ReservationAddresses> {
    const addresses = await this.#reservation.addresses();
    return {
      ...addresses,
      swigAddress: new PublicKey(addresses.swigAddress.toBytes()),
      walletAddress: new PublicKey(addresses.walletAddress.toBytes()),
    };
  }

  /** Use getCreateReservedSwigInstruction for a native Web3.js instruction. */
  createInstruction(payer: SolPublicKeyData): Promise<SolInstruction> {
    return this.#reservation.createInstruction(payer);
  }
}
