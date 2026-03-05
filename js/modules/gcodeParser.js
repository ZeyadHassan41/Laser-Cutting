/**
 * gcodeParser.js
 * ─────────────────────────────────────────────────────────────────
 * Parses G-code files and extracts all motion commands.
 * Handles both CNC-style and laser-specific G-code dialects
 * (Marlin, Grbl, LightBurn, RDWorks, etc.)
 *
 * Supported motion codes:
 *   G0  — Rapid move (laser OFF)
 *   G1  — Linear feed move (laser ON if S>0 or M3/M4 active)
 *   G2  — CW arc
 *   G3  — CCW arc
 *
 * Laser power:
 *   M3/M4 Sxxx  — Spindle/laser on at power xxx (0–255 or 0–1000)
 *   M5          — Laser off
 *   S parameter on G1 line (inline power)
 */

"use strict";

export class GCodeParser {
    /**
     * @param {string} text  — raw G-code text
     * @returns {ParseResult}
     */
    static parse(text) {
        const lines = text.split(/\r?\n/);
        const moves = [];

        // Machine state
        let x = 0,
            y = 0,
            z = 0;
        let feedRate = 1000; // mm/min — cutting feed (G1), modal
        let rapidFeed = 0; // mm/min — G0 rapid feed (only set if F seen on a G0 line)
        let laserPower = 0; // 0–max
        let laserOn = false;
        let isAbsolute = true;
        let unitMM = true; // G21 = mm, G20 = inches

        // Stats
        let totalCutLength = 0;
        let totalRapidLength = 0;
        let totalArcLength = 0;
        let minFeed = Infinity,
            maxFeed = 0;
        let minPower = Infinity,
            maxPower = 0;
        let lineNumber = 0;
        let detectedDwellMs = 0;
        // Acceleration — read from M204 P/T (mm/s²). Default 3000 mm/s² (typical laser).
        let accel = 3000; // mm/s²

        for (const rawLine of lines) {
            lineNumber++;

            // Strip comments (; and ())
            const line = rawLine
                .replace(/;.*$/, "")
                .replace(/\([^)]*\)/g, "")
                .trim()
                .toUpperCase();
            if (!line) continue;

            // Parse all word-value pairs on this line
            const tokens = {};
            const re = /([A-Z])([-+]?[\d]*\.?[\d]+(?:[eE][+-]?\d+)?)/g;
            let m;
            while ((m = re.exec(line)) !== null) {
                tokens[m[1]] = parseFloat(m[2]);
            }

            // ── Unit mode ────────────────────────────────────────────────
            if ("G" in tokens) {
                const g = tokens["G"];
                if (g === 20) unitMM = false;
                if (g === 21) unitMM = true;
                if (g === 90) isAbsolute = true;
                if (g === 91) isAbsolute = false;
            }

            // ── Laser / spindle control ───────────────────────────────────
            if (line.includes("M3") || line.includes("M4")) {
                laserOn = true;
                if ("S" in tokens) laserPower = tokens["S"];
            }
            if (line.includes("M5")) {
                laserOn = false;
                laserPower = 0;
            }

            // Inline S on any line
            if ("S" in tokens && !line.startsWith("M")) {
                laserPower = tokens["S"];
            }

            // ── G4 dwell detection ───────────────────────────────────────
            if (tokens["G"] === 4) {
                if ("P" in tokens)
                    detectedDwellMs = Math.max(detectedDwellMs, tokens["P"]);
                else if ("S" in tokens)
                    detectedDwellMs = Math.max(
                        detectedDwellMs,
                        tokens["S"] * 1000,
                    );
            }

            // ── M204 acceleration ────────────────────────────────────────
            // M204 P = print accel, T = travel accel (mm/s²)
            if (line.startsWith("M204")) {
                const a = tokens["P"] ?? tokens["T"] ?? tokens["S"];
                if (a > 0) accel = a;
            }

            // ── Feed rate update ─────────────────────────────────────────
            // F on a G0 line = rapid speed; F on G1 line = cutting speed
            if ("F" in tokens) {
                const fVal = unitMM ? tokens["F"] : tokens["F"] * 25.4;
                if (tokens["G"] === 0) {
                    rapidFeed = fVal;
                } else {
                    feedRate = fVal;
                }
            }

            // ── Motion commands ──────────────────────────────────────────
            if (!("G" in tokens)) continue;
            const gCode = tokens["G"];
            if (![0, 1, 2, 3].includes(gCode)) continue;

            // Target position
            const toX = resolveAxis(tokens["X"], x, isAbsolute, unitMM);
            const toY = resolveAxis(tokens["Y"], y, isAbsolute, unitMM);
            const toZ = resolveAxis(tokens["Z"], z, isAbsolute, unitMM);

            if (gCode === 0) {
                const dist = dist3d(x, y, z, toX, toY, toZ);
                // Pass rapidFeed (0 if never set in file). Calculator applies fallback.
                totalRapidLength += dist;
                moves.push({
                    type: "rapid",
                    x: toX,
                    y: toY,
                    z: toZ,
                    dist,
                    feed: rapidFeed,
                });
            } else if (gCode === 1) {
                const dist = dist3d(x, y, z, toX, toY, toZ);
                const power = laserOn
                    ? laserPower
                    : "S" in tokens
                      ? tokens["S"]
                      : 0;

                if (power <= 0) {
                    // G1 with S0 = laser-off travel (LightBurn style).
                    // Treat as rapid — use cutting feed since no separate rapid declared.
                    totalRapidLength += dist;
                    moves.push({
                        type: "rapid",
                        x: toX,
                        y: toY,
                        z: toZ,
                        dist,
                        feed: feedRate,
                    });
                } else {
                    // Real cutting move
                    totalCutLength += dist;
                    if (feedRate > 0) {
                        minFeed = Math.min(minFeed, feedRate);
                        maxFeed = Math.max(maxFeed, feedRate);
                    }
                    if (power > 0) {
                        minPower = Math.min(minPower, power);
                        maxPower = Math.max(maxPower, power);
                    }
                    moves.push({
                        type: "cut",
                        x: toX,
                        y: toY,
                        z: toZ,
                        dist,
                        feed: feedRate,
                        power,
                        cutting: true,
                    });
                }
            } else if (gCode === 2 || gCode === 3) {
                // Arc move (G2/G3)
                const I =
                    tokens["I"] !== undefined
                        ? unitMM
                            ? tokens["I"]
                            : tokens["I"] * 25.4
                        : 0;
                const J =
                    tokens["J"] !== undefined
                        ? unitMM
                            ? tokens["J"]
                            : tokens["J"] * 25.4
                        : 0;
                const arcLen = calcArcLength(x, y, toX, toY, I, J, gCode === 2);
                const power = laserOn ? laserPower : 0;
                totalArcLength += arcLen;
                totalCutLength += arcLen;
                moves.push({
                    type: "arc",
                    x: toX,
                    y: toY,
                    z: toZ,
                    dist: arcLen,
                    feed: feedRate,
                    power,
                    cutting: power > 0,
                });
            }

            x = toX;
            y = toY;
            z = toZ;
        }

