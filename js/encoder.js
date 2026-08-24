/**
 * js/encoder.js
 * -------------
 * Steganography encoder: hides a text message inside an image using
 * block-based brightness offsets that survive projector → camera capture.
 */

import {
  BLOCK_SIZE,
  DELTA,
  START_MARKER,
  END_MARKER,
  ANCHOR_COLOR,
  ANCHOR_SIZE,
  textToBits,
  xorChecksum,
} from './stego-config.js';

// Maximum longest-side dimension we will draw onto the working canvas.
// Keeps canvas pixel operations fast for large photos.
const MAX_LONG_SIDE = 1600;

function writeBitBlock(imageData, x0, y0, blockSize, bit, delta, width) {
  if (!bit) return; // Adds nothing for a '0' bit

  for (let y = y0; y < y0 + blockSize; y++) {
    for (let x = x0; x < x0 + blockSize; x++) {
      const idx = (y * width + x) * 4;
      imageData.data[idx]     += delta; // ADDS a small number to existing pixel
      imageData.data[idx + 1] += delta;
      imageData.data[idx + 2] += delta;
    }
  }
}

/**
 * encodeTextIntoImage(imageElement, secretText)
 * -----------------------------------------------
 * @param {HTMLImageElement} imageElement  A fully-loaded <img> element.
 * @param {string}           secretText   The message to hide.
 * @returns {{ canvas: HTMLCanvasElement, error: string|null }}
 *   On success: { canvas: <encoded canvas>, error: null }
 *   On failure: { canvas: null, error: '<human-readable reason>' }
 */
export function encodeTextIntoImage(imageElement, secretText) {
  // ── 1. Create offscreen canvas, cap to MAX_LONG_SIDE ───────────────────────
  const srcW = imageElement.naturalWidth;
  const srcH = imageElement.naturalHeight;

  let canvasW = srcW;
  let canvasH = srcH;
  const longSide = Math.max(srcW, srcH);
  if (longSide > MAX_LONG_SIDE) {
    const scale = MAX_LONG_SIDE / longSide;
    canvasW = Math.round(srcW * scale);
    canvasH = Math.round(srcH * scale);
  }

  const canvas = document.createElement('canvas');
  canvas.width  = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(imageElement, 0, 0, canvasW, canvasH);

  // ── 2. Build the full bit stream ────────────────────────────────────────────
  // Stream = START_MARKER + message + checksum byte + END_MARKER
  const checksum = xorChecksum(secretText);
  const checksumChar = String.fromCharCode(checksum);
  const fullPayload = START_MARKER + secretText + checksumChar + END_MARKER;
  const bits = textToBits(fullPayload);
  const totalBits = bits.length;

  // ── 3. Compute payload grid dimensions ─────────────────────────────────────
  const border = ANCHOR_SIZE + BLOCK_SIZE; // px gap around the payload grid

  const maxBlocksX = Math.floor((canvasW - 2 * border) / BLOCK_SIZE);
  const maxBlocksY = Math.floor((canvasH - 2 * border) / BLOCK_SIZE);

  if (maxBlocksX < 1 || maxBlocksY < 1) {
    return { canvas: null, error: 'Image is too small to encode anything.' };
  }

  const totalBlocks = maxBlocksX * maxBlocksY;
  if (totalBits > totalBlocks) {
    const maxChars = Math.floor((totalBlocks / 8)) -
                     START_MARKER.length - END_MARKER.length - 1; // -1 for checksum
    return {
      canvas: null,
      error: `Message is too long for this image. ` +
             `Maximum ~${Math.max(0, maxChars)} characters for this image size. ` +
             `Try a shorter message or a larger image.`,
    };
  }

  const cols = maxBlocksX;
  const rows = Math.ceil(totalBits / cols);

  const gridW = cols * BLOCK_SIZE;
  const gridH = rows * BLOCK_SIZE;

  const gridX = Math.round((canvasW - gridW) / 2);
  const gridY = Math.round((canvasH - gridH) / 2);

  // ── 4. Write encoded bits into the grid ────────────────────────────────────
  const imageData = ctx.getImageData(0, 0, canvasW, canvasH);

  for (let bitIdx = 0; bitIdx < totalBits; bitIdx++) {
    const bit = bits[bitIdx];
    const blockCol = bitIdx % cols;
    const blockRow = Math.floor(bitIdx / cols);

    const bx = gridX + blockCol * BLOCK_SIZE;
    const by = gridY + blockRow * BLOCK_SIZE;

    writeBitBlock(imageData, bx, by, BLOCK_SIZE, bit, DELTA, canvasW);
  }

  // ── 5. Write calibration blocks ────────────────────────────────────────────
  const calX = gridX;
  const calY = gridY - BLOCK_SIZE - 4; // 4px gap above grid
  const cal1X = calX + BLOCK_SIZE;
  const cal1Y = calY;

  // CAL0: do nothing (bit = 0)
  writeBitBlock(imageData, calX, calY, BLOCK_SIZE, 0, DELTA, canvasW);
  // CAL1: add DELTA (bit = 1)
  writeBitBlock(imageData, cal1X, cal1Y, BLOCK_SIZE, 1, DELTA, canvasW);

  // Commit pixel changes back to the canvas
  ctx.putImageData(imageData, 0, 0);

  // ── 6. Draw anchor squares ──────────────────────────────────────────────────
  const GAP = 4;
  ctx.fillStyle = `rgb(${ANCHOR_COLOR.r}, ${ANCHOR_COLOR.g}, ${ANCHOR_COLOR.b})`;
  ctx.fillRect(gridX - ANCHOR_SIZE - GAP, gridY - ANCHOR_SIZE - GAP, ANCHOR_SIZE, ANCHOR_SIZE);
  ctx.fillRect(gridX + gridW + GAP,       gridY - ANCHOR_SIZE - GAP, ANCHOR_SIZE, ANCHOR_SIZE);
  ctx.fillRect(gridX - ANCHOR_SIZE - GAP, gridY + gridH + GAP,       ANCHOR_SIZE, ANCHOR_SIZE);
  ctx.fillRect(gridX + gridW + GAP,       gridY + gridH + GAP,       ANCHOR_SIZE, ANCHOR_SIZE);

  return { canvas, error: null };
}