// The desk speaker as a working amp-style object (D-44 model, face and controls
// rebuilt in Blender). The bat-handle switch on the gold panel plays and
// pauses, the VOLUME knob turns with the volume and the amber jewel lights
// while music plays. desk-interactions.ts still owns the <audio>; the real
// HTML button and range input are laid over the switch and the knob.
import * as THREE from 'three';
import { gsap } from 'gsap';
import type { Studio } from './core';

const DIAL = Math.PI * 0.75; // the knob sweeps ±135°, 0 to 10
const LEVER = (28 * Math.PI) / 180; // switch throw: down = paused, up = playing
const DRAG = 0.6; // volume points per pixel of drag

export function rigSpeaker(studio: Studio, el: HTMLElement, model: THREE.Object3D, reduced: () => boolean) {
  const part = (name: string) => model.getObjectByName(name);
  const lever = part('SwitchLever');
  const knob = part('VolumeKnob');
  const led = part('PowerLED') as THREE.Mesh | undefined;
  const controls = document.querySelector<HTMLElement>('[data-speaker-controls]');
  const play = controls?.querySelector<HTMLButtonElement>('[data-speaker-play]');
  const volume = controls?.querySelector<HTMLInputElement>('[data-speaker-volume]');
  const dial = volume?.closest<HTMLElement>('label');
  const tip = controls?.querySelector<HTMLElement>('[data-speaker-level]');
  const stage = el.closest<HTMLElement>('[data-scene]');
  if (!lever || !knob || !controls || !play || !volume || !dial || !tip || !stage) return;

  const ledMat = led?.material instanceof THREE.MeshStandardMaterial ? led.material : null;
  ledMat?.emissive.set(0xffa53d);
  const anim = { lever: LEVER, glow: 0 };
  const apply = () => {
    lever.rotation.x = anim.lever;
    if (ledMat) ledMat.emissiveIntensity = anim.glow;
    studio.invalidate();
  };
  const setPlaying = (on: boolean) => {
    gsap.to(anim, { lever: on ? -LEVER : LEVER, glow: on ? 1.8 : 0, duration: reduced() ? 0 : 0.16, ease: 'back.out(2)', onUpdate: apply });
  };
  const setDial = () => {
    knob.rotation.z = (0.5 - Number(volume.value) / 100) * 2 * DIAL;
    studio.invalidate();
  };
  apply();
  setDial();
  new MutationObserver(() => setPlaying(el.classList.contains('is-playing'))).observe(el, { attributes: true, attributeFilter: ['class'] });

  /* ---------- One small label for whichever control is in use ---------- */
  let over: 'play' | 'volume' | null = null;
  let dragging = false;
  const showTip = () => {
    if (!over || !controls.classList.contains('is-knobs')) return void (tip.hidden = true);
    tip.textContent = over === 'play' ? (play.getAttribute('aria-pressed') === 'true' ? 'Pause' : 'Play') : `Volume ${volume.value}%`;
    tip.dataset.at = over;
    tip.hidden = false;
  };
  const enter = (which: 'play' | 'volume') => () => {
    over = which;
    showTip();
  };
  const leave = () => {
    if (dragging) return;
    over = play.matches(':focus-visible') ? 'play' : volume.matches(':focus-visible') ? 'volume' : null;
    showTip();
  };
  for (const [target, which] of [[play, 'play'], [dial, 'volume']] as const) {
    target.addEventListener('pointerenter', enter(which));
    target.addEventListener('pointerleave', leave);
  }
  play.addEventListener('focus', enter('play'));
  volume.addEventListener('focus', enter('volume'));
  play.addEventListener('blur', leave);
  volume.addEventListener('blur', leave);
  play.addEventListener('click', () => requestAnimationFrame(showTip));

  /* ---------- Knob input: drag up or right, scroll, or arrow keys ---------- */
  const setVolume = (v: number) => {
    const next = String(Math.round(Math.max(0, Math.min(100, v))));
    if (next === volume.value) return;
    volume.value = next;
    volume.dispatchEvent(new Event('input', { bubbles: true }));
  };
  volume.addEventListener('input', () => {
    setDial();
    if (over === 'volume') showTip();
  });
  let start = { x: 0, y: 0, v: 0 };
  dial.addEventListener('pointerdown', (e) => {
    if (!controls.classList.contains('is-knobs') || e.button !== 0) return;
    e.preventDefault();
    volume.focus({ preventScroll: true });
    dial.setPointerCapture(e.pointerId);
    dragging = true;
    over = 'volume';
    start = { x: e.clientX, y: e.clientY, v: Number(volume.value) };
    showTip();
  });
  dial.addEventListener('pointermove', (e) => {
    if (dragging) setVolume(start.v + (e.clientX - start.x - (e.clientY - start.y)) * DRAG);
  });
  const endDrag = () => {
    dragging = false;
    leave();
  };
  dial.addEventListener('pointerup', endDrag);
  dial.addEventListener('pointercancel', endDrag);
  dial.addEventListener('click', (e) => e.preventDefault()); // the label must not re-target the input
  dial.addEventListener(
    'wheel',
    (e) => {
      if (!controls.classList.contains('is-knobs')) return;
      e.preventDefault();
      setVolume(Number(volume.value) - Math.sign(e.deltaY) * 5);
    },
    { passive: false },
  );

  /* ---------- Lay the HTML controls over the switch and the knob ---------- */
  let frame = 0;
  const place = () => {
    frame = 0;
    const r = el.getBoundingClientRect();
    if (!r.width) {
      controls.classList.remove('is-knobs');
      return void (tip.hidden = true);
    }
    model.updateWorldMatrix(true, true);
    const s = stage.getBoundingClientRect();
    const c = controls.getBoundingClientRect();
    const pin = (o: THREE.Object3D, name: string) => {
      const p = o.getWorldPosition(new THREE.Vector3()); // studio world units are stage pixels, y up
      controls.style.setProperty(`--${name}-x`, `${p.x + s.left - c.left}px`);
      controls.style.setProperty(`--${name}-y`, `${-p.y + s.top - c.top}px`);
    };
    pin(lever, 'play');
    pin(knob, 'vol');
    // About 5 cm of panel, never under a 32 px target.
    controls.style.setProperty('--knob-size', `${Math.max(32, 0.05 * 440 * (r.width / 198))}px`);
    controls.classList.add('is-knobs');
  };
  // After the studio has re-placed the model for the new layout.
  const queue = () => {
    if (!frame) frame = requestAnimationFrame(place);
  };
  new ResizeObserver(queue).observe(stage);
  window.addEventListener('resize', queue);
  queue();
}
