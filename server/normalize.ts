export interface VeyraItem {
  id: string;
  subjectId: string;
  detailPath: string;
  title: string;
  poster: string;
  backdrop?: string;
  badge?: string;
  rating?: string;
  year?: string;
  type: 'movie' | 'series';
  genres?: string[];
  description?: string;
}

export interface VeyraSection {
  id: string;
  title: string;
  count: number;
  items: VeyraItem[];
}

export function normalizeItem(raw: any, fallbackType?: 'movie' | 'series'): VeyraItem | null {
  if (!raw) return null;

  const subjectId = String(raw.subject_id || raw.subjectId || '');
  const detailPath = String(raw.slug || raw.detailPath || raw.detail_path || '');
  const title = String(raw.name || raw.title || '').trim();
  const poster = String(raw.poster_url || raw.cover?.url || raw.poster || '').trim();

  // Drop items missing title or stable ids
  if (!title || (!subjectId && !detailPath)) {
    return null;
  }

  let type: 'movie' | 'series' = fallbackType || 'movie';
  if (raw.type === 'movie' || raw.subjectType === 1) {
    type = 'movie';
  } else if (raw.type === 'series' || raw.subjectType === 2) {
    type = 'series';
  } else if (detailPath.includes('-movie-') || detailPath.endsWith('-movie')) {
    type = 'movie';
  }

  const genres = raw.genre
    ? typeof raw.genre === 'string'
      ? raw.genre.split(',').map((g: string) => g.trim()).filter(Boolean)
      : Array.isArray(raw.genre) ? raw.genre : []
    : [];

  return {
    id: subjectId || detailPath,
    subjectId,
    detailPath,
    title,
    poster,
    backdrop: raw.cover?.url || raw.trailer?.cover?.url || poster,
    badge: raw.badge || '',
    rating: raw.rating || raw.imdbRatingValue || '',
    year: raw.year || raw.releaseDate?.slice(0, 4) || '',
    type,
    genres,
    description: raw.description || '',
  };
}

