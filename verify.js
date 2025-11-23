// verify.js
// Provides: verifyTrace(userPath, template, challengeId)
// Also: issueChallenge(), consumeChallenge(), isChallengeValid()
const crypto = require('crypto');

// ---- Configurable parameters ----
const RESAMPLE_POINTS = 64;
const SHAPE_THRESHOLD = 0.04; // RMSD threshold for shape acceptance (tuned tolerant)
const CHALLENGE_TTL_MS = 2 * 60 * 1000; // 2 minutes
const MIN_POINTS = 12; // minimum number of points required
// ----------------------------------

// In-memory challenge store (id => { rotation, scale, expiresAt, used })
const challenges = new Map();

// Utility: deterministic random small seed if needed (we'll use crypto)
function randFloat(min, max) {
  return min + Math.random() * (max - min);
}

function issueChallenge() {
  const id = crypto.randomBytes(12).toString('hex');
  const rotation = randFloat(-0.3, 0.3); // radians, small random rotation for frontend display
  const scale = randFloat(0.95, 1.05); // tiny scale jitter for frontend display
  const expiresAt = Date.now() + CHALLENGE_TTL_MS;
  const obj = { id, rotation, scale, expiresAt, used: false };
  challenges.set(id, obj);
  return obj;
}
function isChallengeValid(id) {
  const c = challenges.get(id);
  if (!c) return false;
  if (c.used) return false;
  if (Date.now() > c.expiresAt) {
    challenges.delete(id); // cleanup expired
    return false;
  }
  return true;
}
function consumeChallenge(id) {
  const c = challenges.get(id);
  if (!c) return;
  c.used = true;
  // optionally delete immediately to free memory
  challenges.delete(id);
}

// Geometry helpers
function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function resampleSpatial(path, n) {
  // path: array of {x,y,t?}
  if (path.length === 0) return Array.from({ length: n }, () => ({ x: 0, y: 0, t: 0 }));
  // cumulative distances
  const d = [0];
  for (let i = 1; i < path.length; i++) {
    d.push(d[d.length - 1] + distance(path[i], path[i - 1]));
  }
  const total = d[d.length - 1];
  if (total === 0) {
    // degenerate -> duplicate start
    return Array.from({ length: n }, () => ({ x: path[0].x, y: path[0].y, t: path[0].t || 0 }));
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const target = (i / (n - 1)) * total;
    // find segment
    let j = 0;
    while (j < d.length - 1 && d[j + 1] < target) j++;
    const segLen = d[j + 1] - d[j] || 1;
    const t = (target - d[j]) / segLen;
    const x = path[j].x + t * (path[j + 1].x - path[j].x);
    const y = path[j].y + t * (path[j + 1].y - path[j].y);
    // estimate time by linear interp if times exist
    let tt = 0;
    if (typeof path[j].t === 'number' && typeof path[j + 1].t === 'number') {
      tt = path[j].t + t * (path[j + 1].t - path[j].t);
    } else if (typeof path[j].t === 'number') {
      tt = path[j].t;
    } else {
      tt = 0;
    }
    out.push({ x, y, t: tt });
  }
  return out;
}

function centroid(points) {
  const n = points.length;
  let sx = 0, sy = 0;
  for (const p of points) { sx += p.x; sy += p.y; }
  return { x: sx / n, y: sy / n };
}
function subtract(points, c) {
  return points.map(p => ({ x: p.x - c.x, y: p.y - c.y, t: p.t }));
}
function scaleToUnit(points) {
  let sumSq = 0;
  for (const p of points) sumSq += p.x * p.x + p.y * p.y;
  const meanSq = sumSq / points.length;
  let scale = Math.sqrt(meanSq);
  if (!isFinite(scale) || scale < 1e-6) scale = 1e-6;
  return points.map(p => ({ x: p.x / scale, y: p.y / scale, t: p.t }));
}

