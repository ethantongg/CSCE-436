// server.js
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { verifyTrace, issueChallenge, consumeChallenge, isChallengeValid } = require('./verify');

const app = express();
app.use(cors());
app.use(express.json());

// Serve frontend static files from project root (index.html, script.js, style.css, assets/)
app.use(express.static(__dirname));

// Load template (already used by verify.js but keep for sanity)
const TEMPLATE_PATH = path.join(__dirname, 'template.json');
if (!fs.existsSync(TEMPLATE_PATH)) {
  console.error('Missing template.json - please add template.json to project root.');
  process.exit(1);
}

// Health
app.get('/ping', (req, res) => res.json({ ok: true }));

// Issue a challenge: returns challengeId and challenge metadata (rotation, scale)
app.get('/challenge', (req, res) => {
  const challenge = issueChallenge();
  // Only expose randomized parameters (not the template)
  res.json({
    challengeId: challenge.id,
    rotation: challenge.rotation,
    scale: challenge.scale,
    expiresAt: challenge.expiresAt
  });
});

// Verify endpoint
// Expect body: { path: [{x,y,t}, ...], canvas: { width, height }, challengeId }
app.post('/verify', (req, res) => {
  try {
    const { path: userPath, canvas, challengeId } = req.body;
    if (!challengeId || !isChallengeValid(challengeId)) {
      return res.status(400).json({ success: false, message: 'Invalid or expired challenge' });
    }
    if (!Array.isArray(userPath) || userPath.length < 4) {
      return res.status(400).json({ success: false, message: 'Path missing or too short' });
    }

    // Normalize x,y by canvas if given. Keep timestamps intact (t)
    const normalized = userPath.map(p => {
      if (canvas && canvas.width && canvas.height && typeof p.x === 'number' && typeof p.y === 'number') {
        return { x: p.x / canvas.width, y: p.y / canvas.height, t: p.t };
      }
      return { x: p.x, y: p.y, t: p.t };
    });

    // Read template from file and pass to verifyTrace (verifyTrace will apply the challenge's rotation/scale)
    const template = JSON.parse(fs.readFileSync(TEMPLATE_PATH, 'utf8'));

    const result = verifyTrace(normalized, template, challengeId);

    // consume challenge if verification succeeded OR to prevent replay attempts for either fail/pass attempt
    // For stronger security, you might only consume on success; here we consume on any attempt to avoid replays.
    consumeChallenge(challengeId);

    return res.json(result);
  } catch (err) {
    console.error('Error in /verify:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Motion CAPTCHA backend listening on ${PORT}`));
