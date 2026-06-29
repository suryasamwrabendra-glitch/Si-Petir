/**
 * SI PETIR — main.js
 * Pipeline state machine, canvas animations, SVG generation,
 * live data simulation. Vanilla JS, zero dependencies.
 */

'use strict';

/* ══════════════════════════════════════════════════════════════
   DATA CONSTANTS
══════════════════════════════════════════════════════════════ */
const TOTAL_IMK_MONITORED  = 1247;
const FLAGGED_THIS_WEEK    = 34;
const DISPATCHES_TODAY     = 8;
const COVERAGE_BASELINE    = 1.94;   // percent
const COVERAGE_WITH_PETIR  = 43.7;   // percent
const MODEL_ACCURACY       = 91;     // percent
const MODEL_MSE            = 0.0073;
const RUL_CURRENT          = 67;     // percent
const COST_SAVED           = 3800000; // Rupiah
const SENSOR_INTERVAL_MS   = 300;

/* ══════════════════════════════════════════════════════════════
   STATE MACHINE
══════════════════════════════════════════════════════════════ */
let currentStep = 0;
const TOTAL_STEPS = 7;

// Track which step-specific animations are running
const stepCleanup = [];   // array of cleanup functions per step
let activeCleanup = null; // cleanup fn for current step

/* ══════════════════════════════════════════════════════════════
   UTILITY HELPERS
══════════════════════════════════════════════════════════════ */

/**
 * Format a number as Indonesian locale string.
 * e.g. 1247 → "1.247"
 */
function fmtID(n) {
  return Math.round(n).toLocaleString('id-ID');
}

/**
 * Lerp between two values.
 */
function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Clamp value between min and max.
 */
function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

/**
 * Animate a number counting up from 0 to target.
 * @param {HTMLElement} el - target element
 * @param {number} target  - final value
 * @param {number} dur     - duration in ms
 * @param {Function} fmt   - optional formatter
 */
function countUp(el, target, dur = 1200, fmt = fmtID) {
  if (!el) return;
  const start = performance.now();
  function tick(now) {
    const t = clamp((now - start) / dur, 0, 1);
    const ease = 1 - Math.pow(1 - t, 3); // ease-out cubic
    el.textContent = fmt(lerp(0, target, ease));
    if (t < 1) requestAnimationFrame(tick);
    else el.textContent = fmt(target);
  }
  requestAnimationFrame(tick);
}

/* ══════════════════════════════════════════════════════════════
   PANEL NAVIGATION — STATE MACHINE CORE
══════════════════════════════════════════════════════════════ */

/**
 * Navigate to a specific step.
 * Handles: panel swap, nav highlight, cleanup of previous step,
 * and initialization of next step.
 */
function goToStep(step) {
  if (step === currentStep && step !== 0) return;

  // Run cleanup for the previous step
  if (activeCleanup) {
    activeCleanup();
    activeCleanup = null;
  }

  const prevStep = currentStep;
  currentStep = step;

  // ── Update sidebar nav buttons
  document.querySelectorAll('.nav-step').forEach((btn, i) => {
    btn.classList.remove('active', 'completed');
    btn.removeAttribute('aria-current');
    if (i === step) {
      btn.classList.add('active');
      btn.setAttribute('aria-current', 'true');
    } else if (i < step) {
      btn.classList.add('completed');
    }
  });

  // ── Update mobile bottom nav
  document.querySelectorAll('.bnav-btn').forEach((btn, i) => {
    btn.classList.toggle('active', i === step);
  });

  // ── Swap panels
  const panels = document.querySelectorAll('.panel');
  panels.forEach((p, i) => {
    if (i === step) {
      p.classList.add('active');
    } else {
      p.classList.remove('active');
    }
  });

  // ── Initialize step-specific logic
  initStep(step);

  // ── Scroll main content to top
  document.querySelector('.main-content')?.scrollTo({ top: 0, behavior: 'smooth' });
}

/**
 * Dispatch to the correct step initializer.
 */
function initStep(step) {
  switch (step) {
    case 0: activeCleanup = initStep0(); break;
    case 1: activeCleanup = initStep1(); break;
    case 2: activeCleanup = initStep2(); break;
    case 3: activeCleanup = initStep3(); break;
    case 4: activeCleanup = initStep4(); break;
    case 5: activeCleanup = initStep5(); break;
    case 6: activeCleanup = initStep6(); break;
  }
}

