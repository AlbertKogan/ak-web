// ==========================================
// Raw WebGL wireframe head — zero dependencies
// ==========================================

// ---- Shader sources ----
const vsrc = `
  attribute vec3 aPos;
  uniform mat4 uProj;
  uniform mat4 uView;
  uniform mat4 uModel;
  void main() {
    gl_Position = uProj * uView * uModel * vec4(aPos, 1.0);
    gl_PointSize = 2.0;
  }
`;

const fsrc = `
  precision mediump float;
  uniform vec4 uColor;
  void main() {
    gl_FragColor = uColor;
  }
`;

// ---- Math helpers ----
function mat4() {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

function perspective(fov, aspect, near, far) {
  const m = new Float32Array(16);
  const f = 1 / Math.tan(fov / 2);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

function lookAt(eye, center, up) {
  const m = new Float32Array(16);
  let zx = eye[0] - center[0],
    zy = eye[1] - center[1],
    zz = eye[2] - center[2];
  let l = Math.sqrt(zx * zx + zy * zy + zz * zz);
  zx /= l;
  zy /= l;
  zz /= l;
  let xx = up[1] * zz - up[2] * zy,
    xy = up[2] * zx - up[0] * zz,
    xz = up[0] * zy - up[1] * zx;
  l = Math.sqrt(xx * xx + xy * xy + xz * xz);
  xx /= l;
  xy /= l;
  xz /= l;
  const yx = zy * xz - zz * xy,
    yy = zz * xx - zx * xz,
    yz = zx * xy - zy * xx;
  m[0] = xx; m[1] = yx; m[2] = zx;
  m[4] = xy; m[5] = yy; m[6] = zy;
  m[8] = xz; m[9] = yz; m[10] = zz;
  m[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  m[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  m[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  m[15] = 1;
  return m;
}

function mulMat4(a, b) {
  const r = new Float32Array(16);
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      r[i * 4 + j] =
        a[j] * b[i * 4] +
        a[4 + j] * b[i * 4 + 1] +
        a[8 + j] * b[i * 4 + 2] +
        a[12 + j] * b[i * 4 + 3];
    }
  return r;
}

function rotX(a) {
  const m = mat4();
  const c = Math.cos(a), s = Math.sin(a);
  m[5] = c; m[6] = s; m[9] = -s; m[10] = c;
  return m;
}

function rotY(a) {
  const m = mat4();
  const c = Math.cos(a), s = Math.sin(a);
  m[0] = c; m[2] = -s; m[8] = s; m[10] = c;
  return m;
}

function translate(x, y, z) {
  const m = mat4();
  m[12] = x; m[13] = y; m[14] = z;
  return m;
}

// ---- Geometry generators ----
function makeIcosphere(radius, subdivisions) {
  const t = (1 + Math.sqrt(5)) / 2;
  let verts = [
    -1, t, 0, 1, t, 0, -1, -t, 0, 1, -t, 0,
    0, -1, t, 0, 1, t, 0, -1, -t, 0, 1, -t,
    t, 0, -1, t, 0, 1, -t, 0, -1, -t, 0, 1,
  ];
  let faces = [
    0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11,
    1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
    3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9,
    4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1,
  ];

  const midCache = {};
  function addMidPoint(a, b) {
    const key = Math.min(a, b) + ':' + Math.max(a, b);
    if (midCache[key] !== undefined) return midCache[key];
    const mx = (verts[a * 3] + verts[b * 3]) / 2;
    const my = (verts[a * 3 + 1] + verts[b * 3 + 1]) / 2;
    const mz = (verts[a * 3 + 2] + verts[b * 3 + 2]) / 2;
    const idx = verts.length / 3;
    verts.push(mx, my, mz);
    midCache[key] = idx;
    return idx;
  }

  for (let s = 0; s < subdivisions; s++) {
    const newFaces = [];
    for (let i = 0; i < faces.length; i += 3) {
      const a = faces[i], b = faces[i + 1], c = faces[i + 2];
      const ab = addMidPoint(a, b), bc = addMidPoint(b, c), ca = addMidPoint(c, a);
      newFaces.push(a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca);
    }
    faces = newFaces;
  }

  for (let i = 0; i < verts.length; i += 3) {
    const l = Math.sqrt(verts[i] * verts[i] + verts[i + 1] * verts[i + 1] + verts[i + 2] * verts[i + 2]);
    verts[i] = (verts[i] / l) * radius;
    verts[i + 1] = (verts[i + 1] / l) * radius;
    verts[i + 2] = (verts[i + 2] / l) * radius;
  }

  const edgeSet = new Set();
  const lines = [];
  for (let i = 0; i < faces.length; i += 3) {
    const pairs = [[faces[i], faces[i + 1]], [faces[i + 1], faces[i + 2]], [faces[i + 2], faces[i]]];
    for (const [a, b] of pairs) {
      const key = Math.min(a, b) + ':' + Math.max(a, b);
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        lines.push(verts[a * 3], verts[a * 3 + 1], verts[a * 3 + 2], verts[b * 3], verts[b * 3 + 1], verts[b * 3 + 2]);
      }
    }
  }
  return new Float32Array(lines);
}

function makeCylinder(rTop, rBot, h, seg, yOff) {
  const lines = [];
  for (let i = 0; i < seg; i++) {
    const a1 = (i / seg) * Math.PI * 2, a2 = ((i + 1) / seg) * Math.PI * 2;
    const tx1 = Math.cos(a1) * rTop, tz1 = Math.sin(a1) * rTop;
    const tx2 = Math.cos(a2) * rTop, tz2 = Math.sin(a2) * rTop;
    const bx1 = Math.cos(a1) * rBot, bz1 = Math.sin(a1) * rBot;
    const bx2 = Math.cos(a2) * rBot, bz2 = Math.sin(a2) * rBot;
    const yt = h / 2 + yOff, yb = -h / 2 + yOff;
    lines.push(tx1, yt, tz1, tx2, yt, tz2);
    lines.push(bx1, yb, bz1, bx2, yb, bz2);
    lines.push(tx1, yt, tz1, bx1, yb, bz1);
  }
  return new Float32Array(lines);
}

function makeTorus(R, r, seg, tubeSeg) {
  const lines = [];
  for (let i = 0; i < seg; i++) {
    for (let j = 0; j < tubeSeg; j++) {
      const a1 = (i / seg) * Math.PI * 2, a2 = ((i + 1) / seg) * Math.PI * 2;
      const b1 = (j / tubeSeg) * Math.PI * 2, b2 = ((j + 1) / tubeSeg) * Math.PI * 2;
      function pt(a, b) {
        return [(R + r * Math.cos(b)) * Math.cos(a), r * Math.sin(b), (R + r * Math.cos(b)) * Math.sin(a)];
      }
      const p1 = pt(a1, b1), p2 = pt(a2, b1), p3 = pt(a1, b2);
      lines.push(...p1, ...p2);
      lines.push(...p1, ...p3);
    }
  }
  return new Float32Array(lines);
}

function makeBox(w, h, d, ox, oy, oz) {
  const x = w / 2, y = h / 2, z = d / 2;
  const corners = [
    [-x + ox, y + oy, z + oz], [x + ox, y + oy, z + oz], [x + ox, -y + oy, z + oz], [-x + ox, -y + oy, z + oz],
    [-x + ox, y + oy, -z + oz], [x + ox, y + oy, -z + oz], [x + ox, -y + oy, -z + oz], [-x + ox, -y + oy, -z + oz],
  ];
  const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
  const lines = [];
  for (const [a, b] of edges) lines.push(...corners[a], ...corners[b]);
  return new Float32Array(lines);
}

function makeParticles(count, spread) {
  const pts = [];
  for (let i = 0; i < count; i++) {
    pts.push((Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread);
  }
  return new Float32Array(pts);
}

// ---- Main init ----
export function init(container) {
  const canvas = document.createElement('canvas');
  container.insertBefore(canvas, container.firstChild);

  const gl =
    canvas.getContext('webgl', { antialias: true, alpha: true }) ||
    canvas.getContext('experimental-webgl', { antialias: true, alpha: true });

  if (!gl) return;

  // Compile shaders
  function compileShader(src, type) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  }

  const prog = gl.createProgram();
  gl.attachShader(prog, compileShader(vsrc, gl.VERTEX_SHADER));
  gl.attachShader(prog, compileShader(fsrc, gl.FRAGMENT_SHADER));
  gl.linkProgram(prog);
  gl.useProgram(prog);

  const aPos = gl.getAttribLocation(prog, 'aPos');
  const uProj = gl.getUniformLocation(prog, 'uProj');
  const uView = gl.getUniformLocation(prog, 'uView');
  const uModel = gl.getUniformLocation(prog, 'uModel');
  const uColor = gl.getUniformLocation(prog, 'uColor');

  gl.enableVertexAttribArray(aPos);

  // Build geometry
  const geoData = {
    cranium: makeIcosphere(2.2, 1),
    jaw: makeCylinder(1.2, 0.8, 1.5, 6, -2.2),
    neck: makeCylinder(0.6, 0.8, 1.5, 8, -3.5),
    visor: makeBox(2.6, 0.4, 1.8, 0, 0.2, 1.2),
    ring1: makeTorus(3.5, 0.02, 60, 8),
    ring2: makeTorus(4.0, 0.02, 60, 8),
    particles: makeParticles(200, 10),
  };

  function createBuffer(data) {
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return { buf, count: data.length / 3 };
  }

  const geos = {};
  for (const [key, data] of Object.entries(geoData)) {
    geos[key] = createBuffer(data);
  }

  function drawLines(geo, model, color) {
    gl.bindBuffer(gl.ARRAY_BUFFER, geo.buf);
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
    gl.uniformMatrix4fv(uModel, false, model);
    gl.uniform4fv(uColor, color);
    gl.drawArrays(gl.LINES, 0, geo.count);
  }

  function drawPoints(geo, model, color) {
    gl.bindBuffer(gl.ARRAY_BUFFER, geo.buf);
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
    gl.uniformMatrix4fv(uModel, false, model);
    gl.uniform4fv(uColor, color);
    gl.drawArrays(gl.POINTS, 0, geo.count);
  }

  // Interaction
  let mouseX = 0, mouseY = 0;
  function onMouseMove(e) {
    mouseX = (e.clientX / window.innerWidth) * 2 - 1;
    mouseY = (e.clientY / window.innerHeight) * 2 - 1;
  }
  document.addEventListener('mousemove', onMouseMove);

  // Resize
  function resize() {
    const { clientWidth: w, clientHeight: h } = container;
    const dpr = Math.min(window.devicePixelRatio, 2);
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  // Colors
  const cCyan = [0.133, 0.827, 0.933, 0.3];
  const cMagenta = [0.851, 0.275, 0.937, 0.15];
  const cParticle = [1, 1, 1, 0.4];

  // Render loop
  let headRx = 0, headRy = 0;
  let ring1Rz = 0, ring2Rz = 0;
  let raf;
  const startTime = performance.now();

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.enable(gl.DEPTH_TEST);

  function frame() {
    raf = requestAnimationFrame(frame);

    const t = (performance.now() - startTime) / 1000;
    const aspect = canvas.width / canvas.height;

    const proj = perspective((45 * Math.PI) / 180, aspect, 0.1, 100);
    const view = lookAt([0, 0, 12], [0, 0, 0], [0, 1, 0]);

    gl.uniformMatrix4fv(uProj, false, proj);
    gl.uniformMatrix4fv(uView, false, view);

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Smooth follow mouse
    headRy += (mouseX * 0.8 - headRy) * 0.05;
    headRx += (-mouseY * 0.5 - headRx) * 0.05;

    const bob = Math.sin(t * 0.5) * 0.1;
    const headModel = mulMat4(translate(0, bob, 0), mulMat4(rotY(headRy), rotX(headRx)));

    // Head parts
    drawLines(geos.cranium, headModel, cCyan);
    drawLines(geos.jaw, headModel, cCyan);
    drawLines(geos.neck, headModel, cCyan);

    // Visor — pulsing
    const visorAlpha = 0.4 + Math.sin(t * 3) * 0.2;
    drawLines(geos.visor, headModel, [0.133, 0.827, 0.933, visorAlpha]);

    // Rings
    ring1Rz += 0.002;
    ring2Rz -= 0.003;
    const ring1Model = mulMat4(headModel, mulMat4(rotX(Math.PI / 2), rotY(ring1Rz)));
    const ring2Model = mulMat4(headModel, mulMat4(rotX(Math.PI / 1.8), mulMat4(rotY(Math.PI / 6), rotY(ring2Rz))));
    drawLines(geos.ring1, ring1Model, cMagenta);
    drawLines(geos.ring2, ring2Model, cMagenta);

    // Particles
    const particleModel = rotY(t * 0.05);
    drawPoints(geos.particles, particleModel, cParticle);
  }

  frame();

  // Return cleanup function
  return function destroy() {
    cancelAnimationFrame(raf);
    document.removeEventListener('mousemove', onMouseMove);
    ro.disconnect();
    canvas.remove();
  };
}
