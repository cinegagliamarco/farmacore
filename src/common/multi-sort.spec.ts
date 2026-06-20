import {
  buildMultiSortClause,
  parseSortDirectionList,
  parseSortList,
} from './multi-sort';

describe('parseSortList', () => {
  it('returns undefined for null/empty', () => {
    expect(parseSortList(undefined)).toBeUndefined();
    expect(parseSortList(null)).toBeUndefined();
    expect(parseSortList('')).toBeUndefined();
  });

  it('wraps single string into one-item array', () => {
    expect(parseSortList('status')).toEqual(['status']);
  });

  it('splits comma-separated string', () => {
    expect(parseSortList('status,margin,cost')).toEqual([
      'status',
      'margin',
      'cost',
    ]);
  });

  it('flattens repeated query params (string[])', () => {
    expect(parseSortList(['status', 'margin'])).toEqual(['status', 'margin']);
  });

  it('handles mixed: array of comma-separated strings', () => {
    expect(parseSortList(['status,margin', 'cost'])).toEqual([
      'status',
      'margin',
      'cost',
    ]);
  });

  it('trims whitespace and drops empties (e.g. "a,, ,b")', () => {
    expect(parseSortList('a,, ,b')).toEqual(['a', 'b']);
  });

  it('returns undefined when result is empty after filtering', () => {
    expect(parseSortList(',,,')).toBeUndefined();
    expect(parseSortList([])).toBeUndefined();
  });
});

describe('parseSortDirectionList', () => {
  it('uppercases each entry', () => {
    expect(parseSortDirectionList('desc,asc')).toEqual(['DESC', 'ASC']);
  });

  it('returns undefined for null/empty (consistent with parseSortList)', () => {
    expect(parseSortDirectionList(undefined)).toBeUndefined();
    expect(parseSortDirectionList('')).toBeUndefined();
  });

  it('handles array input', () => {
    expect(parseSortDirectionList(['DESC', 'asc'])).toEqual(['DESC', 'ASC']);
  });
});

describe('buildMultiSortClause', () => {
  const columnMap: Record<string, string> = {
    status: 'p.status',
    margin: 'p.margin',
    cost: 'p.cost',
  };
  const fallback = 'p.ean ASC';

  it('returns fallback when sortBy is undefined/empty', () => {
    expect(
      buildMultiSortClause(undefined, undefined, columnMap, fallback),
    ).toBe(fallback);
    expect(buildMultiSortClause([], undefined, columnMap, fallback)).toBe(
      fallback,
    );
  });

  it('builds single-key clause', () => {
    expect(
      buildMultiSortClause(['status'], ['DESC'], columnMap, fallback),
    ).toBe('p.status DESC');
  });

  it('builds multi-key clause, positional direction', () => {
    expect(
      buildMultiSortClause(
        ['status', 'margin'],
        ['DESC', 'ASC'],
        columnMap,
        fallback,
      ),
    ).toBe('p.status DESC, p.margin ASC');
  });

  it('defaults missing directions to ASC', () => {
    expect(
      buildMultiSortClause(
        ['status', 'margin', 'cost'],
        ['DESC'],
        columnMap,
        fallback,
      ),
    ).toBe('p.status DESC, p.margin ASC, p.cost ASC');
  });

  it('ignores keys outside the whitelist', () => {
    expect(
      buildMultiSortClause(
        ['hacker_col', 'status'],
        ['DESC', 'ASC'],
        columnMap,
        fallback,
      ),
    ).toBe('p.status ASC');
  });

  it('returns fallback when all keys are invalid', () => {
    expect(
      buildMultiSortClause(
        ['nope', 'still_nope'],
        ['DESC'],
        columnMap,
        fallback,
      ),
    ).toBe(fallback);
  });

  it('treats any non-DESC direction as ASC (defense-in-depth vs invalid input)', () => {
    expect(
      buildMultiSortClause(
        ['status'],
        ['asc' as unknown as 'ASC'],
        columnMap,
        fallback,
      ),
    ).toBe('p.status ASC');
  });
});