/* ══════════════════════════════════════════════════════════════
   STEP 0 — AKUISISI DATA
   Dual waveform canvas + sample counter
══════════════════════════════════════════════════════════════ */
function initStep0() {
  const rawCanvas   = document.getElementById('rawCanvas');
  const cleanCanvas = document.getElementById('cleanCanvas');
  const sampleEl    = document.getElementById('sampleCount');

  if (!rawCanvas || !cleanCanvas) return null;

  let sampleCount = 0;
  let rafId = null;
  let tickerId = null;
  let phase = 0;

  // Setup canvas sizing with devicePixelRatio
  function setupCanvas(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width  = rect.width  * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    return { ctx, W: rect.width, H: rect.height };
  }

  let raw   = setupCanvas(rawCanvas);
  let clean = setupCanvas(cleanCanvas);

  // Resize handler
  function onResize() {
    raw   = setupCanvas(rawCanvas);
    clean = setupCanvas(cleanCanvas);
  }
  window.addEventListener('resize', onResize);

  // Draw raw — noisy gold waveform
  function drawRaw(ctx, W, H, t) {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(245,200,66,0.03)';
    ctx.fillRect(0, 0, W, H);

    ctx.beginPath();
    ctx.strokeStyle = '#F5C842';
    ctx.lineWidth   = 1.5;
    ctx.shadowColor = '#F5C842';
    ctx.shadowBlur  = 6;

    for (let x = 0; x <= W; x++) {
      const noise  = (Math.random() - 0.5) * 18;
      const signal = Math.sin((x / W) * Math.PI * 8 + t) * 22;
      const y      = H / 2 - signal - noise;
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  // Draw clean — smooth lavender waveform
  function drawClean(ctx, W, H, t) {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(176,106,255,0.03)';
    ctx.fillRect(0, 0, W, H);

    const grad = ctx.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0,   'rgba(123,47,255,0.6)');
    grad.addColorStop(0.5, '#B06AFF');
    grad.addColorStop(1,   'rgba(176,106,255,0.8)');

    ctx.beginPath();
    ctx.strokeStyle = grad;
    ctx.lineWidth   = 2;
    ctx.shadowColor = '#B06AFF';
    ctx.shadowBlur  = 10;

    for (let x = 0; x <= W; x++) {
      const signal = Math.sin((x / W) * Math.PI * 6 + t) * 20;
      const y      = H / 2 - signal;
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  // Animation loop
  function tick(ts) {
    phase = ts * 0.002;
    drawRaw(raw.ctx,   raw.W,   raw.H,   phase);
    drawClean(clean.ctx, clean.W, clean.H, phase * 0.75);
    rafId = requestAnimationFrame(tick);
  }
  rafId = requestAnimationFrame(tick);

  // Sample counter — increments every 300ms
  tickerId = setInterval(() => {
    sampleCount++;
    if (sampleEl) sampleEl.textContent = fmtID(sampleCount);
  }, SENSOR_INTERVAL_MS);

  // Return cleanup
  return function cleanup() {
    cancelAnimationFrame(rafId);
    clearInterval(tickerId);
    window.removeEventListener('resize', onResize);
  };
}

/* ══════════════════════════════════════════════════════════════
   STEP 1 — PEMBERSIHAN SINYAL
   Split signal canvases (noise vs machine)
══════════════════════════════════════════════════════════════ */
function initStep1() {
  const noiseCanvas   = document.getElementById('noiseCanvas');
  const machineCanvas = document.getElementById('machineCanvas');

  if (!noiseCanvas || !machineCanvas) return null;

  let rafId = null;
  let phase = 0;

  function setupCanvas(canvas) {
    const dpr  = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width  = rect.width  * dpr;
    canvas.height = rect.height * dpr;
    const ctx  = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    return { ctx, W: rect.width, H: rect.height };
  }

  let noise   = setupCanvas(noiseCanvas);
  let machine = setupCanvas(machineCanvas);

  function onResize() {
    noise   = setupCanvas(noiseCanvas);
    machine = setupCanvas(machineCanvas);
  }
  window.addEventListener('resize', onResize);

  // High-frequency erratic noise — gold
  function drawNoise(ctx, W, H, t) {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(245,200,66,0.04)';
    ctx.fillRect(0, 0, W, H);
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(245,200,66,0.7)';
    ctx.lineWidth   = 1.2;
    for (let x = 0; x <= W; x++) {
      const noise1 = (Math.random() - 0.5) * 26;
      const noise2 = Math.sin((x / W) * Math.PI * 22 + t * 3) * 10;
      const y = H / 2 - noise1 - noise2;
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // Smooth amplitude-drooping degradation signal — lavender
  function drawMachine(ctx, W, H, t) {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(176,106,255,0.04)';
    ctx.fillRect(0, 0, W, H);
    ctx.beginPath();
    ctx.strokeStyle = '#B06AFF';
    ctx.lineWidth   = 2;
    ctx.shadowColor = '#B06AFF';
    ctx.shadowBlur  = 8;
    for (let x = 0; x <= W; x++) {
      const progress = x / W;
      const amp      = lerp(24, 10, progress); // drooping amplitude
      const signal   = Math.sin((progress) * Math.PI * 7 + t * 0.6) * amp;
      const y        = H / 2 - signal;
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  function tick(ts) {
    phase = ts * 0.0015;
    drawNoise(noise.ctx,     noise.W,   noise.H,   phase);
    drawMachine(machine.ctx, machine.W, machine.H, phase);
    rafId = requestAnimationFrame(tick);
  }
  rafId = requestAnimationFrame(tick);

  return function cleanup() {
    cancelAnimationFrame(rafId);
    window.removeEventListener('resize', onResize);
  };
}

/* ══════════════════════════════════════════════════════════════
   STEP 2 — JARINGAN SARAF ANN
   SVG neural net with requestAnimationFrame particle flow
══════════════════════════════════════════════════════════════ */
function initStep2() {
  const svg = document.getElementById('nnSvg');
  if (!svg) return null;

  svg.innerHTML = '';

  const W = svg.clientWidth  || 600;
  const H = svg.clientHeight || 260;

  // ── Node positions
  const inputNodes  = [[W * 0.12, H * 0.22], [W * 0.12, H * 0.50], [W * 0.12, H * 0.78]];
  const hiddenNodes = [[W * 0.50, H * 0.18], [W * 0.50, H * 0.50], [W * 0.50, H * 0.82]];
  const outputNode  = [[W * 0.88, H * 0.50]];

  const NODE_R = 18;
  const OUT_R  = 22;

  // ── Connection data (from → to layer, indices)
  const connections = [];

  // Input → Hidden
  inputNodes.forEach((src, si) => {
    hiddenNodes.forEach((dst, di) => {
      connections.push({ x1: src[0], y1: src[1], x2: dst[0], y2: dst[1], type: 'ih' });
    });
  });

  // Hidden → Output
  hiddenNodes.forEach((src, si) => {
    outputNode.forEach((dst, di) => {
      connections.push({ x1: src[0], y1: src[1], x2: dst[0], y2: dst[1], type: 'ho' });
    });
  });

  // ── Draw connection paths
  const pathEls = connections.map(c => {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const mx   = (c.x1 + c.x2) / 2;
    path.setAttribute('d', `M${c.x1},${c.y1} C${mx},${c.y1} ${mx},${c.y2} ${c.x2},${c.y2}`);
    path.setAttribute('fill',   'none');
    path.setAttribute('stroke', c.type === 'ih' ? 'rgba(123,47,255,0.18)' : 'rgba(245,200,66,0.2)');
    path.setAttribute('stroke-width', '1');
    svg.appendChild(path);
    return path;
  });

  // ── Draw nodes helper
  function makeNode(cx, cy, r, isOutput, label) {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');

    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    bg.setAttribute('cx', cx); bg.setAttribute('cy', cy); bg.setAttribute('r', r);
    bg.setAttribute('fill', isOutput ? 'rgba(245,200,66,0.14)' : 'rgba(123,47,255,0.14)');
    g.appendChild(bg);

    const inner = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    inner.setAttribute('cx', cx); inner.setAttribute('cy', cy); inner.setAttribute('r', r * 0.45);
    inner.setAttribute('fill', isOutput ? '#F5C842' : '#7B2FFF');
    inner.setAttribute('opacity', '0.8');
    g.appendChild(inner);

    if (label) {
      const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      txt.setAttribute('x', cx); txt.setAttribute('y', cy + r + 13);
      txt.setAttribute('text-anchor', 'middle');
      txt.setAttribute('fill', 'rgba(240,236,255,0.35)');
      txt.setAttribute('font-size', '8');
      txt.setAttribute('font-family', 'Plus Jakarta Sans, sans-serif');
      txt.textContent = label;
      g.appendChild(txt);
    }

    svg.appendChild(g);
    return { bg, inner };
  }

  const inputLabels  = ['I₁ Amplitudo', 'I₂ Frekuensi', 'I₃ Fase'];
  const hiddenLabels = ['H₁', 'H₂', 'H₃'];

  const iNodes = inputNodes.map((n, i)  => makeNode(n[0], n[1], NODE_R, false, inputLabels[i]));
  const hNodes = hiddenNodes.map((n, i) => makeNode(n[0], n[1], NODE_R, false, hiddenLabels[i]));
  const oNode  = makeNode(outputNode[0][0], outputNode[0][1], OUT_R, true, 'O₁ Prediksi RUL');

  // Layer labels
  function addLayerLabel(x, text) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    el.setAttribute('x', x); el.setAttribute('y', 12);
    el.setAttribute('text-anchor', 'middle');
    el.setAttribute('fill', 'rgba(240,236,255,0.25)');
    el.setAttribute('font-size', '9');
    el.setAttribute('font-family', 'Plus Jakarta Sans, sans-serif');
    el.setAttribute('letter-spacing', '1');
    el.textContent = text;
    svg.appendChild(el);
  }

  addLayerLabel(W * 0.12, 'INPUT');
  addLayerLabel(W * 0.50, 'TERSEMBUNYI');
  addLayerLabel(W * 0.88, 'OUTPUT');

  // ── Particle animation along paths
  const particles = [];

  function createParticle(pathEl, color) {
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('r', '3.5');
    circle.setAttribute('fill', color);
    circle.setAttribute('opacity', '0');
    svg.appendChild(circle);

    return {
      el:       circle,
      pathEl:   pathEl,
      t:        Math.random(),        // position along path [0,1]
      speed:    0.004 + Math.random() * 0.003,
      color:    color,
    };
  }

  // Create several particles per connection
  pathEls.forEach((pathEl, i) => {
    const color = i < 9 ? '#B06AFF' : '#F5C842';
    for (let k = 0; k < 2; k++) {
      particles.push(createParticle(pathEl, color));
    }
  });

  // Node pulse state
  let pulsePhase  = 0;
  let pulseTarget = 0;
  const PULSE_DURATION = 30;

  let rafId = null;
  let frameCount = 0;

  function tick() {
    frameCount++;
    pulsePhase++;

    // Cycle through node pulse: input → hidden → output every ~45 frames
    const nodeIdx = Math.floor(pulsePhase / PULSE_DURATION) % (3 + 3 + 1);

    // Reset all node highlights
    [...iNodes, ...hNodes, oNode].forEach(n => {
      n.bg.setAttribute('opacity', '1');
      n.inner.setAttribute('opacity', '0.8');
    });

    // Highlight current pulsing node
    const allNodes = [...iNodes, ...hNodes, oNode];
    if (allNodes[nodeIdx]) {
      allNodes[nodeIdx].bg.setAttribute('opacity', '1');
      allNodes[nodeIdx].inner.setAttribute('opacity', '1');
      allNodes[nodeIdx].inner.setAttribute('fill', nodeIdx < 6 ? '#F5C842' : '#FFE08A');
    }

    // Animate particles
    particles.forEach(p => {
      p.t += p.speed;
      if (p.t > 1) p.t = 0;

      try {
        const pathLength = p.pathEl.getTotalLength();
        const point      = p.pathEl.getPointAtLength(p.t * pathLength);
        p.el.setAttribute('cx', point.x);
        p.el.setAttribute('cy', point.y);

        // Fade in/out at ends
        const opacity = p.t < 0.1 ? p.t / 0.1 : p.t > 0.9 ? (1 - p.t) / 0.1 : 1;
        p.el.setAttribute('opacity', (opacity * 0.85).toFixed(2));

        // Glow effect
        p.el.setAttribute('filter', p.t > 0.3 && p.t < 0.7 ? 'url(#particleGlow)' : '');
      } catch (e) {
        // Path may not be ready
      }
    });

    rafId = requestAnimationFrame(tick);
  }

  // Add glow filter to SVG defs
  const defs   = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
  filter.setAttribute('id', 'particleGlow');
  filter.innerHTML = `
    <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur"/>
    <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
  `;
  defs.appendChild(filter);
  svg.insertBefore(defs, svg.firstChild);

  rafId = requestAnimationFrame(tick);

  return function cleanup() {
    cancelAnimationFrame(rafId);
    svg.innerHTML = '';
  };
}

/* ══════════════════════════════════════════════════════════════
   STEP 3 — VALIDASI MODEL
   SVG gauge arc + MSE bar animation
══════════════════════════════════════════════════════════════ */
function initStep3() {
  const gaugeFill = document.getElementById('gaugeFill');
  const gaugeText = document.getElementById('gaugeText');
  const mseFill   = document.getElementById('mseFill');
  const mseValEl  = document.getElementById('mseVal');
  const validBadge = document.getElementById('validBadge');

  if (!gaugeFill) return null;

  // Reset
  gaugeFill.setAttribute('stroke-dasharray', '0 276');
  if (gaugeText) gaugeText.textContent = '0%';
  if (mseFill)   mseFill.style.width = '0%';
  if (mseValEl)  mseValEl.textContent = '0.0000';
  if (validBadge) validBadge.style.opacity = '0';

  const TOTAL_ARC = 276; // total arc length of the gauge path

  let startTime = null;
  let rafId     = null;
  const DURATION = 1600;

  function tick(ts) {
    if (!startTime) startTime = ts;
    const t    = clamp((ts - startTime) / DURATION, 0, 1);
    const ease = 1 - Math.pow(1 - t, 3); // ease-out cubic

    // Gauge arc
    const filled = ease * (MODEL_ACCURACY / 100) * TOTAL_ARC;
    if (gaugeFill) gaugeFill.setAttribute('stroke-dasharray', `${filled.toFixed(1)} ${TOTAL_ARC}`);
    if (gaugeText) gaugeText.textContent = Math.round(ease * MODEL_ACCURACY) + '%';

    // MSE bar — represents MODEL_MSE / 0.10 (max scale)
    const msePct = ease * (MODEL_MSE / 0.10) * 100;
    if (mseFill)  mseFill.style.width = msePct.toFixed(2) + '%';
    if (mseValEl) mseValEl.textContent = (ease * MODEL_MSE).toFixed(4);

    if (t < 1) {
      rafId = requestAnimationFrame(tick);
    } else {
      // Show validated badge
      if (validBadge) {
        validBadge.style.opacity = '1';
        validBadge.style.transition = 'opacity 0.4s ease';
      }
    }
  }

  // Small delay before animating for dramatic effect
  const delayId = setTimeout(() => {
    rafId = requestAnimationFrame(tick);
  }, 200);

  return function cleanup() {
    clearTimeout(delayId);
    cancelAnimationFrame(rafId);
  };
}

/* ══════════════════════════════════════════════════════════════
   STEP 4 — DUAL PATHWAY
   No heavy init needed — gold pulse is CSS animation.
   Just update the RUL value display.
══════════════════════════════════════════════════════════════ */
function initStep4() {
  const rulEl = document.getElementById('rulVal');
  if (rulEl) rulEl.textContent = RUL_CURRENT + '%';
  return null;
}

/* ══════════════════════════════════════════════════════════════
   STEP 5 — ROUTING ARMADA
   Technician movement animation + ETA countdown + coverage bar
══════════════════════════════════════════════════════════════ */
function initStep5() {
  const techGroup = document.getElementById('techGroup');
  const etaEl     = document.getElementById('etaDisplay');
  const covBar    = document.getElementById('covBar');
  const covValEl  = document.getElementById('covVal');

  // ── ETA countdown
  let etaTotalSec = 12 * 60 + 47; // start at 12:47
  let etaId = null;

  function updateEta() {
    if (etaTotalSec <= 0) etaTotalSec = 12 * 60 + 47; // loop
    etaTotalSec--;
    const m = String(Math.floor(etaTotalSec / 60)).padStart(2, '0');
    const s = String(etaTotalSec % 60).padStart(2, '0');
    if (etaEl) etaEl.textContent = `${m}:${s}`;
  }

  etaId = setInterval(updateEta, 1000);

  // ── Coverage bar animate
  setTimeout(() => {
    if (covBar) covBar.style.width = (COVERAGE_WITH_PETIR / 100 * 100) + '%';
    if (covValEl) {
      // Count up from 1.94 to 43.7
      let val = COVERAGE_BASELINE;
      const target = COVERAGE_WITH_PETIR;
      const dur    = 2000;
      const start  = performance.now();
      function stepCov(now) {
        const t    = clamp((now - start) / dur, 0, 1);
        const ease = 1 - Math.pow(1 - t, 3);
        val = lerp(COVERAGE_BASELINE, target, ease);
        covValEl.textContent = val.toFixed(1) + '% dengan SI PETIR';
        if (t < 1) requestAnimationFrame(stepCov);
      }
      requestAnimationFrame(stepCov);
    }
  }, 300);

  // ── Technician animation toward machine
  if (!techGroup) return () => clearInterval(etaId);

  // Target position (machine pin)
  const targetX = 210, targetY = 148;
  // Start position (where techGroup begins in SVG)
  let tx = 330, ty = 78;
  let rafId = null;

  // Ease toward target then loop back
  let t = 0;
  const TRIP_DURATION = 4000; // ms per trip
  let tripStart = performance.now();
  let returning = false;

  const startX = 330, startY = 78;
  const midX   = 270, midY   = 100;

  function animateTech(now) {
    const elapsed = now - tripStart;
    const progress = clamp(elapsed / TRIP_DURATION, 0, 1);
    const ease = progress < 0.5
      ? 2 * progress * progress
      : 1 - Math.pow(-2 * progress + 2, 2) / 2; // ease-in-out

    // Quadratic bezier interpolation
    const bx = (1 - ease) * (1 - ease) * startX + 2 * (1 - ease) * ease * midX + ease * ease * targetX;
    const by = (1 - ease) * (1 - ease) * startY + 2 * (1 - ease) * ease * midY + ease * ease * targetY;

    techGroup.setAttribute('transform', `translate(${bx - startX},${by - startY})`);

    if (progress >= 1) {
      // Pause at machine, then reset
      setTimeout(() => {
        techGroup.setAttribute('transform', `translate(0,0)`);
        tripStart = performance.now();
        rafId = requestAnimationFrame(animateTech);
      }, 1200);
    } else {
      rafId = requestAnimationFrame(animateTech);
    }
  }

  rafId = requestAnimationFrame(animateTech);

  return function cleanup() {
    clearInterval(etaId);
    cancelAnimationFrame(rafId);
    if (techGroup) techGroup.setAttribute('transform', '');
  };
}

/* ══════════════════════════════════════════════════════════════
   STEP 6 — EKSEKUSI LAPANGAN
   Health bar animation + cost savings count-up
══════════════════════════════════════════════════════════════ */
function initStep6() {
  const healthBar = document.getElementById('healthBar');
  const healthPct = document.getElementById('healthPct');
  const savingEl  = document.getElementById('savingAmt');

  // Reset
  if (healthBar) healthBar.style.width = '0%';
  if (healthPct) healthPct.textContent = '0% —';
  if (savingEl)  savingEl.textContent  = 'Rp 0';

  let rafId     = null;
  const DURATION = 2000;
  let startTime  = null;
  const TARGET_HEALTH  = 94;
  const TARGET_SAVINGS = COST_SAVED;

  function tick(ts) {
    if (!startTime) startTime = ts;
    const t    = clamp((ts - startTime) / DURATION, 0, 1);
    const ease = 1 - Math.pow(1 - t, 3);

    const h = ease * TARGET_HEALTH;
    if (healthBar) healthBar.style.width = h.toFixed(1) + '%';
    if (healthPct) healthPct.textContent = Math.round(h) + '% — sehat';

    const s = ease * TARGET_SAVINGS;
    if (savingEl) savingEl.textContent = 'Rp ' + fmtID(s);

    if (t < 1) rafId = requestAnimationFrame(tick);
  }

  const delayId = setTimeout(() => {
    rafId = requestAnimationFrame(tick);
  }, 300);

  return function cleanup() {
    clearTimeout(delayId);
    cancelAnimationFrame(rafId);
  };
}

/* ══════════════════════════════════════════════════════════════
   DASHBOARD LIVE SIMULATION
   setInterval fluctuates IMK count and flagged count
══════════════════════════════════════════════════════════════ */
function startDashboardSimulation() {
  const dashImk     = document.getElementById('dash-imk');
  const dashFlagged = document.getElementById('dash-flagged');
  const flagBadge   = document.getElementById('flagged-badge');
  const sidebarImk  = document.getElementById('sidebar-imk');

  function fluctuate() {
    // IMK: vary ±5
    const newImk = TOTAL_IMK_MONITORED + Math.floor((Math.random() - 0.5) * 10);
    if (dashImk)    dashImk.textContent    = fmtID(newImk);
    if (sidebarImk) sidebarImk.textContent = fmtID(newImk);

    // Flagged: vary ±3
    const newFlagged = FLAGGED_THIS_WEEK + Math.floor((Math.random() - 0.5) * 6);
    if (dashFlagged) dashFlagged.textContent = newFlagged;
    if (flagBadge)   flagBadge.textContent   = newFlagged + ' Peringatan';
  }

  return setInterval(fluctuate, 7000);
}

/* ══════════════════════════════════════════════════════════════
   THEME TOGGLE
══════════════════════════════════════════════════════════════ */
function initThemeToggle() {
  const btn  = document.getElementById('themeToggle');
  const html = document.documentElement;

  // Load saved preference
  const saved = localStorage.getItem('sipetir-theme') || 'dark';
  html.className = saved;

  btn?.addEventListener('click', () => {
    const isDark = html.classList.contains('dark');
    html.className = isDark ? 'light' : 'dark';
    localStorage.setItem('sipetir-theme', html.className);
  });
}

/* ══════════════════════════════════════════════════════════════
   BIND NAVIGATION
══════════════════════════════════════════════════════════════ */
function bindNav() {
  // Sidebar nav
  document.querySelectorAll('.nav-step').forEach(btn => {
    btn.addEventListener('click', () => {
      const step = parseInt(btn.dataset.step, 10);
      goToStep(step);
    });
  });

  // Mobile bottom nav
  document.querySelectorAll('.bnav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const step = parseInt(btn.dataset.step, 10);
      goToStep(step);
    });
  });

  // Keyboard: ArrowLeft / ArrowRight to navigate steps
  document.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight' && currentStep < TOTAL_STEPS - 1) goToStep(currentStep + 1);
    if (e.key === 'ArrowLeft'  && currentStep > 0)                goToStep(currentStep - 1);
  });
}

/* ══════════════════════════════════════════════════════════════
   MACHINE PIN PULSE (Step 5 map)
   Animate the ping-ring circle in the SVG map
══════════════════════════════════════════════════════════════ */
function animateMachinePin() {
  const ring = document.getElementById('machineRing');
  if (!ring) return;

  let r   = 14;
  let dir = 1;

  function pingTick() {
    r += dir * 0.4;
    if (r > 22) dir = -1;
    if (r < 14) dir =  1;

    ring.setAttribute('r', r.toFixed(1));
    ring.setAttribute('opacity', (1 - (r - 14) / 14).toFixed(2));
    requestAnimationFrame(pingTick);
  }
  requestAnimationFrame(pingTick);
}

/* ══════════════════════════════════════════════════════════════
   INIT
══════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  // Theme
  initThemeToggle();

  // Navigation
  bindNav();

  // Start first step
  goToStep(0);

  // Live dashboard simulation
  const simId = startDashboardSimulation();

  // Machine pin pulse (runs persistently)
  animateMachinePin();

  // Cleanup on page hide (best-effort)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && activeCleanup) {
      activeCleanup();
      activeCleanup = null;
    } else if (!document.hidden) {
      initStep(currentStep);
    }
  });
});
