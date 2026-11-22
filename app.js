const API_KEY = '257f548bfaa990b9cffb5b5f6ee2e40b';
const BASE_URL = 'https://api.themoviedb.org/3';
const IMG_ORIGINAL = 'https://image.tmdb.org/t/p/original';
const IMG_CARD = 'https://image.tmdb.org/t/p/w342'; // Crisp & ~45% faster to load on mobile/TV

const CATEGORIES = [
  { title: 'Trending Now', url: `/trending/all/week?api_key=${API_KEY}`, type: 'all' },
  { title: 'Popular Anime Series', url: `/discover/tv?api_key=${API_KEY}&with_genres=16&with_original_language=ja&sort_by=popularity.desc`, type: 'tv' },
  { title: 'Top Rated Movies', url: `/movie/top_rated?api_key=${API_KEY}`, type: 'movie' },
  { title: 'Popular TV Shows', url: `/tv/popular?api_key=${API_KEY}`, type: 'tv' },
  { title: 'Horror & Thriller Hits', url: `/discover/movie?api_key=${API_KEY}&with_genres=27&sort_by=popularity.desc`, type: 'movie' },
  { title: 'Comedy Favorites', url: `/discover/movie?api_key=${API_KEY}&with_genres=35&sort_by=popularity.desc`, type: 'movie' },
  { title: 'Top Anime Movies', url: `/discover/movie?api_key=${API_KEY}&with_genres=16&with_original_language=ja&sort_by=vote_count.desc`, type: 'movie' },
  { title: 'Action & Adventure', url: `/discover/movie?api_key=${API_KEY}&with_genres=28`, type: 'movie' }
];

// Genre definitions mapped accurately for both Movies and TV Shows
const GENRES = [
  { id: 'all', label: 'All', movie: null, tv: null },
  { id: 'horror', label: 'Horror', movie: '27', tv: '9648,10765' },
  { id: 'comedy', label: 'Comedy', movie: '35', tv: '35' },
  { id: 'action', label: 'Action', movie: '28', tv: '10759' },
  { id: 'thriller', label: 'Thriller', movie: '53', tv: '9648,80' },
  { id: 'romance', label: 'Romance', movie: '10749', tv: '10749' },
  { id: 'scifi', label: 'Sci-Fi', movie: '878', tv: '10765' },
  { id: 'drama', label: 'Drama', movie: '18', tv: '18' },
  { id: 'fantasy', label: 'Fantasy', movie: '14', tv: '10765' },
  { id: 'crime', label: 'Crime', movie: '80', tv: '80' },
  { id: 'documentary', label: 'Documentary', movie: '99', tv: '99' }
];

// Lightweight In-Memory API Cache
const apiCache = new Map();

let activeTab = 'home';
let activeGenre = 'all';
let gridPage = 1;
let hasMoreGridPages = false;
let isFetchingGrid = false;

let currentItem = null;
let currentSource = 'vidlink';
let selectedSeason = 1;
let selectedEpisode = 1;
let myList = JSON.parse(localStorage.getItem('streamflix_mylist')) || [];
let lastFocusedElement = null;

// Hero Carousel + Short Trailer State
let heroItems = [];
let heroIndex = 0;
let heroMuted = true;
let heroThumbnailTimer = null;
let heroAdvanceTimer = null;
let isHeroInView = true;

