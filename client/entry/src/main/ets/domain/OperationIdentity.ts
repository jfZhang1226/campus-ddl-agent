import { sha256Hex } from '../data/storage/Sha256';

/** Frozen identity, never a capability. Old applied receipts retain their original stored IDs. */
export function taskProposalOperationId(proposalId: string): string {
  return 'operation-' + sha256Hex(JSON.stringify(['t16.screen-confirm.v1', proposalId])).slice(0, 32);
}
