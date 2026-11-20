// The desk notebook as a real 3D book: LeafThrough (MIT, three.js) turns
// printed pages that bend, catch the light and cast shadows. Every page is
// painted onto a canvas from the notebook's own HTML (so the words never drift
// from the markup), in the site's fonts on cream ruled paper, including its
// links and the message form. While the book rests, the real links, inputs and
// buttons lie exactly over their painted twins (recorded while painting), so
// the diary itself is the contact page; during a turn they step aside and the
// paint, typed text included, turns with the paper.
import type { LeafThrough } from 'leafthrough';
import { paintCover } from './notebook-cover';

const W = 1200;
const H = Math.round(W * 1.377); // LeafThrough's default page aspect
const RULE = 58; // ruled line spacing, also the handwriting line height
const TOP = 300; // first ruled line
const MARGIN = 150; // where writing starts, right of the red margin line
const MAX = W - MARGIN - 110; // writing width
const LAST = Math.floor((H - 200 - TOP) / RULE); // last ruled line used
const FONT = getComputedStyle(document.documentElement);
const font = (name: string, fallback: string) => FONT.getPropertyValue(name).trim() || fallback;
const SERIF = font('--serif', 'Georgia, serif');
const SANS = font('--sans', 'Arial, sans-serif');
const HAND = font('--hand', 'cursive');
const INK = '#2a1f16';
const LINK = '#5a3412';
const line = (n: number) => TOP + n * RULE; // y of ruled line n

/** Notebook page index for each contact page (0 is the cover). */
export const DIARY_PAGE: Record<string, number> = { intro: 2, notes: 3, directory: 4, message: 5 };
/** Which contact page's controls belong on each notebook page. */
const PAGE_OF: Record<number, string> = { 2: 'intro', 3: 'notes', 4: 'directory', 5: 'message', 6: 'message' };
const sideOf = (page: number) => (page % 2 ? 'left' : 'right') as 'left' | 'right';

/** Where a live control lies, in a page's own pixels. */
type Spot = { page: number; x: number; y: number; w: number; h: number };
type Block = { kind: 'p' | 'li' | 'h4' | 'link'; text: string; el?: HTMLElement };
type Content = { eyebrow: string; title: string; blocks: Block[] };

const words = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();

/** The words of one notebook section, read from its HTML; links keep their element. */
function read(section: HTMLElement): Content {
  const out: Content = { eyebrow: '', title: '', blocks: [] };
  for (const el of Array.from(section.children) as HTMLElement[]) {
    if (el.matches('.contact-book__eyebrow')) out.eyebrow = words(el);
    else if (el.matches('h3')) out.title = words(el);
    else if (el.matches('h4')) out.blocks.push({ kind: 'h4', text: words(el) });
    else if (el.matches('ul')) el.querySelectorAll('li').forEach((li) => out.blocks.push({ kind: 'li', text: words(li), el: li.querySelector('a') ?? undefined }));
    else if (el.matches('p')) out.blocks.push({ kind: 'p', text: words(el), el: el.querySelector('a') ?? undefined });
    else if (el.matches('a.btn')) out.blocks.push({ kind: 'link', text: words(el), el });
  }
  return out;
}

/* ---------------- painting ---------------- */

// Deterministic speckle so every page has the same paper.
const rand = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

