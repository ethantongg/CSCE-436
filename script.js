const canvas = document.getElementById('traceCanvas'); 
const ctx = canvas.getContext('2d');

const feedbackAndAttempts = document.getElementById('feedbackAndAttempts');
const continueBtn = document.getElementById('continueBtn');
const failRetryBtn = document.getElementById('failRetryBtn');
const retryBtn = document.getElementById('retryBtn');

let drawing = false;
let path = [];
let outlineEdges = [];

let maxAttempts = 5;
let attemptsLeft = maxAttempts;
let currentChallenge = null;
let currentOutlineImage = null;

// Bootstrap modal
const congratsModalEl = document.getElementById('congratsModal');
const congratsModal = new bootstrap.Modal(congratsModalEl, {});
continueBtn.addEventListener('click', () => congratsModal.show());

// ----------------------------------------------------------
// 1. Load challenge from server
// ----------------------------------------------------------
async function loadChallenge(newSession = false) {
    try {
        const res = await fetch('/challenge');
        const data = await res.json();
        currentChallenge = {
            id: data.challengeId,   // <- map server field
            rotation: data.rotation,
            scale: data.scale,
            expiresAt: data.expiresAt
        };


        const outline = new Image();
        outline.src = data.file;
        outline.onload = () => {
            currentOutlineImage = outline;
            resetCaptcha();
        };

        // Reset attempts for new challenge
        if (newSession) attemptsLeft = maxAttempts;

    } catch (err) {
        console.error('Error loading challenge:', err);
        feedbackAndAttempts.innerText = 'Error loading challenge';
        feedbackAndAttempts.style.backgroundColor = 'red';
        feedbackAndAttempts.style.color = 'white';
    }
}
loadChallenge();

// ----------------------------------------------------------
// 2. Drawing logic
// ----------------------------------------------------------
let canDraw = true;
let isNewStroke = true;
let strokeWidth = 4;
let strokeColor = 'white';

canvas.addEventListener('mousedown', startDraw);
canvas.addEventListener('mouseup', endDraw);
canvas.addEventListener('mousemove', draw);
canvas.addEventListener('touchstart', (e) => { e.preventDefault(); startDraw(e); });
canvas.addEventListener('touchmove', (e) => { e.preventDefault(); draw(e); });
canvas.addEventListener('touchend', (e) => { e.preventDefault(); endDraw(e); });

function startDraw() { if (!canDraw) return; drawing = true; isNewStroke = true; }
function endDraw() { drawing = false; }

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

    path.push({ x, y, t: time });
}

// ----------------------------------------------------------
// 3. Submit to backend for verification
// ----------------------------------------------------------
const submitBtn = document.getElementById('submitBtn');

submitBtn.addEventListener('click', async () => {
    if (path.length < 40) {
        feedbackAndAttempts.innerText = "Trace too short — try to trace the shape fully before submitting.";
        feedbackAndAttempts.style.backgroundColor = "#c57777";
        feedbackAndAttempts.style.color = "white";
        return;
    }

    try {
        const response = await fetch('/verify-trace', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userPath: path,
                challengeId: currentChallenge.id
            })

        });

        const result = await response.json();
        handleBackendResult(result);
    } catch (err) {
        console.error(err);
        feedbackAndAttempts.innerText = "Server error — try again later.";
        feedbackAndAttempts.style.backgroundColor = "#c57777";
        feedbackAndAttempts.style.color = "white";
    }
});


// ----------------------------------------------------------
// 4. Success & failure handling
// ----------------------------------------------------------
function handleBackendResult(result) {
    console.log('Backend verification result:', result);

    if (result.success) {
        feedbackAndAttempts.innerText = "Success!";
        feedbackAndAttempts.style.backgroundColor = "#aab18b";
        feedbackAndAttempts.style.color = "white";
        continueBtn.style.display = "inline-block";
        failRetryBtn.style.display = "none";
        submitBtn.style.display = "none";
        retryBtn.style.display = "none";
        canDraw = false;
    } else {
        attemptsLeft--;
        const msg = attemptsLeft > 0
            ? `${result.message} | Attempts left: ${attemptsLeft}`
            : "No attempts left. Test failed.";

        feedbackAndAttempts.innerText = msg;
        feedbackAndAttempts.style.backgroundColor = "#c57777";
        feedbackAndAttempts.style.color = "white";

        canDraw = false;
        failRetryBtn.style.display = attemptsLeft > 0 ? "inline-block" : "none";
        submitBtn.style.display = "none";
        continueBtn.style.display = "none";
    }
}


// ----------------------------------------------------------
// 5. Reset / retry
// ----------------------------------------------------------
failRetryBtn.addEventListener('click', () => resetCaptcha(false)); // retry same challenge
retryBtn.addEventListener('click', () => resetCaptcha(false));          // fetch new challenge

function resetCaptcha(newChallenge = false) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    path = [];
    canDraw = true;
    isNewStroke = true;

    feedbackAndAttempts.innerText = attemptsLeft > 0 ? `Attempts left: ${attemptsLeft}` : '';
    feedbackAndAttempts.style.backgroundColor = '';
    feedbackAndAttempts.style.color = '';

    // Draw outline
    if (currentOutlineImage) ctx.drawImage(currentOutlineImage, 0, 0, canvas.width, canvas.height);

    // Reset buttons
    submitBtn.style.display = attemptsLeft > 0 ? "inline-block" : "none";
    failRetryBtn.innerText = "Retry"; 
    failRetryBtn.style.display = "none";
    retryBtn.style.display = "inline-block";
    continueBtn.style.display = "none";
}

// ----------------------------------------------------------
// 6. Accessibility & screen reader
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
// 7. Extract outline edges for client-side scoring (optional)
function extractEdges() {
    outlineEdges = [];
    if (!currentOutlineImage) return;
    ctx.drawImage(currentOutlineImage, 0, 0, canvas.width, canvas.height);
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 0; i < imgData.length; i += 4) {
        const x = (i / 4) % canvas.width;
        const y = Math.floor((i / 4) / canvas.width);
        const r = imgData[i], g = imgData[i + 1], b = imgData[i + 2], alpha = imgData[i + 3];
        if (alpha > 50 && r < 100 && g < 100 && b < 100) {
            outlineEdges.push({ x, y });
        }
    }
}
