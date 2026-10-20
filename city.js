// =========================================================================
// city.js - 整合 3d.html 台灣特色高擬真街廓、鐵皮水塔屋頂與起訖點配置
// =========================================================================

let cityGroup = new THREE.Group();
let buildings = [];
let START_POS = [10, 8.25, 10];
let GOAL_POS = [85, 16.25, 40];
let BASE_TOTAL_DIST = 100.0;
let GEOFENCE = { xmin: 5.0, xmax: 95.0, zmin: 5.0, zmax: 48.0, ymax: 25.0 };
let groundPlaneMesh = null;
let fenceLineSegments = null;

// 尺度轉換常數 (3d.html 1024x534 -> 無人機賽事 100x52.15 公尺)
const SRC_W = 1024.0;
const SRC_H = 534.0;
const MAP_WIDTH = 100.0;
const MAP_DEPTH = (SRC_H / SRC_W) * MAP_WIDTH; // 52.148m
const SCALE_FACTOR = MAP_WIDTH / SRC_W;        // 0.097656

// 坐標換算函式：將 3d.html 的 (u, v) 直接轉為 3D 世界坐標 (X, Z)
const toWorldX = (u) => u * SCALE_FACTOR;
const toWorldZ = (v) => v * SCALE_FACTOR;

let rngSeed = 1337;
function seededRandom() {
    rngSeed = (rngSeed * 16807) % 2147483647;
    return (rngSeed - 1) / 2147483646;
}
function randRange(min, max) {
    return min + seededRandom() * (max - min);
}

// ------------------ 1. 3d.html 台灣特色立面材質與鐵皮材質庫 ------------------
const facadeMaterials = {};
const roofMaterials = {};

function initRichFacadeAndRoofMaterials() {
    function makeFacadeTexture(opts) {
        const c = document.createElement('canvas');
        c.width = 128;
        c.height = 128;
        const ctx = c.getContext('2d');

        ctx.fillStyle = opts.bg;
        ctx.fillRect(0, 0, 128, 128);

        if (opts.tileLines) {
            ctx.fillStyle = 'rgba(0,0,0,0.06)';
            for (let y = 0; y < 128; y += 4) ctx.fillRect(0, y, 128, 1);
        }

        const cellW = 128 / opts.cols;
        const cellH = 128 / opts.rows;

        for (let r = 0; r < opts.rows; r++) {
            ctx.fillStyle = opts.ledgeColor || 'rgba(0,0,0,0.16)';
            ctx.fillRect(0, r * cellH, 128, 2.5);

            for (let col = 0; col < opts.cols; col++) {
                const padX = cellW * (opts.padX || 0.16);
                const padY = cellH * (opts.padY || 0.22);
                const wx = col * cellW + padX;
                const wy = r * cellH + padY;
                const ww = cellW - padX * 2;
                const wh = cellH - padY * 2;

                ctx.fillStyle = opts.win;
                ctx.fillRect(wx, wy, ww, wh);

                if (opts.ironBars && (r + col) % 2 === 0) {
                    ctx.strokeStyle = 'rgba(30,41,59,0.45)';
                    ctx.lineWidth = 1;
                    ctx.strokeRect(wx - 1, wy - 1, ww + 2, wh + 2);
                }
                if (opts.balcony) {
                    ctx.fillStyle = opts.balconyColor || 'rgba(51,65,85,0.38)';
                    ctx.fillRect(col * cellW + 3, (r + 0.62) * cellH, cellW - 6, cellH * 0.28);
                }
            }
        }

        const tex = new THREE.CanvasTexture(c);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        return tex;
    }

    facadeMaterials.oldGreyStone = new THREE.MeshStandardMaterial({
        map: makeFacadeTexture({ bg: '#cec8be', win: '#334155', rows: 5, cols: 4, balcony: true, ironBars: true }),
        roughness: 0.85
    });
    facadeMaterials.oldWarmTile = new THREE.MeshStandardMaterial({
        map: makeFacadeTexture({ bg: '#dfd3c3', win: '#1e293b', rows: 5, cols: 4, balcony: true, ironBars: true, tileLines: true }),
        roughness: 0.8
    });
    facadeMaterials.pinkCeramic = new THREE.MeshStandardMaterial({
        map: makeFacadeTexture({ bg: '#d9beb8', win: '#334155', rows: 6, cols: 4, balcony: true, tileLines: true }),
        roughness: 0.75
    });
    facadeMaterials.redBrick = new THREE.MeshStandardMaterial({
        map: makeFacadeTexture({ bg: '#b87d6b', win: '#1e293b', rows: 5, cols: 4, balcony: true, tileLines: true }),
        roughness: 0.82
    });
    facadeMaterials.greenMosaic = new THREE.MeshStandardMaterial({
        map: makeFacadeTexture({ bg: '#b8cbbd', win: '#1e293b', rows: 5, cols: 4, balcony: true, ironBars: true }),
        roughness: 0.82
    });
    facadeMaterials.midriseMansion = new THREE.MeshStandardMaterial({
        map: makeFacadeTexture({ bg: '#cbd5e1', win: '#0f172a', rows: 8, cols: 5, balcony: true, tileLines: true }),
        roughness: 0.5
    });
    facadeMaterials.highriseLuxury = new THREE.MeshStandardMaterial({
        map: makeFacadeTexture({ bg: '#94a3b8', win: '#0f172a', rows: 12, cols: 6 }),
        roughness: 0.3
    });
    facadeMaterials.glassTower = new THREE.MeshStandardMaterial({
        map: makeFacadeTexture({ bg: '#60a5fa', win: '#091526', rows: 14, cols: 8 }),
        roughness: 0.2
    });

    roofMaterials.concrete = new THREE.MeshStandardMaterial({ color: 0xb8b4ac, roughness: 0.9 });
    roofMaterials.darkConcrete = new THREE.MeshStandardMaterial({ color: 0x8c8881, roughness: 0.92 });
    roofMaterials.tinGreen = new THREE.MeshStandardMaterial({ color: 0x22c55e, roughness: 0.6 });
    roofMaterials.tinDarkGreen = new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.6 });
    roofMaterials.tinBlue = new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.6 });
    roofMaterials.tinRed = new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.6 });
}
initRichFacadeAndRoofMaterials();