function sheet() {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  return [c, c.getContext('2d')!] as const;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, max: number) {
  const lines: string[] = [];
  let cur = '';
  for (const word of text.split(' ')) {
    const next = cur ? `${cur} ${word}` : word;
    if (ctx.measureText(next).width > max && cur) {
      lines.push(cur);
      cur = word;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Cream ruled paper with a margin line, a header tag, folio and spine shade. */
function paper(page: number, ruled = true) {
  const side = sideOf(page);
  const [c, ctx] = sheet();
  ctx.fillStyle = '#fbf3e1';
  ctx.fillRect(0, 0, W, H);
  const r = rand(page * 97 + 13);
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = r() > 0.5 ? 'rgba(120,90,50,0.07)' : 'rgba(255,255,255,0.5)';
    ctx.fillRect(r() * W, r() * H, 1 + r() * 2, 1 + r() * 2);
  }
  if (ruled) {
    ctx.strokeStyle = 'rgba(105,145,180,0.38)';
    ctx.lineWidth = 2;
    for (let n = 0; n <= LAST; n++) {
      ctx.beginPath();
      ctx.moveTo(60, line(n));
      ctx.lineTo(W - 60, line(n));
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(200,90,80,0.5)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(MARGIN - 28, 60);
    ctx.lineTo(MARGIN - 28, H - 60);
    ctx.stroke();
  }
  ctx.font = `600 24px ${SANS}`;
  const tag = 'The Shelf  /  Desk notebook';
  const tw = ctx.measureText(tag).width;
  const tx = side === 'left' ? MARGIN : W - 90 - tw - 28;
  ctx.fillStyle = 'rgba(120,90,50,0.1)';
  ctx.fillRect(tx - 14, 92, tw + 28, 44);
  ctx.fillStyle = '#6b5640';
  ctx.fillText(tag, tx, 122);
  ctx.strokeStyle = 'rgba(42,31,22,0.55)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(90, H - 120);
  ctx.lineTo(W - 90, H - 120);
  ctx.stroke();
  ctx.font = `600 22px ${SANS}`;
  const name = 'THE DESK NOTEBOOK';
  ctx.fillText(name, side === 'left' ? 90 : W - 90 - ctx.measureText(name).width, H - 82);
  const n = String(page).padStart(2, '0');
  ctx.fillText(n, side === 'left' ? W - 90 - ctx.measureText(n).width : 90, H - 82);
  const g = side === 'left' ? ctx.createLinearGradient(W, 0, W - 150, 0) : ctx.createLinearGradient(0, 0, 150, 0);
  g.addColorStop(0, 'rgba(80,50,20,0.2)');
  g.addColorStop(1, 'rgba(80,50,20,0)');
  ctx.fillStyle = g;
  ctx.fillRect(side === 'left' ? W - 150 : 0, 0, 150, H);
  return [c, ctx] as const;
}

function tape(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = 'rgba(214,168,92,0.5)';
  ctx.fillRect(-90, -24, 180, 48);
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  for (let i = -80; i < 90; i += 22) ctx.fillRect(i, -24, 9, 48);
  ctx.restore();
}

/** Eyebrow and title; returns the first free ruled line below them. */
function heading(ctx: CanvasRenderingContext2D, content: Content) {
  ctx.fillStyle = '#755d43';
  ctx.font = `700 26px ${SANS}`;
  ctx.fillText(content.eyebrow.toUpperCase(), MARGIN, TOP - 120);
  ctx.fillStyle = INK;
  ctx.font = `700 64px ${SERIF}`;
  let y = TOP - 30;
  for (const l of wrap(ctx, content.title, MAX)) {
    ctx.fillText(l, MARGIN, y);
    y += 72;
  }
  tape(ctx, W - 210, TOP - 150, 0.22);
  return Math.max(1, Math.ceil((y - 30 - TOP) / RULE) + 1);
}

/** A handwritten line on ruled line n (its baseline sits just above the line). */
function hand(ctx: CanvasRenderingContext2D, text: string, x: number, n: number, color = INK) {
  ctx.font = `400 36px ${HAND}`;
  ctx.fillStyle = color;
  ctx.fillText(text, x, line(n) - 12);
}

function writtenPage(content: Content, page: number, spots: Map<HTMLElement, Spot>) {
  const [c, ctx] = paper(page);
  let n = heading(ctx, content);
  for (const b of content.blocks) {
    if (n > LAST) break;
    if (b.kind === 'h4') {
      ctx.font = `700 26px ${SANS}`;
      ctx.fillStyle = '#755d43';
      ctx.fillText(b.text.toUpperCase(), MARGIN, line(n) - 14);
      n++;
      continue;
    }
    const indent = b.kind === 'li' ? 40 : 0;
    const color = b.el ? LINK : INK;
    ctx.font = `400 36px ${HAND}`;
    const lines = wrap(ctx, b.text, MAX - indent);
    const first = n;
    let wide = 0;
    lines.forEach((l, i) => {
      if (n > LAST) return;
      if (b.kind === 'li' && i === 0) {
        ctx.fillStyle = INK;
        ctx.beginPath();
        ctx.arc(MARGIN + 12, line(n) - 24, 6, 0, Math.PI * 2);
        ctx.fill();
      }
      hand(ctx, l, MARGIN + indent, n, color);
      const lw = ctx.measureText(l).width;
      wide = Math.max(wide, lw);
      if (b.el) {
        // Links are underlined in ink, as written by hand.
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(MARGIN + indent, line(n) - 6);
        ctx.lineTo(MARGIN + indent + lw, line(n) - 6);
        ctx.stroke();
      }
      n++;
    });
    if (b.el) spots.set(b.el, { page, x: MARGIN + indent - 8, y: line(first) - RULE + 4, w: wide + 16, h: (n - first) * RULE - 4 });
    if (b.kind !== 'li') n++;
  }
  return c;
}

/** An ink stamp drawn round a button's label. */
function stamp(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, solid: boolean) {
  ctx.font = `700 30px ${SANS}`;
  const w = ctx.measureText(text).width + 64;
  const h = 76;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 16);
  if (solid) {
    ctx.fillStyle = 'rgba(42,31,22,0.88)';
    ctx.fill();
  }
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = solid ? '#fbf3e1' : INK;
  ctx.fillText(text, x + 32, y + 49);
  return { w, h };
}

/**
 * The writing spread: the form as handwritten lines on the left page (the
 * visitor's own words painted in), its note and buttons on the right.
 */
function writingSpread(section: HTMLElement, spots: Map<HTMLElement, Spot>) {
  const page = DIARY_PAGE.message;
  const form = section.querySelector<HTMLFormElement>('form');
  const [left, ctx] = paper(page);
  let n = heading(ctx, read(section)) + 1;
  for (const input of form ? Array.from(form.querySelectorAll<HTMLInputElement>('input[name]')) : []) {
    const label = words(input.closest('label') ?? input).replace(input.value, '').trim() || input.name;
    ctx.font = `700 24px ${SANS}`;
    ctx.fillStyle = '#755d43';
    ctx.fillText(label.toUpperCase(), MARGIN, line(n) - 16);
    const lx = MARGIN + ctx.measureText(label.toUpperCase()).width + 24;
    hand(ctx, input.value, lx, n);
    spots.set(input, { page, x: lx - 6, y: line(n) - RULE + 6, w: MARGIN + MAX - lx + 6, h: RULE - 8 });
    n++;
  }
  const area = form?.querySelector<HTMLTextAreaElement>('textarea');
  if (area) {
    n++;
    const label = words(area.closest('label') ?? area).replace(area.value, '').trim() || 'Message';
    ctx.font = `700 24px ${SANS}`;
    ctx.fillStyle = '#755d43';
    ctx.fillText(label.toUpperCase(), MARGIN, line(n) - 16);
    n++;
    const first = n;
    ctx.font = `400 36px ${HAND}`;
    const body = area.value.split('\n').flatMap((p) => (p ? wrap(ctx, p, MAX - 12) : ['']));
    for (const l of body) {
      if (n > LAST) break;
      hand(ctx, l, MARGIN + 6, n);
      n++;
    }
    // The textarea covers the lines from `first` down to the last one.
    spots.set(area, { page, x: MARGIN, y: line(first - 1), w: MAX, h: (LAST - first + 1) * RULE });
  }

  const [right, rctx] = paper(page + 1);
  let m = 1;
  const note = form?.querySelector('p.muted');
  if (note) {
    rctx.font = `400 34px ${HAND}`;
    for (const l of wrap(rctx, words(note), MAX)) hand(rctx, l, MARGIN, m++, '#4a3826');
  }
  m += 1;
  let y = line(m) - RULE + 6;
  form?.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
    const { w, h } = stamp(rctx, words(button), MARGIN, y, button.type === 'submit');
    spots.set(button, { page: page + 1, x: MARGIN, y, w, h });
    y += h + 34;
  });
  const status = form?.querySelector<HTMLElement>('[data-contact-status]');
  if (status) spots.set(status, { page: page + 1, x: MARGIN, y: y + 10, w: MAX, h: RULE * 2 });
  return [left, right];
}

