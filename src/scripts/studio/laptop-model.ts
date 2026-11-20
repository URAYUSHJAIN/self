// The desk laptop's body (D-45): the Blender model public/media/models/laptop.glb,
// drawn in its own perspective canvas behind the CSS rig (laptop.css). The
// camera reproduces the frame's CSS perspective and every frame copies the
// rig's live transforms (--view, --yaw, the lid's hinge transition, the cursor
// peek), so the real HTML screen, keys and trackpad sit on the 3D body whether
// the laptop rests closed on the desk or is open. Without WebGL or the model
// the CSS laptop is drawn as before.
import * as THREE from 'three';
import { gsap } from 'gsap';
import { roomEnvironment } from './core';

// Model metres. laptop.css derives every length from its width: depth 0.69,
// lid 0.011 (the model was built to the same ratios).
const W = 0.304;
const LT = W * 0.011;
const LIT = { hemi: 1.0, key: 2.5, rim: 1.15, front: 0.55, env: 0.5 };
const DARK = { hemi: 0.55, key: 0.5, rim: 0.12, front: 0.32, env: 0.26 };

/** CSS frame coordinates (y down) to three (y up). */
const FLIP = new THREE.Matrix4().makeScale(1, -1, 1);
const css = (el: Element) => {
  const t = getComputedStyle(el).transform;
  return new THREE.Matrix4().fromArray(new DOMMatrix(t && t !== 'none' ? t : undefined).toFloat64Array());
};
const shift = (x: number, y: number, z = 0) => new THREE.Matrix4().makeTranslation(x, y, z);