const FACADE_KEYS = ['oldGreyStone', 'oldWarmTile', 'pinkCeramic', 'redBrick', 'greenMosaic', 'midriseMansion'];
const ROOF_TIN_KEYS = ['tinGreen', 'tinDarkGreen', 'tinBlue', 'tinRed'];

// ------------------ 2. 鋪設底圖與緊縮圍欄 ------------------
function updateGroundMap(scene) {
    if (groundPlaneMesh) scene.remove(groundPlaneMesh);

    const textureLoader = new THREE.TextureLoader();
    textureLoader.load('map_shilin.png', (tex) => {
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;

        const planeGeo = new THREE.PlaneGeometry(MAP_WIDTH, MAP_DEPTH);
        const planeMat = new THREE.MeshLambertMaterial({ map: tex, side: THREE.FrontSide });
        groundPlaneMesh = new THREE.Mesh(planeGeo, planeMat);
        groundPlaneMesh.rotation.x = -Math.PI / 2;
        groundPlaneMesh.position.set(MAP_WIDTH / 2, -0.01, MAP_DEPTH / 2);
        scene.add(groundPlaneMesh);
    });
}

function updateFenceVisual(scene, bounds) {
    if (fenceLineSegments) scene.remove(fenceLineSegments);
    const bw = bounds.xmax - bounds.xmin;
    const bd = bounds.zmax - bounds.zmin;
    const bh = bounds.ymax;

    const fenceGeo = new THREE.BoxGeometry(bw, bh, bd);
    const fenceWire = new THREE.WireframeGeometry(fenceGeo);
    fenceLineSegments = new THREE.LineSegments(
        fenceWire,
        new THREE.LineBasicMaterial({ color: 0x0077cc, transparent: true, opacity: 0.35 })
    );
    fenceLineSegments.position.set((bounds.xmin + bounds.xmax) / 2, bh / 2, (bounds.zmin + bounds.zmax) / 2);
    scene.add(fenceLineSegments);
}

