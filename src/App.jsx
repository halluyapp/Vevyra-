import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowRight,
  Bell,
  Captions,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  CloudOff,
  Compass,
  Crop,
  Download,
  FastForward,
  Film,
  Gauge,
  HardDrive,
  Heart,
  History,
  Info,
  Keyboard,
  Languages,
  Loader2,
  Lock,
  Maximize2,
  Minimize2,
  Moon,
  MonitorPlay,
  MoreHorizontal,
  Pause,
  PictureInPicture2,
  Play,
  Plus,
  RefreshCw,
  Rewind,
  RotateCcw,
  Search,
  Settings,
  Sliders,
  Sparkles,
  Star,
  Sun,
  Timer,
  Trash2,
  Tv,
  Unlock,
  UserRound,
  Volume1,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import {
  BackButton,
  BottomNav,
  Brand,
  ContentRail,
  EmptyState,
  ErrorState,
  PageTitle,
  PosterCard,
  ProgressBar,
  SearchEmpty,
  SkeletonRows,
  TopBar,
  VeyraMark,
} from './components';
import {
  allCatalogItems,
  catalogMovies,
  catalogSections,
  catalogSeries,
  genres,
  getRecommendationsFor,
  popularSearches,
  searchCatalog,
} from './data';
import {
  fetchCatalogHome,
  fetchTitleDetail,
  resolveStream,
  resolveCaptions,
  searchTitles,
  getMediaProxyUrl,
} from './services/api';
import {
  onUserReady,
  syncWatchlistAdd,
  syncWatchlistRemove,
  syncHistoryUpdate,
  syncHistoryDelete,
  syncDownloadRecord,
  syncDownloadDelete,
  subscribeUserWatchlist,
  subscribeUserHistory,
} from './services/firebase';
import {
  startMediaDownload,
  cancelMediaDownload,
  getMediaBlob,
  deleteMediaBlob,
} from './services/downloads';
import './styles.css';

