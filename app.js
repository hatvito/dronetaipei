// =========================================================================
// 無人機都市避障挑戰賽 - 台北士林真實街區 3D 實體長成版 (app.js)
// =========================================================================

// ------------------ 預設避障控制器策略 (具備切線繞行與脫困) ------------------
const DEFAULT_CONTROLLER_CODE = `// 無人機自主避障控制器
class StudentController {
    constructor(goal_pos) {
        this.goal = goal_pos; // 目標終點座標 [100.0, 14.25, 100.0]

        // ★ 關鍵運動與感知參數 (繁體中文註解)
        this.speed = 10.5;              // 最高巡航速度 (m/s，建議 8~13)
        this.cruise_altitude = 8.5;     // 巡航基準高度 (m)
        this.sensorRange = 11.0;        // 雷達探測距離 (m，建議 9~14)
        this.repulsePower = 15.0;       // 障礙物推開強度 (排斥力強度)
        this.tangentPower = 12.0;       // 切向繞行推力 (打破死角平衡)

        // 脫困狀態機參數
        this.history = [];
        this.escapeTimer = 0.0;
        this.escapeDir = [0, 0, 0];
    }

    get_velocity(current_pos, raycast_func, dt) {
        const [cx, cy, cz] = current_pos;
        const [gx, gy, gz] = this.goal;

        // 1. 卡死判定 (過去約 1 秒內位移小於 0.35m)
        this.history.push([cx, cz]);
        if (this.history.length > 32) this.history.shift();

        let isStuck = false;
        if (this.history.length === 32 && this.escapeTimer <= 0) {
            const p0 = this.history[0];
            const disp = Math.hypot(cx - p0[0], cz - p0[1]);
            if (disp < 0.35) isStuck = true;
        }

        // 2. 觸發脫困：向最開闊的方向轉向脫困
        if (isStuck) {
            this.escapeTimer = 1.6;
            const dx = gx - cx, dz = gz - cz;
            const len = Math.hypot(dx, dz) || 1.0;
            const bx = -dx / len, bz = -dz / len;
            const distLeft = raycast_func(current_pos, [-bz, 0, bx], 14.0);
            const distRight = raycast_func(current_pos, [bz, 0, -bx], 14.0);
            const side = distLeft > distRight ? [-bz, bx] : [bz, -bx];
            this.escapeDir = [bx * 0.4 + side[0] * 0.8, 0, bz * 0.4 + side[1] * 0.8];
        }

        // 3. 執行脫困
        if (this.escapeTimer > 0) {
            this.escapeTimer -= dt;
            this.history = [];
            const len = Math.hypot(this.escapeDir[0], this.escapeDir[2]) || 1.0;
            return [
                (this.escapeDir[0] / len) * (this.speed * 0.75),
                (this.cruise_altitude + 2.0 - cy) * 2.5,
                (this.escapeDir[2] / len) * (this.speed * 0.75)
            ];
        }

        // 4. 朝向目標引力
        const dx = gx - cx, dz = gz - cz;
        const distGoal = Math.hypot(dx, dz) || 1.0;
        let fx = (dx / distGoal) * 2.2;
        let fz = (dz / distGoal) * 2.2;

        // 5. 16 向高密度雷達光達探測與排斥力
        const numRays = 16;
        for (let i = 0; i < numRays; i++) {
            const angle = (Math.PI * 2 / numRays) * i;
            const rx = Math.cos(angle), rz = Math.sin(angle);
            const dist = raycast_func(current_pos, [rx, 0, rz], this.sensorRange);
            if (dist < this.sensorRange) {
                const rep = (1.0 / Math.max(dist, 0.15) - 1.0 / this.sensorRange) * this.repulsePower;
                fx -= rx * rep;
                fz -= rz * rep;

                // 切向渦流力繞行
                const cross = (dx / distGoal) * rz - (dz / distGoal) * rx;
                const sign = cross >= 0 ? 1 : -1;
                fx += -rz * sign * ((1.0 - dist / this.sensorRange) * (this.tangentPower / numRays));
                fz += rx * sign * ((1.0 - dist / this.sensorRange) * (this.tangentPower / numRays));
            }
        }

        const hLen = Math.hypot(fx, fz) || 1.0;
        const vx = (fx / hLen) * this.speed;
        const vz = (fz / hLen) * this.speed;

        // 垂直定高與平滑進場
        const dist3D = Math.hypot(gx - cx, gy - cy, gz - cz);
        const targetY = dist3D < 14.0 ? gy : this.cruise_altitude;
        const vy = (targetY - cy) * 2.2;

        return [vx, vy, vz];
    }
}`;

