// verify.js
// Exports verifyTrace(userPath, templatePath)
// Both paths are arrays of {x,y} in normalized coordinates (0..1)
const RESAMPLE_POINTS = 64;
const THRESHOLD = 0.015; // RMSD threshold tuned by experiments (lower is stricter)

function resample(path, n) {
  // compute cumulative distances
  const d = [0];
  for (let i = 1; i < path.length; i++) {
    const dx = path[i].x - path[i - 1].x;
    const dy = path[i].y - path[i - 1].y;
    d.push(d[d.length - 1] + Math.hypot(dx, dy));
  }
  const total = d[d.length - 1];
  if (total === 0) {
    // degenerate path: duplicate first point n times
    return Array.from({ length: n }, () => ({ x: path[0].x, y: path[0].y }));
  }

  const res = [];
  for (let i = 0; i < n; i++) {
    const target = (i / (n - 1)) * total;
    // find segment
    let j = 0;
    while (j < d.length - 1 && d[j + 1] < target) j++;
    const segLen = d[j + 1] - d[j];
    const t = segLen === 0 ? 0 : (target - d[j]) / segLen;
    const x = path[j].x + t * (path[j + 1].x - path[j].x);
    const y = path[j].y + t * (path[j + 1].y - path[j].y);
    res.push({ x, y });
  }
  return res;
}

function centroid(points) {
  const n = points.length;
  let sx = 0, sy = 0;
  for (const p of points) { sx += p.x; sy += p.y; }
  return { x: sx / n, y: sy / n };
}

function subtract(points, c) {
  return points.map(p => ({ x: p.x - c.x, y: p.y - c.y }));
}

function scaleToUnit(points) {
  // compute RMS distance from origin and scale so RMS = 1
  let sumSq = 0;
  for (const p of points) sumSq += p.x * p.x + p.y * p.y;
  const meanSq = sumSq / points.length;
  const scale = Math.sqrt(meanSq) || 1;
  return points.map(p => ({ x: p.x / scale, y: p.y / scale }));
}

function toMatrix(points) {
  // returns 2 x N matrix
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  return [xs, ys];
}

function kabschRotation(P, Q) {
  // P and Q: arrays of {x,y} same length. Compute rotation matrix R (2x2) minimizing RMSD between P*R and Q
  // Build covariance matrix H = P^T * Q
  const n = P.length;
  let H00 = 0, H01 = 0, H10 = 0, H11 = 0;
  for (let i = 0; i < n; i++) {
    H00 += P[i].x * Q[i].x;
    H01 += P[i].x * Q[i].y;
    H10 += P[i].y * Q[i].x;
    H11 += P[i].y * Q[i].y;
  }
  // compute rotation using SVD of H (2x2). For 2x2 we can compute directly.
  // Compute S = H^T * H
  const a = H00, b = H01, c = H10, d = H11;
  // S = [[a^2 + c^2, a*b + c*d],[a*b + c*d, b^2 + d^2]]
  const S00 = a*a + c*c;
  const S01 = a*b + c*d;
  const S11 = b*b + d*d;
  // angle of rotation = atan2( something ), but a simpler approach:
  // compute R directly by solving for orthonormal matrix closest to H via polar decomposition
  // For 2x2, do polar decomposition H = U * P where U = H * (H^T H)^{-1/2}
  // We'll compute inverse sqrt of S via eigen decomposition.
  const trace = S00 + S11;
  const det = S00 * S11 - S01 * S01;
  const temp = Math.sqrt(Math.max(0, trace*trace / 4 - det));
  const eig1 = trace / 2 + temp;
  const eig2 = trace / 2 - temp;
  const sqrt1 = Math.sqrt(Math.max(0, eig1));
  const sqrt2 = Math.sqrt(Math.max(0, eig2));
  // Build sqrt(S) = V * diag(sqrt1, sqrt2) * V^T where V holds eigenvectors. Compute V:
  let vx1, vy1, vx2, vy2;
  if (S01 !== 0) {
    const t = eig1 - S11;
    vx1 = t; vy1 = S01;
    const norm1 = Math.hypot(vx1, vy1) || 1;
    vx1 /= norm1; vy1 /= norm1;
    vx2 = -vy1; vy2 = vx1;
  } else {
    vx1 = 1; vy1 = 0;
    vx2 = 0; vy2 = 1;
  }
  // inverse sqrt = V * diag(1/sqrt1,1/sqrt2) * V^T
  const invSqrt00 = (vx1*vx1)/(sqrt1) + (vx2*vx2)/(sqrt2);
  const invSqrt01 = (vx1*vy1)/(sqrt1) + (vx2*vy2)/(sqrt2);
  const invSqrt10 = invSqrt01;
  const invSqrt11 = (vy1*vy1)/(sqrt1) + (vy2*vy2)/(sqrt2);

  // U = H * invSqrt
  const U00 = a * invSqrt00 + b * invSqrt10;
  const U01 = a * invSqrt01 + b * invSqrt11;
  const U10 = c * invSqrt00 + d * invSqrt10;
  const U11 = c * invSqrt01 + d * invSqrt11;

  // Ensure proper rotation (determinant positive)
  const detU = U00*U11 - U01*U10;
  if (detU < 0) {
    // reflect the second column
    return [
      [U00, -U01],
      [U10, -U11]
    ];
  }
  return [
    [U00, U01],
    [U10, U11]
  ];
}

function applyRotation(points, R) {
  return points.map(p => ({
    x: R[0][0] * p.x + R[0][1] * p.y,
    y: R[1][0] * p.x + R[1][1] * p.y
  }));
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

function prepare(points) {
  // resample, center, and scale
  let r = resample(points, RESAMPLE_POINTS);
  const c = centroid(r);
  r = subtract(r, c);
  r = scaleToUnit(r);
  return r;
}

function verifyTrace(userPath, templatePath) {
  // Both should be arrays of {x,y} in normalized coords
  if (!Array.isArray(userPath) || !Array.isArray(templatePath)) {
    return { success: false, score: Infinity, threshold: THRESHOLD, message: 'Invalid input' };
  }
  const P = prepare(userPath);    // user
  const Q = prepare(templatePath); // template

  // Compute best rotation from P to Q
  const R = kabschRotation(P, Q);
  const Prot = applyRotation(P, R);

  const score = rmsd(Prot, Q); // lower is better
  const success = score <= THRESHOLD;

  return {
    success,
    score,
    threshold: THRESHOLD,
    message: success ? 'Pass' : 'Fail'
  };
}

module.exports = { verifyTrace, resample, centroid, rmsd };
