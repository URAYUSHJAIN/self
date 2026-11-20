// The Shelf controller: one owner for surface state, history and focus.
// State is always derived from the URL; every control is a real link or is
// enhanced from a non-interactive element, so nothing is dead without JS.
import { gsap } from 'gsap';
import { initGlobe } from './globe';
import { initLaptop } from './laptop';
import { initSteam } from './steam';
import type { Diary } from './diary';

type State = { surface: string | null; record: string | null; params: URLSearchParams; hash: string };

const SURFACES = new Set(['about', 'projects', 'patents', 'experience', 'education', 'achievements', 'toolbox', 'certifications', 'writing', 'laptop', 'contact']);
const desktopMQ = window.matchMedia('(min-width: 1000px) and (min-height: 560px)');
const reduceMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel);
const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => Array.from(root.querySelectorAll<T>(sel));

const stage = $('[data-scene]')!;
const baseTitle = 'Ayush Jain — The Shelf';
let lastTrigger: HTMLElement | null = null;
const laptopEl = $('[data-laptop]');
let laptop: ReturnType<typeof initLaptop> | null = null;
const surfaceEl = (surface: string) => (surface === 'laptop' ? laptopEl : $(`[data-surface="${surface}"]`));
let current: State = parse(location.href);

function parse(href: string): State {
  const url = new URL(href, location.href);
  const parts = url.pathname.split('/').filter(Boolean);
  let surface: string | null = parts[0] && SURFACES.has(parts[0]) ? parts[0] : null;
  let record: string | null = null;
  if (surface === 'projects' && parts[1] && /^[a-z0-9-]+$/.test(parts[1])) record = parts[1];
  if (!surface) record = null;
  return { surface, record, params: url.searchParams, hash: url.hash };
}

/* ---------------- Lazy surfaces ----------------
   Every page is prerendered with only its own drawer content (and, on a
   project page, its own record). Other drawers are fetched from their stable
   URLs the first time they are opened, then kept. Without JavaScript the same
   links simply navigate. */

const pages = new Map<string, Promise<Document | null>>();
function fetchPage(path: string) {
  let page = pages.get(path);
  if (!page) {
    page = fetch(path, { headers: { Accept: 'text/html' } })
      .then((r) => (r.ok ? r.text() : null))
      .then((html) => (html ? new DOMParser().parseFromString(html, 'text/html') : null))
      .catch(() => null);
    pages.set(path, page);
    // A failed request may be retried on the next attempt.
    page.then((doc) => { if (!doc) pages.delete(path); });
  }
  return page;
}

/** Makes sure the state's drawer body (and record) exist in the document. */
async function ensure(state: State): Promise<boolean> {
  const { surface } = state;
  if (!surface || surface === 'laptop') return true;
  const body = $(`#panel-${surface} .panel__body`);
  if (!body) return true;
  if (body.hasAttribute('data-lazy')) {
    const doc = await fetchPage(`/${surface}/`);
    const source = doc?.querySelector(`#panel-${surface} .panel__body`);
    if (!source || source.hasAttribute('data-lazy')) return false;
    if (body.hasAttribute('data-lazy')) {
      body.replaceChildren(...Array.from(source.childNodes, (n) => document.importNode(n, true)));
      body.removeAttribute('data-lazy');
      bindSurface(surface);
    }
  }
  if (surface === 'projects' && state.record && !$(`[data-record-view="${CSS.escape(state.record)}"]`)) {
    const doc = await fetchPage(`/projects/${state.record}/`);
    const article = doc?.querySelector(`[data-record-view="${CSS.escape(state.record)}"]`);
    if (!doc) return false;
    if (!article) state.record = null; // unknown slug: show the folder list
    else if (!$(`[data-record-view="${CSS.escape(state.record)}"]`)) body.append(document.importNode(article, true));
  }
  return true;
}

/** Warm the cache as soon as a visitor reaches for a drawer or folder. */
function prefetch(e: Event) {
  const a = (e.target as Element | null)?.closest?.<HTMLAnchorElement>('a[data-nav]');
  if (!a || a.target === '_blank') return;
  const next = parse(a.href);
  if (!next.surface || next.surface === 'laptop') return;
  if ($(`#panel-${next.surface} .panel__body`)?.hasAttribute('data-lazy')) void fetchPage(`/${next.surface}/`);
  if (next.record && !$(`[data-record-view="${CSS.escape(next.record)}"]`)) void fetchPage(`/projects/${next.record}/`);
}
document.addEventListener('pointerenter', prefetch, { capture: true, passive: true });
document.addEventListener('focusin', prefetch, { passive: true });
document.addEventListener('touchstart', prefetch, { capture: true, passive: true });

/* ---------------- Rendering ---------------- */

// The original front is temporarily housed with its tray. Its empty slot stays
// in the cabinet, preserving layout and exposing the recessed cavity.
let mounted: HTMLElement | null = null;
let renderVersion = 0;
let lastHardLoad = '';
// One paused timeline per mounted drawer runs closed (0) → open (1). Opening
// and closing both tween its progress with the same ease, so a push is the
// exact mirror of a pull and a mid-motion press reverses from where it is.
const PULL_S = 0.5;
let motion: gsap.core.Timeline | null = null;
let pull: gsap.core.Tween | null = null;
let closedPose: gsap.TweenVars = {};
let openPose: gsap.TweenVars = {};
let closedClipTop = 0;
const openClipTop = -24;