// 編輯器儲存機制防呆
const codeTextarea = document.getElementById('controller-code');
let savedCode = "";
try {
    savedCode = localStorage.getItem('drone_student_code') || "";
} catch (e) {
    savedCode = "";
}

if (!savedCode || savedCode.trim().length === 0) {
    codeTextarea.value = DEFAULT_CONTROLLER_CODE;
} else {
    codeTextarea.value = savedCode;
}

let saveTimeout = null;
codeTextarea.addEventListener('input', () => {
    try {
        localStorage.setItem('drone_student_code', codeTextarea.value);
    } catch (e) {}
    const hint = document.getElementById('save-hint');
    if (hint) {
        hint.style.display = 'inline';
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => hint.style.display = 'none', 1500);
    }
});

// ------------------ 3D 視覺化場景初始化 ------------------
const viewer = document.getElementById('viewer');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0c0d10);

const camera = new THREE.PerspectiveCamera(45, (viewer.clientWidth || 800) / (viewer.clientHeight || 600), 1, 1000);
camera.position.set(50, 120, -50);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(viewer.clientWidth || 800, viewer.clientHeight || 600);
viewer.appendChild(renderer.domElement);

const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.target.set(50, 0, 50);
controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.maxPolarAngle = Math.PI / 2 - 0.05;

// 光照系統
const ambientLight = new THREE.AmbientLight(0xffffff, 0.85);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.7);
dirLight.position.set(60, 100, 40);
scene.add(dirLight);

// 電子圍欄 (100x100x25m)
const fenceGeo = new THREE.BoxGeometry(106, 26, 106);
const fenceWire = new THREE.WireframeGeometry(fenceGeo);
const fenceLine = new THREE.LineSegments(
    fenceWire,
    new THREE.LineBasicMaterial({ color: 0x004466, transparent: true, opacity: 0.35 })
);
fenceLine.position.set(50, 13, 50);
scene.add(fenceLine);

// 地面材質 (若有 map_texture.jpg 則自動載入，否則顯示科技格線)
const textureLoader = new THREE.TextureLoader();
textureLoader.load('map_texture.jpg', (tex) => {
    const groundGeo = new THREE.PlaneGeometry(100, 100);
    const groundMat = new THREE.MeshBasicMaterial({ map: tex });
    const groundMesh = new THREE.Mesh(groundGeo, groundMat);
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.position.set(50, 0.01, 50);
    scene.add(groundMesh);
}, undefined, () => {
    const gridHelper = new THREE.GridHelper(100, 50, 0x444455, 0x222233);
    gridHelper.position.set(50, 0, 50);
    scene.add(gridHelper);
});

const cityGroup = new THREE.Group();
scene.add(cityGroup);

// 無人機本體 (球體，半徑 0.25m)
const DRONE_RADIUS = 0.25;
const droneMesh = new THREE.Mesh(
    new THREE.SphereGeometry(DRONE_RADIUS, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0x00ffff })
);
scene.add(droneMesh);

// 航跡繪製
let trailPositions = [];
let trailLine = null;

function clearTrail() {
    if (trailLine) scene.remove(trailLine);
    trailPositions = [];
    const geom = new THREE.BufferGeometry();
    const mat = new THREE.LineBasicMaterial({ color: 0xffaa00, linewidth: 2 });
    trailLine = new THREE.Line(geom, mat);
    trailLine.frustumCulled = false;
    scene.add(trailLine);
}

function appendTrail(x, y, z) {
    trailPositions.push(x, y, z);
    trailLine.geometry.setAttribute('position', new THREE.Float32BufferAttribute(trailPositions, 3));
    trailLine.geometry.attributes.position.needsUpdate = true;
    trailLine.geometry.computeBoundingSphere();
}

// 終點直線雷射指引線
let laserLine = null;
function showDirectLaser(fromPt, toPt) {
    if (laserLine) scene.remove(laserLine);
    const geom = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(...fromPt),
        new THREE.Vector3(...toPt)
    ]);
    const mat = new THREE.LineDashedMaterial({ color: 0xff1493, dashSize: 1.2, gapSize: 0.6, linewidth: 2 });
    laserLine = new THREE.Line(geom, mat);
    laserLine.frustumCulled = false;
    laserLine.computeLineDistances();
    scene.add(laserLine);
}

