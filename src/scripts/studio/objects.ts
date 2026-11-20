// Mesh builders for the studio layer. Each model is authored in the design
// units of its HTML anchor (the same numbers as the CSS scene grid), origin at
// the anchor's bottom centre, +y up, +z towards the viewer.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { gsap } from 'gsap';
import type { Built, Studio } from './core';
import { paintCover, STRAP } from '../notebook-cover';
import { BOOK_TONES, canvas, drawClockFace, glowTexture, mugTexture, pagesTexture, spineTexture, toTexture } from './textures';

const V = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z);
const P = (pairs: [number, number][]) => pairs.map(([x, y]) => new THREE.Vector2(x, y));
const UP = V(0, 1, 0);

export interface Kit {
  studio: Studio;
  brass: THREE.MeshStandardMaterial;
  bronze: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  walnut: THREE.MeshStandardMaterial;
  paper: THREE.MeshStandardMaterial;
  glow: THREE.Texture;
  shadow: THREE.Texture;
}

export function makeKit(studio: Studio): Kit {
  const wood = new THREE.TextureLoader().load('/textures/walnut.webp', () => studio.invalidate());
  wood.colorSpace = THREE.SRGBColorSpace;
  wood.wrapS = wood.wrapT = THREE.RepeatWrapping;
  wood.anisotropy = 4;
  const pages = pagesTexture();
  return {
    studio,
    brass: new THREE.MeshStandardMaterial({ color: 0xc9983f, metalness: 1, roughness: 0.3 }),
    bronze: new THREE.MeshStandardMaterial({ color: 0x241a13, metalness: 0.85, roughness: 0.42 }),
    steel: new THREE.MeshStandardMaterial({ color: 0xb9bcc2, metalness: 1, roughness: 0.28 }),
    walnut: new THREE.MeshStandardMaterial({ map: wood, color: 0xffffff, roughness: 0.5, metalness: 0 }),
    paper: new THREE.MeshStandardMaterial({ map: pages, roughness: 0.92 }),
    glow: glowTexture(),
    shadow: glowTexture('rgba(8,3,0,.72)', 'rgba(8,3,0,.3)'),
  };
}

/** A rod between two points. */
function rod(a: THREE.Vector3, b: THREE.Vector3, radius: number, material: THREE.Material, radial = 14) {
  const dir = b.clone().sub(a);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, dir.length(), radial), material);
  mesh.position.copy(a).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(UP, dir.clone().normalize());
  return mesh;
}

function halo(kit: Kit, size: number, opacity: number, color = 0xffffff) {
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: kit.glow, color, transparent: true, opacity, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, toneMapped: false }),
  );
  sprite.scale.set(size, size, 1);
  sprite.renderOrder = 10;
  return sprite;
}

/** Flat blob shadow lying on the object's own ground plane. */
function blob(kit: Kit, w: number, d: number, opacity = 0.7) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: kit.shadow, transparent: true, opacity, depthWrite: false, toneMapped: false }));
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

const lathe = (points: [number, number][], material: THREE.Material, segments = 48) => new THREE.Mesh(new THREE.LatheGeometry(P(points), segments), material);

/** Pointer + focus hover that also works for keyboard users. */
function onHover(el: HTMLElement, enter: () => void, leave: () => void) {
  el.addEventListener('pointerenter', (e) => e.pointerType !== 'touch' && enter());
  el.addEventListener('pointerleave', leave);
  el.addEventListener('focus', enter);
  el.addEventListener('blur', leave);
}

/* ---------------------------------------------------------------- Books */

function book(kit: Kit, w: number, h: number, tone: string, title: string | null) {
  const depth = 104;
  const { cover } = BOOK_TONES[tone] ?? BOOK_TONES.brown;
  const cloth = new THREE.MeshStandardMaterial({ color: new THREE.Color(cover), roughness: 0.78 });
  const spineMat = new THREE.MeshStandardMaterial({ map: spineTexture(w, h, tone, title, kit.studio.maxAnisotropy), roughness: 0.7 });
  const g = new THREE.Group();
  // Rounded spine: a slice of a cylinder whose chord is the book's width.
  const radius = w * 0.82;
  const alpha = Math.asin(w / 2 / radius);
  const spine = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, h, 14, 1, true, -alpha, alpha * 2), spineMat);
  spine.position.set(0, h / 2, depth / 2 - 2 - radius * Math.cos(alpha));
  const board = new THREE.BoxGeometry(2, h, depth - 2);
  const left = new THREE.Mesh(board, cloth);
  left.position.set(-w / 2 + 1, h / 2, -1);
  const right = new THREE.Mesh(board, cloth);
  right.position.set(w / 2 - 1, h / 2, -1);
  const pages = new THREE.Mesh(new THREE.BoxGeometry(w - 4, h - 5, depth - 7), kit.paper);
  pages.position.set(0, (h - 5) / 2 + 2, -2.5);
  // Headband: the little woven strip where the pages meet the spine.
  const band = new THREE.Mesh(new THREE.BoxGeometry(w - 4, 1.6, 3), new THREE.MeshStandardMaterial({ color: 0xb08a4a, roughness: 0.8 }));
  band.position.set(0, h - 2.6, depth / 2 - 5);
  g.add(spine, left, right, pages, band);
  return g;
}

export function buildBook(kit: Kit, el: HTMLElement): Built {
  const style = getComputedStyle(el);
  const w = parseFloat(style.getPropertyValue('--w')) || 34;
  const h = parseFloat(style.getPropertyValue('--h')) || 140;
  const model = book(kit, w, h, el.dataset.bookTone ?? 'brown', el.dataset.bookTitle ?? null);
  const root = new THREE.Group();
  root.add(model);
  // Hover: the book tips out of the row by its head, as a finger would pull it.
  const pose = { lift: 0, tip: 0 };
  const apply = () => {
    model.position.y = pose.lift;
    model.rotation.x = pose.tip;
    kit.studio.invalidate();
  };
  const to = (lift: number, tip: number, ease: string, duration: number) =>
    gsap.to(pose, { lift, tip, duration: kit.studio.reduced() ? 0 : duration, ease, overwrite: true, onUpdate: apply });
  onHover(el, () => to(5, 0.2, 'power3.out', 0.42), () => to(0, 0, 'power2.inOut', 0.5));
  el.addEventListener('pointerdown', () => to(2, 0.3, 'power2.out', 0.14));
  return { root, designW: w, designH: h, pitch: 0.1, depth: 20 };
}

