import type { EntityManager } from 'typeorm';
import { ClassificationsService } from './classifications.service';

const rows = [
  { id: 'a', name: 'Genéricos', parentId: null, visible: true },
  { id: 'b', name: 'Similares', parentId: null, visible: true },
  { id: 'a1', name: 'Antibióticos', parentId: 'a', visible: true },
  { id: 'a2', name: 'Analgésicos', parentId: 'a', visible: false },
];

const makeEm = (result: unknown): EntityManager =>
  ({ query: jest.fn().mockResolvedValue(result) }) as unknown as EntityManager;

describe('ClassificationsService.grouped', () => {
  it('nests each root with its direct children only', async () => {
    const out = await new ClassificationsService().grouped(makeEm(rows));
    expect(out).toEqual([
      {
        id: 'a',
        name: 'Genéricos',
        parentId: null,
        visible: true,
        children: [rows[2], rows[3]],
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