document.addEventListener('DOMContentLoaded', () => {
  renderGenreBar();
  loadHome();
  setupPerformanceObservers();

  // Passive scroll listener for smooth 60fps scrolling
  let scrollTicking = false;
  window.addEventListener('scroll', () => {
    if (!scrollTicking) {
      requestAnimationFrame(() => {
        document.getElementById('navbar').classList.toggle('scrolled', window.scrollY > 40);
        scrollTicking = false;
      });
      scrollTicking = true;
    }
  }, { passive: true });

  // Live Search (Handles 1+ chars cleanly with zero auto-delete)
  let searchTimer;
  const searchInput = document.getElementById('searchInput');
  const clearBtn = document.getElementById('clearSearchBtn');

  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    const rawValue = e.target.value;
    const query = rawValue.trim();

    clearBtn.classList.toggle('hidden', rawValue.length === 0);

    searchTimer = setTimeout(() => {
      if (query.length >= 1) {
        searchMedia(query);
      } else {
        setActiveTabButton(activeTab);
        refreshCurrentView();
      }
    }, 320);
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      clearTimeout(searchTimer);
      const query = searchInput.value.trim();
      if (query.length >= 1) searchMedia(query);
    }
  });

  // Android TV D-Pad Focus Auto-Scroll
  document.addEventListener('focusin', (e) => {
    const t = e.target;
    if (t && (t.classList.contains('card') || t.classList.contains('pill-btn') || t.classList.contains('srv-btn') || t.classList.contains('genre-pill'))) {
      t.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  });

  // Back / Escape closes player modal
  document.addEventListener('keydown', (e) => {
    const modal = document.getElementById('playerModal');
    if (!modal.classList.contains('hidden') && e.key === 'Escape') {
      e.preventDefault();
      closeModal();
    }
  });
});

async function fetchTMDB(endpoint) {
  if (apiCache.has(endpoint)) {
    return apiCache.get(endpoint);
  }
  const res = await fetch(`${BASE_URL}${endpoint}`);
  const data = await res.json();
  apiCache.set(endpoint, data);
  return data;
}

function setupPerformanceObservers() {
  // Pause off-screen Hero trailer when scrolled down to save CPU/RAM on TV & mobile
  const heroEl = document.getElementById('hero');
  if ('IntersectionObserver' in window && heroEl) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        isHeroInView = entry.isIntersecting;
        if (!isHeroInView) {
          stopHeroShowcase();
        } else if (!heroEl.classList.contains('hidden') && document.getElementById('playerModal').classList.contains('hidden')) {
          startHeroSlide(heroIndex);
        }
      });
    }, { threshold: 0.25 });
    observer.observe(heroEl);
  }

  // Pause hero video when browser tab is minimized/hidden
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopHeroShowcase();
    } else if (isHeroInView && !document.getElementById('hero').classList.contains('hidden')) {
      startHeroSlide(heroIndex);
    }
  });
}

/* ================= PARALLEL HOME LOAD ================= */

async function loadHome() {
  const rowsContainer = document.getElementById('rowsContainer');
  rowsContainer.innerHTML = '';

  // Fetch all categories simultaneously for instant startup
  const results = await Promise.all(CATEGORIES.map(cat => fetchTMDB(cat.url)));
  const frag = document.createDocumentFragment();

  results.forEach((data, i) => {
    const cat = CATEGORIES[i];
    const items = (data.results || []).filter(item => item.poster_path);

    if (i === 0 && items.length > 0) {
      heroItems = items.filter(item => item.backdrop_path).slice(0, 6);
      if (!heroItems.length) heroItems = items.slice(0, 6);
      renderHeroDots();
      startHeroSlide(0);
    }

    if (items.length > 0) {
      frag.appendChild(buildRowElement(cat.title, items, cat.type));
    }
  });

  rowsContainer.appendChild(frag);
}

/* ================= GENRE FILTER BAR ================= */

function renderGenreBar() {
  const bar = document.getElementById('genreBar');
  const frag = document.createDocumentFragment();

  GENRES.forEach(g => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'genre-pill' + (g.id === activeGenre ? ' active' : '');
    btn.dataset.genre = g.id;
    btn.textContent = g.label;
    btn.onclick = () => selectGenre(g.id);
    frag.appendChild(btn);
  });

  bar.innerHTML = '';
  bar.appendChild(frag);
}

function selectGenre(genreId) {
  activeGenre = genreId;
  document.querySelectorAll('.genre-pill').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.genre === genreId);
  });

  // Clear active search query when picking a genre pill
  const searchInput = document.getElementById('searchInput');
  if (searchInput.value.trim().length > 0) {
    searchInput.value = '';
    document.getElementById('clearSearchBtn').classList.add('hidden');
  }

  refreshCurrentView();
}

/* ================= UNIFIED VIEW & GENRE ROUTING ================= */

function setActiveTabButton(tab) {
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
}