export function buildBookPair(kit: Kit): Built {
  const root = new THREE.Group();
  const a = book(kit, 40, 136, 'slate', null);
  a.position.x = -22;
  const b = book(kit, 42, 152, 'brown', null);
  b.position.x = 20;
  root.add(a, b);
  return { root, designW: 84, designH: 154, pitch: 0.1, depth: 20 };
}

export function buildBookLean(kit: Kit): Built {
  const root = new THREE.Group();
  const b = book(kit, 24, 106, 'tan', null);
  // Leaning against its neighbour: the foot stays planted at the right.
  b.position.set(8, 0, 0);
  b.rotation.z = 0.2;
  root.add(b);
  return { root, designW: 44, designH: 108, pitch: 0.1, depth: 18 };
}

/* ---------------------------------------------------------------- Globe */

export function buildGlobe(kit: Kit, el: HTMLElement, map: THREE.Texture): Built {
  const { studio } = kit;
  const root = new THREE.Group();
  const R = 58;
  const CY = 124;
  const TILT = -0.41; // 23.5° axial tilt

  const base = lathe([[0, 0], [41, 0], [42, 3], [38, 7], [24, 10], [12, 12], [7, 18], [5, 30], [6.5, 40], [5, 50], [4.4, CY - R - 6]], kit.brass, 56);
  const foot = lathe([[0, 0], [44, 0], [44, 2.5], [0, 2.5]], kit.bronze, 56);
  root.add(foot, base);

  const axis = new THREE.Group();
  axis.position.set(0, CY, 0);
  axis.rotation.z = TILT;
  root.add(axis);

  const spin = new THREE.Group();
  axis.add(spin);
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(R, 72, 48),
    new THREE.MeshPhysicalMaterial({ map, color: 0xe6d9c4, roughness: 0.6, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.35 }),
  );
  spin.add(sphere);

  // Brass semi-meridian from pole to pole, swung towards the viewer.
  const meridian = new THREE.Mesh(new THREE.TorusGeometry(R + 5.5, 2.5, 12, 72, Math.PI * 1.1), kit.brass);
  meridian.rotation.z = -Math.PI * 0.55;
  const swing = new THREE.Group();
  swing.rotation.y = -0.5;
  swing.add(meridian);
  axis.add(swing);
  for (const s of [1, -1]) {
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 9, 16), kit.brass);
    pin.position.y = s * (R + 3.5);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(4, 16, 12), kit.brass);
    cap.position.y = s * (R + 8);
    axis.add(pin, cap);
  }
  // Collar where the stem takes the meridian.
  const collar = new THREE.Mesh(new THREE.SphereGeometry(6, 20, 14), kit.brass);
  collar.position.set(0, CY - R - 5.5, 0);
  root.add(collar);

  // Drag to turn (with inertia), arrow keys to step, Home to reset.
  const START = -1.9; // Africa, India and Asia face the room
  spin.rotation.y = START;
  let velocity = 0;
  let dragging = false;
  let raf = 0;
  let last = 0;
  let lean = 0;
  const tick = (t: number) => {
    const dt = Math.min(0.05, (t - last) / 1000 || 0.016);
    last = t;
    if (!dragging) {
      velocity *= Math.pow(0.34, dt); // friction of the bearing
      spin.rotation.y += velocity * dt;
      lean *= Math.pow(0.02, dt);
    }
    axis.rotation.x = lean;
    studio.invalidate();
    raf = dragging || Math.abs(velocity) > 0.012 || Math.abs(lean) > 0.002 ? requestAnimationFrame(tick) : 0;
  };
  const wake = () => {
    if (!raf) {
      last = performance.now();
      raf = requestAnimationFrame(tick);
    }
  };
  el.setAttribute('role', 'button');
  el.tabIndex = 0;
  el.setAttribute('aria-label', 'Desk globe: drag or use the arrow keys to turn it');
  el.setAttribute('aria-describedby', 'globe-hint');
  let lastX = 0;
  let lastY = 0;
  let lastT = 0;
  let moved = 0;
  el.addEventListener('pointerdown', (e) => {
    dragging = true;
    moved = 0;
    lastX = e.clientX;
    lastY = e.clientY;
    lastT = performance.now();
    velocity = 0;
    el.setPointerCapture(e.pointerId);
    el.classList.add('is-dragging');
    wake();
  });
  el.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const radiusPx = (el.getBoundingClientRect().width / 142) * R;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    moved += Math.abs(dx) + Math.abs(dy);
    const step = dx / radiusPx;
    spin.rotation.y += step;
    lean = THREE.MathUtils.clamp(lean + (dy / radiusPx) * 0.35, -0.24, 0.24);
    const now = performance.now();
    velocity = step / Math.max(0.008, (now - lastT) / 1000);
    lastX = e.clientX;
    lastY = e.clientY;
    lastT = now;
  });
  const release = () => {
    if (!dragging) return;
    dragging = false;
    el.classList.remove('is-dragging');
    if (performance.now() - lastT > 90) velocity = 0; // held still before letting go
    if (moved < 4) velocity = studio.reduced() ? 0 : 2.6; // a tap gives it one push
    if (moved < 4 && studio.reduced()) spin.rotation.y += 0.6;
    if (studio.reduced()) velocity = 0;
    velocity = THREE.MathUtils.clamp(velocity, -9, 9);
    wake();
  };
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
  el.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      velocity = 0;
      const to = spin.rotation.y + (e.key === 'ArrowLeft' ? -0.4 : 0.4);
      gsap.to(spin.rotation, { y: to, duration: studio.reduced() ? 0 : 0.36, ease: 'power2.out', overwrite: true, onUpdate: studio.invalidate });
    } else if (e.key === 'Home') {
      e.preventDefault();
      velocity = 0;
      gsap.to(spin.rotation, { y: START, duration: studio.reduced() ? 0 : 0.6, ease: 'power2.inOut', overwrite: true, onUpdate: studio.invalidate });
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (studio.reduced()) spin.rotation.y += 0.6;
      else velocity = 2.6;
      wake();
    }
  });
  return { root, designW: 142, pitch: 0.1, depth: 30, dispose: () => cancelAnimationFrame(raf) };
}

/* ---------------------------------------------------------------- Lamps */

