const crypto = require('crypto');

const RESAMPLE_POINTS = 64;
const SHAPE_DISTANCE_THRESHOLD = 0.3; // stricter
const MAX_POINT_DISTANCE = 0.5;       // normalized units
const CHALLENGE_TTL_MS = 2 * 60 * 1000;
const MIN_POINTS = 12;

const challenges = new Map();

// --- Challenge helpers ---
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
    challenges.delete(id);
}

// --- Geometry helpers ---
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

// --- Kabsch rotation ---
function kabschRotation(P, Q) {
    let H00 = 0, H01 = 0, H10 = 0, H11 = 0;
    for (let i = 0; i < P.length; i++) {
        H00 += P[i].x * Q[i].x; H01 += P[i].x * Q[i].y;
        H10 += P[i].y * Q[i].x; H11 += P[i].y * Q[i].y;
    }
    const a = H00, b = H01, c = H10, d = H11;
    const S00 = a*a + c*c, S01 = a*b + c*d, S11 = b*b + d*d;
    const tr = S00 + S11, det = S00*S11 - S01*S01;
    const tmp = Math.sqrt(Math.max(0, tr*tr/4 - det));
    const eig1 = tr/2 + tmp, eig2 = tr/2 - tmp;
    const sqrt1 = Math.sqrt(Math.max(1e-12, eig1)), sqrt2 = Math.sqrt(Math.max(1e-12, eig2));
    let vx1 = 1, vy1 = 0, vx2 = 0, vy2 = 1;
    if (Math.abs(S01) > 1e-12) {
        vx1 = eig1 - S11; vy1 = S01;
        const n1 = Math.hypot(vx1, vy1) || 1; vx1 /= n1; vy1 /= n1;
        vx2 = -vy1; vy2 = vx1;
    }
    const invSqrt00 = vx1*vx1/sqrt1 + vx2*vx2/sqrt2;
    const invSqrt01 = vx1*vy1/sqrt1 + vx2*vy2/sqrt2;
    const invSqrt11 = vy1*vy1/sqrt1 + vy2*vy2/sqrt2;
    const invSqrt10 = invSqrt01;
    const U00 = a*invSqrt00 + b*invSqrt10;
    const U01 = a*invSqrt01 + b*invSqrt11;
    const U10 = c*invSqrt00 + d*invSqrt10;
    const U11 = c*invSqrt01 + d*invSqrt11;
    return (U00*U11 - U01*U10 < 0) ? [[U00,-U01],[U10,-U11]] : [[U00,U01],[U10,U11]];
}

function applyRotation(points, R) {
    return points.map(p => ({ x: R[0][0]*p.x + R[0][1]*p.y, y: R[1][0]*p.x + R[1][1]*p.y, t: p.t }));
}

function rmsd(A,B) {
    let sum=0;
    for(let i=0;i<A.length;i++){
        const dx=A[i].x-B[i].x, dy=A[i].y-B[i].y;
        sum += dx*dx + dy*dy;
    }
    return Math.sqrt(sum/A.length);
}

// --- Outline distance ---
function pointToPolylineDistance(point, polyline){
    let minDist=Infinity;
    for(let i=0;i<polyline.length-1;i++){
        const a=polyline[i],b=polyline[i+1];
        const t=Math.max(0,Math.min(1,((point.x-a.x)*(b.x-a.x)+(point.y-a.y)*(b.y-a.y))/((b.x-a.x)**2+(b.y-a.y)**2)));
        const projX=a.x+t*(b.x-a.x), projY=a.y+t*(b.y-a.y);
        const d=Math.hypot(point.x-projX, point.y-projY);
        if(d<minDist) minDist=d;
    }
    return minDist;
}

function shapeDistanceMetric(user, template){
    const d1=user.reduce((sum,p)=>sum+pointToPolylineDistance(p,template),0)/user.length;
    const d2=template.reduce((sum,p)=>sum+pointToPolylineDistance(p,user),0)/template.length;
    return (d1+d2)/2;
}

// --- Prepare points ---
function prepareForMatching(points){
    const c=centroid(points);
    return scaleToUnit(subtract(points,c));
}

function normalizePoints(points, width, height) {
    return points.map(p => ({ x: p.x / width, y: p.y / height, t: p.t }));
}