function filterTab(tab, btnEl) {
  activeTab = tab;
  if (btnEl) {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    btnEl.classList.add('active');
  } else {
    setActiveTabButton(tab);
  }

  document.getElementById('searchInput').value = '';
  document.getElementById('clearSearchBtn').classList.add('hidden');
  refreshCurrentView();
}

function resetHome() {
  activeTab = 'home';
  activeGenre = 'all';
  setActiveTabButton('home');
  document.querySelectorAll('.genre-pill').forEach(b => b.classList.toggle('active', b.dataset.genre === 'all'));
  document.getElementById('searchInput').value = '';
  document.getElementById('clearSearchBtn').classList.add('hidden');
  refreshCurrentView();
}

function clearSearch() {
  const searchInput = document.getElementById('searchInput');
  searchInput.value = '';
  document.getElementById('clearSearchBtn').classList.add('hidden');
  setActiveTabButton(activeTab);
  refreshCurrentView();
  searchInput.focus();
}

async function refreshCurrentView() {
  const hero = document.getElementById('hero');
  const main = document.getElementById('mainContent');
  const rows = document.getElementById('rowsContainer');
  const gridSec = document.getElementById('gridSection');
  const genreBarWrap = document.getElementById('genreBarWrapper');

  // Show Home Rows only when on Home tab + 'all' genre
  if (activeTab === 'home' && activeGenre === 'all') {
    genreBarWrap.classList.remove('hidden');
    hero.classList.remove('hidden');
    main.classList.remove('no-hero');
    rows.classList.remove('hidden');
    gridSec.classList.add('hidden');
    if (isHeroInView) startHeroSlide(heroIndex);
    return;
  }

  // Otherwise show Grid View
  stopHeroShowcase();
  hero.classList.add('hidden');
  main.classList.add('no-hero');
  rows.classList.add('hidden');
  gridSec.classList.remove('hidden');

  if (activeTab === 'mylist') {
    genreBarWrap.classList.add('hidden');
    document.getElementById('loadMoreWrap').classList.add('hidden');
    document.getElementById('gridTitle').textContent = 'My Watchlist';
    const grid = document.getElementById('movieGrid');
    grid.innerHTML = myList.length ? '' : '<p style="color:#a3a8b8">Your watchlist is empty.</p>';
    const frag = document.createDocumentFragment();
    myList.forEach(item => frag.appendChild(createCard(item, item.savedType)));
    grid.appendChild(frag);
    return;
  }

  genreBarWrap.classList.remove('hidden');
  gridPage = 1;
  await fetchAndRenderGrid(false);
}

async function loadMoreResults() {
  if (isFetchingGrid || !hasMoreGridPages) return;
  gridPage += 1;
  await fetchAndRenderGrid(true);
}