function clearLaser() {
    if (laserLine) {
        scene.remove(laserLine);
        laserLine = null;
    }
}

// 碰撞向量箭頭
let crashArrow = null;
function showCrashVector(pos, vel) {
    if (crashArrow) scene.remove(crashArrow);
    const dir = new THREE.Vector3(vel[0], vel[1], vel[2]);
    const len = dir.length();
    if (len > 0.01) {
        dir.normalize();
        crashArrow = new THREE.ArrowHelper(dir, new THREE.Vector3(...pos), Math.min(len * 0.35, 3.5), 0xffff00, 0.8, 0.4);
        scene.add(crashArrow);
    }
}

function clearCrashVector() {
    if (crashArrow) {
        scene.remove(crashArrow);
        crashArrow = null;
    }
}

window.addEventListener('resize', () => {
    if (!viewer.clientWidth || !viewer.clientHeight) return;
    camera.aspect = viewer.clientWidth / viewer.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(viewer.clientWidth, viewer.clientHeight);
});

// ------------------ 視角切換控制 ------------------
let cameraMode = 'orbit';
const camOrbitBtn = document.getElementById('cam-orbit-btn');
const camFollowBtn = document.getElementById('cam-follow-btn');
let activeVelocity = [1.0, 0.0, 1.0];

function setCameraMode(mode) {
    cameraMode = mode;
    if (mode === 'orbit') {
        if (camOrbitBtn) camOrbitBtn.classList.add('active');
        if (camFollowBtn) camFollowBtn.classList.remove('active');
        controls.enabled = true;
        camera.position.set(50, 120, -50);
        controls.target.set(50, 0, 50);
        controls.update();
    } else {
        if (camFollowBtn) camFollowBtn.classList.add('active');
        if (camOrbitBtn) camOrbitBtn.classList.remove('active');
        controls.enabled = false;
        const dp = droneMesh.position;
        let vx = activeVelocity[0], vz = activeVelocity[2];
        let vLen = Math.hypot(vx, vz) || 1.0;
        camera.position.set(dp.x - (vx / vLen) * 5.0, dp.y + 2.5, dp.z - (vz / vLen) * 5.0);
        camera.lookAt(dp.x, dp.y + 0.5, dp.z);
    }
}

if (camOrbitBtn) camOrbitBtn.addEventListener('click', () => setCameraMode('orbit'));
if (camFollowBtn) camFollowBtn.addEventListener('click', () => setCameraMode('follow'));

function animate() {
    requestAnimationFrame(animate);
    if (cameraMode === 'orbit') {
        controls.update();
    } else if (cameraMode === 'follow') {
        const dp = droneMesh.position;
        let vx = activeVelocity[0], vz = activeVelocity[2];
        let vLen = Math.hypot(vx, vz) || 1.0;
        const nx = vx / vLen, nz = vz / vLen;
        camera.position.x += (dp.x - nx * 5.0 - camera.position.x) * 0.15;
        camera.position.y += (dp.y + 2.5 - camera.position.y) * 0.15;
        camera.position.z += (dp.z - nz * 5.0 - camera.position.z) * 0.15;
        camera.lookAt(dp.x + nx * 2.5, dp.y + 0.5, dp.z + nz * 2.5);
    }
    renderer.render(scene, camera);
}
animate();

// ------------------ 真實建築群幾何系統 (GeoJSON Extrusion) ------------------
const START_POS = [0, 6.25, 0];
const GOAL_POS = [100, 14.25, 100];
const BASE_TOTAL_DIST = Math.hypot(GOAL_POS[0] - START_POS[0], GOAL_POS[1] - START_POS[1], GOAL_POS[2] - START_POS[2]);
const GEOFENCE = { xmin: -3.0, xmax: 103.0, zmin: -3.0, zmax: 103.0, ymax: 25.0 };
let buildings = [];

