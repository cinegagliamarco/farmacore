/**
 * Ciclo de vida da execução de uma regra (mora na regra, não no report — o
 * único lugar que distingue PARTIALLY_SUCCEEDED). RUNNING é o guard de
 * concorrência do POST /execute.
 */
export enum OfferBookRuleStatus {
  IDLE = 'IDLE',
  RUNNING = 'RUNNING',
  SUCCEEDED = 'SUCCEEDED',
  PARTIALLY_SUCCEEDED = 'PARTIALLY_SUCCEEDED',
  ERRORED = 'ERRORED',
}
