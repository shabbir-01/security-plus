import {
    BLOCK_SIZE,
    START_MARKER,
    END_MARKER,
    ANCHOR_COLOR,
    ANCHOR_SIZE,
    textToBits,
    bitsToText,
    xorChecksum
} from './stego-config.js';

const GAP = 4;
const targetBits = textToBits(START_MARKER);

const video = document.getElementById('video-preview');
const canvas = document.getElementById('processing-canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const statusArea = document.getElementById('status-area');
const statusText = document.getElementById('status-text');
const hintText = document.getElementById('hint-text');
const successMessage = document.getElementById('success-message');
const decodedTextDiv = document.getElementById('decoded-text');
const restartBtn = document.getElementById('restart-btn');

let scanning = true;
let lastAnchorTime = Date.now();
let decodeAttempts = 0;
let lastDecodedMessage = null;

// Initialize Camera
async function initCamera() {
    try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error("navigator.mediaDevices is undefined. This usually means you are accessing the page via HTTP on a mobile device (non-localhost) instead of HTTPS.");
        }
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
        });
        video.srcObject = stream;
        
        // Wait for video to start playing
        video.addEventListener('loadeddata', () => {
            // Set canvas size for processing (downscaled for performance)
            canvas.width = 640;
            canvas.height = Math.floor(640 * (video.videoHeight / video.videoWidth));
            requestAnimationFrame(scanLoop);
        });
    } catch (err) {
        setStatus('error', 'Camera access denied');
        if (err.message.includes("undefined")) {
             hintText.innerText = 'HTTPS is required on mobile devices. Please deploy to Vercel (or use ngrok/localtunnel) to test on your phone.';
        } else {
             hintText.innerText = 'Please grant camera permissions and reload.';
        }
        console.error('Camera error:', err);
    }
}

function setStatus(state, text) {
    statusArea.className = `status-${state}`;
    statusText.innerText = text;
}

function isMagenta(r, g, b) {
    // Magenta is dominant in red and blue, low in green
    return r > 150 && b > 150 && g < r * 0.6 && g < b * 0.6;
}