function placeDrawer(panel: HTMLElement) {
  const slot = $(`[data-drawer-slot="${panel.dataset.surface}"]`)!;
  const front = $('.drawer', panel) ?? $('.drawer', slot)!;
  const rect = slot.getBoundingClientRect();
  const mobile = !desktopMQ.matches;
  const viewport = window.visualViewport;
  const vh = viewport?.height ?? innerHeight;
  const vw = viewport?.width ?? innerWidth;
  const offsetTop = viewport?.offsetTop ?? 0;
  const frontHeight = rect.height;
  const width = mobile ? Math.min(640, vw - 24) : Math.min(590, vw - 48);
  const left = mobile ? (vw - width) / 2 : Math.max(24, Math.min(vw - width - 24, rect.left + rect.width / 2 - width / 2));
  // Desktop keeps the tray's rear at its slot. Narrow screens use a framed
  // wooden tray with an internal scroll area, keeping all controls in reach.
  const top = mobile ? offsetTop + 34 : Math.max(32, Math.min(rect.top + 28, vh - 280));
  const depth = mobile ? Math.max(100, vh - frontHeight - 86) : Math.min(465, vh - top - frontHeight - 38);
  const angle = mobile ? 2 : 7;
  panel.style.cssText = `--u:${getComputedStyle(slot).getPropertyValue('--u')};--tray-angle:${angle}deg;--tray-depth:${depth}px;--front-height:${frontHeight}px;left:${left}px;top:${top}px;width:${width}px;height:${depth + frontHeight + 18}px`;
  openPose = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotationX: angle };
  closedClipTop = rect.top - top - 4;
  $('.drawer-front-mount', panel)!.append(front);
  slot.classList.add('is-vacant');
  panel.classList.add('is-mounted');
  closedPose = fitToSlot(panel, rect);
  front.setAttribute('aria-label', `Close ${$('.drawer__label', front)!.textContent}`);
}

// The centred origin, taller tray front and its perspective Z-lift make the
// closed pose impractical to derive, so measure the mounted front and correct
// until it covers its cabinet slot exactly. Runs synchronously, before paint.
function fitToSlot(panel: HTMLElement, slot: DOMRect) {
  const assembly = $('.drawer-assembly', panel)!;
  const front = $('.drawer-front-mount', panel)!;
  const pose = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotationX: 0 };
  for (let i = 0; i < 3; i++) {
    gsap.set(assembly, pose);
    let f = front.getBoundingClientRect();
    if (!f.width || !f.height) break; // not laid out; keep the last pose
    pose.scaleX *= slot.width / f.width;
    pose.scaleY *= slot.height / f.height;
    gsap.set(assembly, pose);
    f = front.getBoundingClientRect();
    pose.x += slot.left - f.left;
    pose.y += slot.top - f.top;
  }
  return pose;
}

function buildMotion(panel: HTMLElement, progress = 0) {
  motion?.kill();
  // The shell clip is tweened through its top inset only; computed clip-path
  // strings may be shortened by the browser and would not interpolate reliably.
  const clip = { top: closedClipTop };
  const applyClip = () => (panel.style.clipPath = `inset(${clip.top}px -40px -40px -40px)`);
  motion = gsap
    .timeline({ paused: true, defaults: { ease: 'none' } })
    .fromTo($('.drawer-assembly', panel)!, closedPose, { ...openPose, duration: 1 }, 0)
    .fromTo(clip, { top: closedClipTop }, { top: openClipTop, duration: 1, onUpdate: applyClip }, 0)
    // Contents surface as the tray clears the cabinet, and sink first on the push back.
    .fromTo($$('.panel__sheet > *', panel), { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.35 }, 0.65)
    .progress(progress);
  applyClip();
}

function animateDrawer(panel: HTMLElement, open: boolean, instant = false) {
  const sheet = $('.panel__sheet', panel)!;
  const target = open ? 1 : 0;
  pull?.kill();
  panel.dataset.phase = open ? 'opening' : 'closing';
  // Freeze only the content, so pressing the original front can reverse a pull.
  sheet.inert = true;
  // A partial reversal takes the matching share of the full travel time.
  const duration = instant || reduceMQ.matches ? 0 : PULL_S * Math.abs(target - motion!.progress());
  return new Promise<void>((resolve) => {
    pull = gsap.to(motion!, {
      progress: target,
      duration,
      ease: 'power2.inOut',
      onInterrupt: resolve,
      onComplete: () => {
        pull = null;
        panel.dataset.phase = open ? 'open' : 'closed';
        sheet.inert = !open;
        resolve();
      },
    });
  });
}

// Folders settle in: 2px rise, 30 ms stagger, capped at six (micro-interactions §5).
function settleFolders() {
  if (reduceMQ.matches) return;
  const shown = items().filter((li) => !li.hidden).slice(0, 6);
  gsap.fromTo(shown, { opacity: 0, y: 2 }, { opacity: 1, y: 0, duration: 0.24, stagger: 0.03, ease: 'power2.out', clearProps: 'opacity,transform' });
}

function restoreDrawer(panel: HTMLElement) {
  const slot = $(`[data-drawer-slot="${panel.dataset.surface}"]`)!;
  const front = $('.drawer', panel)!;
  slot.append(front);
  slot.classList.remove('is-vacant');
  front.removeAttribute('aria-label');
  panel.classList.remove('is-mounted');
  panel.removeAttribute('style');
  motion?.kill();
  motion = null;
  gsap.set($('.drawer-assembly', panel)!, { clearProps: 'all' });
  gsap.set($$('.panel__sheet > *', panel), { clearProps: 'opacity,transform' });
  panel.hidden = true;
  mounted = null;
}

async function render(state: State, focus: 'move' | 'none' = 'move', instant = false) {
  const version = ++renderVersion;
  if (!(await ensure(state))) {
    // Offline or a failed fetch: fall back to an ordinary page load.
    if (version === renderVersion && location.href !== lastHardLoad) {
      lastHardLoad = location.href;
      location.reload();
    }
    return;
  }
  if (version !== renderVersion) return;
  const prev = current;
  current = state;
  laptop?.sync(state.surface === 'laptop', instant);
  laptop?.fit();
  const next = state.surface ? $(`[data-drawer-surface="${state.surface}"]`) : null;
  if (mounted && mounted !== next) {
    const closing = mounted;
    await animateDrawer(closing, false, instant);
    if (version !== renderVersion) return;
    restoreDrawer(closing);
  }
  if (version !== renderVersion) return;
  renderContent(state, 'none', prev);
  if (next) {
    if (mounted !== next) {
      mounted = next;
      placeDrawer(next);
      buildMotion(next);
    } else if (instant) {
      // Resize or history: re-measure and keep the tray where it was.
      placeDrawer(next);
      buildMotion(next, motion?.progress() ?? 0);
    }
    if (next.dataset.phase !== 'open' || instant) await animateDrawer(next, true, instant);
    if (version !== renderVersion) return;
  }
  renderContent(state, focus, prev);
}

