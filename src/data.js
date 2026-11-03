// VEYRA Data Constants & Clean Utilities
// All mock streams and mockup media removed completely.

export const genres = [
  'All',
  'Action',
  'Adventure',
  'Animation',
  'Comedy',
  'Crime',
  'Documentary',
  'Drama',
  'Fantasy',
  'Horror',
  'Mystery',
  'Romance',
  'Sci-Fi',
  'Thriller',
];

export const popularSearches = [
  'Dead-End Job',
  'The Terminal List',
  'Forgotten Island',
  'Lupin',
  'Tulsa King',
  'Avatar: Seven Havens',
  'Nollywood',
  'Anime English Dubbed',
  'Bet+',
  'K-Drama',
];

export const catalogMovies = [];
export const catalogSeries = [];
export const catalogSections = [];
export const allCatalogItems = [];

export function getRecommendationsFor(item, pool = []) {
  if (!item) return [];
  const source = Array.isArray(pool) && pool.length > 0 ? pool : [];
  const targetId = item.subjectId || item.id;
  const targetGenres = Array.isArray(item.genres) ? item.genres : [];

  return source
    .filter((candidate) => (candidate.subjectId || candidate.id) !== targetId)
    .filter((candidate) => {
      if (item.type && candidate.type && item.type === candidate.type) return true;
      if (candidate.genres && targetGenres.some((g) => candidate.genres.includes(g))) return true;
      return true;
    })
    .slice(0, 10);
}

export function searchCatalog(query, scope = 'ALL', pool = []) {
  const term = String(query || '').trim().toLowerCase();
  if (!term) return [];
  const source = Array.isArray(pool) ? pool : [];

  return source.filter((item) => {
    if (scope === 'MOVIES' && item.type !== 'movie') return false;
    if (scope === 'TV_SERIES' && item.type !== 'series') return false;
    const titleMatch = item.title?.toLowerCase().includes(term);
    const genreMatch = item.genres?.some((g) => g.toLowerCase().includes(term));
    const descMatch = item.description?.toLowerCase().includes(term);
    return titleMatch || genreMatch || descMatch;
  });
}
