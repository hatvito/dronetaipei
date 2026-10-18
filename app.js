// =========================================================================
// app.js - 主入口、明亮日光 3D 視圖、視角跟隨與全域 AI 提示詞功能 (v3.0)
// =========================================================================

const DEFAULT_CONTROLLER_CODE = `// 無人機自主避障控制器
class StudentController {
    constructor(goal_pos) {
        this.goal = goal_pos.slice();
        this.speed = 10.5;
        this.cruise_altitude = 12.0;
        this.sensorRange = 12.0;
        this.repulsePower = 16.0;
        this.tangentPower = 14.0;
        this.history = [];
        this.escapeTimer = 0.0;
        this.escapeDir = [0, 0, 0];
    }

    get_velocity(current_pos, raycast_func, dt) {
        const [cx, cy, cz] = current_pos;
        const [gx, gy, gz] = this.goal;

        this.history.push([cx, cz]);
        if (this.history.length > 30) this.history.shift();

        let isStuck = false;
        if (this.history.length === 30 && this.escapeTimer <= 0) {
            const p0 = this.history[0];
            if (Math.hypot(cx - p0[0], cz - p0[1]) < 0.25) isStuck = true;
        }

        if (isStuck) {
            this.escapeTimer = 1.8;
            const dx = gx - cx, dz = gz - cz;
            const len = Math.hypot(dx, dz) || 1.0;
            const bx = -dx / len, bz = -dz / len;
            const distLeft = raycast_func(current_pos, [-bz, 0, bx], 14.0);
            const distRight = raycast_func(current_pos, [bz, 0, -bx], 14.0);
            const side = distLeft > distRight ? [-bz, bx] : [bz, -bx];
            this.escapeDir = [bx * 0.3 + side[0] * 0.8, 0, bz * 0.3 + side[1] * 0.8];
        }

        if (this.escapeTimer > 0) {
            this.escapeTimer -= dt;
            this.history = [];
            const len = Math.hypot(this.escapeDir[0], this.escapeDir[2]) || 1.0;
            return [(this.escapeDir[0] / len) * (this.speed * 0.75), (this.cruise_altitude - cy) * 2.0, (this.escapeDir[2] / len) * (this.speed * 0.75)];
        }

        const dx = gx - cx, dz = gz - cz;
        const distGoalHoriz = Math.hypot(dx, dz) || 1.0;
        let fx = (dx / distGoalHoriz) * 2.2;
        let fz = (dz / distGoalHoriz) * 2.2;

        const numRays = 16;
        for (let i = 0; i < numRays; i++) {
            const angle = (Math.PI * 2 / numRays) * i;
            const rx = Math.cos(angle), rz = Math.sin(angle);
            const dist = raycast_func(current_pos, [rx, 0, rz], this.sensorRange);
            if (dist < this.sensorRange) {
                const rep = (1.0 / Math.max(dist, 0.1) - 1.0 / this.sensorRange) * this.repulsePower;
                fx -= rx * rep;
                fz -= rz * rep;
                const cross = (dx / distGoalHoriz) * rz - (dz / distGoalHoriz) * rx;
                const sign = cross >= 0 ? 1 : -1;
                fx += -rz * sign * ((1.0 - dist / this.sensorRange) * (this.tangentPower / numRays));
                fz += rx * sign * ((1.0 - dist / this.sensorRange) * (this.tangentPower / numRays));
            }
        }

        const hLen = Math.hypot(fx, fz) || 1.0;
        const dist3D = Math.hypot(gx - cx, gy - cy, gz - cz);
        const targetY = dist3D < 10.0 ? gy : Math.max(this.cruise_altitude, gy + 2.0);
        return [(fx / hLen) * this.speed, (targetY - cy) * 2.2, (fz / hLen) * this.speed];
    }
}`;

