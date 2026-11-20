const board = document.querySelector<HTMLElement>('.g-board');
const selector = board?.querySelector<HTMLFieldSetElement>('[data-board-switch]');
const noteTitle = board?.querySelector<HTMLElement>('[data-board-title]');
const empty = board?.querySelector<HTMLElement>('[data-board-empty]');
const photo = board?.querySelector<HTMLElement>('[data-board-photo]');
const completed = board?.querySelector<HTMLElement>('[data-board-list="completed"]');
const building = board?.querySelector<HTMLElement>('[data-board-list="building"]');
const dialog = board?.querySelector<HTMLDialogElement>('[data-board-dialog]');

if (selector && noteTitle && empty && photo && completed && building) {
  selector.addEventListener('change', (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.checked) return;
    const mode = input.value;
    selector.dataset.mode = mode;
    noteTitle.textContent = mode === 'ideas' ? 'Ideas' : mode === 'building' ? 'Currently Building' : 'Pinned Builds';
    completed.hidden = mode !== 'completed';
    building.hidden = mode !== 'building' || building.children.length === 0;
    photo.hidden = mode !== 'completed';
    empty.hidden = mode === 'completed' || (mode === 'building' && building.children.length > 0);
    empty.textContent = mode === 'ideas'
      ? 'No verified idea-stage projects are public yet.'
      : 'No verified current builds are public yet.';
  });
}

if (board && dialog) {
  let trigger: HTMLAnchorElement | null = null;
  const sections = [...dialog.querySelectorAll<HTMLElement>('[data-board-detail]')];
  board.addEventListener('click', (event) => {
    const link = (event.target as Element).closest<HTMLAnchorElement>('a[data-board-preview]');
    if (!link || !board.contains(link)) return;
    const detail = sections.find((section) => section.dataset.boardDetail === link.dataset.boardPreview);
    if (!detail || !dialog.showModal) return; // The stable project URL works without JS.
    event.preventDefault();
    trigger = link;
    sections.forEach((section) => { section.hidden = section !== detail; });
    dialog.showModal();
    dialog.querySelector<HTMLButtonElement>('[data-board-close]')?.focus();
  });
  dialog.querySelector('[data-board-close]')?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
    if ((event.target as Element).closest('.board-preview__links a')) dialog.close();
  });
  dialog.addEventListener('close', () => {
    if (trigger?.isConnected && !trigger.hidden) trigger.focus({ preventScroll: true });
    trigger = null;
  });
}

/* ---------- Pinned sheets: they hang from their tacks and can be re-pinned ----------
   Each sheet is a light pendulum about its tack (a damped spring that runs
   only while it is moving, then stops). Brushing a sheet sets it swaying;
   pulling its tack lifts it off the cork and it trails behind the hand;
   letting go presses the tack back in and the sheet swings to rest. Arrow keys
   on the tack move it, Home puts it back. Positions stay on this device. */
