import { Renderer, Camera, Transform, Program, Sphere, Mesh } from 'ogl';

let renderer, scene, camera, mesh, raf;
let target = { x: 0, y: 0 };

const vertex = /* glsl */ `
  attribute vec3 position;
  uniform mat4 modelViewMatrix;
  uniform mat4 projectionMatrix;
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragment = /* glsl */ `
  precision highp float;
  uniform vec3 uColor;
  void main() {
    gl_FragColor = vec4(uColor, 1.0);
  }
`;

function hexToRGB(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return [r, g, b];
}

function createWireframeIndices(geometry) {
  const pos = geometry.attributes.position;
  const index = geometry.attributes.index;
  const edges = new Set();
  const wireIndices = [];

  function addEdge(a, b) {
    const key = Math.min(a, b) + ':' + Math.max(a, b);
    if (!edges.has(key)) {
      edges.add(key);
      wireIndices.push(a, b);
    }
  }

  if (index) {
    const idx = index.data;
    for (let i = 0; i < idx.length; i += 3) {
      addEdge(idx[i], idx[i + 1]);
      addEdge(idx[i + 1], idx[i + 2]);
      addEdge(idx[i + 2], idx[i]);
    }
  } else {
    const count = pos.data.length / pos.size;
    for (let i = 0; i < count; i += 3) {
      addEdge(i, i + 1);
      addEdge(i + 1, i + 2);
      addEdge(i + 2, i);
    }
  }

  delete geometry.attributes.index;
  geometry.setIndex({ data: new Uint16Array(wireIndices) });
}

export function init(container) {
  const accent = getComputedStyle(document.documentElement)
    .getPropertyValue('--color-accent').trim() || '#00d4aa';
  const color = hexToRGB(accent);

  renderer = new Renderer({ dpr: 2, alpha: true, antialias: true });
  const gl = renderer.gl;
  gl.clearColor(0, 0, 0, 0);

  container.appendChild(gl.canvas);
  container.classList.add('is-active');

  camera = new Camera(gl, { fov: 35 });
  camera.position.set(0, 0, 4.5);

  scene = new Transform();

  const geometry = new Sphere(gl, {
    radius: 1,
    widthSegments: 16,
    heightSegments: 12,
  });

  createWireframeIndices(geometry);

  const program = new Program(gl, {
    vertex,
    fragment,
    uniforms: {
      uColor: { value: color },
    },
  });

  mesh = new Mesh(gl, { geometry, program, mode: gl.LINES });
  mesh.setParent(scene);

  function resize() {
    const { width, height } = container.getBoundingClientRect();
    renderer.setSize(width, height);
    camera.perspective({ aspect: width / height });
  }

  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  function onMouseMove(e) {
    target.x = (e.clientX / window.innerWidth) * 2 - 1;
    target.y = (e.clientY / window.innerHeight) * 2 - 1;
  }
  window.addEventListener('mousemove', onMouseMove);

  function update() {
    raf = requestAnimationFrame(update);
    mesh.rotation.y += (target.x * 0.8 - mesh.rotation.y) * 0.05;
    mesh.rotation.x += (-target.y * 0.5 - mesh.rotation.x) * 0.05;
    renderer.render({ scene, camera });
  }
  update();

  return function destroy() {
    cancelAnimationFrame(raf);
    window.removeEventListener('mousemove', onMouseMove);
    ro.disconnect();
    gl.canvas.remove();
    container.classList.remove('is-active');
  };
}
