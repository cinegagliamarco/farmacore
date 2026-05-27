import { statusForVariation } from './calc-base-product-metrics.step';

const defaults = {
  suspectBelow: -15,
  attentionBelow: 0,
  attentionAbove: 20,
  suspectAbove: 50,
};

describe('statusForVariation', () => {
  it('returns null when variation is null', () => {
    expect(statusForVariation(null, defaults)).toBeNull();
  });

  it('returns SUSPEITA above suspectAbove', () => {
    expect(statusForVariation(51, defaults)).toBe('SUSPEITA');
  });

  it('returns ATENÇÃO at attentionAbove..suspectAbove', () => {
    expect(statusForVariation(20, defaults)).toBe('ATENÇÃO');
    expect(statusForVariation(35, defaults)).toBe('ATENÇÃO');
    expect(statusForVariation(50, defaults)).toBe('ATENÇÃO');
  });

  it('returns OK between attentionBelow and attentionAbove', () => {
    expect(statusForVariation(0, defaults)).toBe('OK');
    expect(statusForVariation(10, defaults)).toBe('OK');
    expect(statusForVariation(19.999, defaults)).toBe('OK');
  });

  it('returns ATENÇÃO between suspectBelow and attentionBelow', () => {
    expect(statusForVariation(-1, defaults)).toBe('ATENÇÃO');
    expect(statusForVariation(-15, defaults)).toBe('ATENÇÃO');
  });

  it('returns SUSPEITA below suspectBelow', () => {
    expect(statusForVariation(-20, defaults)).toBe('SUSPEITA');
  });

  it('honors custom thresholds', () => {
    const tight = {
      suspectBelow: -5,
      attentionBelow: -1,
      attentionAbove: 1,
      suspectAbove: 5,
    };
    expect(statusForVariation(10, tight)).toBe('SUSPEITA');
    expect(statusForVariation(2, tight)).toBe('ATENÇÃO');
    expect(statusForVariation(0, tight)).toBe('OK');
  });
});
