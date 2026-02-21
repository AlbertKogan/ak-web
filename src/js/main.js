// Skip-link focus management
const skipLink = document.querySelector('.skip-link');
if (skipLink) {
  skipLink.addEventListener('click', (e) => {
    const target = document.querySelector(skipLink.getAttribute('href'));
    if (target) {
      target.setAttribute('tabindex', '-1');
      target.focus();
    }
  });
}

// 3D head — progressive enhancement
function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

const motionOk = !matchMedia('(prefers-reduced-motion: reduce)').matches;

if (hasWebGL() && motionOk) {
  const container = document.getElementById('gl-container');
  if (container) {
    import('./head-3d.js').then((m) => m.init(container));
  }
}
