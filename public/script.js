const canvas = document.getElementById('traceCanvas');
const ctx = canvas.getContext('2d');
const outlineCanvas = document.getElementById('outlineCanvas');
const outlineCtx = outlineCanvas.getContext('2d');

const feedbackAndAttempts = document.getElementById('feedbackAndAttempts');
const continueBtn = document.getElementById('continueBtn');
const failRetryBtn = document.getElementById('failRetryBtn');
const retryBtn = document.getElementById('retryBtn');

let drawing = false;
let path = [];
let outlineEdges = [];

// Session and backend configuration
const API_BASE_URL = 'http://localhost:3000/api';
let sessionId = null;
let attemptsLeft = 5;

const congratsModalEl = document.getElementById('congratsModal');
const congratsModal = new bootstrap.Modal(congratsModalEl, {});

continueBtn.addEventListener('click', () => {
    congratsModal.show();
});

// ----------------------------------------------------------
// Backend Integration Functions
// ----------------------------------------------------------
async function initializeSession() {
    try {
        const response = await fetch(`${API_BASE_URL}/captcha/init`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        const data = await response.json();
        if (data.success) {
            sessionId = data.sessionId;
            attemptsLeft = data.attemptsLeft;
            console.log('Session initialized:', sessionId);
        }
    } catch (error) {
        console.error('Failed to initialize session:', error);
        // Continue without backend for now
    }
}

async function verifyWithBackend(traceData) {
    if (!sessionId) {
        // Fallback to client-side verification if no backend
        return null;
    }
    
    try {
        const response = await fetch(`${API_BASE_URL}/captcha/verify`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                sessionId,
                traceData,
                outlineType: currentOutline.name
            })
        });
        
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Verification error:', error);
        return null;
    }
}

