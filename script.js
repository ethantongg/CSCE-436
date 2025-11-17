const canvas = document.getElementById('traceCanvas');
const ctx = canvas.getContext('2d');

// Load outline image
const outline = new Image();
outline.src = 'assets/heart.png';

outline.onload = () => {
    // Draw once the image is loaded
    ctx.drawImage(outline, 0, 0, canvas.width, canvas.height);
};

let drawing = false;
let path = [];

canvas.addEventListener('mousedown', () => drawing = true);
canvas.addEventListener('mouseup', () => {
    drawing = false;
    checkTrace();
});
canvas.addEventListener('mousemove', draw);
canvas.addEventListener('touchstart', () => drawing = true);
canvas.addEventListener('touchend', () => {
    drawing = false;
    checkTrace();
});
canvas.addEventListener('touchmove', draw);

function draw(e) {
    if (!drawing) return;

    let rect = canvas.getBoundingClientRect();
    let x = e.clientX ? e.clientX - rect.left : e.touches[0].clientX - rect.left;
    let y = e.clientY ? e.clientY - rect.top : e.touches[0].clientY - rect.top;

    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'blue';
    ctx.beginPath();
    if (path.length > 0) {
        ctx.moveTo(path[path.length - 1].x, path[path.length - 1].y);
    } else {
        ctx.moveTo(x, y);
    }
    ctx.lineTo(x, y);
    ctx.stroke();

    path.push({x, y});
}

function checkTrace() {
    // Placeholder: simple length check
    if (path.length > 50) {
        document.getElementById('feedback').innerText = 'Success!';
    } else {
        document.getElementById('feedback').innerText = 'Try again.';
    }
}

document.getElementById('retryBtn').addEventListener('click', () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    path = [];
    document.getElementById('feedback').innerText = '';

    // Redraw the heart outline
    ctx.drawImage(outline, 0, 0, canvas.width, canvas.height);
});

