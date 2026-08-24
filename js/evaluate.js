/**
 * js/evaluate.js
 * --------------
 * Pure digital round-trip verification of the steganography encoding.
 * Uses START_MARKER-calibrated thresholding: since we know the first 72 bits
 * must decode to "<<STEGO>>", we read those block brightnesses, separate them
 * into expected-0 and expected-1 groups, and compute the exact threshold.
 * This is reliable regardless of where in the image the payload sits.
 */
import {
  BLOCK_SIZE,
  START_MARKER,
  END_MARKER,
  ANCHOR_SIZE,
  textToBits,
  bitsToText,
  xorChecksum,
} from "./stego-config.js";

const evalInput  = document.getElementById("eval-input");
const evalBtn    = document.getElementById("eval-btn");
const evalResult = document.getElementById("eval-result");
const canvas     = document.getElementById("eval-canvas");
const ctx        = canvas.getContext("2d", { willReadFrequently: true });
let loadedImg = null;

evalInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onload = () => {
      loadedImg = img;
      evalBtn.disabled = false;
      canvas.width  = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      evalResult.style.display = "none";
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
});

// Sample center 50% of a BLOCK_SIZE block (10x10 for 20px blocks)
const SAMPLE = Math.floor(BLOCK_SIZE * 0.5);
function sampleBlock(data, W, H, bx, by) {
  const x0 = bx + Math.floor((BLOCK_SIZE - SAMPLE) / 2);
  const y0 = by + Math.floor((BLOCK_SIZE - SAMPLE) / 2);
  let sum = 0, count = 0;
  for (let y = y0; y < y0 + SAMPLE && y < H; y++) {
    for (let x = x0; x < x0 + SAMPLE && x < W; x++) {
      const i = (y * W + x) * 4;
      sum += data[i] + data[i+1] + data[i+2];
      count++;
    }
  }
  return count > 0 ? sum / count : -1; // -1 signals out-of-bounds
}

