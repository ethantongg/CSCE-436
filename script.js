const canvas = document.getElementById('traceCanvas');
const ctx = canvas.getContext('2d');

const feedback = document.getElementById('feedback');
const continueBtn = document.getElementById('continueBtn');
const attemptsDisplay = document.getElementById('attemptsLeft');
const retryBtn = document.getElementById('retryBtn');

let drawing = false;
let path = [];
let outlineEdges = [];

// Attempt tracking
let maxAttempts = 5;
let attemptsLeft = maxAttempts;
attemptsDisplay.innerText = `Attempts left: ${attemptsLeft}`;

// ----------------------------------------------------------
// 1. Load outline + extract edges
// ----------------------------------------------------------

const outline = new Image();
outline.src = 'assets/heart.png';

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

canvas.addEventListener('mousedown', startDraw);
canvas.addEventListener('mouseup', endDraw);
canvas.addEventListener('mousemove', draw);
canvas.addEventListener('touchstart', startDraw);
canvas.addEventListener('touchend', endDraw);
canvas.addEventListener('touchmove', draw);

function startDraw() {
    drawing = true;
}

function endDraw() {
    drawing = false;
    checkTrace();
}

function draw(e) {
    if (!drawing) return;

    const rect = canvas.getBoundingClientRect();
    const clientX = e.clientX ?? e.touches[0].clientX;
    const clientY = e.clientY ?? e.touches[0].clientY;

    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const time = performance.now();

    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'blue';

    ctx.beginPath();
    if (path.length > 0) {
        ctx.moveTo(path[path.length - 1].x, path[path.length - 1].y);
    }
    ctx.lineTo(x, y);
    ctx.stroke();

    path.push({ x, y, time });
}

// ----------------------------------------------------------
// 3. Scoring functions
// ----------------------------------------------------------

function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

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
            if (distance(e, p) < threshold) {
                hit++;
                break;
            }
        }
    }
    return hit / outlineEdges.length;
}

// ----------------------------------------------------------
// 4. Verification logic with attempts
// ----------------------------------------------------------

function checkTrace() {
    if (path.length < 40) {
        feedback.innerText = "Trace too short — try again.";
        return;
    }

    const accuracy = scoreTraceAccuracy();
    const jitter = scoreMovementNoise();
    const coverage = scoreCoverage();

    console.log("Accuracy:", accuracy, "Jitter:", jitter, "Coverage:", coverage);

    // Not enough outline traced
    if (coverage < 0.70) {
        handleFailure("You traced too little of the shape.");
        return;
    }

    // Too perfect = likely bot
    if (accuracy < 4 && jitter < 0.0015) {
        handleFailure("Movement too perfect — suspicious.");
        return;
    }

    // Success
    if (accuracy < 25 && coverage >= 0.70) {
        feedback.innerText = "Success!";
        continueBtn.style.display = "inline-block";
        retryBtn.style.display = "none";
        attemptsDisplay.innerText = "";
        return;
    }

    handleFailure("Trace did not match the shape. Try again.");
}

function handleFailure(message) {
    attemptsLeft--;
    feedback.innerText = message;
    if (attemptsLeft > 0) {
        retryBtn.style.display = "inline-block";
        continueBtn.style.display = "none";
        attemptsDisplay.innerText = `Attempts left: ${attemptsLeft}`;
    } else {
        feedback.innerText = "No attempts left. Test failed.";
        retryBtn.style.display = "none";
        continueBtn.style.display = "none";
        attemptsDisplay.innerText = "";
    }
}

// ----------------------------------------------------------
// 5. Retry button
// ----------------------------------------------------------

retryBtn.addEventListener('click', () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    path = [];
    feedback.innerText = '';
    drawOutline();
    extractEdges();
});


// ----------------------------------------------------------
// Accessibility Button: enlarge/reduce canvas
// ----------------------------------------------------------
const accessibilityBtn = document.getElementById('accessibilityBtn');
let enlarged = false;

accessibilityBtn.addEventListener('click', () => {
    const scale = enlarged ? 1 : 1.5; // enlarge 1.5x
    canvas.width = 400 * scale;
    canvas.height = 400 * scale;
    outlineCanvas.width = canvas.width;
    outlineCanvas.height = canvas.height;
    drawOutline();
    extractEdges();
    path = []; // reset path
    enlarged = !enlarged;
});

// ----------------------------------------------------------
// Screen Reader Button: read instructions aloud
// ----------------------------------------------------------
const screenReaderBtn = document.getElementById('screenReaderBtn');
screenReaderBtn.addEventListener('click', () => {
    const msg = "Trace the shape shown on the screen with your mouse or touch. Accuracy and coverage matter.";
    if ('speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(msg);
        speechSynthesis.speak(utterance);
    } else {
        alert(msg); // fallback
    }
});

// ----------------------------------------------------------
// Info Modal
// ----------------------------------------------------------
const infoBtn = document.getElementById('infoBtn');
const infoModal = document.getElementById('infoModal');
const closeModal = document.querySelector('.closeModal');

infoBtn.addEventListener('click', () => {
    infoModal.style.display = 'block';
});

closeModal.addEventListener('click', () => {
    infoModal.style.display = 'none';
});

window.addEventListener('click', (e) => {
    if (e.target === infoModal) {
        infoModal.style.display = 'none';
    }
});
