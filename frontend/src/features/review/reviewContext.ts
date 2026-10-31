/** Shared review workflow (context + hook). Lives above the tabs so switching tabs keeps state. */
import { createContext, useContext } from 'react'
import type { useReviewWorkflow } from '../../hooks/useReviewWorkflow'

export type ReviewWorkflow = ReturnType<typeof useReviewWorkflow>

export const ReviewContext = createContext<ReviewWorkflow | null>(null)

export function useReview(): ReviewWorkflow {
  const v = useContext(ReviewContext)
  if (v === null) throw new Error('useReview must be used inside AppProviders')
  return v
}
