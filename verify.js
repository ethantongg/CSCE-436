const crypto = require('crypto');

const RESAMPLE_POINTS = 64;
const SHAPE_DISTANCE_THRESHOLD = 0.3; // normalized units
const MAX_POINT_DISTANCE = 0.5;       // max single-point deviation allowed
const CHALLENGE_TTL_MS = 2 * 60 * 1000;
const MIN_POINTS = 12;

const challenges = new Map();

// ---- Challenge helpers ----
function randFloat(min, max) {
    return min + Math.random() * (max - min);
}

function issueChallenge() {
    const id = crypto.randomBytes(12).toString('hex');
    const rotation = randFloat(-0.3, 0.3);
    const scale = randFloat(0.95, 1.05);
    const expiresAt = Date.now() + CHALLENGE_TTL_MS;
    const obj = { id, rotation, scale, expiresAt, used: false };
    challenges.set(id, obj);
    return obj;
}

function isChallengeValid(id) {
    const c = challenges.get(id);
    if (!c || c.used || Date.now() > c.expiresAt) {
        if (c) challenges.delete(id);
        return false;
    }
    return true;
}

function consumeChallenge(id) {
    const c = challenges.get(id);
    if (!c) return;
    c.used = true;
    challenges.delete(id);
}

// ---- Geometry helpers ----
function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

