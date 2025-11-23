const canvas = document.getElementById('traceCanvas');
const ctx = canvas.getContext('2d');

const feedbackAndAttempts = document.getElementById('feedbackAndAttempts');
const continueBtn = document.getElementById('continueBtn');
const failRetryBtn = document.getElementById('failRetryBtn'); // retry-on-failure
const retryBtn = document.getElementById('retryBtn');

let drawing = false;
let path = [];
let outlineEdges = [];

// Attempt tracking
let maxAttempts = 5;
let attemptsLeft = maxAttempts;

const congratsModalEl = document.getElementById('congratsModal');
const congratsModal = new bootstrap.Modal(congratsModalEl, {});

continueBtn.addEventListener('click', () => {
    congratsModal.show();
});

// ----------------------------------------------------------
// 1. Load outline + extract edges
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
// 2. Input handling
// ----------------------------------------------------------
let canDraw = true;        // flag to enable/disable tracing
let isNewStroke = true;    // tracks if we need to moveTo start of stroke

canvas.addEventListener('mousedown', startDraw);
canvas.addEventListener('mouseup', endDraw);
canvas.addEventListener('mousemove', draw);

// canvas.addEventListener('touchstart', startDraw);
// canvas.addEventListener('touchend', endDraw);
// canvas.addEventListener('touchmove', draw);

canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    startDraw(e);
});
canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    draw(e);
});
canvas.addEventListener('touchend', (e) => {
    e.preventDefault();
    endDraw(e);
});

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

    const x = clientX - rect.left;
    const y = clientY - rect.top;
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
// 4. Verification logic with attempts
// ----------------------------------------------------------
const submitBtn = document.getElementById('submitBtn');

submitBtn.addEventListener('click', () => {
    if (path.length < 40) {
        feedbackAndAttempts.innerText = "Trace too short — try to trace the shape fully before submitting.";
        feedbackAndAttempts.style.backgroundColor = "#c57777";
        feedbackAndAttempts.style.color = "white";
        return;
    }
    checkTrace();
});

function checkTrace() {
    if (path.length < 40) {
        feedbackAndAttempts.innerText = "Trace too short — keep going.";
        feedbackAndAttempts.style.backgroundColor = "red";
        feedbackAndAttempts.style.color = "white";
        return;
    }

    const accuracy = scoreTraceAccuracy();
    const jitter = scoreMovementNoise();
    const coverage = scoreCoverage();
    console.log("Accuracy:", accuracy, "Jitter:", jitter, "Coverage:", coverage);

    if (coverage < 0.70) { handleFailure("You traced too little of the shape."); return; }
    if (accuracy < 4 && jitter < 0.0015) { handleFailure("Movement too perfect — suspicious."); return; }

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

    feedbackAndAttempts.innerText = attemptsLeft > 0 ? `${message} | Attempts left: ${attemptsLeft}` : "No attempts left. Test failed.";
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
function resetCaptcha() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    path = [];
    drawOutline();
    extractEdges();

    canDraw = true;
    isNewStroke = true;

    feedbackAndAttempts.innerText = '';
    feedbackAndAttempts.style.backgroundColor = '';
    feedbackAndAttempts.style.color = '';
}

// Top-right retry button
retryBtn.addEventListener('click', () => {
    resetCaptcha();
    retryBtn.style.display = "inline-block";
    failRetryBtn.style.display = "none";
});

// Fail-retry button
failRetryBtn.addEventListener('click', () => {
    resetCaptcha();
    failRetryBtn.style.display = "none";
    submitBtn.style.display = "inline-block";
});

// ----------------------------------------------------------
// Accessibility Button
// ----------------------------------------------------------
const accessibilityBtn = document.getElementById('accessibilityBtn');
let enlarged = false;
const outlineCanvas = document.getElementById('outlineCanvas');

accessibilityBtn.addEventListener('click', () => {
    strokeWidth = 5;
    strokeColor = '#3e3e3e';
});

// ----------------------------------------------------------
// Screen Reader Button
// ----------------------------------------------------------
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
