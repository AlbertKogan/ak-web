import { Renderer, Program, Mesh, Triangle } from "ogl";

const vert = /* glsl */ `
  attribute vec2 position;
  varying vec2 vUv;
  void main() {
    vUv = position * 0.5 + 0.5;
    gl_Position = vec4(position, 0.0, 1.0);
  }
`;

const frag = /* glsl */ `
  precision highp float;

  uniform vec2  uResolution;
  uniform vec2  uMouse;       // in pixels, smoothed
  uniform float uTime;

  varying vec2 vUv;

  void main() {
    vec2 px = vUv * uResolution;

    // ── Warp ───────────────────────────────────────────────────
    float WARP_R  = 220.0;   // influence radius in px
    float WARP_STR = 14.0;   // displacement strength in px

    vec2  toMouse  = px - uMouse;
    float mDist    = length(toMouse);
    float warp     = WARP_STR * exp(-mDist * mDist / (WARP_R * WARP_R));
    vec2  warpedPx = px + normalize(toMouse + 1e-4) * warp;

    // ── Dot grid ───────────────────────────────────────────────
    float GRID   = 52.0;
    float DOT_R  = 1.6;     // pixel radius of each dot

    vec2  cell   = fract(warpedPx / GRID) - 0.5;  // -0.5..0.5
    float dotPx  = length(cell) * GRID;
    float dot    = 1.0 - smoothstep(DOT_R - 0.5, DOT_R + 0.8, dotPx);

    // ── Glow ───────────────────────────────────────────────────
    float GLOW_R  = 240.0;
    float glow    = exp(-mDist * mDist / (GLOW_R * GLOW_R));

    // warm parchment: #d5c5a7
    vec3 warmTone  = vec3(0.835, 0.773, 0.655);
    vec3 bgColor   = vec3(0.020, 0.020, 0.020);

    // dots always visible; subtle warm shift near mouse
    float dotBright = 0.30 + glow * 0.18;
    vec3  dotColor  = mix(vec3(0.38), warmTone, glow * 0.5);

    vec3 color = bgColor;
    color += dotColor * dot * dotBright;
    // very soft ambient halo
    color += warmTone * glow * 0.012;

    gl_FragColor = vec4(color, 1.0);
  }
`;

// ── Setup ────────────────────────────────────────────────────────────────────
const DPR = Math.min(window.devicePixelRatio, 2);
const renderer = new Renderer({ alpha: false, antialias: false, dpr: DPR });
const gl = renderer.gl;

const canvas = gl.canvas;
canvas.id = "bg-canvas";
canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;z-index:-10;";
document.body.prepend(canvas);

const geometry = new Triangle(gl);
const program = new Program(gl, {
  vertex: vert,
  fragment: frag,
  uniforms: {
    uResolution: { value: [gl.canvas.width, gl.canvas.height] },
    uMouse:      { value: [gl.canvas.width / 2, gl.canvas.height / 2] },
    uTime:       { value: 0 },
  },
});
const mesh = new Mesh(gl, { geometry, program });

// ── Resize ───────────────────────────────────────────────────────────────────
function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  program.uniforms.uResolution.value = [gl.canvas.width, gl.canvas.height];
}
window.addEventListener("resize", resize);
resize();

// ── Mouse ────────────────────────────────────────────────────────────────────
const mouse = { x: window.innerWidth / 2 * DPR, y: window.innerHeight / 2 * DPR };

let rafId = null;

window.addEventListener("mousemove", (e) => {
  mouse.x = e.clientX * DPR;
  mouse.y = (window.innerHeight - e.clientY) * DPR;

  if (!rafId) rafId = requestAnimationFrame(frame);
});

// ── Loop ─────────────────────────────────────────────────────────────────────
function frame(t) {
  rafId = null;

  program.uniforms.uTime.value  = t * 0.001;
  program.uniforms.uMouse.value = [mouse.x, mouse.y];

  renderer.render({ scene: mesh });
}

// Initial render so dots are visible before any mouse move
renderer.render({ scene: mesh });