async function resetSession() {
    if (!sessionId) return;
    
    try {
        const response = await fetch(`${API_BASE_URL}/captcha/reset/${sessionId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        const data = await response.json();
        if (data.success) {
            attemptsLeft = data.attemptsLeft;
        }
    } catch (error) {
        console.error('Reset error:', error);
    }
}

// ----------------------------------------------------------
// Load outline + extract edges
// ----------------------------------------------------------
const assetList = [
    { file: 'assets/heart.png', name: 'Heart' },
    { file: 'assets/diamond.png', name: 'Diamond' },
    { file: 'assets/leaf.png', name: 'Leaf' },
    { file: 'assets/smile.png', name: 'Smile' },
    { file: 'assets/triangle.png', name: 'Triangle' },
    { file: 'assets/home.png', name: 'Home' },
    { file: 'assets/crescent-moon.png', name: 'Crescent Moon' }
];

const outline = new Image();
let currentOutline = assetList[Math.floor(Math.random() * assetList.length)];
outline.src = currentOutline.file;
document.getElementById('imageName').innerText = currentOutline.name;

console.log('Loading image:', outline.src);

outline.onload = () => {
    console.log('Image loaded successfully');
    drawOutline();
    extractEdges();
};

outline.onerror = (e) => {
    console.error('Failed to load image:', currentOutline.file);
    console.error('Full path attempted:', outline.src);
    feedbackAndAttempts.innerText = 'Error loading shape image. Check that assets folder exists.';
    feedbackAndAttempts.style.backgroundColor = '#c57777';
    feedbackAndAttempts.style.color = 'white';
};

function drawOutline() {
    outlineCtx.clearRect(0, 0, outlineCanvas.width, outlineCanvas.height);
    outlineCtx.drawImage(outline, 0, 0, outlineCanvas.width, outlineCanvas.height);
}

function extractEdges() {
    const imgData = outlineCtx.getImageData(0, 0, outlineCanvas.width, outlineCanvas.height).data;
    outlineEdges = [];

    for (let i = 0; i < imgData.length; i += 4) {
        const x = (i / 4) % outlineCanvas.width;
        const y = Math.floor((i / 4) / outlineCanvas.width);
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
// Input handling
// ----------------------------------------------------------
let canDraw = true;
let isNewStroke = true;

canvas.addEventListener('mousedown', startDraw);
canvas.addEventListener('mouseup', endDraw);
canvas.addEventListener('mousemove', draw);
canvas.addEventListener('touchstart', startDraw);
canvas.addEventListener('touchend', endDraw);
canvas.addEventListener('touchmove', draw);

let strokeWidth = 4;
let strokeColor = 'white';

function startDraw() {
    if (!canDraw) return;
    drawing = true;
    isNewStroke = true;
}

function endDraw() {
    drawing = false;
}

function draw(e) {
    if (!drawing) return;

    const rect = canvas.getBoundingClientRect();
    const clientX = e.clientX ?? e.touches[0].clientX;
    const clientY = e.clientY ?? e.touches[0].clientY;

    const x = (clientX - rect.left) * (canvas.width / rect.width);
    const y = (clientY - rect.top) * (canvas.height / rect.height);
    const time = performance.now();

    ctx.lineWidth = strokeWidth;
    ctx.lineCap = 'round';
    ctx.strokeStyle = strokeColor;

    ctx.beginPath();
    if (!isNewStroke && path.length > 0) {
        ctx.moveTo(path[path.length - 1].x, path[path.length - 1].y);
    } else {
        ctx.moveTo(x, y);
        isNewStroke = false;
    }

    ctx.lineTo(x, y);
    ctx.stroke();

    path.push({ x, y, time });
}

// ----------------------------------------------------------
// Scoring functions
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
// Verification logic with backend integration
// ----------------------------------------------------------
const submitBtn = document.getElementById('submitBtn');

submitBtn.addEventListener('click', async () => {
    if (path.length < 40) {
        feedbackAndAttempts.innerText = "Trace too short – try to trace the shape fully before submitting.";
        feedbackAndAttempts.style.backgroundColor = "#c57777";
        feedbackAndAttempts.style.color = "white";
        return;
    }
    
    submitBtn.disabled = true;
    submitBtn.innerText = "Verifying...";
    
    await checkTrace();
    
    submitBtn.disabled = false;
    submitBtn.innerText = "SUBMIT";
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
    
    console.log("Accuracy:", accuracy, "Jitter:", jitter, "Coverage:", coverage);

    // Try backend verification first
    const traceData = {
        path: path,
        accuracy: accuracy,
        jitter: jitter,
        coverage: coverage,
        pathLength: path.length
    };

    const result = await verifyWithBackend(traceData);

    // Use backend result if available
    if (result !== null) {
        if (result.success && result.verified) {
            feedbackAndAttempts.innerText = "Success! Verified by server.";
            feedbackAndAttempts.style.backgroundColor = "#aab18b";
            feedbackAndAttempts.style.color = "white";

            continueBtn.style.display = "inline-block";
            failRetryBtn.style.display = "none";
            submitBtn.style.display = "none";

            canDraw = false;
            retryBtn.style.display = "none";
            return;
        }

        if (!result.success) {
            attemptsLeft = result.attemptsLeft || 0;
            handleFailure(result.reason || result.error || "Verification failed");
            return;
        }
    }

    // Fallback to client-side verification
    if (coverage < 0.70) { handleFailure("You traced too little of the shape."); return; }
    if (accuracy < 4 && jitter < 0.0015) { handleFailure("Movement too perfect – suspicious."); return; }

    if (accuracy < 25 && coverage >= 0.70) {
        feedbackAndAttempts.innerText = "Success!";
        feedbackAndAttempts.style.backgroundColor = "#aab18b";
        feedbackAndAttempts.style.color = "white";

        continueBtn.style.display = "inline-block";
        failRetryBtn.style.display = "none";
        submitBtn.style.display = "none";

        canDraw = false;
        retryBtn.style.display = "none";
        return;
    }

    handleFailure("Trace did not match the shape. Try again.");
}

function handleFailure(message) {
    attemptsLeft--;

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
// Reset logic
// ----------------------------------------------------------
async function resetCaptcha() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    outlineCtx.clearRect(0, 0, outlineCanvas.width, outlineCanvas.height);
    path = [];
    
    drawOutline();
    extractEdges();

    canDraw = true;
    isNewStroke = true;

    feedbackAndAttempts.innerText = '';
    feedbackAndAttempts.style.backgroundColor = '';
    feedbackAndAttempts.style.color = '';
    
    await resetSession();
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
// Accessibility features
// ----------------------------------------------------------
const accessibilityBtn = document.getElementById('accessibilityBtn');

accessibilityBtn.addEventListener('click', () => {
    strokeWidth = 5;
    strokeColor = '#3e3e3e';
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
initializeSession();