async function fetchAndRenderGrid(append = false) {
  isFetchingGrid = true;
  const grid = document.getElementById('movieGrid');
  const gridTitle = document.getElementById('gridTitle');
  const loadMoreWrap = document.getElementById('loadMoreWrap');
  const loadMoreBtn = document.getElementById('loadMoreBtn');

  if (!append) {
    grid.innerHTML = '<p style="color:#a3a8b8">Loading...</p>';
    loadMoreWrap.classList.add('hidden');
  } else {
    loadMoreBtn.textContent = 'Loading...';
  }

  const genreObj = GENRES.find(g => g.id === activeGenre) || GENRES[0];
  let combinedItems = [];
  let maxPages = 1;

  try {
    if (activeTab === 'home') {
      // Filtered Genre across Movies & TV Shows
      gridTitle.textContent = `${genreObj.label} Movies & TV Shows`;
      const [movData, tvData] = await Promise.all([
        fetchTMDB(`/discover/movie?api_key=${API_KEY}&with_genres=${genreObj.movie}&sort_by=popularity.desc&page=${gridPage}`),
        fetchTMDB(`/discover/tv?api_key=${API_KEY}&with_genres=${genreObj.tv}&sort_by=popularity.desc&page=${gridPage}`)
      ]);
      const movies = (movData.results || []).filter(i => i.poster_path).map(i => ({ ...i, _type: 'movie' }));
      const shows = (tvData.results || []).filter(i => i.poster_path).map(i => ({ ...i, _type: 'tv' }));
      combinedItems = interleaveArrays(movies, shows);
      maxPages = Math.max(movData.total_pages || 1, tvData.total_pages || 1);
    } else if (activeTab === 'movies') {
      gridTitle.textContent = activeGenre === 'all' ? 'Popular Movies' : `${genreObj.label} Movies`;
      const endpoint = activeGenre === 'all'
        ? `/movie/popular?api_key=${API_KEY}&page=${gridPage}`
        : `/discover/movie?api_key=${API_KEY}&with_genres=${genreObj.movie}&sort_by=popularity.desc&page=${gridPage}`;
      const data = await fetchTMDB(endpoint);
      combinedItems = (data.results || []).filter(i => i.poster_path).map(i => ({ ...i, _type: 'movie' }));
      maxPages = data.total_pages || 1;
    } else if (activeTab === 'tv') {
      gridTitle.textContent = activeGenre === 'all' ? 'Popular TV Shows' : `${genreObj.label} TV Shows`;
      const endpoint = activeGenre === 'all'
        ? `/tv/popular?api_key=${API_KEY}&page=${gridPage}`
        : `/discover/tv?api_key=${API_KEY}&with_genres=${genreObj.tv}&sort_by=popularity.desc&page=${gridPage}`;
      const data = await fetchTMDB(endpoint);
      combinedItems = (data.results || []).filter(i => i.poster_path).map(i => ({ ...i, _type: 'tv' }));
      maxPages = data.total_pages || 1;
    } else if (activeTab === 'anime') {
      gridTitle.textContent = activeGenre === 'all' ? 'Popular Anime' : `${genreObj.label} Anime`;
      const tvGenres = activeGenre === 'all' ? '16' : `16,${genreObj.tv}`;
      const movGenres = activeGenre === 'all' ? '16' : `16,${genreObj.movie}`;
      const [animeTV, animeMov] = await Promise.all([
        fetchTMDB(`/discover/tv?api_key=${API_KEY}&with_genres=${tvGenres}&with_original_language=ja&sort_by=popularity.desc&page=${gridPage}`),
        fetchTMDB(`/discover/movie?api_key=${API_KEY}&with_genres=${movGenres}&with_original_language=ja&sort_by=popularity.desc&page=${gridPage}`)
      ]);
      const tvList = (animeTV.results || []).filter(i => i.poster_path).map(i => ({ ...i, _type: 'tv' }));
      const movList = (animeMov.results || []).filter(i => i.poster_path).map(i => ({ ...i, _type: 'movie' }));
      combinedItems = interleaveArrays(tvList, movList);
      maxPages = Math.max(animeTV.total_pages || 1, animeMov.total_pages || 1);
    }

    if (!append) grid.innerHTML = '';

    if (combinedItems.length === 0 && !append) {
      grid.innerHTML = '<p style="color:#a3a8b8">No titles found for this filter.</p>';
    } else {
      const frag = document.createDocumentFragment();
      combinedItems.forEach(item => frag.appendChild(createCard(item, item._type)));
      grid.appendChild(frag);
    }

    hasMoreGridPages = gridPage < maxPages;
    loadMoreWrap.classList.toggle('hidden', !hasMoreGridPages);
    loadMoreBtn.textContent = 'Load More';
  } finally {
    isFetchingGrid = false;
  }
}

function interleaveArrays(arr1, arr2) {
  const result = [];
  const len = Math.max(arr1.length, arr2.length);
  for (let i = 0; i < len; i++) {
    if (i < arr1.length) result.push(arr1[i]);
    if (i < arr2.length) result.push(arr2[i]);
  }
  return result;
}

/* ================= HERO CAROUSEL + 10s TRAILER PREVIEW ================= */

function renderHeroDots() {
  const dotsContainer = document.getElementById('heroDots');
  dotsContainer.innerHTML = '';
  heroItems.forEach((_, idx) => {
    const dot = document.createElement('button');
    dot.className = 'hero-dot' + (idx === heroIndex ? ' active' : '');
    dot.setAttribute('aria-label', `Slide ${idx + 1}`);
    dot.onclick = () => startHeroSlide(idx);
    dotsContainer.appendChild(dot);
  });
}