export function mountLaptopModel(root: HTMLElement, reduced: () => boolean) {
  const frame = root.querySelector<HTMLElement>('.lt-frame');
  const rig = root.querySelector<HTMLElement>('.lt');
  const lidEl = root.querySelector<HTMLElement>('.lt-lid');
  const deck = root.querySelector<HTMLElement>('.lt-deck');
  if (!frame || !rig || !lidEl || !deck) return;

  const canvas = document.createElement('canvas');
  canvas.className = 'lt-model';
  canvas.setAttribute('aria-hidden', 'true');
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'default' });
  } catch {
    return;
  }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.setClearColor(0x000000, 0);

  // Same room as the studio layer, so the laptop is lit like its neighbours.
  const scene = new THREE.Scene();
  const env = roomEnvironment();
  scene.environment = env;
  const hemi = new THREE.HemisphereLight(0xffe7c8, 0x4a2610);
  const key = new THREE.DirectionalLight(0xffdcae);
  key.position.set(-0.55, 0.95, 0.85);
  const rim = new THREE.DirectionalLight(0xffa954);
  rim.position.set(0.95, 0.35, 0.45);
  const front = new THREE.DirectionalLight(0xfff1dc);
  front.position.set(0.1, 0.2, 1);
  scene.add(hemi, key, rim, front);
  const light = (v: typeof LIT) => {
    hemi.intensity = v.hemi;
    key.intensity = v.key;
    rim.intensity = v.rim;
    front.intensity = v.front;
    scene.environmentIntensity = v.env;
  };
  const stage = root.closest<HTMLElement>('[data-scene]');
  light(stage?.dataset.lamp === 'off' ? DARK : LIT);

  // Contact shadow (laptop.css .lt-shadow, which would paint over this canvas).
  const shade = document.createElement('canvas');
  shade.width = shade.height = 128;
  const g = shade.getContext('2d')!;
  const grad = g.createRadialGradient(61, 69, 0, 61, 69, 64);
  grad.addColorStop(0, 'rgba(48,28,10,0.36)');
  grad.addColorStop(0.66, 'rgba(48,28,10,0.14)');
  grad.addColorStop(0.78, 'rgba(48,28,10,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const shadowTex = new THREE.CanvasTexture(shade);
  shadowTex.colorSpace = THREE.SRGBColorSpace;
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }),
  );
  const base = new THREE.Group();
  const lid = new THREE.Group();
  for (const o of [shadow, base, lid]) o.matrixAutoUpdate = false;
  scene.add(shadow, base, lid);

  const camera = new THREE.PerspectiveCamera();
  let lw = 0;
  let ld = 0;
  let ready = false;
  let raf = 0;
  let until = 0;
  let last = '';

  const resize = () => {
    lw = frame.clientWidth;
    ld = frame.clientHeight;
    const cw = canvas.offsetWidth;
    const ch = canvas.offsetHeight;
    if (!lw || !ld || !cw || !ch) return;
    let ratio = Math.min(window.devicePixelRatio || 1, 2);
    if (cw * ch * ratio * ratio > 3_000_000) ratio = Math.max(1, Math.sqrt(3_000_000 / (cw * ch)));
    renderer.setPixelRatio(ratio);
    renderer.setSize(cw, ch, false);
    // CSS perspective: an eye at (origin, p) projecting onto the frame plane.
    const fs = getComputedStyle(frame);
    const p = parseFloat(fs.perspective) || lw * 2.7;
    const [ox, oy] = fs.perspectiveOrigin.split(' ').map(parseFloat);
    const near = p * 0.05;
    const s = near / p;
    const x0 = canvas.offsetLeft;
    const y0 = canvas.offsetTop;
    camera.position.set(ox, -oy, p);
    camera.updateMatrixWorld();
    camera.projectionMatrix.makePerspective((x0 - ox) * s, (x0 + cw - ox) * s, (oy - y0) * s, (oy - y0 - ch) * s, near, p * 10);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    last = '';
  };

  // Copy the rig's current (possibly mid-transition) transforms onto the model.
  const draw = () => {
    raf = 0;
    if (!lw || !ld) return;
    const mRig = css(rig);
    const mLid = css(lidEl);
    const sig = `${lw},${ld},${mRig.elements},${mLid.elements}`;
    const now = performance.now();
    if (sig !== last) {
      last = sig;
      until = Math.max(until, now + 120);
      const k = lw / W;
      const atRig = shift(lw / 2, ld).multiply(mRig).multiply(shift(-lw / 2, -ld));
      const atLid = atRig.clone().multiply(shift(lw / 2, 0)).multiply(mLid).multiply(shift(-lw / 2, -ld));
      // glTF (x, y up, z front) to the rig's base plane (x, y front, z up).
      const toBase = new THREE.Matrix4().set(k, 0, 0, lw / 2, 0, 0, k, ld / 2, 0, k, 0, 0, 0, 0, 0, 1);
      // Lid node (hinge at z = 0, outer face at y = LT) to the CSS lid box,
      // whose hinge is its bottom edge and whose screen face is at z = lt.
      const toLid = new THREE.Matrix4().set(k, 0, 0, lw / 2, 0, 0, -k, ld, 0, -k, 0, k * LT, 0, 0, 0, 1);
      // laptop.css .lt-shadow: inset -2% -3% -4% -4%.
      const toShadow = shift(lw * 0.495, ld * 0.51, -0.5).multiply(new THREE.Matrix4().makeScale(lw * 1.07, ld * 1.06, 1));
      base.matrix.copy(FLIP).multiply(atRig).multiply(toBase);
      lid.matrix.copy(FLIP).multiply(atLid).multiply(toLid);
      shadow.matrix.copy(FLIP).multiply(atRig).multiply(toShadow);
      for (const o of [base, lid, shadow]) o.matrixWorldNeedsUpdate = true;
      // The HTML deck (keys, trackpad) paints above this canvas, so it shows
      // only once the lid has lifted past the line of sight.
      const a = (Math.atan2(mLid.elements[6], mLid.elements[5]) * 180) / Math.PI + 180;
      const phi = a > 270 ? a - 360 : a;
      deck.style.opacity = String(Math.min(1, Math.max(0, (phi - 22) / 14)));
      renderer.render(scene, camera);
      if (!ready) {
        ready = true;
        root.classList.add('has-model');
      }
    }
    if (now < until) raf = requestAnimationFrame(draw);
  };
  const kick = (ms = 160) => {
    until = Math.max(until, performance.now() + ms);
    if (!raf) raf = requestAnimationFrame(draw);
  };

  void import('three/examples/jsm/loaders/GLTFLoader.js').then(({ GLTFLoader }) => {
    // Bump ?v= whenever the model is re-exported, so browsers drop the cached copy.
    new GLTFLoader().load('/media/models/laptop.glb?v=2', (gltf) => {
      const lidNode = gltf.scene.getObjectByName('Lid');
      if (!lidNode) return;
      lidNode.removeFromParent();
      lidNode.position.set(0, 0, 0);
      lidNode.rotation.set(0, 0, 0);
      lid.add(lidNode);
      base.add(gltf.scene);
      frame.prepend(canvas);
      resize();
      kick();

      new ResizeObserver(() => {
        resize();
        kick();
      }).observe(frame);
      // Lid and view transitions, the cursor peek and hover lift all land here.
      new MutationObserver(() => kick()).observe(root, { attributes: true, attributeFilter: ['class', 'style', 'data-lid'] });
      root.addEventListener('transitionrun', () => kick(1000));
      for (const type of ['pointerover', 'pointerout', 'focusin', 'focusout']) root.addEventListener(type, () => kick(500));
      window.addEventListener('shelf:lamp', (event) => {
        const on = (event as CustomEvent<{ on: boolean }>).detail.on;
        const state = { hemi: hemi.intensity, key: key.intensity, rim: rim.intensity, front: front.intensity, env: scene.environmentIntensity };
        gsap.to(state, {
          ...(on ? LIT : DARK),
          duration: reduced() ? 0 : 0.62,
          ease: 'sine.inOut',
          onUpdate: () => {
            light(state);
            last = '';
            kick();
          },
        });
      });
      window.addEventListener('pagehide', (event) => {
        if (event.persisted) return;
        cancelAnimationFrame(raf);
        renderer.dispose();
      });
    });
  });
}
