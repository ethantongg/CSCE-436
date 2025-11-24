const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { verifyTrace, issueChallenge, consumeChallenge, isChallengeValid } = require('./verify');

const app = express();
app.use(cors());
app.use(express.json());

// Serve frontend static files from project root
app.use(express.static(__dirname));

const TEMPLATE_PATH = path.join(__dirname, 'template.json');
if (!fs.existsSync(TEMPLATE_PATH)) {
  console.error('Missing template.json - please add template.json to project root.');
  process.exit(1);
}

// Health check
app.get('/ping', (req, res) => res.json({ ok: true }));

// Issue a new challenge
app.get('/challenge', (req, res) => {
  const challenge = issueChallenge();
  res.json({
    challengeId: challenge.id,
    rotation: challenge.rotation,
    scale: challenge.scale,
    expiresAt: challenge.expiresAt,
    file: '/assets/heart.png'
  });
});

// Verify trace
app.post('/verify-trace', (req, res) => {
  try {
    const { userPath, challengeId } = req.body;
    if (!challengeId || !isChallengeValid(challengeId)) {
      return res.status(400).json({ success: false, message: 'Invalid or expired challenge' });
    }
    if (!Array.isArray(userPath) || userPath.length < 4) {
      return res.status(400).json({ success: false, message: 'Path missing or too short' });
    }

    const template = JSON.parse(fs.readFileSync(TEMPLATE_PATH, 'utf8'));
    const result = verifyTrace(userPath, template, challengeId);

    return res.json(result);
  } catch (err) {
    console.error('Error in /verify-trace:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Motion CAPTCHA backend listening on ${PORT}`));
