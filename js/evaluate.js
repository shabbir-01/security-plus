import { BLOCK_SIZE, START_MARKER, END_MARKER, ANCHOR_SIZE, textToBits, bitsToText, xorChecksum } from "./stego-config.js";

const evalInput = document.getElementById("eval-input");
const evalBtn = document.getElementById("eval-btn");
const evalResult = document.getElementById("eval-result");
const canvas = document.getElementById("eval-canvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });
let loadedImg = null;
const GAP = 4;
const targetBits = textToBits(START_MARKER);

evalInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onload = () => {
      loadedImg = img;
      evalBtn.disabled = false;
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      evalResult.style.display = "none";
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
});

function sampleBrightness(imageData, cx, cy, S_x, S_y) {
    const w = Math.max(1, Math.floor(S_x * BLOCK_SIZE * 0.5));
    const h = Math.max(1, Math.floor(S_y * BLOCK_SIZE * 0.5));
    const startX = Math.floor(cx - w/2);
    const startY = Math.floor(cy - h/2);
    let sum = 0, count = 0;
    for (let y = startY; y < startY + h; y++) {
        for (let x = startX; x < startX + w; x++) {
            if (x >= 0 && x < imageData.width && y >= 0 && y < imageData.height) {
                const idx = (y * imageData.width + x) * 4;
                sum += imageData.data[idx] + imageData.data[idx+1] + imageData.data[idx+2];
                count++;
            }
        }
    }
    return count > 0 ? sum / count : 0;
}

function isMagenta(r, g, b) {
    return r > 150 && b > 150 && g < r * 0.6 && g < b * 0.6;
}

evalBtn.addEventListener("click", () => {
  if (!loadedImg) return;
  
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  
  const pts = [];
  for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
          const i = (y * canvas.width + x) * 4;
          if (isMagenta(data[i], data[i+1], data[i+2])) pts.push({x, y});
      }
  }
  
  if (pts.length < 20) {
      showRes("error", "Failed: Could not find magenta anchor squares.");
      return;
  }
  
  let cx = 0, cy = 0;
  for(let p of pts) { cx += p.x; cy += p.y; }
  cx /= pts.length;
  cy /= pts.length;
  
  const qTL = [], qTR = [], qBL = [], qBR = [];
  for(let p of pts) {
      if (p.x < cx && p.y < cy) qTL.push(p);
      else if (p.x >= cx && p.y < cy) qTR.push(p);
      else if (p.x < cx && p.y >= cy) qBL.push(p);
      else qBR.push(p);
  }
  
  if (qTL.length < 5 || qTR.length < 5 || qBL.length < 5 || qBR.length < 5) {
      showRes("error", "Failed: Missing one or more corner anchors.");
      return;
  }
  
  function getBBox(qPts) {
      qPts.sort((a,b) => a.x - b.x);
      const minX = qPts[Math.floor(qPts.length * 0.1)].x;
      const maxX = qPts[Math.floor(qPts.length * 0.9)].x;
      qPts.sort((a,b) => a.y - b.y);
      const minY = qPts[Math.floor(qPts.length * 0.1)].y;
      const maxY = qPts[Math.floor(qPts.length * 0.9)].y;
      return { cx: (minX + maxX)/2, cy: (minY + maxY)/2 };
  }
  
  const tl = getBBox(qTL);
  const tr = getBBox(qTR);
  const bl = getBBox(qBL);
  const br = getBBox(qBR);
  
  const cam_dist_x = (tr.cx + br.cx)/2 - (tl.cx + bl.cx)/2;
  const cam_dist_y = (bl.cy + br.cy)/2 - (tl.cy + tr.cy)/2;
  
  let bestCols = -1;
  let minErrors = 999;
  let bestGeometry = null;

  // Exact 1:1 scale for evaluate tool since we are reading the raw file
  const S_x = 1; 
  const S_y = 1;
  
  // Since S_x = 1, we can compute cols and rows perfectly
  const cols = Math.round((cam_dist_x - 2*GAP - ANCHOR_SIZE) / BLOCK_SIZE);
  const rows = Math.round((cam_dist_y - 2*GAP - ANCHOR_SIZE) / BLOCK_SIZE);
  
  const gridX_cam = tl.cx + (GAP + ANCHOR_SIZE/2);
  const gridY_cam = tl.cy + (GAP + ANCHOR_SIZE/2);
  
  const cal0_cx = gridX_cam + (BLOCK_SIZE/2);
  const cal0_cy = gridY_cam - (4 + BLOCK_SIZE/2);
  const cal1_cx = gridX_cam + (BLOCK_SIZE + BLOCK_SIZE/2);
  const cal1_cy = gridY_cam - (4 + BLOCK_SIZE/2);
  
  const b0 = sampleBrightness(imageData, cal0_cx, cal0_cy, S_x, S_y);
  const b1 = sampleBrightness(imageData, cal1_cx, cal1_cy, S_x, S_y);
  const threshold = (b0 + b1) / 2;
  
  const totalBits = cols * rows;
  const allBits = [];
  for (let i = 0; i < totalBits; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const bx = gridX_cam + (col * BLOCK_SIZE + BLOCK_SIZE/2);
      const by = gridY_cam + (row * BLOCK_SIZE + BLOCK_SIZE/2);
      const b = sampleBrightness(imageData, bx, by, S_x, S_y);
      allBits.push(b > threshold ? 1 : 0);
  }
  
  const fullText = bitsToText(allBits);
  const startIdx = fullText.indexOf(START_MARKER);
  const endIdx = fullText.indexOf(END_MARKER);
  
  const debugText = `
    <br><br><b>Debug Info:</b>
    <br>b0 (0-bit ref): ${b0.toFixed(2)}
    <br>b1 (1-bit ref): ${b1.toFixed(2)}
    <br>Threshold: ${threshold.toFixed(2)}
    <br>First 30 bits read: ${allBits.slice(0, 30).join('')}
  `;

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      const payloadAndChecksum = fullText.substring(startIdx + START_MARKER.length, endIdx);
      if (payloadAndChecksum.length >= 1) {
          const secretText = payloadAndChecksum.substring(0, payloadAndChecksum.length - 1);
          const checksumChar = payloadAndChecksum.charCodeAt(payloadAndChecksum.length - 1);
          if (xorChecksum(secretText) === checksumChar) {
              showRes("success", `✅ Success! Decoded: "${secretText}"` + debugText);
              return;
          } else {
              showRes("error", "❌ Checksum failed. Data was corrupted." + debugText);
              return;
          }
      }
  }
  
  showRes("error", "❌ Missing Markers. Could not find <<STEGO>> or <<END>>." + debugText);
});

function showRes(type, htmlStr) {
  evalResult.style.display = "block";
  evalResult.innerHTML = htmlStr;
  evalResult.className = type === "success" ? "msg info" : "msg error";
}