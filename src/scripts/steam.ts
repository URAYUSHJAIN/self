// Mug steam: a fragment shader of rising wisps. Each wisp leaves the coffee
// as a thin filament, curls through domain-warped noise, widens and breaks
// into puffs as it cools; the lamp side is warmer. GSAP owns time and
// intensity, so frames are drawn only while a puff plays; at rest a single
// faint still frame stays. Without WebGL the SVG wisps remain (returns null).
import { gsap } from 'gsap';

const VERT = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
const FRAG = `precision mediump float;
uniform vec2 r;uniform float t;uniform float a;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f*=f*(3.-2.*f);
return mix(mix(h(i),h(i+vec2(1.,0.)),f.x),mix(h(i+vec2(0.,1.)),h(i+1.),f.x),f.y);}
const mat2 R=mat2(.8,.6,-.6,.8);
float fbm(vec2 p){float v=0.,w=.5;for(int k=0;k<5;k++){v+=w*n(p);p=R*p*2.03;w*=.5;}return v;}
float wisp(float x,float c,float w){return exp(-pow((x-c)/w,2.));}
void main(){
  vec2 uv=gl_FragCoord.xy/r;float y=uv.y;
  // Domain warp: the air curls the column more the higher it rises.
  vec2 p=vec2(uv.x*2.2,y*1.8-t*.32);
  vec2 q=vec2(fbm(p+vec2(0.,t*.12)),fbm(p+vec2(5.2,1.3-t*.08)));
  float x=uv.x+(q.x-.5)*(.06+.62*y*y)+(q.y-.5)*.05;
  float spread=.018+.12*y;
  float s=wisp(x,.38+.04*sin(y*7.+t*.8),spread)
         +.8*wisp(x,.51-.035*sin(y*6.-t*.7),spread*1.15)
         +.55*wisp(x,.63+.03*sin(y*5.+t*.5),spread*.9);
  // Break-up: dense filaments low, torn puffs higher.
  float d=fbm(vec2(x*7.,y*4.2-t*.95)+q*1.6);
  d=mix(1.,smoothstep(.32,.78,d),smoothstep(.08,.5,y));
  float dens=s*d*smoothstep(0.,.1,y)*(1.-smoothstep(.32,.95,y))*a*mix(1.2,.65,y);
  float al=clamp(dens*.58,0.,.62);
  vec3 col=mix(vec3(.93,.92,.9),vec3(1.,.94,.84),smoothstep(.35,.85,uv.x));
  gl_FragColor=vec4(col*al,al);
}`;

export function initSteam(canvas: HTMLCanvasElement, reduced: () => boolean) {
  const gl = canvas.getContext('webgl', { antialias: false });
  if (!gl) return null;
  const prog = gl.createProgram()!;
  for (const [type, src] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, FRAG]] as const) {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    gl.attachShader(prog, s);
  }
  gl.bindAttribLocation(prog, 0, 'p');
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const u = (name: string) => gl.getUniformLocation(prog, name);
  const [uR, uT, uA] = [u('r'), u('t'), u('a')];

  const REST = 0.35;
  const state = { t: 2, a: REST };
  const draw = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(canvas.clientWidth * dpr);
    const h = Math.round(canvas.clientHeight * dpr);
    if (!w || !h) return; // hidden on narrow screens
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
    gl.uniform2f(uR, w, h);
    gl.uniform1f(uT, state.t);
    gl.uniform1f(uA, state.a);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  draw();
  window.addEventListener('resize', draw);

  // One puff: about five seconds of rising smoke, then back to the still rest frame.
  return function play() {
    if (reduced() || gsap.isTweening(state)) return;
    gsap.timeline({ onUpdate: draw })
      .to(state, { t: '+=5', duration: 5.2, ease: 'none' }, 0)
      .to(state, { keyframes: { '25%': { a: 1 }, '70%': { a: 0.9 }, '100%': { a: REST } }, duration: 5.2, easeEach: 'sine.inOut' }, 0);
  };
}