function createHelipad(x, y, z, colorHex) {
    const padGroup = new THREE.Group();
    const pad = new THREE.Mesh(
        new THREE.CylinderGeometry(0.75, 0.75, 0.08, 20),
        new THREE.MeshLambertMaterial({ color: colorHex })
    );
    pad.position.set(x, y + 0.04, z);
    padGroup.add(pad);

    const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.85, 1.02, 24),
        new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, y + 0.05, z);
    padGroup.add(ring);

    cityGroup.add(padGroup);
    return padGroup;
}

// ------------------ 3. 3d.html 建築生成演算法 (帶物理 Hitbox 登記) ------------------
const rawBuildingDescriptors = [];

function registerRawBuilding(u, v, w, d, h, rotRad, opts = {}) {
    rawBuildingDescriptors.push({ u, v, w, d, h, rotRad, opts });
}

function buildTaiwanStreetBlock(topUVs, botUVs, opts = {}) {
    const topPts = topUVs.map(p => new THREE.Vector2(p[0], p[1]));
    const botPts = botUVs.map(p => new THREE.Vector2(p[0], p[1]));

    const cols = opts.cols || 8;
    for (let c = 0; c < cols; c++) {
        const tStart = c / cols;
        const tEnd = (c + 1) / cols;
        const tMid = (tStart + tEnd) / 2;

        const pTop = new THREE.Vector2().lerpVectors(topPts[0], topPts[topPts.length - 1], tMid);
        const pBot = new THREE.Vector2().lerpVectors(botPts[0], botPts[botPts.length - 1], tMid);

        const dx = (topPts[topPts.length - 1].x - topPts[0].x) / cols;
        const dz = (topPts[topPts.length - 1].y - topPts[0].y) / cols;
        const rot = -Math.atan2(dz, dx);

        const blockW = Math.hypot(dx, dz) * 0.88;
        const totalD = pTop.distanceTo(pBot);

        // 高度縮放轉換至 25m 限高範圍內
        let rawH = opts.zone === 'luxury_highrise' ? randRange(14, 23) : (opts.zone === 'avenue_commercial' ? randRange(10, 20) : randRange(6.5, 15.5));

        if (opts.doubleRow && totalD > 12) {
            const eachD = (totalD - 2.5) / 2;
            const u1 = pTop.x + (pBot.x - pTop.x) * 0.25;
            const v1 = pTop.y + (pBot.y - pTop.y) * 0.25;
            const u2 = pBot.x + (pTop.x - pBot.x) * 0.25;
            const v2 = pBot.y + (pTop.y - pBot.y) * 0.25;

            registerRawBuilding(u1, v1, blockW, eachD * 0.85, rawH, rot, { zone: opts.zone, name: opts.name });
            registerRawBuilding(u2, v2, blockW, eachD * 0.85, rawH * randRange(0.85, 1.15), rot, { zone: opts.zone, name: opts.name });
        } else {
            const uMid = (pTop.x + pBot.x) / 2;
            const vMid = (pTop.y + pBot.y) / 2;
            registerRawBuilding(uMid, vMid, blockW, totalD * 0.8, rawH, rot, { zone: opts.zone, name: opts.name });
        }
    }
}