interface Bulb {
  set: (on: boolean, instant: boolean) => void;
}
function bulb(kit: Kit, parent: THREE.Object3D, at: THREE.Vector3, size: number, inner: THREE.MeshStandardMaterial): Bulb {
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff3d2, toneMapped: false });
  const glass = new THREE.Mesh(new THREE.SphereGeometry(size, 20, 14), lampMat);
  glass.position.copy(at);
  const bloom = halo(kit, size * 15, 0.5, 0xffd9a0);
  bloom.position.copy(at);
  parent.add(glass, bloom);
  const state = { k: 1 };
  const apply = () => {
    lampMat.color.setRGB(0.22 + 0.78 * state.k, 0.2 + 0.75 * state.k, 0.17 + 0.65 * state.k);
    (bloom.material as THREE.SpriteMaterial).opacity = 0.5 * state.k;
    inner.emissiveIntensity = 1.5 * state.k;
    kit.studio.invalidate();
  };
  return {
    set(on, instant) {
      // A filament does not snap: it warms up quickly and cools a little slower.
      gsap.to(state, { k: on ? 1 : 0, duration: instant || kit.studio.reduced() ? 0 : on ? 0.45 : 0.7, ease: on ? 'power2.out' : 'power1.in', overwrite: true, onUpdate: apply });
    },
  };
}
// Both shade skins are double-sided: depth sorts which one the viewer sees.
const shadeInner = () => new THREE.MeshStandardMaterial({ color: 0xf4e3c0, emissive: 0xffc777, emissiveIntensity: 1.5, roughness: 0.6, side: THREE.DoubleSide });

export function buildLamp(kit: Kit, el: HTMLElement): Built {
  const root = new THREE.Group();
  const B = V(88, 12, 0);
  const E = V(106, 116, 0);
  const H = V(-14, 190, 0);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(30.5, 0.9, 8, 56), kit.brass);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 4.4;
  const foot = new THREE.Group();
  foot.position.x = B.x;
  foot.add(lathe([[0, 0], [31, 0], [32, 2], [30, 5], [12, 8], [7, 12], [0, 12]], kit.bronze), ring);
  root.add(foot);
  // Two parallel arms per section, as on an architect's lamp.
  for (const dz of [-3.4, 3.4]) {
    root.add(rod(V(B.x, B.y, dz), V(E.x, E.y, dz), 1.7, kit.brass));
    root.add(rod(V(E.x, E.y, dz), V(H.x, H.y, dz), 1.7, kit.brass));
  }
  for (const [p, r] of [[B, 6.2], [E, 6.6], [H, 5.6]] as const) {
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 11, 24), kit.bronze);
    knob.rotation.x = Math.PI / 2;
    knob.position.copy(p);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.5, r * 0.5, 12.6, 20), kit.brass);
    cap.rotation.x = Math.PI / 2;
    cap.position.copy(p);
    root.add(knob, cap);
  }
  // Head: a spun bell shade aimed down-left at the shelf, slightly at the room.
  const head = new THREE.Group();
  head.position.copy(H);
  head.quaternion.setFromUnitVectors(UP, V(-0.55, -0.74, 0.38).normalize());
  const profile: [number, number][] = [[5, 2], [8, 8], [14, 16], [27, 36], [35, 52], [36, 55]];
  const outer = lathe(profile, new THREE.MeshStandardMaterial({ color: 0x2b1f17, metalness: 0.8, roughness: 0.36, side: THREE.DoubleSide }));
  const innerMat = shadeInner();
  const inner = lathe(profile, innerMat);
  inner.scale.set(0.97, 0.995, 0.97);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(36, 1.1, 8, 56), kit.brass);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 55;
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(5, 6, 10, 20), kit.brass);
  neck.position.y = 1;
  head.add(outer, inner, rim, neck);
  root.add(head);
  const light = bulb(kit, head, V(0, 34, 0), 8, innerMat);
  // The switch is the whole lamp; a press nods the head a few degrees.
  el.addEventListener('click', () => {
    if (kit.studio.reduced()) return;
    gsap.fromTo(head.rotation, { z: head.rotation.z }, { z: head.rotation.z + 0.05, duration: 0.12, ease: 'power2.out', yoyo: true, repeat: 1, onUpdate: kit.studio.invalidate });
  });
  return { root, designW: 250, pitch: 0.1, depth: 40, lamp: light.set };
}

export function buildPendant(kit: Kit): Built {
  const root = new THREE.Group();
  root.add(rod(V(0, 0, 0), V(0, -58, 0), 0.9, kit.bronze, 8));
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(5, 7.5, 12, 24), kit.brass);
  cap.position.y = -62;
  const profile: [number, number][] = [[6, -66], [12, -69], [26, -78], [38, -92], [42, -104], [42.6, -107]];
  const outer = lathe(profile, new THREE.MeshStandardMaterial({ color: 0x241913, metalness: 0.75, roughness: 0.4, side: THREE.DoubleSide }));
  const innerMat = shadeInner();
  const inner = lathe(profile, innerMat);
  inner.scale.set(0.975, 1, 0.975);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(42.6, 1.2, 8, 56), kit.brass);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = -107;
  root.add(cap, outer, inner, rim);
  const light = bulb(kit, root, V(0, -100, 0), 9.5, innerMat);
  return { root, designW: 104, origin: 'top', pitch: -0.22, depth: 40, lamp: light.set };
}

/* --------------------------------------------------------------- Rocket */

// Value-noise fbm shared by the rocket's shaders.
const NOISE = `
float rkH(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float rkN(vec2 p){vec2 i=floor(p),f=fract(p);f*=f*(3.-2.*f);
  return mix(mix(rkH(i),rkH(i+vec2(1.,0.)),f.x),mix(rkH(i+vec2(0.,1.)),rkH(i+1.),f.x),f.y);}
float rkF(vec2 p){float v=0.,w=.5;for(int k=0;k<4;k++){v+=w*rkN(p);p=p*2.03+vec2(1.7,9.2);w*=.5;}return v;}`;

/**
 * Weathers a lacquered material in its own shader: panel seams with rivet rows
 * at the given heights, soot streaks rising from the engine (rougher and with
 * no clearcoat), faint grime, and the hull lit by the exhaust (`glow`).
 * Heights are in the mesh's own units.
 */
