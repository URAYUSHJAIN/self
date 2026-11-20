// The desk notebook's leather cover, painted once for both places it appears:
// the closed diary lying on the desk (studio layer) and the 3D book's own
// cover (diary.ts). Drawn at 1200 px wide in the book's page aspect, then
// scaled to the requested width. Fonts are the site's system stacks.

const W = 1200;
const H = Math.round(W * 1.377);

// Deterministic speckle: the same grain on every render.
const rand = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

/** Strap position as a fraction of the cover width (front cover: near the opening edge). */
export const STRAP = { x: (W - 170) / W, w: 46 / W };

export function paintCover(front: boolean, width = W) {
  const s = width / W;
  const c = document.createElement('canvas');
  c.width = Math.round(W * s);
  c.height = Math.round(H * s);
  const ctx = c.getContext('2d')!;
  ctx.scale(s, s);
  const css = getComputedStyle(document.documentElement);
  const serif = css.getPropertyValue('--serif').trim() || 'Georgia, serif';

  const g = ctx.createRadialGradient(W * 0.45, H * 0.4, 100, W / 2, H / 2, H * 0.75);
  g.addColorStop(0, '#6e4630');
  g.addColorStop(1, '#2f1c11');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const r = rand(front ? 7 : 11);
  for (let i = 0; i < 9000; i++) {
    ctx.fillStyle = r() > 0.5 ? 'rgba(0,0,0,0.12)' : 'rgba(255,220,180,0.05)';
    ctx.fillRect(r() * W, r() * H, 2, 2);
  }
  // Saddle stitching inset from the edge.
  ctx.strokeStyle = 'rgba(232,200,150,0.55)';
  ctx.lineWidth = 4;
  ctx.setLineDash([22, 14]);
  ctx.strokeRect(54, 54, W - 108, H - 108);
  ctx.setLineDash([]);
  // Elastic strap near the opening edge.
  const sx = front ? W * STRAP.x : 124;
  const sg = ctx.createLinearGradient(sx, 0, sx + 46, 0);
  sg.addColorStop(0, '#1b100a');
  sg.addColorStop(0.5, '#3a2618');
  sg.addColorStop(1, '#140b06');
  ctx.fillStyle = sg;
  ctx.fillRect(sx, 0, 46, H);
  if (front) {
    // Foil-stamped title with a pressed shadow.
    const foil = ctx.createLinearGradient(0, H * 0.36, 0, H * 0.46);
    foil.addColorStop(0, '#f6dc96');
    foil.addColorStop(0.5, '#c79a45');
    foil.addColorStop(1, '#f0d088');
    ctx.textAlign = 'center';
    ctx.font = `700 96px ${serif}`;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillText('The desk', W / 2 - 60 + 2, H * 0.4 + 3);
    ctx.fillText('notebook', W / 2 - 60 + 2, H * 0.4 + 113);
    ctx.fillStyle = foil;
    ctx.fillText('The desk', W / 2 - 60, H * 0.4);
    ctx.fillText('notebook', W / 2 - 60, H * 0.4 + 110);
    ctx.font = `italic 44px ${serif}`;
    ctx.fillStyle = 'rgba(240,210,150,0.85)';
    ctx.fillText('Ayush Jain', W / 2 - 60, H * 0.4 + 210);
  }
  return c;
}