// 初始化 3d.html 街廓結構佈局
function generateCityLayout() {
    rawBuildingDescriptors.length = 0;
    rngSeed = 1337;

    // 核心地標
    registerRawBuilding(374, 76, 42, 38, 24.0, 0.08, { isLandmark: true, name: '金仁寶總部主樓' });
    registerRawBuilding(515, 76, 75, 45, 19.5, 0.06, { isLandmark: true, name: 'NVIDIA 基地' });
    registerRawBuilding(184, 108, 38, 48, 23.5, 0, { isLandmark: true, name: '中鼎第二總部' });
    registerRawBuilding(644, 55, 45, 36, 17.5, 0, { isLandmark: true, name: '高等行政法院' });
    registerRawBuilding(740, 385, 52, 45, 23.5, 0.14, { isLandmark: true, name: '新光醫院主醫療大樓' });
    registerRawBuilding(538, 355, 42, 42, 19.0, 0, { isLandmark: true, name: '科教館' });
    registerRawBuilding(635, 345, 36, 36, 16.5, 0, { isLandmark: true, name: '天文館' });

    // 文林路 615~681 巷
    buildTaiwanStreetBlock([[775, 8], [888, 18]], [[762, 42], [884, 34]], { cols: 11, doubleRow: true, zone: 'old_walkup', name: '文林路681巷' });
    buildTaiwanStreetBlock([[760, 48], [886, 42]], [[756, 80], [890, 58]], { cols: 12, doubleRow: true, zone: 'old_walkup', name: '文昌國小北巷' });
    buildTaiwanStreetBlock([[762, 88], [894, 66]], [[770, 108], [898, 88]], { cols: 11, doubleRow: true, zone: 'old_walkup', name: '文昌國小東側' });
    buildTaiwanStreetBlock([[818, 104], [902, 95]], [[824, 130], [908, 120]], { cols: 9, doubleRow: true, zone: 'old_walkup', name: '文林路643巷' });

    // 美崙街、文昌路
    buildTaiwanStreetBlock([[760, 196], [945, 196]], [[762, 216], [952, 226]], { cols: 15, doubleRow: true, zone: 'old_walkup', name: '文林路587巷' });
    buildTaiwanStreetBlock([[766, 226], [958, 236]], [[772, 258], [962, 252]], { cols: 16, doubleRow: true, zone: 'old_walkup', name: '下樹林街廓' });
    buildTaiwanStreetBlock([[784, 302], [972, 275]], [[788, 328], [976, 296]], { cols: 16, doubleRow: true, zone: 'old_walkup', name: '美崙街南側' });
    buildTaiwanStreetBlock([[802, 402], [986, 368]], [[808, 428], [990, 394]], { cols: 16, doubleRow: true, zone: 'mixed_alley', name: '華光街南段' });
    buildTaiwanStreetBlock([[812, 434], [995, 400]], [[822, 472], [1005, 430]], { cols: 14, doubleRow: true, zone: 'avenue_commercial', name: '中正路商辦' });

    // 基河路 396 巷豪宅群
    buildTaiwanStreetBlock([[548, 402], [618, 396]], [[558, 434], [630, 390]], { cols: 7, doubleRow: true, zone: 'luxury_highrise', name: '基河路396巷北' });
    buildTaiwanStreetBlock([[554, 444], [638, 398]], [[574, 480], [662, 430]], { cols: 8, doubleRow: true, zone: 'luxury_highrise', name: '基河路396巷南' });
    buildTaiwanStreetBlock([[578, 488], [668, 438]], [[602, 522], [692, 470]], { cols: 8, doubleRow: true, zone: 'luxury_highrise', name: '基河路300巷' });

    // 北士科洲美廠辦
    buildTaiwanStreetBlock([[62, 28], [150, 28]], [[62, 68], [150, 68]], { cols: 6, doubleRow: true, zone: 'avenue_commercial', name: '福國路廠辦' });
    buildTaiwanStreetBlock([[62, 156], [150, 156]], [[62, 255], [150, 232]], { cols: 6, doubleRow: true, zone: 'luxury_highrise', name: '福善路科技樓' });
}
generateCityLayout();

