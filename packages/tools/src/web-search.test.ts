import { describe, test, expect, vi, afterEach } from 'vitest';
import { webSearch } from './web-search.js';

// Mock duck-duck-scrape at the module level
vi.mock('duck-duck-scrape', () => ({
  SafeSearchType: { OFF: -2 },
  search: vi.fn(),
}));

import { search } from 'duck-duck-scrape';
const mockSearch = vi.mocked(search);

const FAKE_RESULTS = [
  { title: 'Result One', url: 'https://example.com/1', description: 'First result' },
  { title: 'Result Two', url: 'https://example.com/2', description: 'Second result' },
  { title: 'Result Three', url: 'https://example.com/3', description: 'Third result' },
  { title: 'Result Four', url: 'https://example.com/4', description: 'Fourth result' },
  { title: 'Result Five', url: 'https://example.com/5', description: 'Fifth result' },
  { title: 'Result Six', url: 'https://example.com/6', description: 'Sixth result' },
];

afterEach(() => {
  vi.clearAllMocks();
});

describe('webSearch', () => {
  test('returns query and results with correct shape', async () => {
    mockSearch.mockResolvedValue({ results: FAKE_RESULTS.slice(0, 3) } as never);

    const output = await webSearch('typescript tutorial');

    expect(output.query).toBe('typescript tutorial');
    expect(output.results).toHaveLength(3);
    expect(output.results[0]).toEqual({
      title: 'Result One',
      url: 'https://example.com/1',
      description: 'First result',
    });
  });

  test('respects limit parameter — returns at most limit results', async () => {
    mockSearch.mockResolvedValue({ results: FAKE_RESULTS } as never);

    const output = await webSearch('something', 3);

    expect(output.results).toHaveLength(3);
  });

  test('returns fewer results than limit when fewer are available', async () => {
    mockSearch.mockResolvedValue({ results: FAKE_RESULTS.slice(0, 2) } as never);

    const output = await webSearch('rare query', 5);

    expect(output.results).toHaveLength(2);
  });

  test('returns empty results when search returns nothing', async () => {
    mockSearch.mockResolvedValue({ results: [] } as never);

    const output = await webSearch('no results here');

    expect(output.results).toEqual([]);
  });

  test('handles missing results field gracefully', async () => {
    mockSearch.mockResolvedValue({} as never);

    const output = await webSearch('edge case');

    expect(output.results).toEqual([]);
  });

  test('fills missing description with empty string', async () => {
    mockSearch.mockResolvedValue({
      results: [{ title: 'No Desc', url: 'https://x.com', description: undefined }],
    } as never);

    const output = await webSearch('test');

    expect(output.results[0].description).toBe('');
  });

  test('propagates search errors to caller', async () => {
    mockSearch.mockRejectedValue(new Error('network failure'));

    await expect(webSearch('error case')).rejects.toThrow('network failure');
  });
});