function renderContent(state: State, focus: 'move' | 'none', prev: State) {
  const modal = !desktopMQ.matches;

  for (const panel of $$('[data-surface]')) {
    const open = panel.dataset.surface === state.surface;
    const entering = open && panel.hidden && !panel.dataset.drawerSurface;
    const leaving = !open && !panel.hidden;
    panel.hidden = !open;
    if (leaving && panel.dataset.surface === 'contact') resetDiary(panel); // hidden in this same step: nothing can flash
    if (entering && !reduceMQ.matches) {
      const sheet = $('.panel__sheet', panel);
      if (panel.dataset.surface === 'contact') {
        // The notebook itself rises from the desk (on first opening, once its book is built).
        const host = $<HTMLElement>('.diary', panel);
        if (host && diary) void openDiaryFromDesk(host);
      } else {
        gsap.fromTo(sheet, desktopMQ.matches ? { x: 28, opacity: 0 } : { y: 24, opacity: 0 }, { x: 0, y: 0, opacity: 1, duration: 0.26, ease: 'power2.out', clearProps: 'transform,opacity' });
      }
    }
    if (open && modal) {
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');
    } else {
      panel.setAttribute('role', 'region');
      panel.removeAttribute('aria-modal');
    }
  }

  // Active objects
  for (const el of $$('[data-nav]')) {
    const nav = el.dataset.nav;
    const isDrawer = el.classList.contains('drawer');
    if (nav && nav !== 'home' && !el.closest('[data-panels], .lt-ui') && !el.classList.contains('chip') && !el.closest('.note')) {
      if (nav === state.surface) el.setAttribute('aria-current', isDrawer ? 'page' : 'true');
      else el.removeAttribute('aria-current');
    }
  }
  for (const d of $$('.drawer')) d.setAttribute('aria-expanded', String(d.dataset.nav === state.surface));
  const laptopOpen = state.surface === 'laptop';
  // While the laptop is open the cabinet drawers cannot be opened (no click,
  // tap, focus or assistive activation); the laptop's own links still lead out.
  for (const d of $$('.drawer')) d.inert = laptopOpen;
  if (laptopEl) {
    if (laptopOpen) {
      laptopEl.setAttribute('role', modal ? 'dialog' : 'region');
      laptopEl.setAttribute('aria-labelledby', 'laptop-title');
      modal ? laptopEl.setAttribute('aria-modal', 'true') : laptopEl.removeAttribute('aria-modal');
    } else {
      for (const a of ['role', 'aria-labelledby', 'aria-modal']) laptopEl.removeAttribute(a);
    }
  }

  // Background is inert while a modal sheet is open (tablet/mobile). The
  // laptop overlay lives inside the stage, so only its surroundings go inert.
  const inertBg = !!state.surface && modal;
  stage.inert = inertBg && !laptopOpen;
  isolate(inertBg && laptopOpen ? laptopEl : null);
  document.body.style.overflow = inertBg ? 'hidden' : '';

  if (state.surface === 'projects') renderProjects(state);
  if (state.surface === 'writing') selectTab(state.params.get('tab') || 'blogs', false);
  if (state.surface === 'contact') selectContactPage(state.params.get('page') || 'intro');
  if (state.surface === 'patents' && state.hash.startsWith('#patent-')) {
    const d = $<HTMLDetailsElement>(state.hash);
    if (d) {
      d.open = true;
      requestAnimationFrame(() => d.scrollIntoView({ block: 'center', behavior: reduceMQ.matches ? 'auto' : 'smooth' }));
    }
  }
  if (prev.record && prev.record !== state.record) pauseVideos();
  if (prev.surface !== state.surface) pauseVideos();

  const panel = state.surface ? surfaceEl(state.surface) : null;
  const recordTitle = state.record ? $(`#record-${CSS.escape(state.record)}-title`) : null;
  const heading = laptopOpen ? laptop?.title() ?? null : $('.panel__title', panel ?? document);
  // Same patterns as the prerendered pages (seo-optimization.md §5.2).
  if (!state.surface) document.title = baseTitle;
  else if (recordTitle) document.title = `${recordTitle.textContent} — Project by Ayush Jain`;
  else if (state.surface === 'about') document.title = 'About Ayush Jain';
  else document.title = `${laptopOpen ? 'Laptop' : heading?.textContent ?? ''} — Ayush Jain`;

  if (focus === 'none') return;
  if (state.surface && panel) {
    const target = recordTitle ?? (prev.record && !state.record ? null : heading);
    if (target) target.focus({ preventScroll: true });
    else if (prev.record && !state.record) {
      const folder = $(`.folder[data-record="${CSS.escape(prev.record)}"]`, panel) ?? heading;
      folder?.focus();
    }
    if (target === heading) $('.panel__body', panel)?.scrollTo({ top: 0 });
  } else if (prev.surface && !state.surface && prev.surface !== 'laptop') {
    const back =
      (lastTrigger && document.contains(lastTrigger) && !lastTrigger.closest('[data-panels]') ? lastTrigger : null) ??
      $(`.drawer[data-nav="${prev.surface}"]`) ??
      $(`[data-nav="${prev.surface}"]:not([data-panels] *)`);
    back?.focus({ preventScroll: !desktopMQ.matches ? false : true });
  }
}

