import type { SolPublicKey } from '../../solana';
import type { Authority } from '../abstract';

export interface Ed25519BasedAuthority {
  ed25519PublicKey: SolPublicKey;
}

export function isEd25519BasedAuthority(
  authority: Authority,
): authority is Authority & Ed25519BasedAuthority {
  return 'ed25519PublicKey' in authority;
}

export function getEd25519BasedAuthority(authority: Authority) {
  if (!isEd25519BasedAuthority(authority)) return null;
  return authority;
}
