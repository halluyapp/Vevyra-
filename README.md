# VEYRA

VEYRA is a cinematic React 19 + Vite streaming app, packaged for Android with Capacitor. It browses and streams the **ZST Labs MovieBox API** (`https://api.zstlab.cyou`): a real catalog, real progress, real playback in a standard `<video>` element, and best-effort downloads with honest states.

- No auth, no accounts, no device management, no push notifications, no multi-device sync, no backend service.
- My List, history, download attempts and preferences live in `localStorage` on the device.
- VEYRA never falls back to sample titles, never simulates playback with a timer, and never opens an external video site.

## Catalog API configuration

**There is nothing to configure.** The ZST Labs endpoint and key are compiled into the app, so a fresh clone, `npm run dev`, the web build and the Android APK all talk to the real catalog with no `.env.local`, no repository secret and no extra setup:

```js
// src/services/moviebox/client.js
export const DEFAULT_API_BASE_URL = 'https://api.zstlab.cyou';
export const DEFAULT_API_KEY = 'zst_enmXGDIVEwb078T0xgSCeHau7aFsE8NkdI2czeTz';
```

Environment variables exist only as an **override** — for example to point a build at another deployment (`.env.example` documents them):

```dotenv
# optional; both values already have working defaults
VITE_MOVIEBOX_API_BASE_URL=https://api.zstlab.cyou
VITE_ZST_API_KEY=zst_...
```

Build-time environment wins when it is set; anything blank or missing falls back to the built-in values, so a blank variable can never break a working configuration. The Android workflow (`.github/workflows/android-apk.yml`) needs no secrets: it builds from the defaults and fails the job if the endpoint and key are missing from the produced bundle.

> **About the API key.** `VITE_*` values are compiled into the web bundle and the APK, so anyone who has the app can read the key — that is true by design here, because this project has no backend that could hold a secret on its behalf. The provider authenticates the *app*, not the person. Keep the repository private if you like, but treat the key as public: it is sent as the `x-api-key` header on every catalog request. If it is rotated or revoked, `/api/*` answers 401/403 and each catalog screen shows an explicit "the API rejected this build's key" message with a retry. To use a different key, put it in `.env.local` (git-ignored) or edit `DEFAULT_API_KEY`.

## Run locally

```bash
npm ci
npm run dev                  # already talks to the real catalog
```

Vite binds to `0.0.0.0`. If the configuration is ever empty or malformed, the app fails closed: catalog screens show an explicit configuration message with a retry, and no fixture content is rendered.

## Checks

```bash
npm test           # service-layer unit tests (normalizer, media, subtitles, client)
npm run test:ssr   # renders every screen through Vite SSR with real catalog shapes
npm run test:player # mounts the real player in a DOM and asserts the <video> gets a streamUrl
npm run build      # production bundle
npm run verify     # all four
```

`test:player` exists because a media response is not playback: it feeds the real client a
`/api/media` payload and fails if the `<video>` element ends up without a `src`, if the raw CDN
url is bound instead of the provider proxy link, or if the UI says PLAYING while the element has
no frames.

## Android debug APK

Requirements: Node.js 22, JDK 21, Android SDK platform and build tools 35.

```bash
npm ci
npm run build
npx cap sync android
cd android && ./gradlew assembleDebug
```

The APK lands in `android/app/build/outputs/apk/debug/app-debug.apk`. The GitHub Actions `Android APK` workflow runs the unit tests, the render smoke test, the web build and the Gradle build, then uploads the debug artifact. Release signing is not configured.

## What is wired to the provider

| Screen | Provider route |
| --- | --- |
| Home rails, hero, provider notice | `GET /api/homepage` |
| Trending rail | `GET /api/trending?page=0&perPage=18` |
| Hot movies & series rail | `GET /api/hot-movies-series` |
| Search idle state | `GET /api/popular-searches` |
| Search + load more | `GET /api/search?query=&subjectType=ALL\|MOVIES\|TV_SERIES&page=&perPage=` (`q` is used only if `query` returns nothing) |
| Search suggestions | `GET /api/search-suggestion?q=` |
| Details, seasons, cast | `GET /api/item-details?subjectId=&detailPath=` |
| "More like this" | `GET /api/recommendations?subjectId=` |
| Playback and captions | `GET /api/media?subjectId=&detailPath=&season=&episode=` |

Movies use `season=0&episode=0`; series use the real season and episode numbers the provider returns. Stream links are signed and expire, so media is cached for at most 60 seconds and re-requested on every play and quality change.

**Playback** uses `streamUrl` only — never the raw CDN `url`, which answers 429 without the provider proxy. Streams are progressive MP4 (`hls` and `dash` are empty), played in a plain `<video>` element with play/pause, a timeline, ±10s, a quality menu, a subtitle menu and an episodes menu for series. If a stream times out, is refused or errors, VEYRA steps down to the next lower quality and then reports “Source busy. Try again.” (about 20 seconds per attempt, never an endless spinner).

**Subtitles** show only the languages the provider actually returns, converted from SubRip to WebVTT and fetched through the provider's `/api/proxy` route.

**Downloads** are best effort. VEYRA asks the provider's `downloadUrl` for its first byte and gives up after 20 seconds; if the provider's proxy-download route hangs (it is under maintenance), the attempt is recorded as unavailable. No progress bars are faked and no files are invented.

## Local storage

| Key | Contents |
| --- | --- |
| `veyra-list:v2` | My List — compact provider references |
| `veyra-history:v2` | Real playback records (`position`, `duration`, `percent`, `updatedAt`) |
| `veyra-settings:v2` | Subtitle language and appearance |
| `veyra-downloads:v1` | Download attempts and their provider results |

History is written only by actual playback (throttled `timeupdate`, pause, unmount, end). Continue Watching lists records between 2% and 95% complete with the season/episode label and minutes left. The history artwork opens the title; the X button removes the row.

## Verification status

`/api/homepage`, `/api/trending`, `/api/popular-searches`, `/api/hot-movies-series`, `/api/search`, `/api/search-suggestion`, `/api/item-details`, `/api/recommendations` and `/api/media` were all checked against the live API while this work was done (see [docs/MOVIEBOX_INTEGRATION.md](docs/MOVIEBOX_INTEGRATION.md) for the exact observations and the response shapes). `/api/media` returned three progressive MP4 qualities plus 15 caption languages for `Inception` (`subjectId 6391474290696802080`, `detailPath inception-e1BOR6f19C7`).

Browser CORS behaviour, Android runtime networking, signed-link lifetimes, long-session streaming stability and real-device playback are **not verified** from the build environment. Downloads on the provider side are currently unreliable by design of the service, not of this app.