evalBtn.addEventListener("click", () => {
  if (!loadedImg) return;

  const W = canvas.width;
  const H = canvas.height;
  const imageData = ctx.getImageData(0, 0, W, H);
  const data = imageData.data;

  // ── Exact grid layout (mirrors encoder exactly) ───────────────────────────
  const border  = ANCHOR_SIZE + BLOCK_SIZE;
  const cols    = Math.floor((W - 2 * border) / BLOCK_SIZE);
  const maxRows = Math.floor((H - 2 * border) / BLOCK_SIZE);
  const gridW   = cols * BLOCK_SIZE;
  const gridX   = Math.round((W - gridW) / 2);

  if (cols < 1 || maxRows < 1) {
    return showRes("error", "❌ Image too small to contain any encoding.");
  }

  // ── Find correct gridY by maximising calibration block brightness gap ─────
  let bestGridY = -1, bestSep = -1;
  for (let r = 1; r <= maxRows; r++) {
    const gridH_try = r * BLOCK_SIZE;
    const gY_try   = Math.round((H - gridH_try) / 2);
    const calY_try = gY_try - BLOCK_SIZE - 4;
    if (calY_try < 0) continue;
    const b0 = sampleBlock(data, W, H, gridX,             calY_try);
    const b1 = sampleBlock(data, W, H, gridX + BLOCK_SIZE, calY_try);
    if (b0 < 0 || b1 < 0) continue;
    if (b1 - b0 > bestSep) { bestSep = b1 - b0; bestGridY = gY_try; }
  }

  if (bestGridY < 0 || bestSep < 3) {
    return showRes("error",
      `❌ Could not detect calibration blocks (best separation: ${bestSep.toFixed(2)}).<br>
       Upload a PNG that was downloaded from the encoder page.`);
  }

  const gridY = bestGridY;
  const calY  = gridY - BLOCK_SIZE - 4;
  const b0cal = sampleBlock(data, W, H, gridX,             calY);
  const b1cal = sampleBlock(data, W, H, gridX + BLOCK_SIZE, calY);

  // ── START_MARKER calibration ───────────────────────────────────────────────
  // We know exactly what the first 72 bits must decode to: <<STEGO>>
  // Split those block brightnesses into "should be 0" and "should be 1" groups
  // and find the threshold that perfectly separates them.
  const markerBits = textToBits(START_MARKER); // 72 bits
  const vals0 = [], vals1 = [];

  for (let i = 0; i < markerBits.length; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const bx  = gridX + col * BLOCK_SIZE;
    const by  = gridY + row * BLOCK_SIZE;
    const b   = sampleBlock(data, W, H, bx, by);
    if (b < 0) continue;
    if (markerBits[i] === 0) vals0.push(b);
    else vals1.push(b);
  }

  const maxB0 = Math.max(...vals0);
  const minB1 = Math.min(...vals1);
  const thresh = (maxB0 + minB1) / 2;

  // Check if the signal is strong enough to decode reliably
  const separation = minB1 - maxB0;

  // ── Decode all safe rows ───────────────────────────────────────────────────
  // Only read rows that fully fit within the image
  const safeRows = Math.min(maxRows, Math.floor((H - gridY) / BLOCK_SIZE));
  const allBits  = [];

  for (let row = 0; row < safeRows; row++) {
    for (let col = 0; col < cols; col++) {
      const bx = gridX + col * BLOCK_SIZE;
      const by = gridY + row * BLOCK_SIZE;
      const b  = sampleBlock(data, W, H, bx, by);
      allBits.push(b > thresh ? 1 : 0);
    }
  }

  // ── Search for markers and verify ─────────────────────────────────────────
  const fullText = bitsToText(allBits);
  const startIdx = fullText.indexOf(START_MARKER);
  const endIdx   = fullText.indexOf(END_MARKER);

  const debugHtml = `
    <br><br><b>Debug Info:</b>
    <br>Image: ${W}×${H} — Grid: (${gridX}, ${gridY}) — Cols: ${cols} — SafeRows: ${safeRows}
    <br>Cal b0: ${b0cal.toFixed(1)} — Cal b1: ${b1cal.toFixed(1)} — Cal Δ: ${(b1cal-b0cal).toFixed(1)}
    <br>Marker b0 max: ${maxB0.toFixed(1)} — Marker b1 min: ${minB1.toFixed(1)} — Gap: ${separation.toFixed(1)}
    <br>Threshold: ${thresh.toFixed(1)}
    <br>First 72 bits decoded: ${allBits.slice(0, 72).join('')}
    <br>Expected: &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; 001111000011110001010011010101000100010101000111011111000011111000111110
  `;

  if (separation < 0) {
    return showRes("error",
      `❌ Signal too weak — marker 0-bits and 1-bits overlap in brightness.<br>
       The encoding may have been made with a very small DELTA, or the image was JPEG-compressed.
       <br>Gap between classes: ${separation.toFixed(1)} (must be > 0)` + debugHtml);
  }

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const inner = fullText.substring(startIdx + START_MARKER.length, endIdx);
    if (inner.length >= 1) {
      const secret     = inner.slice(0, -1);
      const storedCs   = inner.charCodeAt(inner.length - 1);
      const computedCs = xorChecksum(secret);
      if (computedCs === storedCs) {
        return showRes("success", `✅ Decoded successfully: "<b>${secret}</b>"` + debugHtml);
      }
      return showRes("error",
        `❌ Checksum mismatch. Message may be partially corrupted.<br>
         Decoded text: "${secret}"` + debugHtml);
    }
  }

  showRes("error", "❌ START/END markers not found in decoded bits." + debugHtml);
});

function showRes(type, html) {
  evalResult.style.display = "block";
  evalResult.innerHTML = html;
  evalResult.className = type === "success" ? "msg info" : "msg error";
}