// 建立單棟立體實心建築
function addSolidBuilding(bx, bz, bw, bd, bh, colorHex, isSpecial = false) {
    const geo = new THREE.BoxGeometry(bw, bh, bd);
    const solidMat = new THREE.MeshLambertMaterial({ 
        color: isSpecial ? colorHex : 0x2e323b 
    });
    const solidMesh = new THREE.Mesh(geo, solidMat);
    solidMesh.position.set(bx, bh / 2, bz);
    cityGroup.add(solidMesh);

    const edgesGeo = new THREE.EdgesGeometry(geo);
    const edgesMat = new THREE.LineBasicMaterial({ 
        color: isSpecial ? colorHex : 0x00d2ff, 
        transparent: true, 
        opacity: 0.5 
    });
    const wireLine = new THREE.LineSegments(edgesGeo, edgesMat);
    solidMesh.add(wireLine);

    buildings.push({
        xmin: bx - bw / 2, xmax: bx + bw / 2,
        zmin: bz - bd / 2, zmax: bz + bd / 2,
        height: bh,
        mesh: solidMesh
    });
}

// 載入真實士林建築：優先嘗試讀取 shilin.geojson，若無則啟動真實地標備案
async function loadRealCityBuildings() {
    while (cityGroup.children.length > 0) {
        cityGroup.remove(cityGroup.children[0]);
    }
    buildings = [];

    // 起點停機坪 (綠色)
    addSolidBuilding(0, 0, 2.5, 2.5, 6.0, 0x00ff88, true);
    const startPad = new THREE.Mesh(
        new THREE.CylinderGeometry(0.8, 0.8, 0.05, 16),
        new THREE.MeshBasicMaterial({ color: 0x00ff88 })
    );
    startPad.position.set(0, 6.02, 0);
    cityGroup.add(startPad);

    // 終點停機坪 (金色)
    addSolidBuilding(100, 100, 2.5, 2.5, 14.0, 0xffd700, true);
    const goalPad = new THREE.Mesh(
        new THREE.CylinderGeometry(0.8, 0.8, 0.05, 16),
        new THREE.MeshBasicMaterial({ color: 0xffd700 })
    );
    goalPad.position.set(100, 14.02, 100);
    cityGroup.add(goalPad);

    let loadedFromGeoJSON = false;

    try {
        const response = await fetch('shilin.geojson');
        if (response.ok) {
            const geojson = await response.json();
            const features = geojson.features || [];

            // 1. 取得這批建築的經緯度四極值
            let minLon = Infinity, maxLon = -Infinity;
            let minLat = Infinity, maxLat = -Infinity;

            features.forEach(f => {
                if (!f.geometry || !f.geometry.coordinates) return;
                const coords = f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry.coordinates[0][0];
                if (!coords) return;
                coords.forEach(([lon, lat]) => {
                    if (lon < minLon) minLon = lon;
                    if (lon > maxLon) maxLon = lon;
                    if (lat < minLat) minLat = lat;
                    if (lat > maxLat) maxLat = lat;
                });
            });

            const MAP_SIZE = 92.0;

            // 2. 依多邊形拉伸長出真實建築
            features.forEach((f, idx) => {
                if (!f.geometry || !f.geometry.coordinates) return;
                const coords = f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry.coordinates[0][0];
                if (!coords || coords.length < 3) return;

                const shape = new THREE.Shape();
                let bMinX = Infinity, bMaxX = -Infinity;
                let bMinZ = Infinity, bMaxZ = -Infinity;

                coords.forEach(([lon, lat], i) => {
                    const x = 4.0 + ((lon - minLon) / (maxLon - minLon)) * MAP_SIZE;
                    const z = 4.0 + ((lat - minLat) / (maxLat - minLat)) * MAP_SIZE;

                    bMinX = Math.min(bMinX, x);
                    bMaxX = Math.max(bMaxX, x);
                    bMinZ = Math.min(bMinZ, z);
                    bMaxZ = Math.max(bMaxZ, z);

                    if (i === 0) shape.moveTo(x, z);
                    else shape.lineTo(x, z);
                });

                const cx = (bMinX + bMaxX) / 2;
                const cz = (bMinZ + bMaxZ) / 2;

                // 避開起點與終點停機區域
                if (Math.hypot(cx, cz) < 6.5 || Math.hypot(cx - 100, cz - 100) < 6.5) return;

                // 真實高度換算 (限制於 23m 內防止違反 25m 限高)
                let rawH = parseFloat(f.properties?.height || (f.properties?.['building:levels'] ? f.properties['building:levels'] * 3.2 : null));
                let bh = rawH ? Math.min(23.0, Math.max(6.0, rawH * 0.45)) : (8.0 + ((idx * 7) % 13));

                const extrudeSettings = { depth: bh, bevelEnabled: false };
                const geom = new THREE.ExtrudeGeometry(shape, extrudeSettings);
                geom.rotateX(Math.PI / 2);

                const mat = new THREE.MeshLambertMaterial({ color: 0x2e3440 });
                const mesh = new THREE.Mesh(geom, mat);
                mesh.position.y = bh;
                cityGroup.add(mesh);

                const edges = new THREE.LineSegments(
                    new THREE.EdgesGeometry(geom),
                    new THREE.LineBasicMaterial({ color: 0x00d2ff, transparent: true, opacity: 0.5 })
                );
                mesh.add(edges);

                buildings.push({
                    xmin: bMinX, xmax: bMaxX,
                    zmin: bMinZ, zmax: bMaxZ,
                    height: bh,
                    mesh: mesh
                });
            });

            if (buildings.length > 2) {
                loadedFromGeoJSON = true;
                console.log(`成功由 shilin.geojson 生成真實建物共 ${buildings.length - 2} 棟！`);
            }
        }
    } catch (e) {
        console.warn("未檢測到 shilin.geojson，將啟動真實士林街區預設結構。");
    }

    // 若無外部 GeoJSON 檔案，啟動士林核心真實地標備案
    if (!loadedFromGeoJSON) {
        const fallbackLandmarks = [
            { x: 38.5, z: 48.2, w: 18.0, d: 16.0, h: 22.0 }, // 科教館
            { x: 52.0, z: 45.0, w: 14.5, d: 14.5, h: 15.0 }, // 天文館
            { x: 57.0, z: 51.0, w: 8.0, d: 8.0, h: 18.0 },   // 天文館觀測台
            { x: 22.0, z: 62.0, w: 15.0, d: 12.0, h: 16.0 }, // 兒童新樂園設施
            { x: 26.0, z: 75.0, w: 16.0, d: 14.0, h: 12.5 }, // 兒童新樂園室內館
            { x: 68.0, z: 32.0, w: 22.0, d: 10.0, h: 14.0 }, // 士林高商
            { x: 62.0, z: 22.0, w: 14.0, d: 12.0, h: 13.0 }, // 士林高商活動中心
            { x: 78.0, z: 55.0, w: 16.0, d: 8.0, h: 15.0 },  // 陽明高中校舍 A
            { x: 82.0, z: 68.0, w: 14.0, d: 8.0, h: 15.0 },  // 陽明高中校舍 B
            { x: 72.0, z: 78.0, w: 10.0, d: 10.0, h: 18.0 }, // 基河路大樓群 A
            { x: 84.0, z: 82.0, w: 11.0, d: 9.0, h: 19.5 },  // 基河路大樓群 B
            { x: 42.0, z: 30.0, w: 7.0, d: 7.0, h: 8.0 }     // 美崙公園服務處
        ];
        fallbackLandmarks.forEach(b => addSolidBuilding(b.x, b.z, b.w, b.d, b.h, 0x2e323b));
    }
}