const cover = (front: boolean) => paintCover(front); // shared with the closed diary on the desk

function endpaper() {
  const [c, ctx] = sheet();
  ctx.fillStyle = '#e9dcc2';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(110,75,40,0.18)';
  ctx.lineWidth = 3;
  for (let i = -H; i < W + H; i += 46) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + H, H);
    ctx.moveTo(i + H, 0);
    ctx.lineTo(i, H);
    ctx.stroke();
  }
  ctx.fillStyle = '#fbf3e1';
  ctx.strokeStyle = '#7a5a36';
  ctx.lineWidth = 5;
  ctx.fillRect(W / 2 - 280, H / 2 - 170, 560, 340);
  ctx.strokeRect(W / 2 - 262, H / 2 - 152, 524, 304);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#755d43';
  ctx.font = `italic 40px ${SERIF}`;
  ctx.fillText('Ex libris', W / 2, H / 2 - 50);
  ctx.fillStyle = INK;
  ctx.font = `700 64px ${SERIF}`;
  ctx.fillText('Ayush Jain', W / 2, H / 2 + 50);
  ctx.textAlign = 'start';
  return c;
}

/* ---------------- the book ---------------- */

export interface Diary {
  /** Turn to a contact page; false when it is already in view. */
  show: (page: string) => boolean;
  /** Repaint the writing spread from the form (so typed words turn with the page). */
  redraft: () => void;
  /** Close it on its front cover at once, ready for the next opening. */
  reset: () => void;
  /** Whether it lies shut on its back cover. */
  onBack: () => boolean;
  /** Let the pages fall shut onto the front cover; resolves once it lies closed and still. */
  closeToFront: () => Promise<void>;
  /** Resolves once the book's box shows the front cover alone (right of the spine). */
  frontReady: () => Promise<void>;
  dispose: () => void;
}

