// =========================================================================
// city.js - 明亮現代都市建築、12種風格隨機外觀貼皮與起訖點配置 (修正起訖點沉地)
// =========================================================================

let cityGroup = new THREE.Group();
let buildings = [];
let START_POS = [10, 8.25, 10];
let GOAL_POS = [85, 16.25, 40];
let BASE_TOTAL_DIST = 100.0;
let GEOFENCE = { xmin: 5.0, xmax: 95.0, zmin: 5.0, zmax: 55.0, ymax: 25.0 };
let cachedRawGeoJSON = null;
let groundPlaneMesh = null;
let fenceLineSegments = null;

let currentBaseW = 100.0;
let currentBaseD = 60.33;

const calibData = { scale: 0.995, scaleZ: 1.020, offsetX: -1.20, offsetZ: -3.90 };

// 1. 12 種現代都市建築風格色彩庫
const BUILDING_STYLES = [
    { wall: '#f1f5f9', line: '#cbd5e1', glass: '#1e293b', frame: '#475569', roof: 0x824438 },
    { wall: '#f5efe6', line: '#dcd2c4', glass: '#292524', frame: '#57534e', roof: 0x6c4a38 },
    { wall: '#e2e8f0', line: '#94a3b8', glass: '#0f172a', frame: '#334155', roof: 0x334155 },
    { wall: '#e0e7e9', line: '#b4c5c7', glass: '#162b32', frame: '#3b555e', roof: 0x384a52 },
    { wall: '#cbd5e1', line: '#64748b', glass: '#090d16', frame: '#1e293b', roof: 0x1e293b },
    { wall: '#faebe3', line: '#e8cbbe', glass: '#272021', frame: '#5c4d4f', roof: 0x994d3f },
    { wall: '#d8dee9', line: '#aeb9cc', glass: '#1a202c', frame: '#4a5568', roof: 0x3d6b52 },
    { wall: '#f8fafc', line: '#94a3b8', glass: '#0369a1', frame: '#0284c7', roof: 0x475569 },
    { wall: '#fef3c7', line: '#fde68a', glass: '#1c1917', frame: '#78350f', roof: 0x854d0e },
    { wall: '#e7e5e4', line: '#c7c2be', glass: '#292524', frame: '#44403c', roof: 0x573d32 },
    { wall: '#e0f2fe', line: '#7dd3fc', glass: '#082f49', frame: '#0369a1', roof: 0x1e293b },
    { wall: '#ecefe6', line: '#c6cdc0', glass: '#1b241e', frame: '#3f4f44', roof: 0x6e473b }
];

function generateStyleTexture(cfg) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = cfg.wall;
    ctx.fillRect(0, 0, 256, 256);

    ctx.strokeStyle = cfg.line;
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, 256, 256);

    const rows = 4, cols = 4;
    const cellW = 256 / cols;
    const cellH = 256 / rows;

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const x = c * cellW + 10;
            const y = r * cellH + 12;
            const w = cellW - 20;
            const h = cellH - 24;

            ctx.fillStyle = cfg.frame;
            ctx.fillRect(x, y, w, h);

            ctx.fillStyle = cfg.glass;
            ctx.fillRect(x + 2, y + 2, w - 4, h - 4);

            ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
            ctx.beginPath();
            ctx.moveTo(x + 2, y + 2);
            ctx.lineTo(x + w * 0.65, y + 2);
            ctx.lineTo(x + 2, y + h * 0.65);
            ctx.closePath();
            ctx.fill();

            ctx.fillStyle = 'rgba(0,0,0,0.18)';
            ctx.fillRect(x - 1, y + h, w + 2, 3);
        }
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    return tex;
}

const PRECOMPILED_STYLES = BUILDING_STYLES.map(cfg => {
    return {
        roofMat: new THREE.MeshLambertMaterial({ color: cfg.roof }),
        sideMat: new THREE.MeshLambertMaterial({ map: generateStyleTexture(cfg), color: 0xffffff })
    };
});

// 2. 世界座標 UV 展開
function applyWorldSpaceUV(geometry) {
    const pos = geometry.attributes.position;
    const uvs = [];
    const scaleFactor = 3.5;

    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);
        uvs.push((x + z) / scaleFactor, y / scaleFactor);
    }

    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.attributes.uv.needsUpdate = true;
}

