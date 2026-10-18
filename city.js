// =========================================================================
// city.js - 都市地圖、建築幾何、程序化貼皮與起訖點配置
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

// 1. 動態生成科技窗格外牆貼圖 (全場共用，零外部圖片負擔)
function createBuildingTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#181e28';
    ctx.fillRect(0, 0, 128, 128);

    const rows = 8, cols = 8;
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const rand = Math.random();
            if (rand > 0.45) {
                ctx.fillStyle = rand > 0.88 ? '#00d2ff' : '#3d526e';
            } else {
                ctx.fillStyle = '#10141c';
            }
            ctx.fillRect(c * 16 + 3, r * 16 + 3, 10, 10);
        }
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    return tex;
}
const buildingTexture = createBuildingTexture();

// 2. 鋪設士林衛星底圖
function updateGroundMap(scene, mapWidth, mapDepth) {
    currentBaseW = mapWidth;
    currentBaseD = mapDepth;

    if (groundPlaneMesh) {
        scene.remove(groundPlaneMesh);
        if (groundPlaneMesh.geometry) groundPlaneMesh.geometry.dispose();
        groundPlaneMesh = null;
    }

    const textureLoader = new THREE.TextureLoader();
    textureLoader.load('map_shilin.png', (tex) => {
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;

        const planeGeo = new THREE.PlaneGeometry(mapWidth, mapDepth);
        const planeMat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.FrontSide, depthWrite: true });

        groundPlaneMesh = new THREE.Mesh(planeGeo, planeMat);
        groundPlaneMesh.rotation.x = -Math.PI / 2;

        const sx = calibData.scale;
        const sz = calibData.scale * (calibData.scaleZ || 1.0);
        groundPlaneMesh.scale.set(sx, sz, 1.0);

        const cx = (currentBaseW / 2) + calibData.offsetX;
        const cz = (currentBaseD / 2) + calibData.offsetZ;
        groundPlaneMesh.position.set(cx, -0.01, cz);

        scene.add(groundPlaneMesh);
    });
}

// 3. 緊縮型電子圍欄線框
function updateFenceVisual(scene, bounds) {
    if (fenceLineSegments) scene.remove(fenceLineSegments);
    const bw = bounds.xmax - bounds.xmin;
    const bd = bounds.zmax - bounds.zmin;
    const bh = bounds.ymax;

    const fenceGeo = new THREE.BoxGeometry(bw, bh, bd);
    const fenceWire = new THREE.WireframeGeometry(fenceGeo);
    fenceLineSegments = new THREE.LineSegments(
        fenceWire,
        new THREE.LineBasicMaterial({ color: 0x00d2ff, transparent: true, opacity: 0.45 })
    );
    fenceLineSegments.position.set((bounds.xmin + bounds.xmax) / 2, bh / 2, (bounds.zmin + bounds.zmax) / 2);
    scene.add(fenceLineSegments);
}

// 4. 停機坪
function createHelipad(x, y, z, colorHex) {
    const padGroup = new THREE.Group();
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.06, 16), new THREE.MeshBasicMaterial({ color: colorHex }));
    pad.position.set(x, y + 0.03, z);
    padGroup.add(pad);

    const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1.0, 20), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, y + 0.04, z);
    padGroup.add(ring);

    cityGroup.add(padGroup);
    return padGroup;
}

// 5. 萬種種子雜湊生成器 (0000~9999)
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

// 6. 載入並建構士林 3D 建築群 (帶外牆貼皮與高亮起訖樓)
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
    if (!cachedRawGeoJSON || !cachedRawGeoJSON.features) return;

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
    const MAP_WIDTH = 100.0;
    const MAP_DEPTH = MAP_WIDTH / ((maxLon - minLon) * mPerDegLon / ((maxLat - minLat) * mPerDegLat));

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

        let rawH = parseFloat(f.properties?.height || (f.properties?.['building:levels'] ? f.properties['building:levels'] * 3.2 : null));
        let bh = rawH ? Math.min(23.0, Math.max(5.5, rawH * 0.45)) : (7.0 + ((idx * 7) % 14));

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

    // 任一建物皆可當起訖點
    let validIndices = [];
    tempBuildings.forEach((b, i) => {
        if (b.cx >= GEOFENCE.xmin + 0.5 && b.cx <= GEOFENCE.xmax - 0.5 &&
            b.cz >= GEOFENCE.zmin + 0.5 && b.cz <= GEOFENCE.zmax - 0.5) {
            validIndices.push(i);
        }
    });
    if (validIndices.length < 2) validIndices = tempBuildings.map((_, i) => i);

    const pickA = Math.floor(rng() * validIndices.length);
    let pickB = Math.floor(rng() * (validIndices.length - 1));
    if (pickB >= pickA) pickB += 1;

    const startIdx = validIndices[pickA];
    const goalIdx = validIndices[pickB];

    // 生成實體幾何並上色 (頂底單色 + 側面科技窗格貼皮)
    tempBuildings.forEach((bData, idx) => {
        const extrudeSettings = { depth: bData.bh, bevelEnabled: false };
        const geom = new THREE.ExtrudeGeometry(bData.shape, extrudeSettings);
        geom.rotateX(Math.PI / 2);

        const isStart = (idx === startIdx);
        const isGoal = (idx === goalIdx);

        let materials;
        let edgeColor = 0x00d2ff;

        if (isStart) {
            // ★ 整棟綠色起點樓
            const matG = new THREE.MeshLambertMaterial({ color: 0x00ff88 });
            materials = [matG, matG];
            edgeColor = 0xffffff;
        } else if (isGoal) {
            // ★ 整棟金色終點樓
            const matY = new THREE.MeshLambertMaterial({ color: 0xffd700 });
            materials = [matY, matY];
            edgeColor = 0xffffff;
        } else {
            // ★ 一般建築：頂面深色 + 外牆科技窗格貼皮
            const roofMat = new THREE.MeshLambertMaterial({ color: 0x1a212b });
            const sideMat = new THREE.MeshLambertMaterial({ map: buildingTexture, color: 0xffffff });
            materials = [roofMat, sideMat];
        }

        const mesh = new THREE.Mesh(geom, materials);
        mesh.position.y = bData.bh;
        cityGroup.add(mesh);

        const edges = new THREE.LineSegments(
            new THREE.EdgesGeometry(geom),
            new THREE.LineBasicMaterial({ color: edgeColor, transparent: true, opacity: isStart || isGoal ? 0.9 : 0.4 })
        );
        mesh.add(edges);

        buildings.push({
            xmin: bData.bMinX, xmax: bData.bMaxX,
            zmin: bData.bMinZ, zmax: bData.bMaxZ,
            height: bData.bh, mesh: mesh,
            cx: bData.cx, cz: bData.cz,
            isStart, isGoal
        });
    });

    const startB = buildings[startIdx];
    const goalB = buildings[goalIdx];

    START_POS = [startB.cx, startB.height + droneRadius + 0.05, startB.cz];
    createHelipad(startB.cx, startB.height, startB.cz, 0x00ff88);

    GOAL_POS = [goalB.cx, goalB.height + droneRadius + 0.05, goalB.cz];
    createHelipad(goalB.cx, goalB.height, goalB.cz, 0xffd700);

    BASE_TOTAL_DIST = Math.hypot(GOAL_POS[0] - START_POS[0], GOAL_POS[1] - START_POS[1], GOAL_POS[2] - START_POS[2]);
    return { mapWidth: MAP_WIDTH, mapDepth: MAP_DEPTH };
}
