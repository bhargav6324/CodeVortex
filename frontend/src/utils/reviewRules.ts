/**
 * Which review buttons to enable, mirroring the contract's state table.
 * This only decides what the UI offers; the backend still enforces every rule.
 *
 *   ready_for_review -> edit, approve, reject
 *   blocked          -> reject (and edit only if a message exists); never approve
 *   approved / rejected / mock_sent -> final, no actions
 */
import type { Draft } from '../types/contract'

export interface AllowedActions {
  edit: boolean
  approve: boolean
  reject: boolean
  /** Why approve is unavailable, shown next to the disabled button. */
  approveReason: string | null
  editReason: string | null
  isFinal: boolean
}

export function getAllowedActions(draft: Draft, stale: boolean): AllowedActions {
  const isFinal = draft.status === 'approved' || draft.status === 'rejected' || draft.status === 'mock_sent'
  if (isFinal) {
    return { edit: false, approve: false, reject: false, approveReason: null, editReason: null, isFinal }
  }

  const hasMessage = draft.message !== null
  let approveReason: string | null = null
  if (draft.status === 'blocked') approveReason = 'Blocked drafts cannot be approved.'
  else if (stale) approveReason = 'Customer data or policy changed. Generate a new draft.'
  else if (!hasMessage) approveReason = 'There is no message to approve.'

  return {
    edit: hasMessage,
    approve: approveReason === null,
    reject: true,
    approveReason,
    editReason: hasMessage ? null : 'There is no message to edit.',
    isFinal,
  }
}
