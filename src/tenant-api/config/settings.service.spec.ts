import type { EntityManager } from 'typeorm';
import { StatusSettingsEntity } from '../../database/entities/core/status-settings.entity';
import { SettingsService } from './settings.service';

const DEFAULTS = {
  suspectBelow: -15,
  attentionBelow: 0,
  attentionAbove: 20,
  suspectAbove: 50,
};

const makeEm = (opts: {
  settingsRow?: StatusSettingsEntity | null;
}): { em: EntityManager; findOne: jest.Mock; save: jest.Mock } => {
  let stored = opts.settingsRow ?? null;
  const findOne = jest.fn(async ({ where }: { where: { tenantId?: string } }) => {
    if (where.tenantId === 't1') return stored;
    return null;
  });
  const save = jest.fn(async (row: StatusSettingsEntity) => {
    stored = { ...(stored ?? {}), ...row } as StatusSettingsEntity;
    return stored;
  });
  const em = {
    query: jest.fn((sql: string) => {
      if (sql.includes('FROM core.tenant')) return [{ id: 't1' }];
      return [];
    }),
    getRepository: jest.fn().mockReturnValue({
      findOne,
      save,
      create: (value: StatusSettingsEntity) => value,
    }),
  } as unknown as EntityManager;
  return { em, findOne, save };
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
      settingsRow: {
        tenantId: 't1',
        settings: { suspectAbove: 99 },
      } as unknown as StatusSettingsEntity,
    });
    expect(await new SettingsService().getVariationStatus(em, 's')).toEqual({
      ...DEFAULTS,
      suspectAbove: 99,
    });
  });
});

describe('SettingsService.updateVariationStatus', () => {
  it('merges only the sent fields and INSERTs when no row exists', async () => {
    const { em, save } = makeEm({});
    const out = await new SettingsService().updateVariationStatus(em, 's', {
      attentionAbove: 30,
    });
    expect(out).toEqual({ ...DEFAULTS, attentionAbove: 30 });
    expect(save).toHaveBeenCalledWith({
      tenantId: 't1',
      settings: out,
    });
  });

  it('UPDATEs the existing row by id', async () => {
    const { em, save } = makeEm({
      settingsRow: {
        id: 'row-9',
        tenantId: 't1',
        settings: { suspectAbove: 99 },
      } as unknown as StatusSettingsEntity,
    });
    const out = await new SettingsService().updateVariationStatus(em, 's', {
      suspectBelow: -20,
    });
    expect(out).toEqual({ ...DEFAULTS, suspectBelow: -20, suspectAbove: 99 });
    expect(save).toHaveBeenCalledWith({
      id: 'row-9',
      tenantId: 't1',
      settings: out,
    });
  });
});