let inertAround: HTMLElement[] = [];
function isolate(el: HTMLElement | null) {
  for (const n of inertAround) n.inert = false;
  inertAround = [];
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    for (const sib of Array.from(n.parentElement?.children ?? [])) {
      if (sib !== n && sib instanceof HTMLElement && !sib.inert) {
        sib.inert = true;
        inertAround.push(sib);
      }
    }
  }
}

function navigate(href: string, trigger?: HTMLElement | null, replace = false) {
  const next = parse(href);
  if (trigger && !trigger.closest('[data-panels]')) lastTrigger = trigger.closest('.lt-ui') && laptop ? laptop.trigger : trigger;
  const url = new URL(href, location.href);
  const same = url.pathname + url.search + url.hash === location.pathname + location.search + location.hash;
  if (!same) history[replace ? 'replaceState' : 'pushState']({ shelf: true }, '', url);
  render(next);
}

/* ---------------- Projects: filters, search, records ---------------- */

const listEl = () => $('[data-project-list]');
const searchEl = () => $<HTMLInputElement>('[data-project-search]');
const items = () => $$('.folders li');

function renderProjects(state: State) {
  for (const art of $$('[data-record-view]')) art.hidden = art.dataset.recordView !== state.record;
  const list = listEl();
  if (list) list.hidden = !!state.record;
  if (!state.record) {
    const q = state.params.get('q') ?? '';
    const group = state.params.get('group') ?? 'all';
    const search = searchEl();
    if (search && document.activeElement !== search) search.value = q;
    if (q) $('#panel-projects')?.classList.add('is-searching');
    applyFilter(q, group);
  }
}

function applyFilter(q: string, group: string) {
  const needle = q.trim().toLowerCase();
  let shown = 0;
  for (const li of items()) {
    const ok = (group === 'all' || li.dataset.group === group) && (!needle || (li.dataset.search ?? '').includes(needle));
    li.hidden = !ok;
    if (ok) shown++;
  }
  for (const b of $$('.filter')) b.setAttribute('aria-pressed', String(b.dataset.group === group));
  const count = $('[data-project-count]');
  if (count) count.textContent = shown === 1 ? '1 folder shown' : `${shown} folders shown`;
  const empty = $('[data-project-empty]');
  if (empty) empty.hidden = shown > 0;
}

function updateProjectQuery(q: string | null, group: string | null) {
  const url = new URL(location.href);
  if (q !== null) (q ? url.searchParams.set('q', q) : url.searchParams.delete('q'));
  if (group !== null) (group && group !== 'all' ? url.searchParams.set('group', group) : url.searchParams.delete('group'));
  history.replaceState({ shelf: true }, '', url);
  current = parse(url.href);
  applyFilter(url.searchParams.get('q') ?? '', url.searchParams.get('group') ?? 'all');
}

// Delegated: the search field and filters exist only once the drawer has loaded.
document.addEventListener('input', (e) => {
  const field = e.target as HTMLInputElement;
  if (field.matches?.('[data-project-search]')) updateProjectQuery(field.value, null);
});
$('[data-focus-search]')?.addEventListener('click', () => {
  if (current.record) navigate(`/projects/${location.search}`);
  $('#panel-projects')?.classList.add('is-searching');
  searchEl()?.focus();
});
document.addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLElement>('.filter');
  if (!b) return;
  updateProjectQuery(null, b.dataset.group ?? 'all');
  settleFolders();
});

function pauseVideos(except?: HTMLVideoElement) {
  for (const v of $$<HTMLVideoElement>('video')) if (v !== except && !v.paused) v.pause();
}
document.addEventListener('play', (e) => pauseVideos(e.target as HTMLVideoElement), true);

/* ---------------- Book tabs ---------------- */

const tabs = $$('[role="tab"][data-tab]');
function selectTab(id: string, focus: boolean) {
  const validBook = $$<HTMLElement>('[data-tabpanel]').some((p) => p.dataset.tabpanel === id);
  if (!validBook) id = 'blogs';
  for (const t of tabs) {
    const on = t.dataset.tab === id;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    if (on && focus) t.focus();
  }
  for (const p of $$('[data-tabpanel]')) p.hidden = p.dataset.tabpanel !== id;
}
for (const t of tabs) {
  t.addEventListener('click', () => {
    selectTab(t.dataset.tab!, false);
    const url = new URL(location.href);
    url.searchParams.set('tab', t.dataset.tab!);
    history.replaceState({ shelf: true }, '', url);
  });
  t.addEventListener('keydown', (e) => {
    const i = tabs.indexOf(t);
    const n = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null;
    if (n === null) return;
    e.preventDefault();
    const next = tabs[(n + tabs.length) % tabs.length];
    next.click();
    next.focus();
  });
}

/* ---------------- Link interception ---------------- */

document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = (e.target as Element).closest<HTMLAnchorElement>('a[data-nav]');
  if (!a || a.target === '_blank') return;
  e.preventDefault();
  const nav = a.dataset.nav!;
  if (nav === 'home') return navigate('/', a);
  if (nav === current.surface && (a.classList.contains('drawer') || a.closest('.g-cabinet, .g-top, .g-desk')) && !a.dataset.tab) {
    return navigate('/', a); // pressing an open drawer closes it
  }
  const href = new URL(a.getAttribute('href')!, location.href);
  if (current.surface === 'projects' && a.matches('.folder, .back')) href.search = current.params.toString();
  navigate(href.href, a);
});

window.addEventListener('popstate', () => render(parse(location.href), 'move', true));

