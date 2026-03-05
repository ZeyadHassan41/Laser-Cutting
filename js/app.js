"use strict";

import { GCodeParser } from "./modules/gcodeParser.js";
import { LaserCalculator } from "./modules/laserCalculator.js";

// ── Dropzone wiring ───────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
    const zone = document.getElementById("dropzone");
    const input = document.getElementById("file-input");

    zone.addEventListener("click", () => input.click());
    zone.addEventListener(
        "keydown",
        (e) => (e.key === "Enter" || e.key === " ") && input.click(),
    );

    zone.addEventListener("dragover", (e) => {
        e.preventDefault();
        zone.classList.add("over");
    });
    zone.addEventListener("dragleave", () => zone.classList.remove("over"));
    zone.addEventListener("drop", (e) => {
        e.preventDefault();
        zone.classList.remove("over");
        run(e.dataTransfer.files[0]);
    });

    input.addEventListener("change", () => run(input.files[0]));
});

// ── Main flow ─────────────────────────────────────────────────────
async function run(file) {
    if (!file) return;

    const ext = file.name.split(".").pop().toLowerCase();
    const ok = ["nc", "gcode", "gc", "ngc", "cnc", "tap", "g"];
    if (!ok.includes(ext)) {
        showErr(
            `Unsupported file ".${ext}". Accepted: ${ok.map((e) => "." + e).join(", ")}`,
        );
        return;
    }

    hideErr();
    setWorking(true);

    try {
        const text = await file.text();
        const parsed = GCodeParser.parse(text);

        if (parsed.moves.length === 0) {
            showErr("No motion commands found. Is this a valid G-code file?");
            return;
        }

        const result = LaserCalculator.calculate(parsed);
        render(result, file);
    } catch (err) {
        showErr("Parse error: " + err.message);
        console.error(err);
    } finally {
        setWorking(false);
    }
}

// ── Render results ────────────────────────────────────────────────
function render(r, file) {
    const { timing, counts, distances, file: fi, energy } = r;

    // Hero time
    set("res-total", LaserCalculator.formatTime(timing.T_total));
    set("res-filename", file.name);

    // Three cards
    set("card-cut", LaserCalculator.formatTime(timing.T_cut_min));
    set("card-rapid", LaserCalculator.formatTime(timing.T_rapid_min));
    set("card-pierce", LaserCalculator.formatTime(timing.T_pierce_min));

    // Animated bars
    requestAnimationFrame(() => {
        setBar("bar-cut", timing.cutPct);
        setBar("bar-rapid", timing.rapidPct);
        setBar("bar-pierce", timing.piercePct);
        set("lbl-cut", timing.cutPct.toFixed(1) + "%");
        set("lbl-rapid", timing.rapidPct.toFixed(1) + "%");
        set("lbl-pierce", timing.piercePct.toFixed(1) + "%");
    });

    // Stats table
    set("st-cut-dist", fmtDist(distances.cut));
    set("st-rapid-dist", fmtDist(distances.rapid));
    set("st-total-dist", fmtDist(distances.total));
    set("st-pierces", counts.n_pierces.toLocaleString());
    set("st-cut-moves", counts.cutMoves.toLocaleString());
    set("st-arc-moves", counts.arcMoves.toLocaleString());
    set("st-rapid-moves", counts.rapidMoves.toLocaleString());
    set("st-lines", fi.lines.toLocaleString());
    set(
        "st-feed-range",
        fi.minFeed > 0
            ? `${fi.minFeed.toFixed(0)}–${fi.maxFeed.toFixed(0)} mm/min`
            : `${fi.maxFeed.toFixed(0)} mm/min`,
    );
    set("st-max-power", fi.maxPower > 0 ? `S${fi.maxPower}` : "—");
    set("st-dwell", counts.dwellMs > 0 ? `${counts.dwellMs} ms` : "none");
    set("st-energy", energy.E_wh + " Wh");
    set("st-units", fi.unitMM ? "mm (G21)" : "inches (G20)");

    // File size
    const sz =
        file.size < 1048576
            ? `${(file.size / 1024).toFixed(1)} KB`
            : `${(file.size / 1048576).toFixed(1)} MB`;
    set("st-filesize", sz);

    // Show panel
    const panel = document.getElementById("results");
    panel.classList.remove("hidden");
    panel.classList.add("pop");
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ── Helpers ───────────────────────────────────────────────────────
function set(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}

function setBar(id, pct) {
    const el = document.getElementById(id);
    if (el) el.style.width = Math.max(0, Math.min(100, pct)) + "%";
}

function fmtDist(mm) {
    if (mm >= 1000) return (mm / 1000).toFixed(2) + " m";
    return mm.toFixed(1) + " mm";
}

function setWorking(on) {
    const zone = document.getElementById("dropzone");
    zone.classList.toggle("working", on);
    set(
        "drop-label",
        on ? "Analysing…" : "Drop G-code here or click to browse",
    );
}

function showErr(msg) {
    const el = document.getElementById("err");
    el.textContent = "⚠ " + msg;
    el.classList.remove("hidden");
}

function hideErr() {
    document.getElementById("err").classList.add("hidden");
}
