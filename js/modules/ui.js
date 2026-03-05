/**
 * ui.js — Results rendering for FabcConnect Laser Time Calculator
 */

'use strict';

import { LaserCalculator } from './laserCalculator.js';

export function renderResults(result, filename) {
  const { timing, distances, counts, energy, settings } = result;

  // ── Primary result ──────────────────────────────────────────────
  setEl('res-total-time',  LaserCalculator.formatTime(timing.T_total));
  setEl('res-cut-time',    LaserCalculator.formatTime(timing.T_cut_min * settings.n_passes));
  setEl('res-rapid-time',  LaserCalculator.formatTime(timing.T_rapid_min));
  setEl('res-pierce-time', LaserCalculator.formatTime(timing.T_pierce_min * settings.n_passes));

  // ── Distance / move stats ───────────────────────────────────────
  setEl('stat-cut-dist',    fmtMM(distances.totalCutDist));
  setEl('stat-rapid-dist',  fmtMM(distances.totalRapidDist));
  setEl('stat-total-dist',  fmtMM(distances.totalDist));
  setEl('stat-pierces',     counts.n_pierces.toLocaleString());
  setEl('stat-cut-moves',   counts.cutMoves.toLocaleString());
  setEl('stat-arc-moves',   counts.arcMoves.toLocaleString());
  setEl('stat-rapid-moves', counts.rapidMoves.toLocaleString());
  setEl('stat-passes',      settings.n_passes);

  // ── Energy ──────────────────────────────────────────────────────
  setEl('stat-power-avg',  `${energy.P_avg} W`);
  setEl('stat-energy',     `${energy.E_wh} Wh`);

  // ── Laser settings used ─────────────────────────────────────────
  setEl('info-laser',    settings.laserName);
  setEl('info-rapid',    `${settings.F_rapid.toLocaleString()} mm/min`);
  setEl('info-pierce',   `${settings.pierceMs} ms`);
  setEl('info-filename', filename);

  // ── Bar chart ────────────────────────────────────────────────────
  renderBars(timing);

  // ── Show panel ──────────────────────────────────────────────────
  const panel = document.getElementById('results-panel');
  panel.classList.remove('hidden');
  panel.classList.add('appear');
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderBars(timing) {
  const total = timing.T_total;
  if (total <= 0) return;

  const cutPct    = (timing.T_cut_min    / total * 100);
  const rapidPct  = (timing.T_rapid_min  / total * 100);
  const piercePct = (timing.T_pierce_min / total * 100);

  setWidth('bar-cut',    cutPct);
  setWidth('bar-rapid',  rapidPct);
  setWidth('bar-pierce', piercePct);

  setEl('bar-cut-label',    `${cutPct.toFixed(1)}%`);
  setEl('bar-rapid-label',  `${rapidPct.toFixed(1)}%`);
  setEl('bar-pierce-label', `${piercePct.toFixed(1)}%`);
}

function setEl(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function setWidth(id, pct) {
  const el = document.getElementById(id);
  if (el) el.style.width = `${Math.max(0, Math.min(100, pct))}%`;
}

function fmtMM(mm) {
  if (mm >= 1000) return `${(mm / 1000).toFixed(2)} m`;
  return `${mm.toFixed(1)} mm`;
}

export function showError(msg) {
  const el = document.getElementById('error-msg');
  if (!el) return;
  el.textContent = '⚠ ' + msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 7000);
}

export function setLoading(on) {
  const btn = document.getElementById('btn-calculate');
  const spin = document.getElementById('spinner');
  const txt  = document.getElementById('btn-text');
  if (btn)  btn.disabled = on;
  if (spin) spin.classList.toggle('hidden', !on);
  if (txt)  txt.textContent = on ? 'Analysing…' : 'Calculate Laser Time';
}