function resampleSpatial(path, n) {
    if (!path.length) return Array.from({ length: n }, () => ({ x: 0, y: 0, t: 0 }));
    const d = [0];
    for (let i = 1; i < path.length; i++) d.push(d[d.length - 1] + distance(path[i], path[i - 1]));
    const total = d[d.length - 1];
    if (total === 0) return Array.from({ length: n }, () => ({ ...path[0] }));
    const out = [];
    for (let i = 0; i < n; i++) {
        const target = (i / (n - 1)) * total;
        let j = 0;
        while (j < d.length - 1 && d[j + 1] < target) j++;
        const segLen = d[j + 1] - d[j] || 1;
        const t = (target - d[j]) / segLen;
        const x = path[j].x + t * (path[j + 1].x - path[j].x);
        const y = path[j].y + t * (path[j + 1].y - path[j].y);
        let tt = 0;
        if (typeof path[j].t === 'number' && typeof path[j + 1].t === 'number')
            tt = path[j].t + t * (path[j + 1].t - path[j].t);
        else if (typeof path[j].t === 'number') tt = path[j].t;
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
    const scale = Math.sqrt(Math.max(sumSq / points.length, 1e-6));
    return points.map(p => ({ x: p.x / scale, y: p.y / scale, t: p.t }));
}

// ---- Kabsch alignment ----
function kabschRotation(P, Q) {
    let H00 = 0, H01 = 0, H10 = 0, H11 = 0;
    for (let i = 0; i < P.length; i++) {
        H00 += P[i].x * Q[i].x; H01 += P[i].x * Q[i].y;
        H10 += P[i].y * Q[i].x; H11 += P[i].y * Q[i].y;
    }
    const a = H00, b = H01, c = H10, d = H11;
    const S00 = a * a + c * c, S01 = a * b + c * d, S11 = b * b + d * d;
    const tr = S00 + S11, det = S00 * S11 - S01 * S01;
    const tmp = Math.sqrt(Math.max(0, tr * tr / 4 - det));
    const eig1 = tr / 2 + tmp, eig2 = tr / 2 - tmp;
    const sqrt1 = Math.sqrt(Math.max(1e-12, eig1)), sqrt2 = Math.sqrt(Math.max(1e-12, eig2));
    let vx1 = 1, vy1 = 0, vx2 = 0, vy2 = 1;
    if (Math.abs(S01) > 1e-12) {
        vx1 = eig1 - S11; vy1 = S01;
        const n1 = Math.hypot(vx1, vy1) || 1; vx1 /= n1; vy1 /= n1;
        vx2 = -vy1; vy2 = vx1;
    }
    const invSqrt00 = vx1 * vx1 / sqrt1 + vx2 * vx2 / sqrt2;
    const invSqrt01 = vx1 * vy1 / sqrt1 + vx2 * vy2 / sqrt2;
    const invSqrt11 = vy1 * vy1 / sqrt1 + vy2 * vy2 / sqrt2;
    const invSqrt10 = invSqrt01;
    const U00 = a * invSqrt00 + b * invSqrt10;
    const U01 = a * invSqrt01 + b * invSqrt11;
    const U10 = c * invSqrt00 + d * invSqrt10;
    const U11 = c * invSqrt01 + d * invSqrt11;
    return (U00 * U11 - U01 * U10 < 0) ? [[U00, -U01], [U10, -U11]] : [[U00, U01], [U10, U11]];
}

function applyRotation(points, R) {
    return points.map(p => ({ x: R[0][0] * p.x + R[0][1] * p.y, y: R[1][0] * p.x + R[1][1] * p.y, t: p.t }));
}

function rmsd(A, B) {
    let sum = 0;
    for (let i = 0; i < A.length; i++) {
        const dx = A[i].x - B[i].x, dy = A[i].y - B[i].y;
        sum += dx * dx + dy * dy;
    }
    return Math.sqrt(sum / A.length);
}

// ---- Metrics ----
function computeTimingMetrics(path) {
    const times = path.map(p => typeof p.t === 'number' ? p.t : null);
    if (times.some(t => t === null)) return null;
    const start = times[0], end = times[times.length - 1];
    const speeds = [];
    for (let i = 1; i < path.length; i++) {
        const dist = distance(path[i], path[i - 1]);
        const dt = Math.max(1e-6, times[i] - times[i - 1]);
        speeds.push(dist / dt);
    }
    const mean = speeds.reduce((a, b) => a + b, 0) / speeds.length;
    const varSum = speeds.reduce((s, v) => s + (v - mean) ** 2, 0);
    return { duration: Math.max(0, end - start), speeds, speedStd: Math.sqrt(varSum / speeds.length), meanSpeed: mean };
}

function computeJitterAngleMetrics(resampled) {
    const angles = [], angleDiffs = [], secondDiffs = [];
    let varSum = 0;
    for (let i = 1; i < resampled.length; i++) {
        const dx = resampled[i].x - resampled[i - 1].x;
        const dy = resampled[i].y - resampled[i - 1].y;
        angles.push(Math.atan2(dy, dx));
    }
    for (let i = 1; i < angles.length; i++) {
        let d = angles[i] - angles[i - 1];
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        angleDiffs.push(d);
    }
    const meanAngleDiff = angleDiffs.reduce((a, b) => a + b, 0) / Math.max(1, angleDiffs.length);
    for (const v of angleDiffs) varSum += (v - meanAngleDiff) ** 2;
    const angleVar = Math.sqrt(varSum / Math.max(1, angleDiffs.length));
    for (let i = 2; i < resampled.length; i++) {
        const xa = resampled[i - 2].x, ya = resampled[i - 2].y;
        const xb = resampled[i - 1].x, yb = resampled[i - 1].y;
        const xc = resampled[i].x, yc = resampled[i].y;
        const xm = (xa + xc) / 2, ym = (ya + yc) / 2;
        secondDiffs.push(Math.hypot(xm - xb, ym - yb));
    }
    const meanJitter = secondDiffs.length ? secondDiffs.reduce((a, b) => a + b, 0) / secondDiffs.length : 0;
    return { angleVar, meanJitter };
}

// ---- Bot scoring ----
function computeBotScoreHumanFriendly(metrics) {
    let score = 0, signals = {};

    if (metrics.timing) {
        const { duration, speedStd } = metrics.timing;
        if (duration < 3000) { score += 2.0; signals.tooFast = 'Trace too fast for human'; }
        else if (duration < 5000) { score += 0.5; signals.fast = 'Trace faster than typical'; }
        if (speedStd < 0.0001) { score += 0.2; signals.lowSpeedVar = 'Trace too uniform, suspicious'; }
    } else {
        score += 0.1; signals.missingTiming = 'Timing data missing';
    }

    if (metrics.meanJitter !== undefined && metrics.meanJitter < 0.0005) {
        score += 0.2; signals.lowJitter = 'Trace unusually smooth';
    }

    if (metrics.angleVar !== undefined && metrics.angleVar < 0.005) {
        score += 0.2; signals.lowAngleVar = 'Trace angle changes very small';
    }

    if (metrics.shapeDistance !== undefined && metrics.shapeDistance < 0.001) {
        score += 0.2; signals.tooPerfectShape = 'Trace too perfect';
    }

    return { score, signals };
}

// ---- Outline distance helpers ----
function pointToPolylineDistance(point, polyline) {
    let minDist = Infinity;
    for (let i = 0; i < polyline.length - 1; i++) {
        const a = polyline[i], b = polyline[i + 1];
        const t = Math.max(0, Math.min(1, ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) /
            ((b.x - a.x) ** 2 + (b.y - a.y) ** 2)));
        const projX = a.x + t * (b.x - a.x);
        const projY = a.y + t * (b.y - a.y);
        const d = Math.hypot(point.x - projX, point.y - projY);
        if (d < minDist) minDist = d;
    }
    return minDist;
}

