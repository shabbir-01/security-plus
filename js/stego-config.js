/**
 * js/stego-config.js
 * ------------------
 * Shared steganography constants and helper utilities.
 * Imported by BOTH encoder.js (index.html) and decoder.js (scan.html).
 * Do NOT modify these values between phases — the decoder must use the same
 * constants as the encoder that produced the image.
 */

// ── Core encoding parameters ────────────────────────────────────────────────

/**
 * BLOCK_SIZE: Each encoded bit occupies a square of this many pixels per side.
 * A larger block is more robust against camera noise but reduces payload capacity.
 * 20px × 20px gives a good balance for projector/camera use.
 */
export const BLOCK_SIZE = 20;

/**
 * DELTA: Brightness offset (0–255) added to the R, G, and B channels of every
 * pixel in a "1" block. The decoder compares block brightness to a calibrated
 * threshold to distinguish 0-bits from 1-bits.
 * 20 is large enough to survive camera noise but small enough to be invisible
 * at normal viewing distance.
 */
export const DELTA = 20;

// ── Payload frame markers ────────────────────────────────────────────────────

/**
 * START_MARKER / END_MARKER: ASCII sentinel strings written into the bit stream
 * before and after the message payload. The decoder uses these to locate the
 * message within the decoded bit sequence and to know when to stop reading.
 */
export const START_MARKER = '<<STEGO>>';
export const END_MARKER   = '<<END>>';

// ── Anchor color ─────────────────────────────────────────────────────────────

/**
 * ANCHOR_COLOR: Solid magenta (255, 0, 255).
 * Used for the four corner squares that let the decoder locate the payload grid.
 * Magenta is chosen because it is rarely present in natural photographs and is
 * easy to detect with a simple RGB distance check.
 */
export const ANCHOR_COLOR = { r: 255, g: 0, b: 255 };

/**
 * ANCHOR_SIZE: Side length (in pixels) of each corner anchor square.
 * Should be large enough to be reliably detected in a camera frame.
 */
export const ANCHOR_SIZE = 16;

// ── Text ↔ bit-stream helpers ─────────────────────────────────────────────────

/**
 * textToBits(str) -> number[]
 * Converts a UTF-16 string to a flat array of 0/1 values.
 * Each character is encoded as its char-code in 8 bits, MSB first.
 *
 * Example: 'A' (char code 65 = 0b01000001)
 *   -> [0, 1, 0, 0, 0, 0, 0, 1]
 */
export function textToBits(str) {
  const bits = [];
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    // 8 bits per character, MSB first
    for (let bit = 7; bit >= 0; bit--) {
      bits.push((code >> bit) & 1);
    }
  }
  return bits;
}

/**
 * bitsToText(bits) -> string
 * Inverse of textToBits.  Converts a flat 0/1 array back to a string.
 * Ignores trailing bits that do not form a complete byte.
 */
export function bitsToText(bits) {
  let text = '';
  // Process 8 bits at a time
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let code = 0;
    for (let b = 0; b < 8; b++) {
      code = (code << 1) | bits[i + b];
    }
    text += String.fromCharCode(code);
  }
  return text;
}

// ── Checksum ──────────────────────────────────────────────────────────────────

/**
 * xorChecksum(str) -> number   (0-255)
 * Computes a 1-byte XOR checksum over all character codes in the string.
 * Written as the byte immediately before END_MARKER so the decoder can
 * verify that the decoded message was not corrupted by noise.
 *
 * Usage:
 *   Encoder writes: START_MARKER + message + chr(checksum) + END_MARKER
 *   Decoder reads back the sequence and confirms checksum matches.
 */
export function xorChecksum(str) {
  let acc = 0;
  for (let i = 0; i < str.length; i++) {
    acc ^= str.charCodeAt(i);
  }
  return acc; // value in range 0-255
}
