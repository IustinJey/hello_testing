
/* =====================================================
  app.js — Viewer (dynamic hydration via Supabase)

  Changes in this build (mobile-focused):
  - PIN on real devices: waits for hydration, resilient hidden input (1×1 offscreen),
    no accidental interception by timeline overlay.
  - Hover/drag timeline overlay init is deferred until the stage is visible.
  - Mobile fullscreen button inside the video frame; tries true fullscreen on the
    frame container so we can overlay the webcam in a corner.
  - While in fullscreen we place the webcam as a tiny PiP-like bubble in the
    chosen corner; on video end we exit fullscreen first, then show the offer.
  - Riskline under offer buttons now hydrates from DB (removed stray token, better selectors).
  - The variable --webcam-timeline-gap now applies with a strong rule so the
    distance between webcam and timeline is actually controllable.

  All other behavior and visuals remain exactly the same.
===================================================== */

/* ===================== ENV + Cloud ===================== */
const ENV = window.ENV || {};
const SUPABASE_URL = ENV.SUPABASE_URL || '';
const SUPABASE_ANON = ENV.SUPABASE_ANON || '';
const INSTANCE_ID = ENV.INSTANCE_ID || null; // optional scoping
const slugFromQS = (() => {
  // supports ?slug=alias, ?alias=alias, ?s=alias, or index.html?alias
  const raw = window.location.search.replace(/^\?/, '');
  if (!raw) return null;
  const sp = new URLSearchParams(window.location.search);
  const byKey = sp.get('slug') || sp.get('alias') || sp.get('s');
  if (byKey) return byKey.trim();
  if (raw && !raw.includes('=')) return decodeURIComponent(raw.trim());
  return null;
})();

// Safe create client (viewer never needs auth session persistence)
const SB = (SUPABASE_URL && SUPABASE_ANON && window.supabase)
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, { auth: { persistSession: false } })
  : null;

/* ===================== Static defaults (kept) ===================== */
const EXPIRY_DAYS = 7; // fallback expiry only
const TEST_PIN = '1234'; // only used if DB missing

// Runtime pins/cta/media resolved from DB
let PIN_EXPECTED = TEST_PIN;
let PIN_REQUIRED = true;
const HYDRATE = { link: null, lead: null, pres: null, cta: {}, videos: { slidesUrl: null, webcamUrl: null, handUrl: null } };

// Hydration status gates (to avoid flicker)
let HYDR = { started: false, done: false, notFound: false };
let _resolveHydrate; const HYDRATE_DONE = new Promise(r => (_resolveHydrate = r));

/* ===================== Elements (unchanged where not noted) ===================== */
const nav = document.getElementById('nav');
const navCountdown = document.getElementById('navCountdown');
const navTimer = document.getElementById('navTimer');
const sceneHello = document.getElementById('scene-hello');
const sceneRecorded = document.getElementById('scene-recorded');
const sceneGoal = document.getElementById('scene-goal');
const separateCountdown = document.getElementById('separateCountdown');
const nameEl = document.getElementById('name');
const bizNameEl = document.getElementById('bizName');
const ctaSlide = document.getElementById('ctaSlide');
const stage = document.getElementById('stage');

// ===== create a top dock container for mobile offer mode (under navbar) =====
let topDock = document.getElementById('topDock');
if (!topDock && stage) {
  topDock = document.createElement('div');
  topDock.id = 'topDock';
  stage.insertBefore(topDock, stage.firstChild);
}
// ===== END ADD =====

const playerEl = document.getElementById('player');
const frameEl = document.getElementById('frame');
const mainVideo = document.getElementById('mainVideo');
const mainPlayBtn = document.getElementById('mainPlayBtn');
const mainPauseHint = document.getElementById('mainPauseHint');
const webcamWrap = document.getElementById('webcamWrap');
const webcam = document.getElementById('webcam');
const webcamVideo = document.getElementById('webcamVideo');
const webcamVideo2 = document.getElementById('webcamVideo2');
const webcamPlayUI = document.getElementById('webcamPlayUI');
const webcamPlayBtn = document.getElementById('webcamPlayBtn');
const webcamPauseHint = document.getElementById('webcamPauseHint');
const orbitReplay = document.getElementById('orbitReplay');
const hintOverlay = document.getElementById('hintOverlay');
const hintBtn = document.getElementById('hintBtn');
const progress = document.getElementById('progress');
const progressBar = document.getElementById('progressBar');
const timeLeftEl = document.getElementById('timeLeft');
const seekInsight = document.getElementById('seekInsight');
const endCta = document.getElementById('endCta');
const ctaCountdownEl = document.getElementById('ctaCountdown');
const ctaMonth = document.getElementById('ctaMonth');
const brandMarquee = document.getElementById('brandMarquee');
const brandTrack = document.getElementById('brandTrack');
const skipIntroBtn = document.getElementById('skipIntroBtn');
const sfxPin = document.getElementById('sfxPin');
const sfxHello = document.getElementById('sfxHello');
const sfxOffer = document.getElementById('sfxOffer');
const bgMusic = document.getElementById('bgMusic');    // main background music
const endMusic = document.getElementById('endMusic');  // end/offer music
const musicToggle = document.getElementById('musicToggle');
const intrigue = document.getElementById('intrigue');

/* ===================== Music knobs & helpers ===================== */
const MUSIC = {
  MAIN_VOL: 0.15,
  END_VOL: 0.10,
  FADE_MS: 900,
  END_START_DELAY_MS: 0,
  PRIME_ON_UNMUTE: true
};

function clamp01(x) { return Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0)); }
function setVolumeSafe(audio, v) { try { if (audio) audio.volume = clamp01(v); } catch {} }