export function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const padded = String(secs).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${padded}` : `${minutes}:${padded}`;
}

const LIST_KEY = 'veyra-list:v3';
const HISTORY_KEY = 'veyra-history:v3';
const SETTINGS_KEY = 'veyra-settings:v3';
const DOWNLOADS_KEY = 'veyra-downloads:v3';

const DEFAULT_SETTINGS = { language: 'English', appearance: 'Dark' };
const LANGUAGE_CODES = { English: 'en', Español: 'es', Français: 'fr', العربية: 'ar' };

const CONTINUE_MIN_PERCENT = 2;
const CONTINUE_MAX_PERCENT = 95;
const HISTORY_LIMIT = 80;
const PLAYER_STALL_TIMEOUT_MS = 20_000;

function readStore(key, fallback) {
  if (typeof window === 'undefined') return fallback;
  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function writeStore(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable in private browsing or under quota pressure.
  }
}

function readSavedReferences() {
  const stored = readStore(LIST_KEY, []);
  if (!Array.isArray(stored)) return [];
  return uniqueItems(stored.filter(Boolean));
}

function readHistory() {
  const stored = readStore(HISTORY_KEY, []);
  if (!Array.isArray(stored)) return [];
  return stored.filter((entry) => entry?.id && (entry?.content?.providerItemId || entry?.content?.id));
}

function readDownloads() {
  const stored = readStore(DOWNLOADS_KEY, []);
  if (!Array.isArray(stored)) return [];
  return stored.filter((entry) => entry?.id && entry?.content);
}

function readSettings() {
  const stored = readStore(SETTINGS_KEY, {});
  return {
    ...DEFAULT_SETTINGS,
    language: typeof stored?.language === 'string' ? stored.language : DEFAULT_SETTINGS.language,
    appearance: ['Dark', 'Light', 'System'].includes(stored?.appearance) ? stored.appearance : DEFAULT_SETTINGS.appearance,
  };
}

function uniqueItems(items) {
  const seen = new Set();
  return items.filter((item) => item?.id && !seen.has(item.id) && seen.add(item.id));
}

function initialRoute() {
  if (typeof navigator === 'undefined') return 'home';
  const tvUserAgent = /Android TV|Google TV|Leanback|AFT|SHIELD TV|BRAVIA/i.test(navigator.userAgent);
  return tvUserAgent ? 'tv-home' : 'home';
}

function referenceToContent(reference) {
  if (!reference) return null;
  const match = allCatalogItems.find((item) => item.id === reference.id || item.providerItemId === reference.providerItemId);
  if (match) return match;
  return reference;
}

function minutesLeft(position, duration) {
  const remainingSeconds = Math.max(0, (Number(duration) || 0) - (Number(position) || 0));
  return Math.max(1, Math.round(remainingSeconds / 60));
}

function captionForLanguage(captions, language) {
  if (!captions?.length) return undefined;
  const code = LANGUAGE_CODES[language];
  return captions.find((entry) => entry.lang === code)
    || captions.find((entry) => entry.language?.toLowerCase() === String(language || '').toLowerCase());
}

function pickStartQuality(qualities) {
  if (!qualities?.length) return null;
  const fullContent = qualities.filter((entry) => !entry.isTrailer);
  const pool = fullContent.length > 0 ? fullContent : qualities;
  return pool[0];
}

function RoundButton({ children, onClick, label, className = '', type = 'button', ...props }) {
  return <button type={type} className={`round-button ${className}`} onClick={onClick} aria-label={label} {...props}>{children}</button>;
}

function ActionButton({ children, onClick, variant = 'primary', icon: Icon, className = '', ...props }) {
  return <button className={`button button-${variant} ${className}`} onClick={onClick} {...props}>{Icon && <Icon size={17} strokeWidth={2} />}{children}</button>;
}

function Toast({ message, onClose }) {
  if (!message) return null;
  return <div className="toast" role="status"><span className="toast-check"><Check size={15} /></span><span>{message}</span><button onClick={onClose} aria-label="Dismiss"><X size={14} /></button></div>;
}

function SectionLabel({ children, trailing }) {
  return <div className="section-label"><span>{children}</span>{trailing}</div>;
}

function HomeScreen({
  onGo,
  onSearch,
  onNotifications,
  onProfile,
  onOpen,
  onPlay,
  isSaved,
  onToggleSaved,
  featured,
  featuredItems = [],
  sections = [],
  progressItems = [],
  progressFor,
  loading = false,
  error = '',
  onRetry,
}) {
  const heroes = featuredItems.length > 0 ? featuredItems : (featured ? [featured] : []);
  const [heroIndex, setHeroIndex] = useState(0);
  const hero = heroes[heroIndex] || heroes[0] || null;

  useEffect(() => {
    if (heroes.length <= 1) return undefined;
    const timer = window.setInterval(() => {
      setHeroIndex((prev) => (prev + 1) % heroes.length);
    }, 7000);
    return () => window.clearInterval(timer);
  }, [heroes.length]);

  return (
    <main className="home-page">
      <div className="home-hero-art">{hero?.backdrop && <img src={hero.backdrop} alt="" onError={(event) => event.currentTarget.remove()} />}</div>
      <div className="home-hero-gradient" />
      <TopBar isHome active="home" onGo={onGo} onSearch={onSearch} onNotifications={onNotifications} onProfile={onProfile} />
      <section className="home-hero">
        <div className="hero-content">
          <div className="hero-kicker"><span className="original-mark"><VeyraMark size={15} /></span> {hero ? 'FEATURED SPOTLIGHT' : 'YOUR PRIVATE CINEMA'}</div>
          <h1>{hero ? hero.title : <>Your next<br /><em>story.</em></>}</h1>
          <p className="hero-description">{hero?.synopsis || 'Explore an extraordinary collection of movies and series ready to stream.'}</p>
          {hero && <div className="hero-meta">
            {hero.rating && <span className="rating-chip"><Star size={12} fill="currentColor" /> {hero.rating}</span>}
            {hero.badge && <span className="rating-chip">{hero.badge}</span>}
            {hero.year && <span>{hero.year}</span>}
            {hero.runtime && <span>{hero.runtime}</span>}
            {hero.genres?.length > 0 && <span>{hero.genres.slice(0, 3).join(' · ')}</span>}
          </div>}
          <div className="hero-actions">
            {hero ? <>
              <button className="button button-primary hero-watch" onClick={() => onPlay(hero)}><Play size={16} fill="currentColor" /> Watch Now</button>
              <button className={`button button-glass hero-list ${isSaved(hero.id) ? 'is-saved' : ''}`} onClick={() => onToggleSaved(hero)}>{isSaved(hero.id) ? <Check size={16} /> : <Plus size={17} />}{isSaved(hero.id) ? 'In My List' : 'My List'}</button>
              <button className="hero-more" onClick={() => onOpen(hero)}>Explore title <ArrowRight size={15} /></button>
            </> : <>
              <button className="button button-primary hero-watch" onClick={onSearch}><Search size={16} /> Search catalog</button>
            </>}
          </div>
        </div>
        <div className="hero-bottom-note"><span className="hero-index">VEYRA</span><span className="hero-rule" /><span>{hero ? `FEATURED ${heroIndex + 1} OF ${heroes.length}` : 'WATCH WHAT MOVES YOU'}</span></div>
        {heroes.length > 1 ? (
          <div className="hero-pagination" aria-label="Featured content pagination">
            {heroes.map((item, idx) => (
              <button
                key={item.id || idx}
                type="button"
                className={`page-dot ${idx === heroIndex ? 'is-active' : ''}`}
                onClick={() => setHeroIndex(idx)}
                aria-label={`Featured title ${idx + 1}: ${item.title}`}
                style={{ cursor: 'pointer', border: 0, padding: 0 }}
              />
            ))}
          </div>
        ) : (
          <div className="hero-pagination" aria-hidden="true"><span className="page-dot is-active" /></div>
        )}
      </section>
      <div className="home-content">
        <div className="home-welcome"><div><span className="eyebrow">CURATED SELECTION</span><h2>Made for your kind of night.</h2></div><button onClick={() => onGo('discover')}>Explore all <ArrowRight size={15} /></button></div>
        {progressItems.length > 0 && <ContentRail title="Continue watching" eyebrow="PICK UP WHERE YOU LEFT OFF" items={progressItems} onItemClick={onPlay} progressFor={progressFor} actionLabel="See all" onAction={() => onGo('continue')} />}
        {loading && <SkeletonRows count={4} />}
        {!loading && sections.map((section) => <ContentRail key={section.id} title={section.title} eyebrow={section.eyebrow} items={section.items} onItemClick={onOpen} actionLabel="" />)}
        <div className="home-footer"><Brand compact onClick={() => onGo('home')} /><span>Stories worth staying for.</span><button onClick={() => onGo('settings')}>Preferences</button></div>
      </div>
    </main>
  );
}

function DiscoverScreen({ onGo, onOpen, selectedType, setSelectedType, sections = [], items = [], loading, error, onRetry }) {
  const [genre, setGenre] = useState('All');
  const catalogList = items.length > 0 ? items : allCatalogItems;
  const visible = catalogList.filter((item) => {
    const matchesType = selectedType === 'all' || item.type === selectedType;
    const matchesGenre = genre === 'All' || item.genres?.some((value) => value.toLowerCase() === genre.toLowerCase());
    return matchesType && matchesGenre;
  });
  return (
    <main className="page-screen discover-screen">
      <TopBar active="discover" onGo={onGo} onSearch={() => onGo('search')} onNotifications={() => onGo('notifications')} onProfile={() => onGo('profile')} />
      <div className="page-container discover-content">
        <div className="discover-intro"><span className="eyebrow">A WORLD OF GOOD STORIES</span><h1>Find your next<br /><em>obsession.</em></h1><p>Less scrolling. More feeling.</p><div className="discover-orbit orbit-one" /><div className="discover-orbit orbit-two" /><span className="discover-stamp">CURATED<br />FOR YOU <Sparkles size={14} /></span></div>
        <div className="discover-controls">
          <div className="segmented" role="tablist" aria-label="Content type">{[['all', 'Everything'], ['movie', 'Movies'], ['series', 'Series']].map(([id, label]) => <button key={id} className={selectedType === id ? 'selected' : ''} onClick={() => setSelectedType(id)} role="tab" aria-selected={selectedType === id}>{label}</button>)}</div>
          <div className="genre-scroll">{genres.map((item) => <button key={item} className={`genre-chip ${genre === item ? 'genre-active' : ''}`} onClick={() => setGenre(item)}>{item}</button>)}</div>
        </div>
        {loading ? <SkeletonRows count={6} /> : (
          <>
            {sections.slice(0, 2).map((section) => {
              const sectionItems = section.items.filter((item) => (selectedType === 'all' || item.type === selectedType) && (genre === 'All' || item.genres?.some((value) => value.toLowerCase() === genre.toLowerCase())));
              return sectionItems.length ? <ContentRail key={section.id} title={section.title} items={sectionItems} onItemClick={onOpen} actionLabel="" /> : null;
            })}
            <section className="discover-filtered">
              <div className="rail-heading"><div><span className="eyebrow">{genre === 'All' ? 'ALL TITLES' : `${genre.toUpperCase()} TITLES`}</span><h2>{genre === 'All' ? (selectedType === 'movie' ? 'Movies' : selectedType === 'series' ? 'Series' : 'Complete Collection') : `${genre} picks`}</h2></div><span className="result-count">{visible.length} titles</span></div>
              {visible.length ? <div className="poster-grid discover-grid">{visible.map((item) => <PosterCard key={item.id} item={item} onClick={onOpen} />)}</div> : <EmptyState icon={Compass} title="No matching titles." description={`There are no ${genre === 'All' ? 'matching' : genre.toLowerCase()} titles in this category.`} actionLabel="Show all titles" onAction={() => { setSelectedType('all'); setGenre('All'); }} />}
            </section>
          </>
        )}
      </div>
    </main>
  );
}

function SearchScreen({ onGo, onOpen }) {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState('ALL');
  const [liveResults, setLiveResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const searchRef = useRef(null);

  useEffect(() => { searchRef.current?.focus(); }, []);

  const changeQuery = (value) => { setQuery(value); };
  const setScopeFor = (value) => { setScope(value); };

  useEffect(() => {
    const term = query.trim();
    if (!term) {
      setLiveResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await searchTitles(term);
        setLiveResults(res.items || []);
      } catch (err) {
        console.warn('Live search error, falling back:', err.message);
        setLiveResults(searchCatalog(term, scope));
      } finally {
        setLoading(false);
      }
    }, 280);

    return () => clearTimeout(timer);
  }, [query, scope]);

  const visible = useMemo(() => {
    if (!query.trim()) return [];
    if (scope === 'ALL') return liveResults;
    if (scope === 'MOVIES') return liveResults.filter((it) => it.type === 'movie');
    if (scope === 'TV_SERIES') return liveResults.filter((it) => it.type === 'series');
    return liveResults;
  }, [query, scope, liveResults]);

  const suggestions = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return [];
    return liveResults
      .slice(0, 5)
      .map((item) => item.title);
  }, [query, liveResults]);

  return (
    <main className="page-screen search-screen">
      <TopBar onGo={onGo} onSearch={() => searchRef.current?.focus()} onNotifications={() => onGo('notifications')} onProfile={() => onGo('profile')} />
      <div className="page-container search-content">
        <div className="search-heading"><span className="eyebrow">INSTANT CATALOG SEARCH</span><h1>What are you<br /><em>in the mood for?</em></h1></div>
        <div className="search-field-wrap">
          {loading ? <Loader2 size={20} className="animate-spin" /> : <Search size={20} />}
          <input ref={searchRef} value={query} onChange={(event) => changeQuery(event.target.value)} placeholder="Search movies, TV shows, anime, k-drama..." aria-label="Search movies and series" />
          {query && <button onClick={() => changeQuery('')} aria-label="Clear search"><X size={17} /></button>}
          <kbd>⌘ K</kbd>
        </div>
        <div className="search-scopes" role="tablist" aria-label="Search in">{[['ALL', 'Everything'], ['MOVIES', 'Movies'], ['TV_SERIES', 'Series']].map(([id, label]) => <button key={id} className={scope === id ? 'scope-active' : ''} onClick={() => setScopeFor(id)} role="tab" aria-selected={scope === id}>{label}</button>)}</div>
        {!query.trim() ? (
          <>
            <SearchEmpty />
            <div className="trending-searches"><SectionLabel>POPULAR SEARCHES</SectionLabel><div>{popularSearches.map((word, index) => <button key={`${word}-${index}`} onClick={() => changeQuery(word)}><span>{String(index + 1).padStart(2, '0')}</span>{word}<ArrowRight size={14} /></button>)}</div></div>
          </>
        ) : (
          <>
            {suggestions.length > 0 && <div className="suggestion-list"><span className="eyebrow">QUICK MATCHES</span>{suggestions.map((suggestion, index) => (
              <button key={`${suggestion}-${index}`} onClick={() => changeQuery(suggestion)}><Search size={15} /><span>{suggestion}</span><ArrowRight size={14} /></button>
            ))}</div>}
            {visible.length > 0 ? (
              <>
                {scope === 'ALL' ? <>
                  {visible.some((item) => item.type === 'movie') && <SearchResultsGroup title="Movies" items={visible.filter((item) => item.type === 'movie')} onOpen={onOpen} />}
                  {visible.some((item) => item.type === 'series') && <SearchResultsGroup title="Series" items={visible.filter((item) => item.type === 'series')} onOpen={onOpen} />}
                </> : <SearchResultsGroup title={scope === 'MOVIES' ? 'Movies' : 'Series'} items={visible} onOpen={onOpen} />}
              </>
            ) : !loading ? <EmptyState icon={Search} eyebrow="NO MATCHES FOUND" title="Nothing came up." description={`No titles matched “${query.trim()}”. Try searching by title, genre, or director.`} actionLabel="Clear search" onAction={() => changeQuery('')} /> : null}
          </>
        )}
      </div>
    </main>
  );
}

function SearchResultsGroup({ title, items, onOpen }) {
  return (
    <section className="search-results-group">
      <div className="rail-heading"><div><span className="eyebrow">{title === 'Movies' ? 'FEATURE FILMS' : 'SERIES'}</span><h2>{title}</h2></div><span className="result-count">{items.length} results</span></div>
      <div className="search-result-list">
        {items.map((item) => (
          <button className="search-result-row" key={item.id} onClick={() => onOpen(item)}>
            <span className="search-result-art">{item.poster ? <img src={item.poster} alt="" onError={(event) => event.currentTarget.remove()} /> : <span className="poster-art-fallback" />}</span>
            <span className="search-result-copy">
              <strong>{item.title}</strong>
              <span>{[item.year, item.type === 'series' ? 'Series' : 'Film', item.genres?.join(' · ')].filter(Boolean).join(' · ')}</span>
              {item.synopsis && <small>{item.synopsis}</small>}
            </span>
            {item.rating && <span className="result-rating"><Star size={12} fill="currentColor" /> {item.rating}</span>}
            <ArrowRight className="result-arrow" size={17} />
          </button>
        ))}
      </div>
    </section>
  );
}

function EpisodeRow({ episode, onPlay, isTV = false, progressPercent = 0 }) {
  const episodeLabel = episode.episodeNo || episode.number ? `Episode ${episode.episodeNo || episode.number}` : 'Episode';
  const playLabel = `Play ${episodeLabel}`;
  return (
    <article className={`episode-row ${progressPercent > 0 && progressPercent < 95 ? 'episode-current' : ''}`}>
      <button className="episode-thumb" data-tv-focus={isTV ? 'true' : undefined} onClick={() => onPlay(episode)} aria-label={`${playLabel}: ${episode.title}`}>
        {episode.thumbnail ? <img src={episode.thumbnail} alt="" onError={(event) => event.currentTarget.remove()} /> : <span className="poster-art-fallback" />}
        <span><Play size={18} fill="currentColor" /></span>
        {progressPercent > 0 && <ProgressBar value={progressPercent} />}
      </button>
      <div className="episode-copy"><div className="episode-meta"><span>{episodeLabel}</span>{episode.runtime && <><i />{episode.runtime}</>}</div><h3>{episode.title}</h3>{episode.synopsis && <p>{episode.synopsis}</p>}</div>
      <button className="episode-play" data-tv-focus={isTV ? 'true' : undefined} onClick={() => onPlay(episode)} aria-label={`${playLabel}: ${episode.title}`}><Play size={18} fill="currentColor" /></button>
    </article>
  );
}

function DetailScreen({ item, onBack, onPlay, onToggleSaved, isSaved, onDownload, onOpen, isTV = false, progressFor }) {
  const [fullDetail, setFullDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const path = item?.detailPath || item?.slug;
    if (!path) return;

    setLoadingDetail(true);
    fetchTitleDetail(path)
      .then((detail) => {
        if (isMounted && detail) {
          setFullDetail(detail);
        }
      })
      .catch((err) => {
        console.warn('Could not fetch title detail:', err.message);
      })
      .finally(() => {
        if (isMounted) setLoadingDetail(false);
      });

    return () => { isMounted = false; };
  }, [item?.detailPath, item?.slug]);

  const content = fullDetail || item || {};
  const seasons = content?.seasons || [];
  const [selectedSeasonNum, setSelectedSeasonNum] = useState(() => seasons[0]?.seasonNumber || 1);
  const season = seasons.find((entry) => entry.seasonNumber === Number(selectedSeasonNum)) || seasons[0];
  const episodeList = season?.episodes || [];
  const isSeries = content.type === 'series' || seasons.length > 0;
  const recommendations = useMemo(() => getRecommendationsFor(content), [content]);

  return (
    <main className={`detail-screen ${isTV ? 'tv-detail-screen' : ''}`}>
      <section className="detail-hero">
        {content.backdrop && <img className="detail-art" src={content.backdrop} alt="" onError={(event) => event.currentTarget.remove()} />}
        <div className="detail-art-wash" />
        <div className="detail-topline">
          <BackButton onClick={onBack} />
          <div className="detail-top-actions">
            <RoundButton label="Share title" onClick={() => navigator.clipboard?.writeText(content.title).catch(() => {})}><ArrowRight size={17} /></RoundButton>
            <RoundButton label="More title information" onClick={() => document.getElementById('about-title')?.scrollIntoView({ behavior: 'smooth' })}><MoreHorizontal size={18} /></RoundButton>
          </div>
        </div>
        <div className="detail-hero-layout">
          <div className="detail-copy">
            <span className="detail-badge"><VeyraMark size={14} /> {isSeries ? 'SERIES' : 'FEATURE FILM'}</span>
            <h1>{content.title}</h1>
            <div className="detail-meta">
              {content.rating && <span className="rating-chip"><Star size={12} fill="currentColor" /> {content.rating}</span>}
              {content.year && <span>{content.year}</span>}
              {content.runtime && <span>{content.runtime}</span>}
              {content.country && <span>{content.country}</span>}
              {content.maturity && <span className="meta-maturity">{content.maturity}</span>}
            </div>
            {content.genres?.length > 0 && <div className="detail-genres">{content.genres.map((genre) => <span key={genre}>{genre}</span>)}</div>}
            <p className="detail-description">{content.description || content.synopsis}</p>
            <div className="detail-actions">
              <ActionButton
                data-tv-focus={isTV ? 'true' : undefined}
                onClick={() => onPlay(content, isSeries ? episodeList[0] : null, isSeries ? season?.seasonNumber : 0)}
                icon={Play}
              >
                {isSeries ? 'Play episode 1' : 'Play now'}
              </ActionButton>
              <button data-tv-focus={isTV ? 'true' : undefined} className={`button button-glass ${isSaved(content.id) ? 'is-saved' : ''}`} onClick={() => onToggleSaved(content)}>
                {isSaved(content.id) ? <Check size={16} /> : <Plus size={17} />}
                {isSaved(content.id) ? 'In My List' : 'My List'}
              </button>
              <button
                className="round-button detail-download"
                data-tv-focus={isTV ? 'true' : undefined}
                aria-label="Download this title"
                onClick={() => onDownload(content, isSeries && season ? { season: season.seasonNumber || 1, episode: episodeList[0]?.episodeNumber || 1, label: `Season ${season.seasonNumber || 1} · Episode 1` } : { season: 0, episode: 0, label: content.title })}
              >
                <Download size={17} />
              </button>
            </div>
            {isSeries && season && <div className="detail-continue-note"><span className="live-dot" /> Season {season.seasonNumber} <span>·</span> {episodeList.length} episodes</div>}
          </div>
          {content.poster && <div className="detail-poster"><img src={content.poster} alt={`${content.title} poster`} onError={(event) => event.currentTarget.remove()} /><span><VeyraMark size={13} /> VEYRA</span></div>}
        </div>
        <div className="detail-edge-label">STORIES WORTH STAYING FOR</div>
      </section>
      <div className="detail-body page-container">
        <section id="about-title" className="about-block">
          <span className="eyebrow">THE STORY</span>
          <h2>About <em>{content.title}</em></h2>
          <p>{content.description || content.synopsis}</p>
          <div className="credits">
            {content.director && <span><small>DIRECTED BY</small>{content.director}</span>}
            {content.genres?.length > 0 && <span><small>GENRE</small>{content.genres.join(' · ')}</span>}
            {content.country && <span><small>ORIGIN</small>{content.country}</span>}
            {content.subtitlesLanguages?.length > 0 && <span><small>SUBTITLES</small>{content.subtitlesLanguages.slice(0, 5).join(', ')}</span>}
          </div>
        </section>
        {isSeries && (
          <section className="episodes-section">
            <div className="rail-heading episode-heading">
              <div><span className="eyebrow">SEASONS & EPISODES</span><h2>Episodes</h2></div>
              {seasons.length > 0 && (
                <label className="season-select">
                  <span className="sr-only">Select season</span>
                  <select data-tv-focus={isTV ? 'true' : undefined} value={season?.seasonNumber || 1} onChange={(event) => setSelectedSeasonNum(Number(event.target.value))}>
                    {seasons.map((entry) => <option key={entry.seasonNumber} value={entry.seasonNumber}>Season {entry.seasonNumber}</option>)}
                  </select>
                  <ChevronDown size={16} />
                </label>
              )}
            </div>
            <div className="episode-list">
              {episodeList.map((episode) => {
                const epNum = episode.episodeNumber || episode.episodeNo || episode.number || 1;
                const entry = progressFor?.(content.id, season?.seasonNumber, epNum);
                return (
                  <EpisodeRow
                    key={`${season?.seasonNumber || 1}-${epNum}`}
                    episode={{
                      id: `${content.id}-s${season?.seasonNumber || 1}-e${epNum}`,
                      episodeNo: epNum,
                      number: epNum,
                      title: episode.title || `Episode ${epNum}`,
                    }}
                    isTV={isTV}
                    progressPercent={entry?.percent || 0}
                    onPlay={() => onPlay(content, { episodeNumber: epNum, episodeNo: epNum }, season?.seasonNumber || 1)}
                  />
                );
              })}
            </div>
          </section>
        )}
        {content.cast?.length > 0 && (
          <section className="cast-section">
            <div className="rail-heading"><div><span className="eyebrow">THE CAST</span><h2>Starring cast</h2></div></div>
            <div className="cast-list">
              {content.cast.map((person, index) => (
                <div className="cast-person" key={`${person}-${index}`}>
                  <span className={`cast-avatar cast-avatar-${index % 4}`}><span>{person.split(' ').map((p) => p[0]).join('').slice(0, 2)}</span></span>
                  <span>{person}</span>
                </div>
              ))}
            </div>
          </section>
        )}
        {recommendations.length > 0 && (
          <ContentRail title="More like this" eyebrow="KEEP THE FEELING GOING" items={recommendations} onItemClick={onOpen} actionLabel="" />
        )}
      </div>
    </main>
  );
}

function parseSrtCues(srtText) {
  if (!srtText || typeof srtText !== 'string') return [];
  const pattern = /(\d+)\s*\n(\d{2}:\d{2}:\d{2}[,\.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,\.]\d{3})\s*\n([\s\S]*?)(?=\n\s*\n|\n*$)/g;
  const items = [];
  let match;
  const toSeconds = (t) => {
    const parts = t.split(':');
    if (parts.length < 3) return 0;
    const [h, m, rest] = parts;
    const [s, ms] = rest.split(/[,\.]/);
    return Number(h) * 3600 + Number(m) * 60 + Number(s) + (Number(ms) || 0) / 1000;
  };
  while ((match = pattern.exec(srtText)) !== null) {
    items.push({
      start: toSeconds(match[2]),
      end: toSeconds(match[3]),
      text: match[4].replace(/<[^>]+>/g, '').trim(),
    });
  }
  return items;
}

function PlayerScreen({
  content: initialContent,
  episode: initialEpisode = null,
  season: initialSeason = null,
  startPosition = 0,
  onBack,
  onProgress,
  preferredLanguage = 'English',
  isTV = false,
}) {
  const videoRef = useRef(null);
  const playerContainerRef = useRef(null);
  const seekTargetRef = useRef(startPosition || 0);
  const lastSavedRef = useRef({ at: 0, position: 0 });
  const hudTimeoutRef = useRef(null);
  const sleepTimerRef = useRef(null);
  const nextCountdownRef = useRef(null);
  const clickTimeoutRef = useRef(null);

  const [content] = useState(() => initialContent || {});
  const [seasonNumber, setSeasonNumber] = useState(initialSeason);
  const [episodeNumber, setEpisodeNumber] = useState(initialEpisode?.episodeNumber || initialEpisode?.episodeNo || initialEpisode?.number || 1);

  const isSeries = content?.type === 'series' || Boolean(content?.seasons?.length);
  const seasons = content?.seasons || [];
  const currentSeason = seasons.find((s) => String(s.seasonNumber || s.apiValue) === String(seasonNumber)) || seasons[0];
  const episodeList = currentSeason?.episodes || [];
  const currentEpisode = episodeList.find((e) => (e.episodeNumber || e.episodeNo || e.number) === (episodeNumber?.episodeNumber || episodeNumber)) || initialEpisode || episodeList[0] || null;

  const currentEpNum = currentEpisode?.episodeNumber || currentEpisode?.episodeNo || currentEpisode?.number || 1;
  const currentSeNum = currentSeason?.seasonNumber || (Number(seasonNumber) || 1);

  const episodeLabel = isSeries && currentEpisode
    ? `Season ${currentSeNum} · ${currentEpisode.title || `Episode ${currentEpNum}`}`
    : '';

  const [media, setMedia] = useState(() => ({
    hasResource: true,
    qualities: [],
    captions: [],
    duration: content?.duration || 0,
  }));

  const [phase, setPhase] = useState('loading');
  const [activeQuality, setActiveQuality] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(true);
  const [videoReady, setVideoReady] = useState(0);
  const [controlsPing, setControlsPing] = useState(0);
  const [currentTime, setCurrentTime] = useState(startPosition || 0);
  const [duration, setDuration] = useState(0);
  const [sheet, setSheet] = useState('');
  const [captionChoice, setCaptionChoice] = useState(() => {
    const l = String(preferredLanguage || '').toLowerCase();
    if (l.includes('es') || l.includes('span')) return 'es';
    if (l.includes('fr')) return 'fr';
    return 'en';
  });
  const [parsedCues, setParsedCues] = useState([]);

  // Fetch real subtitle track when language chosen
  useEffect(() => {
    if (!captionChoice || captionChoice === 'off' || !media?.captions?.length) {
      setParsedCues([]);
      return;
    }
    const track = media.captions.find((c) => c.lan === captionChoice) || media.captions[0];
    if (track?.url) {
      fetch(getMediaProxyUrl(track.url) || track.url)
        .then((r) => r.text())
        .then((txt) => {
          const cues = parseSrtCues(txt);
          setParsedCues(cues);
        })
        .catch(() => setParsedCues([]));
    }
  }, [captionChoice, media?.captions]);

  // Media resolution effect (Zarhosting + Offline DB)
  useEffect(() => {
    let isMounted = true;
    async function loadPlayback() {
      setPhase('loading');
      setBuffering(true);

      const se = isSeries ? currentSeNum : 0;
      const ep = isSeries ? currentEpNum : 0;

      // 1. Check offline IndexedDB cache
      const dlKey = `dl-${content.id}-${se}-${ep}`;
      try {
        const offlineBlob = await getMediaBlob(dlKey);
        if (offlineBlob && isMounted) {
          const blobUrl = URL.createObjectURL(offlineBlob);
          const offlineQ = {
            label: 'Offline (Downloaded)',
            resolution: 720,
            streamUrl: blobUrl,
            isOffline: true,
          };
          setMedia({
            hasResource: true,
            qualities: [offlineQ],
            captions: [],
            duration: content.duration || 0,
          });
          setActiveQuality(offlineQ);
          setPhase('ready');
          showHud('Playing saved offline file');
          return;
        }
      } catch (err) {
        console.warn('Offline cache lookup note:', err);
      }

      // 2. Resolve live Zarhosting stream & detail
      const subjectId = content?.subjectId || content?.id;
      const detailPath = content?.detailPath || content?.slug;

      if (subjectId || detailPath) {
        try {
          const [streamRes, captionRes, detailRes] = await Promise.all([
            subjectId ? resolveStream(subjectId, detailPath, se, ep).catch((err) => {
              console.warn('Live stream resolve note:', err.message);
              return null;
            }) : null,
            subjectId ? resolveCaptions(subjectId, detailPath, se, ep).catch(() => ({ captions: [] })) : null,
            detailPath ? fetchTitleDetail(detailPath).catch(() => null) : null,
          ]);

          const streamSources = [];
          if (streamRes && streamRes.sources && streamRes.sources.length > 0) {
            for (const s of streamRes.sources) {
              streamSources.push({
                label: s.label || `${s.resolution}p`,
                resolution: s.resolution,
                streamUrl: s.url,
                rawUrl: s.url,
                proxyUrl: getMediaProxyUrl(s.url),
                sizeBytes: s.sizeBytes,
                duration: s.duration,
                isVerified: s.isVerified || false,
              });
            }
          }

          if (streamSources.length > 0 && isMounted) {
            // Filter out trailers so only real movie/series streams are loaded
            const cleanSources = streamSources.filter((s) => !s.isTrailer);
            const qualitiesToUse = cleanSources.length > 0 ? cleanSources : streamSources;
            const initialQ = pickStartQuality(qualitiesToUse);

            setMedia({
              hasResource: true,
              qualities: qualitiesToUse,
              captions: captionRes?.captions || [],
              duration: initialQ?.duration || qualitiesToUse[0]?.duration || content?.duration || 0,
            });
            setActiveQuality(initialQ);
            setPhase('ready');
            return;
          }
        } catch (streamErr) {
          console.warn('Stream resolution error:', streamErr);
        }
      }

      if (isMounted) setPhase('unavailable');
    }

    loadPlayback();
    return () => { isMounted = false; };
  }, [content, currentSeNum, currentEpNum, isSeries]);

  const [showNext, setShowNext] = useState(false);
  const [nextCountdown, setNextCountdown] = useState(10);
  const [message, setMessage] = useState('');

  // Enhanced Video Experience States
  const [volume, setVolume] = useState(() => {
    try {
      const saved = localStorage.getItem('veyra_player_volume');
      return saved !== null ? Math.min(1, Math.max(0, Number(saved))) : 1;
    } catch {
      return 1;
    }
  });
  const [muted, setMuted] = useState(() => {
    try {
      return localStorage.getItem('veyra_player_muted') === 'true';
    } catch {
      return false;
    }
  });
  const [playbackRate, setPlaybackRate] = useState(1);
  const [fitMode, setFitMode] = useState('contain'); // contain | cover | fill
  const [isLocked, setIsLocked] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showRemainingTime, setShowRemainingTime] = useState(false);
  const [bufferedPercent, setBufferedPercent] = useState(0);
  const [hoverTime, setHoverTime] = useState(null);
  const [hoverPosPercent, setHoverPosPercent] = useState(0);
  const [hudMessage, setHudMessage] = useState(null);
  const [hudIcon, setHudIcon] = useState(null);
  const [gestureEffect, setGestureEffect] = useState(null);
  const [sleepOption, setSleepOption] = useState('off');
  const [sleepRemaining, setSleepRemaining] = useState(null);
  const [isLandscapeForced, setIsLandscapeForced] = useState(false);

  const toggleLandscape = useCallback(() => {
    setIsLandscapeForced((prev) => {
      const next = !prev;
      if (next) {
        if (window.screen?.orientation?.lock) {
          window.screen.orientation.lock('landscape').catch(() => {});
        }
        showHud('Landscape View Enabled');
      } else {
        if (window.screen?.orientation?.unlock) {
          window.screen.orientation.unlock();
        }
        showHud('Standard View');
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const handleOrientationChange = () => {
      if (window.innerWidth > window.innerHeight && !isLandscapeForced) {
        setIsLandscapeForced(true);
      }
    };
    window.addEventListener('resize', handleOrientationChange);
    window.addEventListener('orientationchange', handleOrientationChange);
    return () => {
      window.removeEventListener('resize', handleOrientationChange);
      window.removeEventListener('orientationchange', handleOrientationChange);
    };
  }, [isLandscapeForced]);

  const showHud = (msg, icon = null) => {
    if (hudTimeoutRef.current) clearTimeout(hudTimeoutRef.current);
    setHudMessage(msg);
    setHudIcon(icon);
    hudTimeoutRef.current = setTimeout(() => {
      setHudMessage(null);
      setHudIcon(null);
    }, 1300);
  };

  const triggerGesture = (type, text) => {
    setGestureEffect({ type, text, id: Date.now() });
    setTimeout(() => setGestureEffect(null), 650);
  };

  // Keep volume in sync
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = volume;
    video.muted = muted;
    try {
      localStorage.setItem('veyra_player_volume', String(volume));
      localStorage.setItem('veyra_player_muted', String(muted));
    } catch { /* ignore */ }
  }, [volume, muted]);

  // Keep playbackRate in sync
  useEffect(() => {
    const video = videoRef.current;
    if (video) video.playbackRate = playbackRate;
  }, [playbackRate, activeQuality]);

  // Fullscreen event listener
  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);


  // Autoplay and seek initialization
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !activeQuality?.streamUrl) return;
    setBuffering(true);
    const playAttempt = video.play();
    if (playAttempt?.catch) playAttempt.catch(() => setBuffering(false));
  }, [activeQuality]);

  const reportProgress = useCallback(({ position, seconds, completed = false, force = false }) => {
    if (!onProgress) return;
    const total = Number(seconds) || 0;
    if (!total || total < 10) return;
    const now = Date.now();
    if (!force && !completed && now - lastSavedRef.current.at < 5000) return;
    lastSavedRef.current = { at: now, position };
    onProgress({
      content,
      season: currentSeason?.apiValue ?? null,
      episode: currentEpisode?.episodeNo || currentEpisode?.number || null,
      label: episodeLabel,
      position,
      duration: total,
      percent: Math.max(0, Math.min(100, (position / total) * 100)),
      completed,
    });
  }, [content, currentSeason, currentEpisode, episodeLabel, onProgress]);

  const updateBuffered = () => {
    const video = videoRef.current;
    if (!video || !video.buffered.length) return;
    const dur = video.duration || media?.duration || 0;
    if (!dur) return;
    try {
      for (let i = video.buffered.length - 1; i >= 0; i--) {
        if (video.buffered.start(i) <= video.currentTime) {
          const end = video.buffered.end(i);
          setBufferedPercent(Math.min(100, (end / dur) * 100));
          break;
        }
      }
    } catch { /* ignore */ }
  };

  const handleLoadedMetadata = () => {
    const video = videoRef.current;
    if (!video) return;
    setVideoReady(video.readyState);
    const dur = Number.isFinite(video.duration) ? video.duration : 0;
    setDuration(dur);
    if (seekTargetRef.current > 0 && seekTargetRef.current < dur - 2) {
      try { video.currentTime = seekTargetRef.current; } catch { /* ignore */ }
    }
    seekTargetRef.current = 0;
    updateBuffered();
  };

  const seekBy = (delta) => {
    const video = videoRef.current;
    if (!video) return;
    const dur = video.duration || media?.duration || 0;
    const target = Math.max(0, Math.min((dur || 1) - 1, video.currentTime + delta));
    video.currentTime = target;
    setCurrentTime(target);
    setControlsPing((v) => v + 1);
    showHud(delta > 0 ? `+${delta}s` : `${delta}s`);
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      const p = video.play();
      if (p !== undefined) {
        p.then(() => {
          setPlaying(true);
          setBuffering(false);
        }).catch((err) => {
          console.warn('Direct play block:', err.message);
          // Try unmuting or play
          video.muted = true;
          video.play().then(() => setPlaying(true)).catch(() => {});
        });
      } else {
        setPlaying(true);
        setBuffering(false);
      }
      triggerGesture('play', 'PLAY');
      showHud('Play');
    } else {
      video.pause();
      setPlaying(false);
      triggerGesture('pause', 'PAUSE');
      showHud('Pause');
    }
    setControlsPing((v) => v + 1);
  };

  const changeQuality = (quality) => {
    const video = videoRef.current;
    if (video) seekTargetRef.current = video.currentTime;
    setActiveQuality(quality);
    setSheet('');
    setControlsPing((v) => v + 1);
    showHud(`Quality: ${quality.label}`);
  };

  const handleVolumeChange = (newVol) => {
    const clamped = Math.max(0, Math.min(1, newVol));
    setVolume(clamped);
    if (clamped > 0 && muted) setMuted(false);
    showHud(`Volume ${Math.round(clamped * 100)}%`, 'volume');
    setControlsPing((v) => v + 1);
  };

  const toggleMute = () => {
    setMuted((prev) => {
      const next = !prev;
      showHud(next ? 'Muted' : `Volume ${Math.round(volume * 100)}%`, 'volume');
      return next;
    });
    setControlsPing((v) => v + 1);
  };

  const cycleFitMode = () => {
    const modes = ['contain', 'cover', 'fill'];
    const labels = { contain: 'Original Fit', cover: 'Crop to Fill', fill: '16:9 Stretch' };
    const next = modes[(modes.indexOf(fitMode) + 1) % modes.length];
    setFitMode(next);
    showHud(`Display: ${labels[next]}`);
  };

  const toggleFullscreen = () => {
    const container = playerContainerRef.current;
    if (!container) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else if (container.requestFullscreen) {
      container.requestFullscreen().catch(() => {});
    }
  };

  const togglePip = async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        showHud('Exited PiP');
      } else if (video.requestPictureInPicture) {
        await video.requestPictureInPicture();
        showHud('Entered PiP');
      }
    } catch {
      showHud('PiP unavailable');
    }
  };

  const applySleepOption = (opt) => {
    setSleepOption(opt);
    setSheet('');
    if (sleepTimerRef.current) clearInterval(sleepTimerRef.current);
    if (opt === 'off') {
      setSleepRemaining(null);
      showHud('Sleep timer off');
      return;
    }
    if (opt === 'end') {
      showHud('Sleep timer: End of video');
      return;
    }
    const mins = Number(opt);
    let totalSec = mins * 60;
    setSleepRemaining(totalSec);
    showHud(`Sleep timer set to ${mins}m`);
    sleepTimerRef.current = setInterval(() => {
      totalSec -= 1;
      setSleepRemaining(totalSec);
      if (totalSec <= 0) {
        clearInterval(sleepTimerRef.current);
        if (videoRef.current) videoRef.current.pause();
        showHud('Sleep timer expired · Paused');
      }
    }, 1000);
  };

  const playNextEpisode = () => {
    const order = Number(currentEpisode?.episodeNo || currentEpisode?.number) || 0;
    const next = episodeList.find((entry) => (entry.episodeNo || entry.number || 0) > order);
    if (next) {
      setEpisodeNumber(next.episodeNo || next.number);
      if (next.qualities) {
        setMedia({ hasResource: true, qualities: next.qualities, captions: content?.captions || [], duration: next.duration || 0 });
        setActiveQuality(pickStartQuality(next.qualities));
      }
      setShowNext(false);
      showHud(`Up next: ${next.title || `Episode ${next.episodeNo || next.number}`}`);
    }
  };

  // Keyboard controls
  useEffect(() => {
    const handleKey = (event) => {
      const tag = event.target?.tagName;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;

      if (isLocked) {
        if (event.key === 'Escape') setIsLocked(false);
        return;
      }

      if (event.key === 'Escape' || event.key === 'Backspace') {
        event.preventDefault();
        if (sheet) setSheet('');
        else onBack();
        return;
      }
      if (event.key === ' ' || event.key === 'k') { event.preventDefault(); togglePlay(); return; }
      if (event.key === 'ArrowRight' || event.key === 'l') { event.preventDefault(); seekBy(10); return; }
      if (event.key === 'ArrowLeft' || event.key === 'j') { event.preventDefault(); seekBy(-10); return; }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        handleVolumeChange(volume + 0.05);
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        handleVolumeChange(volume - 0.05);
        return;
      }
      if (event.key === 'm') { event.preventDefault(); toggleMute(); return; }
      if (event.key === 'f') { event.preventDefault(); toggleFullscreen(); return; }
      if (event.key === 'r') { event.preventDefault(); toggleLandscape(); return; }
      if (event.key === 'p') { event.preventDefault(); togglePip(); return; }
      if (event.key === 'c') {
        event.preventDefault();
        setCaptionChoice((c) => (c === 'off' ? 'en' : 'off'));
        showHud(captionChoice === 'off' ? 'Subtitles On (EN)' : 'Subtitles Off');
        return;
      }
      if (event.key === '?') { event.preventDefault(); setSheet((s) => (s ? '' : 'shortcuts')); return; }
      if (event.key === 's') { event.preventDefault(); setSheet((s) => (s ? '' : 'speed')); return; }
      if (event.key === 'q') { event.preventDefault(); setSheet((s) => (s ? '' : 'quality')); return; }
      if (event.key >= '0' && event.key <= '9') {
        event.preventDefault();
        const video = videoRef.current;
        const dur = video?.duration || media?.duration || 0;
        if (dur) {
          const pct = Number(event.key) / 10;
          const target = dur * pct;
          if (video) video.currentTime = target;
          setCurrentTime(target);
          showHud(`Seek: ${pct * 100}%`);
        }
      }
    };
    document.addEventListener('keydown', handleKey, true);
    return () => document.removeEventListener('keydown', handleKey, true);
  }, [onBack, sheet, isLocked, volume, muted, captionChoice]);

  // Click & Double-click zone handler
  const handleZoneClick = (zone) => {
    if (isLocked) {
      showHud('Screen is locked · Tap Unlock button below', 'lock');
      return;
    }
    setControlsPing((v) => v + 1);

    const video = videoRef.current;
    if (video && video.paused) {
      togglePlay();
      return;
    }

    if (clickTimeoutRef.current) {
      // Double click!
      clearTimeout(clickTimeoutRef.current);
      clickTimeoutRef.current = null;
      if (zone === 'left') {
        seekBy(-10);
        triggerGesture('rewind', '-10s');
      } else if (zone === 'right') {
        seekBy(10);
        triggerGesture('forward', '+10s');
      } else {
        togglePlay();
      }
    } else {
      // Single click wait
      clickTimeoutRef.current = setTimeout(() => {
        clickTimeoutRef.current = null;
        if (zone === 'center') {
          togglePlay();
        }
      }, 260);
    }
  };

  const hasSource = Boolean(activeQuality?.streamUrl);
  const statusLabel = phase === 'loading' ? 'CONNECTING'
    : phase === 'unavailable' || !hasSource ? 'NO SOURCE'
      : playing && !buffering && videoReady >= 2 ? 'PLAYING'
        : buffering || videoReady < 2 ? 'BUFFERING'
          : 'PAUSED';

  const statusKey = statusLabel.toLowerCase().replace(/\s+/g, '');

  const durationIsEstimate = !duration && Boolean(media?.duration);
  const totalDuration = duration || media?.duration || 0;
  const progressPercent = totalDuration ? Math.min(100, (currentTime / totalDuration) * 100) : 0;
  const controlsVisible = !playing || sheet !== '' || controlsPing > 0;

  // Auto next countdown effect
  useEffect(() => {
    if (showNext && isSeries && episodeList.length > 1) {
      setNextCountdown(10);
      nextCountdownRef.current = setInterval(() => {
        setNextCountdown((cur) => {
          if (cur <= 1) {
            clearInterval(nextCountdownRef.current);
            playNextEpisode();
            return 0;
          }
          return cur - 1;
        });
      }, 1000);
      return () => clearInterval(nextCountdownRef.current);
    }
  }, [showNext]);

  // Inactivity autohide
  useEffect(() => {
    if (!playing || sheet || isLocked) return undefined;
    const timer = window.setTimeout(() => setControlsPing(0), 3800);
    return () => window.clearTimeout(timer);
  }, [playing, sheet, controlsPing, isLocked]);

  // Current Subtitle text
  const currentSubtitle = useMemo(() => {
    if (!captionChoice || captionChoice === 'off' || !parsedCues?.length) return '';
    const activeCue = parsedCues.find((cue) => currentTime >= cue.start && currentTime <= cue.end);
    return activeCue ? activeCue.text : '';
  }, [currentTime, captionChoice, parsedCues]);

  return (
    <main
      ref={playerContainerRef}
      className={`player-screen ${isTV ? 'tv-player-screen' : ''} ${isLandscapeForced ? 'force-landscape' : ''} ${controlsVisible && !isLocked ? '' : 'player-idle'}`}
      onMouseMove={() => !isLocked && setControlsPing((v) => (v > 0 ? v : 1))}
      onTouchStart={() => !isLocked && setControlsPing((v) => (v > 0 ? v : 1))}
    >
      {/* Video Stage - Standard Clean Cinema */}
      <div className="player-stage">
        <video
          ref={videoRef}
          className={`player-video fit-${fitMode}`}
          src={activeQuality?.streamUrl || undefined}
          playsInline
          preload="auto"
          autoPlay
          referrerPolicy="no-referrer"
          onLoadStart={() => setVideoReady(0)}
          onLoadedMetadata={handleLoadedMetadata}
          onLoadedData={() => setVideoReady(videoRef.current?.readyState || 0)}
          onDurationChange={() => {
            const video = videoRef.current;
            if (video) setDuration(Number.isFinite(video.duration) ? video.duration : 0);
          }}
          onProgress={updateBuffered}
          onTimeUpdate={() => {
            const video = videoRef.current;
            if (!video) return;
            setCurrentTime(video.currentTime);
            updateBuffered();
            reportProgress({ position: video.currentTime, seconds: video.duration || totalDuration });
          }}
          onPlay={() => { setPlaying(true); setBuffering(false); }}
          onPause={() => {
            setPlaying(false);
            const video = videoRef.current;
            reportProgress({ position: video?.currentTime || 0, seconds: video?.duration || totalDuration, force: true });
          }}
          onWaiting={() => setBuffering(true)}
          onPlaying={() => { setVideoReady(videoRef.current?.readyState || 0); setBuffering(false); }}
          onCanPlay={() => { setVideoReady(videoRef.current?.readyState || 0); setBuffering(false); }}
          onEnded={() => {
            setPlaying(false);
            reportProgress({ position: duration || totalDuration, seconds: duration || totalDuration, completed: true, force: true });
            setShowNext(isSeries && episodeList.length > 1);
          }}
          onError={() => {
            console.warn('Video element stream note:', activeQuality?.streamUrl);
            setBuffering(false);
          }}
          aria-label={`${content?.title || 'Video'} player`}
        />

        {/* Click & Touch Gesture Zones */}
        <div className="player-gesture-zones">
          <div className="gesture-zone" onClick={() => handleZoneClick('left')} />
          <div className="gesture-zone" onClick={() => handleZoneClick('center')} />
          <div className="gesture-zone" onClick={() => handleZoneClick('right')} />
        </div>

        {/* Big Center Play Overlay */}
        {!playing && !buffering && !isLocked && (
          <div className="player-center-play-overlay">
            <button className="big-play-trigger" onClick={togglePlay} aria-label="Play video">
              <Play size={44} fill="currentColor" />
            </button>
          </div>
        )}

        <div className="player-scrim" />
      </div>

      {/* Center Animated Gestures */}
      {gestureEffect && (
        <div className={`gesture-indicator gesture-${gestureEffect.type === 'rewind' ? 'left' : gestureEffect.type === 'forward' ? 'right' : 'center'}`}>
          {gestureEffect.type === 'rewind' && <Rewind size={32} />}
          {gestureEffect.type === 'forward' && <FastForward size={32} />}
          {gestureEffect.type === 'play' && <Play size={32} fill="currentColor" />}
          {gestureEffect.type === 'pause' && <Pause size={32} fill="currentColor" />}
          <span>{gestureEffect.text}</span>
        </div>
      )}

      {/* Floating HUD Pill */}
      {hudMessage && (
        <div className="player-hud-pill">
          {hudIcon === 'volume' ? <Volume2 size={16} /> : hudIcon === 'lock' ? <Lock size={16} /> : <Sparkles size={16} />}
          <span>{hudMessage}</span>
        </div>
      )}

      {/* Real-time Subtitles */}
      {currentSubtitle && (
        <div className="player-subtitle-overlay">
          <span className="player-subtitle-text">{currentSubtitle}</span>
        </div>
      )}

      {/* Screen Locked Overlay */}
      {isLocked && (
        <div className="player-locked-scrim">
          <button className="player-unlock-btn" onClick={() => { setIsLocked(false); showHud('Screen Unlocked'); }}>
            <Unlock size={17} />
            <span>Screen Locked · Tap to Unlock</span>
          </button>
        </div>
      )}

      {/* Player UI Layer */}
      <div className={`player-ui ${controlsVisible && !isLocked ? 'controls-visible' : 'controls-hidden'}`}>
        <header className="player-top">
          <button className="player-back" onClick={onBack} aria-label="Back">
            <ChevronLeft size={22} />
            <div className="player-back-copy">
              <span className="eyebrow">{isSeries ? 'SERIES' : 'CINEMA'}</span>
              <strong>{content?.title || 'VEYRA'}</strong>
            </div>
          </button>

          <div className="player-top-center">
            <span className={`player-status status-${statusKey}`}><span /> {statusLabel}</span>
            {episodeLabel && <span className="player-episode-heading">{episodeLabel}</span>}
          </div>

          <div className="player-top-actions">
            <RoundButton
              label="Rotate screen to landscape"
              onClick={toggleLandscape}
              className={isLandscapeForced ? 'landscape-active' : ''}
            >
              <RotateCcw size={16} />
            </RoundButton>

            <RoundButton
              label="Sleep timer"
              onClick={() => setSheet('sleep')}
              className={sleepOption !== 'off' ? 'sleep-active' : ''}
            >
              <Timer size={16} />
              {sleepRemaining && <small className="sleep-badge">{Math.ceil(sleepRemaining / 60)}m</small>}
            </RoundButton>

            <RoundButton
              label="Lock screen"
              onClick={() => {
                setIsLocked(true);
                showHud('Screen Locked', 'lock');
              }}
            >
              <Lock size={16} />
            </RoundButton>

            <RoundButton
              label="Keyboard shortcuts"
              onClick={() => setSheet('shortcuts')}
            >
              <Keyboard size={16} />
            </RoundButton>

            <RoundButton
              label="Playback diagnostics"
              onClick={() => setSheet('stats')}
            >
              <Info size={16} />
            </RoundButton>

            <RoundButton
              label="Reload stream"
              onClick={() => {
                const v = videoRef.current;
                if (v) v.load();
                showHud('Stream Reloaded');
              }}
            >
              <RefreshCw size={15} />
            </RoundButton>
          </div>
        </header>

        {phase === 'loading' && (
          <div className="buffering-indicator">
            <Loader2 size={32} />
            <span>Connecting to high-speed stream…</span>
          </div>
        )}

        {phase === 'ready' && buffering && (
          <div className="buffering-indicator">
            <Loader2 size={28} />
            <span>Buffering</span>
          </div>
        )}

        {(phase === 'error' || phase === 'unavailable' || !hasSource) && (
          <div className="player-error">
            <span><CloudOff size={26} /></span>
            <h2>{phase === 'unavailable' || !hasSource ? 'No source for this title.' : 'Source busy.'}</h2>
            <p>{message || 'No video source is available for this title.'}</p>
            <div className="player-error-actions">
              <button className="button button-glass" onClick={onBack}><ChevronLeft size={16} /> Return to catalog</button>
            </div>
          </div>
        )}

        {phase === 'ready' && hasSource && (
          <>
            {/* Large Center Playback Controls */}
            <div className="player-center-controls">
              <button onClick={() => seekBy(-10)} aria-label="Back 10 seconds">
                <Rewind size={22} /><small>10</small>
              </button>
              <button className="player-main-control" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
                {playing ? <Pause size={30} fill="currentColor" /> : <Play size={30} fill="currentColor" />}
              </button>
              <button onClick={() => seekBy(10)} aria-label="Forward 10 seconds">
                <FastForward size={22} /><small>10</small>
              </button>
            </div>

            {/* Auto Next Countdown Card */}
            {showNext && (
              <div className="next-episode-card">
                <span className="eyebrow">UP NEXT IN {nextCountdown}S</span>
                <h3>{episodeList[1]?.title || 'Next Episode'}</h3>
                <div className="next-card-actions">
                  <button className="next-card-play" onClick={playNextEpisode}>
                    <Play size={13} fill="currentColor" /> Play Now
                  </button>
                  <button className="next-card-dismiss" onClick={() => setShowNext(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <footer className="player-footer">
              <div className="player-title-line">
                <div>
                  <span className="eyebrow">{isSeries ? 'SERIES' : 'FEATURE FILM'}</span>
                  <h2>{content?.title}</h2>
                </div>
                <div className="player-badge-group">
                  <span className="preview-tag">{activeQuality?.label || 'HD'}</span>
                  <span className="preview-tag">{playbackRate}x</span>
                  {captionChoice !== 'off' && <span className="preview-tag">CC: {captionChoice.toUpperCase()}</span>}
                </div>
              </div>

              {/* Scrubber Container with Buffered Bar & Hover Preview */}
              <div
                className="seek-container"
                onMouseMove={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                  setHoverPosPercent(ratio * 100);
                  setHoverTime(ratio * totalDuration);
                }}
                onMouseLeave={() => setHoverTime(null)}
              >
                <div className="seek-track-wrapper">
                  <div className="seek-buffered" style={{ width: `${bufferedPercent}%` }} />
                  <div className="seek-played" style={{ width: `${progressPercent}%` }} />
                  <div className="seek-thumb-indicator" style={{ left: `${progressPercent}%` }} />
                </div>

                <input
                  className="seek-slider"
                  type="range"
                  min="0"
                  max={Math.max(1, Math.floor(totalDuration))}
                  step="1"
                  value={Math.floor(currentTime)}
                  style={{ '--range-progress': `${progressPercent}%` }}
                  onChange={(event) => {
                    const video = videoRef.current;
                    const value = Number(event.target.value);
                    if (video) video.currentTime = value;
                    setCurrentTime(value);
                  }}
                  aria-label="Seek"
                />

                {hoverTime !== null && (
                  <div className="seek-hover-tooltip" style={{ left: `${hoverPosPercent}%` }}>
                    {formatDuration(hoverTime)}
                  </div>
                )}
              </div>

              {/* Time Row with Elapsed/Remaining Toggle */}
              <div className="time-row">
                <span
                  className="time-interactive"
                  onClick={() => setShowRemainingTime(!showRemainingTime)}
                  title="Click to toggle remaining time"
                >
                  {showRemainingTime ? `-${formatDuration(Math.max(0, totalDuration - currentTime))}` : formatDuration(currentTime)}
                </span>
                <span>{progressPercent ? `${Math.round(progressPercent)}%` : '—'}</span>
                <span>{durationIsEstimate ? `~${formatDuration(totalDuration)}` : formatDuration(totalDuration)}</span>
              </div>

              {/* Bottom Control Bar */}
              <div className="player-control-bar">
                <div className="player-bar-left">
                  <button className="player-bar-play" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
                    {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
                  </button>

                  <button onClick={() => seekBy(-10)} aria-label="Rewind 10 seconds">
                    <Rewind size={18} />
                  </button>

                  <button onClick={() => seekBy(10)} aria-label="Forward 10 seconds">
                    <FastForward size={18} />
                  </button>

                  {/* Volume Control Slider */}
                  <div className="player-volume-group">
                    <button onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'}>
                      {muted || volume === 0 ? <VolumeX size={18} /> : volume < 0.5 ? <Volume1 size={18} /> : <Volume2 size={18} />}
                    </button>
                    <div className="volume-slider-wrap">
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={muted ? 0 : volume}
                        onChange={(e) => handleVolumeChange(Number(e.target.value))}
                        className="volume-slider"
                        style={{ '--vol-progress': `${(muted ? 0 : volume) * 100}%` }}
                        aria-label="Volume"
                      />
                    </div>
                  </div>
                </div>

                <div className="player-bar-right">
                  <button onClick={() => setSheet('speed')} title="Playback speed">
                    <span>{playbackRate}x</span>
                  </button>

                  <button onClick={() => setSheet('quality')} title="Stream quality">
                    <Gauge size={16} />
                    <span>{activeQuality?.label || 'Quality'}</span>
                  </button>

                  <button onClick={() => setSheet('captions')} title="Subtitles & Audio">
                    <Captions size={16} />
                    <span>{captionChoice !== 'off' ? captionChoice.toUpperCase() : 'Subtitles'}</span>
                  </button>

                  <button onClick={cycleFitMode} title="Toggle aspect ratio / zoom">
                    <Crop size={16} />
                    <span>{fitMode === 'contain' ? 'Fit' : fitMode === 'cover' ? 'Fill' : '16:9'}</span>
                  </button>

                  <button onClick={toggleLandscape} title="Toggle Landscape mode" className={isLandscapeForced ? 'landscape-active' : ''}>
                    <RotateCcw size={16} />
                    <span>Landscape</span>
                  </button>

                  {isSeries && episodeList.length > 0 && (
                    <button onClick={() => setSheet('episodes')} title="Episode list">
                      <Film size={16} />
                      <span>Episodes</span>
                    </button>
                  )}

                  <button onClick={togglePip} title="Picture in Picture">
                    <PictureInPicture2 size={16} />
                  </button>

                  <button onClick={toggleFullscreen} title="Fullscreen">
                    {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                  </button>
                </div>
              </div>
            </footer>
          </>
        )}
      </div>

      {/* Interactive Sheets / Drawers */}
      {sheet && (
        <div className="dialog-backdrop sheet-backdrop" role="presentation" onClick={() => setSheet('')}>
          <section className="bottom-sheet" role="dialog" aria-modal="true" aria-label={sheet} onClick={(event) => event.stopPropagation()}>
            <span className="sheet-grabber" />

            {/* Quality Sheet */}
            {sheet === 'quality' && (
              <>
                <div className="sheet-heading">
                  <div>
                    <span className="eyebrow">STREAM QUALITY</span>
                    <h2>Video Resolution</h2>
                    <p>Switch resolution seamlessly with instant buffer retention</p>
                  </div>
                  <button className="sheet-close" onClick={() => setSheet('')} aria-label="Close"><X size={16} /></button>
                </div>
                <div className="option-list">
                  {(media?.qualities || []).map((quality) => (
                    <button
                      key={quality.label}
                      className={quality.streamUrl === activeQuality?.streamUrl ? 'option-selected' : ''}
                      onClick={() => changeQuality(quality)}
                    >
                      <span className="option-check">{quality.streamUrl === activeQuality?.streamUrl ? <Check size={12} /> : null}</span>
                      {quality.label}
                      <small>{quality.resolution >= 1080 ? 'Full HD 1080p' : quality.resolution >= 720 ? 'HD 720p' : 'SD 480p'}</small>
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* Playback Speed Sheet */}
            {sheet === 'speed' && (
              <>
                <div className="sheet-heading">
                  <div>
                    <span className="eyebrow">PLAYBACK RATE</span>
                    <h2>Playback Speed</h2>
                    <p>Adjust video pacing</p>
                  </div>
                  <button className="sheet-close" onClick={() => setSheet('')} aria-label="Close"><X size={16} /></button>
                </div>
                <div className="option-list">
                  {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((rate) => (
                    <button
                      key={rate}
                      className={playbackRate === rate ? 'option-selected' : ''}
                      onClick={() => {
                        setPlaybackRate(rate);
                        setSheet('');
                        showHud(`Speed: ${rate}x`);
                      }}
                    >
                      <span className="option-check">{playbackRate === rate ? <Check size={12} /> : null}</span>
                      {rate === 1 ? '1.0x (Normal)' : `${rate}x`}
                      <small>{rate < 1 ? 'Slow Motion' : rate > 1 ? 'Fast' : 'Default'}</small>
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* Captions Sheet */}
            {sheet === 'captions' && (
              <>
                <div className="sheet-heading">
                  <div>
                    <span className="eyebrow">AUDIO & SUBTITLES</span>
                    <h2>Caption Track</h2>
                    <p>Select language overlay for on-screen dialogue</p>
                  </div>
                  <button className="sheet-close" onClick={() => setSheet('')} aria-label="Close"><X size={16} /></button>
                </div>
                <div className="option-list">
                  <button
                    className={captionChoice === 'off' ? 'option-selected' : ''}
                    onClick={() => { setCaptionChoice('off'); setSheet(''); showHud('Subtitles Off'); }}
                  >
                    <span className="option-check">{captionChoice === 'off' ? <Check size={12} /> : null}</span>
                    Off
                  </button>
                  {[
                    { lang: 'en', label: 'English', desc: 'Full dialogue' },
                    { lang: 'es', label: 'Español', desc: 'Subtítulos en español' },
                    { lang: 'fr', label: 'Français', desc: 'Sous-titres français' },
                  ].map((entry) => (
                    <button
                      key={entry.lang}
                      className={captionChoice === entry.lang ? 'option-selected' : ''}
                      onClick={() => { setCaptionChoice(entry.lang); setSheet(''); showHud(`Subtitles: ${entry.label}`); }}
                    >
                      <span className="option-check">{captionChoice === entry.lang ? <Check size={12} /> : null}</span>
                      {entry.label}
                      <small>{entry.desc}</small>
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* Sleep Timer Sheet */}
            {sheet === 'sleep' && (
              <>
                <div className="sheet-heading">
                  <div>
                    <span className="eyebrow">BEDTIME VIEWING</span>
                    <h2>Sleep Timer</h2>
                    <p>Automatically pause video when timer expires</p>
                  </div>
                  <button className="sheet-close" onClick={() => setSheet('')} aria-label="Close"><X size={16} /></button>
                </div>
                <div className="option-list">
                  {[
                    { opt: 'off', label: 'Off', desc: 'Continuous playback' },
                    { opt: 15, label: '15 Minutes', desc: 'Pause after 15 min' },
                    { opt: 30, label: '30 Minutes', desc: 'Pause after 30 min' },
                    { opt: 45, label: '45 Minutes', desc: 'Pause after 45 min' },
                    { opt: 60, label: '60 Minutes', desc: 'Pause after 1 hour' },
                    { opt: 'end', label: 'End of title', desc: 'Pause when video finishes' },
                  ].map(({ opt, label, desc }) => (
                    <button
                      key={String(opt)}
                      className={sleepOption === opt ? 'option-selected' : ''}
                      onClick={() => applySleepOption(opt)}
                    >
                      <span className="option-check">{sleepOption === opt ? <Check size={12} /> : null}</span>
                      {label}
                      <small>{desc}</small>
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* TV Series Episodes Sheet */}
            {sheet === 'episodes' && isSeries && (
              <>
                <div className="sheet-heading">
                  <div>
                    <span className="eyebrow">{currentSeason?.label}</span>
                    <h2>Select Episode</h2>
                    <p>Switch episodes without exiting player</p>
                  </div>
                  <button className="sheet-close" onClick={() => setSheet('')} aria-label="Close"><X size={16} /></button>
                </div>
                <div className="option-list">
                  {episodeList.map((ep) => (
                    <button
                      key={ep.id}
                      className={(ep.episodeNo || ep.number) === (currentEpisode?.episodeNo || currentEpisode?.number) ? 'option-selected' : ''}
                      onClick={() => {
                        setEpisodeNumber(ep.episodeNo || ep.number);
                        if (ep.qualities) {
                          setMedia({ hasResource: true, qualities: ep.qualities, captions: content?.captions || [], duration: ep.duration || 0 });
                          setActiveQuality(pickStartQuality(ep.qualities));
                        }
                        setSheet('');
                        showHud(`Switched to Episode ${ep.episodeNo || ep.number}`);
                      }}
                    >
                      <span className="option-check">{(ep.episodeNo || ep.number) === (currentEpisode?.episodeNo || currentEpisode?.number) ? <Check size={12} /> : null}</span>
                      {ep.title}
                      <small>{ep.runtime}</small>
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* Keyboard Shortcuts Cheatsheet */}
            {sheet === 'shortcuts' && (
              <>
                <div className="sheet-heading">
                  <div>
                    <span className="eyebrow">HOTKEYS</span>
                    <h2>Keyboard Shortcuts</h2>
                    <p>Quick keys for full player control</p>
                  </div>
                  <button className="sheet-close" onClick={() => setSheet('')} aria-label="Close"><X size={16} /></button>
                </div>
                <div className="shortcuts-grid">
                  <div className="shortcut-row"><span>Play / Pause</span><kbd>Space / K</kbd></div>
                  <div className="shortcut-row"><span>Seek backward 10s</span><kbd>← / J</kbd></div>
                  <div className="shortcut-row"><span>Seek forward 10s</span><kbd>→ / L</kbd></div>
                  <div className="shortcut-row"><span>Volume Up</span><kbd>↑</kbd></div>
                  <div className="shortcut-row"><span>Volume Down</span><kbd>↓</kbd></div>
                  <div className="shortcut-row"><span>Toggle Mute</span><kbd>M</kbd></div>
                  <div className="shortcut-row"><span>Toggle Fullscreen</span><kbd>F</kbd></div>
                  <div className="shortcut-row"><span>Picture in Picture</span><kbd>P</kbd></div>
                  <div className="shortcut-row"><span>Toggle Subtitles</span><kbd>C</kbd></div>
                  <div className="shortcut-row"><span>Jump to 0% - 90%</span><kbd>0 - 9</kbd></div>
                  <div className="shortcut-row"><span>Quality Selector</span><kbd>Q</kbd></div>
                  <div className="shortcut-row"><span>Speed Selector</span><kbd>S</kbd></div>
                  <div className="shortcut-row"><span>Close / Back</span><kbd>Esc</kbd></div>
                </div>
              </>
            )}

            {/* Stats for Nerds / Diagnostics Sheet */}
            {sheet === 'stats' && (
              <>
                <div className="sheet-heading">
                  <div>
                    <span className="eyebrow">DIAGNOSTICS</span>
                    <h2>Playback Statistics</h2>
                    <p>Real-time stream health & device metrics</p>
                  </div>
                  <button className="sheet-close" onClick={() => setSheet('')} aria-label="Close"><X size={16} /></button>
                </div>
                <div className="stats-grid">
                  <div className="stat-row"><span>Title</span><strong>{content?.title}</strong></div>
                  <div className="stat-row"><span>Resolution</span><strong>{activeQuality?.resolution ? `${activeQuality.resolution}p` : 'Auto HD'} ({activeQuality?.label || '1080p'})</strong></div>
                  <div className="stat-row"><span>Buffered Ahead</span><strong>{bufferedPercent.toFixed(1)}% ({Math.max(0, Math.round(((bufferedPercent / 100) * totalDuration) - currentTime))}s)</strong></div>
                  <div className="stat-row"><span>Volume / Audio</span><strong>{Math.round(volume * 100)}% ({muted ? 'Muted' : 'Audible'})</strong></div>
                  <div className="stat-row"><span>Playback Rate</span><strong>{playbackRate}x</strong></div>
                  <div className="stat-row"><span>Fit Mode</span><strong>{fitMode.toUpperCase()}</strong></div>
                  <div className="stat-row"><span>Ready State</span><strong>{videoReady >= 4 ? 'HAVE_ENOUGH_DATA (Optimal)' : `Ready State ${videoReady}`}</strong></div>
                  <div className="stat-row"><span>Decoder Status</span><strong>Hardware Accelerated (Nominal)</strong></div>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

function MyListScreen({ onGo, onOpen, savedItems = [], onRemove }) {
  const [tab, setTab] = useState('all');
  const visible = savedItems.filter((item) => tab === 'all' || item.type === tab);
  return (
    <main className="page-screen">
      <TopBar onGo={onGo} onSearch={() => onGo('search')} onNotifications={() => onGo('notifications')} onProfile={() => onGo('profile')} />
      <div className="page-container library-page">
        <PageTitle eyebrow="YOUR PRIVATE SHELF" title="My List" description="Saved favorites stored privately on this device." right={<span className="library-count">{visible.length} saved</span>} />
        <div className="library-tabs" role="tablist">
          <button className={tab === 'all' ? 'selected' : ''} onClick={() => setTab('all')}>Everything <span>{savedItems.length}</span></button>
          <button className={tab === 'movie' ? 'selected' : ''} onClick={() => setTab('movie')}>Movies <span>{savedItems.filter((item) => item.type === 'movie').length}</span></button>
          <button className={tab === 'series' ? 'selected' : ''} onClick={() => setTab('series')}>Series <span>{savedItems.filter((item) => item.type === 'series').length}</span></button>
        </div>
        {visible.length ? (
          <div className="poster-grid library-grid">
            {visible.map((item) => <PosterCard key={item.id} item={item} onClick={onOpen} onRemove={onRemove} />)}
          </div>
        ) : (
          <EmptyState icon={Heart} title="Nothing saved yet." description="Add movies and series to My List from any title screen." actionLabel="Explore catalog" onAction={() => onGo('discover')} />
        )}
      </div>
    </main>
  );
}

function ContinueScreen({ onGo, onOpen, items = [], onPlay }) {
  return (
    <main className="page-screen">
      <TopBar onGo={onGo} onSearch={() => onGo('search')} onNotifications={() => onGo('notifications')} onProfile={() => onGo('profile')} />
      <div className="page-container continue-page">
        <PageTitle eyebrow="PICK UP WHERE YOU LEFT OFF" title="Keep watching." description="Resume from your exact playback position." />
        {items.length ? (
          <div className="continue-list">
            {items.map((entry) => (
              <article className="continue-card" key={entry.id}>
                <button className="continue-art" onClick={() => onPlay(entry)}>
                  {entry.content.poster && <img src={entry.content.poster} alt="" onError={(event) => event.currentTarget.remove()} />}
                  <span><Play size={18} fill="currentColor" /></span>
                  <ProgressBar value={entry.percent} />
                </button>
                <div className="continue-info">
                  <span className="eyebrow">{entry.label || (entry.content.type === 'series' ? 'SERIES' : 'FEATURE FILM')}</span>
                  <h2>{entry.content.title}</h2>
                  <p>{entry.remainingLabel || `${Math.round(entry.percent)}% watched`} <span>·</span> {Math.round(entry.percent)}% watched</p>
                  <div className="continue-actions">
                    <ActionButton onClick={() => onPlay(entry)} icon={Play}>Resume</ActionButton>
                    <button className="text-button" onClick={() => onOpen(entry.content)}>View details <ArrowRight size={15} /></button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState icon={Clock3} title="Nothing to resume." description="When you start watching titles, your progress will show up here." actionLabel="Browse catalog" onAction={() => onGo('discover')} />
        )}
      </div>
    </main>
  );
}

function HistoryScreen({ onGo, entries = [], onClear, onRemove, onOpen, onResume }) {
  const [askClear, setAskClear] = useState(false);
  return (
    <main className="page-screen">
      <TopBar onGo={onGo} onSearch={() => onGo('search')} onNotifications={() => onGo('notifications')} onProfile={() => onGo('profile')} />
      <div className="page-container history-page">
        <PageTitle eyebrow="YOUR RECENT SCREENINGS" title="Watch history" description="Saved locally on this device." right={entries.length > 0 && <button className="subtle-action" onClick={() => setAskClear(true)}><Trash2 size={15} /> Clear history</button>} />
        {entries.length ? (
          <div className="history-list">
            {entries.map((entry) => {
              const item = referenceToContent(entry.content);
              if (!item) return null;
              const resumable = !entry.completed && entry.percent > CONTINUE_MIN_PERCENT && entry.percent < CONTINUE_MAX_PERCENT;
              return (
                <article className="history-row" key={entry.id}>
                  <button className="history-art" onClick={() => onOpen(item)} aria-label={`Open ${item.title}`}>
                    {item.poster && <img src={item.poster} alt="" onError={(event) => event.currentTarget.remove()} />}
                    <ProgressBar value={entry.percent || 0} />
                  </button>
                  <div className="history-info" onClick={() => onOpen(item)}>
                    <span className="eyebrow">{entry.updatedAt ? new Date(entry.updatedAt).toLocaleDateString() : ''}</span>
                    <h2>{item.title}</h2>
                    <span>{entry.label || (item.type === 'series' ? 'Series' : 'Film')} <i>·</i> {Math.round(entry.percent || 0)}% watched{entry.duration ? ` · ${formatDuration(entry.duration)}` : ''}</span>
                    {entry.completed && <small>Finished</small>}
                  </div>
                  <div className="history-row-actions">
                    {resumable && <button className="history-resume" onClick={() => onResume(entry)}><Play size={13} fill="currentColor" /> Resume</button>}
                    <button className="history-more" aria-label={`Remove ${item.title} from history`} onClick={() => onRemove(entry)}><X size={16} /></button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <EmptyState icon={History} title="No watch history yet." description="Titles you stream will appear here automatically." actionLabel="Browse catalog" onAction={() => onGo('discover')} />
        )}
      </div>
      {askClear && (
        <ConfirmDialog
          title="Clear your watch history?"
          description="This removes all stored playback sessions from this device. Your saved list won’t change."
          confirmLabel="Clear history"
          onCancel={() => setAskClear(false)}
          onConfirm={() => { onClear(); setAskClear(false); }}
        />
      )}
    </main>
  );
}

function ConfirmDialog({ title, description, confirmLabel, onConfirm, onCancel }) {
  return (
    <div className="dialog-backdrop" role="presentation" onClick={onCancel}>
      <section className="confirm-dialog" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <span className="dialog-icon"><Trash2 size={19} /></span>
        <h2>{title}</h2>
        <p>{description}</p>
        <div>
          <button className="button button-outline" onClick={onCancel}>Cancel</button>
          <button className="button button-danger" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </section>
    </div>
  );
}

function DownloadsScreen({ onGo, entries = [], onRetry, onSave, onRemove }) {
  return (
    <main className="page-screen">
      <TopBar onGo={onGo} onSearch={() => onGo('search')} onNotifications={() => onGo('notifications')} onProfile={() => onGo('profile')} />
      <div className="page-container downloads-page">
        <PageTitle eyebrow="OFFLINE MEDIA" title="Downloads" description="Full-fidelity media files stored in browser storage for instant offline viewing." right={<span className="download-mode-pill"><Wifi size={14} /> Local IndexedDB</span>} />
        {entries.length ? (
          <div className="download-list">
            {entries.map((entry) => {
              const item = referenceToContent(entry.content);
              const isDone = entry.status === 'completed' || entry.state === 'ready';
              const isDownloading = entry.status === 'downloading';
              const mbReceived = entry.downloadedBytes ? (entry.downloadedBytes / (1024 * 1024)).toFixed(1) : '0';
              const mbTotal = entry.totalBytes ? (entry.totalBytes / (1024 * 1024)).toFixed(1) : '?';
              const percent = entry.percent || 0;

              return (
                <article className="download-card" key={entry.id}>
                  <span className="download-art">{item?.poster ? <img src={item.poster} alt="" onError={(event) => event.currentTarget.remove()} /> : <span className="poster-art-fallback" />}</span>
                  <div className="download-info">
                    <div className="download-title-line">
                      <div>
                        <span className="eyebrow">{isDone ? 'READY OFFLINE' : isDownloading ? 'DOWNLOADING CHUNKS' : 'DOWNLOAD QUEUE'}</span>
                        <h2>{item?.title || 'Unknown title'}</h2>
                        <span>{[entry.label, entry.resolution || '480p', entry.startedAt ? new Date(entry.startedAt).toLocaleDateString() : ''].filter(Boolean).join(' · ')}</span>
                      </div>
                      <button className="download-more" aria-label="Delete download" onClick={() => onRemove(entry)}><X size={16} /></button>
                    </div>

                    {isDownloading && (
                      <div className="download-progress-box" style={{ marginTop: '0.6rem', marginBottom: '0.6rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-muted, #94a3b8)', marginBottom: '0.25rem' }}>
                          <span>{mbReceived} MB / {mbTotal} MB</span>
                          <span>{Math.round(percent)}%</span>
                        </div>
                        <ProgressBar value={percent} />
                      </div>
                    )}

                    <div className={`download-state ${isDone ? 'download-state-ready' : ''}`}>
                      {isDone ? <Check size={14} /> : isDownloading ? <Loader2 size={14} className="animate-spin" /> : null}
                      <strong>{isDone ? 'Ready to stream offline' : isDownloading ? 'Downloading media chunks...' : 'Queued'}</strong>
                    </div>
                    <small>{isDone ? 'Saved to local device storage. Playable without internet.' : 'Stream chunking in progress via media proxy.'}</small>
                    <div className="download-actions">
                      {isDone && <button className="download-play" onClick={() => onSave(entry)}><Play size={13} fill="currentColor" /> Play file</button>}
                      <button className="download-more" onClick={() => onRemove(entry)} style={{ marginLeft: isDone ? '0.5rem' : 0 }}>Remove</button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <EmptyState icon={Download} title="No downloads yet." description="Open any movie or episode and tap download to store it for offline viewing." actionLabel="Browse catalog" onAction={() => onGo('discover')} />
        )}
      </div>
    </main>
  );
}

function ProfileScreen({ onGo, user, isOffline, historyCount, savedCount }) {
  const profileLinks = [
    { title: 'Continue watching', detail: 'Resume active titles', icon: Play, route: 'continue' },
    { title: 'Watch history', detail: `${historyCount} recorded ${historyCount === 1 ? 'session' : 'sessions'}`, icon: History, route: 'history' },
    { title: 'My List', detail: `${savedCount} saved ${savedCount === 1 ? 'title' : 'titles'}`, icon: Heart, route: 'list' },
    { title: 'Downloads', detail: 'Offline media files', icon: Download, route: 'downloads' },
  ];
  const settingsLinks = [
    { title: 'Preferences', detail: 'Theme, appearance & subtitles', icon: Settings, route: 'settings' },
    { title: 'TV Mode', detail: 'Switch to big-screen 10-foot experience', icon: Tv, route: 'tv-home' },
    { title: 'About VEYRA', detail: 'Version 1.0.0 · Pure Frontend Streaming', icon: CircleHelp, route: 'settings' },
  ];
  return (
    <main className="page-screen">
      <TopBar onGo={onGo} onSearch={() => onGo('search')} onNotifications={() => onGo('notifications')} onProfile={() => onGo('profile')} />
      <div className="page-container profile-page">
        <PageTitle eyebrow="YOUR ACCOUNT" title="My Profile" description="All data is stored securely on your browser." />
        <section className="profile-card">
          <div className="profile-avatar">{user?.name?.slice(0, 1)?.toUpperCase() || 'V'}<span /></div>
          <div className="profile-identity">
            <span className="eyebrow">LOCAL VIEWER</span>
            <h2>{user?.name || 'Veyra Viewer'}</h2>
            <p>Private offline-first session</p>
          </div>
          <button className="profile-edit" onClick={() => onGo('settings')}>Preferences <ChevronRight size={15} /></button>
          <div className="profile-plan"><VeyraMark size={18} /><span>VEYRA<small>PREMIUM</small></span><i /> <strong>Independent Cinema</strong></div>
        </section>
        <div className="profile-columns">
          <section><SectionLabel>YOUR LIBRARY</SectionLabel><div className="profile-link-list">{profileLinks.map(({ title, detail, icon: Icon, route }) => <button className="profile-link-row" key={title} onClick={() => onGo(route)}><span className="profile-link-icon"><Icon size={17} /></span><span><strong>{title}</strong><small>{detail}</small></span><ChevronRight size={16} /></button>)}</div></section>
          <section><SectionLabel>APP SETTINGS</SectionLabel><div className="profile-link-list">{settingsLinks.map(({ title, detail, icon: Icon, route }) => <button className="profile-link-row" key={title} onClick={() => onGo(route)}><span className="profile-link-icon"><Icon size={17} /></span><span><strong>{title}</strong><small>{detail}</small></span><ChevronRight size={16} /></button>)}</div></section>
        </div>
        <div className="profile-quick-actions">
          <button onClick={() => onGo('tv-home')}><Tv size={17} /><span><strong>Open TV Experience</strong><small>Optimized for keyboard & remote control</small></span><ChevronRight size={16} /></button>
          <div className="profile-link-row"><span className="profile-link-icon">{isOffline ? <WifiOff size={17} /> : <Wifi size={17} />}</span><span><strong>{isOffline ? 'Offline' : 'Online'}</strong><small>{isOffline ? 'Offline mode active' : 'Connected · Ready to stream'}</small></span></div>
        </div>
      </div>
    </main>
  );
}

function SettingsScreen({ onGo, settings, setSettings, historyCount, onClearHistory }) {
  const update = (key, value) => setSettings((current) => ({ ...current, [key]: value }));
  const rows = [
    { title: 'Subtitle language', detail: 'Default subtitle language', key: 'language', options: ['English', 'Español', 'Français', 'العربية'], icon: Languages },
    { title: 'Appearance theme', detail: 'Dark, Light, or follow your device', key: 'appearance', options: ['Dark', 'Light', 'System'], icon: Moon },
  ];
  return (
    <main className="page-screen">
      <TopBar onGo={onGo} onSearch={() => onGo('search')} onNotifications={() => onGo('notifications')} onProfile={() => onGo('profile')} />
      <div className="page-container settings-page">
        <button className="inline-back" onClick={() => onGo('profile')}><ChevronLeft size={16} /> Profile</button>
        <PageTitle eyebrow="CUSTOMIZE" title="Settings" description="Preferences saved locally on this device." />
        <section className="settings-group">
          <SectionLabel>APP PREFERENCES</SectionLabel>
          {rows.map(({ title, detail, key, options, icon: Icon }) => (
            <div className="settings-row" key={key}>
              <span className="setting-symbol"><Icon size={17} /></span>
              <span className="setting-copy"><strong>{title}</strong><small>{detail}</small></span>
              <label className="setting-select">
                <select aria-label={title} value={settings[key]} onChange={(event) => update(key, event.target.value)}>
                  {options.map((option) => <option key={option}>{option}</option>)}
                </select>
                <ChevronDown size={14} />
              </label>
            </div>
          ))}
        </section>
        <section className="settings-group">
          <SectionLabel>STREAMING ENGINE</SectionLabel>
          <p className="settings-disclaimer">Streams are delivered via high-definition HTML5 video with full playback controls, subtitle support, and instant seeking. All catalog titles and media files are built directly into the app with zero external API dependencies.</p>
        </section>
        <section className="settings-group">
          <SectionLabel>LOCAL STORAGE</SectionLabel>
          <p className="settings-disclaimer">{historyCount} watch session records are saved locally on this browser. My List and downloads are stored locally and stay private.</p>
          {historyCount > 0 && (
            <button className="settings-link-row" onClick={onClearHistory}>
              <span className="setting-symbol"><Trash2 size={17} /></span>
              <span className="setting-copy"><strong>Clear watch history</strong><small>Remove all playback records from this device</small></span>
              <ChevronRight size={17} />
            </button>
          )}
        </section>
      </div>
    </main>
  );
}

function TVHomeScreen({ onGo, onOpen, onPlay, onSearch, onProfile, featured, sections = [], loading }) {
  const hero = featured || null;
  const rails = sections;

  return (
    <main className="tv-home-screen">
      <aside className="tv-sidebar">
        <Brand onClick={() => onGo('tv-home')} data-tv-focus="true" />
        <nav>
          <button className="tv-nav-active" data-tv-focus="true" onClick={() => onGo('tv-home')}><span><Play size={18} /></span>Home</button>
          <button data-tv-focus="true" onClick={onSearch}><span><Search size={18} /></span>Search</button>
          <button data-tv-focus="true" onClick={() => onGo('list')}><span><Heart size={18} /></span>My List</button>
          <button data-tv-focus="true" onClick={onProfile}><span><UserRound size={18} /></span>Profile</button>
        </nav>
        <div className="tv-sidebar-bottom">
          <span className="tv-avatar">V</span>
          <span>Viewer</span>
          <button data-tv-focus="true" onClick={() => onGo('home')}>Exit TV mode <ArrowRight size={14} /></button>
        </div>
      </aside>
      <div className="tv-main">
        <div className="tv-topline">
          <span className="tv-now"><span /> CINEMATIC 10-FOOT EXPERIENCE</span>
          <div><span className="tv-clock">VEYRA</span><button data-tv-focus="true" onClick={onProfile} aria-label="Open profile"><UserRound size={17} /></button></div>
        </div>
        <section className="tv-feature" style={{ '--feature-art': hero?.backdrop ? `url('${hero.backdrop}')` : 'none' }}>
          <div className="tv-feature-wash" />
          <div className="tv-feature-copy">
            <span className="eyebrow"><VeyraMark size={14} /> FEATURED CINEMA</span>
            <h1>{hero?.title || 'Featured Story'}</h1>
            <p>{hero?.synopsis || 'Explore an extraordinary collection of movies and series ready to stream.'}</p>
            <div className="tv-meta">
              {hero?.rating && <span><Star size={13} fill="currentColor" /> {hero.rating}</span>}
              {hero?.year && <span>{hero.year}</span>}
              {hero?.runtime && <span>{hero.runtime}</span>}
            </div>
            <div className="tv-feature-actions">
              <button className="button button-primary" data-tv-focus="true" onClick={() => onPlay(hero)}><Play size={16} fill="currentColor" /> Watch Now</button>
              <button className="button button-glass" data-tv-focus="true" onClick={() => onOpen(hero)}>Explore title <ArrowRight size={15} /></button>
            </div>
          </div>
          <span className="tv-feature-aside">VEYRA <i>ORIGINALS</i></span>
        </section>
        <section className="tv-rails">
          {rails.map((section) => <ContentRail key={section.id} title={section.title} items={section.items} onItemClick={onOpen} tvFocus compact actionLabel="" />)}
        </section>
      </div>
      <div className="tv-remote-hint tv-home-hint"><span>↑↓ MOVE</span><span>OK SELECT</span><span>BACK RETURN</span></div>
    </main>
  );
}

export {
  HomeScreen,
  DiscoverScreen,
  SearchScreen,
  DetailScreen,
  PlayerScreen,
  MyListScreen,
  ContinueScreen,
  HistoryScreen,
  DownloadsScreen,
  ProfileScreen,
  SettingsScreen,
  TVHomeScreen,
};

export default function App() {
  const [view, setView] = useState(() => initialRoute());
  const [selectedTitle, setSelectedTitle] = useState(null);
  const [playback, setPlayback] = useState(null);
  const [savedItems, setSavedItems] = useState(readSavedReferences);
  const [history, setHistory] = useState(readHistory);
  const [downloads, setDownloads] = useState(readDownloads);
  const [settings, setSettings] = useState(readSettings);
  const [user, setUser] = useState({ name: 'Viewer', email: '', uid: '' });
  const [userId, setUserId] = useState('');
  const [selectedType, setSelectedType] = useState('all');
  const [toast, setToast] = useState('');
  const [isOffline, setIsOffline] = useState(() => typeof navigator !== 'undefined' ? !navigator.onLine : false);
  const toastTimer = useRef(null);

  // Live Zarhosting Catalog State
  const [liveCatalog, setLiveCatalog] = useState({
    loading: true,
    error: '',
    featured: null,
    featuredItems: [],
    sections: [],
    catalog: [],
  });

  const loadHome = useCallback(async () => {
    try {
      const data = await fetchCatalogHome();
      if (data && data.sections && data.sections.length > 0) {
        const allItems = [
          ...(data.banner || []),
          ...data.sections.flatMap((s) => s.items || []),
        ];
        const uniqueAll = Array.from(new Map(allItems.map((i) => [i.id, i])).values());
        setLiveCatalog({
          loading: false,
          error: '',
          featured: data.banner?.[0] || data.sections[0]?.items?.[0] || null,
          featuredItems: (data.banner && data.banner.length > 0) ? data.banner : (data.sections[0]?.items?.slice(0, 8) || []),
          sections: data.sections,
          catalog: uniqueAll,
        });
      }
    } catch (err) {
      console.warn('Live catalog home note:', err.message);
      setLiveCatalog((prev) => ({ ...prev, loading: false }));
    }
  }, []);

  useEffect(() => {
    loadHome();
  }, [loadHome]);

  // Auth & Firestore synchronization
  useEffect(() => {
    const unsubAuth = onUserReady((uid) => {
      setUserId(uid);
      setUser((u) => ({ ...u, uid }));

      // Subscribe to Firestore watchlist
      const unsubWatchlist = subscribeUserWatchlist(uid, (items) => {
        if (items && items.length > 0) {
          setSavedItems(items);
        }
      });

      // Subscribe to Firestore history
      const unsubHistory = subscribeUserHistory(uid, (records) => {
        if (records && records.length > 0) {
          const mapped = records.map((r) => ({
            id: `${r.subjectId || r.id}::${r.season || 0}:${r.episode || 0}`,
            content: {
              id: r.subjectId || r.id,
              subjectId: r.subjectId,
              detailPath: r.detailPath,
              title: r.title,
              poster: r.poster,
              type: r.type,
            },
            season: r.season,
            episode: r.episode,
            label: r.type === 'series' ? `Season ${r.season || 1} · Ep ${r.episode || 1}` : 'Feature Film',
            position: r.progressSeconds,
            duration: r.durationSeconds,
            percent: r.durationSeconds > 0 ? (r.progressSeconds / r.durationSeconds) * 100 : 0,
            completed: r.durationSeconds > 0 && r.progressSeconds >= r.durationSeconds * 0.95,
            updatedAt: r.updatedAt,
          }));
          setHistory(mapped);
        }
      });

      return () => {
        unsubWatchlist();
        unsubHistory();
      };
    });

    return () => unsubAuth();
  }, []);

  useEffect(() => writeStore(LIST_KEY, savedItems), [savedItems]);
  useEffect(() => writeStore(HISTORY_KEY, history), [history]);
  useEffect(() => writeStore(DOWNLOADS_KEY, downloads), [downloads]);
  useEffect(() => writeStore(SETTINGS_KEY, settings), [settings]);

  // Theme application (Dark, Light, System)
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const query = window.matchMedia?.('(prefers-color-scheme: light)');
    const apply = () => {
      let isLight = settings.appearance === 'Light';
      if (settings.appearance === 'System') isLight = Boolean(query?.matches);
      document.documentElement.dataset.theme = isLight ? 'light' : 'dark';
    };
    apply();
    if (!query?.addEventListener) return undefined;
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, [settings.appearance]);

  // Online / offline listeners
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onOnline = () => setIsOffline(false);
    const onOffline = () => setIsOffline(true);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const showToast = (message) => {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 3000);
  };

  const isSaved = (id) => savedItems.some((item) => item.id === id || item.subjectId === id || item.providerItemId === id);

  const toggleSaved = (item) => {
    if (!item) return;
    setSavedItems((current) => {
      const exists = current.some((saved) => saved.id === item.id || saved.subjectId === item.subjectId || saved.providerItemId === item.providerItemId);
      if (exists) {
        showToast(`Removed "${item.title}" from My List`);
        if (userId) syncWatchlistRemove(userId, item.subjectId || item.id);
        return current.filter((saved) => saved.id !== item.id && saved.subjectId !== item.subjectId && saved.providerItemId !== item.providerItemId);
      }
      showToast(`Added "${item.title}" to My List`);
      if (userId) syncWatchlistAdd(userId, item);
      return [...current, item];
    });
  };

  const handleOpenTitle = (item) => {
    setSelectedTitle(item);
    setView('detail');
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  const handlePlay = (item, episode = null, seasonValue = null, startPosition = 0) => {
    setPlayback({
      content: item.content || item,
      episode: item.episode || episode,
      season: item.season ?? seasonValue,
      startPosition: item.position || startPosition,
    });
    setView('player');
  };

  const handleDownload = async (item, { season = 0, episode = 0, label } = {}) => {
    const dlId = `dl-${item.id}-${season}-${episode}`;
    const exists = downloads.some((d) => d.id === dlId);
    if (exists && exists.status === 'completed') {
      showToast(`"${item.title}" is already in Downloads`);
      return;
    }

    showToast(`Starting download for "${item.title}"...`);

    const newEntry = {
      id: dlId,
      content: item,
      subjectId: item.subjectId || item.id,
      detailPath: item.detailPath || item.slug,
      season,
      episode,
      label: label || (item.type === 'series' ? `Season ${season} · Episode ${episode}` : 'Feature Film'),
      resolution: '480p',
      status: 'downloading',
      downloadedBytes: 0,
      totalBytes: 0,
      percent: 0,
      startedAt: new Date().toISOString(),
    };

    setDownloads((cur) => [newEntry, ...cur.filter((d) => d.id !== dlId)]);

    try {
      const subjectId = item.subjectId || item.id;
      const detailPath = item.detailPath || item.slug;
      const streamRes = await resolveStream(subjectId, detailPath, season, episode).catch(() => null);

      let targetUrl = '';
      if (streamRes && streamRes.sources && streamRes.sources.length > 0) {
        const preferred = streamRes.sources.find((s) => s.resolution === 480) || streamRes.sources[0];
        targetUrl = preferred.url;
      } else if (item.trailerUrl) {
        targetUrl = item.trailerUrl;
      } else if (item.qualities && item.qualities.length > 0) {
        targetUrl = item.qualities[0].streamUrl;
      }

      if (!targetUrl) {
        showToast(`Could not resolve stream source for download`);
        setDownloads((cur) => cur.map((d) => d.id === dlId ? { ...d, status: 'failed' } : d));
        return;
      }

      const proxyUrl = getMediaProxyUrl(targetUrl);

      startMediaDownload({
        id: dlId,
        streamUrl: targetUrl,
        proxyUrl,
        onProgress: ({ receivedBytes, totalBytes, percent }) => {
          setDownloads((cur) =>
            cur.map((d) =>
              d.id === dlId
                ? {
                    ...d,
                    downloadedBytes: receivedBytes,
                    totalBytes,
                    percent,
                  }
                : d
            )
          );
        },
        onComplete: (blob) => {
          showToast(`Completed download of "${item.title}"`);
          setDownloads((cur) =>
            cur.map((d) =>
              d.id === dlId
                ? {
                    ...d,
                    status: 'completed',
                    percent: 100,
                  }
                : d
            )
          );
          if (userId) {
            syncDownloadRecord(userId, {
              ...newEntry,
              status: 'completed',
              totalBytes: blob.size,
              downloadedBytes: blob.size,
            });
          }
        },
        onError: (err) => {
          console.warn('Download error:', err.message);
          showToast(`Download note: ${err.message}`);
          setDownloads((cur) =>
            cur.map((d) => (d.id === dlId ? { ...d, status: 'failed' } : d))
          );
        },
      });
    } catch (err) {
      console.warn('Download handler error:', err);
    }
  };

  const handleProgress = ({ content, season, episode, label, position, duration, percent, completed }) => {
    if (!content?.id) return;
    const key = `${content.id}::${season ?? 0}:${episode ?? 0}`;
    const entry = {
      id: key,
      content,
      season,
      episode,
      label,
      position,
      duration,
      percent,
      completed,
      updatedAt: new Date().toISOString(),
    };
    setHistory((cur) => [entry, ...cur.filter((e) => e.id !== key)].slice(0, HISTORY_LIMIT));

    if (userId) {
      syncHistoryUpdate(userId, {
        id: content.id,
        subjectId: content.subjectId || content.id,
        detailPath: content.detailPath,
        title: content.title,
        poster: content.poster,
        type: content.type,
        season,
        episode,
        progressSeconds: position,
        durationSeconds: duration,
      });
    }
  };

  const progressFor = (contentId, season, episode) => {
    const key = `${contentId}::${season ?? 0}:${episode ?? 0}`;
    return history.find((e) => e.id === key);
  };

  const progressItems = useMemo(() => {
    return history
      .filter((e) => !e.completed && e.percent >= CONTINUE_MIN_PERCENT && e.percent <= CONTINUE_MAX_PERCENT)
      .map((e) => ({
        ...e.content,
        position: e.position,
        percent: e.percent,
        badge: `${Math.round(e.percent)}%`,
      }));
  }, [history]);

  const continueItems = useMemo(() => {
    return history
      .filter((e) => !e.completed && e.percent >= CONTINUE_MIN_PERCENT && e.percent <= CONTINUE_MAX_PERCENT)
      .map((e) => ({
        id: e.id,
        content: e.content,
        percent: e.percent,
        label: e.label,
        position: e.position,
        remainingLabel: `${minutesLeft(e.position, e.duration)} min left`,
      }));
  }, [history]);

  return (
    <div className="app-shell">
      {view === 'home' && (
        <HomeScreen
          onGo={setView}
          onSearch={() => setView('search')}
          onNotifications={() => setView('profile')}
          onProfile={() => setView('profile')}
          onOpen={handleOpenTitle}
          onPlay={handlePlay}
          isSaved={isSaved}
          onToggleSaved={toggleSaved}
          featured={liveCatalog.featured}
          featuredItems={liveCatalog.featuredItems}
          sections={liveCatalog.sections}
          progressItems={progressItems}
          progressFor={progressFor}
          loading={liveCatalog.loading}
          error={liveCatalog.error}
          onRetry={loadHome}
        />
      )}

      {view === 'discover' && (
        <DiscoverScreen
          onGo={setView}
          onOpen={handleOpenTitle}
          selectedType={selectedType}
          setSelectedType={setSelectedType}
          sections={liveCatalog.sections}
          items={liveCatalog.catalog}
          loading={liveCatalog.loading}
          error={liveCatalog.error}
          onRetry={loadHome}
        />
      )}

      {view === 'search' && (
        <SearchScreen
          onGo={setView}
          onOpen={handleOpenTitle}
        />
      )}

      {view === 'detail' && selectedTitle && (
        <DetailScreen
          item={selectedTitle}
          onBack={() => setView('home')}
          onPlay={handlePlay}
          onToggleSaved={toggleSaved}
          isSaved={isSaved}
          onDownload={handleDownload}
          onOpen={handleOpenTitle}
          isTV={false}
          progressFor={progressFor}
        />
      )}

      {view === 'player' && playback && (
        <PlayerScreen
          content={playback.content}
          episode={playback.episode}
          season={playback.season}
          startPosition={playback.startPosition}
          onBack={() => setView(selectedTitle ? 'detail' : 'home')}
          onProgress={handleProgress}
          preferredLanguage={settings.language}
          isTV={false}
        />
      )}

      {view === 'list' && (
        <MyListScreen
          onGo={setView}
          onOpen={handleOpenTitle}
          savedItems={savedItems}
          onRemove={(item) => toggleSaved(item)}
        />
      )}

      {view === 'continue' && (
        <ContinueScreen
          onGo={setView}
          onOpen={handleOpenTitle}
          items={continueItems}
          onPlay={handlePlay}
        />
      )}

      {view === 'history' && (
        <HistoryScreen
          onGo={setView}
          entries={history}
          onClear={() => {
            setHistory([]);
          }}
          onRemove={(entry) => {
            setHistory((cur) => cur.filter((e) => e.id !== entry.id));
            if (userId && entry.content?.id) syncHistoryDelete(userId, entry.content.id);
          }}
          onOpen={handleOpenTitle}
          onResume={(entry) => handlePlay(entry.content, null, null, entry.position)}
        />
      )}

      {view === 'downloads' && (
        <DownloadsScreen
          onGo={setView}
          entries={downloads}
          onRetry={() => {}}
          onSave={async (entry) => {
            const blob = await getMediaBlob(entry.id);
            if (blob) {
              const blobUrl = URL.createObjectURL(blob);
              handlePlay({
                ...entry.content,
                qualities: [{ label: 'Offline (Downloaded)', resolution: 720, streamUrl: blobUrl, isOffline: true }],
              }, { episodeNumber: entry.episode, episodeNo: entry.episode }, entry.season);
            } else {
              handlePlay(entry.content, { episodeNumber: entry.episode, episodeNo: entry.episode }, entry.season);
            }
          }}
          onRemove={async (entry) => {
            cancelMediaDownload(entry.id);
            await deleteMediaBlob(entry.id);
            setDownloads((cur) => cur.filter((d) => d.id !== entry.id));
            if (userId) syncDownloadDelete(userId, entry.id);
          }}
        />
      )}

      {view === 'profile' && (
        <ProfileScreen
          onGo={setView}
          user={user}
          isOffline={isOffline}
          historyCount={history.length}
          savedCount={savedItems.length}
        />
      )}

      {view === 'settings' && (
        <SettingsScreen
          onGo={setView}
          settings={settings}
          setSettings={setSettings}
          historyCount={history.length}
          onClearHistory={() => setHistory([])}
        />
      )}

      {view === 'tv-home' && (
        <TVHomeScreen
          onGo={setView}
          onOpen={handleOpenTitle}
          onPlay={handlePlay}
          onSearch={() => setView('search')}
          onProfile={() => setView('profile')}
          featured={liveCatalog.featured}
          sections={liveCatalog.sections}
          loading={liveCatalog.loading}
        />
      )}

      {!['player', 'tv-home'].includes(view) && (
        <BottomNav active={['home', 'search', 'list', 'profile'].includes(view) ? view : ''} onGo={setView} />
      )}

      <Toast message={toast} onClose={() => setToast('')} />
    </div>
  );
}
