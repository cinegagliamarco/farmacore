import type { EntityManager } from 'typeorm';
import { SettingsService } from './settings.service';

const DEFAULTS = {
  suspectBelow: -15,
  attentionBelow: 0,
  attentionAbove: 20,
  suspectAbove: 50,
};

/** Dispatches em.query by SQL: tenant lookup, status_settings select, writes. */
const makeEm = (opts: {
  settingsRow?: unknown[];
  existingRow?: unknown[];
}): { em: EntityManager; query: jest.Mock } => {
  const query = jest.fn((sql: string) => {
    if (sql.includes('FROM core.tenant')) return [{ id: 't1' }];
    if (sql.includes('SELECT settings')) return opts.settingsRow ?? [];
    if (sql.includes('SELECT id FROM core.status_settings'))
      return opts.existingRow ?? [];
    return [];
  });
  return { em: { query } as unknown as EntityManager, query };
};

describe('SettingsService.getVariationStatus', () => {
  it('returns the defaults when no row exists', async () => {
    const { em } = makeEm({});
    expect(await new SettingsService().getVariationStatus(em, 's')).toEqual(
      DEFAULTS,
    );
  });

  it('overlays the stored partial settings on top of the defaults', async () => {
    const { em } = makeEm({
      settingsRow: [{ settings: { suspectAbove: 99 } }],
    });
    expect(await new SettingsService().getVariationStatus(em, 's')).toEqual({
      ...DEFAULTS,
      suspectAbove: 99,
    });
  });
});

describe('SettingsService.updateVariationStatus', () => {
  it('merges only the sent fields and INSERTs when no row exists', async () => {
    const { em, query } = makeEm({ existingRow: [] });
    const out = await new SettingsService().updateVariationStatus(em, 's', {
      attentionAbove: 30,
    });
    expect(out).toEqual({ ...DEFAULTS, attentionAbove: 30 });
    const insert = query.mock.calls.find(([sql]) =>
      sql.includes('INSERT INTO core.status_settings'),
    );
    expect(insert?.[1]).toEqual(['t1', JSON.stringify(out)]);
  });

  it('UPDATEs the existing row by id', async () => {
    const { em, query } = makeEm({
      settingsRow: [{ settings: { suspectAbove: 99 } }],
      existingRow: [{ id: 'row-9' }],
    });
    const out = await new SettingsService().updateVariationStatus(em, 's', {
      suspectBelow: -20,
    });
    expect(out).toEqual({ ...DEFAULTS, suspectBelow: -20, suspectAbove: 99 });
    const update = query.mock.calls.find(([sql]) =>
      sql.includes('UPDATE core.status_settings'),
    );
    expect(update?.[1]).toEqual([JSON.stringify(out), 'row-9']);
  });
});
