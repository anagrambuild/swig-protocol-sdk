import {
  AuthorityType,
  getPositionDecoder,
  POSITION_LENGTH,
  type Position,
} from '@swig-wallet/coder';
import { Actions } from '../actions';
import {
  getRoleAuthority,
  SessionBasedAuthority,
  TokenBasedAuthority,
  type Authority,
} from '../authority';
import { SolPublicKey, type SolPublicKeyData } from '../solana';

export class Role implements RoleInfo {
  private constructor(
    public readonly swigAddress: SolPublicKey,
    private readonly position: Position,
    public readonly authority: Authority,
    public readonly actions: Actions,
    public readonly swigId: Uint8Array,
  ) {}

  static from(
    swigAddress: SolPublicKeyData,
    position: Position,
    roleData: Uint8Array,
    swigId: Uint8Array,
  ) {
    const { actions, authority } = deserializeRoleData(position, roleData);
    return new Role(
      new SolPublicKey(swigAddress),
      position,
      authority,
      actions,
      swigId,
    );
  }

  get authorityType() {
    return this.position.authorityType;
  }

  /**
   * role id
   */
  get id() {
    return this.position.id;
  }

  info = (): RoleInfo => {
    return { id: this.id, authorityType: this.authorityType };
  };

  /**
   * Check if the role has a session based authority
   * @returns `boolean`
   */
  isSessionBased = (): this is SessionBasedRole => {
    return this.authority instanceof SessionBasedAuthority;
  };

  /**
   * Check if the role has a token based authority
   * @returns `boolean`
   */
  isTokenBased = (): this is TokenBasedRole => {
    return this.authority instanceof TokenBasedAuthority;
  };
}

export function deserializeRoles(
  swigAddress: SolPublicKeyData,
  rolesBuffer: Uint8Array,
  count: number,
  swigId: Uint8Array,
): Role[] {
  let cursor = 0;
  const roles: Role[] = [];

  for (let i = 0; i < count; i++) {
    const positionRaw = rolesBuffer.slice(cursor, cursor + POSITION_LENGTH);
    const position = getPositionDecoder().decode(positionRaw);

    cursor += POSITION_LENGTH;

    const roleData = rolesBuffer.slice(cursor, position.boundary);

    roles.push(Role.from(swigAddress, position, roleData, swigId));

    cursor = position.boundary;
  }

  return roles;
}

export function deserializeRoleData(position: Position, roleData: Uint8Array) {
  const authorityData = roleData.slice(0, position.authorityLen);
  const rawActions = roleData.slice(position.authorityLen);

  const authority = getRoleAuthority(position.authorityType, authorityData);
  const actions = Actions.from(rawActions, position.numActions);

  return { position, authority, actions };
}

export type SessionBasedRole = Role & { authority: SessionBasedAuthority };

export type TokenBasedRole = Role & { authority: TokenBasedAuthority };

export type RoleInfo = {
  id: number;
  authorityType: AuthorityType;
};
