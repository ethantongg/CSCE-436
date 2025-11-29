const canvas = document.getElementById('traceCanvas');
const ctx = canvas.getContext('2d');

const feedbackAndAttempts = document.getElementById('feedbackAndAttempts');
const continueBtn = document.getElementById('continueBtn');
const failRetryBtn = document.getElementById('failRetryBtn');
const retryBtn = document.getElementById('retryBtn');

let drawing = false;
let path = [];
let outlineEdges = [];
let canDraw = true;

// Backend configuration
const API_BASE_URL = 'http://localhost:3000/api';
let sessionId = null;
let maxAttempts = 5;
let attemptsLeft = maxAttempts;

const congratsModalEl = document.getElementById('congratsModal');
const congratsModal = new bootstrap.Modal(congratsModalEl, {});

continueBtn.addEventListener('click', () => {
    congratsModal.show();
});

// ----------------------------------------------------------
// Backend API Functions
// ----------------------------------------------------------
async function initCaptchaSession() {
    try {
        const response = await fetch(`${API_BASE_URL}/captcha/init`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await response.json();
        
        if (data.success) {
            sessionId = data.sessionId;
            attemptsLeft = data.attemptsLeft;
            console.log('Session initialized:', sessionId);
        } else {
            console.error('Failed to initialize session');
        }
    } catch (error) {
        console.error('Error initializing session:', error);
    }
}

async function verifyTraceWithBackend(traceData, outlineType) {
    try {
        const response = await fetch(`${API_BASE_URL}/captcha/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionId,
                traceData,
                outlineType
            })
        });
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Error verifying trace:', error);
        return { success: false, error: 'Network error' };
    }
}

async function resetSessionOnBackend() {
    try {
        const response = await fetch(`${API_BASE_URL}/captcha/reset/${sessionId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await response.json();
        if (data.success) {
            attemptsLeft = data.attemptsLeft;
        }
    } catch (error) {
        console.error('Error resetting session:', error);
    }
}

// ----------------------------------------------------------
// 1. Load outline + extract edges
// ----------------------------------------------------------
const assetList = [
    { file: 'assets/heart.png', name: 'Heart' },
    { file: 'assets/diamond.png', name: 'Diamond' },
    { file: 'assets/smile.png', name: 'Smile' },
    { file: 'assets/triangle.png', name: 'Triangle' },
    { file: 'assets/crescent-moon.png', name: 'Crescent Moon' }
];

const outline = new Image();
let currentOutline = assetList[Math.floor(Math.random() * assetList.length)];
outline.src = currentOutline.file;
document.getElementById('imageName').innerText = currentOutline.name;

outline.onload = () => {
    drawOutline();
    extractEdges();
};

function drawOutline() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(outline, 0, 0, canvas.width, canvas.height);
}

function extractEdges() {
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    outlineEdges = [];

    for (let i = 0; i < imgData.length; i += 4) {
        const x = (i / 4) % canvas.width;
        const y = Math.floor((i / 4) / canvas.width);
        const r = imgData[i];
        const g = imgData[i + 1];
        const b = imgData[i + 2];
        const alpha = imgData[i + 3];

        if (alpha > 50 && r < 100 && g < 100 && b < 100) {
            outlineEdges.push({ x, y });
        }
    }
    console.log("Extracted edges:", outlineEdges.length);
}

// ----------------------------------------------------------
// 2. Mobile-optimized Input Handling
// ----------------------------------------------------------

// Prevent scrolling/bounce on touch
document.body.style.overflow = "hidden";
document.addEventListener("touchmove", e => e.preventDefault(), { passive: false });

const traceCanvas = canvas;      // naming clarity
const traceCtx = traceCanvas.getContext("2d");

let isNewStroke = true;

let strokeWidth = 8;            // ← larger mobile stroke
let strokeColor = "white";

// Normalize pointer coordinates
function getPoint(e) {
    const rect = traceCanvas.getBoundingClientRect();

    // Scale factors between CSS size and internal canvas resolution
    const scaleX = traceCanvas.width / rect.width;
    const scaleY = traceCanvas.height / rect.height;

    let clientX, clientY;

    if (e.touches && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
    } else {
        clientX = e.clientX;
        clientY = e.clientY;
    }

    return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY
    };
}


function startDraw(e) {
    if (!canDraw) return;
    e.preventDefault();

    drawing = true;
    isNewStroke = true;

    const { x, y } = getPoint(e);
    path.push({ x, y, time: performance.now() });
}

function endDraw(e) {
    if (!drawing) return;
    e.preventDefault();

    drawing = false;
}

function draw(e) {
    if (!drawing) return;
    e.preventDefault();

    const { x, y } = getPoint(e);
    const now = performance.now();

    traceCtx.lineWidth = strokeWidth;
    traceCtx.lineCap = "round";
    traceCtx.strokeStyle = strokeColor;

    traceCtx.beginPath();

    if (!isNewStroke && path.length > 0) {
        traceCtx.moveTo(path[path.length - 1].x, path[path.length - 1].y);
    } else {
        traceCtx.moveTo(x, y);
        isNewStroke = false;
    }

    traceCtx.lineTo(x, y);
    traceCtx.stroke();

    path.push({ x, y, time: now });
}

// Desktop pointer
traceCanvas.addEventListener("mousedown", startDraw);
traceCanvas.addEventListener("mouseup", endDraw);
traceCanvas.addEventListener("mousemove", draw);

// Mobile touch
traceCanvas.addEventListener("touchstart", startDraw, { passive: false });
traceCanvas.addEventListener("touchend", endDraw, { passive: false });
traceCanvas.addEventListener("touchmove", draw, { passive: false });

// ----------------------------------------------------------
// 3. Scoring functions
// ----------------------------------------------------------
function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

function scoreTraceAccuracy() {
    if (path.length === 0) return Infinity;
    let total = 0;
    for (let p of path) {
        let minDist = Infinity;
        for (let e of outlineEdges) {
            const d = distance(p, e);
            if (d < minDist) minDist = d;
        }
        total += minDist;
    }
    return total / path.length;
}

function scoreMovementNoise() {
    let velocities = [];
    for (let i = 1; i < path.length; i++) {
        const dx = path[i].x - path[i - 1].x;
        const dy = path[i].y - path[i - 1].y;
        const dt = path[i].time - path[i - 1].time;
        if (dt <= 0) continue;
        velocities.push(Math.sqrt(dx * dx + dy * dy) / dt);
    }
    if (velocities.length === 0) return Infinity;
    const mean = velocities.reduce((a, b) => a + b, 0) / velocities.length;
    const variance = velocities.reduce((s, v) => s + (v - mean) ** 2, 0) / velocities.length;
    return variance;
}

function scoreCoverage() {
    let hit = 0;
    const threshold = 20;
    for (let e of outlineEdges) {
        for (let p of path) {
            if (distance(e, p) < threshold) { hit++; break; }
        }
    }
    return hit / outlineEdges.length;
}

// ----------------------------------------------------------
// 4. Verification logic with backend
// ----------------------------------------------------------
const submitBtn = document.getElementById('submitBtn');

submitBtn.addEventListener('click', async () => {
    if (path.length < 40) {
        feedbackAndAttempts.innerText = "Trace too short – try to trace the shape fully before submitting.";
        feedbackAndAttempts.style.backgroundColor = "#c57777";
        feedbackAndAttempts.style.color = "white";
        return;
    }
    await checkTrace();
});

async function checkTrace() {
    if (path.length < 40) {
        feedbackAndAttempts.innerText = "Trace too short – keep going.";
        feedbackAndAttempts.style.backgroundColor = "red";
        feedbackAndAttempts.style.color = "white";
        return;
    }

    const accuracy = scoreTraceAccuracy();
    const jitter = scoreMovementNoise();
    const coverage = scoreCoverage();
    
    const traceData = {
        path,
        accuracy,
        jitter,
        coverage
    };
    
    console.log("Sending to backend - Accuracy:", accuracy, "Jitter:", jitter, "Coverage:", coverage);
    
    // Send to backend for verification
    const result = await verifyTraceWithBackend(traceData, currentOutline.name);
    
    if (result.verified) {
        feedbackAndAttempts.innerText = "Success! Verified by server.";
        feedbackAndAttempts.style.backgroundColor = "#aab18b";
        feedbackAndAttempts.style.color = "white";

        continueBtn.style.display = "inline-block";
        failRetryBtn.style.display = "none";
        submitBtn.style.display = "none";

        canDraw = false;
        retryBtn.style.display = "none";
    } else {
        attemptsLeft = result.attemptsLeft;
        handleFailure(result.reason || "Trace did not match the shape. Try again.");
    }
}

function handleFailure(message) {
    feedbackAndAttempts.innerText = attemptsLeft > 0 
        ? `${message} | Attempts left: ${attemptsLeft}` 
        : "No attempts left. Test failed.";
    feedbackAndAttempts.style.backgroundColor = "#c57777";
    feedbackAndAttempts.style.color = "white";

    canDraw = false;

    if (attemptsLeft > 0) {
        failRetryBtn.style.display = "inline-block";
        failRetryBtn.innerText = `RETRY`;
        failRetryBtn.style.color = "white";

        submitBtn.style.display = "none";
        continueBtn.style.display = "none";
    } else {
        failRetryBtn.style.display = "none";
        continueBtn.style.display = "none";
        submitBtn.style.display = "none";
    }
}

// ----------------------------------------------------------
// 5. Shared reset logic
// ----------------------------------------------------------
async function resetCaptcha() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    path = [];
    drawOutline();
    extractEdges();

    canDraw = true;
    isNewStroke = true;

    feedbackAndAttempts.innerText = '';
    feedbackAndAttempts.style.backgroundColor = '';
    feedbackAndAttempts.style.color = '';
    
    // Reset on backend
    await resetSessionOnBackend();
}