// 3. 鋪設士林衛星底圖
function updateGroundMap(scene, mapWidth, mapDepth) {
    currentBaseW = mapWidth;
    currentBaseD = mapDepth;

    if (groundPlaneMesh) {
        scene.remove(groundPlaneMesh);
        if (groundPlaneMesh.geometry) groundPlaneMesh.geometry.dispose();
        groundPlaneMesh = null;
    }

    const textureLoader = new THREE.TextureLoader();
    textureLoader.load(
        'map_shilin.png',
        (tex) => {
            tex.wrapS = THREE.ClampToEdgeWrapping;
            tex.wrapT = THREE.ClampToEdgeWrapping;

            const planeGeo = new THREE.PlaneGeometry(mapWidth, mapDepth);
            const planeMat = new THREE.MeshLambertMaterial({ map: tex, side: THREE.FrontSide });

            groundPlaneMesh = new THREE.Mesh(planeGeo, planeMat);
            groundPlaneMesh.rotation.x = -Math.PI / 2;

            const sx = calibData.scale;
            const sz = calibData.scale * (calibData.scaleZ || 1.0);
            groundPlaneMesh.scale.set(sx, sz, 1.0);

            const cx = (currentBaseW / 2) + calibData.offsetX;
            const cz = (currentBaseD / 2) + calibData.offsetZ;
            groundPlaneMesh.position.set(cx, -0.01, cz);

            scene.add(groundPlaneMesh);
        },
        undefined,
        () => {
            const planeGeo = new THREE.PlaneGeometry(mapWidth, mapDepth);
            const planeMat = new THREE.MeshLambertMaterial({ color: 0xd8dde4 });
            groundPlaneMesh = new THREE.Mesh(planeGeo, planeMat);
            groundPlaneMesh.rotation.x = -Math.PI / 2;
            groundPlaneMesh.position.set(mapWidth / 2, -0.02, mapDepth / 2);
            scene.add(groundPlaneMesh);
        }
    );
}

// 4. 緊縮型電子圍欄線框
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

// 5. 停機坪
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

// 6. 萬種種子雜湊生成器 (0000~9999)
function createSeededRandom(seedInt) {
    let s = Math.abs(seedInt) % 10000;
    s = ((s ^ 0x6D2B79F5) * 0x85EBCA6B) >>> 0;
    s = ((s ^ (s >>> 13)) * 0xC2B2AE35) >>> 0;
    let state = (s ^ (s >>> 16)) >>> 0;
    return function() {
        state = (state + 0x9E3779B9) >>> 0;
        let z = state;
        z = ((z ^ (z >>> 16)) * 0x85EBCA6B) >>> 0;
        z = ((z ^ (z >>> 13)) * 0xC2B2AE35) >>> 0;
        return ((z ^ (z >>> 16)) >>> 0) / 4294967296;
    };
}

