/**
 * js/evaluate.js
 * --------------
 * Pure digital round-trip test. Uses per-column adaptive thresholding
 * to handle non-uniform image brightness (bright sky, dark foreground, etc).
 */
import {
  BLOCK_SIZE,
  START_MARKER,
  END_MARKER,
  ANCHOR_SIZE,
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

// Sample the center 50% of a block (10x10 for BLOCK_SIZE=20)
const CAL_SIZE = Math.floor(BLOCK_SIZE * 0.5);
function sampleBlock(data, W, bx, by) {
  const x0 = bx + Math.floor((BLOCK_SIZE - CAL_SIZE) / 2);
  const y0 = by + Math.floor((BLOCK_SIZE - CAL_SIZE) / 2);
  let sum = 0, count = 0;
  for (let y = y0; y < y0 + CAL_SIZE; y++) {
    for (let x = x0; x < x0 + CAL_SIZE; x++) {
      const i = (y * W + x) * 4;
      sum += data[i] + data[i+1] + data[i+2];
      count++;
    }
  }
  return count > 0 ? sum / count : 0;
}

evalBtn.addEventListener("click", () => {
  if (!loadedImg) return;

  const W = canvas.width;
  const H = canvas.height;
  const imageData = ctx.getImageData(0, 0, W, H);
  const data = imageData.data;

  // ── Exact same grid geometry as encoder ───────────────────────────────────
  const border     = ANCHOR_SIZE + BLOCK_SIZE;
  const cols       = Math.floor((W - 2 * border) / BLOCK_SIZE);
  const maxRows    = Math.floor((H - 2 * border) / BLOCK_SIZE);
  const gridW      = cols * BLOCK_SIZE;
  const gridX      = Math.round((W - gridW) / 2);

  if (cols < 1 || maxRows < 1) {
    return showRes("error", "❌ Image too small.");
  }

  // Find the correct gridY by finding calibration block with max brightness separation
  let bestGridY = -1, bestSep = -1;
  for (let r = 1; r <= maxRows; r++) {
    const gridH_try = r * BLOCK_SIZE;
    const gridY_try = Math.round((H - gridH_try) / 2);
    const calY_try  = gridY_try - BLOCK_SIZE - 4;
    if (calY_try < 0) continue;
    const b0 = sampleBlock(data, W, gridX,             calY_try);
    const b1 = sampleBlock(data, W, gridX + BLOCK_SIZE, calY_try);
    if (b1 - b0 > bestSep) { bestSep = b1 - b0; bestGridY = gridY_try; }
  }

  if (bestGridY < 0 || bestSep < 3) {
    return showRes("error",
      `❌ Could not detect calibration blocks. Best separation: ${bestSep.toFixed(2)}<br>
       Make sure you are uploading a PNG downloaded from the Encoder page.`);
  }

  const gridY = bestGridY;
  const calY  = gridY - BLOCK_SIZE - 4;
  const b0    = sampleBlock(data, W, gridX,             calY);
  const b1    = sampleBlock(data, W, gridX + BLOCK_SIZE, calY);
  const deltaSignal = b1 - b0; // actual measured brightness delta

  // ── Read all block brightnesses ───────────────────────────────────────────
  const brightGrid = []; // [row][col]
  for (let row = 0; row < maxRows; row++) {
    brightGrid[row] = [];
    for (let col = 0; col < cols; col++) {
      const bx = gridX + col * BLOCK_SIZE;
      const by = gridY + row * BLOCK_SIZE;
      brightGrid[row][col] = sampleBlock(data, W, bx, by);
    }
  }

  // ── Per-column adaptive threshold ─────────────────────────────────────────
  // For each column, average brightness = originalBrightness + p * deltaSignal
  // (where p = fraction of 1-bits in that column, ~0.5 for typical text).
  // Using the column mean as the threshold is adaptive to brightness gradients.
  const colMean = new Array(cols).fill(0);
  for (let col = 0; col < cols; col++) {
    for (let row = 0; row < maxRows; row++) colMean[col] += brightGrid[row][col];
    colMean[col] /= maxRows;
  }

  // ── Decode bits ───────────────────────────────────────────────────────────
  const allBits = [];
  for (let row = 0; row < maxRows; row++) {
    for (let col = 0; col < cols; col++) {
      allBits.push(brightGrid[row][col] > colMean[col] ? 1 : 0);
    }
  }

  const fullText = bitsToText(allBits);
  const startIdx = fullText.indexOf(START_MARKER);
  const endIdx   = fullText.indexOf(END_MARKER);

  const debugHtml = `
    <br><br><b>Debug Info:</b>
    <br>Image: ${W}×${H} &nbsp; Grid: (${gridX}, ${gridY}) &nbsp; Cols: ${cols} &nbsp; MaxRows: ${maxRows}
    <br>Cal b0: ${b0.toFixed(1)} &nbsp; Cal b1: ${b1.toFixed(1)} &nbsp; ΔSignal: ${deltaSignal.toFixed(1)}
    <br>Adaptive threshold: per-column mean (b0+b1 threshold was ${((b0+b1)/2).toFixed(1)})
    <br>First 48 bits: ${allBits.slice(0, 48).join('')}
    <br>Expected &lt;&lt;STEGO&gt;&gt; start: 001111000011110001010011010101000100010101000111
  `;

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const inner    = fullText.substring(startIdx + START_MARKER.length, endIdx);
    if (inner.length >= 1) {
      const secret  = inner.slice(0, -1);
      const storedCs   = inner.charCodeAt(inner.length - 1);
      const computedCs = xorChecksum(secret);
      if (computedCs === storedCs) {
        return showRes("success", `✅ Decoded: "${secret}"` + debugHtml);
      }
      return showRes("error", `❌ Checksum mismatch. Data may be corrupted.` + debugHtml);
    }
  }

  showRes("error", "❌ START/END markers not found." + debugHtml);
});

function showRes(type, html) {
  evalResult.style.display = "block";
  evalResult.innerHTML = html;
  evalResult.className = type === "success" ? "msg info" : "msg error";
}