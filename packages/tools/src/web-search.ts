import { search, SafeSearchType } from 'duck-duck-scrape';

export interface SearchResult {
  title: string;
  url: string;
  description: string;
}

export interface WebSearchOutput {
  query: string;
  results: SearchResult[];
}

/**
 * Search the web via DuckDuckGo. No API key required.
 * Returns up to `limit` organic results.
 */
export async function webSearch(
  query: string,
  limit = 5
): Promise<WebSearchOutput> {
  const response = await search(query, {
    safeSearch: SafeSearchType.OFF,
  });

  const results: SearchResult[] = (response.results ?? [])
    .slice(0, limit)
    .map((r) => ({
      title: r.title,
      url: r.url,
      description: r.description ?? '',
    }));

  return { query, results };
}
