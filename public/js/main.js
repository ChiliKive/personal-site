(function () {
  'use strict';

  var DEV = true;            // false → hides the scene switcher
  var DEFAULT_SCENE = 'flight'; // 'network' | 'flight' | 'learn'

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

  var C = {};
  function readColors() {
    var cs = getComputedStyle(root);
    ['bg', 'fg', 'muted', 'line', 'grid', 'accent'].forEach(function (k) { C[k] = hex(cs.getPropertyValue('--' + k)); });
    var m = document.querySelector('meta[name=theme-color]'); if (m) m.setAttribute('content', cs.getPropertyValue('--bg').trim());
  }

  /* ---------- pointer ---------- */
  var M = { x: 0, y: 0 }, sm = { x: 0, y: 0 }, dirty = true, captured = false;
  window.addEventListener('pointermove', function (e) {
    M.x = (e.clientX / innerWidth - 0.5) * 2; M.y = (e.clientY / innerHeight - 0.5) * 2; dirty = true;
  }, { passive: true });
  document.addEventListener('mouseleave', function () { M.x = 0; M.y = 0; dirty = true; });

  var canvas = document.getElementById('fig');
  function fit(c) {
    var r = c.getBoundingClientRect(), d = Math.min(window.devicePixelRatio || 1, 2);
    var w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    if (c.width !== Math.round(w * d) || c.height !== Math.round(h * d)) { c.width = Math.round(w * d); c.height = Math.round(h * d); }
    return { w: w, h: h, d: d };
  }

  /* =====================================================================
     Shared: camera, readout, fade behind the text
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
  var FADE_WIDTH = 0.8, FADE_STRENGTH = 0.9;
  function leftFade(ctx, W, H, wide) {
    if (wide) {
      var w = W * FADE_WIDTH, g = ctx.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, rgba(C.bg, FADE_STRENGTH)); g.addColorStop(0.35, rgba(C.bg, FADE_STRENGTH * 0.68));
      g.addColorStop(0.7, rgba(C.bg, FADE_STRENGTH * 0.25)); g.addColorStop(1, rgba(C.bg, 0));
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, H);
    } else { ctx.fillStyle = rgba(C.bg, 0.42); ctx.fillRect(0, 0, W, H); }
  }

  /* loss sparkline + numbers, bottom right */
  function readout(ctx, W, H, wide, txt, series, lo, hi, alpha) {
    var rx = wide ? W - 28 : 20, ry = H - 24, sw = 150, sh = 30, sx0 = wide ? rx - sw : rx, sy0 = ry - 22 - sh, k;
    ctx.globalAlpha = clamp(alpha, 0, 1);
    if (series.length > 1) {
      ctx.beginPath();
      for (k = 0; k < series.length; k++) {
        var xx = sx0 + k / Math.max(1, series.n - 1 || series.length - 1) * sw, yy = sy0 + (1 - (series[k] - lo) / Math.max(1e-6, hi - lo)) * sh;
        k ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy);
      }
      ctx.strokeStyle = rgba(C.accent, 0.9); ctx.lineWidth = 1.4; ctx.stroke();
    }
    ctx.fillStyle = rgba(C.line, 1); ctx.fillRect(sx0, sy0 + sh + 3, sw, 1);
    ctx.font = '12px "JetBrains Mono", monospace'; ctx.textAlign = wide ? 'right' : 'left'; ctx.fillStyle = rgba(C.muted, 1);
    ctx.fillText(txt, rx, ry);
    ctx.globalAlpha = 1;
  }
  function fmtLoss(l) { return (l < 0 ? '−' : ' ') + Math.abs(l).toFixed(3); }

  /* =====================================================================
     World: ONE endless landscape, one smooth function everywhere.
     It scrolls towards the camera. Loss wells are hashed per tile.
     ===================================================================== */
  var LT = 18, DX = 0.5, DZ = 0.5, XMIN = -36, NXW = 145, HS = 1.7, V = 1.8, STEP = 0.05, HOLD = 1.8, S0 = 40;
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
    for (var key in rowCache) if (key * DZ < S - 8) { delete rowCache[key]; rowCount--; }
  }

  var MAXR = 260, ROWS = [], SX = new Float32Array(MAXR * NXW), SY = new Float32Array(MAXR * NXW), GOOD = new Uint8Array(MAXR * NXW);
  for (i = 0; i < MAXR; i++) ROWS.push({ zr: 0, al: 1, i0: 0, i1: 0, h: null });

  function skyGlow(ctx, W, H, hor) {
    var gl = ctx.createLinearGradient(0, hor - H * 0.5, 0, hor + 4);
    gl.addColorStop(0, rgba(C.accent, 0)); gl.addColorStop(1, rgba(C.accent, 0.13));
    ctx.fillStyle = gl; ctx.fillRect(0, 0, W, H);
  }

  /* Painter's algorithm, far → near. The mesh is uniform in the world; rows thin out
     with distance (3 levels) and fade in/out, so there is no visible seam. */
  function drawTerrain(ctx, W, H, S) {
    var R = 0, j, jmin = Math.ceil((S + 1.5) / DZ), jmax = Math.floor((S + 150) / DZ), q, r;
    var spanL = (cam.cx + 90) / cam.focal, spanR = (W - cam.cx + 90) / cam.focal;
    pruneRows(S);
    for (j = jmin; j <= jmax && R < MAXR; j++) {
      var zr = j * DZ - S, m9 = ((j % 9) + 9) % 9, m3 = ((j % 3) + 3) % 3, lev = m9 === 0 ? 0 : (m3 === 0 ? 1 : 2), fade = 1;
      if (lev === 1) fade = 1 - sstep(54, 60, zr); else if (lev === 2) fade = 1 - sstep(28, 34, zr);
      if (fade < 0.02) continue;
      var rw = ROWS[R]; rw.zr = zr; rw.al = clamp(1 - (zr - 6) / 130, 0.3, 0.95) * fade; rw.h = rowHeights(j);
      var dd = zr + 8, xmin = cam.x - spanL * dd * 1.15 - 0.4 * dd - 3, xmax = cam.x + spanR * dd * 1.15 + 0.4 * dd + 3;
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
      ctx.strokeStyle = rgba(C.grid, al); ctx.stroke();
      if (connA > 0.015) {
        ctx.beginPath();
        for (t = a; t <= b; t++) { ctx.moveTo(SX[of + t], SY[of + t]); ctx.lineTo(SX[on + t], SY[on + t]); }
        ctx.strokeStyle = rgba(C.accent, connA); ctx.stroke();
      }
    }
    ctx.lineWidth = 1;
    for (r = R - 1; r >= 1; r--) {
      var Fr = ROWS[r], Nr = ROWS[r - 1], lo = Math.max(Fr.i0, Nr.i0), hi = Math.min(Fr.i1, Nr.i1);
      if (hi - lo < 1) continue;
      var of = r * NXW, on = (r - 1) * NXW, fog = sstep(40, 150, Fr.zr) * 0.13;
      curFill = 'rgb(' + Math.round(lerp(C.bg[0], C.accent[0], fog)) + ',' + Math.round(lerp(C.bg[1], C.accent[1], fog)) + ',' + Math.round(lerp(C.bg[2], C.accent[2], fog)) + ')';
      connA = Fr.al * 0.3 * (1 - sstep(34, 46, Fr.zr));
      var rs = -1;
      for (q = lo; q <= hi + 1; q++) {
        var ok = q <= hi && GOOD[of + q] && GOOD[on + q];
        if (ok) { if (rs < 0) rs = q; }
        else if (rs >= 0) { if (q - rs >= 2) strip(of, on, rs, q - 1, Fr.al); rs = -1; }
      }
    }
    if (R > 0) {
      var r0 = ROWS[0], rs0 = -1; ctx.strokeStyle = rgba(C.grid, 0.95);
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
    var lo2 = 1e9, hi2 = -1e9; pts.forEach(function (p) { lo2 = Math.min(lo2, p[2]); hi2 = Math.max(hi2, p[2]); });
    ru = { pts: pts, sStart: k * LT + LT / 2 - 42 + m * V * 1.5, lo: lo2, hi: hi2 }; runCache[key] = ru; return ru;
  }

  /* =====================================================================
     SCENE "flight": the landscape flows towards us, descents happen on it
     ===================================================================== */
  var flight = {
    agent: null, stillTime: function () { return 3.4; },
    draw: function (ctx, D, t, dt, s, cap) {
      var W = D.w, H = D.h, wide = W > 900, S = S0 + V * t;
      var hor = terrainCamera(W, H, t);
      skyGlow(ctx, W, H, hor);
      drawTerrain(ctx, W, H, S);

      var kmin = Math.floor((S - 8) / LT), kmax = Math.floor((S + 60) / LT), k, m, primary = null, latest = null, sI = 0;
      for (k = kmin; k <= kmax; k++) for (m = 0; m < 2; m++) {
        var run = agentRun(k, m), el = (S - run.sStart) / V, n = run.pts.length; if (el < 0) continue;
        var fi = clamp(el / STEP, 0, n - 1), i0 = Math.floor(fi), fr = fi - i0, P0 = run.pts[i0], P1 = run.pts[Math.min(n - 1, i0 + 1)];
        var zw = lerp(P0[1], P1[1], fr), zr = zw - S; if (zr < 1.0) continue;
        var alp = clamp(el / 0.5, 0, 1) * (m === 0 ? 1 : 0.8), xw = lerp(P0[0], P1[0], fr);
        var from = Math.max(0, i0 - 80), q, Q;
        Q = run.pts[from]; pr(Q[0], heightAt(Q[0], Q[1]) + 0.12, Q[1] - S); var prevX = px, prevY = py;
        for (q = from + 1; q <= i0; q++) {
          Q = run.pts[q]; var age = (q - from) / Math.max(1, i0 - from);
          pr(Q[0], heightAt(Q[0], Q[1]) + 0.12, Q[1] - S);
          ctx.beginPath(); ctx.moveTo(prevX, prevY); ctx.lineTo(px, py); ctx.strokeStyle = rgba(C.accent, (0.12 + age * 0.8) * alp); ctx.lineWidth = 1 + age * 1.6; ctx.stroke(); prevX = px; prevY = py;
        }
        pr(xw, heightAt(xw, zw) + 0.12, zr); var hx = px, hy = py, depth = pz;
        ctx.beginPath(); ctx.moveTo(prevX, prevY); ctx.lineTo(hx, hy); ctx.strokeStyle = rgba(C.accent, alp); ctx.lineWidth = 2.6; ctx.stroke();
        var rec = { x: hx, y: hy, run: run, fi: fi, i0: i0, fr: fr, el: el, alp: alp, P0: P0, P1: P1, zr: zr, active: el < n * STEP, started: run.sStart };
        if (rec.active && (!primary || zr < primary.zr)) primary = rec;
        if (!latest || rec.started > latest.started) latest = rec;
        (flight._dots = flight._dots || []).push({ hx: hx, hy: hy, depth: depth, alp: alp, rec: rec });
        var done = el - n * STEP;
        if (done > 0 && done < 1.6) {
          var rr = 0.15 + done * 1.5, yy = heightAt(xw, zw) + 0.1;
          ctx.beginPath();
          for (q = 0; q <= 40; q++) { var an = q / 40 * 6.2832; pr(xw + Math.cos(an) * rr, yy, zw - S + Math.sin(an) * rr); q ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
          ctx.strokeStyle = rgba(C.accent, (1 - done / 1.6) * 0.8 * alp); ctx.lineWidth = 1.5; ctx.stroke();
        }
      }
      primary = primary || latest;
      var dots = flight._dots || []; flight._dots = [];
      dots.forEach(function (d) {
        if (cap && d.rec === primary) return;
        var rad = clamp(80 / d.depth, 2.6, 7.5), gr = ctx.createRadialGradient(d.hx, d.hy, 0, d.hx, d.hy, rad * 5);
        gr.addColorStop(0, rgba(C.accent, 0.55 * d.alp)); gr.addColorStop(1, rgba(C.accent, 0));
        ctx.fillStyle = gr; ctx.fillRect(d.hx - rad * 5, d.hy - rad * 5, rad * 10, rad * 10);
        ctx.beginPath(); ctx.arc(d.hx, d.hy, rad, 0, 7); ctx.fillStyle = rgba(C.accent, d.alp); ctx.fill();
      });
      this.agent = primary ? { x: primary.x, y: primary.y } : null;

      leftFade(ctx, W, H, wide);

      if (primary) {
        var run0 = primary.run, loss = lerp(primary.P0[2], primary.P1[2], primary.fr), doneAll = primary.el - run0.pts.length * STEP > 0;
        var ser = []; for (var z = 0; z <= primary.i0; z++) ser.push(run0.pts[z][2]); ser.n = run0.pts.length;
        readout(ctx, W, H, wide, 'step ' + String(Math.round(primary.fi)).padStart(3, '0') + '  loss ' + fmtLoss(loss) + (doneAll ? '  converged' : ''), ser, run0.lo, run0.hi, primary.alp * 0.9 + 0.1);
      }
    }
  };

  /* =====================================================================
     SCENE "learn": a network lives ON the landscape. Edges follow the ground,
     signals run along them, and the nodes slide downhill — that is the training.
     ===================================================================== */
  var learnInst = {}, LAYERS = [[3, -10], [4, -3.4], [4, 3.4], [3, 10]];
  function makeInst(k, age) {
    var r = rng(k * 313 + 9), cz = k * LT + LT / 2, nodes = [], layers = [];
    LAYERS.forEach(function (L, li) {
      var col = [];
      for (var q = 0; q < L[0]; q++) {
        var n = { hx: L[1] + (r() - 0.5) * 1.2, hz: cz + lerp(-7, 7, (q + 0.5) / L[0]) + (r() - 0.5) * 1.5, flash: 0, sx: 0, sy: 0, sz: 1 };
        n.x = n.hx; n.z = n.hz; col.push(n); nodes.push(n);
      }
      layers.push(col);
    });
    var it = { k: k, cz: cz, nodes: nodes, layers: layers, sigs: [], spawn: 0.3, passes: 0, hist: [], histT: 0 };
    for (var a = 0; a < age; a += 0.05) stepInst(it, 0.05, false);
    return it;
  }
  var gTmp = [0, 0];
  function stepInst(it, dt, anim) {
    var n, q;
    for (q = 0; q < it.nodes.length; q++) {
      n = it.nodes[q]; grad(n.x, n.z, gTmp);
      n.x = clamp(n.x + dt * (-0.75 * gTmp[0] + 0.5 * (n.hx - n.x)), -12, 12); n.z += dt * (-0.75 * gTmp[1] + 0.5 * (n.hz - n.z));
      if (n.flash > 0) n.flash = Math.max(0, n.flash - dt * 1.4);
    }
    it.histT += dt;
    if (it.histT >= 0.1) {
      it.histT = 0; var s = 0; for (q = 0; q < it.nodes.length; q++) s += lossAt(it.nodes[q].x, it.nodes[q].z);
      it.hist.push(s / it.nodes.length); if (it.hist.length > 150) it.hist.shift();
    }
    if (anim) {
      it.spawn -= dt;
      if (it.spawn <= 0 && it.sigs.length < 5) {
        it.spawn = 0.45 + Math.random() * 0.4;
        it.sigs.push({ path: it.layers.map(function (col) { return col[Math.floor(Math.random() * col.length)]; }), seg: 0, p: 0 });
      }
      for (q = it.sigs.length - 1; q >= 0; q--) {
        var sg = it.sigs[q]; sg.p += dt / 0.75;
        if (sg.p >= 1) { sg.path[sg.seg + 1].flash = 1; sg.seg++; sg.p = 0; if (sg.seg >= sg.path.length - 1) { it.sigs.splice(q, 1); it.passes++; } }
      }
    }
  }
  function onGround(a, b, u, S) { var x = lerp(a.x, b.x, u), z = lerp(a.z, b.z, u); pr(x, heightAt(x, z) + 0.22, z - S); }

  var learn = {
    agent: null, stillTime: function () { return 3.4; },
    draw: function (ctx, D, t, dt, s, cap) {
      var W = D.w, H = D.h, wide = W > 900, S = S0 + V * t;
      var hor = terrainCamera(W, H, t, 0.1);
      skyGlow(ctx, W, H, hor);
      drawTerrain(ctx, W, H, S);

      var kmin = Math.floor((S - 10) / LT), kmax = Math.floor((S + 46) / LT), k, primary = null, head = null, e, a, b, l, u;
      for (var key in learnInst) if (learnInst[key].cz - S < -12) delete learnInst[key];
      for (k = kmin; k <= kmax; k++) {
        var zc = k * LT + LT / 2 - S;
        if (zc > 48 || zc < -10) continue;
        if (!learnInst[k]) learnInst[k] = makeInst(k, Math.max(0, (48 - zc) / V));
        var it = learnInst[k]; stepInst(it, reduce ? 0 : dt, !reduce);
        if (reduce && !it.sigs.length) it.sigs.push({ path: it.layers.map(function (col) { return col[1 % col.length]; }), seg: 1, p: 0.5 });
        var vis = 1 - sstep(30, 48, zc);
        if (zc > 2 && (!primary || zc < primary.cz - S)) primary = it;
        // edges, draped on the ground
        ctx.lineWidth = 1;
        for (l = 0; l < it.layers.length - 1; l++) for (a = 0; a < it.layers[l].length; a++) for (b = 0; b < it.layers[l + 1].length; b++) {
          var A = it.layers[l][a], B = it.layers[l + 1][b];
          ctx.beginPath();
          for (u = 0; u <= 14; u++) { onGround(A, B, u / 14, S); u ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
          ctx.lineWidth = 4; ctx.strokeStyle = rgba(C.bg, 0.55 * vis); ctx.stroke();
          ctx.lineWidth = 1.3; ctx.strokeStyle = rgba(C.accent, 0.6 * vis); ctx.stroke();
        }
        // signals running along those edges
        it.sigs.forEach(function (sg) {
          var A = sg.path[sg.seg], B = sg.path[sg.seg + 1]; if (!B) return;
          var u1 = sg.p, u0 = Math.max(0, sg.p - 0.28), q;
          ctx.beginPath();
          for (q = 0; q <= 6; q++) { onGround(A, B, lerp(u0, u1, q / 6), S); q ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
          ctx.strokeStyle = rgba(C.accent, 0.95 * vis); ctx.lineWidth = 2.2; ctx.stroke();
          onGround(A, B, u1, S); var hx = px, hy = py, dp = pz;
          ctx.beginPath(); ctx.arc(hx, hy, clamp(55 / dp, 1.8, 5), 0, 7); ctx.fillStyle = rgba(C.accent, vis); ctx.fill();
          if (zc > 2 && (!head || it === primary)) head = { x: hx, y: hy, it: it };
        });
        // nodes
        for (e = 0; e < it.nodes.length; e++) {
          var n = it.nodes[e]; pr(n.x, heightAt(n.x, n.z) + 0.25, n.z - S);
          var r = clamp(95 / pz, 2.6, 8.5);
          if (n.flash > 0.02) { ctx.beginPath(); ctx.arc(px, py, r + (1 - n.flash) * 12, 0, 7); ctx.strokeStyle = rgba(C.accent, n.flash * 0.6 * vis); ctx.lineWidth = 1; ctx.stroke(); }
          ctx.beginPath(); ctx.arc(px, py, r, 0, 7); ctx.fillStyle = rgba(C.bg, 0.9 * vis); ctx.fill();
          ctx.lineWidth = 1.3; ctx.strokeStyle = rgba(C.accent, (n.flash > 0.02 ? 1 : 0.85) * vis); ctx.stroke();
          if (n.flash > 0.02) { ctx.beginPath(); ctx.arc(px, py, r * 0.55, 0, 7); ctx.fillStyle = rgba(C.accent, n.flash * vis); ctx.fill(); }
        }
      }
      if (primary && head && head.it === primary) this.agent = { x: head.x, y: head.y };
      else if (primary) { var n0 = primary.nodes[5]; pr(n0.x, heightAt(n0.x, n0.z) + 0.25, n0.z - S); this.agent = { x: px, y: py }; }
      else this.agent = null;

      leftFade(ctx, W, H, wide);

      if (primary && primary.hist.length > 1) {
        var h = primary.hist, lo = 1e9, hi = -1e9; h.forEach(function (v) { lo = Math.min(lo, v); hi = Math.max(hi, v); });
        readout(ctx, W, H, wide, 'pass ' + String(primary.passes).padStart(3, '0') + '  loss ' + fmtLoss(h[h.length - 1]), h, lo, hi, 1);
      }
    }
  };

  /* =====================================================================
     SCENE "network": only a big 3D neural network.
     Layers are planes (nodes sit on a grid inside each), spread left → right,
     the camera orbits slowly and follows the pointer. Forward pulses (accent)
     run through the net, then backward pulses (light) come back and nudge the weights.
     ===================================================================== */
  var netScene = (function () {
    var spec = [4, 7, 7, 5, 3], LX = 7.2, PY = 9.5, PZ = 9, nodes = [], flat = [], edges = [], r = rng(33), sigs = [], spawn = 0, id = 0;
    spec.forEach(function (cnt, l) {
      var col = [], cols = Math.ceil(Math.sqrt(cnt * 1.25)), rows = Math.ceil(cnt / cols);
      for (var q = 0; q < cnt; q++) {
        var ci = q % cols, ri = Math.floor(q / cols), inRow = ri === rows - 1 ? cnt - ri * cols : cols;
        var gz = inRow === 1 ? 0 : lerp(-0.72, 0.72, ci / (inRow - 1)), gy = rows === 1 ? 0 : lerp(0.7, -0.7, ri / (rows - 1));
        var n = { id: id++, l: l, x: (l - (spec.length - 1) / 2) * LX, y: gy * PY * 0.85 + (r() - 0.5) * 1.4, z: gz * PZ + (r() - 0.5) * 1.6, ph: r() * 6.28, flash: 0, back: 0, sx: 0, sy: 0, sz: 1, out: {} };
        col.push(n); flat.push(n);
      }
      nodes.push(col);
    });
    for (var l = 0; l < nodes.length - 1; l++) nodes[l].forEach(function (A) {
      nodes[l + 1].forEach(function (B) { var e = { A: A, B: B, w: 0.15 + 0.85 * Math.pow(r(), 2), wt: 0, f: 0 }; e.wt = e.w; A.out[B.id] = e; edges.push(e); });
    });
    var planeC = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    return {
      agent: null, stillTime: function () { return 5; },
      draw: function (ctx, D, t, dt, s, cap) {
        var W = D.w, H = D.h, wide = W > 900, q, a, b, e;
        var yaw = 0.26 - s.x * 0.45 + Math.sin(t * 0.1) * 0.1, pitch = 0.2 - s.y * 0.14 + Math.sin(t * 0.07) * 0.02;
        setCam(yaw, pitch, 46, [0, 0, 0], Math.max(W, H * 1.2) * 1.0, wide ? W * 0.645 : W * 0.5, H * 0.5);
        var g = ctx.createRadialGradient(cam.cx, cam.cy, 0, cam.cx, cam.cy, Math.max(W, H) * 0.7);
        g.addColorStop(0, rgba(C.accent, 0.12)); g.addColorStop(1, rgba(C.accent, 0)); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

        // faint floor grid + layer planes: they give the network a space to live in
        ctx.lineWidth = 1; ctx.strokeStyle = rgba(C.grid, 0.22);
        ctx.beginPath();
        for (q = -24; q <= 24; q += 4) { pr(q, -PY * 1.05, -16); ctx.moveTo(px, py); pr(q, -PY * 1.05, 16); ctx.lineTo(px, py); }
        for (q = -16; q <= 16; q += 4) { pr(-24, -PY * 1.05, q); ctx.moveTo(px, py); pr(24, -PY * 1.05, q); ctx.lineTo(px, py); }
        ctx.stroke();
        for (a = 0; a < spec.length; a++) {
          var lx = (a - (spec.length - 1) / 2) * LX;
          ctx.beginPath();
          for (q = 0; q < 4; q++) { pr(lx, planeC[q][0] * PY * 0.9, planeC[q][1] * PZ * 1.05); q ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
          ctx.closePath(); ctx.fillStyle = rgba(C.accent, 0.025); ctx.fill(); ctx.strokeStyle = rgba(C.accent, 0.16); ctx.stroke();
        }

        for (q = 0; q < flat.length; q++) {
          var n = flat[q]; pr(n.x + Math.sin(t * 0.3 + n.ph) * 0.45, n.y + Math.cos(t * 0.35 + n.ph) * 0.4, n.z + Math.sin(t * 0.27 + n.ph * 1.7) * 0.4);
          n.sx = px; n.sy = py; n.sz = pz; n.flash = Math.max(0, n.flash - dt * 1.2); n.back = Math.max(0, n.back - dt * 1.2);
        }
        for (q = 0; q < edges.length; q++) {
          e = edges[q]; e.w += (e.wt - e.w) * Math.min(1, dt * 2.5); e.f = Math.max(0, e.f - dt * 1.1);
          var dep = clamp(1.35 - (e.A.sz - 24) / 40, 0.3, 1);
          ctx.strokeStyle = rgba(e.f > 0.02 ? C.fg : C.accent, Math.min(0.9, (0.07 + 0.38 * e.w) * dep + e.f * 0.5));
          ctx.lineWidth = 0.7 + e.w * 0.9;
          ctx.beginPath(); ctx.moveTo(e.A.sx, e.A.sy); ctx.lineTo(e.B.sx, e.B.sy); ctx.stroke();
        }
        if (!reduce) {
          spawn -= dt;
          if (spawn <= 0 && sigs.length < 9) {
            spawn = 0.35 + Math.random() * 0.5;
            sigs.push({ path: nodes.map(function (col) { return col[Math.floor(Math.random() * col.length)]; }), seg: 0, p: 0, back: false });
          }
          for (var k = sigs.length - 1; k >= 0; k--) {
            var sg = sigs[k]; sg.p += dt / 0.7;
            if (sg.p >= 1) {
              var from = sg.path[sg.seg], dest = sg.path[sg.seg + 1];
              if (sg.back) { dest.back = 1; var be = dest.out[from.id]; if (be) { be.f = 1; be.wt = clamp(be.w + (Math.random() - 0.5) * 0.5, 0.08, 1); } }
              else dest.flash = 1;
              sg.seg++; sg.p = 0;
              if (sg.seg >= sg.path.length - 1) { sigs.splice(k, 1); if (!sg.back) sigs.push({ path: sg.path.slice().reverse(), seg: 0, p: 0, back: true }); }
            }
          }
        } else if (!sigs.length) sigs.push({ path: nodes.map(function (col) { return col[1 % col.length]; }), seg: 1, p: 0.5, back: false });
        var lead = null;
        sigs.forEach(function (sg) {
          var A = sg.path[sg.seg], B = sg.path[sg.seg + 1]; if (!B) return;
          var x = lerp(A.sx, B.sx, sg.p), y = lerp(A.sy, B.sy, sg.p), x0 = lerp(A.sx, B.sx, Math.max(0, sg.p - 0.25)), y0 = lerp(A.sy, B.sy, Math.max(0, sg.p - 0.25));
          var col = sg.back ? C.fg : C.accent;
          ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x, y); ctx.strokeStyle = rgba(col, sg.back ? 0.75 : 0.95); ctx.lineWidth = 2.2; ctx.stroke();
          if (!sg.back && !lead) lead = { x: x, y: y };
          if (!(cap && lead && lead.x === x && lead.y === y)) { ctx.beginPath(); ctx.arc(x, y, clamp(110 / A.sz, 2.2, 5), 0, 7); ctx.fillStyle = rgba(col, 1); ctx.fill(); }
        });
        this.agent = lead || { x: cam.cx, y: cam.cy };
        var order = flat.slice().sort(function (p1, p2) { return p2.sz - p1.sz; });
        order.forEach(function (n) {
          var rad = clamp(300 / n.sz, 4, 19), f = Math.max(n.flash, n.back), col = n.back > n.flash ? C.fg : C.accent;
          if (f > 0.02) { ctx.beginPath(); ctx.arc(n.sx, n.sy, rad + (1 - f) * 20, 0, 7); ctx.strokeStyle = rgba(col, f * 0.6); ctx.lineWidth = 1.2; ctx.stroke(); }
          ctx.beginPath(); ctx.arc(n.sx, n.sy, rad, 0, 7); ctx.fillStyle = rgba(C.bg, 0.94); ctx.fill();
          ctx.lineWidth = 1.6; ctx.strokeStyle = f > 0.02 ? rgba(col, 1) : rgba(C.accent, 0.85); ctx.stroke();
          if (f > 0.02) { ctx.beginPath(); ctx.arc(n.sx, n.sy, rad * 0.55, 0, 7); ctx.fillStyle = rgba(col, f); ctx.fill(); }
        });
        leftFade(ctx, W, H, wide);
        ctx.font = '12px "JetBrains Mono", monospace'; ctx.textAlign = wide ? 'right' : 'left'; ctx.fillStyle = rgba(C.muted, 1);
        ctx.fillText('forward ▸  ◂ backward', wide ? W - 28 : 20, H - 24);
      }
    };
  })();

  var scenes = { flight: flight, learn: learn, network: netScene };
  var sceneName = params.get('scene') || store('scene') || DEFAULT_SCENE;
  if (!scenes[sceneName]) sceneName = DEFAULT_SCENE;
  var scene = scenes[sceneName], T0 = 0;
  var dev = document.getElementById('dev');
  function syncDev() { dev.querySelectorAll('[data-scene]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.scene === sceneName); }); }
  function setScene(name) {
    if (!scenes[name]) return;
    sceneName = name; scene = scenes[name]; store('scene', name); captured = false; dirty = true; syncDev();
  }
  if (DEV) { dev.hidden = false; dev.addEventListener('click', function (e) { var b = e.target.closest('button'); if (b && b.dataset.scene) setScene(b.dataset.scene); }); }

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
    r.addEventListener('mouseenter', function () { hoverRow = r; });
    r.addEventListener('mouseleave', function () { if (hoverRow === r) hoverRow = null; });
    r.addEventListener('focusin', function () { hoverRow = r; });
    r.addEventListener('focusout', function () { if (hoverRow === r) hoverRow = null; });
  });
  function agentClient() { var a = scene.agent; return a ? { x: a.x, y: a.y } : { x: innerWidth * 0.62, y: innerHeight * 0.55 }; }
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
    fly.style.opacity = flyS.o;
    fly.style.transform = 'translate3d(' + (flyS.x - 6) + 'px,' + (flyS.y - 6) + 'px,0)';
  }

  /* ---------- main loop ---------- */
  var T = 0, last = performance.now(), ctx = canvas.getContext('2d');
  function frame(now) {
    var dt = Math.min((now - last) / 1000, 0.05); last = now;
    var kk = Math.min(1, dt * 3.5); sm.x += (M.x - sm.x) * kk; sm.y += (M.y - sm.y) * kk;
    if (!reduce || dirty) {
      T += reduce ? 0 : dt;
      var D = fit(canvas);
      ctx.setTransform(D.d, 0, 0, D.d, 0, 0); ctx.clearRect(0, 0, D.w, D.h);
      scene.draw(ctx, D, reduce ? scene.stillTime() : T, reduce ? 0.016 : dt, sm, captured);
      dirty = false;
    }
    updateFly(dt);
    requestAnimationFrame(frame);
  }
  window.addEventListener('resize', function () { dirty = true; });

  readColors(); syncDev();
  themeBtn.setAttribute('aria-label', root.getAttribute('data-theme') === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { dirty = true; });
  requestAnimationFrame(function (n) { last = n; frame(n); });
})();