// 程式碼編輯器初始化與暫存
const codeTextarea = document.getElementById('controller-code');
let savedCode = "";
try { savedCode = localStorage.getItem('drone_student_code') || ""; } catch (e) {}
codeTextarea.value = (savedCode && savedCode.trim()) ? savedCode : DEFAULT_CONTROLLER_CODE;

let saveTimeout = null;
codeTextarea.addEventListener('input', () => {
    try { localStorage.setItem('drone_student_code', codeTextarea.value); } catch (e) {}
    const hint = document.getElementById('save-hint');
    if (hint) {
        hint.style.display = 'inline';
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => hint.style.display = 'none', 1500);
    }
});

// ------------------ 3D 視圖初始化 ------------------
const viewer = document.getElementById('viewer');
const scene = new THREE.Scene();

scene.background = new THREE.Color(0xdce5ed);
scene.fog = new THREE.FogExp2(0xdce5ed, 0.0035);
scene.add(cityGroup);

const camera = new THREE.PerspectiveCamera(45, (viewer.clientWidth || 800) / (viewer.clientHeight || 600), 1, 1000);
camera.position.set(50, 110, 85);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(viewer.clientWidth || 800, viewer.clientHeight || 600);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
viewer.appendChild(renderer.domElement);

const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.target.set(50, 0, 30);
controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.maxPolarAngle = Math.PI / 2 - 0.04;

const hemiLight = new THREE.HemisphereLight(0xffffff, 0xcfd6df, 0.85);
hemiLight.position.set(0, 150, 0);
scene.add(hemiLight);

const sunLight = new THREE.DirectionalLight(0xfffaed, 0.95);
sunLight.position.set(60, 130, 40);
scene.add(sunLight);

// 無人機本體與紅色航跡線
const droneMesh = new THREE.Mesh(
    new THREE.SphereGeometry(DRONE_RADIUS, 16, 16),
    new THREE.MeshLambertMaterial({ color: 0xef4444 })
);
scene.add(droneMesh);

let trailPositions = [];
let trailLine = null;
function clearTrail() {
    if (trailLine) scene.remove(trailLine);
    trailPositions = [];
    trailLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xd97706, linewidth: 2 }));
    trailLine.frustumCulled = false;
    scene.add(trailLine);
}
function appendTrail(x, y, z) {
    trailPositions.push(x, y, z);
    trailLine.geometry.setAttribute('position', new THREE.Float32BufferAttribute(trailPositions, 3));
    trailLine.geometry.attributes.position.needsUpdate = true;
}

let laserLine = null;
function showDirectLaser(fromPt, toPt) {
    if (laserLine) scene.remove(laserLine);
    const geom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...fromPt), new THREE.Vector3(...toPt)]);
    laserLine = new THREE.Line(geom, new THREE.LineDashedMaterial({ color: 0xd946ef, dashSize: 1.2, gapSize: 0.6, linewidth: 2 }));
    laserLine.frustumCulled = false;
    laserLine.computeLineDistances();
    scene.add(laserLine);
}

// 視角控制
let cameraMode = 'orbit';
const camOrbitBtn = document.getElementById('cam-orbit-btn');
const camFollowBtn = document.getElementById('cam-follow-btn');
if (camOrbitBtn) camOrbitBtn.addEventListener('click', () => { cameraMode = 'orbit'; camOrbitBtn.classList.add('active'); camFollowBtn.classList.remove('active'); controls.enabled = true; });
if (camFollowBtn) camFollowBtn.addEventListener('click', () => { cameraMode = 'follow'; camFollowBtn.classList.add('active'); camOrbitBtn.classList.remove('active'); controls.enabled = false; });