function sampleBrightness(imageData, cx, cy, S_x, S_y) {
    const w = Math.max(1, Math.floor(S_x * BLOCK_SIZE * 0.5));
    const h = Math.max(1, Math.floor(S_y * BLOCK_SIZE * 0.5));
    const startX = Math.floor(cx - w/2);
    const startY = Math.floor(cy - h/2);
    
    let sum = 0;
    let count = 0;
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

function scanFrame() {
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    
    const pts = [];
    for (let y = 0; y < canvas.height; y+=2) { // Step by 2 for speed
        for (let x = 0; x < canvas.width; x+=2) {
            const i = (y * canvas.width + x) * 4;
            if (isMagenta(data[i], data[i+1], data[i+2])) {
                pts.push({x, y});
            }
        }
    }
    
    if (pts.length < 20) return null; // Not enough magenta
    
    // Find crosshairs
    let cx = 0, cy = 0;
    for(let p of pts) { cx += p.x; cy += p.y; }
    cx /= pts.length;
    cy /= pts.length;
    
    // Quadrants
    const qTL = [], qTR = [], qBL = [], qBR = [];
    for(let p of pts) {
        if (p.x < cx && p.y < cy) qTL.push(p);
        else if (p.x >= cx && p.y < cy) qTR.push(p);
        else if (p.x < cx && p.y >= cy) qBL.push(p);
        else qBR.push(p);
    }
    
    if (qTL.length < 5 || qTR.length < 5 || qBL.length < 5 || qBR.length < 5) return null;
    
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
    
    if (cam_dist_x < 50 || cam_dist_y < 50) return null;

    let bestCols = -1;
    let minErrors = 999;
    let bestGeometry = null;

    for (let c = 10; c <= 100; c++) {
        const orig_cx_dist = c * BLOCK_SIZE + 2 * GAP + ANCHOR_SIZE;
        const S_x = cam_dist_x / orig_cx_dist;
        
        const orig_cy_dist_est = cam_dist_y / S_x;
        const r = Math.round((orig_cy_dist_est - 2 * GAP - ANCHOR_SIZE) / BLOCK_SIZE);
        if (r < 1) continue;
        
        const orig_cy_dist = r * BLOCK_SIZE + 2 * GAP + ANCHOR_SIZE;
        const S_y = cam_dist_y / orig_cy_dist;
        
        const gridX_cam = tl.cx + S_x * (GAP + ANCHOR_SIZE/2);
        const gridY_cam = tl.cy + S_y * (GAP + ANCHOR_SIZE/2);
        
        const cal0_cx = gridX_cam + S_x * (BLOCK_SIZE/2);
        const cal0_cy = gridY_cam - S_y * (4 + BLOCK_SIZE/2);
        const cal1_cx = gridX_cam + S_x * (BLOCK_SIZE + BLOCK_SIZE/2);
        const cal1_cy = gridY_cam - S_y * (4 + BLOCK_SIZE/2);
        
        const b0 = sampleBrightness(imageData, cal0_cx, cal0_cy, S_x, S_y);
        const b1 = sampleBrightness(imageData, cal1_cx, cal1_cy, S_x, S_y);
        const threshold = (b0 + b1) / 2;
        
        let errors = 0;
        for (let i = 0; i < targetBits.length; i++) {
            const col = i % c;
            const row = Math.floor(i / c);
            if (row >= r) break;
            
            const bx = gridX_cam + S_x * (col * BLOCK_SIZE + BLOCK_SIZE/2);
            const by = gridY_cam + S_y * (row * BLOCK_SIZE + BLOCK_SIZE/2);
            
            const b = sampleBrightness(imageData, bx, by, S_x, S_y);
            const bit = b > threshold ? 1 : 0;
            if (bit !== targetBits[i]) errors++;
        }
        
        if (errors < minErrors) {
            minErrors = errors;
            bestCols = c;
            bestGeometry = { cols: c, rows: r, S_x, S_y, gridX_cam, gridY_cam, threshold };
        }
    }
    
    if (bestGeometry && minErrors <= 4) {
        const { cols, rows, S_x, S_y, gridX_cam, gridY_cam, threshold } = bestGeometry;
        const totalBits = cols * rows;
        const allBits = [];
        
        for (let i = 0; i < totalBits; i++) {
            const col = i % cols;
            const row = Math.floor(i / cols);
            const bx = gridX_cam + S_x * (col * BLOCK_SIZE + BLOCK_SIZE/2);
            const by = gridY_cam + S_y * (row * BLOCK_SIZE + BLOCK_SIZE/2);
            const b = sampleBrightness(imageData, bx, by, S_x, S_y);
            allBits.push(b > threshold ? 1 : 0);
        }
        
        const fullText = bitsToText(allBits);
        const startIdx = fullText.indexOf(START_MARKER);
        const endIdx = fullText.indexOf(END_MARKER);
        
        if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
            const payloadAndChecksum = fullText.substring(startIdx + START_MARKER.length, endIdx);
            if (payloadAndChecksum.length >= 1) {
                const secretText = payloadAndChecksum.substring(0, payloadAndChecksum.length - 1);
                const checksumChar = payloadAndChecksum.charCodeAt(payloadAndChecksum.length - 1);
                
                if (xorChecksum(secretText) === checksumChar) {
                    return secretText;
                }
            }
        }
    }
    
    return false; // found anchors but failed to decode
}

let lastProcessTime = 0;

function scanLoop(timestamp) {
    if (!scanning) return;
    
    if (timestamp - lastProcessTime > 250) { // throttle to ~4 times a second
        lastProcessTime = timestamp;
        const result = scanFrame();
        
        if (result === null) {
            decodeAttempts = 0;
            // Check if we haven't seen anchors for a while
            if (Date.now() - lastAnchorTime > 3000) {
                setStatus('searching', 'Locating image...');
                hintText.innerText = 'Move closer or reduce glare/reflection';
            } else {
                setStatus('searching', 'Locating image...');
                hintText.innerText = '';
            }
        } else {
            lastAnchorTime = Date.now();
            
            if (typeof result === 'string') {
                if (result === lastDecodedMessage) {
                    decodeAttempts++;
                } else {
                    lastDecodedMessage = result;
                    decodeAttempts = 1;
                }
                
                setStatus('reading', 'Reading...');
                hintText.innerText = `Confirmed ${decodeAttempts}/3`;
                
                if (decodeAttempts >= 3) {
                    onSuccess(result);
                    return; // Stop loop
                }
            } else if (result === false) {
                decodeAttempts = 0;
                setStatus('reading', 'Reading...');
                hintText.innerText = 'Hold still...';
            }
        }
    }
    
    requestAnimationFrame(scanLoop);
}

function onSuccess(message) {
    scanning = false;
    setStatus('success', 'Success!');
    hintText.innerText = '';
    
    decodedTextDiv.innerText = message;
    successMessage.classList.remove('hidden');
    successMessage.style.display = 'block';
    
    if (navigator.vibrate) {
        navigator.vibrate([200, 100, 200]);
    }
}

restartBtn.addEventListener('click', () => {
    successMessage.style.display = 'none';
    lastDecodedMessage = null;
    decodeAttempts = 0;
    scanning = true;
    lastAnchorTime = Date.now();
    setStatus('searching', 'Point camera at the screen');
    hintText.innerText = '';
    requestAnimationFrame(scanLoop);
});

// Start
initCamera();