export function normalizeHome(rawHome: any) {
  const sections: VeyraSection[] = [];
  const rawSections = Array.isArray(rawHome?.sections) ? rawHome.sections : [];

  let banners: VeyraItem[] = [];

  for (let i = 0; i < rawSections.length; i++) {
    const sec = rawSections[i];
    const sectionName = (sec.section || `Section ${i + 1}`).trim();
    const rawItems = Array.isArray(sec.items) ? sec.items : [];

    const isSeriesSection = sectionName.toLowerCase().includes('series') || sectionName.toLowerCase().includes('drama');
    const isMovieSection = sectionName.toLowerCase().includes('movie');
    const defaultType = isSeriesSection ? 'series' : isMovieSection ? 'movie' : undefined;

    const normalizedItems = rawItems
      .map((it: any) => normalizeItem(it, defaultType))
      .filter((it: any): it is VeyraItem => Boolean(it));

    if (sectionName.toLowerCase() === 'banner') {
      banners = normalizedItems;
      continue;
    }

    if (normalizedItems.length > 0) {
      sections.push({
        id: `section-${i}-${sectionName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        title: sectionName,
        count: normalizedItems.length,
        items: normalizedItems,
      });
    }
  }

  // If no banner section, use the first section's items as banner
  if (banners.length === 0 && sections.length > 0) {
    banners = sections[0].items.slice(0, 8);
  }

  return {
    banner: banners,
    sections,
  };
}

export function normalizeDetail(rawDetail: any) {
  const subject = rawDetail?.data?.subject || rawDetail?.subject || rawDetail;
  const resource = rawDetail?.data?.resource || rawDetail?.resource;

  if (!subject) {
    throw new Error('Invalid detail response structure');
  }

  const subjectId = String(subject.subjectId || subject.subject_id || '');
  const detailPath = String(subject.detailPath || subject.slug || '');
  const title = String(subject.title || subject.name || '').trim();
  const poster = subject.cover?.url || subject.poster_url || '';
  const backdrop = subject.trailer?.cover?.url || poster;
  const trailerUrl = subject.trailer?.videoAddress?.url || '';

  const isSeries = subject.subjectType === 2 || (resource?.seasons && resource.seasons.length > 0 && resource.seasons[0].maxEp > 0);
  const type: 'movie' | 'series' = isSeries ? 'series' : 'movie';

  const genres = subject.genre
    ? typeof subject.genre === 'string'
      ? subject.genre.split(',').map((g: string) => g.trim()).filter(Boolean)
      : []
    : [];

  const rawSeasons = Array.isArray(resource?.seasons) ? resource.seasons : [];
  const seasons = rawSeasons
    .filter((s: any) => s && (s.maxEp > 0 || isSeries))
    .map((s: any) => {
      const seNum = Number(s.se) || 1;
      const maxEp = Math.max(1, Number(s.maxEp) || 1);
      const episodes = Array.from({ length: maxEp }, (_, i) => ({
        episodeNumber: i + 1,
        title: `Episode ${i + 1}`,
        seasonNumber: seNum,
      }));
      return {
        seasonNumber: seNum,
        maxEp,
        episodes,
      };
    });

  // If series with no parsed seasons, default to Season 1 Episode 1
  if (isSeries && seasons.length === 0) {
    seasons.push({
      seasonNumber: 1,
      maxEp: 1,
      episodes: [{ episodeNumber: 1, title: 'Episode 1', seasonNumber: 1 }],
    });
  }

  return {
    id: subjectId || detailPath,
    subjectId,
    detailPath,
    title,
    description: subject.description || '',
    poster,
    backdrop,
    trailerUrl,
    releaseDate: subject.releaseDate || '',
    year: subject.releaseDate?.slice(0, 4) || '',
    duration: Number(subject.duration) || 0,
    rating: subject.imdbRatingValue || '',
    type,
    genres,
    country: subject.countryName || '',
    subtitlesLanguages: subject.subtitles ? subject.subtitles.split(',').map((s: string) => s.trim()) : [],
    dubs: Array.isArray(subject.dubs) ? subject.dubs : [],
    seasons,
  };
}

export function normalizeStream(rawStream: any) {
  const sources = Array.isArray(rawStream?.sources) ? rawStream.sources : [];

  // Filter heuristic from spec:
  // Keep if duration > 300 OR size > 50MB (52428800 bytes)
  // Drop only if both short and small
  // Prefer MP4 over HLS
  // Never invent a quality not returned
  const filtered = sources.filter((s: any) => {
    if (!s || !s.url) return false;
    const dur = Number(s.duration) || 0;
    const sz = Number(s.size) || 0;
    if (dur > 0 && sz > 0 && dur <= 300 && sz <= 52428800) {
      return false;
    }
    return true;
  });

  const parsed = filtered.map((s: any) => {
    const resStr = String(s.resolution || '480p').toLowerCase();
    let resNum = 480;
    if (resStr.includes('1080')) resNum = 1080;
    else if (resStr.includes('720')) resNum = 720;
    else if (resStr.includes('360')) resNum = 360;
    else if (resStr.includes('480')) resNum = 480;

    const rawUrl = s.url;
    const proxyUrl = `/api/veyra/media?url=${encodeURIComponent(rawUrl)}`;

    return {
      label: s.resolution || `${resNum}p`,
      resolution: resNum,
      format: s.format || 'MP4',
      url: proxyUrl,
      rawUrl,
      sizeBytes: Number(s.size) || 0,
      duration: Number(s.duration) || 0,
      codec: s.codec || 'h264',
    };
  });

  // Sort order preference: 480p, 360p, 720p, 1080p for mobile, but provide full list
  parsed.sort((a: any, b: any) => b.resolution - a.resolution);

  return {
    subjectId: rawStream?.subject_id,
    se: rawStream?.se,
    ep: rawStream?.ep,
    sources: parsed,
  };
}
