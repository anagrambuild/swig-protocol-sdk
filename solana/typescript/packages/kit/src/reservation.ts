import { type Address } from '@solana/kit';
import {
  ReservationV1 as LibReservationV1,
  type CreateReservationArgs,
  type SolInstruction,
  type SolPublicKeyData,
} from '@swig-wallet/lib';

export interface ReservationAddresses {
  commitment: Uint8Array;
  swigAddress: Address;
  swigBump: number;
  walletAddress: Address;
  walletBump: number;
}

/** A reservation package with native Solana Kit addresses. */
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
      swigAddress: addresses.swigAddress.toAddress(),
      walletAddress: addresses.walletAddress.toAddress(),
    };
  }

  /** Use getCreateReservedSwigInstruction for a native Kit instruction. */
  createInstruction(payer: SolPublicKeyData): Promise<SolInstruction> {
    return this.#reservation.createInstruction(payer);
  }
}