function updateHeroDots() {
  document.querySelectorAll('.hero-dot').forEach((dot, idx) => {
    dot.classList.toggle('active', idx === heroIndex);
  });
}

function stopHeroShowcase() {
  clearTimeout(heroThumbnailTimer);
  clearTimeout(heroAdvanceTimer);
  const videoWrapper = document.getElementById('heroVideoWrapper');
  const videoFrame = document.getElementById('heroVideoFrame');
  if (videoWrapper) videoWrapper.classList.remove('visible');
  if (videoFrame && videoFrame.src) videoFrame.src = '';
}

async function getTrailerKey(item, mediaType) {
  const endpoint = `/${mediaType}/${item.id}/videos?api_key=${API_KEY}`;
  try {
    const vidData = await fetchTMDB(endpoint);
    const results = vidData.results || [];
    const trailer =
      results.find(v => v.site === 'YouTube' && v.type === 'Trailer') ||
      results.find(v => v.site === 'YouTube' && v.type === 'Teaser') ||
      results.find(v => v.site === 'YouTube');
    return trailer ? trailer.key : null;
  } catch {
    return null;
  }
}

async function startHeroSlide(index) {
  if (!heroItems.length) return;
  stopHeroShowcase();

  heroIndex = (index + heroItems.length) % heroItems.length;
  updateHeroDots();

  const item = heroItems[heroIndex];
  const mediaType = item.media_type || (item.title ? 'movie' : 'tv');
  const hero = document.getElementById('hero');

  hero.style.backgroundImage = `url(${IMG_ORIGINAL}${item.backdrop_path || item.poster_path})`;
  document.getElementById('heroBadge').textContent = `TRENDING #${heroIndex + 1}`;
  document.getElementById('heroTitle').textContent = item.title || item.name;
  document.getElementById('heroOverview').textContent = item.overview || 'No description available.';

  document.getElementById('heroPlayBtn').onclick = () => openModal(item, mediaType);
  document.getElementById('heroListBtn').onclick = () => toggleMyList(item, mediaType);

  const trailerKey = await getTrailerKey(item, mediaType);

  heroThumbnailTimer = setTimeout(() => {
    if (trailerKey && isHeroInView && !hero.classList.contains('hidden')) {
      const videoWrapper = document.getElementById('heroVideoWrapper');
      const videoFrame = document.getElementById('heroVideoFrame');
      const muteParam = heroMuted ? 1 : 0;

      videoFrame.src = `https://www.youtube.com/embed/${trailerKey}?autoplay=1&mute=${muteParam}&controls=0&showinfo=0&rel=0&modestbranding=1&iv_load_policy=3&disablekb=1&fs=0&playsinline=1&enablejsapi=1`;
      videoWrapper.classList.add('visible');
    }

    heroAdvanceTimer = setTimeout(() => {
      startHeroSlide(heroIndex + 1);
    }, 10000);
  }, 2500);
}

function nextHeroSlide() {
  startHeroSlide(heroIndex + 1);
}

function prevHeroSlide() {
  startHeroSlide(heroIndex - 1);
}

function toggleHeroMute() {
  heroMuted = !heroMuted;
  document.getElementById('heroMuteBtn').textContent = heroMuted ? '🔇' : '🔊';

  const videoFrame = document.getElementById('heroVideoFrame');
  if (videoFrame && videoFrame.contentWindow) {
    const command = heroMuted ? 'mute' : 'unMute';
    videoFrame.contentWindow.postMessage(
      JSON.stringify({ event: 'command', func: command, args: '' }),
      '*'
    );
  }
}

/* ================= ROWS & CARDS ================= */

function buildRowElement(title, items, defaultType) {
  const rowDiv = document.createElement('section');
  rowDiv.className = 'row';

  const heading = document.createElement('h3');
  heading.className = 'section-title';
  heading.textContent = title;
  rowDiv.appendChild(heading);

  const postersDiv = document.createElement('div');
  postersDiv.className = 'row-posters';

  const frag = document.createDocumentFragment();
  items.forEach(item => {
    const type = item.media_type || defaultType;
    frag.appendChild(createCard(item, type));
  });

  postersDiv.appendChild(frag);
  rowDiv.appendChild(postersDiv);
  return rowDiv;
}