document.addEventListener('keydown', (e) => {
  if (e.defaultPrevented) return; // handled by a focused control (e.g. the laptop field clearing its text)
  if (e.key === ' ' && (e.target as Element).matches('.drawer')) {
    e.preventDefault();
    (e.target as HTMLElement).click();
    return;
  }
  if (e.key === 'Tab' && current.surface && !desktopMQ.matches) {
    const panel = surfaceEl(current.surface)!;
    const controls = $$<HTMLElement>('a[href], button, input, select, textarea, [tabindex="0"]', panel)
      .filter((el) => !el.closest('[hidden], [inert]') && !el.matches(':disabled') && el.getClientRects().length);
    const first = controls[0];
    const last = controls.at(-1);
    if (first && last && (e.shiftKey ? document.activeElement === first || !controls.includes(document.activeElement as HTMLElement) : document.activeElement === last)) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    }
  }
  if (e.key !== 'Escape' || !current.surface) return;
  e.preventDefault();
  navigate(current.record ? `/projects/${location.search}` : '/');
});

let resizeFrame = 0;
function refitDrawer() {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => render(current, 'none', true));
}
window.addEventListener('resize', refitDrawer);
window.visualViewport?.addEventListener('resize', refitDrawer);

/* ---------------- Ambient desk motion ---------------- */

// Plants sway once on load and again when the pointer brushes them.
const swayA = { '15%': { rotation: 1.8, scale: 1.01 }, '35%': { rotation: -1, scale: 1 }, '55%': { rotation: 0.8 }, '75%': { rotation: -0.5 }, '100%': { rotation: 0, scale: 1 } };
const swayB = { '20%': { rotation: -1.6, scale: 1.01 }, '45%': { rotation: 1, scale: 1 }, '65%': { rotation: -0.6 }, '85%': { rotation: 0.3 }, '100%': { rotation: 0, scale: 1 } };
function sway(plant: Element) {
  if (reduceMQ.matches || gsap.isTweening($$('.sway', plant))) return;
  for (const g of $$('.sway', plant)) {
    const a = g.classList.contains('sway--a');
    // Mirrors the CSS origins: the top plant's second stem hangs from its top.
    const origin = a || plant.classList.contains('desk-plant') ? '50% 100%' : '30% 0%';
    gsap.to(g, { keyframes: a ? swayA : swayB, duration: a ? 3.4 : 4, ease: 'none', easeEach: 'sine.inOut', transformOrigin: origin });
  }
}
for (const p of $$('[data-sway]')) p.addEventListener('pointerenter', () => sway(p));
// The plants' continuous breeze (CSS) runs only while the scene is on screen;
// browsers already pause it in hidden tabs, and CSS drops it for reduced motion.
if ('IntersectionObserver' in window) {
  new IntersectionObserver(([entry]) => stage.classList.toggle('plants-live', entry.isIntersecting)).observe(stage);
} else stage.classList.add('plants-live');
// Mug steam: one puff when the visitor brushes the mug; never on arrival and
// never continuous. The shader (SVG wisps without WebGL) starts once the page
// is idle and draws a single still frame, so first paint has no WebGL work.
const waves = $$('.steam__w');
let puff: (() => void) | null | undefined;
function ensureSteam() {
  if (puff !== undefined) return;
  const steamCanvas = $<HTMLCanvasElement>('.steam__gl');
  if (steamCanvas) steamCanvas.hidden = false; // visible first so the rest frame can be measured
  puff = steamCanvas ? initSteam(steamCanvas, () => reduceMQ.matches) : null;
  if (puff) $('.steam > svg')?.setAttribute('hidden', '');
  else if (steamCanvas) steamCanvas.hidden = true;
}
const steamWhenIdle = () => {
  if ('requestIdleCallback' in window) window.requestIdleCallback(ensureSteam, { timeout: 3000 });
  else setTimeout(ensureSteam, 600);
};
if (document.readyState === 'complete') steamWhenIdle();
else window.addEventListener('load', steamWhenIdle, { once: true });
function steam() {
  if (reduceMQ.matches) return;
  ensureSteam();
  if (puff) return puff();
  if (!waves.length || gsap.isTweening(waves)) return;
  gsap.to(waves, {
    keyframes: { '0%': { y: 6, opacity: 0.2 }, '40%': { opacity: 0.85 }, '100%': { y: -10, opacity: 0.15 } },
    duration: 2.6, ease: 'none', easeEach: 'sine.inOut', repeat: 1, stagger: 0.4, clearProps: 'transform,opacity',
  });
}
$('[data-steam]')?.addEventListener('pointerenter', steam);

// A portrait that fails to load leaves the plain mat, never a broken-image icon.
for (const img of $$<HTMLImageElement>('.frame img')) {
  const empty = () => img.replaceWith(Object.assign(document.createElement('span'), { className: 'frame__empty' }));
  if (img.complete && !img.naturalWidth) empty();
  else img.addEventListener('error', empty, { once: true });
}

/* ---------------- Copy and contact ---------------- */

let selectedContactPage: string | null = null;
/* ---------------- The desk notebook ----------------
   Opening it lifts the notebook off the desk into the page view, where it is
   a real 3D book (diary.ts, LeafThrough). The working links and form sit below
   it and follow the pages in view; the URL follows the reader. */
const CONTACT_PAGES = ['intro', 'notes', 'directory', 'message'];
let diary: Diary | null = null;
let diaryMounting = false;

