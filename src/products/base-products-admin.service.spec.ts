import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { BaseProductsAdminService } from './base-products-admin.service';

const build = () => {
  const query = jest.fn().mockResolvedValue([]);
  const update = jest.fn().mockResolvedValue({ affected: 1 });
  const execute = jest.fn().mockResolvedValue({ affected: 1 });
  const qb = {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    execute,
  };
  const dataSource = {
    manager: {
      query,
      getRepository: jest.fn(() => ({
        update,
        createQueryBuilder: jest.fn(() => qb),
      })),
    },
  } as unknown as DataSource;
  return {
    service: new BaseProductsAdminService(dataSource),
    query,
    update,
    qb,
    execute,
  };
};

describe('BaseProductsAdminService.list', () => {
  it('searches ean/description/active_ingredient with one param and paginates', async () => {
    const { service, query } = build();
    query
      .mockResolvedValueOnce([{ count: '7' }])
      .mockResolvedValueOnce([{ ean: '1' }]);
    const out = await service.list({
      search: 'dipi',
      missingActiveIngredient: 'true',
      generic: 'true',
      page: 2,
      perPage: 10,
    });
    const [countSql, countParams] = query.mock.calls[0] as [string, unknown[]];
    expect(countSql).toContain(
      '(bp.ean::text ILIKE $1 OR bp.description ILIKE $1 OR bp.active_ingredient ILIKE $1)',
    );
    expect(countSql).toContain('bp.active_ingredient IS NULL');
    expect(countSql).toContain('bp.generic = $2');
    expect(countParams).toEqual(['%dipi%', true]);
    const [, rowParams] = query.mock.calls[1] as [string, unknown[]];
    expect(rowParams).toEqual(['%dipi%', true, 10, 10]);
    expect(out).toEqual({
      rows: [{ ean: '1' }],
      count: 7,
      page: 2,
      perPage: 10,
    });
  });

  it('omits WHERE when no filter is given', async () => {
    const { service, query } = build();
    query.mockResolvedValueOnce([{ count: '0' }]).mockResolvedValueOnce([]);
    await service.list({});
    const [countSql] = query.mock.calls[0] as [string];
    expect(countSql).not.toContain('WHERE');
    const [, rowParams] = query.mock.calls[1] as [string, unknown[]];
    expect(rowParams).toEqual([50, 0]);
  });
});

describe('BaseProductsAdminService.update', () => {
  it('rejects an empty patch', async () => {
    const { service } = build();
    await expect(service.update('789', {})).rejects.toThrow(
      BadRequestException,
    );
  });

  it('trims the princípio ativo and turns blank into null', async () => {
    const { service, update } = build();
    await service.update('789', { activeIngredient: '  ' });
    expect(update).toHaveBeenCalledWith(
      { ean: '789' },
      { activeIngredient: null },
    );
  });

  it('404s when the ean is unknown', async () => {
    const { service, update } = build();
    update.mockResolvedValue({ affected: 0 });
    await expect(
      service.update('789', { activeIngredient: 'DIPIRONA' }),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('BaseProductsAdminService.rename', () => {
  it('renames across all EANs and reports the count', async () => {
    const { service, qb, execute } = build();
    execute.mockResolvedValue({ affected: 3 });
    const out = await service.rename('DIPIRONA SODICA', ' DIPIRONA ');
    expect(qb.set).toHaveBeenCalledWith({ activeIngredient: 'DIPIRONA' });
    expect(qb.where).toHaveBeenCalledWith('active_ingredient = :from', {
      from: 'DIPIRONA SODICA',
    });
    expect(out).toEqual({
      from: 'DIPIRONA SODICA',
      to: 'DIPIRONA',
      updated: 3,
    });
  });

  it('404s when nothing uses the name', async () => {
    const { service, execute } = build();
    execute.mockResolvedValue({ affected: 0 });
    await expect(service.rename('X', 'Y')).rejects.toThrow(NotFoundException);
  });

  it('rejects a blank target name', async () => {
    const { service, execute } = build();
    await expect(service.rename('X', '   ')).rejects.toThrow(
      BadRequestException,
    );
    expect(execute).not.toHaveBeenCalled();
  });
});