function animate() {
    requestAnimationFrame(animate);
    if (cameraMode === 'orbit') {
        controls.update();
    } else if (cameraMode === 'follow') {
        const dp = droneMesh.position;
        let vLen = Math.hypot(activeVelocity[0], activeVelocity[2]) || 1.0;
        const nx = activeVelocity[0] / vLen, nz = activeVelocity[2] / vLen;
        camera.position.x += (dp.x - nx * 4.5 - camera.position.x) * 0.15;
        camera.position.y += (dp.y + 2.5 - camera.position.y) * 0.15;
        camera.position.z += (dp.z - nz * 4.5 - camera.position.z) * 0.15;
        camera.lookAt(dp.x + nx * 2.0, dp.y + 0.3, dp.z + nz * 2.0);
    }
    renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
    if (!viewer.clientWidth || !viewer.clientHeight) return;
    camera.aspect = viewer.clientWidth / viewer.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(viewer.clientWidth, viewer.clientHeight);
});

// 重置場景
async function resetScene() {
    if (simInterval) clearInterval(simInterval);
    if (laserLine) { scene.remove(laserLine); laserLine = null; }
    clearTrail();

    const seedInput = document.getElementById('seed-input');
    let seedVal = seedInput ? parseInt(seedInput.value, 10) : 5655;
    if (isNaN(seedVal)) seedVal = 5655;
    seedVal = Math.max(0, Math.min(9999, seedVal));
    if (seedInput) seedInput.value = String(seedVal).padStart(4, '0');

    const mapDim = await loadRealCityBuildings(scene, seedVal, DRONE_RADIUS);
    if (mapDim) {
        controls.target.set(mapDim.mapWidth / 2, 0, mapDim.mapDepth / 2);
        camera.position.set(mapDim.mapWidth / 2, 110, mapDim.mapDepth / 2 + 70);
        controls.update();
    }

    droneMesh.position.set(...START_POS);
    activeVelocity = [1.0, 0.0, 1.0];

    document.getElementById('flight-status').innerText = "準備就緒";
    document.getElementById('flight-status').style.color = "#475569";
    document.getElementById('flight-time').innerText = "0.00";
    document.getElementById('flight-alt').innerText = START_POS[1].toFixed(2);
    document.getElementById('download-log-btn').disabled = true;

    updateScoreboard(START_POS, "待命出發");
}

document.getElementById('random-seed-btn')?.addEventListener('click', () => {
    document.getElementById('seed-input').value = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
    resetScene();
});
document.getElementById('apply-seed-btn')?.addEventListener('click', resetScene);

// =========================================================================
// 全域 AI 提示詞對話窗函式 (掛載至 window，保證 HTML inline onclick 100% 成功)
// =========================================================================

window.openPromptDialog = function() {
    const modal = document.getElementById('prompt-modal');
    if (modal) {
        modal.style.display = 'flex';
    }
};

window.closePromptDialog = function() {
    const modal = document.getElementById('prompt-modal');
    if (modal) {
        modal.style.display = 'none';
    }
};

window.copyPromptTextFromModal = function() {
    const txt = document.getElementById('prompt-text');
    const btn = document.getElementById('modal-copy-btn');
    if (txt) {
        navigator.clipboard.writeText(txt.innerText).then(() => {
            if (btn) {
                const old = btn.innerText;
                btn.innerText = "✅ 已複製！";
                setTimeout(() => btn.innerText = old, 2000);
            }
        });
    }
};

window.quickCopyPrompt = function() {
    const txt = document.getElementById('prompt-text');
    const btn = document.getElementById('quick-prompt-btn');
    if (txt) {
        navigator.clipboard.writeText(txt.innerText).then(() => {
            if (btn) {
                const old = btn.innerText;
                btn.innerText = "✅ 提示詞已複製！";
                btn.style.background = "#10b981";
                btn.style.color = "#fff";
                setTimeout(() => {
                    btn.innerText = old;
                    btn.style.background = "";
                    btn.style.color = "";
                }, 2000);
            }
        }).catch(() => {
            window.openPromptDialog();
        });
    }
};