function createCard(item, type) {
  const card = document.createElement('div');
  card.className = 'card';
  card.setAttribute('tabindex', '0');
  card.setAttribute('role', 'button');

  const title = item.title || item.name;
  const year = (item.release_date || item.first_air_date || '').slice(0, 4);
  const rating = item.vote_average ? item.vote_average.toFixed(1) : 'N/A';

  card.setAttribute('aria-label', `${title} (${year || type.toUpperCase()})`);

  card.innerHTML = `
    <img src="${IMG_CARD}${item.poster_path}" alt="${title}" loading="lazy" decoding="async" />
    <div class="card-info">
      <div class="card-title">${title}</div>
      <div class="card-meta">
        <span>${year || type.toUpperCase()}</span>
        <span>★ ${rating}</span>
      </div>
    </div>
  `;

  card.onclick = () => openModal(item, type);
  card.onkeydown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openModal(item, type);
    }
  };
  return card;
}

/* ================= LIVE SEARCH ================= */

async function searchMedia(query) {
  stopHeroShowcase();
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('hero').classList.add('hidden');
  document.getElementById('mainContent').classList.add('no-hero');
  document.getElementById('genreBarWrapper').classList.add('hidden');
  document.getElementById('rowsContainer').classList.add('hidden');
  document.getElementById('loadMoreWrap').classList.add('hidden');

  const gridSec = document.getElementById('gridSection');
  const grid = document.getElementById('movieGrid');

  gridSec.classList.remove('hidden');
  document.getElementById('gridTitle').textContent = `Search Results for "${query}"`;
  grid.innerHTML = '<p style="color:#a3a8b8">Searching...</p>';

  const data = await fetchTMDB(`/search/multi?api_key=${API_KEY}&query=${encodeURIComponent(query)}`);
  const results = (data.results || []).filter(i => (i.media_type === 'movie' || i.media_type === 'tv') && i.poster_path);

  grid.innerHTML = '';
  if (!results.length) {
    grid.innerHTML = '<p style="color:#a3a8b8">No results found.</p>';
    return;
  }

  const frag = document.createDocumentFragment();
  results.forEach(item => frag.appendChild(createCard(item, item.media_type)));
  grid.appendChild(frag);
}

/* ================= PLAYER MODAL & TV SEASON/EPISODE PILLS ================= */

async function openModal(item, type) {
  lastFocusedElement = document.activeElement;
  stopHeroShowcase();
  currentItem = { ...item, savedType: type };

  const modal = document.getElementById('playerModal');
  modal.classList.remove('hidden');
  modal.scrollTop = 0;

  const title = item.title || item.name;
  const year = (item.release_date || item.first_air_date || '').slice(0, 4);
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalRating').textContent = `★ ${(item.vote_average || 0).toFixed(1)}`;
  document.getElementById('modalMeta').textContent = `${year} • ${type.toUpperCase()}`;
  document.getElementById('modalOverview').textContent = item.overview || 'No synopsis available.';

  updateModalListButton();

  const tvControls = document.getElementById('tvControls');
  if (type === 'tv') {
    tvControls.classList.remove('hidden');
    await loadTVDetails(item.id);
  } else {
    tvControls.classList.add('hidden');
  }

  switchSource('vidlink');

  setTimeout(() => {
    const firstServerBtn = document.querySelector('#serverButtons .srv-btn');
    if (firstServerBtn) firstServerBtn.focus();
  }, 60);
}

async function loadTVDetails(tvId) {
  const seasonList = document.getElementById('seasonList');
  const episodeList = document.getElementById('episodeList');
  seasonList.innerHTML = '<span style="color:#a3a8b8;font-size:0.85rem;">Loading seasons...</span>';
  episodeList.innerHTML = '';

  const details = await fetchTMDB(`/tv/${tvId}?api_key=${API_KEY}`);
  const seasons = (details.seasons || []).filter(s => s.season_number > 0);

  seasonList.innerHTML = '';
  if (!seasons.length) {
    selectedSeason = 1;
    renderEpisodeButtons(1, false);
    return;
  }

  selectedSeason = seasons[0].season_number;

  const frag = document.createDocumentFragment();
  seasons.forEach((s, index) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pill-btn' + (index === 0 ? ' active' : '');
    btn.textContent = `Season ${s.season_number}`;
    btn.onclick = () => {
      selectedSeason = s.season_number;
      document.querySelectorAll('#seasonList .pill-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderEpisodeButtons(s.episode_count || 1, true);
    };
    frag.appendChild(btn);
  });
  seasonList.appendChild(frag);

  renderEpisodeButtons(seasons[0].episode_count || 1, false);
}

