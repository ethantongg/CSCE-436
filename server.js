const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { verifyTrace } = require('./verify');

const app = express();
app.use(cors());
app.use(express.json());

// Load template trace (array of {x,y} in normalized canvas coords 0..1)
const TEMPLATE_PATH = path.join(__dirname, 'template.json');
if (!fs.existsSync(TEMPLATE_PATH)) {
  console.error('Missing template.json. Create or copy template.json into project root.');
  process.exit(1);
}
const template = JSON.parse(fs.readFileSync(TEMPLATE_PATH, 'utf8'));

// Health
app.get('/ping', (req, res) => res.json({ ok: true }));

// Verify endpoint
// Expect body: { path: [{x,y}, ...], canvas: { width, height } }
// returns: { success: boolean, score: number, threshold: number, message: string }
app.post('/verify', (req, res) => {
  try {
    const { path: userPath, canvas } = req.body;
    if (!Array.isArray(userPath) || userPath.length === 0) {
      return res.status(400).json({ error: 'Invalid path' });
    }

    // Normalize userPath into 0..1 coordinates relative to provided canvas, if given
    let normalized = userPath.map(p => {
      // if canvas provided, use it; otherwise assume already normalized 0..1
      if (canvas && canvas.width && canvas.height) {
        return { x: p.x / canvas.width, y: p.y / canvas.height };
      }
      return { x: p.x, y: p.y };
    });

    // run verification
    const result = verifyTrace(normalized, template);

    return res.json(result);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal error' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Motion CAPTCHA backend listening on ${PORT}`));