// 點擊彈窗外背景關閉
window.addEventListener('click', (e) => {
    const modal = document.getElementById('prompt-modal');
    if (e.target === modal) {
        modal.style.display = 'none';
    }
});

// 模擬試飛啟動
document.getElementById('run-btn')?.addEventListener('click', async () => {
    await resetScene();

    let controllerInstance = null;
    try {
        const factory = new Function(`${document.getElementById('controller-code').value}; return new StudentController([${GOAL_POS.join(',')}]);`);
        controllerInstance = factory();
    } catch (err) {
        alert("控制器語法錯誤: " + err.message);
        return;
    }

    flightLogs = [];
    flightEvents = [];
    flightSummary = null;
    flightEvents.push(`[0.00s] 無人機自綠色大樓屋頂起飛。`);

    let currentPos = [...START_POS];
    droneMesh.position.set(...currentPos);
    appendTrail(...currentPos);

    const statusEl = document.getElementById('flight-status');
    statusEl.innerText = "飛行中...";
    statusEl.style.color = "#0284c7";

    let timer = 0.0;
    const dt = 0.033;

    simInterval = setInterval(() => {
        timer += dt;
        document.getElementById('flight-time').innerText = timer.toFixed(2);
        document.getElementById('flight-alt').innerText = currentPos[1].toFixed(2);
        updateScoreboard(currentPos, "飛行中");

        let vel = [0, 0, 0];
        try {
            vel = controllerInstance.get_velocity(currentPos, (orig, dir, maxD) => raycastSafe(orig, dir, maxD), dt);
        } catch (err) {
            clearInterval(simInterval);
            statusEl.innerText = "執行期錯誤";
            statusEl.style.color = "#ef4444";
            finalizeFlight(currentPos, timer, `執行期錯誤: ${err.message}`);
            return;
        }

        activeVelocity = vel;
        const nextPos = [currentPos[0] + vel[0] * dt, currentPos[1] + vel[1] * dt, currentPos[2] + vel[2] * dt];
        const collision = checkContinuousPath(currentPos, nextPos, true);

        if (collision.hit) {
            clearInterval(simInterval);
            const crashPos = collision.pos || nextPos;
            droneMesh.position.set(...crashPos);
            appendTrail(...crashPos);
            statusEl.innerText = `墜毀：${collision.reason}`;
            statusEl.style.color = "#ef4444";
            showDirectLaser(crashPos, GOAL_POS);
            updateScoreboard(crashPos, `墜毀：${collision.reason}`);
            finalizeFlight(crashPos, timer, `墜毀：${collision.reason}`);
            return;
        }

        currentPos = nextPos;
        droneMesh.position.set(...currentPos);
        appendTrail(...currentPos);

        if (Math.hypot(currentPos[0] - GOAL_POS[0], currentPos[1] - GOAL_POS[1], currentPos[2] - GOAL_POS[2]) < 0.9) {
            clearInterval(simInterval);
            statusEl.innerText = "🎉 成功降落於金色目標大樓！";
            statusEl.style.color = "#10b981";
            updateScoreboard(GOAL_POS, "成功抵達 (完賽)");
            finalizeFlight(GOAL_POS, timer, "成功抵達 (完賽)");
            return;
        }

        if (timer > 200.0) {
            clearInterval(simInterval);
            statusEl.innerText = "任務超時";
            statusEl.style.color = "#d97706";
            finalizeFlight(currentPos, timer, "任務超時 (200s)");
        }
    }, 33);
});

// FDR 日誌下載
document.getElementById('download-log-btn')?.addEventListener('click', () => {
    if (!flightSummary) return;
    let content = `無人機黑盒子紀錄 (士林街區)\n狀態: ${flightSummary.status}\n總時間: ${flightSummary.duration}s\n剩餘距離: ${flightSummary.remainDist}m\n探索率: ${flightSummary.progress}%\n`;
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `drone_fdr_${Date.now()}.txt`;
    a.click();
});

// 啟動系統
resetScene();
