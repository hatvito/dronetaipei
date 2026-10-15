// =========================================================================
// 無人機都市避障挑戰賽 - 台北士林街區底圖對齊與隨機頂樓任務版 (app.js)
// =========================================================================

// ------------------ 預設避障控制器策略 ------------------
const DEFAULT_CONTROLLER_CODE = `// 無人機自主避障控制器
class StudentController {
    constructor(goal_pos) {
        this.goal = goal_pos.slice();
        this.speed = 10.5;              // 巡航速度 (m/s)
        this.cruise_altitude = 12.0;    // 基準巡航高度 (m)
        this.sensorRange = 12.0;        // 光達探測距離 (m)
        this.repulsePower = 16.0;       // 障礙物排斥力
        this.tangentPower = 14.0;       // 切向繞行力 (突破死角)

        this.history = [];
        this.escapeTimer = 0.0;
        this.escapeDir = [0, 0, 0];
    }

    get_velocity(current_pos, raycast_func, dt) {
        const [cx, cy, cz] = current_pos;
        const [gx, gy, gz] = this.goal;

        // 1. 卡死檢測與脫困機制
        this.history.push([cx, cz]);
        if (this.history.length > 30) this.history.shift();

        let isStuck = false;
        if (this.history.length === 30 && this.escapeTimer <= 0) {
            const p0 = this.history[0];
            const disp = Math.hypot(cx - p0[0], cz - p0[1]);
            if (disp < 0.3) isStuck = true;
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
            return [
                (this.escapeDir[0] / len) * (this.speed * 0.75),
                (this.cruise_altitude - cy) * 2.0,
                (this.escapeDir[2] / len) * (this.speed * 0.75)
            ];
        }

        // 2. 目標導引力
        const dx = gx - cx, dz = gz - cz;
        const distGoalHoriz = Math.hypot(dx, dz) || 1.0;
        let fx = (dx / distGoalHoriz) * 2.2;
        let fz = (dz / distGoalHoriz) * 2.2;

        // 3. 16 向虛擬光達環景掃描
        const numRays = 16;
        for (let i = 0; i < numRays; i++) {
            const angle = (Math.PI * 2 / numRays) * i;
            const rx = Math.cos(angle), rz = Math.sin(angle);
            const dist = raycast_func(current_pos, [rx, 0, rz], this.sensorRange);
            if (dist < this.sensorRange) {
                const rep = (1.0 / Math.max(dist, 0.15) - 1.0 / this.sensorRange) * this.repulsePower;
                fx -= rx * rep;
                fz -= rz * rep;

                // 切向旋轉推力
                const cross = (dx / distGoalHoriz) * rz - (dz / distGoalHoriz) * rx;
                const sign = cross >= 0 ? 1 : -1;
                fx += -rz * sign * ((1.0 - dist / this.sensorRange) * (this.tangentPower / numRays));
                fz += rx * sign * ((1.0 - dist / this.sensorRange) * (this.tangentPower / numRays));
            }
        }

        const hLen = Math.hypot(fx, fz) || 1.0;
        const vx = (fx / hLen) * this.speed;
        const vz = (fz / hLen) * this.speed;

        // 4. 自適應垂直高度與進場降落
        const dist3D = Math.hypot(gx - cx, gy - cy, gz - cz);
        const targetY = dist3D < 12.0 ? gy : Math.max(this.cruise_altitude, gy + 2.0);
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
scene.background = new THREE.Color(0x0a0c10);

const camera = new THREE.PerspectiveCamera(45, (viewer.clientWidth || 800) / (viewer.clientHeight || 600), 1, 1000);
camera.position.set(50, 130, 125);

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
const ambientLight = new THREE.AmbientLight(0xffffff, 0.92);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.65);
dirLight.position.set(60, 120, 40);
scene.add(dirLight);

// 都市與物件群組
const cityGroup = new THREE.Group();
scene.add(cityGroup);

// ------------------ 動態底圖與地面系統 ------------------
let groundPlaneMesh = null;

function updateGroundMap(bounds) {
    if (groundPlaneMesh) {
        scene.remove(groundPlaneMesh);
        if (groundPlaneMesh.geometry) groundPlaneMesh.geometry.dispose();
        if (groundPlaneMesh.material) {
            if (groundPlaneMesh.material.map) groundPlaneMesh.material.map.dispose();
            groundPlaneMesh.material.dispose();
        }
        groundPlaneMesh = null;
    }

    const bw = bounds.xmax - bounds.xmin;
    const bd = bounds.zmax - bounds.zmin;
    const centerX = (bounds.xmin + bounds.xmax) / 2;
    const centerZ = (bounds.zmin + bounds.zmax) / 2;

    const textureLoader = new THREE.TextureLoader();
    textureLoader.load(
        'map_shilin.jpg',
        (tex) => {
            tex.wrapS = THREE.ClampToEdgeWrapping;
            tex.wrapT = THREE.ClampToEdgeWrapping;

            const planeGeo = new THREE.PlaneGeometry(bw, bd);
            const planeMat = new THREE.MeshBasicMaterial({
                map: tex,
                side: THREE.FrontSide,
                depthWrite: true
            });

            groundPlaneMesh = new THREE.Mesh(planeGeo, planeMat);
            groundPlaneMesh.rotation.x = -Math.PI / 2;
            groundPlaneMesh.position.set(centerX, -0.01, centerZ);
            scene.add(groundPlaneMesh);
            console.log("真實地圖底圖已成功載入並對齊邊界！");
        },
        undefined,
        () => {
            // 回退方案：深色格線地面
            const planeGeo = new THREE.PlaneGeometry(bw, bd);
            const planeMat = new THREE.MeshLambertMaterial({ color: 0x141820 });
            groundPlaneMesh = new THREE.Mesh(planeGeo, planeMat);
            groundPlaneMesh.rotation.x = -Math.PI / 2;
            groundPlaneMesh.position.set(centerX, -0.02, centerZ);
            scene.add(groundPlaneMesh);

            const gridHelper = new THREE.GridHelper(Math.max(bw, bd), 40, 0x00d2ff, 0x223344);
            gridHelper.position.set(centerX, 0.01, centerZ);
            groundPlaneMesh.add(gridHelper);
        }
    );
}

// 電子圍欄可視化線框
let fenceLineSegments = null;
function updateFenceVisual(bounds) {
    if (fenceLineSegments) scene.remove(fenceLineSegments);

    const bw = bounds.xmax - bounds.xmin;
    const bd = bounds.zmax - bounds.zmin;
    const bh = bounds.ymax;

    const fenceGeo = new THREE.BoxGeometry(bw, bh, bd);
    const fenceWire = new THREE.WireframeGeometry(fenceGeo);
    fenceLineSegments = new THREE.LineSegments(
        fenceWire,
        new THREE.LineBasicMaterial({ color: 0x0088cc, transparent: true, opacity: 0.35 })
    );
    fenceLineSegments.position.set(
        (bounds.xmin + bounds.xmax) / 2,
        bh / 2,
        (bounds.zmin + bounds.zmax) / 2
    );
    scene.add(fenceLineSegments);
}

// ------------------ 無人機與標記 ------------------
const DRONE_RADIUS = 0.25;
const droneMesh = new THREE.Mesh(
    new THREE.SphereGeometry(DRONE_RADIUS, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0x00ffff })
);
scene.add(droneMesh);

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
    } else {
        if (camFollowBtn) camFollowBtn.classList.add('active');
        if (camOrbitBtn) camOrbitBtn.classList.remove('active');
        controls.enabled = false;
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
        camera.position.x += (dp.x - nx * 5.5 - camera.position.x) * 0.15;
        camera.position.y += (dp.y + 3.0 - camera.position.y) * 0.15;
        camera.position.z += (dp.z - nz * 5.5 - camera.position.z) * 0.15;
        camera.lookAt(dp.x + nx * 2.5, dp.y + 0.5, dp.z + nz * 2.5);
    }
    renderer.render(scene, camera);
}
animate();

// ------------------ 偽隨機種子生成器 (PRNG) ------------------
function createSeededRandom(seedInt) {
    let s = Math.abs(seedInt) || 1;
    return function() {
        s = (s * 9301 + 49297) % 233280;
        return s / 233280;
    };
}

// ------------------ 真實建築群建構與頂樓起降配置 ------------------
let buildings = [];
let START_POS = [10, 8.25, 10];
let GOAL_POS = [85, 16.25, 85];
let BASE_TOTAL_DIST = 100.0;
let GEOFENCE = { xmin: 0, xmax: 100, zmin: 0, zmax: 100, ymax: 25.0 };
let cachedRawGeoJSON = null;

function addSolidBuilding(bx, bz, bw, bd, bh, colorHex) {
    const geo = new THREE.BoxGeometry(bw, bh, bd);
    const solidMat = new THREE.MeshLambertMaterial({ color: colorHex || 0x242833 });
    const solidMesh = new THREE.Mesh(geo, solidMat);
    solidMesh.position.set(bx, bh / 2, bz);
    cityGroup.add(solidMesh);

    const edgesGeo = new THREE.EdgesGeometry(geo);
    const edgesMat = new THREE.LineBasicMaterial({ color: 0x00d2ff, transparent: true, opacity: 0.5 });
    const wireLine = new THREE.LineSegments(edgesGeo, edgesMat);
    solidMesh.add(wireLine);

    buildings.push({
        xmin: bx - bw / 2, xmax: bx + bw / 2,
        zmin: bz - bd / 2, zmax: bz + bd / 2,
        height: bh,
        mesh: solidMesh,
        cx: bx, cz: bz, width: bw, depth: bd
    });
}

function createHelipad(x, y, z, colorHex) {
    const padGroup = new THREE.Group();
    const pad = new THREE.Mesh(
        new THREE.CylinderGeometry(1.2, 1.2, 0.08, 16),
        new THREE.MeshBasicMaterial({ color: colorHex })
    );
    pad.position.set(x, y + 0.04, z);
    padGroup.add(pad);

    const ring = new THREE.Mesh(
        new THREE.RingGeometry(1.35, 1.55, 24),
        new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, y + 0.05, z);
    padGroup.add(ring);

    cityGroup.add(padGroup);
    return padGroup;
}

async function loadRealCityBuildings(seedValue) {
    while (cityGroup.children.length > 0) {
        cityGroup.remove(cityGroup.children[0]);
    }
    buildings = [];

    const rng = createSeededRandom(seedValue);

    // 嘗試讀取本地 GeoJSON
    if (!cachedRawGeoJSON) {
        try {
            const resp = await fetch('shilin.geojson');
            if (resp.ok) cachedRawGeoJSON = await resp.json();
        } catch (e) {
            cachedRawGeoJSON = null;
        }
    }

    if (cachedRawGeoJSON && cachedRawGeoJSON.features && cachedRawGeoJSON.features.length > 0) {
        const features = cachedRawGeoJSON.features;

        let minLon = Infinity, maxLon = -Infinity;
        let minLat = Infinity, maxLat = -Infinity;

        features.forEach(f => {
            if (!f.geometry || !f.geometry.coordinates) return;
            const coords = f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : (f.geometry.coordinates[0] ? f.geometry.coordinates[0][0] : null);
            if (!coords) return;
            coords.forEach(([lon, lat]) => {
                if (lon < minLon) minLon = lon;
                if (lon > maxLon) maxLon = lon;
                if (lat < minLat) minLat = lat;
                if (lat > maxLat) maxLat = lat;
            });
        });

        const MAP_SCALE = 90.0;

        features.forEach((f, idx) => {
            if (!f.geometry || !f.geometry.coordinates) return;
            const coords = f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : (f.geometry.coordinates[0] ? f.geometry.coordinates[0][0] : null);
            if (!coords || coords.length < 3) return;

            const shape = new THREE.Shape();
            let bMinX = Infinity, bMaxX = -Infinity;
            let bMinZ = Infinity, bMaxZ = -Infinity;

            coords.forEach(([lon, lat], i) => {
                // 上北下南對齊：
                // X (經度，西->東遞增)
                const x = 5.0 + ((lon - minLon) / (maxLon - minLon)) * MAP_SCALE;
                // Z (緯度，北->南遞增：maxLat 為最北方對應小 Z，minLat 為南方對應大 Z)
                const z = 5.0 + ((maxLat - lat) / (maxLat - minLat)) * MAP_SCALE;

                bMinX = Math.min(bMinX, x);
                bMaxX = Math.max(bMaxX, x);
                bMinZ = Math.min(bMinZ, z);
                bMaxZ = Math.max(bMaxZ, z);

                if (i === 0) shape.moveTo(x, z);
                else shape.lineTo(x, z);
            });

            let rawH = parseFloat(f.properties?.height || (f.properties?.['building:levels'] ? f.properties['building:levels'] * 3.2 : null));
            let bh = rawH ? Math.min(23.0, Math.max(5.5, rawH * 0.45)) : (7.0 + ((idx * 7) % 14));

            const extrudeSettings = { depth: bh, bevelEnabled: false };
            const geom = new THREE.ExtrudeGeometry(shape, extrudeSettings);
            geom.rotateX(Math.PI / 2);

            const mat = new THREE.MeshLambertMaterial({ color: 0x242833 });
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
                mesh: mesh,
                cx: (bMinX + bMaxX) / 2,
                cz: (bMinZ + bMaxZ) / 2,
                width: bMaxX - bMinX,
                depth: bMaxZ - bMinZ
            });
        });
    }

    // 若無外部 GeoJSON，啟動真實士林地標幾何（已翻轉為上北下南）
    if (buildings.length < 5) {
        const fallbackLandmarks = [
            { x: 38.5, z: 51.8, w: 18.0, d: 16.0, h: 22.0 }, // 科教館
            { x: 52.0, z: 55.0, w: 14.5, d: 14.5, h: 15.0 }, // 天文館
            { x: 57.0, z: 49.0, w: 8.0, d: 8.0, h: 18.0 },   // 天文館天線台
            { x: 22.0, z: 38.0, w: 15.0, d: 12.0, h: 16.0 }, // 兒童新樂園設施
            { x: 26.0, z: 25.0, w: 16.0, d: 14.0, h: 12.5 }, // 兒童新樂園室內館
            { x: 68.0, z: 68.0, w: 22.0, d: 10.0, h: 14.0 }, // 士林高商
            { x: 62.0, z: 78.0, w: 14.0, d: 12.0, h: 13.0 }, // 士林高商活動中心
            { x: 78.0, z: 45.0, w: 16.0, d: 8.0, h: 15.0 },  // 陽明高中 A
            { x: 82.0, z: 32.0, w: 14.0, d: 8.0, h: 15.0 },  // 陽明高中 B
            { x: 72.0, z: 22.0, w: 10.0, d: 10.0, h: 18.0 }, // 基河路大樓 A
            { x: 84.0, z: 18.0, w: 11.0, d: 9.0, h: 19.5 },  // 基河路大樓 B
            { x: 42.0, z: 70.0, w: 7.0, d: 7.0, h: 8.0 }     // 美崙公園服務處
        ];
        fallbackLandmarks.forEach(b => addSolidBuilding(b.x, b.z, b.w, b.d, b.h));
    }

    // ★ 緊密包裹電子圍欄 (邊界外推 2.0 公尺，杜絕外圈偷跑)
    let bGlobalMinX = Infinity, bGlobalMaxX = -Infinity;
    let bGlobalMinZ = Infinity, bGlobalMaxZ = -Infinity;
    buildings.forEach(b => {
        bGlobalMinX = Math.min(bGlobalMinX, b.xmin);
        bGlobalMaxX = Math.max(bGlobalMaxX, b.xmax);
        bGlobalMinZ = Math.min(bGlobalMinZ, b.zmin);
        bGlobalMaxZ = Math.max(bGlobalMaxZ, b.zmax);
    });

    const FENCE_MARGIN = 2.0;
    GEOFENCE = {
        xmin: bGlobalMinX - FENCE_MARGIN,
        xmax: bGlobalMaxX + FENCE_MARGIN,
        zmin: bGlobalMinZ - FENCE_MARGIN,
        zmax: bGlobalMaxZ + FENCE_MARGIN,
        ymax: 25.0
    };

    updateFenceVisual(GEOFENCE);
    updateGroundMap(GEOFENCE); // 同步對齊底圖

    // ★ 隨機種子選取起終點建築物樓頂
    let candidateBuildings = buildings.filter(b => b.width >= 3.5 && b.depth >= 3.5);
    if (candidateBuildings.length < 2) candidateBuildings = buildings;

    let idxA = Math.floor(rng() * candidateBuildings.length);
    let idxB = Math.floor(rng() * candidateBuildings.length);

    let attempts = 0;
    while (attempts < 60) {
        const bA = candidateBuildings[idxA];
        const bB = candidateBuildings[idxB];
        const d = Math.hypot(bA.cx - bB.cx, bA.cz - bB.cz);
        if (idxA !== idxB && d > 45.0) break;
        idxB = Math.floor(rng() * candidateBuildings.length);
        attempts++;
    }

    const startB = candidateBuildings[idxA];
    const goalB = candidateBuildings[idxB];

    // 起點停機坪 (綠色)
    START_POS = [startB.cx, startB.height + DRONE_RADIUS + 0.05, startB.cz];
    createHelipad(startB.cx, startB.height, startB.cz, 0x00ff88);

    // 終點停機坪 (金色)
    GOAL_POS = [goalB.cx, goalB.height + DRONE_RADIUS + 0.05, goalB.cz];
    createHelipad(goalB.cx, goalB.height, goalB.cz, 0xffd700);

    BASE_TOTAL_DIST = Math.hypot(GOAL_POS[0] - START_POS[0], GOAL_POS[1] - START_POS[1], GOAL_POS[2] - START_POS[2]);

    const cX = (GEOFENCE.xmin + GEOFENCE.xmax) / 2;
    const cZ = (GEOFENCE.zmin + GEOFENCE.zmax) / 2;
    controls.target.set(cX, 0, cZ);
    camera.position.set(cX, 125, cZ + 80);
    controls.update();

    console.log(`種子 ${seedValue} 成功配置任務：起點位於大樓頂 (${START_POS.map(v=>v.toFixed(1))})，終點位於大樓頂 (${GOAL_POS.map(v=>v.toFixed(1))})，總直線距 ${BASE_TOTAL_DIST.toFixed(1)}m`);
}

// ------------------ 物理碰撞與連續路徑細分檢測 ------------------
function checkSphereCollision(pos) {
    const [x, y, z] = pos;
    const r = DRONE_RADIUS;

    if (x - r < GEOFENCE.xmin || x + r > GEOFENCE.xmax ||
        z - r < GEOFENCE.zmin || z + r > GEOFENCE.zmax) {
        return { hit: true, reason: "碰觸電子圍欄邊界 (禁航區違規)" };
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
        if (distSq <= (r * 0.95)**2) {
            // 起降保護：若處於停機坪正上方且貼地，不誤判碰撞
            const isAtStartPad = Math.hypot(x - START_POS[0], z - START_POS[2]) < 1.3 && Math.abs(y - START_POS[1]) < 0.3;
            const isAtGoalPad = Math.hypot(x - GOAL_POS[0], z - GOAL_POS[2]) < 1.3 && Math.abs(y - GOAL_POS[1]) < 0.3;
            if (isAtStartPad || isAtGoalPad) continue;

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

function raycastSafe(origin, direction, maxDist = 15.0) {
    const dLen = Math.hypot(direction[0], direction[1], direction[2]);
    if (dLen === 0) return maxDist;
    const nx = direction[0] / dLen, ny = direction[1] / dLen, nz = direction[2] / dLen;

    let d = 0.15;
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

    const seedInput = document.getElementById('seed-input');
    const currentSeed = seedInput ? parseInt(seedInput.value, 10) || 5655 : 5655;

    await loadRealCityBuildings(currentSeed);

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

// ------------------ 事件綁定 ------------------
const seedInput = document.getElementById('seed-input');
const randomSeedBtn = document.getElementById('random-seed-btn');
const applySeedBtn = document.getElementById('apply-seed-btn');

if (randomSeedBtn) {
    randomSeedBtn.addEventListener('click', () => {
        if (seedInput) seedInput.value = Math.floor(Math.random() * 9000 + 1000);
        resetScene();
    });
}

if (applySeedBtn) {
    applySeedBtn.addEventListener('click', resetScene);
}

const modal = document.getElementById('prompt-modal');
const openPromptBtn = document.getElementById('open-prompt-modal-btn');
const closeModalBtn = document.getElementById('close-modal-btn');
const copyPromptBtn = document.getElementById('copy-prompt-btn');

if (openPromptBtn) openPromptBtn.addEventListener('click', () => modal.style.display = 'flex');
if (closeModalBtn) closeModalBtn.addEventListener('click', () => modal.style.display = 'none');
if (copyPromptBtn) {
    copyPromptBtn.addEventListener('click', () => {
        const txt = document.getElementById('prompt-text');
        if (txt) {
            navigator.clipboard.writeText(txt.innerText).then(() => {
                copyPromptBtn.innerText = "✅ 提示詞已複製！";
                setTimeout(() => copyPromptBtn.innerText = "📋 複製提示詞", 2000);
            });
        }
    });
}

const downloadLogBtn = document.getElementById('download-log-btn');
if (downloadLogBtn) {
    downloadLogBtn.addEventListener('click', () => {
        if (!flightSummary) return;
        let content = `=======================================================================\n`;
        content += `        無人機黑盒子飛行紀錄 (台北士林大樓頂樓起降版)        \n`;
        content += `=======================================================================\n`;
        content += `產出時間             : ${new Date().toLocaleString()}\n`;
        content += `任務總飛行時間       : ${flightSummary.duration} 秒\n`;
        content += `最終任務狀態         : ${flightSummary.status}\n`;
        content += `最後座標位置 [X,Y,Z] : [${flightSummary.finalPos.join(', ')}]\n`;
        content += `直達終點 3D 剩餘距離 : ${flightSummary.remainDist} 公尺\n`;
        content += `航程探索達成率       : ${flightSummary.progress} %\n\n`;

        content += `-----------------------------------------------------------------------\n`;
        content += `【飛行歷程事件】\n`;
        flightEvents.forEach(evt => content += `${evt}\n`);

        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `drone_fdr_rooftop_${Date.now()}.txt`;
        a.click();
        URL.revokeObjectURL(url);
    });
}

// ------------------ 模擬執行迴圈 ------------------
let simInterval = null;

const runBtn = document.getElementById('run-btn');
if (runBtn) {
    runBtn.addEventListener('click', async () => {
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
        addFlightEvent(0.0, `無人機自大樓樓頂停機坪 (${START_POS.map(v=>v.toFixed(2)).join(', ')}) 起飛。`);

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

            // 連續路徑細分碰撞檢測 (CCD)
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

            // 成功降落判定 (到達目標樓頂 1.6m 範圍內)
            if (distToGoal < 1.6) {
                clearInterval(simInterval);
                statusEl.innerText = "🎉 成功降落於目標大樓頂！";
                statusEl.style.color = "#00ff88";
                updateScoreboard(GOAL_POS, "成功抵達 (完賽)");
                finalizeFlight(GOAL_POS, timer, "成功抵達 (完賽)");
                return;
            }

            // 超時判定 (200 秒)
            if (timer > 200.0) {
                clearInterval(simInterval);
                statusEl.innerText = "任務超時";
                statusEl.style.color = "#ffaa00";
                finalizeFlight(currentPos, timer, "任務超時 (200s)");
                return;
            }
        }, 33);
    });
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

// 系統初始化就緒載入
resetScene();