// ------------------ 物理碰撞與光達 (CCD + AABB) ------------------
function checkSphereCollision(pos) {
    const [x, y, z] = pos;
    const r = DRONE_RADIUS;

    if (x - r < GEOFENCE.xmin || x + r > GEOFENCE.xmax ||
        z - r < GEOFENCE.zmin || z + r > GEOFENCE.zmax) {
        return { hit: true, reason: "碰觸電子圍欄邊界 (Geofence Breach)" };
    }
    if (y + r > GEOFENCE.ymax) {
        return { hit: true, reason: "超出空域限高 25m" };
    }
    if (y - r < 0) {
        return { hit: true, reason: "機體墜落地面" };
    }

    for (let b of buildings) {
        const cx = Math.max(b.xmin, Math.min(x, b.xmax));
        const cy = Math.max(0, Math.min(y, b.height));
        const cz = Math.max(b.zmin, Math.min(z, b.zmax));

        const distSq = (x - cx)**2 + (y - cy)**2 + (z - cz)**2;
        if (distSq <= (r * 0.96)**2) {
            if (b.mesh && b.mesh.material) {
                b.mesh.material.color.setHex(0xff0044);
            }
            return { 
                hit: true, 
                reason: "撞擊台北市建物外牆", 
                building: b, 
                contactPoint: [cx, cy, cz] 
            };
        }
    }
    return { hit: false };
}

