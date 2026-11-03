import { Router, Request, Response } from 'express';
import { Readable } from 'node:stream';
import {
  fetchHome,
  fetchSearch,
  fetchDetail,
  fetchStream,
  fetchCaptions,
  PROVIDER_HEADERS,
} from './providers/zarhosting';
import {
  normalizeHome,
  normalizeDetail,
  normalizeStream,
  normalizeItem,
} from './normalize';

const router = Router();

// In-memory cache for home payload (3 minutes TTL)
let homeCache: { data: any; timestamp: number } | null = null;
const CACHE_TTL_MS = 3 * 60 * 1000;

// GET /api/veyra/health
router.get('/health', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    provider: 'zarhosting',
    time: new Date().toISOString(),
  });
});

// GET /api/veyra/home
router.get('/home', async (_req: Request, res: Response) => {
  try {
    const now = Date.now();
    if (homeCache && now - homeCache.timestamp < CACHE_TTL_MS) {
      return res.json(homeCache.data);
    }

    const raw = await fetchHome();
    const normalized = normalizeHome(raw);
    homeCache = { data: normalized, timestamp: now };
    return res.json(normalized);
  } catch (error: any) {
    console.error('[API /home error]', error);
    if (homeCache) {
      return res.json(homeCache.data); // Return stale if available
    }
    return res.status(502).json({ error: error.message || 'Failed to fetch home catalog' });
  }
});

// GET /api/veyra/trending
router.get('/trending', async (_req: Request, res: Response) => {
  try {
    const raw = await fetchHome();
    const normalized = normalizeHome(raw);
    const trendingSec =
      normalized.sections.find((s) => s.title.toLowerCase().includes('popular') || s.title.toLowerCase().includes('trending')) ||
      normalized.sections[0];

    return res.json({
      title: trendingSec ? trendingSec.title : 'Trending Now',
      items: trendingSec ? trendingSec.items : [],
    });
  } catch (error: any) {
    console.error('[API /trending error]', error);
    return res.status(502).json({ error: error.message || 'Failed to fetch trending' });
  }
});

// GET /api/veyra/search?q=...&page=...
router.get('/search', async (req: Request, res: Response) => {
  const q = String(req.query.q || '').trim();
  const page = Math.max(1, Number(req.query.page) || 1);

  if (!q) {
    return res.json({ items: [], page: 1, total: 0, hasMore: false });
  }

  try {
    const raw = await fetchSearch(q, page);
    const rawItems = Array.isArray(raw?.items) ? raw.items : [];
    const items = rawItems
      .map((it: any) => normalizeItem(it))
      .filter((it: any) => Boolean(it));

    return res.json({
      query: q,
      page: raw.page || page,
      total: raw.total || items.length,
      totalPages: raw.total_pages || 1,
      hasMore: Boolean(raw.has_more),
      items,
    });
  } catch (error: any) {
    console.error('[API /search error]', error);
    return res.status(502).json({ error: error.message || 'Search failed' });
  }
});

// GET /api/veyra/detail/:detailPath or /api/veyra/detail?path=...
router.get(['/detail/:detailPath', '/detail'], async (req: Request, res: Response) => {
  const detailPath = req.params.detailPath || String(req.query.path || '').trim();

  if (!detailPath) {
    return res.status(400).json({ error: 'detailPath is required' });
  }

  try {
    const raw = await fetchDetail(detailPath);
    const normalized = normalizeDetail(raw);
    return res.json(normalized);
  } catch (error: any) {
    console.error('[API /detail error]', error);
    return res.status(502).json({ error: error.message || 'Failed to fetch detail' });
  }
});

