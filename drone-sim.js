// =========================================================================
// drone-sim.js - 物理避障、光達射線、連續碰撞 (CCD) 與黑盒子日誌
// =========================================================================

const DRONE_RADIUS = 0.12;
let activeVelocity = [1.0, 0.0, 1.0];
let simInterval = null;

let flightLogs = [];
let flightEvents = [];
let flightSummary = null;

function checkSphereCollision(pos, isCrashCheck = false) {
    const [x, y, z] = pos;
    const r = DRONE_RADIUS;

    if (x - r < GEOFENCE.xmin || x + r > GEOFENCE.xmax ||
        z - r < GEOFENCE.zmin || z + r > GEOFENCE.zmax) {
        return { hit: true, reason: "碰觸電子圍欄邊界 (禁航區違規)" };
    }
    if (y + r > GEOFENCE.ymax) return { hit: true, reason: "超出空域限高 25m" };
    if (y - r < 0) return { hit: true, reason: "機體墜落地面" };

    for (let b of buildings) {
        const cx = Math.max(b.xmin, Math.min(x, b.xmax));
        const cy = Math.max(0, Math.min(y, b.height));
        const cz = Math.max(b.zmin, Math.min(z, b.zmax));

        const distSq = (x - cx)**2 + (y - cy)**2 + (z - cz)**2;
        if (distSq <= (r * 0.95)**2) {
            const isAtStartPad = Math.hypot(x - START_POS[0], z - START_POS[2]) < 0.9 && Math.abs(y - START_POS[1]) < 0.3;
            const isAtGoalPad = Math.hypot(x - GOAL_POS[0], z - GOAL_POS[2]) < 0.9 && Math.abs(y - GOAL_POS[1]) < 0.3;
            if (isAtStartPad || isAtGoalPad) continue;

            if (isCrashCheck && b.mesh && !b.isStart && !b.isGoal) {
                const redMat = new THREE.MeshLambertMaterial({ color: 0xef4444 });
                b.mesh.material = [redMat, redMat, redMat, redMat, redMat, redMat];
            }

            return { hit: true, reason: "撞擊台北市建物外牆", building: b, contactPoint: [cx, cy, cz] };
        }
    }
    return { hit: false };
}

function checkContinuousPath(p1, p2, isCrashCheck = false, step = 0.02) {
    const dx = p2[0] - p1[0], dy = p2[1] - p1[1], dz = p2[2] - p1[2];
    const dist = Math.hypot(dx, dy, dz);
    if (dist === 0) return checkSphereCollision(p1, isCrashCheck);

    const steps = Math.ceil(dist / step);
    for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const checkPos = [p1[0] + dx * t, p1[1] + dy * t, p1[2] + dz * t];
        const res = checkSphereCollision(checkPos, isCrashCheck);
        if (res.hit) return { hit: true, pos: checkPos, reason: res.reason };
    }
    return { hit: false };
}

function raycastSafe(origin, direction, maxDist = 15.0) {
    const dLen = Math.hypot(direction[0], direction[1], direction[2]);
    if (dLen === 0) return maxDist;
    const nx = direction[0] / dLen, ny = direction[1] / dLen, nz = direction[2] / dLen;

    let d = 0.1;
    const step = 0.15;
    while (d < maxDist) {
        d += step;
        const p = [origin[0] + nx * d, origin[1] + ny * d, origin[2] + nz * d];
        if (checkSphereCollision(p, false).hit) {
            return Math.max(0, d - DRONE_RADIUS);
        }
    }
    return maxDist;
}

function updateScoreboard(pos, status) {
    const [x, y, z] = pos;
    const remain3D = Math.hypot(GOAL_POS[0] - x, GOAL_POS[1] - y, GOAL_POS[2] - z);
    const remainHoriz = Math.hypot(GOAL_POS[0] - x, GOAL_POS[2] - z);
    const progress = Math.max(0, Math.min(100, ((BASE_TOTAL_DIST - remain3D) / BASE_TOTAL_DIST) * 100));

    const hudDist = document.getElementById('hud-dist');
    if (hudDist) hudDist.innerText = remain3D.toFixed(1);
    const scoreRemain = document.getElementById('score-remain-dist');
    if (scoreRemain) scoreRemain.innerText = `${remain3D.toFixed(2)} m`;
    const scoreHoriz = document.getElementById('score-horiz-dist');
    if (scoreHoriz) scoreHoriz.innerText = `${remainHoriz.toFixed(2)} m`;
    const scoreProg = document.getElementById('score-progress');
    if (scoreProg) scoreProg.innerText = `${progress.toFixed(1)} %`;
    const scoreStat = document.getElementById('score-status');
    if (scoreStat) scoreStat.innerText = status;

    return remain3D;
}

function finalizeFlight(finalPos, duration, statusText) {
    const remain3D = Math.hypot(GOAL_POS[0] - finalPos[0], GOAL_POS[1] - finalPos[1], GOAL_POS[2] - finalPos[2]);
    const progress = Math.max(0, Math.min(100, ((BASE_TOTAL_DIST - remain3D) / BASE_TOTAL_DIST) * 100));

    flightSummary = {
        duration: duration.toFixed(2),
        finalPos: finalPos.map(v => v.toFixed(2)),
        status: statusText,
        remainDist: remain3D.toFixed(2),
        progress: progress.toFixed(1)
    };

    const logBtn = document.getElementById('download-log-btn');
    if (logBtn) logBtn.disabled = false;
}
