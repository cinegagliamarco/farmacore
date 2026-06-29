import type { EntityManager } from 'typeorm';
import { ClassificationEntity } from '../../database/entities/tenant/classification.entity';
import { ClassificationsService } from './classifications.service';

const rows = [
  { id: 'a', name: 'Genéricos', parentId: null, visible: true },
  { id: 'b', name: 'Similares', parentId: null, visible: true },
  { id: 'a1', name: 'Antibióticos', parentId: 'a', visible: true },
  { id: 'a2', name: 'Analgésicos', parentId: 'a', visible: false },
  { id: 'a1x', name: 'Penicilinas', parentId: 'a1', visible: true },
];

const makeEm = (result: ClassificationEntity[]): EntityManager => {
  const find = jest.fn().mockResolvedValue(result);
  return {
    getRepository: jest.fn().mockReturnValue({ find }),
  } as unknown as EntityManager;
};

describe('ClassificationsService.grouped', () => {
  it('nests roots with children up to three levels', async () => {
    const out = await new ClassificationsService().grouped(
      makeEm(rows as ClassificationEntity[]),
    );
    expect(out).toEqual([
      {
        id: 'a',
        name: 'Genéricos',
        parentId: null,
        visible: true,
        children: [
          {
            id: 'a1',
            name: 'Antibióticos',
            parentId: 'a',
            visible: true,
            children: [{ id: 'a1x', name: 'Penicilinas', parentId: 'a1', visible: true, children: [] }],
          },
          { id: 'a2', name: 'Analgésicos', parentId: 'a', visible: false, children: [] },
        ],
      },
      {
        id: 'b',
        name: 'Similares',
        parentId: null,
        visible: true,
        children: [],
      },
    ]);
  });

  it('returns an empty list when there are no classifications', async () => {
    expect(await new ClassificationsService().grouped(makeEm([]))).toEqual([]);
  });
});