// --- Bounding box helpers ---
function boundingBox(points) {
    const xs = points.map(p => p.x), ys = points.map(p => p.y);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

function sizeRatio(user, template) {
    const ub = boundingBox(user), tb = boundingBox(template);
    const userArea = Math.max((ub.maxX - ub.minX) * (ub.maxY - ub.minY), 1e-6);
    const templateArea = Math.max((tb.maxX - tb.minX) * (tb.maxY - tb.minY), 1e-6);
    return userArea / templateArea;
}

// --- Stricter coverage: point-to-point ---
function coverageFraction(userPoints, templatePoints, maxDistance) {
    const n = Math.max(userPoints.length, templatePoints.length);
    let closeCount = 0;
    for (let i = 0; i < n; i++) {
        const up = userPoints[i % userPoints.length];
        const tp = templatePoints[i % templatePoints.length];
        if (distance(up, tp) <= maxDistance) closeCount++;
    }
    return closeCount / n;
}

function verifyTrace(userPath, template, challengeId, canvasWidth = 400, canvasHeight = 400) {
    if (!Array.isArray(userPath) || !Array.isArray(template))
        return { success: false, message: 'Invalid input', signals: {} };
    if (userPath.length < MIN_POINTS)
        return { success: false, message: 'Too few points', signals: {} };
    if (!isChallengeValid(challengeId))
        return { success: false, message: 'Invalid/expired challenge', signals: { challengeInvalid: true }};

    const cobj = challenges.get(challengeId);
    const rotation = cobj?.rotation || 0;
    const scale = cobj?.scale || 1;

    // --- Resample paths ---
    const userResampled = resampleSpatial(userPath, RESAMPLE_POINTS);
    const tmplResampled = resampleSpatial(template, RESAMPLE_POINTS);

    // --- SIZE RATIO on raw points BEFORE normalization ---
    const ratioRaw = sizeRatio(userResampled, tmplResampled);
    const SIZE_RATIO_MIN = 0.5, SIZE_RATIO_MAX = 2.0;
    const sizePass = ratioRaw >= SIZE_RATIO_MIN && ratioRaw <= SIZE_RATIO_MAX;

    // --- Normalize for canvas and alignment ---
    const userNorm = normalizePoints(userResampled, canvasWidth, canvasHeight);
    const tmplNorm = normalizePoints(tmplResampled, canvasWidth, canvasHeight);

    // --- Prepare for alignment ---
    const userPrepared = prepareForMatching(userNorm);
    const tmplPrepared = prepareForMatching(tmplNorm);

    // --- Align using Kabsch ---
    const R = kabschRotation(userPrepared, tmplPrepared);
    const userRot = applyRotation(userPrepared, R);

    // --- Deviations ---
    const deviationsAligned = userRot.map(p => pointToPolylineDistance(p, tmplPrepared));
    const maxDeviation = Math.max(...deviationsAligned);
    const avgDeviation = deviationsAligned.reduce((sum,d)=>sum+d,0)/deviationsAligned.length;

    // --- Coverage using nearest-neighbor fraction ---
    const coverageFrac = coverageFraction(userRot, tmplPrepared, MAX_POINT_DISTANCE);
    const coveragePass = coverageFrac >= 0.5;

    // --- Shape distance ---
    const shapeDistance = shapeDistanceMetric(userRot, tmplPrepared);
    const shapeDistancePass = shapeDistance <= SHAPE_DISTANCE_THRESHOLD;

    // --- Outlier fraction ---
    const MAX_POINT_OUTLIER_FRACTION = 0.25;
    const pointsTooFar = deviationsAligned.filter(d => d > MAX_POINT_DISTANCE).length;
    const outlierFraction = pointsTooFar / deviationsAligned.length;
    const maxDeviationPass = outlierFraction <= MAX_POINT_OUTLIER_FRACTION;
    const avgDeviationPass = avgDeviation <= MAX_POINT_DISTANCE;

    // --- Final pass/fail ---
    const shapePass = maxDeviationPass && avgDeviationPass && shapeDistancePass && coveragePass && sizePass;

    if (shapePass) consumeChallenge(challengeId);

    console.log(`Points exceeding max distance: ${pointsTooFar}`);
    console.log(`Max deviation: ${maxDeviation.toFixed(4)}, Avg deviation: ${avgDeviation.toFixed(4)}`);
    console.log(`Coverage fraction: ${(coverageFrac*100).toFixed(1)}% (pass: ${coveragePass})`);
    console.log(`Shape distance: ${shapeDistance.toFixed(4)} (pass: ${shapeDistancePass}), Size ratio: ${ratioRaw.toFixed(3)} (pass: ${sizePass})`);

    return {
        success: shapePass,
        rmsdScore: rmsd(userRot, tmplPrepared),
        shapeDistance,
        shapePass,
        maxDeviation,
        avgDeviation,
        coverageFraction: coverageFrac,
        message: shapePass ? 'Pass' : 'Failed',
        signals: { challengeRotation: rotation, challengeScale: scale }
    };
}

module.exports = { verifyTrace, issueChallenge, consumeChallenge, isChallengeValid, resampleSpatial, CHALLENGE_TTL_MS };