function markContactTab(page: string) {
  for (const link of $$<HTMLAnchorElement>('[data-contact-go]')) {
    if (link.dataset.contactGo === page) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

/**
 * Putting the notebook back, however the reader leaves it (the back cover,
 * the close button or the dimmed room). First it is closed: shut on its back
 * cover, it is turned over about its spine like a real book (at the edge-on
 * moment it shows its front instead); open, its pages fall shut onto the front
 * cover. Then it is carried down in the same arc it came up in, tilting flat
 * to the desk and settling exactly on its place, where the desk diary takes
 * over in the same frame, while the room lightens. Only then does the page go
 * home; resetDiary() tidies up once the notebook surface is really hidden.
 */
let puttingBack = false;
async function putBack(host: HTMLElement) {
  if (puttingBack || !diary) return;
  puttingBack = true;
  const panel = host.closest<HTMLElement>('[data-surface="contact"]');
  const tabs = $('.contact-book__tabs');
  const root = host.querySelector<HTMLElement>('[data-leafthrough]');
  const done = () => {
    holdDeskBook(false);
    gsap.set(host, { autoAlpha: 0 }); // stays where it landed, unseen, until the surface is hidden
    navigate('/');
  };
  try {
    if (reduceMQ.matches || !root || !deskBook()) return done();
    diaryTarget = null;
    if (tabs) gsap.to(tabs, { opacity: 0, duration: 0.25 });

    // 1. Close it.
    if (diary.onBack()) {
      await new Promise<void>((resolve) => {
        gsap.timeline({ onComplete: resolve })
          .set(root, { transformOrigin: '50% 50%', transformPerspective: 1800 })
          .to(root, { rotationY: 90, duration: 0.42, ease: 'sine.in' })
          .call(() => diary?.reset()) // edge-on: now it lies front cover up, right of the spine
          .set(root, { rotationY: -90 })
          .to(root, { rotationY: 0, duration: 0.42, ease: 'sine.out', clearProps: 'transform' });
      });
    } else {
      await diary.closeToFront();
    }
    await diary.frontReady();
    await new Promise((r) => window.setTimeout(r, 180)); // a beat in the hand

    // 2. Carry it back down onto the desk.
    const desk = deskBook();
    const b = bookBox(host);
    if (!desk || !b?.width) return done();
    const h = host.getBoundingClientRect();
    await new Promise<void>((resolve) => {
      gsap.timeline({ onComplete: resolve })
        .set(host, { transformOrigin: `${b.left + b.width / 2 - h.left}px ${b.top + b.height / 2 - h.top}px`, transformPerspective: 1600 })
        .set(panel, { '--dim': 1 })
        .to(host, {
          x: desk.x - (b.left + b.width / 2),
          y: desk.y - (b.top + b.height / 2),
          scale: desk.width / b.width,
          rotationX: DESK_BOOK.tilt,
          rotationZ: DESK_BOOK.skew,
          duration: 1.1,
          ease: 'power3.inOut',
        })
        .to(host, { keyframes: { yPercent: [0, -5, 0] }, duration: 1.1, ease: 'sine.inOut' }, '<')
        .to(panel, { '--dim': 0, duration: 0.9, ease: 'power1.inOut' }, 0.15);
    });
    done();
  } finally {
    puttingBack = false;
  }
}

/**
 * The notebook surface has just been hidden (put back, Escape, or history):
 * stop any flight, close the book on its front cover and clear every motion
 * style, so the next opening starts clean from the desk.
 */
function resetDiary(panel: HTMLElement) {
  const host = $<HTMLElement>('.diary', panel);
  const root = host?.querySelector<HTMLElement>('[data-leafthrough]');
  const tabs = $('.contact-book__tabs', panel);
  const parts = [host, root, tabs, panel].filter((el): el is HTMLElement => !!el);
  gsap.killTweensOf(parts);
  gsap.set(parts, { clearProps: 'transform,opacity,visibility,--dim' });
  landing = false;
  diaryTarget = null;
  diary?.reset();
  holdDeskBook(false);
}

function ensureDiary(page: string) {
  const book = $<HTMLElement>('.contact-book');
  if (diary || diaryMounting || !book) return;
  diaryMounting = true;
  const host = document.createElement('div');
  host.className = 'diary';
  ($('.contact-book__tabs') ?? book).before(host);
  // The notebook opens on its own in the middle of the viewport, not in a panel.
  const panel = book.closest<HTMLElement>('[data-surface="contact"]');
  panel?.classList.add('is-diary');
  // The room stays lit while the book is built; it dims as the notebook rises.
  if (!reduceMQ.matches) gsap.set([panel, $('.contact-book__tabs')].filter(Boolean), { '--dim': 0, opacity: (i: number) => (i ? 0 : 1) });
  const fallBack = () => {
    diaryMounting = false;
    host.remove();
    panel?.classList.remove('is-diary'); // the HTML notebook stays as it was
  };
  const sections = $$<HTMLElement>('[data-contact-page]');
  void import('./diary')
    .then(({ mountDiary }) =>
      mountDiary(host, book, 'cover', (visible) => {
        // The live controls are those of the pages in view.
        for (const s of sections) s.hidden = !visible.includes(s.dataset.contactPage ?? '');
        // Riffling towards a page passes others: the URL waits until it arrives.
        if (diaryTarget) {
          if (visible.includes(diaryTarget)) diaryTarget = null;
        } else if (visible.length && !visible.includes(selectedContactPage ?? '')) {
          selectedContactPage = visible[0];
          const url = new URL(location.href);
          url.searchParams.set('page', visible[0]);
          history.replaceState({ shelf: true }, '', url);
          current = parse(location.href);
        }
        markContactTab(selectedContactPage ?? 'intro');
      }, () => void putBack(host)),
    )
    .then((d) => {
      if (!d) return fallBack();
      diaryMounting = false;
      diary = d;
      book.classList.add('is-live');
      void openDiaryFromDesk(host); // it was built closed; it opens once in hand
      const form = $<HTMLFormElement>('[data-contact]');
      form?.addEventListener('input', () => d.redraft());
      form?.addEventListener('reset', () => window.setTimeout(() => d.redraft()));
      // The close button and the dimmed room around the book put it back on the desk.
      panel?.addEventListener('click', (e) => {
        const t = e.target as Element;
        const closer = t.closest('.panel__close');
        if (!panel.classList.contains('is-diary') || !(closer || t === panel || t.matches('.panel__sheet, .panel__body'))) return;
        e.preventDefault();
        e.stopPropagation();
        void putBack(host);
      });
    })
    .catch(fallBack);
}

/* The closed diary on the desk, as the studio draws it: 204 of its anchor's
   390 units wide, lying on a desk seen about 61° from upright (the studio's
   pitch), set down about 4.6° askew. The flights start and end exactly there. */
const DESK_BOOK = { share: 204 / 390, tilt: 61, skew: -4.6 };
let landing = false; // the book is in flight; page turns wait until it lands
let diaryTarget: string | null = null; // the page the book is being turned to

function turnDiaryTo(page: string) {
  diaryTarget = diary?.show(page) ? page : null;
}

function deskBook() {
  const notebook = $('.notebook');
  if (!notebook?.getClientRects().length) return null;
  const a = notebook.getBoundingClientRect();
  return { x: a.left + a.width / 2, y: a.top + a.height / 2, width: a.width * DESK_BOOK.share };
}
const holdDeskBook = (away: boolean) => $('.notebook')?.dispatchEvent(new CustomEvent('studio:hold', { detail: { away } }));
/** The closed book's own box on screen (LeafThrough's hit area covers just its pages). */
const bookBox = (host: HTMLElement) => host.querySelector<HTMLElement>('[data-leafthrough-hit-area]')?.getBoundingClientRect();

/**
 * Picks the closed notebook up off the desk: one uniform scale (no stretching)
 * from its exact place, size, tilt and skew, rising in a gentle arc towards the
 * reader until it faces them in the middle of the viewport.
 */
async function liftNotebook(host: HTMLElement) {
  // Measure the book where it rests in the viewport, free of any earlier flight,
  // while it stays unseen until its first frame of flight is set.
  gsap.killTweensOf(host);
  gsap.set(host, { clearProps: 'transform', autoAlpha: 0 });
  const desk = deskBook();
  let b = bookBox(host);
  // The book lays itself out over a frame or two after it is built or shown.
  for (let i = 0; i < 12 && !b?.width; i++) {
    await new Promise((r) => requestAnimationFrame(r));
    b = bookBox(host);
  }
  if (reduceMQ.matches || !desk || !b?.width || !host.isConnected) {
    gsap.set(host, { autoAlpha: 1 });
    return;
  }
  const h = host.getBoundingClientRect();
  holdDeskBook(true);
  return new Promise<void>((resolve) => {
    gsap.timeline({
      onComplete: () => {
        gsap.set(host, { clearProps: 'transform' });
        window.dispatchEvent(new Event('resize')); // the 3D book re-measures where it landed
        resolve();
      },
      onInterrupt: () => resolve(), // closed mid-flight: resetDiary() takes over
    })
      .set(host, { transformOrigin: `${b.left + b.width / 2 - h.left}px ${b.top + b.height / 2 - h.top}px`, transformPerspective: 1600, autoAlpha: 1 })
      .fromTo(
        host,
        { x: desk.x - (b.left + b.width / 2), y: desk.y - (b.top + b.height / 2), scale: desk.width / b.width, rotationX: DESK_BOOK.tilt, rotationZ: DESK_BOOK.skew },
        { x: 0, y: 0, scale: 1, rotationX: 0, rotationZ: 0, duration: 1.1, ease: 'power3.inOut' },
      )
      .fromTo(host, { yPercent: 0 }, { keyframes: { yPercent: [0, -5, 0] }, duration: 1.1, ease: 'sine.inOut' }, 0);
  });
}

/**
 * Opening: the room dims while the closed notebook rises from the desk; once it
 * faces the reader, the cover opens and the pages turn to the one asked for.
 */
async function openDiaryFromDesk(host: HTMLElement) {
  const panel = host.closest<HTMLElement>('[data-surface="contact"]');
  const tabs = $('.contact-book__tabs');
  landing = true;
  if (!reduceMQ.matches) {
    gsap.fromTo(panel, { '--dim': 0 }, { '--dim': 1, duration: 0.8, ease: 'power1.inOut', clearProps: '--dim' });
    if (tabs) gsap.set(tabs, { opacity: 0 });
  }
  await liftNotebook(host);
  if (!landing || panel?.hidden) return; // put away while still in flight
  landing = false;
  turnDiaryTo(selectedContactPage ?? 'intro');
  if (tabs) gsap.to(tabs, { opacity: 1, duration: 0.4, delay: 0.3, clearProps: 'opacity' });
}

function selectContactPage(page: string) {
  if (!CONTACT_PAGES.includes(page)) page = 'intro';
  selectedContactPage = page;
  if (diary) {
    // The book turns there (after it has landed); its page change updates the controls.
    if (!landing) turnDiaryTo(page);
  } else {
    for (const s of $$<HTMLElement>('[data-contact-page]')) s.hidden = s.dataset.contactPage !== page;
    ensureDiary(page);
  }
  markContactTab(page);
}

async function copyText(text: string, statusEl: Element | null, ok: string) {
  try {
    await navigator.clipboard.writeText(text);
    if (statusEl) statusEl.textContent = ok;
  } catch {
    if (statusEl) statusEl.textContent = 'Copy didn’t work. Select the text to copy it.';
  }
}
document.addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLElement>('[data-copy]');
  if (b) copyText(b.dataset.copy!, $('[data-copy-status]'), 'Email address copied.');
});
function bindContact() {
  const form = $<HTMLFormElement>('[data-contact]');
  if (!form || form.dataset.bound) return;
  form.dataset.bound = 'true';
  const status = $('[data-contact-status]');
  const preview = $('[data-contact-preview]');
  const writing = $<HTMLElement>('.contact__writing', form);
  const messageField = $<HTMLTextAreaElement>('textarea[name="body"]', form);
  const penTip = $<HTMLElement>('.contact__pen', form);
  const mirror = document.createElement('div');
  mirror.className = 'contact__mirror';
  writing?.append(mirror);
  const compose = () => {
    const fd = new FormData(form);
    const name = String(fd.get('name') ?? '').trim();
    const email = String(fd.get('email') ?? '').trim();
    const subject = String(fd.get('subject') ?? '').trim();
    const body = String(fd.get('body') ?? '').trim();
    return { name, email, subject, body: `${body}\n\n— ${name}\nReply to: ${email}` };
  };
  const updatePreview = () => {
    const m = compose();
    if (preview) preview.textContent = messageField?.value.trim() ? `To: ${form.getAttribute('action')!.replace('mailto:', '')}\nSubject: ${m.subject}\n\n${m.body}` : 'Your message will appear here as you type.';
  };
  const positionPen = () => {
    if (!messageField || !penTip || document.activeElement !== messageField) { if (penTip) penTip.hidden = true; return; }
    const style = getComputedStyle(messageField);
    mirror.style.cssText = `width:${messageField.clientWidth}px;font:${style.font};letter-spacing:${style.letterSpacing};padding:${style.padding};white-space:pre-wrap;overflow-wrap:break-word;line-height:${style.lineHeight};`;
    mirror.textContent = messageField.value.slice(0, messageField.selectionStart);
    const marker = document.createElement('span');
    marker.textContent = '\u200b';
    mirror.append(marker);
    const markerBox = marker.getBoundingClientRect();
    const writingBox = writing!.getBoundingClientRect();
    const x = Math.max(0, Math.min(messageField.clientWidth - 18, markerBox.left - writingBox.left));
    const y = Math.max(0, Math.min(messageField.clientHeight - 18, markerBox.top - writingBox.top - messageField.scrollTop));
    penTip.style.transform = `translate(${x}px, ${y}px)`;
    penTip.hidden = false;
  };
  form.addEventListener('input', () => { updatePreview(); positionPen(); });
  messageField?.addEventListener('focus', positionPen);
  messageField?.addEventListener('click', positionPen);
  messageField?.addEventListener('keyup', positionPen);
  messageField?.addEventListener('scroll', positionPen);
  messageField?.addEventListener('blur', () => { if (penTip) penTip.hidden = true; });
  form.addEventListener('reset', () => requestAnimationFrame(() => { updatePreview(); positionPen(); if (status) status.textContent = 'The writing page is clear.'; }));
  updatePreview();
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const m = compose();
    const to = form.getAttribute('action')!;
    window.location.href = `${to}?subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.body)}`;
    if (status) status.textContent = 'Your email app should open with the message ready. Nothing has been sent yet.';
  });
  $('[data-copy-message]')?.addEventListener('click', () => {
    const m = compose();
    const to = form.getAttribute('action')!.replace('mailto:', '');
    copyText(`To: ${to}\nSubject: ${m.subject}\n\n${m.body}`, status, 'Message and address copied. Paste them into any email app.');
  });
}
bindContact();