retryBtn.addEventListener('click', async () => {
    await resetCaptcha();
    retryBtn.style.display = "inline-block";
    failRetryBtn.style.display = "none";
    submitBtn.style.display = "inline-block";
});

failRetryBtn.addEventListener('click', async () => {
    await resetCaptcha();
    failRetryBtn.style.display = "none";
    submitBtn.style.display = "inline-block";
});

// ----------------------------------------------------------
// Accessibility & Screen Reader
// ----------------------------------------------------------
const accessibilityBtn = document.getElementById('accessibilityBtn');
accessibilityBtn.addEventListener('click', () => {
    strokeWidth = 10;
    strokeColor = '#87677b';
});

const screenReaderBtn = document.getElementById('screenReaderBtn');
screenReaderBtn.addEventListener('click', () => {
    const msg = "Trace the shape shown on the screen with your mouse or touch. Accuracy and coverage matter.";
    if ('speechSynthesis' in window) {
        speechSynthesis.speak(new SpeechSynthesisUtterance(msg));
    } else {
        alert(msg);
    }
});

// ----------------------------------------------------------
// Info Modal
// ----------------------------------------------------------
const infoBtn = document.getElementById('infoBtn');
const infoModal = document.getElementById('infoModal');
const closeModal = document.querySelector('.closeModal');

infoBtn.addEventListener('click', () => { infoModal.style.display = 'block'; });
closeModal.addEventListener('click', () => { infoModal.style.display = 'none'; });
window.addEventListener('click', e => { if (e.target === infoModal) infoModal.style.display = 'none'; });

// ----------------------------------------------------------
// Initialize session on page load
// ----------------------------------------------------------
initCaptchaSession();