// 7. 載入並建構士林 3D 現代明亮建築群 (徹底防止起訖點壓地)
async function loadRealCityBuildings(scene, seedValue, droneRadius) {
    while (cityGroup.children.length > 0) {
        cityGroup.remove(cityGroup.children[0]);
    }
    buildings = [];

    const rng = createSeededRandom(seedValue);

    if (!cachedRawGeoJSON) {
        try {
            const resp = await fetch('shilin.geojson');
            if (resp.ok) cachedRawGeoJSON = await resp.json();
        } catch (e) {
            cachedRawGeoJSON = null;
        }
    }

    if (!cachedRawGeoJSON || !cachedRawGeoJSON.features) return null;

    const features = cachedRawGeoJSON.features;
    let minLon = Infinity, maxLon = -Infinity;
    let minLat = Infinity, maxLat = -Infinity;

    features.forEach(f => {
        if (!f.geometry || !f.geometry.coordinates) return;
        const coords = f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : 
                       (f.geometry.coordinates[0] ? f.geometry.coordinates[0][0] : null);
        if (!coords) return;
        coords.forEach(([lon, lat]) => {
            minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
            minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
        });
    });

    const centerLat = (minLat + maxLat) / 2;
    const mPerDegLat = 110800;
    const mPerDegLon = 111320 * Math.cos(centerLat * Math.PI / 180);

    const realWidthMeters = (maxLon - minLon) * mPerDegLon;
    const realDepthMeters = (maxLat - minLat) * mPerDegLat;
    const aspectRatio = realWidthMeters / realDepthMeters;

    const MAP_WIDTH = 100.0;
    const MAP_DEPTH = MAP_WIDTH / aspectRatio;

    const tempBuildings = [];
    features.forEach((f, idx) => {
        if (!f.geometry || !f.geometry.coordinates) return;
        const coords = f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : 
                       (f.geometry.coordinates[0] ? f.geometry.coordinates[0][0] : null);
        if (!coords || coords.length < 3) return;

        const shape = new THREE.Shape();
        let bMinX = Infinity, bMaxX = -Infinity;
        let bMinZ = Infinity, bMaxZ = -Infinity;

        coords.forEach(([lon, lat], i) => {
            const x = ((lon - minLon) / (maxLon - minLon)) * MAP_WIDTH;
            const z = ((maxLat - lat) / (maxLat - minLat)) * MAP_DEPTH;
            bMinX = Math.min(bMinX, x); bMaxX = Math.max(bMaxX, x);
            bMinZ = Math.min(bMinZ, z); bMaxZ = Math.max(bMaxZ, z);
            if (i === 0) shape.moveTo(x, z); else shape.lineTo(x, z);
        });

        // 確保每棟建築物都有足夠高度（最低 5.5 米）
        let rawH = parseFloat(f.properties?.height || (f.properties?.['building:levels'] ? f.properties['building:levels'] * 3.2 : null));
        let bh = rawH ? Math.min(23.0, Math.max(5.5, rawH * 0.45)) : (6.5 + ((idx * 7) % 15));

        tempBuildings.push({
            shape, bh, bMinX, bMaxX, bMinZ, bMaxZ,
            cx: (bMinX + bMaxX) / 2, cz: (bMinZ + bMaxZ) / 2,
            width: bMaxX - bMinX, depth: bMaxZ - bMinZ
        });
    });

    const INSET = 5.0;
    GEOFENCE = { xmin: INSET, xmax: MAP_WIDTH - INSET, zmin: INSET, zmax: MAP_DEPTH - INSET, ymax: 25.0 };

    updateFenceVisual(scene, GEOFENCE);
    updateGroundMap(scene, MAP_WIDTH, MAP_DEPTH);

    // ★ 關鍵修復：嚴格限定只有「真實有高度（bh >= 5.0）且在圍欄內」的建築物才進入候選池
    let validIndices = [];
    tempBuildings.forEach((b, i) => {
        if (b.bh >= 5.0 &&
            b.cx >= GEOFENCE.xmin + 0.5 && b.cx <= GEOFENCE.xmax - 0.5 &&
            b.cz >= GEOFENCE.zmin + 0.5 && b.cz <= GEOFENCE.zmax - 0.5) {
            validIndices.push(i);
        }
    });

    if (validIndices.length < 2) {
        validIndices = tempBuildings.map((_, i) => i);
    }

    const pickA = Math.floor(rng() * validIndices.length);
    let pickB = Math.floor(rng() * (validIndices.length - 1));
    if (pickB >= pickA) pickB += 1;

    const startIdx = validIndices[pickA];
    const goalIdx = validIndices[pickB];

    const startMat = new THREE.MeshLambertMaterial({ color: 0x10b981 });
    const goalMat = new THREE.MeshLambertMaterial({ color: 0xf59e0b });

    tempBuildings.forEach((bData, idx) => {
        const extrudeSettings = { depth: bData.bh, bevelEnabled: false };
        const geom = new THREE.ExtrudeGeometry(bData.shape, extrudeSettings);
        geom.rotateX(Math.PI / 2);

        applyWorldSpaceUV(geom);

        const isStart = (idx === startIdx);
        const isGoal = (idx === goalIdx);

        let materials;
        let edgeColor = '#94a3b8';
        let edgeOpacity = 0.3;

        if (isStart) {
            // ★ 起點大樓整棟翡翠綠
            materials = [startMat, startMat];
            edgeColor = '#ffffff';
            edgeOpacity = 0.9;
        } else if (isGoal) {
            // ★ 終點大樓整棟流金黃 (整棟實體大樓浮現，絕不沉入地底)
            materials = [goalMat, goalMat];
            edgeColor = '#ffffff';
            edgeOpacity = 0.9;
        } else {
            const styleIdx = Math.floor((Math.abs(Math.sin(idx * 12.9898 + bData.cx * 78.233)) * PRECOMPILED_STYLES.length)) % PRECOMPILED_STYLES.length;
            const chosen = PRECOMPILED_STYLES[styleIdx];
            materials = [chosen.roofMat.clone(), chosen.sideMat.clone()];
        }

        const mesh = new THREE.Mesh(geom, materials);
        // 重要：Y 軸抬升大樓高度，讓頂部與停機坪齊平
        mesh.position.y = bData.bh;
        cityGroup.add(mesh);

        const edges = new THREE.LineSegments(
            new THREE.EdgesGeometry(geom),
            new THREE.LineBasicMaterial({ color: new THREE.Color(edgeColor), transparent: true, opacity: edgeOpacity })
        );
        mesh.add(edges);

        buildings.push({
            xmin: bData.bMinX, xmax: bData.bMaxX,
            zmin: bData.bMinZ, zmax: bData.bMaxZ,
            height: bData.bh, mesh: mesh,
            cx: bData.cx, cz: bData.cz,
            width: bData.width, depth: bData.depth,
            isStart, isGoal
        });
    });

    const startB = buildings[startIdx];
    const goalB = buildings[goalIdx];

    // 起點停機坪置於綠色大樓頂部
    START_POS = [startB.cx, startB.height + droneRadius + 0.05, startB.cz];
    createHelipad(startB.cx, startB.height, startB.cz, 0x10b981);

    // 終點停機坪置於金色大樓頂部（必定大於 5m 高度，不再被地圖吞掉）
    GOAL_POS = [goalB.cx, goalB.height + droneRadius + 0.05, goalB.cz];
    createHelipad(goalB.cx, goalB.height, goalB.cz, 0xf59e0b);

    BASE_TOTAL_DIST = Math.hypot(GOAL_POS[0] - START_POS[0], GOAL_POS[1] - START_POS[1], GOAL_POS[2] - START_POS[2]);
    return { mapWidth: MAP_WIDTH, mapDepth: MAP_DEPTH };
}