/** Wiring for a drawer body that has just been fetched into the page. */
function bindSurface(surface: string) {
  if (surface === 'contact') bindContact();
  if (surface === 'projects') dropFailedThumbs();
}

/* ---------------- Media failures (ui-copy feedback strings) ---------------- */

document.addEventListener(
  'error',
  (e) => {
    const el = e.target;
    if (!(el instanceof HTMLVideoElement || el instanceof HTMLImageElement) || !el.closest('[data-panels]')) return;
    if (el.dataset.failed) return;
    el.dataset.failed = 'true';
    // A folder thumbnail is decorative: leave the plain art pane. A note here
    // would sit inside the grid cell and stretch the whole row.
    if (el.closest('.folder__art')) return el.remove();
    const note = document.createElement('p');
    note.className = 'media-error';
    note.textContent =
      el instanceof HTMLVideoElement
        ? 'This video could not be played. Read the walkthrough summary below.'
        : 'This image could not be loaded. The project description is still available.';
    (el.closest('a, figure') ?? el).insertAdjacentElement('afterend', note);
    el.hidden = true;
  },
  true,
);
// Thumbnails that already failed before this module ran never reach the listener.
function dropFailedThumbs() {
  for (const img of $$<HTMLImageElement>('.folder__art img')) if (img.complete && !img.naturalWidth) img.remove();
}
dropFailedThumbs();