const sheetBoard = board?.querySelector<HTMLElement>('.board');
const cork = board?.querySelector<HTMLElement>('.board__cork');
const tackStatus = board?.querySelector<HTMLElement>('[data-tack-status]');
if (sheetBoard && cork) {
  const KEY = 'the-shelf-board-sheets-v1';
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  let saved: Record<string, [number, number]> = {};
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (raw && typeof raw === 'object') saved = raw;
  } catch { /* positions are a convenience; defaults stand */ }
  const persist = () => {
    try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch { /* not remembered */ }
  };
  const say = (text: string) => { if (tackStatus) tackStatus.textContent = text; };
  let stack = 4; // the sheet last handled lies on top
  const placers: (() => void)[] = [];

  for (const sheet of sheetBoard.querySelectorAll<HTMLElement>('[data-sheet]')) {
    const tack = sheet.querySelector<HTMLButtonElement>(':scope > [data-tack]');
    const id = sheet.dataset.sheet;
    if (!tack || !id) continue;
    const name = (tack.getAttribute('aria-label') ?? 'sheet').replace(/^Re-pin /, '');
    const keep = saved[id];
    // Offset as a fraction of the board, so it holds at every size.
    let f: [number, number] = Array.isArray(keep) && keep.length === 2 && keep.every(Number.isFinite) ? [keep[0], keep[1]] : [0, 0];
    const W = () => sheetBoard.clientWidth || 1;
    const H = () => sheetBoard.clientHeight || 1;
    // The tack must stay on the cork.
    const fit = (fx: number, fy: number): [number, number] => {
      if (!sheet.offsetWidth) return [fx, fy];
      const tx = sheet.offsetLeft + sheet.offsetWidth / 2;
      const ty = sheet.offsetTop;
      const m = 8;
      return [
        clamp(fx * W(), cork.offsetLeft + m - tx, cork.offsetLeft + cork.offsetWidth - m - tx) / W(),
        clamp(fy * H(), cork.offsetTop + m - ty, cork.offsetTop + cork.offsetHeight - m - ty) / H(),
      ];
    };
    const place = () => {
      f = fit(f[0], f[1]);
      sheet.style.setProperty('--dx', `${(f[0] * W()).toFixed(1)}px`);
      sheet.style.setProperty('--dy', `${(f[1] * H()).toFixed(1)}px`);
    };
    placers.push(place);

    /* Pendulum: about 1.3 swings a second, lightly damped like paper in air. */
    const OMEGA = 2 * Math.PI * 1.3;
    const ZETA = 0.28; // a brush settles in about two seconds
    const swing = { a: 0, v: 0, target: 0 };
    let held = false;
    let raf = 0;
    let last = 0;
    const draw = () => sheet.style.setProperty('--swing', `${swing.a.toFixed(3)}deg`);
    const step = (now: number) => {
      const dt = Math.min(0.033, (now - last) / 1000 || 0.016);
      last = now;
      swing.v += (OMEGA * OMEGA * (swing.target - swing.a) - 2 * ZETA * OMEGA * swing.v) * dt;
      swing.a += swing.v * dt;
      if (!held && Math.abs(swing.a - swing.target) < 0.02 && Math.abs(swing.v) < 0.05) {
        swing.a = swing.target;
        swing.v = 0;
        draw();
        raf = 0;
        return;
      }
      draw();
      raf = requestAnimationFrame(step);
    };
    const run = () => {
      if (reduce.matches) {
        swing.a = swing.v = swing.target = 0;
        sheet.style.removeProperty('--swing');
        return;
      }
      if (!raf) {
        last = performance.now();
        raf = requestAnimationFrame(step);
      }
    };
    // Positive angles turn clockwise: the free bottom edge moves left.
    const nudge = (degPerSecond: number) => {
      swing.v += degPerSecond;
      run();
    };
    const press = () => {
      tack.classList.add('is-pressed');
      window.setTimeout(() => tack.classList.remove('is-pressed'), 150);
    };

    // A brush of the pointer sets the sheet swaying away from the hand.
    sheet.addEventListener('pointerenter', (e) => {
      if (e.pointerType !== 'mouse' || held) return;
      const r = sheet.getBoundingClientRect();
      const dir = Math.sign(e.movementX) || (e.clientX < r.left + r.width / 2 ? 1 : -1);
      nudge(-dir * 22);
    });

    /* Pull the tack, carry the sheet, press it back in. */
    let start = { x: 0, y: 0, dx: 0, dy: 0 };
    let lastX = 0;
    let lastT = 0;
    let vx = 0;
    let moved = false;
    tack.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      tack.setPointerCapture(e.pointerId);
      tack.focus({ preventScroll: true });
      held = true;
      moved = false;
      start = { x: e.clientX, y: e.clientY, dx: f[0] * W(), dy: f[1] * H() };
      lastX = e.clientX;
      lastT = performance.now();
      vx = 0;
      sheet.classList.add('is-held');
      sheet.style.zIndex = '10';
      run();
    });
    tack.addEventListener('pointermove', (e) => {
      if (!held) return;
      const ddx = e.clientX - start.x;
      const ddy = e.clientY - start.y;
      if (!moved && Math.hypot(ddx, ddy) < 3) return;
      moved = true;
      f = [(start.dx + ddx) / W(), (start.dy + ddy) / H()];
      place();
      // The sheet hangs back from the motion: moving right swings its foot left.
      const now = performance.now();
      vx = vx * 0.7 + ((e.clientX - lastX) / Math.max(1, now - lastT)) * 0.3;
      lastX = e.clientX;
      lastT = now;
      swing.target = clamp(vx * 12, -14, 14);
    });
    const drop = () => {
      if (!held) return;
      held = false;
      swing.target = 0; // released, it swings back under the tack and settles
      sheet.classList.remove('is-held');
      sheet.style.zIndex = String(++stack);
      press();
      run();
      if (moved) {
        saved[id] = f;
        persist();
        say(`${name} re-pinned.`);
      } else nudge(30); // a tap just jiggles it
    };
    tack.addEventListener('pointerup', drop);
    tack.addEventListener('pointercancel', drop);
    tack.addEventListener('lostpointercapture', drop);

    // Keyboard: arrows move it (Shift for bigger steps), Home puts it back.
    tack.addEventListener('keydown', (e) => {
      const s = e.shiftKey ? 0.06 : 0.02;
      const moves: Record<string, [number, number]> = { ArrowLeft: [-s, 0], ArrowRight: [s, 0], ArrowUp: [0, -s], ArrowDown: [0, s] };
      if (e.key === 'Home') {
        e.preventDefault();
        f = [0, 0];
        delete saved[id];
        persist();
        place();
        press();
        nudge(30);
        say(`${name} put back.`);
        return;
      }
      const m = moves[e.key];
      if (!m) return;
      e.preventDefault();
      const before = f;
      f = [f[0] + m[0], f[1] + m[1]];
      place();
      if (f[0] === before[0] && f[1] === before[1]) return say(`${name} is at the edge of the board.`);
      sheet.style.zIndex = String(++stack);
      saved[id] = f;
      persist();
      nudge(-Math.sign(m[0]) * 26);
    });
    tack.addEventListener('click', (e) => {
      if (e.detail === 0) {
        press(); // Enter or Space: tap the tack in
        nudge(30);
      }
    });
  }
  // Re-fit the offsets whenever the board changes size.
  const refit = () => placers.forEach((p) => p());
  new ResizeObserver(refit).observe(sheetBoard);
  refit();
}

// A project image that fails to load gives way to the neutral file card.
const shot = photo?.querySelector<HTMLImageElement>('img');
if (shot) {
  const swap = () => {
    const card = document.createElement('span');
    card.className = 'board-polaroid__placeholder';
    card.textContent = 'Project file';
    shot.replaceWith(card);
  };
  if (shot.complete && !shot.naturalWidth) swap();
  else shot.addEventListener('error', swap, { once: true });
}
