const ZARHOSTING_BASE_URL =
  process.env.ZARHOSTING_BASE_URL || 'https://movieapi.zarhosting.dpdns.org/api/public/v1';

export const PROVIDER_HEADERS = {
  'User-Agent': 'MovieBox/1.8.2 (Linux; Android 12; Build/SQ3A.220705.004)',
  Referer: 'https://moviebox.ph/',
  Origin: 'https://moviebox.ph',
  Accept: '*/*',
};

async function zarRequest(endpoint: string, params: Record<string, string | number | undefined> = {}) {
  const url = new URL(`${ZARHOSTING_BASE_URL}${endpoint}`);
  for (const [key, val] of Object.entries(params)) {
    if (val !== undefined && val !== null) {
      url.searchParams.set(key, String(val));
    }
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(url.toString(), {
      headers: PROVIDER_HEADERS,
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`Zarhosting request failed [${res.status}]: ${res.statusText}`);
    }

    return await res.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function fetchHome() {
  return zarRequest('/home');
}

export async function fetchSearch(query: string, page = 1) {
  return zarRequest('/search', { q: query, page });
}

export async function fetchDetail(detailPath: string) {
  return zarRequest(`/detail/${encodeURIComponent(detailPath)}`);
}

export async function fetchStream(subjectId: string, detailPath: string, se: number, ep: number) {
  return zarRequest(`/stream/${encodeURIComponent(subjectId)}`, {
    detail_path: detailPath,
    se,
    ep,
  });
}

export async function fetchCaptions(subjectId: string, detailPath: string, se: number, ep: number) {
  return zarRequest(`/stream/${encodeURIComponent(subjectId)}/captions`, {
    detail_path: detailPath,
    se,
    ep,
  });
}
