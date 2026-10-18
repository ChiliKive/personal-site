(function () {
  'use strict';

  var root = document.documentElement;
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var params = new URLSearchParams(location.search);
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) {} return null; }

  /* ---------- helpers ---------- */
  function hex(s) { s = s.trim(); var n = parseInt(s.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function rgba(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function sstep(a, b, v) { var t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  /* C.x = [r, g, b]; CA.x[i] = 'rgba(..., i/100)' prebuilt, so the hot loops don't build strings */
  var C = {}, CA = {}, FOG = [], FOGN = 64, FOGMAX = 0.13;
  function col(k, a) { return CA[k][a <= 0 ? 0 : a >= 1 ? 100 : Math.round(a * 100)]; }
  function readColors() {
    var cs = getComputedStyle(root);
    ['bg', 'fg', 'muted', 'line', 'grid', 'accent'].forEach(function (k) {
      var c = C[k] = hex(cs.getPropertyValue('--' + k)), a = CA[k] = [];
      for (var q = 0; q <= 100; q++) a.push(rgba(c, q / 100));
    });
    for (var f = 0; f <= FOGN; f++) {
      var t = f / FOGN * FOGMAX;
      FOG[f] = 'rgb(' + Math.round(lerp(C.bg[0], C.accent[0], t)) + ',' + Math.round(lerp(C.bg[1], C.accent[1], t)) + ',' + Math.round(lerp(C.bg[2], C.accent[2], t)) + ')';
    }
    gradKey = ''; glow = null;
    var m = document.querySelector('meta[name=theme-color]'); if (m) m.setAttribute('content', cs.getPropertyValue('--bg').trim());
  }

  /* ---------- pointer ---------- */
  var M = { x: 0, y: 0 }, sm = { x: 0, y: 0 }, dirty = true, captured = false;
  window.addEventListener('pointermove', function (e) {
    M.x = (e.clientX / innerWidth - 0.5) * 2; M.y = (e.clientY / innerHeight - 0.5) * 2; dirty = true;
  }, { passive: true });
  document.addEventListener('mouseleave', function () { M.x = 0; M.y = 0; dirty = true; });

  /* size is measured only after a resize; dprCap only goes down on devices that can't keep up */
  var canvas = document.getElementById('fig'), size = null, dprCap = 2;
  function fit(c) {
    if (!size) {
      var r = c.getBoundingClientRect(), d = Math.min(window.devicePixelRatio || 1, dprCap);
      size = { w: Math.max(1, Math.round(r.width)), h: Math.max(1, Math.round(r.height)), d: d };
      if (c.width !== Math.round(size.w * d) || c.height !== Math.round(size.h * d)) { c.width = Math.round(size.w * d); c.height = Math.round(size.h * d); }
    }
    return size;
  }

  /* =====================================================================
     Camera, readout, fade behind the text
     ===================================================================== */
  var cam = { x: 0, y: 0, z: 0, fx: 0, fy: 0, fz: 1, rx: 1, ry: 0, rz: 0, ux: 0, uy: 1, uz: 0, focal: 1, cx: 0, cy: 0 };
  var px = 0, py = 0, pz = 1;
  function setCam(yaw, pitch, dist, T, focal, cx, cy) {
    var cp = Math.cos(pitch), sp = Math.sin(pitch), cy0 = Math.cos(yaw), sy0 = Math.sin(yaw);
    cam.x = T[0] + dist * sy0 * cp; cam.y = T[1] + dist * sp; cam.z = T[2] - dist * cy0 * cp;
    cam.fx = -sy0 * cp; cam.fy = -sp; cam.fz = cy0 * cp;
    cam.rx = cy0; cam.ry = 0; cam.rz = sy0;
    cam.ux = cam.fy * cam.rz - cam.fz * cam.ry; cam.uy = cam.fz * cam.rx - cam.fx * cam.rz; cam.uz = cam.fx * cam.ry - cam.fy * cam.rx;
    cam.focal = focal; cam.cx = cx; cam.cy = cy;
  }
  function pr(x, y, z) {
    var vx = x - cam.x, vy = y - cam.y, vz = z - cam.z;
    var zc = vx * cam.fx + vy * cam.fy + vz * cam.fz; if (zc < 0.6) zc = 0.6;
    var xc = vx * cam.rx + vy * cam.ry + vz * cam.rz, yc = vx * cam.ux + vy * cam.uy + vz * cam.uz, k = cam.focal / zc;
    px = cam.cx + xc * k; py = cam.cy - yc * k; pz = zc;
  }

  /* the darkening from the left edge (keeps the title readable) */
  /* gradients are rebuilt only when the size or the theme changes */
  var FADE_WIDTH = 0.8, FADE_STRENGTH = 0.9, gradKey = '', fadeG = null, skyG = null;
  function gradients(ctx, W, H) {
    var key = W + 'x' + H; if (key === gradKey) return; gradKey = key;
    var w = W * FADE_WIDTH;
    fadeG = ctx.createLinearGradient(0, 0, w, 0);
    fadeG.addColorStop(0, rgba(C.bg, FADE_STRENGTH)); fadeG.addColorStop(0.35, rgba(C.bg, FADE_STRENGTH * 0.68));
    fadeG.addColorStop(0.7, rgba(C.bg, FADE_STRENGTH * 0.25)); fadeG.addColorStop(1, rgba(C.bg, 0));
    skyG = ctx.createLinearGradient(0, -H * 0.5, 0, 4); // relative to the horizon, drawn with a translate
    skyG.addColorStop(0, rgba(C.accent, 0)); skyG.addColorStop(1, rgba(C.accent, 0.13));
  }
  function leftFade(ctx, W, H, wide) {
    if (wide) { ctx.fillStyle = fadeG; ctx.fillRect(0, 0, W * FADE_WIDTH, H); }
    else { ctx.fillStyle = col('bg', 0.42); ctx.fillRect(0, 0, W, H); }
  }

  /* loss sparkline + numbers, bottom right */
  function readout(ctx, W, H, wide, txt, series, lo, hi, alpha) {
    var rx = wide ? W - 28 : 20, ry = H - 24, sw = 150, sh = 30, sx0 = wide ? rx - sw : rx, sy0 = ry - 22 - sh, k;
    ctx.globalAlpha = clamp(alpha, 0, 1);
    if (series.length > 1) {
      ctx.beginPath();
      for (k = 0; k < series.length; k++) {
        var xx = sx0 + k / Math.max(1, series.n - 1) * sw, yy = sy0 + (1 - (series[k] - lo) / Math.max(1e-6, hi - lo)) * sh;
        k ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy);
      }
      ctx.strokeStyle = col('accent', 0.9); ctx.lineWidth = 1.4; ctx.stroke();
    }
    ctx.fillStyle = col('line', 1); ctx.fillRect(sx0, sy0 + sh + 3, sw, 1);
    ctx.font = '12px "JetBrains Mono", monospace'; ctx.textAlign = wide ? 'right' : 'left'; ctx.fillStyle = col('muted', 1);
    ctx.fillText(txt, rx, ry);
    ctx.globalAlpha = 1;
  }
  /* every live descent on one chart, no labels: each run keeps its own (dimmer or brighter) tone */
  var allScale = { n: 60, lo: -3, hi: 1 };
  function readoutAll(ctx, W, H, wide, recs, dt) {
    var rx = wide ? W - 28 : 20, sw = 150, sh = 30, sx0 = wide ? rx - sw : rx, sy0 = H - 24 - 22 - sh, tn = 20, tlo = 1e9, thi = -1e9, e = Math.min(1, dt * 2.5);
    recs.forEach(function (c) { tn = Math.max(tn, c.run.pts.length - 1); tlo = Math.min(tlo, c.run.lo); thi = Math.max(thi, c.run.hi); });
    if (thi > tlo) { allScale.n += (tn - allScale.n) * e; allScale.lo += (tlo - allScale.lo) * e; allScale.hi += (thi - allScale.hi) * e; }
    var span = Math.max(1e-6, allScale.hi - allScale.lo);
    recs.slice().sort(function (a, b) { return a.run.tone - b.run.tone; }).forEach(function (c) {
      var a = clamp(c.alp, 0, 1) * sstep(1, 5, c.zr) * c.run.tone, k, xx, yy;
      if (a < 0.01) return;
      ctx.globalAlpha = 1; ctx.beginPath();
      for (k = 0; k <= c.i0; k++) {
        xx = sx0 + k / allScale.n * sw; yy = sy0 + (1 - (c.run.pts[k][2] - allScale.lo) / span) * sh;
        k ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy);
      }
      xx = sx0 + c.fi / allScale.n * sw; yy = sy0 + (1 - (lerp(c.P0[2], c.P1[2], c.fr) - allScale.lo) / span) * sh; ctx.lineTo(xx, yy);
      ctx.strokeStyle = col('accent', a); ctx.lineWidth = 1.3; ctx.stroke();
      ctx.beginPath(); ctx.arc(xx, yy, 1.8, 0, 7); ctx.fillStyle = col('accent', a + 0.15); ctx.fill();
    });
    ctx.fillStyle = col('line', 1); ctx.fillRect(sx0, sy0 + sh + 3, sw, 1);
  }
  /* graph mode: 'single' (one point, start → convergence) or 'all'. ?graph=all, or press G to switch */
  var graphMode = params.get('graph') === 'all' ? 'all' : 'single';
  document.addEventListener('keydown', function (ev) {
    if ((ev.key === 'g' || ev.key === 'G') && !ev.ctrlKey && !ev.metaKey && !ev.altKey) { graphMode = graphMode === 'all' ? 'single' : 'all'; dirty = true; }
  });
  function fmtLoss(l) { return (l < 0 ? '−' : ' ') + Math.abs(l).toFixed(3); }

  /* =====================================================================
     World: ONE endless landscape, one smooth function everywhere.
     It scrolls towards the camera. Loss wells are hashed per tile.
     ===================================================================== */
  var LT = 18, DX = 0.5, DZ = 0.5, XMIN = -36, NXW = 145, HS = 1.7, V = 1.8, STEP = 0.05, HOLD = 1.8, S0 = 40, TRAIL_B = 16;
  var xsW = new Float32Array(NXW), i;
  for (i = 0; i < NXW; i++) xsW[i] = XMIN + i * DX;

  var tileC = {};
  function tileWells(k) {
    var w = tileC[k]; if (w) return w;
    var r = rng(k * 7919 + 17);
    w = [{ x: lerp(-4.5, 0.5, r()), z: k * LT + lerp(3.5, 7.5, r()), d: 2.1 + r() * 0.5, s: 2.4 },
         { x: lerp(-0.5, 4.5, r()), z: k * LT + lerp(10.5, 14.5, r()), d: 1.4 + r() * 0.6, s: 2.0 }];
    tileC[k] = w; return w;
  }
  function lossAt(x, zw) {
    var k = Math.floor(zw / LT), v = 0, d, q, w, n, dx, dz;
    for (d = -1; d <= 1; d++) { w = tileWells(k + d); for (n = 0; n < 2; n++) { q = w[n]; dx = x - q.x; dz = zw - q.z; v -= q.d * Math.exp(-(dx * dx + dz * dz) / q.s); } }
    var lane = 1 - 0.6 * Math.exp(-x * x / 50);
    var rp = 0.75 * Math.sin(0.21 * x + 0.7) * Math.cos(0.17 * zw + 0.4) + 0.42 * Math.sin(0.43 * x - 0.31 * zw + 1.3) + 0.22 * Math.sin(0.86 * x + 0.62 * zw + 2.1) + 0.10 * Math.sin(1.7 * x - 1.2 * zw);
    return v + lane * rp;
  }
  function sideAt(x, zw) { var a = Math.abs(x); if (a < 5) return 0; return sstep(5, 24, a) * (2.6 + 1.2 * Math.sin(0.17 * zw + 0.28 * a)); }
  function heightAt(x, zw) { return lossAt(x, zw) * HS + sideAt(x, zw); }
  function grad(x, z, out) { var h = 0.02; out[0] = (lossAt(x + h, z) - lossAt(x - h, z)) / (2 * h); out[1] = (lossAt(x, z + h) - lossAt(x, z - h)) / (2 * h); }

  var rowCache = {}, rowCount = 0;
  function rowHeights(j) {
    var h = rowCache[j]; if (h) return h;
    h = new Float32Array(NXW); var zw = j * DZ;
    for (var q = 0; q < NXW; q++) h[q] = heightAt(xsW[q], zw);
    rowCache[j] = h; rowCount++; return h;
  }
  function pruneRows(S) {
    if (rowCount < 900) return;
    for (var key in rowCache) if (key * DZ < S - NEAR - 4) { delete rowCache[key]; rowCount--; }
  }

  var NEAR = 14, MAXR = 300, ROWS = [], SX = new Float32Array(MAXR * NXW), SY = new Float32Array(MAXR * NXW), GOOD = new Uint8Array(MAXR * NXW);
  for (i = 0; i < MAXR; i++) ROWS.push({ zr: 0, al: 1, i0: 0, i1: 0, h: null });

  function skyGlow(ctx, W, H, hor) {
    ctx.translate(0, hor); ctx.fillStyle = skyG; ctx.fillRect(0, -hor, W, H); ctx.translate(0, -hor);
  }

  /* soft glow around a point: one pre-rendered sprite instead of a new radial gradient per point per frame */
  var glow = null, GLOW = 64;
  function glowSprite() {
    if (glow) return glow;
    glow = document.createElement('canvas'); glow.width = glow.height = GLOW;
    var g = glow.getContext('2d'), gr = g.createRadialGradient(GLOW / 2, GLOW / 2, 0, GLOW / 2, GLOW / 2, GLOW / 2);
    gr.addColorStop(0, rgba(C.accent, 1)); gr.addColorStop(1, rgba(C.accent, 0));
    g.fillStyle = gr; g.fillRect(0, 0, GLOW, GLOW); return glow;
  }

  /* Painter's algorithm, far → near. The mesh is uniform in the world; rows thin out
     with distance (3 levels) and fade in/out, so there is no visible seam. */
  function drawTerrain(ctx, W, H, S) {
    var R = 0, j, jmin = Math.floor((S - NEAR) / DZ), jmax = Math.floor((S + 150) / DZ), q, r;
    var spanL = (cam.cx + 90) / cam.focal, spanR = (W - cam.cx + 90) / cam.focal;
    pruneRows(S);
    for (j = jmin; j <= jmax && R < MAXR; j++) {
      var zr = j * DZ - S, m9 = ((j % 9) + 9) % 9, m3 = ((j % 3) + 3) % 3, lev = m9 === 0 ? 0 : (m3 === 0 ? 1 : 2), fade = 1;
      if (lev === 1) fade = 1 - sstep(54, 60, zr); else if (lev === 2) fade = 1 - sstep(28, 34, zr);
      if (fade < 0.02) continue;
      var rw = ROWS[R]; rw.zr = zr; rw.al = clamp(1 - (zr - 6) / 130, 0.3, 0.95) * fade; rw.h = rowHeights(j);
      var dd = Math.max(zr, 0) + 8, xmin = cam.x - spanL * dd * 1.15 - 0.4 * dd - 3, xmax = cam.x + spanR * dd * 1.15 + 0.4 * dd + 3;
      rw.i0 = clamp(Math.floor((xmin - XMIN) / DX), 0, NXW - 1); rw.i1 = clamp(Math.ceil((xmax - XMIN) / DX), 0, NXW - 1);
      var base = R * NXW;
      for (q = rw.i0; q <= rw.i1; q++) { pr(xsW[q], rw.h[q], zr); SX[base + q] = px; SY[base + q] = py; GOOD[base + q] = pz > 0.9 ? 1 : 0; }
      R++;
    }
    var curFill = '', connA = 0;
    function strip(of, on, a, b, al) {
      var t;
      ctx.beginPath(); ctx.moveTo(SX[of + a], SY[of + a]);
      for (t = a + 1; t <= b; t++) ctx.lineTo(SX[of + t], SY[of + t]);
      for (t = b; t >= a; t--) ctx.lineTo(SX[on + t], SY[on + t]);
      ctx.closePath(); ctx.fillStyle = curFill; ctx.fill();
      ctx.beginPath(); ctx.moveTo(SX[of + a], SY[of + a]);
      for (t = a + 1; t <= b; t++) ctx.lineTo(SX[of + t], SY[of + t]);
      ctx.strokeStyle = col('grid', al); ctx.stroke();
      if (connA > 0.015) {
        ctx.beginPath();
        for (t = a; t <= b; t++) { ctx.moveTo(SX[of + t], SY[of + t]); ctx.lineTo(SX[on + t], SY[on + t]); }
        ctx.strokeStyle = col('accent', connA); ctx.stroke();
      }
    }
    ctx.lineWidth = 1;
    for (r = R - 1; r >= 1; r--) {
      var Fr = ROWS[r], Nr = ROWS[r - 1], lo = Math.max(Fr.i0, Nr.i0), hi = Math.min(Fr.i1, Nr.i1);
      if (hi - lo < 1) continue;
      var of = r * NXW, on = (r - 1) * NXW, fog = sstep(40, 150, Fr.zr) * FOGMAX;
      curFill = FOG[Math.round(fog / FOGMAX * FOGN)];
      connA = Fr.al * 0.3 * (1 - sstep(34, 46, Fr.zr));
      var rs = -1;
      for (q = lo; q <= hi + 1; q++) {
        var ok = q <= hi && GOOD[of + q] && GOOD[on + q];
        if (ok) { if (rs < 0) rs = q; }
        else if (rs >= 0) { if (q - rs >= 2) strip(of, on, rs, q - 1, Fr.al); rs = -1; }
      }
    }
    if (R > 0) {
      var r0 = ROWS[0], rs0 = -1; ctx.strokeStyle = col('grid', 0.95);
      for (q = r0.i0; q <= r0.i1 + 1; q++) {
        if (q <= r0.i1 && GOOD[q]) { if (rs0 < 0) { rs0 = q; ctx.beginPath(); ctx.moveTo(SX[q], SY[q]); } else ctx.lineTo(SX[q], SY[q]); }
        else if (rs0 >= 0) { ctx.stroke(); rs0 = -1; }
      }
    }
  }

  function terrainCamera(W, H, t, pb) {
    var wide = W > 900, s = sm;
    var yaw = -s.x * 0.36 + Math.sin(t * 0.11) * 0.06, pitch = 0.38 + (pb || 0) - s.y * 0.10 + Math.sin(t * 0.08 + 1) * 0.02;
    var focal = Math.max(W, H * 1.2) * 0.55, cx = wide ? W * 0.68 : W * 0.5, cy = H * 0.64;
    setCam(yaw, pitch, 15, [1.0, -0.8, 12.5], focal, cx, cy);
    return cy - focal * Math.tan(pitch);
  }

  /* gradient-descent runs, one per (tile, slot) — fixed in the world, so they travel with it */
  var runCache = {};
  function agentRun(k, m) {
    var key = k * 4 + m, ru = runCache[key]; if (ru) return ru;
    var r = rng(k * 131 + m * 977 + 5), lo = k * LT, hi = (k + 1) * LT, x = lerp(-5, 5, r()), z = lerp(lo + 2, hi - 2, r()), vx = 0, vz = 0, g = [0, 0], pts = [[x, z, lossAt(x, z)]];
    for (var s = 0; s < 260; s++) {
      grad(x, z, g); var gm = Math.sqrt(g[0] * g[0] + g[1] * g[1]); if (s > 25 && gm < 0.012) break;
      var nz = (1 - s / 260) * 0.03;
      vx = 0.55 * vx - 0.2 * g[0] + (r() - 0.5) * nz; vz = 0.55 * vz - 0.2 * g[1] + (r() - 0.5) * nz;
      x = clamp(x + vx, -6, 6); z = clamp(z + vz, lo - 6, hi + 6); pts.push([x, z, lossAt(x, z)]);
    }
    var lo2 = 1e9, hi2 = -1e9; pts.forEach(function (p) { lo2 = Math.min(lo2, p[2]); hi2 = Math.max(hi2, p[2]); p.push(heightAt(p[0], p[1]) + 0.12); });
    ru = { key: key, tone: 0.22 + 0.7 * rng(key * 53 + 11)(), pts: pts, sStart: k * LT + LT / 2 - 42 + m * V * 1.5, lo: lo2, hi: hi2 }; runCache[key] = ru; return ru;
  }

  /* =====================================================================
     The landscape flows towards us, gradient descents happen on it
     ===================================================================== */
  var flight = {
    agent: null, stillTime: function () { return 3.4; },
    draw: function (ctx, D, t, dt, s, cap) {
      var W = D.w, H = D.h, wide = W > 900, S = S0 + V * t;
      var hor = terrainCamera(W, H, t);
      gradients(ctx, W, H);
      skyGlow(ctx, W, H, hor);
      drawTerrain(ctx, W, H, S);

      var kmin = Math.floor((S - 8) / LT), kmax = Math.floor((S + 60) / LT), k, m, primary = null, latest = null, recs = [], dots = [];
      for (k = kmin; k <= kmax; k++) for (m = 0; m < 2; m++) {
        var run = agentRun(k, m), el = (S - run.sStart) / V, n = run.pts.length; if (el < 0) continue;
        var fi = clamp(el / STEP, 0, n - 1), i0 = Math.floor(fi), fr = fi - i0, P0 = run.pts[i0], P1 = run.pts[Math.min(n - 1, i0 + 1)];
        var zw = lerp(P0[1], P1[1], fr), zr = zw - S; if (zr < 1.0) continue;
        var alp = clamp(el / 0.5, 0, 1) * (m === 0 ? 1 : 0.8), xw = lerp(P0[0], P1[0], fr);
        /* the trail gets brighter and thicker towards the head; drawn in TRAIL_B pieces, not segment by segment */
        var from = Math.max(0, i0 - 80), span = Math.max(1, i0 - from), q, Q, b, qa, qb;
        Q = run.pts[from]; pr(Q[0], Q[3], Q[1] - S); var prevX = px, prevY = py;
        for (b = 0; b < TRAIL_B; b++) {
          qa = from + 1 + Math.floor(b * span / TRAIL_B); qb = from + Math.floor((b + 1) * span / TRAIL_B);
          if (qb > i0) qb = i0;
          if (qb < qa) continue;
          var age = ((qa + qb) / 2 - from) / span;
          ctx.beginPath(); ctx.moveTo(prevX, prevY);
          for (q = qa; q <= qb; q++) { Q = run.pts[q]; pr(Q[0], Q[3], Q[1] - S); ctx.lineTo(px, py); }
          ctx.strokeStyle = col('accent', (0.12 + age * 0.8) * alp); ctx.lineWidth = 1 + age * 1.6; ctx.stroke(); prevX = px; prevY = py;
        }
        pr(xw, heightAt(xw, zw) + 0.12, zr); var hx = px, hy = py, depth = pz;
        ctx.beginPath(); ctx.moveTo(prevX, prevY); ctx.lineTo(hx, hy); ctx.strokeStyle = col('accent', alp); ctx.lineWidth = 2.6; ctx.stroke();
        var rec = { x: hx, y: hy, run: run, fi: fi, i0: i0, fr: fr, el: el, alp: alp, P0: P0, P1: P1, zr: zr, active: el < n * STEP, started: run.sStart };
        recs.push(rec);
        if (rec.active && (!primary || zr < primary.zr)) primary = rec;
        if (!latest || rec.started > latest.started) latest = rec;
        dots.push({ hx: hx, hy: hy, depth: depth, alp: alp, rec: rec });
        var done = el - n * STEP;
        if (done > 0 && done < 1.6) {
          var rr = 0.15 + done * 1.5, yy = heightAt(xw, zw) + 0.1;
          ctx.beginPath();
          for (q = 0; q <= 40; q++) { var an = q / 40 * 6.2832; pr(xw + Math.cos(an) * rr, yy, zw - S + Math.sin(an) * rr); q ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
          ctx.strokeStyle = col('accent', (1 - done / 1.6) * 0.8 * alp); ctx.lineWidth = 1.5; ctx.stroke();
        }
      }
      primary = primary || latest;
      if (graphMode === 'single') {
        /* stay on one point from its first step until it has converged (plus a short hold) */
        var lk = null, cand = null;
        recs.forEach(function (c) {
          if (c.run.key === flight.lockKey && c.el - c.run.pts.length * STEP < HOLD) lk = c;
          if (c.active && (!cand || c.el < cand.el)) cand = c;
        });
        primary = lk || cand || latest; flight.lockKey = primary ? primary.run.key : null;
      }
      var spr = glowSprite();
      dots.forEach(function (d) {
        if (cap && d.rec === primary) return;
        var rad = clamp(80 / d.depth, 2.6, 7.5);
        ctx.globalAlpha = 0.55 * d.alp; ctx.drawImage(spr, d.hx - rad * 5, d.hy - rad * 5, rad * 10, rad * 10); ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.arc(d.hx, d.hy, rad, 0, 7); ctx.fillStyle = col('accent', d.alp); ctx.fill();
      });
      this.agent = primary ? { x: primary.x, y: primary.y } : null;
      if (graphMode === 'single' && primary && !cap) {
        ctx.beginPath(); ctx.arc(primary.x, primary.y, 11, 0, 7); ctx.strokeStyle = col('accent', 0.55 * primary.alp); ctx.lineWidth = 1.2; ctx.stroke();
      }

      leftFade(ctx, W, H, wide);

      if (graphMode === 'all') readoutAll(ctx, W, H, wide, recs, dt);
      else if (primary) {
        var run0 = primary.run, loss = lerp(primary.P0[2], primary.P1[2], primary.fr), doneAll = primary.el - run0.pts.length * STEP > 0;
        var ser = []; for (var z = 0; z <= primary.i0; z++) ser.push(run0.pts[z][2]); ser.n = run0.pts.length;
        readout(ctx, W, H, wide, 'step ' + String(Math.round(primary.fi)).padStart(3, '0') + '  loss ' + fmtLoss(loss) + (doneAll ? '  converged' : ''), ser, run0.lo, run0.hi, primary.alp * 0.9 + 0.1);
      }
    }
  };


  /* ---------- theme ---------- */
  var themeBtn = document.getElementById('theme');
  function setTheme(t) {
    root.setAttribute('data-theme', t); store('theme', t);
    themeBtn.setAttribute('aria-label', t === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
    readColors(); dirty = true;
  }
  themeBtn.addEventListener('click', function () { setTheme(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); });

  /* ---------- copy to clipboard ---------- */
  var statusEl = document.getElementById('status');
  function legacyCopy(text) {
    var ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) {} document.body.removeChild(ta); return Promise.resolve();
  }
  function copyText(text) {
    try { if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).catch(function () { return legacyCopy(text); }); } catch (e) {}
    return legacyCopy(text);
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-copy]'); if (!b) return;
    var toast = b.closest('.row').querySelector('.toast');
    copyText(b.getAttribute('data-copy')).then(function () {
      if (toast) { toast.classList.remove('show'); void toast.offsetWidth; toast.classList.add('show'); }
      statusEl.textContent = 'Copied ' + b.getAttribute('data-copy');
    });
  });

  /* ---------- the flying point ---------- */
  var fly = document.getElementById('fly'), flyS = { x: 0, y: 0, o: 0, mode: 'idle' }, hoverRow = null;
  document.querySelectorAll('.row').forEach(function (r) {
    r.addEventListener('pointerenter', function (e) { if (e.pointerType === 'mouse') hoverRow = r; });
    r.addEventListener('pointerleave', function () { if (hoverRow === r) hoverRow = null; });
    r.addEventListener('focusin', function (e) { if (e.target.matches(':focus-visible')) hoverRow = r; });
    r.addEventListener('focusout', function () { if (hoverRow === r) hoverRow = null; });
  });
  function agentClient() { var a = flight.agent; return a ? { x: a.x, y: a.y } : { x: innerWidth * 0.62, y: innerHeight * 0.55 }; }
  function updateFly(dt) {
    var k = reduce ? 1 : 1 - Math.exp(-dt * 9), tx = flyS.x, ty = flyS.y;
    if (hoverRow) {
      if (flyS.mode !== 'row') {
        if (flyS.mode === 'idle') { var a0 = agentClient(); flyS.x = a0.x; flyS.y = a0.y; }
        flyS.mode = 'row'; captured = true; dirty = true;
      }
      var r = hoverRow.getBoundingClientRect(); tx = r.left - 14; ty = r.top + r.height / 2; flyS.o = 1;
    } else if (flyS.mode === 'row') { flyS.mode = 'return'; }
    if (flyS.mode === 'return') {
      var a = agentClient(); tx = a.x; ty = a.y;
      if (Math.abs(tx - flyS.x) + Math.abs(ty - flyS.y) < 10) { flyS.mode = 'idle'; flyS.o = 0; captured = false; dirty = true; }
    }
    if (flyS.mode !== 'idle') { flyS.x += (tx - flyS.x) * k; flyS.y += (ty - flyS.y) * k; }
    if (flyS.mode === 'idle' && flyS.o === flyS.lastO) return;
    flyS.lastO = flyS.o; fly.style.opacity = flyS.o;
    fly.style.transform = 'translate3d(' + (flyS.x - 6) + 'px,' + (flyS.y - 6) + 'px,0)';
  }

  /* ---------- main loop ---------- */
  /* opaque canvas: the browser doesn't have to blend it with the page behind */
  var T = 0, last = performance.now(), ctx = canvas.getContext('2d', { alpha: false }), slow = 0, frames = 0;
  function frame(now) {
    var dt = Math.min((now - last) / 1000, 0.05); last = now;
    var kk = Math.min(1, dt * 3.5); sm.x += (M.x - sm.x) * kk; sm.y += (M.y - sm.y) * kk;
    if (!reduce || dirty) {
      T += reduce ? 0 : dt;
      var D = fit(canvas), t0 = performance.now();
      ctx.setTransform(D.d, 0, 0, D.d, 0, 0); ctx.fillStyle = col('bg', 1); ctx.fillRect(0, 0, D.w, D.h);
      flight.draw(ctx, D, reduce ? flight.stillTime() : T, reduce ? 0.016 : dt, sm, captured);
      dirty = false;
      // over ~2 s, if most frames take too long, render a bit less sharp (2 -> 1.75 -> 1.5 -> 1.25)
      if (!reduce && dprCap > 1.25 && D.d > 1.25) {
        frames++; if (performance.now() - t0 > 14) slow++;
        if (frames >= 120) { if (slow > 80) { dprCap -= 0.25; size = null; } frames = slow = 0; }
      }
    }
    updateFly(dt);
    requestAnimationFrame(frame);
  }
  window.addEventListener('resize', function () { size = null; dirty = true; });

  readColors();
  themeBtn.setAttribute('aria-label', root.getAttribute('data-theme') === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { dirty = true; });
  requestAnimationFrame(function (n) { last = n; frame(n); });
})();
