// ── SVG Beam Overlay ─────────────────────────────────────────────────────────
const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
svg.style.cssText = "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:45;overflow:visible;";

// Glow filter
svg.innerHTML = `
  <defs>
    <filter id="beam-glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
`;
document.body.appendChild(svg);

// ── "I'm easy to find" → beams to social links ───────────────────────────────
const trigger      = document.querySelector(".hero__trigger");
const footerSocials = document.querySelector(".footer-socials");
const socialLinks  = document.querySelectorAll(".social-link");

let activeBeams = [];
let fadeRafs = [];
let animRafs = [];

function getRect(el) {
  return el.getBoundingClientRect();
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function drawBeams() {
  clearBeams(true);

  const tRect = getRect(trigger.querySelector(".hero__trigger-text"));
  // Origin: bottom-center of trigger text
  const ox = tRect.left + tRect.width / 2;
  const oy = tRect.bottom;

  socialLinks.forEach((link, i) => {
    const lRect = getRect(link);
    // Destination: top-center of each social link, with a small gap
    const dx = lRect.left + lRect.width / 2;
    const dy = lRect.top - 8;

    const len = Math.hypot(dx - ox, dy - oy);

    // Line
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", ox);
    line.setAttribute("y1", oy);
    line.setAttribute("x2", dx);
    line.setAttribute("y2", dy);
    line.setAttribute("stroke", "rgba(213, 197, 167, 0.28)");
    line.setAttribute("stroke-width", "0.75");
    line.setAttribute("stroke-dasharray", len);
    line.setAttribute("stroke-dashoffset", len);
    line.setAttribute("filter", "url(#beam-glow)");
    line.style.opacity = "1";

    // Terminal dot at destination
    const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    dot.setAttribute("cx", dx);
    dot.setAttribute("cy", dy);
    dot.setAttribute("r", "1.5");
    dot.setAttribute("fill", "rgba(213, 197, 167, 0.0)");
    dot.setAttribute("filter", "url(#beam-glow)");

    svg.appendChild(line);
    svg.appendChild(dot);
    activeBeams.push(line, dot);

    const DRAW_MS   = 380;
    const STAGGER   = 55;
    const DOT_DELAY = DRAW_MS * 0.85;
    const startAt   = performance.now() + i * STAGGER;

    function animLine(now) {
      const t = Math.min((now - startAt) / DRAW_MS, 1);
      if (t < 0) { animRafs.push(requestAnimationFrame(animLine)); return; }
      line.setAttribute("stroke-dashoffset", len * (1 - easeOutCubic(t)));
      if (t < 1) animRafs.push(requestAnimationFrame(animLine));
    }
    function animDot(now) {
      const t = Math.min((now - startAt - DOT_DELAY) / 120, 1);
      if (t < 0) { animRafs.push(requestAnimationFrame(animDot)); return; }
      dot.setAttribute("fill", `rgba(213, 197, 167, ${easeOutCubic(t) * 0.7})`);
      if (t < 1) animRafs.push(requestAnimationFrame(animDot));
    }

    animRafs.push(requestAnimationFrame(animLine));
    animRafs.push(requestAnimationFrame(animDot));
  });
}

function clearBeams(immediate = false) {
  animRafs.forEach(cancelAnimationFrame);
  animRafs = [];
  fadeRafs.forEach(cancelAnimationFrame);
  fadeRafs = [];

  const toRemove = [...activeBeams];
  activeBeams = [];

  if (immediate || toRemove.length === 0) {
    toRemove.forEach(el => el.remove());
    return;
  }

  const FADE_MS = 260;
  const startAt = performance.now();

  function fadeOut(now) {
    const t = Math.min((now - startAt) / FADE_MS, 1);
    const op = 1 - easeOutCubic(t);
    toRemove.forEach(el => { el.style.opacity = op; });
    if (t < 1) {
      fadeRafs.push(requestAnimationFrame(fadeOut));
    } else {
      toRemove.forEach(el => el.remove());
    }
  }
  fadeRafs.push(requestAnimationFrame(fadeOut));
}


if (trigger && footerSocials) {
  trigger.addEventListener("mouseenter", () => {
    footerSocials.classList.add("is-active");
    drawBeams();
  });
  trigger.addEventListener("mouseleave", () => {
    footerSocials.classList.remove("is-active");
    clearBeams();
  });
}