function weather(material: THREE.MeshPhysicalMaterial, seams: number[], glow: { value: number }) {
  const seamCode = seams
    .map(
      (h) => `rkSeam += 1.0 - smoothstep(0.12, 0.5, abs(vRk.y - ${h.toFixed(1)}));
      rkRivet += 1.0 - smoothstep(0.42, 0.72, length(vec2(mod(rkArc, 5.4) - 2.7, vRk.y - ${(h + 2.4).toFixed(1)})));`,
    )
    .join('\n');
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRkGlow = glow;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRk;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRk = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vRk;\nuniform float uRkGlow;\n${NOISE}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
      float rkA = atan(vRk.z, vRk.x);
      float rkArc = rkA * length(vRk.xz);
      float rkSeam = 0.0;
      float rkRivet = 0.0;
      ${seamCode}
      float rkSoot = (1.0 - smoothstep(24.0, 62.0 + rkF(vec2(rkA * 4.0, 0.3)) * 34.0, vRk.y))
        * (0.4 + 0.6 * rkF(vec2(rkA * 11.0, vRk.y * 0.22)));
      rkSoot = clamp(rkSoot, 0.0, 1.0);
      diffuseColor.rgb *= 1.0 - 0.3 * clamp(rkSeam, 0.0, 1.0) - 0.16 * clamp(rkRivet, 0.0, 1.0);
      diffuseColor.rgb *= 1.0 - 0.07 * rkF(vRk.xy * 0.2 + vRk.zy * 0.13);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.075, 0.06, 0.05), rkSoot * 0.62);`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.86, rkSoot * 0.85);')
      .replace(
        '#include <lights_physical_fragment>',
        '#include <lights_physical_fragment>\n#ifdef USE_CLEARCOAT\nmaterial.clearcoat *= 1.0 - rkSoot * 0.9;\n#endif',
      )
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.48, 0.16) * uRkGlow * (1.0 - smoothstep(14.0, 64.0, vRk.y)) * 0.55;',
      );
  };
  material.customProgramCacheKey = () => `rocket-weather-${seams.join(',')}`;
  return material;
}

/**
 * Exhaust: noise-torn flame, blue-white at the throat, orange at the tip.
 * `uFloor` (in the flame's own y) is the stand top: below it nothing is drawn,
 * so on the pad the exhaust stops at the stand instead of showing through it.
 */
function flameMaterial(uniforms: { uTime: { value: number }; uThrottle: { value: number }; uFloor: { value: number } }) {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `varying vec2 vUv; varying float vFacing; varying float vY;
      void main(){
        vUv = uv;
        vY = position.y;
        vFacing = abs(normalize(normalMatrix * normal).z);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `uniform float uTime; uniform float uThrottle; uniform float uFloor; varying vec2 vUv; varying float vFacing; varying float vY;
      ${NOISE}
      void main(){
        if (vY < uFloor) discard;
        float d = 1.0 - vUv.y; // 0 at the nozzle, 1 at the tip
        float n = rkF(vec2(vUv.x * 9.0, d * 5.0 - uTime * 9.0));
        float body = 1.0 - smoothstep(0.1, 1.0, d + (n - 0.5) * 0.6);
        float core = pow(vFacing, 2.0);
        float i = body * mix(0.2, 1.0, core) * clamp(uThrottle, 0.0, 1.7) * smoothstep(uFloor, uFloor + 4.0, vY);
        vec3 c = mix(vec3(1.0, 0.4, 0.08), vec3(1.0, 0.87, 0.58), smoothstep(0.35, 0.95, body * core));
        c = mix(c, vec3(0.66, 0.8, 1.0), (1.0 - smoothstep(0.0, 0.16, d)) * core * 0.7);
        gl_FragColor = vec4(c * i, i);
      }`,
    transparent: true,
    premultipliedAlpha: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

/** Launch smoke: a soft billowing cloud that swells and thins with `uPuff`. */
function smokeMaterial(uniforms: { uTime: { value: number }; uPuff: { value: number } }) {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float uTime; uniform float uPuff; varying vec2 vUv;
      ${NOISE}
      void main(){
        vec2 p = (vUv - vec2(0.5, 0.3)) * vec2(1.0, 1.7);
        float n = rkF(vUv * 4.5 + vec2(uTime * 0.25, -uTime * 0.5));
        float m = (1.0 - smoothstep(0.12, 0.42 + n * 0.16 + uPuff * 0.1, length(p))) * uPuff * (0.45 + 0.55 * n);
        vec3 c = mix(vec3(0.5, 0.45, 0.42), vec3(0.93, 0.89, 0.84), smoothstep(0.1, 0.75, vUv.y));
        m = clamp(m, 0.0, 0.85);
        gl_FragColor = vec4(c * m, m);
      }`,
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
    toneMapped: false,
  });
}

export function buildRocket(kit: Kit, el: HTMLElement): Built {
  const { studio } = kit;
  const root = new THREE.Group();
  // Turned walnut stand with a scorched centre.
  root.add(lathe([[0, 0], [37, 0], [38, 3], [35, 7], [30, 9], [0, 9]], kit.walnut, 48));
  const scorch = new THREE.Mesh(new THREE.CircleGeometry(15, 32), new THREE.MeshBasicMaterial({ color: 0x120703, transparent: true, opacity: 0.55, depthWrite: false }));
  scorch.rotation.x = -Math.PI / 2;
  scorch.position.y = 9.2;
  root.add(scorch);

  const ship = new THREE.Group();
  ship.position.y = -4;
  root.add(ship);
  const glow = { value: 0 };
  const enamel = weather(new THREE.MeshPhysicalMaterial({ color: 0xf1ece2, roughness: 0.3, metalness: 0.06, clearcoat: 1, clearcoatRoughness: 0.14 }), [48, 84, 124], glow);
  const red = weather(new THREE.MeshPhysicalMaterial({ color: 0xa8231a, roughness: 0.34, metalness: 0.08, clearcoat: 1, clearcoatRoughness: 0.16 }), [], glow);
  ship.add(lathe([[13.2, 34], [14.6, 46], [16.4, 64], [17.4, 86], [17.4, 106], [16, 124], [12.6, 142]], enamel, 64));
  ship.add(lathe([[12.6, 142], [8, 156], [3.6, 166]], red, 64));
  ship.add(lathe([[3.6, 166], [2.2, 169.6], [0.8, 172.4], [0, 173]], kit.steel, 32)); // steel tip
  ship.add(lathe([[16.9, 58], [17.5, 61], [17.8, 66], [17.5, 70]], red, 64));
  // Engine bell: heat-tinted steel, straw at the throat through blue to gunmetal.
  const bellGeo = new THREE.LatheGeometry(P([[9.2, 35.5], [9.6, 33], [10.8, 29], [12.6, 24], [13.6, 21]]), 48);
  const tint = [new THREE.Color(0x8a6a3a), new THREE.Color(0x4a3f6e), new THREE.Color(0x2b2d33)];
  const ys = bellGeo.attributes.position;
  const colors = new Float32Array(ys.count * 3);
  for (let i = 0; i < ys.count; i++) {
    const k = THREE.MathUtils.clamp((35.5 - ys.getY(i)) / 14.5, 0, 1);
    const c = k < 0.5 ? tint[0].clone().lerp(tint[1], k * 2) : tint[1].clone().lerp(tint[2], (k - 0.5) * 2);
    c.toArray(colors, i * 3);
  }
  bellGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  ship.add(new THREE.Mesh(bellGeo, new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.88, roughness: 0.38, side: THREE.DoubleSide })));
  // Bell rim and the dark ring where the bell meets the hull.
  const rim = new THREE.Mesh(new THREE.TorusGeometry(13.6, 0.55, 8, 48), kit.steel);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 21;
  ship.add(rim);
  ship.add(lathe([[9.2, 35.6], [13.4, 35.6], [13.2, 34.2], [9.2, 34.2]], kit.bronze, 48));
  // Porthole.
  const port = new THREE.Group();
  port.position.set(0, 110, 16.9);
  const bezel = new THREE.Mesh(new THREE.TorusGeometry(6.6, 1.7, 12, 36), kit.steel);
  const glass = new THREE.Mesh(new THREE.SphereGeometry(5.8, 28, 16), new THREE.MeshPhysicalMaterial({ color: 0x1b4a78, roughness: 0.05, metalness: 0.3, clearcoat: 1 }));
  glass.scale.z = 0.3;
  port.add(bezel, glass);
  ship.add(port);
  // Three swept fins: one facing the room, two raked back.
  const finShape = new THREE.Shape();
  finShape.moveTo(12.6, 62);
  finShape.quadraticCurveTo(30, 44, 33, 14);
  finShape.lineTo(27, 16);
  finShape.quadraticCurveTo(22, 28, 12.6, 32);
  finShape.closePath();
  const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 2.6, bevelEnabled: true, bevelSize: 0.7, bevelThickness: 0.7, bevelSegments: 2 });
  finGeo.translate(0, 0, -1.3);
  for (const a of [-Math.PI / 2, Math.PI / 6, (5 * Math.PI) / 6]) {
    const fin = new THREE.Mesh(finGeo, red);
    fin.rotation.y = a;
    ship.add(fin);
  }
  // Engine: a shader flame hanging from the bell (its top at the nozzle exit),
  // a bloom, and launch smoke, all driven by one throttle. Time only advances
  // inside a hover or launch tween, so a still scene draws nothing.
  const flameU = { uTime: { value: 0 }, uThrottle: { value: 0 }, uFloor: { value: -1e4 } };
  const flame = new THREE.Mesh(new THREE.CylinderGeometry(7.4, 1.2, 44, 28, 10, true), flameMaterial(flameU));
  flame.geometry.translate(0, -22, 0);
  flame.position.y = 21.5;
  flame.renderOrder = 9;
  ship.add(flame);
  const bloom = halo(kit, 90, 0, 0xffb060);
  bloom.position.set(0, 18, 24); // travels with the engine
  ship.add(bloom);
  const smokeU = { uTime: { value: 0 }, uPuff: { value: 0 } };
  const smoke = new THREE.Mesh(new THREE.PlaneGeometry(150, 96), smokeMaterial(smokeU));
  smoke.position.set(0, 30, 42);
  smoke.renderOrder = 11;
  smoke.visible = false;
  root.add(smoke);

  const REST = 0; // a parked rocket is cold
  const PITCH = 0.26;
  const CENTRE = 95; // the airframe turns about its middle, not its tail
  // p: progress along the flight path; upright: 0 = nose follows the path,
  // 1 = standing straight; away: lifts the ship in front of other meshes.
  // drop: the final descent, a straight vertical fall from the path's end to the pad.
  const s = { throttle: REST, y: 0, x: 0, roll: 0, t: 0, smoke: 0, spread: 0, p: 0, upright: 1, away: 0, drop: 0 };
  let path: THREE.CatmullRomCurve3 | null = null;
  let heading = 0;
  let level: number | null = null; // the upright angle it rights itself to, fixed once chosen
  const apply = () => {
    const th = s.throttle;
    let px = 0;
    let py = 0;
    let turn = 0;
    if (path && s.p > 0) {
      const pt = path.getPointAt(s.p);
      const tg = path.getTangentAt(s.p);
      // Unwrapped heading so a full loop never snaps; levels out to the nearest upright.
      let raw = -Math.atan2(tg.x, tg.y);
      while (raw - heading > Math.PI) raw -= Math.PI * 2;
      while (raw - heading < -Math.PI) raw += Math.PI * 2;
      heading = raw;
      if (s.upright > 0 && level === null) level = Math.round(raw / (Math.PI * 2)) * Math.PI * 2;
      turn = THREE.MathUtils.lerp(raw, level ?? raw, s.upright);
      px = pt.x;
      py = pt.y * (1 - s.drop); // the path ends straight above the pad
    }
    const z = s.away * 220;
    ship.rotation.z = s.roll + turn;
    ship.position.set(
      s.x + px + CENTRE * Math.sin(turn),
      -4 + s.y + py + CENTRE * (1 - Math.cos(turn)) + z * Math.tan(PITCH), // keep screen height while lifted forward
      z,
    );
    flame.visible = th > 0.01;
    flame.scale.set(0.6 + th * 0.4, 0.3 + th * 0.7, 0.6 + th * 0.4);
    // Over the pad, the exhaust stops at the stand top (y = 9).
    const tilt = Math.atan2(Math.sin(ship.rotation.z), Math.cos(ship.rotation.z)); // a full loop counts as upright
    const overPad = Math.abs(ship.position.x) < 30 && Math.abs(tilt) < 0.35 && s.away < 0.5;
    flameU.uFloor.value = overPad ? (9 - ship.position.y - flame.position.y) / flame.scale.y : -1e4;
    flameU.uThrottle.value = th;
    flameU.uTime.value = s.t;
    glow.value = Math.min(1.4, th);
    (bloom.material as THREE.SpriteMaterial).opacity = th * 0.45;
    bloom.scale.setScalar(60 + th * 55);
    smoke.visible = s.smoke > 0.01;
    smoke.scale.setScalar(0.5 + s.spread * 0.8);
    smokeU.uPuff.value = s.smoke;
    smokeU.uTime.value = s.t;
    scorch.material.opacity = 0.55 + Math.min(0.3, th * 0.2);
    studio.invalidate();
  };
  apply();

  /**
   * The flight: straight up off the pad, a sweeping loop around the part of
   * the scene that is on screen (towards whichever side has more room), ending
   * in a hover straight above the pad. The landing is a separate vertical drop
   * (`s.drop`). Points are in the model's units relative to the pad.
   */
  const plan = () => {
    const stage = el.closest<HTMLElement>('[data-scene]');
    const r = el.getBoundingClientRect();
    const k = 1 / Math.cos(PITCH); // the model is tilted; keep screen distances true
    const hop = { curve: new THREE.CatmullRomCurve3([V(0, 0), V(0, 30 * k), V(0, 60 * k)]), tour: false };
    if (!stage || !r.width) return hop;
    const sr = stage.getBoundingClientRect();
    const L = Math.max(sr.left, 0);
    const T = Math.max(sr.top, 0);
    const R = Math.min(sr.right, window.innerWidth);
    const B = Math.min(sr.bottom, window.innerHeight);
    const W = R - L;
    const H = B - T;
    const u = r.width / 86; // pixels per model unit
    const len = 175 * u; // the whole ship stays on screen
    if (W < len * 3 || H < len * 2.2) return hop;
    const ox = r.left + r.width / 2;
    const oy = r.bottom;
    const f0 = (ox - L) / W;
    const left = f0 > 0.5; // loop out towards the roomier side
    const at = (fx: number, fy: number) => {
      const x = L + (left ? fx : 1 - fx) * W;
      const cx = Math.min(R - len * 0.6, Math.max(L + len * 0.6, x));
      const cy = Math.min(B - len * 0.25, Math.max(T + len * 1.05, T + fy * H));
      return V((cx - ox) / u, ((oy - cy) / u) * k);
    };
    const m = left ? f0 : 1 - f0; // the pad, in the mirrored frame
    const tour = [
      V(0, 0),
      V(0, 70 * k),
      at(m, 0.4),
      at(m - 0.16, 0.12),
      at(0.38, 0.1),
      at(0.1, 0.42),
      at(0.28, 0.82),
      at(0.62, 0.74),
      at(m, 0.36),
    ];
    // Arrive from above the pad and slow into a hover there.
    const curve = new THREE.CatmullRomCurve3([...tour, V(0, 230 * k), V(0, 170 * k)], false, 'centripetal');
    return { curve, tour: true };
  };

  let flight: gsap.core.Timeline | null = null;
  const launch = () => {
    if (flight?.isActive()) return;
    if (studio.reduced()) {
      // No travel: the engine simply brightens and settles.
      flight = gsap.timeline({ onUpdate: apply }).to(s, { throttle: 1.2, duration: 0.01 }).to(s, { throttle: REST, duration: 0.01 }, 0.7);
      return;
    }
    const route = plan();
    path = route.curve;
    heading = 0;
    level = null;
    const D = route.tour ? 6.2 : 1.1; // time on the path
    const hover = 0.3 + D; // hanging straight above the pad, already upright
    const DROP = route.tour ? 1.5 : 0.9; // the vertical landing
    const land = hover + 0.15 + DROP; // touchdown
    flight = gsap
      .timeline({
        onUpdate: apply,
        onComplete: () => {
          path = null;
          el.removeAttribute('data-flying');
        },
      })
      .set(s, { p: 0, drop: 0, upright: route.tour ? 0 : 1, spread: 0, away: 0 }, 0)
      // Ignition: the engine catches and the airframe shudders on its stand.
      .to(s, { throttle: 1.35, duration: 0.34, ease: 'power2.in' }, 0)
      .to(s, { keyframes: { x: [0, 0.7, -0.6, 0.5, -0.4, 0.2, 0] }, duration: 0.36, ease: 'none' }, 0.02)
      // Lift-off and the tour.
      .to(s, { throttle: 1.65, duration: 0.3, ease: 'power1.out' }, 0.3)
      .to(s, { p: 1, duration: D, ease: 'power1.inOut' }, 0.3)
      .to(s, { throttle: 1.15, duration: 0.8, ease: 'sine.inOut' }, 1)
      .to(s, { away: route.tour ? 1 : 0, duration: 0.6, ease: 'sine.inOut' }, 0.55)
      // Coming back over the pad it rights itself fully before the hover.
      .to(s, { upright: 1, duration: 0.8, ease: 'sine.inOut' }, hover - 0.8)
      .to(s, { away: 0, duration: 0.8, ease: 'sine.inOut' }, hover - 0.8)
      // Straight-down landing, braking as it nears the stand.
      .to(s, { drop: 1, duration: DROP, ease: 'power2.inOut' }, hover + 0.15)
      .to(s, { throttle: 1.3, duration: 0.45, ease: 'sine.in' }, land - 0.7)
      // Soft touchdown.
      .to(s, { y: -1.4, duration: 0.09, ease: 'power1.out' }, land)
      .to(s, { y: 0, duration: 0.3, ease: 'back.out(3)' }, land + 0.09)
      .to(s, { throttle: REST, duration: 0.5, ease: 'power2.out' }, land - 0.05)
      // Flame flicker and smoke run on the flight's own clock, then stop.
      .to(s, { t: `+=${(D * 1.25).toFixed(2)}`, duration: land + 0.4, ease: 'none' }, 0)
      .to(s, { smoke: 0.9, spread: 0.45, duration: 0.45, ease: 'power2.out' }, 0.22)
      .to(s, { spread: 1, duration: 1.2, ease: 'power1.out' }, 0.67)
      .to(s, { smoke: 0, duration: 1.0, ease: 'power1.in' }, 0.85)
      .to(s, { smoke: 0.4, spread: 0.3, duration: 0.25, ease: 'power2.out' }, land - 0.3)
      .to(s, { smoke: 0, spread: 0.8, duration: 0.6, ease: 'power1.in' }, land - 0.05);
    el.setAttribute('data-flying', '');
  };
  el.addEventListener('click', launch);
  onHover(
    el,
    () => {
      if (flight?.isActive() || studio.reduced()) return;
      // Pilot light: the engine catches and flickers for a moment, then holds still.
      gsap.to(s, { throttle: 0.45, duration: 0.3, ease: 'power2.out', onUpdate: apply });
      gsap.to(s, { t: '+=0.7', duration: 0.7, ease: 'power1.out', onUpdate: apply });
      gsap.fromTo(s, { roll: 0 }, { keyframes: { roll: [0, 0.03, -0.02, 0.01, 0] }, duration: 0.7, ease: 'sine.inOut', onUpdate: apply });
    },
    () => {
      if (flight?.isActive()) return;
      gsap.to(s, { throttle: REST, duration: 0.5, ease: 'power2.out', onUpdate: apply });
    },
  );
  return { root, designW: 86, pitch: 0.26, depth: 30, dispose: () => flight?.kill() };
}

/* ------------------------------------------------------------------ Mug */

export function buildMug(kit: Kit): Built {
  const root = new THREE.Group();
  root.add(lathe([[0, 0], [60, 0], [61, 2], [59, 5], [0, 5]], kit.walnut, 48));
  const ceramic = new THREE.MeshPhysicalMaterial({ color: 0xf6efe1, roughness: 0.32, clearcoat: 0.85, clearcoatRoughness: 0.18, side: THREE.DoubleSide });
  const mug = new THREE.Group();
  mug.position.y = 5;
  mug.add(lathe([[0, 0.4], [33, 0.4], [37.5, 2], [40, 7], [42.2, 80], [42.8, 84], [41.6, 86], [39.6, 84.5], [38, 12], [34, 8], [0, 8]], ceramic, 64));
  const wrap = new THREE.Mesh(
    new THREE.CylinderGeometry(42.35, 40.75, 56, 48, 1, true, -0.92, 1.84),
    new THREE.MeshStandardMaterial({ map: mugTexture(kit.studio.maxAnisotropy), transparent: true, roughness: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
  );
  wrap.position.y = 45;
  const coffee = new THREE.Mesh(new THREE.CircleGeometry(39.4, 48), new THREE.MeshPhysicalMaterial({ color: 0x2a1408, roughness: 0.12, clearcoat: 1 }));
  coffee.rotation.x = -Math.PI / 2;
  coffee.position.y = 77;
  const handle = new THREE.Mesh(new THREE.TorusGeometry(21, 5.6, 14, 36, Math.PI * 1.16), ceramic);
  handle.rotation.z = -Math.PI * 0.58;
  const arm = new THREE.Group();
  arm.position.set(40, 44, 0);
  arm.rotation.y = -0.42;
  arm.add(handle);
  mug.add(wrap, coffee, arm);
  root.add(mug);
  return { root, designW: 140, pitch: 0.34, depth: 60 };
}

/* ---------------------------------------------------------------- Clock */

export function buildClock(kit: Kit, el: HTMLElement): Built {
  const root = new THREE.Group();
  const body = new THREE.Mesh(new RoundedBoxGeometry(164, 62, 46, 5, 8), new THREE.MeshPhysicalMaterial({ color: 0x17110d, roughness: 0.3, metalness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.3 }));
  body.position.y = 35;
  const [face] = canvas(900, 300);
  const texture = toTexture(face, kit.studio.maxAnisotropy);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(150, 48), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
  screen.position.set(0, 35, 23.7);
  const bezel = new THREE.Mesh(new RoundedBoxGeometry(154, 52, 2, 3, 3), new THREE.MeshStandardMaterial({ color: 0x080504, roughness: 0.2, metalness: 0.4 }));
  bezel.position.set(0, 35, 22.4);
  root.add(body, bezel, screen);
  for (const x of [-62, 62]) {
    const footPad = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 4, 16), kit.bronze);
    footPad.position.set(x, 2, 8);
    root.add(footPad);
  }
  root.rotation.y = -0.1;
  const draw = (time: string, period: string) => {
    drawClockFace(face, time, period);
    texture.needsUpdate = true;
    kit.studio.invalidate();
  };
  draw(el.dataset.time ?? '--:--', el.dataset.period ?? '');
  const onClock = (event: Event) => {
    const { value, period } = (event as CustomEvent<{ value: string; period: string }>).detail;
    draw(value, period);
  };
  window.addEventListener('shelf:clock', onClock);
  return { root, designW: 172, pitch: 0.16, depth: 70, dispose: () => window.removeEventListener('shelf:clock', onClock) };
}

/* ----------------------------------------------------- Notebook and pen */

/**
 * The desk notebook, closed and lying on the desk: leather boards wearing the
 * same cover the 3D book opens from (notebook-cover.ts), the cream page block
 * showing on three edges, a rounded spine on the left, the elastic strap
 * running over the cover and down both ends, and a ribbon slipping out.
 */
export function buildNotebook(kit: Kit, el: HTMLElement): Built {
  const { studio } = kit;
  const root = new THREE.Group();
  const bookGroup = new THREE.Group();
  bookGroup.position.y = 64; // flat objects centre on their anchor
  bookGroup.rotation.y = 0.08; // set down a little askew
  root.add(bookGroup);
  const BW = 204; // across (x), in the book's page aspect
  const BD = 280; // front to back (z); the cover's top edge is at the back
  const BOARD = 3.5;
  const BLOCK = 20;
  const leather = new THREE.MeshStandardMaterial({ color: 0x3a2416, roughness: 0.62 });
  const coverMap = new THREE.CanvasTexture(paintCover(true, 1024));
  coverMap.colorSpace = THREE.SRGBColorSpace;
  coverMap.anisotropy = studio.maxAnisotropy;
  const coverTop = new THREE.MeshStandardMaterial({ map: coverMap, roughness: 0.58 });
  const board = (y: number, top: THREE.Material) => {
    // Box faces: +x, -x, +y, -y, +z, -z.
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(BW, BOARD, BD), [leather, leather, top, leather, leather, leather]);
    mesh.position.y = y;
    return mesh;
  };
  bookGroup.add(board(BOARD / 2, leather), board(BOARD * 1.5 + BLOCK, coverTop));
  // Page block, flush to the spine, set in from the boards' other three edges.
  const block = new THREE.Mesh(new THREE.BoxGeometry(BW - 9, BLOCK, BD - 6), kit.paper);
  block.position.set(1.5, BOARD + BLOCK / 2, 0);
  const spine = new THREE.Mesh(new RoundedBoxGeometry(9, BLOCK + BOARD * 2 + 0.6, BD, 3, 4), leather);
  spine.position.set(-BW / 2 + 3, (BLOCK + BOARD * 2) / 2, 0);
  bookGroup.add(block, spine);
  // The strap continues down over both ends of the book.
  const strapMat = new THREE.MeshStandardMaterial({ color: 0x24160d, roughness: 0.7 });
  const sx = -BW / 2 + BW * (STRAP.x + STRAP.w / 2);
  for (const z of [BD / 2 + 0.6, -BD / 2 - 0.6]) {
    const strap = new THREE.Mesh(new THREE.BoxGeometry(BW * STRAP.w, BLOCK + BOARD * 2 + 0.8, 1.2), strapMat);
    strap.position.set(sx, (BLOCK + BOARD * 2) / 2, z);
    bookGroup.add(strap);
  }
  const ribbon = new THREE.Mesh(new THREE.BoxGeometry(7, 0.8, 34), new THREE.MeshStandardMaterial({ color: 0x8a2a1c, roughness: 0.7 }));
  ribbon.position.set(-38, BOARD + 2, BD / 2 + 13);
  ribbon.rotation.y = 0.14;
  bookGroup.add(ribbon);
  // While the reader holds the notebook (the 3D book in the viewport), its
  // place on the desk is empty; it is back the moment the book lands.
  el.addEventListener('studio:hold', (e) => {
    bookGroup.visible = !(e as CustomEvent<{ away: boolean }>).detail.away;
    studio.invalidate();
  });
  const pose = { lift: 0 };
  const to = (lift: number) =>
    gsap.to(pose, {
      lift,
      duration: studio.reduced() ? 0 : 0.45,
      ease: 'power3.out',
      overwrite: true,
      onUpdate: () => {
        bookGroup.position.y = 64 + pose.lift;
        bookGroup.rotation.z = pose.lift * 0.002;
        studio.invalidate();
      },
    });
  onHover(el, () => to(5), () => to(0));
  return { root, designW: 390, pitch: 0.5, depth: 0 };
}

export function buildPen(kit: Kit, el: HTMLElement): Built {
  const { studio } = kit;
  const root = new THREE.Group();
  const lay = new THREE.Group();
  lay.position.y = 30;
  lay.rotation.y = 0.42; // lying diagonally across the right-hand page
  root.add(lay);
  const shade = blob(kit, 150, 26, 0.55);
  shade.position.set(4, -3.6, 5);
  lay.add(shade);
  const pen = new THREE.Group();
  lay.add(pen);
  const lacquer = new THREE.MeshPhysicalMaterial({ color: 0x15110e, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.08, metalness: 0.2 });
  const part = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.z = -Math.PI / 2; // lathe axis (y) laid along +x
    mesh.position.x = x;
    pen.add(mesh);
    return mesh;
  };
  part(new THREE.CylinderGeometry(4.3, 4.6, 56, 24), lacquer, -38); // cap
  part(new THREE.SphereGeometry(4.3, 20, 12), lacquer, -66);
  part(new THREE.CylinderGeometry(4.9, 4.9, 3.4, 24), kit.brass, -11); // cap band
  part(new THREE.CylinderGeometry(3.4, 4.2, 52, 24), lacquer, 17); // barrel
  part(new THREE.CylinderGeometry(3.6, 3.6, 2.6, 24), kit.brass, 44);
  part(new THREE.CylinderGeometry(2.2, 3.3, 9, 20), lacquer, 50); // grip
  part(new THREE.ConeGeometry(2.3, 13, 20), kit.brass, 61); // nib
  const clip = new THREE.Mesh(new RoundedBoxGeometry(36, 1.4, 2.6, 2, 0.6), kit.brass);
  clip.position.set(-40, 5.2, 0);
  pen.add(clip);
  const s = { roll: 0, hop: 0 };
  const apply = () => {
    pen.rotation.x = s.roll;
    pen.position.set(0, s.hop, s.roll * 3.2);
    studio.invalidate();
  };
  // A nudge: the pen rolls a quarter turn on its clip and rocks back.
  onHover(
    el,
    () => !studio.reduced() && gsap.to(s, { roll: 0.9, hop: 1.5, duration: 0.5, ease: 'power2.out', overwrite: true, onUpdate: apply }),
    () => gsap.to(s, { roll: 0, hop: 0, duration: studio.reduced() ? 0 : 0.9, ease: 'elastic.out(1, 0.55)', overwrite: true, onUpdate: apply }),
  );
  return { root, designW: 118, pitch: 0.5, depth: 120 };
}

/* ----------------------------------------------------------- Headphones */

export function buildHeadphones(kit: Kit, el: HTMLElement): Built {
  const { studio } = kit;
  const root = new THREE.Group();
  const hang = new THREE.Group(); // pivots on the tack
  hang.position.y = 140;
  root.add(hang);
  const body = new THREE.Group();
  body.position.y = -140;
  body.rotation.y = 0.32;
  hang.add(body);
  const pad = new THREE.MeshStandardMaterial({ color: 0x2a1d15, roughness: 0.72 });
  const shell = new THREE.MeshPhysicalMaterial({ color: 0x1b1512, roughness: 0.34, metalness: 0.3, clearcoat: 0.6 });
  const band = new THREE.Mesh(new THREE.TorusGeometry(40, 4.6, 14, 48, Math.PI), pad);
  band.position.y = 92;
  const inner = new THREE.Mesh(new THREE.TorusGeometry(40, 2, 10, 48, Math.PI * 0.86), kit.brass);
  inner.position.y = 92;
  inner.rotation.z = Math.PI * 0.07;
  inner.scale.set(0.93, 0.93, 1.5);
  body.add(band, inner);
  for (const side of [-1, 1]) {
    body.add(rod(V(side * 40, 92, 0), V(side * 40, 62, 0), 1.8, kit.brass));
    const cup = new THREE.Group();
    cup.position.set(side * 40, 42, 0);
    cup.rotation.z = Math.PI / 2;
    const can = new THREE.Mesh(new THREE.CylinderGeometry(21, 22, 13, 40), shell);
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(13, 13, 14.4, 32), kit.brass);
    const cushion = new THREE.Mesh(new THREE.TorusGeometry(16.5, 6, 14, 36), pad);
    cushion.rotation.x = Math.PI / 2;
    cushion.position.y = side * 8; // inside face (cup axis runs along ∓x)
    cup.add(can, plate, cushion);
    body.add(cup);
  }
  // The Blender model replaces this sketch once it loads: steel band and
  // stitched leather cushion, notched sliders, brass fork yokes, oval cups and
  // pads, and a cable with its plug. Modelled in metres, band apex at the
  // origin (on the tack), front towards +z. The sketch stays if it fails.
  void import('three/examples/jsm/loaders/GLTFLoader.js').then(({ GLTFLoader }) => {
    new GLTFLoader().load('/media/models/headphones.glb?v=1', (gltf) => {
      const model = gltf.scene;
      model.scale.setScalar(540);
      model.rotation.y = 0.34; // a little of the outer cup shows
      hang.remove(body);
      hang.add(model);
      studio.invalidate();
    });
  });
  el.style.pointerEvents = 'auto';
  el.addEventListener('pointerenter', (e) => {
    if (e.pointerType === 'touch' || studio.reduced() || gsap.isTweening(hang.rotation)) return;
    // One push, then a damped pendulum back to rest.
    gsap.timeline({ onUpdate: studio.invalidate }).to(hang.rotation, { z: 0.11, duration: 0.28, ease: 'power2.out' }).to(hang.rotation, { z: 0, duration: 2.2, ease: 'elastic.out(1.1, 0.22)' });
  });
  return { root, designW: 122, pitch: 0.04, depth: 30 };
}