function kabschRotation(P, Q) {
  // 2x2 optimal rotation via polar decomposition
  let H00 = 0, H01 = 0, H10 = 0, H11 = 0;
  for (let i = 0; i < P.length; i++) {
    H00 += P[i].x * Q[i].x;
    H01 += P[i].x * Q[i].y;
    H10 += P[i].y * Q[i].x;
    H11 += P[i].y * Q[i].y;
  }
  const a = H00, b = H01, c = H10, d = H11;
  // small 2x2 polar decomposition (H * (H^T H)^-1/2)
  const S00 = a*a + c*c, S01 = a*b + c*d, S11 = b*b + d*d;
  // eigen-decomp of S
  const tr = S00 + S11;
  const det = S00 * S11 - S01 * S01;
  const tmp = Math.sqrt(Math.max(0, tr*tr / 4 - det));
  const eig1 = tr / 2 + tmp;
  const eig2 = tr / 2 - tmp;
  const sqrt1 = Math.sqrt(Math.max(1e-12, eig1));
  const sqrt2 = Math.sqrt(Math.max(1e-12, eig2));
  let vx1 = 1, vy1 = 0, vx2 = 0, vy2 = 1;
  if (Math.abs(S01) > 1e-12) {
    vx1 = eig1 - S11;
    vy1 = S01;
    const n1 = Math.hypot(vx1, vy1) || 1;
    vx1 /= n1; vy1 /= n1;
    vx2 = -vy1; vy2 = vx1;
  }
  const invSqrt00 = (vx1*vx1)/sqrt1 + (vx2*vx2)/sqrt2;
  const invSqrt01 = (vx1*vy1)/sqrt1 + (vx2*vy2)/sqrt2;
  const invSqrt11 = (vy1*vy1)/sqrt1 + (vy2*vy2)/sqrt2;
  const invSqrt10 = invSqrt01;
  // U = H * invSqrt(S)
  const U00 = a * invSqrt00 + b * invSqrt10;
  const U01 = a * invSqrt01 + b * invSqrt11;
  const U10 = c * invSqrt00 + d * invSqrt10;
  const U11 = c * invSqrt01 + d * invSqrt11;
  // ensure rotation (det positive)
  const detU = U00*U11 - U01*U10;
  if (detU < 0) return [[U00, -U01],[U10, -U11]];
  return [[U00, U01],[U10, U11]];
}
function applyRotation(points, R) {
  return points.map(p => ({ x: R[0][0] * p.x + R[0][1] * p.y, y: R[1][0] * p.x + R[1][1] * p.y, t: p.t }));
}
function rmsd(A, B) {
  let sum = 0;
  for (let i = 0; i < A.length; i++) {
    const dx = A[i].x - B[i].x;
    const dy = A[i].y - B[i].y;
    sum += dx*dx + dy*dy;
  }
  return Math.sqrt(sum / A.length);
}

// Bot-signal computations
function computeTimingMetrics(resampled) {
  const times = resampled.map(p => (typeof p.t === 'number' ? p.t : null));
  // If any time is null, treat timings as unknown -> return nulls
  if (times.some(t => t === null)) return null;
  const start = times[0];
  const end = times[times.length - 1];
  const duration = Math.max(0, end - start); // ms
  const speeds = [];
  for (let i = 1; i < resampled.length; i++) {
    const dist = distance(resampled[i], resampled[i-1]);
    const dt = Math.max(1e-6, times[i] - times[i-1]); // avoid zero
    speeds.push(dist / dt); // normalized distance per ms
  }
  // compute std dev of speeds
  const mean = speeds.reduce((a,b)=>a+b,0) / speeds.length;
  let varSum = 0;
  for (const s of speeds) varSum += (s - mean)*(s - mean);
  const std = Math.sqrt(varSum / speeds.length);
  return { duration, speeds, speedStd: std, meanSpeed: mean };
}

function computeJitterAngleMetrics(resampled) {
  // compute angle changes between segments and small local jitter
  const angles = [];
  for (let i = 1; i < resampled.length; i++) {
    const dx = resampled[i].x - resampled[i-1].x;
    const dy = resampled[i].y - resampled[i-1].y;
    angles.push(Math.atan2(dy, dx));
  }
  const angleDiffs = [];
  for (let i = 1; i < angles.length; i++) {
    let d = angles[i] - angles[i-1];
    // normalize to [-PI, PI]
    while (d > Math.PI) d -= 2*Math.PI;
    while (d < -Math.PI) d += 2*Math.PI;
    angleDiffs.push(d);
  }
  // metrics
  const meanAngleDiff = angleDiffs.reduce((a,b)=>a+b,0) / Math.max(1, angleDiffs.length);
  let varSum = 0;
  for (const v of angleDiffs) varSum += (v - meanAngleDiff)*(v - meanAngleDiff);
  const angleVar = Math.sqrt(varSum / Math.max(1, angleDiffs.length));
  // jitter: mean perpendicular deviation from local straight line (approx by second differences)
  const secondDiffs = [];
  for (let i = 2; i < resampled.length; i++) {
    const xa = resampled[i-2].x, ya = resampled[i-2].y;
    const xb = resampled[i-1].x, yb = resampled[i-1].y;
    const xc = resampled[i].x, yc = resampled[i].y;
    // expected middle point on straight line
    const xm = (xa + xc) / 2;
    const ym = (ya + yc) / 2;
    const dev = Math.hypot(xm - xb, ym - yb);
    secondDiffs.push(dev);
  }
  const meanJitter = secondDiffs.length ? secondDiffs.reduce((a,b)=>a+b,0)/secondDiffs.length : 0;
  return { angleVar, meanJitter };
}

