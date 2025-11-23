let currentChallenge = null;

// get a challenge on load
async function fetchChallenge() {
  try {
    const resp = await fetch('/challenge');
    currentChallenge = await resp.json();
    console.log('challenge:', currentChallenge);
  } catch (err) {
    console.error('Failed to get challenge', err);
  }
}

window.addEventListener('load', () => {
  fetchChallenge();
});

function recordPoint(x, y) {
  const t = performance.now(); // high-resolution timestamp in ms
  path.push({ x, y, t });
}

// When sending for verification:
async function checkTrace() {
  if (!currentChallenge) {
    await fetchChallenge();
  }
  const resp = await fetch('/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      path,
      canvas: { width: canvas.width, height: canvas.height },
      challengeId: currentChallenge && currentChallenge.challengeId
    })
  });
  const data = await resp.json();
  console.log('verify response', data);
  // show feedback based on data.success and data.signals
  if (data.success) {
    alert('Passed!');
  } else {
    alert('Failed: ' + data.message + ' Signals: ' + JSON.stringify(data.signals));
    // request a new challenge after failure
    await fetchChallenge();
  }
}
