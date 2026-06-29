import { buildClassificationIndex } from './classification-index';

const rows = [
  { id: 'root', name: 'Perfumaria', parentId: null },
  { id: 'mid', name: 'Dermocosmeticos', parentId: 'root' },
  { id: 'leaf', name: 'Massivo', parentId: 'mid' },
  { id: 'other', name: 'Medicamentos', parentId: null },
];

describe('buildClassificationIndex', () => {
  const index = buildClassificationIndex(rows);

  it('isUnder matches self and ancestors', () => {
    expect(index.isUnder('leaf', 'leaf')).toBe(true);
    expect(index.isUnder('leaf', 'mid')).toBe(true);
    expect(index.isUnder('leaf', 'root')).toBe(true);
    expect(index.isUnder('leaf', 'other')).toBe(false);
    expect(index.isUnder(null, 'root')).toBe(false);
  });

  it('idsOverlap detects hierarchical overlap', () => {
    expect(index.idsOverlap('mid', 'leaf')).toBe(true);
    expect(index.idsOverlap('root', 'mid')).toBe(true);
    expect(index.idsOverlap('root', 'other')).toBe(false);
  });

  it('expandSubtree collects descendants', () => {
    expect([...index.expandSubtree(['mid'])].sort()).toEqual(['leaf', 'mid']);
    expect([...index.expandSubtree(['root'])].sort()).toEqual([
      'leaf',
      'mid',
      'root',
    ]);
  });

  it('depthById reflects tree level', () => {
    expect(index.depthById.get('root')).toBe(0);
    expect(index.depthById.get('mid')).toBe(1);
    expect(index.depthById.get('leaf')).toBe(2);
  });
});
