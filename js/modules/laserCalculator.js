/**
 * laserCalculator.js
 * ─────────────────────────────────────────────────────────────────
 * Computes laser cutting time from G-code.
 *
 * ═══════════════════════════════════════════════════════════════
 * EQUATIONS
 * ═══════════════════════════════════════════════════════════════
 *
 * 1. PER-SEGMENT TIME
 *
 *      t_seg = d / F          [min]
 *
 *    d = segment length [mm]
 *    F = feed rate on that move [mm/min]
 *
 * 2. RAPID FEED (G0 moves)
 *
 *    If the file has an explicit F on a G0 line → use it.
 *    Otherwise the machine uses its max jog speed, which is NOT
 *    the cutting feed. Fallback = max cutting feed seen × 5,
 *    clamped to [3000, 60000] mm/min. This is conservative and
 *    avoids the main over-estimation cause: timing G0 at slow
 *    cutting feed rates.
 *
 * 3. ARC LENGTH  (exact sweep angle)
 *
 *      d_arc = r × sweep,   r = √(I²+J²)
 *
 * 4. PIERCE DWELL
 *
 *      T_pierce = n_starts × dwell_ms / 60000    [min]
 *
 * 5. TOTAL
 *
 *      T_total = T_cut + T_rapid + T_pierce
 *
 * ─────────────────────────────────────────────────────────────────
 */

"use strict";

export class LaserCalculator {
    static calculate(parsed) {
        const { moves, stats } = parsed;

        const dwellMs = stats.detectedDwellMs ?? 0;
        const S_max = stats.maxPower > 0 ? stats.maxPower : 255;

        // Best-effort rapid feed: explicit from file, else max_cut_feed × 5
        const fallbackRapid = Math.min(
            Math.max(stats.maxFeed * 5, 3000),
            60000,
        );

        let T_cut_min = 0;
        let T_rapid_min = 0;
        let n_pierces = 0;
        let weightedPow = 0;
        let prevWasCut = false;

        for (const mv of moves) {
            if (mv.dist < 1e-9) continue;

            if (mv.type === "rapid") {
                // Use explicit rapid F if present, else fallback
                const F = mv.feed > 0 ? mv.feed : fallbackRapid;
                T_rapid_min += mv.dist / F;
                prevWasCut = false;
            } else {
                if (!prevWasCut) n_pierces++;
                const F = mv.feed > 0 ? mv.feed : 1000;
                T_cut_min += mv.dist / F;
                weightedPow += mv.power * mv.dist;
                prevWasCut = true;
            }
        }

        const T_pierce_min = (n_pierces * dwellMs) / 60000;
        const T_total = T_cut_min + T_rapid_min + T_pierce_min;

        const totalCutDist = stats.totalCutLength;
        const P_avg =
            totalCutDist > 0 ? 100 * (weightedPow / (S_max * totalCutDist)) : 0;
        const E_wh = (P_avg * T_cut_min) / 60;

        const pct = (v) => (T_total > 0 ? (v / T_total) * 100 : 0);

        return {
            timing: {
                T_cut_min,
                T_rapid_min,
                T_pierce_min,
                T_total,
                cutPct: pct(T_cut_min),
                rapidPct: pct(T_rapid_min),
                piercePct: pct(T_pierce_min),
            },
            counts: {
                cutMoves: moves.filter((m) => m.type !== "rapid").length,
                rapidMoves: moves.filter((m) => m.type === "rapid").length,
                arcMoves: moves.filter((m) => m.type === "arc").length,
                n_pierces,
                dwellMs,
            },
            distances: {
                cut: stats.totalCutLength,
                rapid: stats.totalRapidLength,
                total: stats.totalCutLength + stats.totalRapidLength,
            },
            file: {
                lines: stats.lineCount,
                moves: stats.moveCount,
                minFeed: stats.minFeed,
                maxFeed: stats.maxFeed,
                maxPower: stats.maxPower,
                unitMM: stats.unitMM,
                accel: stats.accel,
            },
            energy: { E_wh: E_wh.toFixed(3) },
        };
    }

    static formatTime(min) {
        if (min <= 0) return "0s";
        if (min < 0.017) return `${(min * 60000).toFixed(0)} ms`;
        if (min < 1) return `${(min * 60).toFixed(1)} s`;
        const h = Math.floor(min / 60);
        const m = Math.floor(min % 60);
        const s = Math.round((min * 60) % 60);
        if (h > 0) return `${h}h ${m}m ${s}s`;
        return `${m}m ${s}s`;
    }
}
