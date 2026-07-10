import { ruleParticipates } from './pricing-rules.util';

// Predicado compartilhado entre sugestão (ruleContext) e apply (revalidate):
// drift entre os dois mudaria qual regra precifica vs qual valida o piso.
describe('ruleParticipates', () => {
  it('regra sem escopo participa de qualquer loja e da visão global', () => {
    expect(ruleParticipates({ storeIds: [] }, 's1')).toBe(true);
    expect(ruleParticipates({ storeIds: [] }, null)).toBe(true);
  });

  it('regra escopada participa só das lojas listadas — e nunca da visão global', () => {
    expect(ruleParticipates({ storeIds: ['s1', 's2'] }, 's1')).toBe(true);
    expect(ruleParticipates({ storeIds: ['s1', 's2'] }, 's3')).toBe(false);
    expect(ruleParticipates({ storeIds: ['s1'] }, null)).toBe(false);
  });
});