/** The back cover: turning onto it ends the read. */
const LAST_PAGE = 7;
const frame = () => new Promise((r) => requestAnimationFrame(r));

/**
 * Mounts the book in `host` and lays `book` (the notebook's HTML, its live
 * controls) over it. `onPages` hears which contact pages are in view;
 * `onEnd` runs once the reader has closed it on the back cover.
 */
export async function mountDiary(
  host: HTMLElement,
  book: HTMLElement,
  start: string,
  onPages: (visible: string[]) => void,
  onEnd: () => void,
): Promise<Diary | null> {
  const { LeafThrough: Book } = await import('leafthrough');
  const sections = Array.from(book.querySelectorAll<HTMLElement>('[data-contact-page]'));
  const bySlug: Record<string, HTMLElement> = Object.fromEntries(sections.map((s) => [s.dataset.contactPage ?? '', s]));
  if (!bySlug.intro || !bySlug.notes || !bySlug.directory || !bySlug.message) return null;
  const text = (c: Content) => [c.eyebrow, c.title, ...c.blocks.map((b) => b.text)].filter(Boolean).join('\n\n');
  const spots = new Map<HTMLElement, Spot>();
  const printed = (slug: string) => {
    const content = read(bySlug[slug]);
    return { src: writtenPage(content, DIARY_PAGE[slug], spots), alt: `Notebook page: ${content.title}`, text: text(content) };
  };
  // Painted once; only the writing spread is repainted as the visitor types.
  const front = [
    { src: cover(true), alt: 'Leather cover of the desk notebook', text: 'The desk notebook. Ayush Jain.' },
    { src: endpaper(), alt: 'Endpaper with a bookplate', text: 'Ex libris Ayush Jain.' },
    printed('intro'),
    printed('notes'),
    printed('directory'),
  ];
  const back = { src: cover(false), alt: 'Back cover of the desk notebook', text: '' };
  const msg = read(bySlug.message);
  const pages = () => {
    const [letter, more] = writingSpread(bySlug.message, spots);
    return [
      ...front,
      { src: letter, alt: 'Notebook writing page: a message form written on ruled lines', text: text(msg) },
      { src: more, alt: 'Notebook page with the send and copy buttons', text: '' },
      back,
    ];
  };

  let lt: LeafThrough;
  try {
    lt = new Book(host, {
      pages: pages(),
      startPage: DIARY_PAGE[start] ?? 0, // closed on its cover unless told otherwise
      layout: 'auto',
      label: 'The desk notebook',
      paper: { backColor: '#fbf3e1', wrinkles: 0.7, inkGloss: 0.12 },
      lighting: { floorShadow: 0.22 },
      formatPageLabel: (d) => `Notebook ${d.visiblePages.length > 1 ? 'pages' : 'page'} ${d.visiblePages.join(' and ')} of ${d.pageCount}`,
    });
  } catch {
    return null;
  }

  // The notebook's HTML becomes the layer of live controls over the pages.
  host.append(book);
  for (const el of spots.keys()) el.dataset.spot = '';
  const hit = host.querySelector<HTMLElement>('[data-leafthrough-hit-area]');
  let laid = '';
  let raf = 0;
  const place = () => {
    raf = 0;
    if (!host.isConnected || !host.offsetParent || !hit) return;
    const visible = lt.visiblePages;
    const spread = visible.length > 1;
    const away = lt.turning || !visible.some((p) => PAGE_OF[p]);
    book.classList.toggle('is-away', away);
    const s = hit.style;
    const key = `${s.left}|${s.top}|${s.width}|${s.height}|${visible.join(',')}`;
    if (key !== laid) {
      laid = key;
      const width = parseFloat(s.width) || 0;
      book.style.left = s.left;
      book.style.top = s.top;
      book.style.width = s.width;
      book.style.height = s.height;
      book.style.setProperty('--k', String((spread ? width / 2 : width) / W));
      // Each control sits on its page: half the box in a spread, all of it alone.
      for (const [el, spot] of spots) {
        const shown = visible.includes(spot.page);
        el.style.visibility = shown ? '' : 'hidden';
        if (!shown) continue;
        const half = spread ? 50 : 100;
        const x0 = spread && sideOf(spot.page) === 'right' ? 50 : 0;
        el.style.left = `${x0 + (spot.x / W) * half}%`;
        el.style.top = `${(spot.y / H) * 100}%`;
        el.style.width = `${(spot.w / W) * half}%`;
        el.style.height = `${(spot.h / H) * 100}%`;
      }
    }
    raf = requestAnimationFrame(place);
  };
  const wake = () => {
    if (!raf) raf = requestAnimationFrame(place);
  };
  // Closed on the back cover: once the turn has settled and after a beat, the
  // read is over and the notebook goes back to the desk.
  let ended = false;
  const finish = () => {
    if (ended || !lt.visiblePages.includes(LAST_PAGE)) return;
    if (lt.turning) return void window.setTimeout(finish, 120);
    ended = true;
    onEnd();
  };
  const report = () => {
    onPages([...new Set(lt.visiblePages.map((p) => PAGE_OF[p]).filter(Boolean))]);
    laid = '';
    wake();
    if (lt.visiblePages.includes(LAST_PAGE)) window.setTimeout(finish, 650);
  };
  lt.addEventListener('pagechange', report);
  window.addEventListener('resize', wake);
  report();
  // Hand the book over once its first pages are painted, so it never flies blank.
  await new Promise<void>((resolve) => {
    lt.addEventListener('ready', () => resolve(), { once: true });
    window.setTimeout(resolve, 1500);
  });

  let redraw = 0;
  return {
    show(page) {
      wake();
      const index = DIARY_PAGE[page];
      if (index === undefined || lt.visiblePages.includes(index)) return false;
      lt.goTo(index, { animate: true });
      return true;
    },
    redraft() {
      clearTimeout(redraw);
      redraw = window.setTimeout(() => lt.update({ pages: pages() }), 250);
    },
    reset() {
      lt.goTo(0);
      ended = false;
    },
    onBack: () => lt.visiblePages.includes(LAST_PAGE),
    async closeToFront() {
      if (!lt.visiblePages.includes(0)) lt.goTo(0, { animate: true });
      for (let i = 0; i < 400 && (lt.turning || !lt.visiblePages.includes(0)); i++) await frame();
    },
    async frontReady() {
      // The hit area follows the closed side a frame or two after the book changes.
      for (let i = 0; i < 30; i++) {
        const a = hit?.getBoundingClientRect();
        const h = host.getBoundingClientRect();
        if (a && a.width && a.left + a.width / 2 > h.left + h.width / 2) return;
        await frame();
      }
    },
    dispose() {
      clearTimeout(redraw);
      cancelAnimationFrame(raf);
      lt.dispose();
    },
  };
}
