// VEYRA Client API Layer
// Communicates strictly with VEYRA API endpoints (/api/veyra/*)

const BASE_URL = import.meta.env.VITE_VEYRA_API_BASE_URL || '';

async function request(endpoint, params = {}) {
  const url = new URL(`${BASE_URL}${endpoint}`, window.location.origin);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') {
      url.searchParams.set(k, String(v));
    }
  });

  const response = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `API request failed with status ${response.status}`);
  }

  return response.json();
}

export async function fetchCatalogHome() {
  return request('/api/veyra/home');
}

export async function fetchTrending() {
  return request('/api/veyra/trending');
}

export async function searchTitles(query, page = 1) {
  if (!query || !query.trim()) {
    return { items: [], page: 1, total: 0, hasMore: false };
  }
  return request('/api/veyra/search', { q: query.trim(), page });
}

export async function fetchTitleDetail(detailPath) {
  if (!detailPath) throw new Error('detailPath is required');
  return request('/api/veyra/detail', { path: detailPath });
}

export async function resolveStream(subjectId, detailPath, se = 0, ep = 0) {
  if (!subjectId && !detailPath) throw new Error('subject_id or detail_path is required');
  const params = { se, ep };
  if (subjectId) params.subject_id = subjectId;
  if (detailPath) params.detail_path = detailPath;
  return request('/api/veyra/stream', params);
}

export async function resolveCaptions(subjectId, detailPath, se = 0, ep = 0) {
  if (!subjectId && !detailPath) return { captions: [] };
  const params = { se, ep };
  if (subjectId) params.subject_id = subjectId;
  if (detailPath) params.detail_path = detailPath;
  return request('/api/veyra/captions', params).catch(() => ({ captions: [] }));
}

export function getMediaProxyUrl(rawUrl) {
  if (!rawUrl) return '';
  return `${BASE_URL}/api/veyra/media?url=${encodeURIComponent(rawUrl)}`;
}