function shapeDistanceMetric(user, template) {
    const d1 = user.reduce((sum, p) => sum + pointToPolylineDistance(p, template), 0) / user.length;
    const d2 = template.reduce((sum, p) => sum + pointToPolylineDistance(p, user), 0) / template.length;
    return (d1 + d2) / 2;
}

// ---- Main verification ----
function prepareForMatching(points) {
    const c = centroid(points);
    return scaleToUnit(subtract(points, c));
}

function verifyTrace(userPath, template, challengeId) {
    const signals = {};

    if (!Array.isArray(userPath) || !Array.isArray(template)) {
        console.log('Invalid input:', { userPath, template });
        return { success: false, message: 'Invalid input', signals };
    }
    if (userPath.length < MIN_POINTS) {
        console.log('Too few points:', userPath.length);
        return { success: false, message: 'Too few points', signals };
    }
    if (!isChallengeValid(challengeId)) {
        console.log('Challenge invalid/expired:', challengeId);
        return { success: false, message: 'Invalid/expired challenge', signals: { challengeInvalid: true } };
    }

    const cobj = challenges.get(challengeId);
    const rotation = cobj?.rotation || 0;
    const scale = cobj?.scale || 1;

    const userResampled = resampleSpatial(userPath, RESAMPLE_POINTS);
    const tmplResampled = resampleSpatial(template, RESAMPLE_POINTS);

    // Compute maximum single-point deviation
    const maxDeviation = Math.max(...userResampled.map(p => pointToPolylineDistance(p, tmplResampled)));
    console.log('Max point deviation:', maxDeviation);

    // Early reject if any point is too far
    if (maxDeviation > MAX_POINT_DISTANCE) {
        if (cobj) consumeChallenge(challengeId);
        console.log('Trace fails early due to MAX_POINT_DISTANCE');
        return { success: false, message: 'Trace deviates too far from template', signals: { tooFar: true } };
    }

    const userPrepared = prepareForMatching(userResampled);
    const tmplPrepared = prepareForMatching(tmplResampled);

    const R = kabschRotation(userPrepared, tmplPrepared);
    const userRot = applyRotation(userPrepared, R);

    const rmsdScore = rmsd(userRot, tmplPrepared);
    const shapeDistance = shapeDistanceMetric(userResampled, tmplResampled);
    console.log('RMSD score:', rmsdScore, 'Shape distance:', shapeDistance);

    // Combine shape distance with maxDeviation
    const shapePass = shapeDistance <= SHAPE_DISTANCE_THRESHOLD && maxDeviation <= MAX_POINT_DISTANCE;
    console.log('Shape pass:', shapePass);

    const timing = computeTimingMetrics(userPath);
    const { angleVar, meanJitter } = computeJitterAngleMetrics(userResampled);
    console.log('Timing metrics:', timing, 'Angle variance:', angleVar, 'Mean jitter:', meanJitter);

    const metrics = { timing, angleVar, meanJitter, rmsdScore, shapeDistance };
    const { score: botScore, signals: botSignals } = computeBotScoreHumanFriendly(metrics);
    Object.assign(signals, botSignals, { challengeRotation: rotation, challengeScale: scale });

    const BOT_SCORE_THRESHOLD = 1.5;
    const success = shapePass && botScore < BOT_SCORE_THRESHOLD;
    console.log('Bot score:', botScore, 'Success:', success);

    if (cobj) consumeChallenge(challengeId);

    return {
        success,
        message: success ? 'Pass' : 'Failed',
        rmsdScore,
        shapeDistance,
        shapePass,
        maxDeviation,
        botScore,
        botThreshold: BOT_SCORE_THRESHOLD,
        signals,
        detailedFeedback: metrics
    };
}


module.exports = { verifyTrace, issueChallenge, consumeChallenge, isChallengeValid, resampleSpatial, computeTimingMetrics, computeJitterAngleMetrics, CHALLENGE_TTL_MS };