// ------------------ 4. 載入並建構真實都市建築群 ------------------
async function loadRealCityBuildings(scene, seedValue, droneRadius) {
    while (cityGroup.children.length > 0) {
        cityGroup.remove(cityGroup.children[0]);
    }
    buildings = [];

    // 偽隨機種子雜湊 (0000~9999)
    let s = (Math.abs(seedValue) % 10000) ^ 0x6D2B79F5;
    const rng = () => {
        s = (s * 9301 + 49297) % 233280;
        return s / 233280;
    };

    // 電子圍欄（向內收縮 5 公尺）
    const INSET = 5.0;
    GEOFENCE = { xmin: INSET, xmax: MAP_WIDTH - INSET, zmin: INSET, zmax: MAP_DEPTH - INSET, ymax: 25.0 };
    updateFenceVisual(scene, GEOFENCE);
    updateGroundMap(scene);

    // 篩選落入圍欄內的合法起訖建築候選
    const validIndices = [];
    rawBuildingDescriptors.forEach((b, idx) => {
        const wx = toWorldX(b.u);
        const wz = toWorldZ(b.v);
        if (wx >= GEOFENCE.xmin + 1.0 && wx <= GEOFENCE.xmax - 1.0 &&
            wz >= GEOFENCE.zmin + 1.0 && wz <= GEOFENCE.zmax - 1.0 && b.h >= 5.0) {
            validIndices.push(idx);
        }
    });

    const pickA = Math.floor(rng() * validIndices.length);
    let pickB = Math.floor(rng() * (validIndices.length - 1));
    if (pickB >= pickA) pickB += 1;

    const startIdx = validIndices[pickA];
    const goalIdx = validIndices[pickB];

    const startMat = new THREE.MeshLambertMaterial({ color: 0x10b981 });
    const goalMat = new THREE.MeshLambertMaterial({ color: 0xf59e0b });

    rawBuildingDescriptors.forEach((b, idx) => {
        const wx = toWorldX(b.u);
        const wz = toWorldZ(b.v);
        const ww = b.w * SCALE_FACTOR;
        const wd = b.d * SCALE_FACTOR;
        const wh = b.h;

        const isStart = (idx === startIdx);
        const isGoal = (idx === goalIdx);

        let materials;
        if (isStart) {
            materials = [startMat, startMat, startMat, startMat, startMat, startMat];
        } else if (isGoal) {
            materials = [goalMat, goalMat, goalMat, goalMat, goalMat, goalMat];
        } else {
            const wallKey = FACADE_KEYS[idx % FACADE_KEYS.length];
            const wallM = facadeMaterials[wallKey] || facadeMaterials.oldWarmTile;
            const roofM = roofMaterials.concrete;
            materials = [wallM, wallM, roofM, roofM, wallM, wallM];
        }

        const mesh = new THREE.Mesh(new THREE.BoxGeometry(ww, wh, wd), materials);
        mesh.position.set(wx, wh / 2, wz);
        mesh.rotation.y = b.rotRad || 0;
        cityGroup.add(mesh);

        // 屋頂鐵皮加蓋與水塔 (一般大樓保留特色)
        if (!isStart && !isGoal && wh >= 7.0 && wh <= 18.0 && (idx % 3 === 0)) {
            const tinM = roofMaterials[ROOF_TIN_KEYS[idx % ROOF_TIN_KEYS.length]];
            const addonMesh = new THREE.Mesh(new THREE.BoxGeometry(ww * 0.75, 1.2, wd * 0.75), tinM);
            addonMesh.position.set(wx, wh + 0.6, wz);
            addonMesh.rotation.y = b.rotRad || 0;
            cityGroup.add(addonMesh);

            const tankM = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.8 });
            const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.8, 8), tankM);
            tank.position.set(wx + (ww * 0.2), wh + 0.4, wz);
            cityGroup.add(tank);
        }

        // 登錄物理碰撞清單 (AABB 包圍盒)
        const halfSpan = Math.max(ww, wd) * 0.65;
        buildings.push({
            xmin: wx - halfSpan,
            xmax: wx + halfSpan,
            zmin: wz - halfSpan,
            zmax: wz + halfSpan,
            height: wh,
            mesh: mesh,
            cx: wx,
            cz: wz,
            isStart: isStart,
            isGoal: isGoal
        });
    });

    const startB = buildings[startIdx];
    const goalB = buildings[goalIdx];

    START_POS = [startB.cx, startB.height + droneRadius + 0.05, startB.cz];
    createHelipad(startB.cx, startB.height, startB.cz, 0x10b981);

    GOAL_POS = [goalB.cx, goalB.height + droneRadius + 0.05, goalB.cz];
    createHelipad(goalB.cx, goalB.height, goalB.cz, 0xf59e0b);

    BASE_TOTAL_DIST = Math.hypot(GOAL_POS[0] - START_POS[0], GOAL_POS[1] - START_POS[1], GOAL_POS[2] - START_POS[2]);

    console.log(`[種子 ${seedValue}] 台北士林特色街廓部署完畢：共 ${buildings.length} 棟建物`);
    return { mapWidth: MAP_WIDTH, mapDepth: MAP_DEPTH };
}