/* ---------------- Boot ---------------- */

// The studio layer (D-45) draws the desk objects as lit meshes. It loads after
// first paint; without WebGL the illustrated objects and the 2D globe remain.
const globeEl = $('[data-globe]');
const startStudio = () => {
  let flatGlobe = false;
  const fallback = () => {
    if (globeEl && !flatGlobe) initGlobe(globeEl, reduceMQ.matches);
    flatGlobe = true;
  };
  globeEl?.addEventListener('studio:fallback', fallback, { once: true });
  // Phones keep the illustrated objects: three.js (about 540 KB) would be parsed
  // and run only to redraw a few spines, the lamp and the globe.
  if (window.matchMedia('(max-width: 599px)').matches) return fallback();
  import('./studio/index')
    .then(({ mountStudio }) => mountStudio({ reduced: () => reduceMQ.matches }))
    .then((ok) => { if (!ok) fallback(); })
    .catch(fallback);
};
// Start only once the page has finished loading and the browser is idle, so
// the 3D layer never competes with first paint or early input.
const whenIdle = () => {
  if ('requestIdleCallback' in window) window.requestIdleCallback(startStudio, { timeout: 2000 });
  else setTimeout(startStudio, 300);
};
// Like any below-the-fold media, the meshes are not built until one of their
// anchors is near the viewport (on phones the shelf strip sits below the
// profile, so the 3D layer waits for the visitor to scroll towards it).
const armStudio = () => {
  const anchors = $$('[data-studio]').filter((el) => el.getClientRects().length > 0);
  if (!('IntersectionObserver' in window) || anchors.length === 0) return whenIdle();
  const observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      whenIdle();
    },
    { rootMargin: '240px' },
  );
  for (const anchor of anchors) observer.observe(anchor);
};
if (document.readyState === 'complete') armStudio();
else window.addEventListener('load', armStudio, { once: true });

if (laptopEl) {
  laptop = initLaptop(laptopEl, {
    navigate: (href, trigger) => navigate(href, trigger),
    close: () => navigate('/'),
    reduced: () => reduceMQ.matches,
    overlay: () => !desktopMQ.matches,
  });
}

// Direct loads render the URL state without moving focus.
render(current, 'none', true);


