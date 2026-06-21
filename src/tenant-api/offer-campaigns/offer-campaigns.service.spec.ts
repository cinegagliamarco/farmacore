import type { EntityManager } from 'typeorm';
import { OfferCampaignsService } from './offer-campaigns.service';

const makeEm = (rows: Array<{ externalId: string; name: string }>) => {
  const qb = {
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(rows),
  };
  const em = {
    getRepository: jest.fn(() => ({ createQueryBuilder: () => qb })),
  } as unknown as EntityManager;
  return { em, qb };
};

describe('OfferCampaignsService.list', () => {
  it('coerces externalId to a numeric id and keeps the name', async () => {
    const { em } = makeEm([
      { externalId: '10', name: 'Caderno A' },
      { externalId: '22', name: 'Caderno B' },
    ]);
    expect(await new OfferCampaignsService().list(em)).toEqual([
      { id: 10, name: 'Caderno A' },
      { id: 22, name: 'Caderno B' },
    ]);
  });

  it('filters out inactive, deleted and out-of-window campaigns in SQL', async () => {
    const { em, qb } = makeEm([]);
    await new OfferCampaignsService().list(em);
    expect(qb.where).toHaveBeenCalledWith('c.active = true');
    expect(qb.andWhere).toHaveBeenCalledWith('c.deletedAt IS NULL');
    expect(qb.andWhere).toHaveBeenCalledWith(
      '(c.startDate IS NULL OR c.startDate <= :now)',
    );
    expect(qb.andWhere).toHaveBeenCalledWith(
      '(c.expirationDate IS NULL OR c.expirationDate >= :now)',
      expect.objectContaining({ now: expect.any(Date) }),
    );
    expect(qb.getMany).toHaveBeenCalled();
  });
});
