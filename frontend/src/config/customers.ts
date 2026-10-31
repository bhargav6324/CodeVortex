/**
 * Customer IDs for the picker. v1 has no customer-list API, so this list is maintained by hand.
 *
 * The backend dataset has customers C001–C050 (confirmed by the backend team). The labelled
 * ones are the agreed demo scenarios. `mockOnly` entries exist only in the MSW mock backend
 * (edge cases and failure simulations); `realOnly` entries exist only on the real backend.
 * Labels are UI-only and are never sent to the API.
 */
export type CustomerGroup = 'scenario' | 'blocked' | 'mock' | 'dataset'

export interface KnownCustomer {
  id: string
  label: string
  group: CustomerGroup
  mockOnly?: boolean
  realOnly?: boolean
}

/** Picker section titles, in display order. */
export const CUSTOMER_GROUP_LABELS: Record<CustomerGroup, string> = {
  scenario: 'Demo scenarios',
  blocked: 'Blocked scenarios',
  mock: 'Mock-only edge cases',
  dataset: 'Other dataset customers',
}

/** Agreed demo scenarios — present on the real backend and mirrored in the mock. */
const SCENARIO_CUSTOMERS: KnownCustomer[] = [
  { id: 'C001', label: 'Consistent customer', group: 'scenario' },
  { id: 'C004', label: 'Loyalty reward', group: 'scenario' },
  { id: 'C008', label: 'Declining activity', group: 'scenario' },
  { id: 'C011', label: 'Dormant', group: 'scenario' },
  { id: 'C014', label: 'Payment reminder', group: 'scenario' },
  { id: 'C007', label: 'No consent', group: 'blocked' },
  { id: 'C019', label: 'Disputed bill', group: 'blocked' },
  { id: 'C023', label: 'Missing data', group: 'blocked' },
  { id: 'C036', label: 'Channel blocked', group: 'blocked' },
]

/** Extra edge cases that only the mock backend simulates. */
const MOCK_ONLY_CUSTOMERS: KnownCustomer[] = [
  { id: 'MOCK_UNKNOWN_BILL', label: 'Unknown bill', group: 'mock', mockOnly: true },
  { id: 'MOCK_EXPIRED_OFFER', label: 'Expired offer', group: 'mock', mockOnly: true },
  { id: 'MOCK_DUPLICATE', label: 'Duplicate outreach', group: 'mock', mockOnly: true },
  { id: 'MOCK_FREQUENCY', label: 'Contact limit', group: 'mock', mockOnly: true },
  { id: 'MOCK_STALE', label: 'Stale data on approve', group: 'mock', mockOnly: true },
  { id: 'MOCK_INJECTION', label: 'Unsafe customer data', group: 'mock', mockOnly: true },
  { id: 'MOCK_AI_TIMEOUT', label: 'AI timeout (1st try)', group: 'mock', mockOnly: true },
  { id: 'MOCK_AI_DOWN', label: 'AI service down', group: 'mock', mockOnly: true },
]

/** The rest of the real dataset (C001–C050), unlabelled. */
const scenarioIds = new Set(SCENARIO_CUSTOMERS.map((c) => c.id))
const OTHER_REAL_CUSTOMERS: KnownCustomer[] = Array.from({ length: 50 }, (_, i) => `C${String(i + 1).padStart(3, '0')}`)
  .filter((id) => !scenarioIds.has(id))
  .map((id) => ({ id, label: 'Dataset customer', group: 'dataset', realOnly: true }))

export const KNOWN_CUSTOMERS: KnownCustomer[] = [...SCENARIO_CUSTOMERS, ...MOCK_ONLY_CUSTOMERS, ...OTHER_REAL_CUSTOMERS]

/** Customers to offer for the current mode. */
export function customersFor(useMocks: boolean): KnownCustomer[] {
  return KNOWN_CUSTOMERS.filter((c) => (useMocks ? !c.realOnly : !c.mockOnly))
}
