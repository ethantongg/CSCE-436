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
    expiresAt: challenge.expiresAt,
    file: '/assets/heart.png'
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

    // Read template from file and pass to verifyTrace (verifyTrace will apply the challenge's rotation/scale)
    const template = JSON.parse(fs.readFileSync(TEMPLATE_PATH, 'utf8'));
    const normalized = normalizeToTemplate(userPath, template, canvas);
    const xs = normalized.map(p => p.x);
    const ys = normalized.map(p => p.y);
    console.log("Normalized bounds:", Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys));



    const result = verifyTrace(normalized, template, challengeId);

    // consume challenge if verification succeeded OR to prevent replay attempts for either fail/pass attempt
    // For stronger security, you might only consume on success; here we consume on any attempt to avoid replays.
    //consumeChallenge(challengeId);

    return res.json(result);
  } catch (err) {
    console.error('Error in /verify:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Motion CAPTCHA backend listening on ${PORT}`));


function normalizeToTemplate(userPath, template, canvas) {
    const tmplXs = template.map(p => p.x);
    const tmplYs = template.map(p => p.y);
    const minX = Math.min(...tmplXs);
    const maxX = Math.max(...tmplXs);
    const minY = Math.min(...tmplYs);
    const maxY = Math.max(...tmplYs);

    const width = maxX - minX || 1;
    const height = maxY - minY || 1;

    // Map user path from canvas pixels to template 0–1 units
    return userPath.map(p => ({
        x: (p.x / canvas.width) * width + minX,
        y: (p.y / canvas.height) * height + minY,
        t: p.t
    }));
}