function fadeAudio(el, from, to, ms) {
  return new Promise((resolve) => {
    if (!el) return resolve();
    from = clamp01(from); to = clamp01(to);
    if (ms <= 0 || Math.abs(to - from) < 0.001) { setVolumeSafe(el, to); return resolve(); }
    const t0 = performance.now();
    setVolumeSafe(el, from);
    const step = (now) => {
      const r = clamp01((now - t0) / ms);
      const cur = from + (to - from) * r;
      setVolumeSafe(el, cur);
      if (r >= 1) return resolve();
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

let musicEnabled = true;  // master toggle
function pauseBothMusic() { try { bgMusic && bgMusic.pause(); } catch {}; try { endMusic && endMusic.pause(); } catch {}; }
function playActiveMusicForState() {
  if (!musicEnabled) return;
  const inOffer = document.body.classList.contains('offer-mode');
  const target = inOffer ? endMusic : bgMusic;
  if (!target) return;
  try { target.play().catch(()=>{}); } catch {}
}
function primeEndMusicOnce() {
  if (!MUSIC.PRIME_ON_UNMUTE || !endMusic) return;
  try {
    const origMuted = endMusic.muted;
    endMusic.muted = true;
    endMusic.currentTime = 0;
    endMusic.play().then(() => {
      endMusic.pause();
      endMusic.currentTime = 0;
      endMusic.muted = origMuted;
    }).catch(()=>{ endMusic.muted = origMuted; });
  } catch {}
}
function crossfadeToEndMusic() {
  if (!bgMusic && !endMusic) return;
  setVolumeSafe(endMusic, 0);
  const start = () => {
    try { endMusic && endMusic.play().catch(()=>{}); } catch {}
    return Promise.all([
      fadeAudio(bgMusic, bgMusic ? bgMusic.volume : 0, 0, MUSIC.FADE_MS),
      fadeAudio(endMusic, 0, MUSIC.END_VOL, MUSIC.FADE_MS)
    ]).then(() => { try { bgMusic && bgMusic.pause(); } catch {}; });
  };
  if (MUSIC.END_START_DELAY_MS > 0) setTimeout(start, MUSIC.END_START_DELAY_MS); else start();
}
function crossfadeBackToMainMusic() {
  if (!bgMusic && !endMusic) return;
  try { bgMusic && bgMusic.play().catch(()=>{}); } catch {}
  setVolumeSafe(bgMusic, clamp01(bgMusic ? bgMusic.volume : MUSIC.MAIN_VOL));
  const fromEnd = endMusic ? endMusic.volume : 0;
  Promise.all([
    fadeAudio(endMusic, fromEnd, 0, MUSIC.FADE_MS),
    fadeAudio(bgMusic, bgMusic ? bgMusic.volume : 0, MUSIC.MAIN_VOL, MUSIC.FADE_MS)
  ]).then(() => { try { endMusic && endMusic.pause(); } catch {}; });
}

/* ===================== Expiry countdown (original) ===================== */
const STORAGE_KEY_EXPIRY = 'pv_link_expiry_ts';
let expiryTS = Number(localStorage.getItem(STORAGE_KEY_EXPIRY));
const nowTS = Date.now();
if (!expiryTS || expiryTS < nowTS) {
  expiryTS = nowTS + EXPIRY_DAYS * 24 * 60 * 60 * 1000;
  localStorage.setItem(STORAGE_KEY_EXPIRY, String(expiryTS));
}
function fmt(ms) {
  if (ms <= 0) return '0d 00:00:00';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d}d ${pad(h)}:${pad(m)}:${pad(sec)}`;
}
function tick() {
  const remain = expiryTS - Date.now();
  const t = fmt(remain);
  if (navCountdown) navCountdown.textContent = t;
  if (separateCountdown) separateCountdown.textContent = t;
  if (ctaCountdownEl) ctaCountdownEl.textContent = t;
  if (remain <= 0) { try { mainVideo.pause(); } catch (e) { } }
}
setInterval(tick, 1000);
tick();

/* Month label (kept) */
(function setMonthLabel() {
  const month = new Date().toLocaleString(undefined, { month: 'long' });
  if (ctaMonth) ctaMonth.textContent = month;
})();

/* ===================== Storage helpers ===================== */
const STORAGE_BUCKET = (ENV.STORAGE_BUCKET || 'hello-videos');
const SLIDES_BUCKET = ENV.SLIDES_BUCKET || STORAGE_BUCKET; // <— slides use this
const CAM_BUCKET = ENV.CAM_BUCKET || 'webcam';
const HAND_BUCKET = ENV.HAND_BUCKET || 'handcam';
const SIGNED_URL_SECONDS = 60 * 60 * 24 * 7; // 7 days

// ---------- Storage helpers (public/signed URL resolution) ----------
function partsFromPublicURL(url) {
  const m = String(url || '').match(/\/storage\/v1\/object\/public\/([^\/]+)\/(.+)$/);
  return m ? { bucket: m[1], path: m[2] } : null;
}

async function storageSignedOrPublicURL(bucket, path) {
  if (!SB || !bucket || !path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  try {
    const { data } = await SB.storage.from(bucket).createSignedUrl(path, SIGNED_URL_SECONDS);
    if (data?.signedUrl) return data.signedUrl;
  } catch { }
  const { data } = SB.storage.from(bucket).getPublicUrl(path);
  return data?.publicUrl || null;
}

async function pickFirstStorageURLAsync(candidates) {
  for (const c of (candidates || [])) {
    if (!c) continue;
    if (c.bucket && c.path) {
      const u = await storageSignedOrPublicURL(c.bucket, c.path);
      if (u) return u;
    } else if (c.url) {
      const p = partsFromPublicURL(c.url);
      if (p) {
        const u = await storageSignedOrPublicURL(p.bucket, p.path);
        if (u) return u;
      }
      return c.url; // non-supabase full URL (legacy)
    }
  }
  return null;
}

// Re-sign a <video> src automatically if a signed URL expires or errors.
function attachAutoResign(videoEl) {
  if (!videoEl) return;
  let refreshing = false;
  videoEl.addEventListener('error', async () => {
    if (refreshing) return;
    const src = videoEl.currentSrc || videoEl.src;
    const p = partsFromPublicURL(src);
    if (!p) return;
    refreshing = true;
    try {
      const fresh = await storageSignedOrPublicURL(p.bucket, p.path);
      if (fresh && fresh !== src) {
        const wasPlaying = !videoEl.paused;
        videoEl.src = fresh;
        videoEl.load();
        if (wasPlaying) { try { videoEl.play(); } catch { } }
      }
    } finally { refreshing = false; }
  });
}

/* ---------- ID → URL resolution (slides can be ID-only) ---------- */
function isUUID(v) {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}
function guessStorageKeyVariants(id, bucket) {
  const bases = [String(id)];
  const withFolders = (p) => [p, `slides/${p}`, `presentation/${p}`, `uploads/${p}`];
  const exts = ['', '.mp4', '.webm', '.m4v', '.mov'];
  const out = [];
  for (const base of bases) {
    for (const ext of exts) {
      for (const variant of withFolders(base + ext)) out.push({ bucket, path: variant });
    }
  }
  return out;
}

// Minimal helper used when only an ID is provided and the table isn't exposed
async function resolveIdToURL(id, preferredBucket) {
  if (!SB || !id) return null;

  const TABLES = [
    'videos',
    'hello_videos',
    'hello_assets_videos',
    'slides',
    'hello_slides',
    'media',
    'presentation_videos'
  ];
  for (const table of TABLES) {
    try {
      const { data, error } = await SB.from(table).select('*').eq('id', id).limit(1);
      if (!error && data && data[0]) {
        const row = data[0];
        if (row.storage_bucket && (row.storage_key || row.storage_path)) {
          return await storageSignedOrPublicURL(row.storage_bucket, row.storage_key || row.storage_path);
        }
        if (row.bucket && (row.key || row.path)) {
          return await storageSignedOrPublicURL(row.bucket, row.key || row.path);
        }
        if (row.storage_path) {
          return await storageSignedOrPublicURL(preferredBucket || SLIDES_BUCKET, row.storage_path);
        }
        return row.public_url || row.file_url || row.url || null;
      }
    } catch { /* try next table */ }
  }

  if (isUUID(id)) {
    const guesses = guessStorageKeyVariants(id, preferredBucket || SLIDES_BUCKET);
    for (const g of guesses) {
      const u = await storageSignedOrPublicURL(g.bucket, g.path);
      if (u) return u;
    }
  }
  return null;
}

/* ===================== Tag + highlight helpers ===================== */
function tagMap(lead) {
  return {
    nickname: lead?.alias || lead?.nickname || '',
    name: lead?.nickname || '',
    company: lead?.company || '',
    phone: lead?.phone || '',
    email: lead?.email || ''
  };
}
function resolveTags(s, lead) {
  const map = tagMap(lead);
  return String(s || '').replace(/\[([^\]]+)\]/g, (_, k) => map[k.trim().toLowerCase()] ?? '');
}
function expandHighlights(highlights, lead) {
  const map = tagMap(lead);
  const list = [];
  (highlights || []).forEach(h => {
    if (!h) return;
    const raw = String(h).trim();
    const key = raw.replace(/^\[|\]$/g, '').toLowerCase();
    if (map[key]) list.push(String(map[key])); // resolved tag value
    list.push(raw); // literal word
  });
  return [...new Set(list.filter(Boolean))];
}
function injectHighlights(resolvedText, highlightsExpanded) {
  if (!resolvedText) return '';
  let html = String(resolvedText);
  (highlightsExpanded || []).forEach(h => {
    const safe = h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(`(\\b${safe}\\b)`, 'ig');
    html = html.replace(rx, '<span class="ink ink--hot">$1<\/span>');
  });
  return html;
}

/* ===================== NOT FOUND ===================== */
function showNotFound() {
  nav?.classList.add('show');
  if (navTimer) navTimer.style.display = 'none';
  stage?.classList.remove('show');
  endCta?.classList.add('hidden');
  brandMarquee?.classList.remove('show');
  if (hintOverlay) { hintOverlay.classList.add('hide'); hintOverlay.style.display = 'none'; }
  skipIntroBtn?.classList.remove('show');
  skipIntroBtn?.classList.add('hidden');
  if (sceneHello) sceneHello.classList.add('hidden');
  if (sceneGoal) sceneGoal.classList.add('hidden');
  if (sceneRecorded) {
    const h2 = sceneRecorded.querySelector('.subbig');
    if (h2) h2.innerHTML = `This presentation <span class="ink ink--hot">doesn’t<\/span> exist for this link.`;
    const note = sceneRecorded.querySelector('.note');
    if (note) note.innerHTML = `Try the <a href="/" class="ink ink--hot">link<\/a> we sent again.`;
    sceneRecorded.classList.remove('hidden');
    sceneRecorded.classList.add('fade-in');
  }
}

/* =====================================================
   DYNAMIC HYDRATION (fetch data using slug before PIN)
   ===================================================== */
async function hydrateFromCloud() {
  HYDR.started = true;
  try {
    // 0) Missing slug → mark not found, disable PIN, finish
    if (!SB || !slugFromQS) {
      HYDR.notFound = true; PIN_REQUIRED = false; _resolveHydrate(); return;
    }
    // 1) Link by slug (+ instance scope if provided)
    let linkQ = SB.from('hello_links')
      .select('id,slug,lead_id,presentation_id,form_id,require_pin,expires_at,overrides,settings,active')
      .eq('slug', slugFromQS)
      .eq('active', true)
      .limit(1);
    if (INSTANCE_ID) linkQ = linkQ.eq('instance_id', INSTANCE_ID);
    const { data: links, error: e1 } = await linkQ;
    if (e1) throw e1;
    const link = (links || [])[0];
    if (!link) { hideHeadlineTimer(); HYDR.notFound = true; PIN_REQUIRED = false; _resolveHydrate(); return; }

    // 2) Lead + Presentation
    let leadQ = SB.from('leads').select('*').eq('id', link.lead_id).limit(1);
    let presQ = SB.from('hello_presentations').select('*').eq('id', link.presentation_id).limit(1);
    if (INSTANCE_ID) { leadQ = leadQ.eq('instance_id', INSTANCE_ID); presQ = presQ.eq('instance_id', INSTANCE_ID); }
    const [{ data: leads, error: e2 }, { data: presArr, error: e3 }] = await Promise.all([leadQ, presQ]);
    if (e2) throw e2; if (e3) throw e3;
    const lead = (leads || [])[0] || null;
    const pres = (presArr || [])[0] || null;

    // 3) Resolve media *from Storage*
    const BKT = { slides: SLIDES_BUCKET, cam: CAM_BUCKET, hand: HAND_BUCKET };

    const VIDEO_EXT_RE = /\.(mp4|webm|m4v|mov)$/i;
    const looksLikeURL = (s) => typeof s === 'string' && /^https?:\/\//i.test(s);
    const looksLikePath = (s) => typeof s === 'string' && (VIDEO_EXT_RE.test(s) || /^(default|slides|presentation|uploads|public)\//i.test(s) || s.includes('/'));
    const isUUID_local = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

    function deepCandidates(obj, kind, buckets, maxDepth = 4, pathSeen = new WeakSet()) {
      const out = [];
      const ban = kind === 'slides' ? /webcam|cam|hand|end/i : null;
      function push(val, srcBucket) {
        if (!val) return;
        if (typeof val === 'string') {
          if (looksLikeURL(val)) out.push({ url: val });
          else if (isUUID_local(val)) out.push({ id: val });
          else if (looksLikePath(val)) out.push({ bucket: srcBucket, path: val });
        } else if (typeof val === 'object') {
          const b = val.bucket || srcBucket;
          if (val.id) out.push({ id: val.id });
          if (val.bucket && (val.key || val.path)) out.push({ bucket: val.bucket, path: val.key || val.path });
          if (val.key) out.push({ bucket: b, path: val.key });
          if (val.path) out.push({ bucket: b, path: val.path });
          if (val.url) out.push({ url: val.url });
        }
      }
      function walk(node, depth, defaultBucket) {
        if (!node || typeof node !== 'object' || depth > maxDepth || pathSeen.has(node)) return;
        pathSeen.add(node);
        for (const k of Object.keys(node)) {
          const v = node[k];
          const key = k.toLowerCase();
          if (ban && ban.test(key)) continue;

          const isSlidesy = /slides?|deck|presentation|main(video)?|primary(video)?|intro(video)?|video$/.test(key);
          const isWebcamy = /(web)?cam(video)?|primarycam/.test(key);

          if ((kind === 'slides' && isSlidesy) || (kind === 'webcam' && isWebcamy)) {
            push(v, kind === 'slides' ? buckets.slides : buckets.cam);
            if (typeof v === 'object') walk(v, depth + 1, kind === 'slides' ? buckets.slides : buckets.cam);
            continue;
          }

          if (typeof v === 'string') {
            if (looksLikeURL(v) || isUUID_local(v) || looksLikePath(v)) {
              push(v, kind === 'slides' ? buckets.slides : buckets.cam);
              continue;
            }
          }

          if (typeof v === 'object') walk(v, depth + 1, defaultBucket);
        }
      }
      walk(obj, 0, kind === 'slides' ? buckets.slides : buckets.cam);
      const seen = new Set();
      return out.filter(c => {
        const key = c.id ? `id:${c.id}` : c.url ? `url:${c.url}` : `bp:${c.bucket}|${c.path}`;
        if (seen.has(key)) return false; seen.add(key); return true;
      });
    }

    async function pickFirstVideoURLAsync(candidates, fallbackBucketIfId) {
      for (const c of (candidates || [])) {
        if (!c) continue;
        if (c.id) {
          const byId = await resolveIdToURL(c.id, fallbackBucketIfId);
          if (byId) return byId;
        }
        if (c.bucket && c.path) {
          const u = await storageSignedOrPublicURL(c.bucket, c.path);
          if (u) return u;
        }
        if (c.url) {
          const p = partsFromPublicURL(c.url);
          if (p) {
            const u = await storageSignedOrPublicURL(p.bucket, p.path);
            if (u) return u;
          }
          return c.url;
        }
      }
      return null;
    }

    const vOver = (link?.overrides?.videos) || {};
    const vDef = (pres?.defaults?.videos) || (pres?.videos) || (pres?.media) || {};

    const legacySlidesUrlOverride = link?.overrides?.videos?.slidesUrl || link?.overrides?.slidesUrl || null;
    const legacySlidesUrlDefault = pres?.copy?.slidesUrl || pres?.slidesUrl || null;
    const legacyWebcamUrlOverride = link?.overrides?.videos?.webcamUrl || link?.overrides?.webcamUrl || null;
    const legacyWebcamUrlDefault = pres?.copy?.webcamUrl || pres?.webcamUrl || null;

    function gatherVideoCandidates(v, kind, buckets) {
      if (!v) return [];
      const out = [];
      const bucket = kind === 'slides' ? buckets.slides : buckets.cam;
      const bases = [kind, kind === 'webcam' ? 'cam' : 'deck', 'primary', 'main', 'video'];
      for (const base of bases) {
        for (const k of [base + 'Id', base + '_id', base + 'ID']) if (v[k]) out.push({ id: v[k] });
        for (const k of [base + 'Key', base + '_key', base + 'Path', base + '_path', base + 'StorageKey']) if (v[k]) out.push({ bucket, path: v[k] });
        for (const k of [base + 'Url', base + '_url', base + 'URL']) if (v[k]) out.push({ url: v[k] });
        if (v[base] && typeof v[base] === 'object') {
          const o = v[base];
          if (o.id) out.push({ id: o.id });
          if (o.bucket && (o.key || o.path)) out.push({ bucket: o.bucket, path: o.key || o.path });
          if (o.key) out.push({ bucket, path: o.key });
          if (o.path) out.push({ bucket, path: o.path });
          if (o.url) out.push({ url: o.url });
        }
      }
      return out;
    }
    function gatherRootVideoCandidates(obj, kind, buckets) {
      if (!obj) return [];
      const bkt = kind === 'slides' ? buckets.slides : buckets.cam;
      const keys = [
        `${kind}Key`, `${kind}_key`, `${kind}Path`, `${kind}_path`,
        `${kind}Url`, `${kind}_url`, `${kind}URL`,
        `${kind}Id`, `${kind}_id`, `${kind}ID`,
        kind === 'slides' ? 'deckKey' : 'camKey',
        kind === 'slides' ? 'deckUrl' : 'camUrl',
        kind === 'slides' ? 'deckId' : 'camId',
        'videoUrl', 'video_key', 'videoKey', 'video_path', 'videoPath', 'videoId', 'mainVideo', 'primaryVideo'
      ];
      const out = [];
      for (const k of keys) {
        const v = obj?.[k];
        if (!v) continue;
        if (k.toLowerCase().endsWith('id')) out.push({ id: v });
        else if (k.toLowerCase().includes('url')) out.push({ url: v });
        else out.push({ bucket: bkt, path: v });
      }
      return out;
    }

    const slidesCandidates = [
      ...gatherVideoCandidates(vOver, 'slides', BKT),
      ...gatherRootVideoCandidates(link?.overrides, 'slides', BKT),
      ...gatherVideoCandidates(vDef, 'slides', BKT),
      ...gatherRootVideoCandidates(pres, 'slides', BKT),
      ...deepCandidates(link?.overrides, 'slides', BKT),
      ...deepCandidates(pres, 'slides', BKT),
      legacySlidesUrlOverride ? { url: legacySlidesUrlOverride } : null,
      legacySlidesUrlDefault ? { url: legacySlidesUrlDefault } : null
    ];

    const webcamCandidates = [
      ...gatherVideoCandidates(vOver, 'webcam', BKT),
      ...gatherRootVideoCandidates(link?.overrides, 'webcam', BKT),
      ...gatherVideoCandidates(vDef, 'webcam', BKT),
      ...gatherRootVideoCandidates(pres, 'webcam', BKT),
      ...deepCandidates(link?.overrides, 'webcam', BKT),
      ...deepCandidates(pres, 'webcam', BKT),
      legacyWebcamUrlOverride ? { url: legacyWebcamUrlOverride } : null,
      legacyWebcamUrlDefault ? { url: legacyWebcamUrlDefault } : null
    ];

    const handCandidates = [
      vOver.handcamKey ? { bucket: BKT.hand, path: vOver.handcamKey } : null,
      vDef.handcamKey ? { bucket: BKT.hand, path: vDef.handcamKey } : null
    ];

    const [slidesUrl, webcamUrl, handFromKey] = await Promise.all([
      pickFirstVideoURLAsync(slidesCandidates, BKT.slides),
      pickFirstVideoURLAsync(webcamCandidates, BKT.cam),
      pickFirstStorageURLAsync(handCandidates),
    ]);

    const legacyHandId =
      vOver.handcamId || vDef.handcamId ||
      link?.overrides?.videos?.handcamId || pres?.defaults?.videos?.handcamId || null;

    let handUrl = handFromKey;
    if (!handUrl && legacyHandId) {
      try {
        const { data } = await SB.from('hello_assets_handcams').select('*').eq('id', legacyHandId).limit(1).single();
        if (data) {
          if (data.storage_bucket && (data.storage_key || data.storage_path)) {
            handUrl = await storageSignedOrPublicURL(data.storage_bucket, data.storage_key || data.storage_path);
          } else if (data.bucket && (data.key || data.path)) {
            handUrl = await storageSignedOrPublicURL(data.bucket, data.key || data.path);
          } else if (data.storage_path) {
            handUrl = await storageSignedOrPublicURL(BKT.hand, data.storage_path);
          } else {
            handUrl = data.file_url || data.public_url || data.url || null;
          }
        }
      } catch { }
    }

    console.debug('[media] candidates:', { slidesCandidates, webcamCandidates, handCandidates });
    console.debug('[media] resolved:', { slidesUrl, webcamUrl, handUrl });

    const baseCTA = pres?.cta || {};
    const overCTA = (link?.overrides?.cta) || {};
    const cta = { ...baseCTA, ...overCTA };

    const ctaResolved = {
      stageHeadline: resolveTags(cta.stageHeadline, lead),
      timelineWarning: resolveTags(cta.timelineWarning, lead),
      offerHeadline: resolveTags(cta.offerHeadline, lead),
      button: resolveTags(cta.button, lead),
      quickReplyLabel: resolveTags(cta.quickReplyLabel, lead),
      whatsAppLabel: resolveTags(cta.whatsAppLabel, lead),
      whatsAppNumber: resolveTags(cta.whatsAppNumber, lead),
      whatsAppEnabled: (cta.whatsAppEnabled !== false),
      riskline: resolveTags(cta.riskline, lead)
    };

    if (nameEl) nameEl.textContent = lead?.alias || lead?.nickname || '';
    if (bizNameEl) bizNameEl.textContent = lead?.company || '';

    const s2 = sceneRecorded?.querySelector('.subbig');
    const s2TextRaw = pres?.scenes?.[1]?.text || s2?.textContent || '';
    const s2HL = expandHighlights(pres?.scenes?.[1]?.highlights || [], lead);
    if (s2) s2.innerHTML = injectHighlights(resolveTags(s2TextRaw, lead), s2HL);

    const s3 = sceneGoal?.querySelector('.subbig');
    const s3TextRaw = pres?.scenes?.[2]?.text || s3?.textContent || '';
    const s3HL = expandHighlights(pres?.scenes?.[2]?.highlights || [], lead);
    if (s3) s3.innerHTML = injectHighlights(resolveTags(s3TextRaw, lead), s3HL);

    const intrH = intrigue?.querySelector('h3');
    if (intrH && ctaResolved.stageHeadline) intrH.textContent = ctaResolved.stageHeadline;
    const seekSpan = seekInsight?.querySelector('span');
    if (seekSpan && ctaResolved.timelineWarning) seekSpan.textContent = ctaResolved.timelineWarning;
    const ctaHead = document.getElementById('ctaHeadline');
    if (ctaHead && ctaResolved.offerHeadline) ctaHead.textContent = ctaResolved.offerHeadline;
    const goldBtnSpan = document.querySelector('.gold-button2 > div > span');
    if (goldBtnSpan && ctaResolved.button) goldBtnSpan.textContent = ctaResolved.button;
    const quickSpan = document.querySelector('#ctaVideoReply > span');
    if (quickSpan && ctaResolved.quickReplyLabel) quickSpan.textContent = ctaResolved.quickReplyLabel;

    // === Hydrate the risk line under the offer buttons (from DB) ===
    const riskTargets = [
      document.getElementById('ctaRiskline'),
      document.querySelector('.cta-riskline'),
      document.querySelector('[data-cta="riskline"]'),
      document.querySelector('#endCta .riskline') || document.querySelector('.end-cta .riskline')
    ].filter(Boolean);
    if (riskTargets.length) {
      riskTargets.forEach(el => {
        if (ctaResolved.riskline) {
          el.textContent = ctaResolved.riskline;
          try { el.style.removeProperty('display'); } catch {}
          el.setAttribute('aria-hidden', 'false');
        } else {
          el.textContent = '';
          el.style.display = 'none';
          el.setAttribute('aria-hidden', 'true');
        }
      });
    }

    try {
      // PATCH: set crossOrigin to allow canvas thumbnails (if server sends CORS)
      if (slidesUrl) { mainVideo.preload = 'auto'; mainVideo.crossOrigin = 'anonymous'; mainVideo.src = slidesUrl; mainVideo.load(); attachAutoResign(mainVideo); }
      if (webcamUrl) { webcamVideo.preload = 'auto'; webcamVideo.crossOrigin = 'anonymous'; webcamVideo.src = webcamUrl; webcamVideo.load(); attachAutoResign(webcamVideo); }
      if (handUrl)   { webcamVideo2.preload = 'metadata'; webcamVideo2.crossOrigin = 'anonymous'; webcamVideo2.src = handUrl;   webcamVideo2.load(); attachAutoResign(webcamVideo2); }
    } catch (e) { }

    if (link?.expires_at) {
      const ts = new Date(link.expires_at).getTime();
      if (!Number.isNaN(ts)) {
        expiryTS = ts; tick(); localStorage.setItem(STORAGE_KEY_EXPIRY, String(expiryTS));
      }
    }

    const hue = link?.overrides?.theme?.hue ?? pres?.theme?.hue;
    if (typeof hue === 'number') document.documentElement.style.setProperty('--hue', String(hue));

    PIN_REQUIRED = !!link?.require_pin;
    PIN_EXPECTED = (link?.settings?.pin_plain || '').trim() || TEST_PIN;

    HYDRATE.link = link; HYDRATE.lead = lead; HYDRATE.pres = pres; HYDRATE.cta = ctaResolved; HYDRATE.videos = { slidesUrl, webcamUrl, handUrl };

    HYDR.done = true; _resolveHydrate();
  } catch (err) {
    console.warn('Hydrate failed:', err);
    HYDR.notFound = true; PIN_REQUIRED = false; _resolveHydrate();
  }
}

hydrateFromCloud();
if (!slugFromQS) {
  hideHeadlineTimer();
}

/* ===================== Intro & stage (unchanged visuals) ===================== */
const SLIDE_DURATION_MS = 1800;
const SHIFT_UP_PX = 110;
const SHIFT_RIGHT_PX = 24;
const SCALE_TOP = 1.2;
const FLOAT_RADIUS_X = 6;
const FLOAT_RADIUS_Y = 8;
const FLOAT_SPEED_X = 0.9;
const FLOAT_SPEED_Y = 0.75;
const FINGERPRINT_GIF_MS = 1800;
const FINGERPRINT_FADE_MS = 450;
const STORAGE_KEY_UNLOCK = 'pv_seek_unlocked_after_unmuted_watch';
const STORAGE_KEY_INTRO_OK = 'pv_intro_watched_once';
const SEEK_REVERT_EPS = 0.75;
let ignoreSeeksUntil = 0;

const introWatched = localStorage.getItem(STORAGE_KEY_INTRO_OK) === '1';
let introActive = false;
const introTimers = [];
const schedule = (fn, delay) => { const id = setTimeout(fn, delay); introTimers.push(id); return id; };
function cancelIntroSequence() {
  introActive = false; introTimers.forEach(clearTimeout); introTimers.length = 0;
  [sceneHello, sceneRecorded, sceneGoal].forEach(el => { if (!el) return; el.classList.add('hidden'); el.classList.remove('fade-in', 'fade-out'); });
}
function show(el) { el.classList.remove('hidden'); el.classList.add('fade-in'); }
function hide(el) { el.classList.add('fade-out'); setTimeout(() => { el.classList.add('hidden'); el.classList.remove('fade-out'); }, 380); }

let _hoverLabelInited = false;
function showStage() {
  stage.classList.add('show');
  orbitReplay.classList.remove('show');
  skipIntroBtn.classList.remove('show');
  skipIntroBtn.classList.add('hidden');
  try { mainVideo.play().catch(() => { }); } catch { }
  enterNormalMode();
  // Start main music softly
  if (bgMusic) { try { setVolumeSafe(bgMusic, MUSIC.MAIN_VOL); musicEnabled && bgMusic.play().catch(()=>{}); } catch {} }
  stabilizeIntrigue(800);

  // Defer timeline hover/drag overlay until stage visible (prevents intercepting PIN touches)
  if (!_hoverLabelInited) { initHoverTimeLabel(); _hoverLabelInited = true; }
}

function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

let _intrigueWriteScheduled = false;
let _intrigueTopNext = null;
function positionIntrigueBetween() {
  if (!intrigue || !playerEl || !nav) return;

  const navRect = nav.getBoundingClientRect();
  const playerRect = playerEl.getBoundingClientRect();
  const cs = getComputedStyle(document.documentElement);
  const marginTop = parseFloat(cs.getPropertyValue('--intrigue-gap-top')) || 6;
  const marginBottom = parseFloat(cs.getPropertyValue('--intrigue-gap-bottom')) || 8;

  const gapTop = navRect.bottom + marginTop;
  const gapBottom = playerRect.top - marginBottom;
  const h = intrigue.offsetHeight || 0;
  const center = gapTop + Math.max(0, (gapBottom - gapTop - h) / 2);
  const minTop = gapTop;
  const maxTop = Math.max(gapTop, gapBottom - h);
  const bias = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--intrigue-bias') || '0') || 0;
  const top = clamp(center - bias, minTop, maxTop);

  _intrigueTopNext = top;
  if (_intrigueWriteScheduled) return;
  _intrigueWriteScheduled = true;
  requestAnimationFrame(() => {
    _intrigueWriteScheduled = false;
    if (!intrigue) return;
    intrigue.style.top = `${_intrigueTopNext}px`;
  });
}

function stabilizeIntrigue(ms = 600) {
  const deadline = performance.now() + ms;
  function loop() { positionIntrigueBetween(); if (performance.now() < deadline) requestAnimationFrame(loop); }
  requestAnimationFrame(loop);
}
let resizeRaf = 0;
window.addEventListener('resize', () => {
  if (resizeRaf) cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(() => {
    positionIntrigueBetween();
    stabilizeIntrigue(300);
  });
});
let roPending = false;
const ro = new ResizeObserver(() => {
  if (roPending) return;
  roPending = true;
  requestAnimationFrame(() => {
    roPending = false;
    positionIntrigueBetween();
  });
});
if (nav) ro.observe(nav);
if (playerEl) ro.observe(playerEl);

function runSequence() {
  introActive = true;
  if (introWatched) skipIntroBtn.classList.add('show');
  schedule(() => { if (!introActive) return; show(sceneHello); try { sfxHello.currentTime = 0; sfxHello.play().catch(() => { }); } catch { } }, 300);
  const fingerGif = document.getElementById('fingerGif');
  if (fingerGif) { schedule(() => { if (!introActive) return; fingerGif.classList.add('is-fading'); setTimeout(() => { fingerGif.style.display = 'none'; }, 450); }, 1800); }
  schedule(() => { if (!introActive) return; hide(sceneHello); }, 2600);
  schedule(() => { if (!introActive) return; show(sceneRecorded); }, 3000);
  schedule(() => { if (!introActive) return; hide(sceneRecorded); }, 5600);
  schedule(() => { if (!introActive) return; show(sceneGoal); }, 5800);
  schedule(() => { if (!introActive) return; ctaSlide && ctaSlide.classList.add('show'); }, 7200);
  schedule(() => { if (!introActive) return; hide(sceneGoal); }, 8200);
  schedule(() => { if (!introActive) return; nav.classList.add('show'); showStage(); localStorage.setItem(STORAGE_KEY_INTRO_OK, '1'); skipIntroBtn.classList.add('show'); }, 8400);
}

/* ===================== Unmute + bind videos ===================== */
let hasClickedUnmuteOverlay = false;
let unmutedSessionStartedAtZero = false;
let programmaticSeekOK = false;
function setCurrentTimeSafely(t) { programmaticSeekOK = true; try { mainVideo.currentTime = t; } finally { setTimeout(() => { programmaticSeekOK = false; }, 0); } }
function computeCamTimeForMain(mainT) {
  const dCam = webcamVideo.duration; if (!isFinite(mainT)) return null; if (!isFinite(dCam) || dCam <= 0) return null; return Math.min(Math.max(0, mainT), Math.max(0, dCam - 0.05));
}
function syncPrimaryWebcamToMain({ force = false, forceWhenMetaReady = false } = {}) {
  const tMain = mainVideo.currentTime || 0;
  const applySync = () => { const tCam = computeCamTimeForMain(tMain); if (tCam == null) return false; try { webcamVideo.currentTime = tCam; } catch { } return true; };
  if (isFinite(mainVideo.duration) && isFinite(webcamVideo.duration)) return applySync();
  if (force || forceWhenMetaReady) {
    const onMainMeta = () => { mainVideo.removeEventListener('loadedmetadata', onMainMeta); maybeDo(); };
    const onCamMeta = () => { webcamVideo.removeEventListener('loadedmetadata', onCamMeta); maybeDo(); };
    function maybeDo() { if (isFinite(mainVideo.duration) && isFinite(webcamVideo.duration)) applySync(); }
    mainVideo.addEventListener('loadedmetadata', onMainMeta);
    webcamVideo.addEventListener('loadedmetadata', onCamMeta);
  }
  return false;
}
function setMainTimeAndHardSync(t) { setCurrentTimeSafely(t); syncPrimaryWebcamToMain({ forceWhenMetaReady: true }); }

let endCrossfadeTimer = null; function clearEndCrossfadeTimer() { if (endCrossfadeTimer) { clearTimeout(endCrossfadeTimer); endCrossfadeTimer = null; } }
let isInEndMode = false;
function enterNormalMode() {
  isInEndMode = false;
  clearEndCrossfadeTimer();
  webcamVideo2.style.opacity = '0';
  webcamVideo.style.opacity = '1';
  try { webcamVideo2.pause(); webcamVideo2.currentTime = 0; } catch { }
  webcamVideo2.muted = true;
  webcamVideo.muted = mainVideo.muted;
  webcamPlayUI.classList.remove('show');
  webcamPauseHint.classList.remove('show');
  syncPrimaryWebcamToMain({ forceWhenMetaReady: true });
  webcamWrap.classList.remove('at-top');
  crossfadeBackToMainMusic();
}
function enterEndMode() {
  isInEndMode = true;
  clearEndCrossfadeTimer();
  try { mainVideo.pause(); webcamVideo.pause(); } catch { }
  webcamVideo.muted = true;
  webcamVideo2.style.opacity = '1';
  webcamVideo.style.opacity = '0';
  webcamVideo2.muted = false;
  if (isPointerOver(webcam) && !webcamVideo2.paused) { webcamPauseHint.classList.add('show'); }
  webcamWrap.classList.add('at-top');
}

function isPrimaryWebcamActive() { const op1 = parseFloat(getComputedStyle(webcamVideo).opacity || '1'); const op2 = parseFloat(getComputedStyle(webcamVideo2).opacity || '0'); return !isInEndMode && op1 >= 0.5 && op2 < 0.5; }
function stopAllWebcam() { try { webcamVideo.pause(); webcamVideo2.pause(); webcamVideo2.currentTime = 0; } catch { } webcamVideo2.style.opacity = '0'; webcamVideo.style.opacity = '1'; webcamVideo2.muted = true; webcamVideo.muted = mainVideo.muted; webcamPlayUI.classList.remove('show'); webcamPauseHint.classList.remove('show'); }
function playBound() { syncPrimaryWebcamToMain({ forceWhenMetaReady: true }); if (mainVideo.paused) mainVideo.play().catch(() => { }); if (isPrimaryWebcamActive()) webcamVideo.play().catch(() => { }); }
function pauseBound() { if (!mainVideo.paused) mainVideo.pause(); if (isPrimaryWebcamActive() && !webcamVideo.paused) webcamVideo.pause(); }

function showHint() { hintOverlay.classList.remove('hide'); hintOverlay.style.removeProperty('display'); }
function fullyHideHint() { if (!hintOverlay) return; hintOverlay.classList.add('hide'); hintOverlay.style.pointerEvents = 'none'; const rm = () => { try { hintOverlay.removeEventListener('transitionend', rm); } catch { } try { hintOverlay.remove(); } catch { } }; hintOverlay.addEventListener('transitionend', rm); setTimeout(rm, 400); }
showHint();
let lastMouse = { x: 0, y: 0 }; document.addEventListener('mousemove', (e) => { lastMouse.x = e.clientX; lastMouse.y = e.clientY; }, { passive: true });
function isPointerOver(elem) { if (!elem) return false; const r = elem.getBoundingClientRect(); return lastMouse.x >= r.left && lastMouse.x <= r.right && lastMouse.y >= r.top && lastMouse.y <= r.bottom; }
function unmuteAndRestartFromZero() {
  hasClickedUnmuteOverlay = true;
  mainVideo.muted = false;
  webcamVideo.muted = false;
  if (bgMusic) bgMusic.muted = false;
  previewLoopActive = false;
  setMainTimeAndHardSync(0);
  ignoreSeeksUntil = performance.now() + 800;
  unmutedSessionStartedAtZero = true;
  playBound();
  fullyHideHint();
  updateMainUI();
  if (isPointerOver(frameEl)) { frameEl.classList.add('is-hovering'); updateMainUI(); }
  stabilizeIntrigue(800);
  primeEndMusicOnce();
}
hintOverlay.addEventListener('click', unmuteAndRestartFromZero);
hintBtn.addEventListener('click', (e) => { e.stopPropagation(); unmuteAndRestartFromZero(); });
function updateMainUI() { const unmuted = !document.body.contains(hintOverlay); if (!unmuted) { mainPlayBtn.classList.remove('show'); mainPauseHint.classList.remove('show'); return; } if (mainVideo.paused) { mainPlayBtn.classList.add('show'); mainPauseHint.classList.remove('show'); } else { mainPlayBtn.classList.remove('show'); mainPauseHint.classList.add('show'); } }
mainVideo.addEventListener('play', () => { if (isPrimaryWebcamActive() && webcamVideo.paused) webcamVideo.play().catch(() => { }); updateMainUI(); });
mainVideo.addEventListener('pause', () => { if (isPrimaryWebcamActive() && !webcamVideo.paused) webcamVideo.pause(); updateMainUI(); });
mainVideo.addEventListener('loadeddata', () => { updateMainUI(); syncPrimaryWebcamToMain({ forceWhenMetaReady: true }); stabilizeIntrigue(600); });
frameEl.addEventListener('pointermove', () => { frameEl.classList.add('is-hovering'); updateMainUI(); });
frameEl.addEventListener('pointerleave', () => { frameEl.classList.remove('is-hovering'); });
mainVideo.addEventListener('click', () => { if (document.body.contains(hintOverlay)) return; if (mainVideo.paused) { playBound(); } else { pauseBound(); } });
mainPlayBtn.addEventListener('click', (e) => { e.stopPropagation(); playBound(); });

/* ===================== Progress + time-left ===================== */
function fmtTimeLeft(totalSec, currentSec) { const remain = Math.max(0, Math.floor(totalSec - currentSec)); const m = Math.floor(remain / 60); const s = remain % 60; return `${m}:${String(s).padStart(2, '0')}`; }
let rafId = null; function progressRAF() { if (isFinite(mainVideo.duration) && mainVideo.duration > 0) { const pct = Math.min(1, Math.floor((mainVideo.currentTime / mainVideo.duration) * 10000) / 10000); progressBar.style.transform = `scaleX(${pct})`; timeLeftEl.textContent = fmtTimeLeft(mainVideo.duration, mainVideo.currentTime); } rafId = requestAnimationFrame(progressRAF); }
mainVideo.addEventListener('loadedmetadata', () => { if (!rafId) progressRAF(); }); if (mainVideo.readyState >= 1 && !rafId) progressRAF();

/* ===================== Seek gating + hover insight ===================== */
let goEndWrap, goEndBtn; // container + button
let seekUnlocked = localStorage.getItem(STORAGE_KEY_UNLOCK) === '1';
function isSeekEnabled() { return seekUnlocked; }
function applySeekLockUI() {
  if (isSeekEnabled()) {
    progress.classList.remove('disabled');
    progress.setAttribute('aria-disabled', 'false');
  } else {
    progress.classList.add('disabled');
    progress.setAttribute('aria-disabled', 'true');
  }
  if (goEndWrap) {
    goEndWrap.classList.add('visible');
    const inEnd = playerEl.classList.contains('content-hidden');
    const btn = goEndWrap.querySelector('.go-end-btn');
    if (btn) btn.style.display = (isSeekEnabled() && !inEnd) ? '' : 'none';
  }
}
progress.addEventListener('mouseenter', () => { if (!isSeekEnabled() && seekInsight) { seekInsight.classList.add('show'); } });
progress.addEventListener('mouseleave', () => { if (seekInsight) { seekInsight.classList.remove('show'); } });
let lastSafeTime = 0;
mainVideo.addEventListener('timeupdate', () => { if (mainVideo.seeking || programmaticSeekOK) return; const t = mainVideo.currentTime; if (t > lastSafeTime + 0.05) lastSafeTime = t; });
function maybeRevertUnauthorizedSeek() { const nowPerf = performance.now(); if (nowPerf < ignoreSeeksUntil) return; if (isSeekEnabled() || programmaticSeekOK) return; const t = mainVideo.currentTime; if (Math.abs(t - lastSafeTime) > SEEK_REVERT_EPS) { setMainTimeAndHardSync(lastSafeTime); } }
mainVideo.addEventListener('seeking', () => { maybeRevertUnauthorizedSeek(); });
mainVideo.addEventListener('seeked', () => { syncPrimaryWebcamToMain({ forceWhenMetaReady: true }); });
function seekFromEvent(e) {
  if (swallowClick) { swallowClick = false; return; }
  if (!isSeekEnabled()) return;
  if (!isFinite(mainVideo.duration) || mainVideo.duration <= 0) return;
  const rect = progress.getBoundingClientRect();
  const clientX = (e.clientX !== undefined) ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
  const x = Math.min(Math.max(0, clientX - rect.left), rect.width);
  const ratio = x / rect.width;
  const newTime = ratio * mainVideo.duration;
  setMainTimeAndHardSync(newTime);
}
progress.addEventListener('click', seekFromEvent);
progress.addEventListener('touchstart', seekFromEvent, { passive: true });
document.addEventListener('keydown', (e) => { if (isSeekEnabled()) return; const k = e.key; if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'j', 'J', 'l', 'L'].includes(k)) { e.preventDefault(); e.stopPropagation(); } }, true);

/* ===================== Preview loop (muted pre-roll) ===================== */
let previewLoopActive = true; const PREVIEW_LOOP_EPS = 0.12;
mainVideo.addEventListener('timeupdate', () => { if (!previewLoopActive || hasClickedUnmuteOverlay) return; const d = mainVideo.duration; if (!isFinite(d) || d <= 0) return; if (mainVideo.currentTime >= d - PREVIEW_LOOP_EPS) { setMainTimeAndHardSync(0.03); ignoreSeeksUntil = performance.now() + 200; if (mainVideo.paused) mainVideo.play().catch(() => { }); } });

/* ===================== Continuous float ===================== */
const floatStart = performance.now(); function floatRAF(now) { const t = (now - floatStart) / 1000; const x = Math.cos(t * FLOAT_SPEED_X) * FLOAT_RADIUS_X; const y = Math.sin(t * FLOAT_SPEED_Y) * FLOAT_RADIUS_Y; webcam.style.translate = `${x.toFixed(1)}px ${y.toFixed(1)}px`; requestAnimationFrame(floatRAF); } requestAnimationFrame(floatRAF);

/* ===================== Slide mechanics ===================== */
function slideWebcamUpSmall() { webcamWrap.style.transition = `transform ${SLIDE_DURATION_MS}ms cubic-bezier(.22,1,.36,1)`; webcamWrap.style.transform = `translate(${SHIFT_RIGHT_PX}px, ${-SHIFT_UP_PX}px)`; webcam.style.transition = `scale ${SLIDE_DURATION_MS}ms cubic-bezier(.22,1,.36,1), transform ${SLIDE_DURATION_MS}ms cubic-bezier(.22,1,.36,1)`; webcam.style.scale = SCALE_TOP; webcam.style.transform = `scale(1)`; webcam.classList.add('pop-pulse'); setTimeout(() => webcam.classList.remove('pop-pulse'), 450); }
function slideWebcamDownToOrigin() { webcamWrap.style.transition = `transform ${SLIDE_DURATION_MS}ms cubic-bezier(.22,1,.36,1)`; webcamWrap.style.transform = `translate(0px, 0px)`; webcam.style.transition = `scale ${SLIDE_DURATION_MS}ms cubic-bezier(.22,1,.36,1), transform ${SLIDE_DURATION_MS}ms cubic-bezier(.22,1,.36,1)`; webcam.style.scale = 1; webcam.style.transform = `scale(1)`; }

/* ===================== Orbit positioning ===================== */
function positionOrbitOnRim(angleDeg = 315) { if (!webcam || !orbitReplay) return; orbitReplay.style.top = '50%'; orbitReplay.style.left = '50%'; const r = webcam.offsetWidth / 2; if (!r) return; const theta = (angleDeg * Math.PI) / 180; const dx = Math.cos(theta) * r; const dy = Math.sin(theta) * r; orbitReplay.style.transform = `translate(-50%, -50%) translate(${dx}px, ${dy}px)`; }
window.addEventListener('resize', () => positionOrbitOnRim());

/* ===================== Fullscreen helpers (mobile button inside frame) ===================== */
function isFullscreenActive() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement);
}
async function requestFullscreenFor(el) {
  if (!el) return;
  try {
    if (el.requestFullscreen) await el.requestFullscreen();
    else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
    else if (el.msRequestFullscreen) await el.msRequestFullscreen();
  } catch {}
}
async function exitFullscreen() {
  try {
    if (document.exitFullscreen) await document.exitFullscreen();
    else if (document.webkitExitFullscreen) await document.webkitExitFullscreen();
    else if (document.msExitFullscreen) await document.msExitFullscreen();
  } catch {}
}
async function lockLandscapeIfPossible() {
  try { if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape'); } catch {}
}

function ensureWebcamInsideFrameForFS() {
  if (!frameEl || !webcamWrap) return;
  if (webcamWrap.parentNode !== frameEl) frameEl.appendChild(webcamWrap);
}
function restoreWebcamParentAfterFS() {
  try { window.__relocateWebcamForSmall && window.__relocateWebcamForSmall(); } catch {}
}

function setupFullscreenButton() {
  if (!frameEl) return;
  let btn = document.getElementById('fsBtn');
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'fsBtn';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Fullscreen');
    btn.innerHTML = '<i class="ri-fullscreen-fill" aria-hidden="true"></i>';
    frameEl.appendChild(btn);
  }
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!isFullscreenActive()) {
      ensureWebcamInsideFrameForFS();
      await requestFullscreenFor(frameEl);
      document.body.classList.add('fs-active');
      await lockLandscapeIfPossible();
    } else {
      await exitFullscreen();
    }
  });

  function onFSChange() {
    const active = isFullscreenActive();
    document.body.classList.toggle('fs-active', !!active);
    if (!active) {
      restoreWebcamParentAfterFS();
    } else {
      ensureWebcamInsideFrameForFS();
    }
    // Make sure orbit button remains positioned
    setTimeout(() => positionOrbitOnRim(315), 60);
  }
  document.addEventListener('fullscreenchange', onFSChange);
  document.addEventListener('webkitfullscreenchange', onFSChange);
}
setupFullscreenButton();

/* ===================== End state + crossfade + OFFER SFX & MUSIC ===================== */
function showEndUI() {
  document.body.classList.add('offer-mode');
  intrigue?.classList.add('hide');
  positionOrbitOnRim(315);
  orbitReplay.classList.add('show');
  endCta.classList.remove('hidden');
  endCta.setAttribute('aria-hidden', 'false');
  brandMarquee?.classList.add('show');
  brandMarquee?.setAttribute('aria-hidden', 'false');
  try { sfxOffer.currentTime = 0; sfxOffer.play().catch(() => { }); } catch { };
  if (goEndWrap) {
    const btn = goEndWrap.querySelector('.go-end-btn');
    if (btn) btn.style.display = 'none';
  }
  crossfadeToEndMusic();
  try { window.__relocateWebcamForSmall && window.__relocateWebcamForSmall(); } catch { }
  setTimeout(() => { positionOrbitOnRim(315); }, 50);
}
function hideEndUI() {
  document.body.classList.remove('offer-mode');
  intrigue?.classList.remove('hide');
  clearEndCrossfadeTimer();
  orbitReplay.classList.remove('show');
  endCta.classList.add('hidden');
  endCta.setAttribute('aria-hidden', 'true');
  brandMarquee?.classList.remove('show');
  if (goEndWrap) {
    const btn = goEndWrap.querySelector('.go-end-btn');
    if (btn) btn.style.display = isSeekEnabled() ? '' : 'none';
  }
  crossfadeBackToMainMusic();
  try { window.__relocateWebcamForSmall && window.__relocateWebcamForSmall(); } catch { }
  setTimeout(() => { positionOrbitOnRim(315); }, 50);
}
function crossfadeToWebcamEnd(delayMs = 1000) {
  clearEndCrossfadeTimer();
  try { webcamVideo.pause(); } catch { }
  webcamPlayUI.classList.remove('show');
  webcamPauseHint.classList.remove('show');
  endCrossfadeTimer = setTimeout(() => {
    endCrossfadeTimer = null;
    try { webcamVideo2.currentTime = 0; } catch { }
    enterEndMode();
    webcamVideo2.play().catch(() => { });
  }, Math.max(0, delayMs));
}
function crossfadeBackToWebcamPrimary() { enterNormalMode(); webcamVideo.play().catch(() => { }); }

mainVideo.addEventListener('ended', async () => {
  if (!hasClickedUnmuteOverlay) {
    setMainTimeAndHardSync(0.03);
    ignoreSeeksUntil = performance.now() + 200;
    mainVideo.play().catch(() => { });
    return;
  }
  maybeUnlockSeekOnEnd();
  // If we’re in fullscreen, exit first so the offer shows in normal orientation/layout
  if (isFullscreenActive()) {
    await exitFullscreen();
  }
  frameEl.classList.add('dim');
  playerEl.classList.add('content-hidden');
  navTimer?.classList.add('hide');
  slideWebcamUpSmall();
  showEndUI();
  crossfadeToWebcamEnd(300);
});
function isEndClipActive() { return isInEndMode && parseFloat(getComputedStyle(webcamVideo2).opacity || '0') > 0.5; }
webcam.addEventListener('click', () => { if (!isEndClipActive()) return; if (webcamVideo2.paused) { webcamPlayUI.classList.remove('show'); webcamVideo2.play().catch(() => { }); } else { webcamVideo2.pause(); webcamPlayUI.classList.add('show'); } });
webcam.addEventListener('pointermove', () => { if (isEndClipActive() && !webcamVideo2.paused) { webcamPauseHint.classList.add('show'); } });
webcam.addEventListener('pointerleave', () => { webcamPauseHint.classList.remove('show'); });
webcamVideo2.addEventListener('play', () => { if (isInEndMode) webcamPlayUI.classList.remove('show'); });
webcamVideo2.addEventListener('pause', () => { if (isInEndMode) webcamPlayUI.classList.add('show'); });
webcamVideo2.addEventListener('ended', () => { if (isInEndMode) webcamPlayUI.classList.add('show'); });

function replayMain() {
  orbitReplay.classList.add('spin');
  setTimeout(() => orbitReplay.classList.remove('spin'), 600);
  clearEndCrossfadeTimer();
  enterNormalMode();
  slideWebcamDownToOrigin();
  hideEndUI();
  setMainTimeAndHardSync(0);
  ignoreSeeksUntil = performance.now() + 400;
  previewLoopActive = false;
  playerEl.classList.remove('content-hidden');
  frameEl.classList.remove('dim');
  navTimer?.classList.remove('hide');
  Promise.allSettled([mainVideo.play(), webcamVideo.play()]).finally(() => { });
}
orbitReplay.addEventListener('click', replayMain);
function maybeUnlockSeekOnEnd() { if (unmutedSessionStartedAtZero && !mainVideo.muted) { seekUnlocked = true; localStorage.setItem(STORAGE_KEY_UNLOCK, '1'); applySeekLockUI(); } }

document.getElementById('ctaSession')?.addEventListener('click', () => { window.open('https://calendly.com/rnq/30min', '_blank', 'noopener'); });
document.getElementById('ctaVideoReply')?.addEventListener('click', () => { console.log('Record a quick reply clicked'); });
function goToEndNow() {
  if (!isSeekEnabled()) return; // only after first full watch
  try { mainVideo.pause(); } catch { }
  try { webcamVideo.pause(); } catch { }

  frameEl.classList.add('dim');
  playerEl.classList.add('content-hidden');
  navTimer?.classList.add('hide');

  slideWebcamUpSmall();
  showEndUI();
  crossfadeToWebcamEnd(100);
}

/* ===================== Seamless marquee (kept) ===================== */
(function setupMarquee() { if (!brandTrack) return; const container = brandTrack.parentElement; const baseItems = Array.from(brandTrack.children).map(n => n.cloneNode(true)); function ensureFill() { brandTrack.innerHTML = ''; baseItems.forEach(n => brandTrack.appendChild(n.cloneNode(true))); while (brandTrack.scrollWidth < container.clientWidth * 2) { baseItems.forEach(n => brandTrack.appendChild(n.cloneNode(true))); } baseItems.forEach(n => brandTrack.appendChild(n.cloneNode(true))); } ensureFill(); const PX_PER_SEC = 120; const setDur = () => { const totalWidth = brandTrack.scrollWidth; const dur = (totalWidth / 2) / PX_PER_SEC; brandTrack.style.animationDuration = `${dur}s`; }; setDur(); let rAF = null; window.addEventListener('resize', () => { if (rAF) cancelAnimationFrame(rAF); rAF = requestAnimationFrame(() => { ensureFill(); setDur(); positionIntrigueBetween(); }); }); })();

/* ===================== PIN overlay logic (now waits for hydration) ===================== */
(function setupPin() {
  const pinOverlay = document.getElementById('pinOverlay');
  const pinBoxes = document.getElementById('pinBoxes');
  const pinError = document.getElementById('pinError');
  const digits = [];
  const cells = Array.from(pinBoxes.querySelectorAll('.pin-digit'));

  // Mobile-friendly hidden input (1×1 offscreen, not 0×0)
  const pinInput = document.createElement('input');
  pinInput.type = 'tel';
  pinInput.inputMode = 'numeric';
  pinInput.pattern = '[0-9]*';
  pinInput.autocomplete = 'one-time-code';
  pinInput.maxLength = 4;
  Object.assign(pinInput.style, {
    position: 'absolute',
    left: '-9999px',
    top: '0',
    width: '1px',
    height: '1px',
    opacity: '0'
  });
  pinOverlay.appendChild(pinInput);

  function focusPinInputSoon() { setTimeout(() => { try { pinInput.focus(); } catch { } }, 0); }
  pinOverlay.addEventListener('click', focusPinInputSoon);
  pinOverlay.addEventListener('touchstart', focusPinInputSoon, { passive: true });

  function render() { cells.forEach((c, i) => { const filled = i < digits.length; c.classList.toggle('filled', filled); c.textContent = filled ? '•' : ''; }); }
  function flashError() { pinError.classList.add('show'); cells.forEach(c => { c.classList.add('pulse'); setTimeout(() => c.classList.remove('pulse'), 900); }); setTimeout(() => pinError.classList.remove('show'), 1400); }
  function clearDigits() { digits.length = 0; render(); }
  function playPinSound() { if (!sfxPin) return; try { sfxPin.currentTime = 0; sfxPin.play().catch(() => { }); } catch { } }
  function slideOutOverlay() { pinOverlay.classList.add('fade-out'); setTimeout(() => { pinOverlay.style.display = 'none'; }, 380); }

  // Only validate AFTER hydration so PIN_EXPECTED is correct on first try
  let hydratedOnce = false;
  HYDRATE_DONE.then(() => { hydratedOnce = true; });

  function validateNow() {
    if (!hydratedOnce) return; // wait for hydrate
    if (!PIN_REQUIRED) { onPass(); return; }
    if (digits.length !== 4) return;
    const attempt = digits.join('');
    if (String(attempt) === String(PIN_EXPECTED)) { onPass(); }
    else { flashError(); setTimeout(() => { clearDigits(); focusPinInputSoon(); }, 180); }
  }
  async function onPass() {
    slideOutOverlay();
    try { pinInput.blur(); } catch { }
    await HYDRATE_DONE; // ensure data is ready
    if (HYDR.notFound) { showNotFound(); return; }
    runSequence();
  }

  pinInput.addEventListener('input', () => {
    const v = (pinInput.value || '').replace(/\D/g, '').slice(0, 4);
    digits.length = 0;
    for (const ch of v) digits.push(ch);
    render();
    if (digits.length === 4) validateNow();
  });

  function onKey(e) {
    if (!pinOverlay || pinOverlay.style.display === 'none') return;
    const k = e.key;
    if (k >= '0' && k <= '9') { if (digits.length < 4) { digits.push(k); render(); playPinSound(); if (digits.length === 4) validateNow(); } e.preventDefault(); return; }
    if (k === 'Backspace' || k === 'Delete') { if (digits.length > 0) { digits.pop(); render(); playPinSound(); } e.preventDefault(); return; }
  }
  document.addEventListener('keydown', onKey, true);
  render();
  focusPinInputSoon();

  (async function waitForPinDecision() {
    await HYDRATE_DONE;
    if (!PIN_REQUIRED) { onPass(); }
  })();
})();

/* ===================== Music navbar toggle (controls both tracks) ===================== */
(function setupMusicToggle() {
  if (!musicToggle) return;

  if (bgMusic) setVolumeSafe(bgMusic, MUSIC.MAIN_VOL);
  if (endMusic) setVolumeSafe(endMusic, 0);

  function updateBtn() {
    const off = !musicEnabled || ((bgMusic?.paused ?? true) && (endMusic?.paused ?? true));
    musicToggle.classList.toggle('off', off);
  }
  musicToggle.addEventListener('click', () => {
    musicEnabled = !musicEnabled;
    if (!musicEnabled) {
      pauseBothMusic();
    } else {
      playActiveMusicForState();
    }
    updateBtn();
  });

  bgMusic?.addEventListener('play', updateBtn);
  bgMusic?.addEventListener('pause', updateBtn);
  endMusic?.addEventListener('play', updateBtn);
  endMusic?.addEventListener('pause', updateBtn);
  updateBtn();
})();

/* ===================== Seek-locked message spacing + z-index + width ===================== */
function applySeekInsightStyleFromCSS() {
  if (!seekInsight) return;
  const cs = getComputedStyle(document.documentElement);

  const gap = (cs.getPropertyValue('--seekinsight-gap') || '').trim() || '10px';
  const z   = (cs.getPropertyValue('--seekinsight-z') || '').trim() || '10060';
  const w   = (cs.getPropertyValue('--seekinsight-width') || '').trim();

  seekInsight.style.marginTop = gap;
  seekInsight.style.zIndex = String(parseInt(z, 10) || 10060);
  if (w) {
    seekInsight.style.maxWidth = w;
    seekInsight.style.width = 'auto';
  }
}
applySeekInsightStyleFromCSS();
window.addEventListener('resize', applySeekInsightStyleFromCSS);

/* ===================== Setup Go-to-End & mobile docking ===================== */
function setupGoToEndButton() {
  if (!playerEl) return;

  goEndWrap = document.createElement('div');
  goEndWrap.className = 'go-end-wrap';

  goEndBtn = document.createElement('button');
  goEndBtn.id = 'goToEndBtn';
  goEndBtn.type = 'button';
  goEndBtn.className = 'go-end-btn';
  goEndBtn.setAttribute('aria-label', 'Go to the end');
  goEndBtn.innerHTML = `
    <i class="ri-skip-forward-fill" aria-hidden="true"></i>
    <span class="go-end-text">Go to the end</span>
  `;

  goEndWrap.appendChild(goEndBtn);
  playerEl.parentNode.insertBefore(goEndWrap, playerEl.nextSibling);

  goEndBtn.addEventListener('click', () => {
    if (goEndWrap) {
      const btn = goEndWrap.querySelector('.go-end-btn');
      if (btn) btn.style.display = 'none';
    }
    goToEndNow();
  });

  const btn = goEndWrap.querySelector('.go-end-btn');
  if (btn) btn.style.display = 'none';

  window.__belowPlayerArea = goEndWrap;

  function relocateWebcamForSmall() {
    const isSmall = window.matchMedia('(max-width: 768px)').matches;
    if (!webcamWrap) return;

    if (isSmall && document.body.classList.contains('offer-mode') && topDock) {
      if (webcamWrap.parentNode !== topDock) topDock.appendChild(webcamWrap);
      document.body.dataset.webcamPosition = 'below';
      requestAnimationFrame(() => { positionOrbitOnRim(315); });
      return;
    }

    const area = window.__belowPlayerArea;
    if (isSmall && area) {
      if (webcamWrap.parentNode !== area) area.appendChild(webcamWrap);
      document.body.dataset.webcamPosition = 'below';
      requestAnimationFrame(() => { positionOrbitOnRim(315); });
      return;
    }

    if (webcamWrap.parentNode !== playerEl) playerEl.appendChild(webcamWrap);
    delete document.body.dataset.webcamPosition;
    requestAnimationFrame(() => { positionOrbitOnRim(315); });
  }

  window.__relocateWebcamForSmall = relocateWebcamForSmall;

  relocateWebcamForSmall();
  window.addEventListener('resize', relocateWebcamForSmall);

  applySeekLockUI();
}
setupGoToEndButton();

/* ===================== HOVER/CURSOR TIME LABEL (init deferred) ===================== */
function initHoverTimeLabel(){
  if (!progress || !mainVideo) return;

  const HITBOX_PAD = 16;     // easier finger grab without layout shift
  const SCRUB_START_PX = 4;  // start scrubbing only after a small move

  function getLabelGap() {
    const cs = getComputedStyle(document.documentElement);
    const v = (cs.getPropertyValue('--seeklabel-gap') || '').trim();
    const px = parseFloat(v);
    return Number.isFinite(px) ? px : 8;
  }
  const clampLocal = (n, a, b) => Math.max(a, Math.min(b, n));
  const fmtClock = (sec) => {
    sec = Math.max(0, Math.floor(sec || 0));
    const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60), s = sec%60;
    const pad = n => String(n).padStart(2,'0');
    return h>0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  };
  const rect = () => progress.getBoundingClientRect();
  const duration = () => (isFinite(mainVideo.duration) ? mainVideo.duration : 0);
  const timeFromClientX = (clientX) => {
    const r = rect();
    const x = clampLocal(clientX - r.left, 0, r.width);
    const ratio = r.width ? x / r.width : 0;
    return ratio * duration();
  };

  const overlay = document.createElement('div');
  Object.assign(overlay.style, {
    position: 'fixed',
    left: '0px', top: '0px', width: '0px', height: '0px',
    pointerEvents: 'auto',
    background: 'transparent',
    zIndex: '10050',
    touchAction: 'none'
  });
  document.body.appendChild(overlay);

  const label = document.createElement('div');
  Object.assign(label.style, {
    position: 'fixed',
    left: '0px', top: '0px',
    transform: 'translateX(-50%)',
    padding: '4px 6px',
    fontSize: '12.5px',
    fontWeight: '800',
    lineHeight: '1',
    color: '#fff',
    background: 'rgba(0,0,0,.68)',
    borderRadius: '8px',
    boxShadow: '0 2px 8px rgba(0,0,0,.18)',
    textShadow: '0 1px 0 rgba(0,0,0,.25)',
    whiteSpace: 'nowrap',
    opacity: '0',
    transition: 'opacity .12s ease',
    pointerEvents: 'none',
    zIndex: '10060'
  });
  document.body.appendChild(label);

  let insideOverlay = false;
  let pointerDown = false;
  let scrubbing = false;
  let moved = 0;
  let lastX = 0;
  let wasPlaying = false;
  let activePointerId = null;

  function placeOverlay(){
    const r = rect();
    overlay.style.left   = `${Math.round(r.left)}px`;
    overlay.style.top    = `${Math.round(r.top - HITBOX_PAD)}px`;
    overlay.style.width  = `${Math.round(r.width)}px`;
    overlay.style.height = `${Math.round(r.height + HITBOX_PAD*2)}px`;
  }
  placeOverlay();
  window.addEventListener('resize', placeOverlay);

  function moveLabelTo(clientX){
    const r = rect();
    const x = clampLocal(clientX, r.left, r.right);
    const gap = getLabelGap();
    const topY = r.top - gap - (label.offsetHeight || 18);
    label.style.left = `${Math.round(x)}px`;
    label.style.top  = `${Math.round(Math.max(0, topY))}px`;
  }
  function showLabel(show){ label.style.opacity = show ? '1' : '0'; }

  function updateAt(clientX){
    const t = timeFromClientX(clientX);
    label.textContent = fmtClock(t);
    moveLabelTo(clientX);
  }

  function maybeShowLockedMessage(show){
    if (!seekInsight) return;
    if (!isSeekEnabled() && show) {
      seekInsight.classList.add('show');
    } else if (!pointerDown) {
      seekInsight.classList.remove('show');
    }
  }

  function begin(e){
    pointerDown = true;
    scrubbing = false;
    moved = 0;
    wasPlaying = !mainVideo.paused;
    lastX = e.clientX ?? (e.touches?.[0]?.clientX || 0);
    activePointerId = e.pointerId ?? null;

    try { if (activePointerId != null) overlay.setPointerCapture(activePointerId); } catch {}

    showLabel(true);
    updateAt(lastX);

    if (isSeekEnabled()) {
      setMainTimeAndHardSync(timeFromClientX(lastX));
      overlay.style.cursor = 'pointer';
    } else {
      overlay.style.cursor = 'not-allowed';
      maybeShowLockedMessage(true);
    }

    e.preventDefault();
  }

  function move(e){
    const x = e.clientX ?? (e.touches?.[0]?.clientX || 0);

    if (!pointerDown) {
      if (!insideOverlay) return;
      showLabel(true);
      updateAt(x);
      if (!isSeekEnabled()) maybeShowLockedMessage(true);
      return;
    }

    moved += Math.abs(x - lastX);
    lastX = x;
    updateAt(x);

    if (isSeekEnabled() && !scrubbing && moved >= SCRUB_START_PX) {
      scrubbing = true;
      if (wasPlaying) pauseBound();
    }

    if (scrubbing && isSeekEnabled()) {
      setMainTimeAndHardSync(timeFromClientX(x));
      e.preventDefault();
    }
  }

  function end(){
    if (scrubbing && wasPlaying) playBound();
    pointerDown = false;
    scrubbing = false;

    try { if (activePointerId != null) overlay.releasePointerCapture(activePointerId); } catch {}
    activePointerId = null;

    if (!insideOverlay) {
      showLabel(false);
      seekInsight && seekInsight.classList.remove('show');
    }
  }

  overlay.addEventListener('pointerenter', () => {
    insideOverlay = true;
    overlay.style.cursor = isSeekEnabled() ? 'pointer' : 'not-allowed';
    showLabel(true);
    if (!isSeekEnabled()) maybeShowLockedMessage(true);
  });
  overlay.addEventListener('pointerleave', () => {
    insideOverlay = false;
    if (!pointerDown) {
      showLabel(false);
      seekInsight && seekInsight.classList.remove('show');
    }
  });

  overlay.addEventListener('pointerdown', begin, { passive: false });
  overlay.addEventListener('pointermove', move,  { passive: false });
  overlay.addEventListener('pointerup',   end);
  overlay.addEventListener('pointercancel', end);

  window.__updateScrubOverlay = function(){
    overlay.style.cursor = isSeekEnabled() ? 'pointer' : 'not-allowed';
  };
  window.__updateScrubOverlay();
}

/* ===================== Utilities kept ===================== */
skipIntroBtn.addEventListener('click', () => { cancelIntroSequence(); nav.classList.add('show'); showStage(); localStorage.setItem(STORAGE_KEY_INTRO_OK, '1'); skipIntroBtn.classList.remove('show'); skipIntroBtn.classList.add('hidden'); orbitReplay.classList.remove('show'); });

function hideHeadlineTimer() {
  const badge = document.getElementById('separateCountdown')?.closest('.exclusive-badge');
  if (badge) badge.style.display = 'none';
}