// 連續路徑細分檢測 (CCD)
function checkContinuousPath(p1, p2, step = 0.03) {
    const dx = p2[0] - p1[0], dy = p2[1] - p1[1], dz = p2[2] - p1[2];
    const dist = Math.hypot(dx, dy, dz);
    if (dist === 0) return checkSphereCollision(p1);

    const steps = Math.ceil(dist / step);
    for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const checkPos = [p1[0] + dx * t, p1[1] + dy * t, p1[2] + dz * t];
        const res = checkSphereCollision(checkPos);
        if (res.hit) {
            return { 
                hit: true, 
                pos: checkPos, 
                reason: res.reason, 
                contactPoint: res.contactPoint 
            };
        }
    }
    return { hit: false };
}

// 光達淨距探測函式
function raycastSafe(origin, direction, maxDist = 15.0) {
    const dLen = Math.hypot(direction[0], direction[1], direction[2]);
    if (dLen === 0) return maxDist;
    const nx = direction[0] / dLen, ny = direction[1] / dLen, nz = direction[2] / dLen;

    let d = 0.1;
    const step = 0.2;
    while (d < maxDist) {
        d += step;
        const p = [origin[0] + nx * d, origin[1] + ny * d, origin[2] + nz * d];
        if (checkSphereCollision(p).hit) {
            return Math.max(0, d - DRONE_RADIUS);
        }
    }
    return maxDist;
}

// ------------------ 儀表板與黑盒子日誌系統 ------------------
let flightLogs = [];
let flightEvents = [];
let flightSummary = null;