        // Bounding box
        const xs = moves.map((m) => m.x),
            ys = moves.map((m) => m.y);
        const bbox = {
            minX: Math.min(...xs),
            maxX: Math.max(...xs),
            minY: Math.min(...ys),
            maxY: Math.max(...ys),
        };

        return {
            moves,
            stats: {
                lineCount: lineNumber,
                moveCount: moves.length,
                totalCutLength,
                totalRapidLength,
                totalArcLength,
                minFeed: isFinite(minFeed) ? minFeed : 0,
                maxFeed: isFinite(maxFeed) ? maxFeed : feedRate,
                minPower: isFinite(minPower) ? minPower : 0,
                maxPower: isFinite(maxPower) ? maxPower : 0,
                detectedDwellMs,
                accel,
                bbox,
                unitMM,
            },
        };
    }
}

// ── Helpers ────────────────────────────────────────────────────────

function resolveAxis(val, current, absolute, unitMM) {
    if (val === undefined) return current;
    const v = unitMM ? val : val * 25.4;
    return absolute ? v : current + v;
}

function dist3d(x1, y1, z1, x2, y2, z2) {
    const dx = x2 - x1,
        dy = y2 - y1,
        dz = z2 - z1;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function calcArcLength(x1, y1, x2, y2, I, J, cw) {
    const cx = x1 + I,
        cy = y1 + J;
    const r = Math.sqrt(I * I + J * J);
    if (r < 1e-9) return dist3d(x1, y1, 0, x2, y2, 0);

    let a1 = Math.atan2(y1 - cy, x1 - cx);
    let a2 = Math.atan2(y2 - cy, x2 - cx);

    let sweep = cw ? a1 - a2 : a2 - a1;
    if (sweep < 0) sweep += 2 * Math.PI;
    if (sweep === 0) sweep = 2 * Math.PI; // full circle

    return r * sweep;
}