// GET /api/veyra/stream?subject_id=...&detail_path=...&se=...&ep=...
router.get('/stream', async (req: Request, res: Response) => {
  let subjectId = String(req.query.subject_id || req.query.id || '').trim();
  const detailPath = String(req.query.detail_path || req.query.path || '').trim();
  let se = Number(req.query.se ?? 0);
  let ep = Number(req.query.ep ?? 0);

  if (!subjectId && !detailPath) {
    return res.status(400).json({ error: 'subject_id or detail_path is required' });
  }

  try {
    // 1. Fetch title detail if detailPath is available
    let detailRaw: any = null;
    if (detailPath) {
      try {
        detailRaw = await fetchDetail(detailPath);
      } catch (err: any) {
        console.warn('Stream route fetchDetail note:', err.message);
      }
    }

    if (!subjectId && detailRaw?.data?.subject?.subjectId) {
      subjectId = String(detailRaw.data.subject.subjectId);
    }

    // 2. Detect series vs movie from detail
    const isSeries =
      detailRaw?.data?.subject?.subjectType === 2 ||
      (Array.isArray(detailRaw?.data?.resource?.seasons) &&
        detailRaw.data.resource.seasons.length > 0 &&
        detailRaw.data.resource.seasons[0].maxEp > 0);

    // If it's a series and se/ep was 0, default to Season 1 Episode 1
    if (isSeries && se === 0 && ep === 0) {
      se = 1;
      ep = 1;
    }

    // 3. Resolve stream from Zarhosting
    let streamRaw: any = null;
    if (subjectId) {
      try {
        streamRaw = await fetchStream(subjectId, detailPath, se, ep);
      } catch (err: any) {
        console.warn(`Upstream fetchStream note (se=${se}, ep=${ep}):`, err.message);
      }

      // If no sources returned, try alternate indexing (se=1,ep=1 vs se=0,ep=0)
      if ((!streamRaw?.sources || streamRaw.sources.length === 0) && se === 0 && ep === 0) {
        try {
          const retryStream = await fetchStream(subjectId, detailPath, 1, 1);
          if (retryStream?.sources && retryStream.sources.length > 0) {
            streamRaw = retryStream;
            se = 1;
            ep = 1;
          }
        } catch {
          // ignore retry failure
        }
      } else if ((!streamRaw?.sources || streamRaw.sources.length === 0) && se === 1 && ep === 1) {
        try {
          const retryStream = await fetchStream(subjectId, detailPath, 0, 0);
          if (retryStream?.sources && retryStream.sources.length > 0) {
            streamRaw = retryStream;
            se = 0;
            ep = 0;
          }
        } catch {
          // ignore retry failure
        }
      }
    }

    const normalized = streamRaw ? normalizeStream(streamRaw) : { subjectId, se, ep, sources: [] };

    // 4. Attach trailer ONLY if no feature streams exist
    if (normalized.sources.length === 0) {
      const trailerUrl = detailRaw?.data?.subject?.trailer?.videoAddress?.url || '';
      if (trailerUrl) {
        normalized.sources.push({
          label: 'Trailer Preview',
          resolution: 720,
          format: 'MP4',
          url: trailerUrl,
          sizeBytes: detailRaw?.data?.subject?.trailer?.videoAddress?.size || 0,
          duration: detailRaw?.data?.subject?.trailer?.videoAddress?.duration || 0,
          codec: 'h264',
          isTrailer: true,
        });
      }
    }

    return res.json(normalized);
  } catch (error: any) {
    console.error('[API /stream error]', error);
    return res.status(502).json({ error: error.message || 'Failed to resolve stream' });
  }
});

// GET /api/veyra/captions?subject_id=...&detail_path=...&se=...&ep=...
router.get('/captions', async (req: Request, res: Response) => {
  const subjectId = String(req.query.subject_id || req.query.id || '').trim();
  const detailPath = String(req.query.detail_path || req.query.path || '').trim();
  const se = Number(req.query.se ?? 0);
  const ep = Number(req.query.ep ?? 0);

  if (!subjectId || !detailPath) {
    return res.status(400).json({ error: 'subject_id and detail_path are required' });
  }

  try {
    const raw = await fetchCaptions(subjectId, detailPath, se, ep);
    const captions = Array.isArray(raw?.captions)
      ? raw.captions.map((c: any) => ({
          id: c.id || c.lan,
          lan: c.lan,
          lanName: c.lanName,
          url: c.url,
        }))
      : [];

    return res.json({
      subjectId,
      se,
      ep,
      captions,
    });
  } catch (error: any) {
    console.warn('[API /captions warning]', error.message);
    // Non-blocking fallback for captions
    return res.json({ subjectId, se, ep, captions: [] });
  }
});

// GET /api/veyra/media?url=...
// Media streaming proxy with Range support and required Moviebox headers
router.get('/media', async (req: Request, res: Response) => {
  const mediaUrl = String(req.query.url || '').trim();

  if (!mediaUrl) {
    return res.status(400).send('url parameter is required');
  }

  try {
    const fetchHeaders: Record<string, string> = {
      ...PROVIDER_HEADERS,
    };

    if (req.headers.range) {
      fetchHeaders['Range'] = req.headers.range;
    }

    const upstreamRes = await fetch(mediaUrl, {
      headers: fetchHeaders,
    });

    const status = upstreamRes.status;
    res.status(status);

    const forwardHeaders = [
      'content-type',
      'content-length',
      'content-range',
      'accept-ranges',
      'last-modified',
      'etag',
    ];

    for (const h of forwardHeaders) {
      const val = upstreamRes.headers.get(h);
      if (val) {
        res.setHeader(h, val);
      }
    }

    res.setHeader('Access-Control-Allow-Origin', '*');

    if (!upstreamRes.body) {
      return res.end();
    }

    // Convert Web ReadableStream to Node Readable stream for backpressure-managed streaming
    const nodeStream = Readable.fromWeb(upstreamRes.body as any);
    
    req.on('close', () => {
      nodeStream.destroy();
    });

    nodeStream.pipe(res);
  } catch (proxyError: any) {
    console.error('[API /media proxy error]', proxyError.message);
    if (!res.headersSent) {
      res.status(502).send('Media stream proxy error');
    }
  }
});

export default router;
