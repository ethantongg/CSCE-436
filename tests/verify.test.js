// tests/verify.test.js
const fs = require('fs');
const path = require('path');
const {
  verifyTrace,
  issueChallenge,
  consumeChallenge,
  isChallengeValid,
  resampleSpatial,
  computeBotScore
} = require('../verify');

const template = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'template.json'), 'utf8'));

// deterministic small-noise generator so tests are repeatable
function deterministicNoise(i) {
  return ((i * 97) % 100 - 50) / 100000; // small amplitude ~±0.0005
}

// attach timestamps in ms (ms relative)
function attachTimes(points, startMs, totalMs) {
  const out = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const t = startMs + (i / (n - 1)) * totalMs;
    out.push({ x: points[i].x, y: points[i].y, t });
  }
  return out;
}

describe('verifyTrace algorithm', () => {
  test('perfect match returns success', () => {
    // create user path identical to template and with timestamps
    const user = attachTimes(template, 1000, 1200); // 1.2s to draw
    // issue challenge and use it
    const ch = issueChallenge();
    const res = verifyTrace(user, template, ch.id);
    expect(res.shapePass).toBe(true);
    expect(res.success).toBe(true);
  });

  test('slightly noisy match passes', () => {
    // deterministic noise so test is stable
    const noisy = template.map((p, i) => ({
      x: p.x + deterministicNoise(i),
      y: p.y + deterministicNoise(i + 31)
    }));
    const user = attachTimes(noisy, 2000, 1500);
    const ch = issueChallenge();
    const res = verifyTrace(user, template, ch.id);
    expect(res.shapePass).toBe(true);
    expect(res.success).toBe(true);
    expect(typeof res.botScore).toBe('number');
  });

  test('different shape fails', () => {
    const line = Array.from({ length: template.length }, (_, i) => ({ x: i / (template.length - 1), y: 0.5 }));
    const user = attachTimes(line, 4000, 800);
    const ch = issueChallenge();
    const res = verifyTrace(user, template, ch.id);
    expect(res.shapePass).toBe(false);
    expect(res.success).toBe(false);
  });

  test('constant-speed perfect geometry (bot) is rejected by botScore', () => {
    // create a path equal to template coordinates but perfect timing and no jitter (bot-like)
    const n = template.length;
    const botPath = [];
    const start = 10000;
    const total = 80; // very fast 80 ms total (bot)
    for (let i = 0; i < n; i++) {
      botPath.push({ x: template[i].x, y: template[i].y, t: start + (i / (n - 1)) * total });
    }
    const ch = issueChallenge();
    const res = verifyTrace(botPath, template, ch.id);
    // shape likely passes but botScore should be high and success false
    expect(res.shapePass).toBe(true);
    expect(res.botScore).toBeGreaterThanOrEqual(3.0);
    expect(res.success).toBe(false);
  });

  test('replay protection: consumed challenge cannot be reused', () => {
    const user = attachTimes(template, 20000, 800);
    const ch = issueChallenge();
    const res1 = verifyTrace(user, template, ch.id);
    // simulate consume by server
    consumeChallenge(ch.id);
    const res2 = verifyTrace(user, template, ch.id);
    // first could be true (if not consumed by verifyTrace itself), second must fail challenge validity
    expect(res2.success).toBe(false);
  });
});
