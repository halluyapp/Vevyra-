import React from 'react';
import {
  ArrowLeft,
  Bell,
  Bookmark,
  ChevronRight,
  CirclePlay,
  Compass,
  Download,
  History,
  Home,
  Search,
  UserRound,
} from 'lucide-react';

export function VeyraMark({ size = 32, className = '' }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <rect width="40" height="40" rx="12" fill="#E5093F" />
      <path d="M9.5 9.5h6.7L20 20.6l3.8-11.1h6.7l-8 21h-5L9.5 9.5Z" fill="white" />
      <path d="m24.8 23.3 6.3 7.2h-5.8l-3.6-4.2 3.1-3Z" fill="#FF9EAC" />
    </svg>
  );
}

export function Brand({ compact = false, onClick, ...props }) {
  return (
    <button className={`brand ${compact ? 'brand-compact' : ''}`} onClick={onClick} aria-label="VEYRA home" {...props}>
      <VeyraMark size={compact ? 29 : 34} />
      {!compact && <span>VEYRA</span>}
    </button>
  );
}

export function TopBar({ onGo, onSearch, onNotifications, onProfile, isHome = false, active = '' }) {
  return (
    <header className={`topbar ${isHome ? 'topbar-home' : ''}`}>
      <div className="topbar-left">
        <Brand onClick={() => onGo('home')} />
        <nav className="topbar-links" aria-label="Primary navigation">
          <button className={active === 'home' ? 'toplink active' : 'toplink'} onClick={() => onGo('home')}>Home</button>
          <button className={active === 'discover' ? 'toplink active' : 'toplink'} onClick={() => onGo('discover')}>Discover</button>
          <button className="toplink tv-link" onClick={() => onGo('tv-home')}>For TV <CirclePlay size={14} /></button>
        </nav>
      </div>
      <div className="topbar-actions">
        <button className="icon-button top-search" onClick={onSearch} aria-label="Search"><Search size={19} /></button>
        <button className="icon-button notification-shortcut" onClick={onNotifications} aria-label="Notifications"><Bell size={18} /><span className="sr-only">Notifications</span></button>
        <button className="avatar-button" onClick={onProfile} aria-label="Open profile"><span className="avatar avatar-small">A</span></button>
      </div>
    </header>
  );
}

const navItems = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'search', label: 'Search', icon: Search },
  { id: 'list', label: 'My List', icon: Bookmark },
  { id: 'profile', label: 'Me', icon: UserRound },
];

export function BottomNav({ active, onGo }) {
  return (
    <nav className="bottom-nav" aria-label="Main navigation">
      {navItems.map(({ id, label, icon: Icon }) => (
        <button key={id} className={`bottom-nav-item ${active === id ? 'is-active' : ''}`} onClick={() => onGo(id)} aria-current={active === id ? 'page' : undefined}>
          <span className="nav-icon-wrap"><Icon size={19} strokeWidth={active === id ? 2.2 : 1.7} /></span>
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

export function BackButton({ onClick, label = 'Back' }) {
  return <button className="back-button" onClick={onClick} aria-label={label}><ArrowLeft size={19} /><span>{label}</span></button>;
}

export function ProgressBar({ value = 0, className = '' }) {
  return (
    <div className={`progress-track ${className}`} role="progressbar" aria-valuenow={value} aria-valuemin="0" aria-valuemax="100" aria-label={`${value}% watched`}>
      <span className="progress-fill" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function PosterCard({ item, onClick, progress, subtitle, onRemove, tvFocus = false, compact = false }) {
  if (!item) return null;
  return (
    <article className={`poster-card-wrap ${compact ? 'poster-compact' : ''}`}>
      <button className="poster-card" onClick={() => onClick?.(item)} data-tv-focus={tvFocus ? 'true' : undefined} aria-label={`Open ${item.title}`}>
        <span className="poster-art">
          {item.poster ? <img src={item.poster} alt={`${item.title} artwork`} loading="lazy" onError={(event) => event.currentTarget.remove()} /> : <span className="poster-art-fallback" aria-hidden="true" />}
          <span className="poster-vignette" />
          {item.badge && <span className="poster-badge">{item.badge}</span>}
          {progress != null && <ProgressBar value={progress} className="poster-progress" />}
        </span>
        <span className="poster-copy">
          <strong>{item.title}</strong>
          <span>{subtitle || `${item.year}  ·  ${item.type === 'series' ? 'Series' : item.genres?.[0] || 'Film'}`}</span>
        </span>
      </button>
      {onRemove && <button className="poster-remove" onClick={() => onRemove(item)} aria-label={`Remove ${item.title} from My List`}><span>×</span></button>}
    </article>
  );
}

export function ContentRail({ title, eyebrow, items = [], onItemClick, progressFor, actionLabel = 'See all', onAction, compact = false, tvFocus = false, emptyText }) {
  return (
    <section className={`content-rail ${compact ? 'rail-compact' : ''}`}>
      <div className="rail-heading">
        <div>
          {eyebrow && <span className="eyebrow">{eyebrow}</span>}
          <h2>{title}</h2>
        </div>
        {onAction && actionLabel && <button className="rail-action" onClick={onAction}>{actionLabel}<ChevronRight size={15} /></button>}
      </div>
      {items.length ? (
        <div className="rail-track">
          {items.map((item) => <PosterCard key={item.id} item={item} onClick={onItemClick} progress={progressFor?.(item.id)} tvFocus={tvFocus} compact={compact} />)}
        </div>
      ) : <p className="rail-empty">{emptyText || 'More stories are on their way.'}</p>}
    </section>
  );
}

export function EmptyState({ icon: Icon = Bookmark, eyebrow = 'YOUR SPACE', title, description, actionLabel, onAction, quiet = false }) {
  return (
    <div className={`empty-state ${quiet ? 'empty-quiet' : ''}`}>
      <span className="empty-icon"><Icon size={26} strokeWidth={1.5} /></span>
      {eyebrow && <span className="eyebrow">{eyebrow}</span>}
      <h2>{title}</h2>
      <p>{description}</p>
      {actionLabel && <button className="button button-secondary" onClick={onAction}>{actionLabel}<ChevronRight size={16} /></button>}
    </div>
  );
}

export function ErrorState({ title = 'Something went wrong.', description = "We couldn't load this right now.", onRetry }) {
  return (
    <div className="error-state">
      <span className="error-mark">!</span>
      <div><h2>{title}</h2><p>{description}</p></div>
      {onRetry && <button className="button button-secondary" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function PageTitle({ eyebrow, title, description, right }) {
  return (
    <div className="page-title-row">
      <div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h1>{title}</h1>{description && <p>{description}</p>}</div>
      {right}
    </div>
  );
}

export function SearchEmpty() {
  return (
    <div className="search-empty">
      <span className="search-empty-mark"><Compass size={26} strokeWidth={1.4} /></span>
      <h2>Your next favourite starts here.</h2>
      <p>Search a title, a feeling, or someone you love watching.</p>
    </div>
  );
}

export function SkeletonRows({ count = 5 }) {
  return <div className="skeleton-row-list" aria-label="Loading"><span className="sr-only">Loading content</span>{Array.from({ length: count }, (_, i) => <div className="skeleton-row" key={i}><span className="skeleton skeleton-thumb" /><span className="skeleton-copy"><i className="skeleton" /><i className="skeleton short" /></span></div>)}</div>;
}

export function MiniAction({ children, onClick, label }) {
  return <button className="mini-action" onClick={onClick} aria-label={label}>{children}</button>;
}
