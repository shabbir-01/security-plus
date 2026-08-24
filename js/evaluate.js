/**
 * js/evaluate.js
 * --------------
 * Pure digital round-trip test: loads an encoded PNG and decodes it
 * using the EXACT same coordinate math as the encoder (no camera, no anchor search).
 * If the encoder is correct, this must always decode successfully.
 */
import {
  BLOCK_SIZE,
  DELTA,
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

evalBtn.addEventListener("click", () => {
  if (!loadedImg) return;

  const W = canvas.width;
  const H = canvas.height;
  const imageData = ctx.getImageData(0, 0, W, H);
  const data = imageData.data;

  // ── Reproduce EXACT same grid geometry as encoder ─────────────────────────
  const border    = ANCHOR_SIZE + BLOCK_SIZE;
  const maxBlocksX = Math.floor((W - 2 * border) / BLOCK_SIZE);
  const maxBlocksY = Math.floor((H - 2 * border) / BLOCK_SIZE);

  if (maxBlocksX < 1 || maxBlocksY < 1) {
    return showRes("error", "❌ Image too small to contain any encoding.");
  }

  const cols  = maxBlocksX;
  // We don't know exact rows without knowing the payload size,
  // so read all available rows and let the marker search find the end.
  const rows  = maxBlocksY;
  const gridW = cols * BLOCK_SIZE;
  // gridH depends on actual rows used, but gridX/gridY from center formula only
  // needs cols (gridH doesn't affect X centering).
  // We compute gridY assuming full height — will still sample correctly
  // because payload rows start at gridY regardless of how many rows were used.
  const gridX = Math.round((W - gridW) / 2);

  // ── Read calibration blocks (same positions as encoder) ───────────────────
  const CAL_SIZE = Math.floor(BLOCK_SIZE * 0.5); // 10px sample window

  function sampleBlock(bx, by) {
    // sample center CAL_SIZExCAL_SIZE pixels
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

  // To find gridY we need to search a small range, since we don't know
  // how many rows the payload used. Try every possible gridY for a grid
  // that fits at least 1 row, and pick the one whose calibration blocks
  // give the widest b0/b1 separation.
  let bestGridY = -1;
  let bestSep   = -1;

  for (let r = 1; r <= maxBlocksY; r++) {
    const gridH_try = r * BLOCK_SIZE;
    const gridY_try = Math.round((H - gridH_try) / 2);
    const calY_try  = gridY_try - BLOCK_SIZE - 4;

    if (calY_try < 0) continue;

    const b0_try = sampleBlock(gridX,             calY_try);
    const b1_try = sampleBlock(gridX + BLOCK_SIZE, calY_try);
    const sep    = b1_try - b0_try;

    if (sep > bestSep) {
      bestSep   = sep;
      bestGridY = gridY_try;
    }
  }

  if (bestGridY < 0 || bestSep < 5) {
    return showRes("error",
      `❌ Could not find calibration blocks.<br>Best b1-b0 separation found: ${bestSep.toFixed(2)}<br>Expected ≥ 5. The image may not be encoded, or DELTA is too small.`);
  }

  const gridY  = bestGridY;
  const calX   = gridX;
  const calY   = gridY - BLOCK_SIZE - 4;
  const b0     = sampleBlock(calX,             calY);
  const b1     = sampleBlock(calX + BLOCK_SIZE, calY);
  const thresh = (b0 + b1) / 2;

  // ── Decode all bits using exact pixel positions ────────────────────────────
  const allBits = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const bx = gridX + col * BLOCK_SIZE;
      const by = gridY + row * BLOCK_SIZE;
      const brightness = sampleBlock(bx, by);
      allBits.push(brightness > thresh ? 1 : 0);
    }
  }

  const fullText  = bitsToText(allBits);
  const startIdx  = fullText.indexOf(START_MARKER);
  const endIdx    = fullText.indexOf(END_MARKER);

  const debugHtml = `
    <br><br><b>Debug Info:</b>
    <br>Image size: ${W} × ${H}
    <br>Grid start: (${gridX}, ${gridY}) &nbsp; Grid cols: ${cols}
    <br>Cal b0 (0-bit): ${b0.toFixed(2)} &nbsp; Cal b1 (1-bit): ${b1.toFixed(2)} &nbsp; Separation: ${(b1-b0).toFixed(2)}
    <br>Threshold: ${thresh.toFixed(2)}
    <br>First 48 bits: ${allBits.slice(0, 48).join('')}
  `;

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const payloadAndChecksum = fullText.substring(startIdx + START_MARKER.length, endIdx);
    if (payloadAndChecksum.length >= 1) {
      const secretText   = payloadAndChecksum.slice(0, -1);
      const storedCs     = payloadAndChecksum.charCodeAt(payloadAndChecksum.length - 1);
      const computedCs   = xorChecksum(secretText);
      if (computedCs === storedCs) {
        return showRes("success", `✅ Decoded: "${secretText}"` + debugHtml);
      } else {
        return showRes("error", `❌ Checksum mismatch (stored ${storedCs}, computed ${computedCs}). Data corrupted.` + debugHtml);
      }
    }
  }

  showRes("error", "❌ START/END markers not found in decoded bits." + debugHtml);
});

function showRes(type, html) {
  evalResult.style.display = "block";
  evalResult.innerHTML = html;
  evalResult.className = type === "success" ? "msg info" : "msg error";
}