function addFlightEvent(timeSec, text) {
    flightEvents.push(`[${timeSec.toFixed(2)}s] ${text}`);
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

async function resetScene() {
    if (simInterval) clearInterval(simInterval);
    clearLaser();
    clearCrashVector();
    clearTrail();
    await loadRealCityBuildings();

    droneMesh.position.set(...START_POS);
    activeVelocity = [1.0, 0.0, 1.0];

    const statusEl = document.getElementById('flight-status');
    if (statusEl) {
        statusEl.innerText = "準備就緒";
        statusEl.style.color = "#bbb";
    }

    const timeEl = document.getElementById('flight-time');
    if (timeEl) timeEl.innerText = "0.00";

    const altEl = document.getElementById('flight-alt');
    if (altEl) altEl.innerText = START_POS[1].toFixed(2);

    const logBtn = document.getElementById('download-log-btn');
    if (logBtn) logBtn.disabled = true;

    updateScoreboard(START_POS, "待命出發");
}

// ------------------ 介面事件綁定 ------------------
document.getElementById('random-seed-btn').addEventListener('click', resetScene);
document.getElementById('apply-seed-btn').addEventListener('click', resetScene);

const modal = document.getElementById('prompt-modal');
document.getElementById('open-prompt-modal-btn').addEventListener('click', () => modal.style.display = 'flex');
document.getElementById('close-modal-btn').addEventListener('click', () => modal.style.display = 'none');
document.getElementById('copy-prompt-btn').addEventListener('click', () => {
    navigator.clipboard.writeText(document.getElementById('prompt-text').innerText).then(() => {
        const btn = document.getElementById('copy-prompt-btn');
        btn.innerText = "✅ 提示詞已複製！";
        setTimeout(() => btn.innerText = "📋 複製提示詞", 2000);
    });
});

document.getElementById('download-log-btn').addEventListener('click', () => {
    if (!flightSummary) return;
    let content = `=======================================================================\n`;
    content += `        無人機黑盒子飛行紀錄 (台北士林真實街區版)        \n`;
    content += `=======================================================================\n`;
    content += `產出時間             : ${new Date().toLocaleString()}\n`;
    content += `任務總飛行時間       : ${flightSummary.duration} 秒\n`;
    content += `最終任務狀態         : ${flightSummary.status}\n`;
    content += `最後座標位置 [X,Y,Z] : [${flightSummary.finalPos.join(', ')}]\n`;
    content += `直達終點 3D 剩餘距離 : ${flightSummary.remainDist} 公尺\n`;
    content += `航程探索達成率       : ${flightSummary.progress} %\n\n`;

    content += `-----------------------------------------------------------------------\n`;
    content += `【飛行歷程摘要】\n`;
    flightEvents.forEach(evt => content += `${evt}\n`);

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `drone_fdr_shilin_${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
});

// ------------------ 模擬執行迴圈 ------------------
let simInterval = null;

document.getElementById('run-btn').addEventListener('click', async () => {
    await resetScene();

    let controllerInstance = null;
    try {
        const code = document.getElementById('controller-code').value;
        const factory = new Function(`${code}; return new StudentController([${GOAL_POS.join(',')}]);`);
        controllerInstance = factory();
    } catch (err) {
        alert("控制器代碼語法錯誤: " + err.message);
        return;
    }

    flightLogs = [];
    flightEvents = [];
    flightSummary = null;
    addFlightEvent(0.0, `無人機從起點停機坪 (0.00, 6.25, 0.00) 啟動起飛。`);

    let currentPos = [...START_POS];
    droneMesh.position.set(...currentPos);
    appendTrail(...currentPos);

    const statusEl = document.getElementById('flight-status');
    const timeEl = document.getElementById('flight-time');
    const altEl = document.getElementById('flight-alt');

    statusEl.innerText = "飛行中...";
    statusEl.style.color = "#00d2ff";

    let timer = 0.0;
    const dt = 0.033;

    simInterval = setInterval(() => {
        timer += dt;
        timeEl.innerText = timer.toFixed(2);
        altEl.innerText = currentPos[1].toFixed(2);
        updateScoreboard(currentPos, "飛行中");

        let vel = [0, 0, 0];
        try {
            vel = controllerInstance.get_velocity(
                currentPos,
                (orig, dir, maxD) => raycastSafe(orig, dir, maxD),
                dt
            );
        } catch (err) {
            clearInterval(simInterval);
            statusEl.innerText = "執行期錯誤";
            statusEl.style.color = "#ff4444";
            finalizeFlight(currentPos, timer, `執行期錯誤: ${err.message}`);
            return;
        }

        activeVelocity = vel;

        const nextPos = [
            currentPos[0] + vel[0] * dt,
            currentPos[1] + vel[1] * dt,
            currentPos[2] + vel[2] * dt
        ];

        // 連續碰撞檢測
        const collision = checkContinuousPath(currentPos, nextPos);
        if (collision.hit) {
            clearInterval(simInterval);
            const crashPos = collision.pos || nextPos;
            droneMesh.position.set(...crashPos);
            appendTrail(...crashPos);

            statusEl.innerText = `墜毀：${collision.reason}`;
            statusEl.style.color = "#ff3366";

            showCrashVector(crashPos, vel);
            showDirectLaser(crashPos, GOAL_POS);
            updateScoreboard(crashPos, `墜毀：${collision.reason}`);
            finalizeFlight(crashPos, timer, `墜毀：${collision.reason}`);
            return;
        }

        currentPos = nextPos;
        droneMesh.position.set(...currentPos);
        appendTrail(...currentPos);

        const distToGoal = Math.hypot(
            currentPos[0] - GOAL_POS[0],
            currentPos[1] - GOAL_POS[1],
            currentPos[2] - GOAL_POS[2]
        );

        // 完賽判定
        if (distToGoal < 1.5) {
            clearInterval(simInterval);
            statusEl.innerText = "🎉 成功抵達終點！";
            statusEl.style.color = "#00ff88";
            updateScoreboard(GOAL_POS, "成功抵達 (完賽)");
            finalizeFlight(GOAL_POS, timer, "成功抵達 (完賽)");
            return;
        }

        // 超時判定 (200秒)
        if (timer > 200.0) {
            clearInterval(simInterval);
            statusEl.innerText = "任務超時";
            statusEl.style.color = "#ffaa00";
            finalizeFlight(currentPos, timer, "任務超時 (200s)");
            return;
        }
    }, 33);
});

function finalizeFlight(finalPos, duration, statusText) {
    const remain3D = Math.hypot(GOAL_POS[0] - finalPos[0], GOAL_POS[1] - finalPos[1], GOAL_POS[2] - finalPos[2]);
    const progress = Math.max(0, Math.min(100, ((BASE_TOTAL_DIST - remain3D) / BASE_TOTAL_DIST) * 100));

    flightSummary = {
        duration: duration.toFixed(2),
        finalPos: finalPos.map(v => v.toFixed(2)),
        status: statusText,
        remainDist