function computeBotScore(metrics) {
  // metrics: { timing: {...} or null, angleVar, meanJitter, shapeScore }
  // Score increases for bot-like attributes. Lower score => human-like.
  let score = 0;
  const signals = {};

  if (!metrics) {
    // missing timing data -> be conservative (slight penalty)
    score += 1.0;
    signals.missingTiming = true;
  } else {
    const { timing } = metrics;
    // duration too short (fast bots)
    if (timing.duration < 120) { score += 4.0; signals.tooFast = true; }
    else if (timing.duration < 300) { score += 1.5; signals.fast = true; }

    // too low speed variance => bot
    if (timing.speedStd < 0.00002) { score += 3.0; signals.constantSpeed = true; }
    else if (timing.speedStd < 0.00008) { score += 1.2; signals.lowSpeedVar = true; }
  }

  // too low jitter => bot (perfectly smooth)
  if (metrics.meanJitter !== undefined) {
    if (metrics.meanJitter < 0.0005) { score += 3.0; signals.tooSmooth = true; }
    else if (metrics.meanJitter < 0.002) { score += 0.9; signals.lowJitter = true; }
  }

  // too low angle variance (nearly constant curvature) => suspicious
  if (metrics.angleVar !== undefined) {
    if (Math.abs(metrics.angleVar) < 0.005) { score += 2.0; signals.straightAngleChanges = true; }
    else if (metrics.angleVar < 0.02) { score += 0.7; signals.smallAngleVar = true; }
  }

  // shapeScore (RMSD) penalty if shape too perfect or too off
  if (typeof metrics.shapeScore === 'number') {
    // if shape score is extremely low (too perfect), that's suspicious (bots may reproduce template exactly)
    if (metrics.shapeScore < 0.003) { score += 1.5; signals.tooPerfectShape = true; }
  }

  return { score, signals };
}

// Main verification function
function prepareForMatching(points, rotation = 0, scale = 1) {
  // rotation (radians) and scale are small randomizations applied to frontend display only.
  // For matching we normally do not apply challenge randomization here (matching is rotation/scale invariant via Kabsch)
  const res = resampleSpatial(points, RESAMPLE_POINTS);
  const c = centroid(res);
  let centered = subtract(res, c);
  centered = scaleToUnit(centered);
  return centered;
}

function verifyTrace(userPath, template, challengeId) {
  // Validate inputs
  if (!Array.isArray(userPath) || !Array.isArray(template)) {
    return { success: false, message: 'Invalid input', shapeScore: Infinity, botScore: Infinity, signals: {} };
  }
  if (userPath.length < MIN_POINTS) {
    return { success: false, message: 'Too few points', shapeScore: Infinity, botScore: Infinity, signals: {} };
  }

  // Require a valid (not used, not expired) challenge
  if (!isChallengeValid(challengeId)) {
    return {
      success: false,
      shapeScore: Infinity,
      shapePass: false,
      botScore: Infinity,
      botThreshold: null,
      signals: { challengeInvalid: true },
      message: 'Invalid or expired challenge'
    };
  }

  // get challenge randomization info (for signals / record-keeping) but do NOT apply it to template matching
  const cobj = challenges.get(challengeId);
  const rotation = cobj ? (cobj.rotation || 0) : 0;
  const scale = cobj ? (cobj.scale || 1) : 1;

  // Prepare user and template WITHOUT applying rotation/scale here.
  // (Frontend is responsible for showing the rotated/scaled target; matching is rotation-invariant.)
  const userResampled = resampleSpatial(userPath, RESAMPLE_POINTS);
  const userCentered = prepareForMatching(userResampled, 0, 1);
  const tmplResampled = resampleSpatial(template, RESAMPLE_POINTS);
  const tmplPrepared = prepareForMatching(tmplResampled, 0, 1);

  // Kabsch alignment: find rotation mapping user -> template
  const R = kabschRotation(userCentered, tmplPrepared);
  const userRot = applyRotation(userCentered, R);
  const shapeScore = rmsd(userRot, tmplPrepared);
  const shapePass = shapeScore <= SHAPE_THRESHOLD;

  // compute timing & jitter metrics for bot scoring
  const timing = computeTimingMetrics(userResampled); // may be null
  const { angleVar, meanJitter } = computeJitterAngleMetrics(userResampled);
  const metrics = { timing, angleVar, meanJitter, shapeScore };

  const botEval = computeBotScore(metrics);
  const botScore = botEval.score;
  const signals = botEval.signals;

  // Decision: require both shapePass AND botScore low
  const BOT_SCORE_THRESHOLD = 4.0; // choose threshold: >= this value => flagged as bot
  const success = shapePass && botScore < BOT_SCORE_THRESHOLD;

  // Include challenge metadata as signals
  if (!cobj) signals.challengeInvalid = true;
  else {
    // include rotation/scale as informational signals for logging / analytics
    signals.challengeRotation = rotation;
    signals.challengeScale = scale;
  }

  const message = success ? 'Pass' : (shapePass ? 'Failed bot checks' : 'Failed shape match');

  return {
    success,
    shapeScore,
    shapePass,
    botScore,
    botThreshold: BOT_SCORE_THRESHOLD,
    signals,
    message
  };
}

module.exports = {
  verifyTrace,
  issueChallenge,
  consumeChallenge,
  isChallengeValid,
  // small exports used by tests
  resampleSpatial,
  computeTimingMetrics,
  computeJitterAngleMetrics,
  computeBotScore,
  CHALLENGE_TTL_MS
};