function renderEpisodeButtons(epCount, shouldReload = true) {
  const episodeList = document.getElementById('episodeList');
  episodeList.innerHTML = '';
  selectedEpisode = 1;

  const frag = document.createDocumentFragment();
  for (let i = 1; i <= epCount; i++) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pill-btn' + (i === 1 ? ' active' : '');
    btn.textContent = `Ep ${i}`;
    btn.onclick = () => {
      selectedEpisode = i;
      document.querySelectorAll('#episodeList .pill-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      reloadEmbed();
    };
    frag.appendChild(btn);
  }
  episodeList.appendChild(frag);

  if (shouldReload) reloadEmbed();
}

function switchSource(source) {
  currentSource = source;
  document.querySelectorAll('.srv-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.source === source);
  });
  reloadEmbed();
}

async function reloadEmbed() {
  if (!currentItem) return;
  const frame = document.getElementById('videoFrame');
  const id = currentItem.id;
  const type = currentItem.savedType;
  const s = selectedSeason || 1;
  const e = selectedEpisode || 1;

  const sources = {
    vidlink: type === 'movie'
      ? `https://vidlink.pro/movie/${id}`
      : `https://vidlink.pro/tv/${id}/${s}/${e}`,
    embedsu: type === 'movie'
      ? `https://embed.su/embed/movie/${id}`
      : `https://embed.su/embed/tv/${id}/${s}/${e}`,
    autoembed: type === 'movie'
      ? `https://player.autoembed.cc/embed/movie/${id}`
      : `https://player.autoembed.cc/embed/tv/${id}/${s}/${e}`,
    vidsrc: type === 'movie'
      ? `https://vidsrc.me/embed/movie?tmdb=${id}`
      : `https://vidsrc.me/embed/tv?tmdb=${id}&season=${s}&episode=${e}`,
    multiembed: type === 'movie'
      ? `https://multiembed.mov/?video_id=${id}&tmdb=1`
      : `https://multiembed.mov/?video_id=${id}&tmdb=1&s=${s}&e=${e}`
  };

  if (currentSource === 'trailer') {
    const vidData = await fetchTMDB(`/${type}/${id}/videos?api_key=${API_KEY}`);
    const trailer = (vidData.results || []).find(v => v.site === 'YouTube' && v.type === 'Trailer') || vidData.results?.[0];
    frame.src = trailer ? `https://www.youtube.com/embed/${trailer.key}?autoplay=1` : '';
  } else {
    frame.src = sources[currentSource] || '';
  }
}

function closeModal() {
  document.getElementById('playerModal').classList.add('hidden');
  document.getElementById('videoFrame').src = '';

  if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
    lastFocusedElement.focus();
  }

  if (isHeroInView && !document.getElementById('hero').classList.contains('hidden')) {
    startHeroSlide(heroIndex);
  }
}

/* ================= MY LIST ================= */

function toggleMyList(item, type) {
  const existsIndex = myList.findIndex(i => i.id === item.id);
  if (existsIndex > -1) {
    myList.splice(existsIndex, 1);
  } else {
    myList.push({ ...item, savedType: type });
  }
  localStorage.setItem('streamflix_mylist', JSON.stringify(myList));
  updateModalListButton();
}

function updateModalListButton() {
  if (!currentItem) return;
  const btn = document.getElementById('modalListBtn');
  const isSaved = myList.some(i => i.id === currentItem.id);
  btn.textContent = isSaved ? '✓ In My List' : '+ Add to My List';
  btn.onclick = () => toggleMyList(currentItem, currentItem.savedType);
}