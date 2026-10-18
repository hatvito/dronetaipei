// =========================================================================
// city.js - 都市地圖、高級極簡建築幾何、緊縮電子圍欄與起訖點配置
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

// ★ 實測鎖定之士林最佳精準校準數據
const calibData = { scale: 0.995, scaleZ: 1.020, offsetX: -1.20, offsetZ: -3.90 };

// 1. 鋪設士林衛星底圖 (鎖定最佳對齊參數)
function updateGroundMap(scene, mapWidth, mapDepth) {
    currentBaseW = mapWidth;
    currentBaseD = mapDepth;

    if (groundPlaneMesh) {
        scene.remove(groundPlaneMesh);
        if (groundPlaneMesh.geometry) groundPlaneMesh.geometry.dispose();
        if (groundPlaneMesh.material) {
            if (groundPlaneMesh.material.map) groundPlaneMesh.material.map.dispose();
            groundPlaneMesh.material.dispose();
        }
        groundPlaneMesh = null;
    }

    const textureLoader = new THREE.TextureLoader();
    textureLoader.load(
        'map_shilin.png',
        (tex) => {
            tex.wrapS = THREE.ClampToEdgeWrapping;
            tex.wrapT = THREE.ClampToEdgeWrapping;

            const planeGeo = new THREE.PlaneGeometry(mapWidth, mapDepth);
            const planeMat = new THREE.MeshBasicMaterial({
                map: tex,
                side: THREE.FrontSide,
                depthWrite: true
            });

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
            console.warn("未找到 map_shilin.png，切換為深色網格地板。");
            const planeGeo = new THREE.PlaneGeometry(mapWidth, mapDepth);
            const planeMat = new THREE.MeshLambertMaterial({ color: 0x141820 });
            groundPlaneMesh = new THREE.Mesh(planeGeo, planeMat);
            groundPlaneMesh.rotation.x = -Math.PI / 2;
            groundPlaneMesh.position.set(mapWidth / 2, -0.02, mapDepth / 2);
            scene.add(groundPlaneMesh);
        }
    );
}

// 2. 緊縮型電子圍欄線框
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

// 3. 精巧型停機坪
function createHelipad(x, y, z, colorHex) {
    const padGroup = new THREE.Group();
    const pad = new THREE.Mesh(
        new THREE.CylinderGeometry(0.75, 0.75, 0.06, 16),
        new THREE.MeshBasicMaterial({ color: colorHex })
    );
    pad.position.set(x, y + 0.03, z);
    padGroup.add(pad);

    const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.85, 1.0, 20),
        new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, y + 0.04, z);
    padGroup.add(ring);

    cityGroup.add(padGroup);
    return padGroup;
}

// 4. 萬種種子雜湊生成器 (0000~9999 高離散度)
function createSeededRandom(seedInt) {
    let s = Math.abs(seedInt) % 10000;
    // 32-bit Murmur3 變體雜湊
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

// 5. 載入並建構士林 3D 建築群 (高質感極簡石墨風格)
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

    if (!cachedRawGeoJSON || !cachedRawGeoJSON.features || cachedRawGeoJSON.features.length === 0) {
        console.error("無法載入 shilin.geojson！");
        return null;
    }

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

        let rawH = parseFloat(f.properties?.height || (f.properties?.['building:levels'] ? f.properties['building:levels'] * 3.2 : null));
        let bh = rawH ? Math.min(23.0, Math.max(5.5, rawH * 0.45)) : (7.0 + ((idx * 7) % 14));

        tempBuildings.push({
            shape, bh, bMinX, bMaxX, bMinZ, bMaxZ,
            cx: (bMinX + bMaxX) / 2, cz: (bMinZ + bMaxZ) / 2,
            width: bMaxX - bMinX, depth: bMaxZ - bMinZ
        });
    });

    // 內縮 5.0 公尺的緊縮空域
    const INSET = 5.0;
    GEOFENCE = {
        xmin: INSET,
        xmax: MAP_WIDTH - INSET,
        zmin: INSET,
        zmax: MAP_DEPTH - INSET,
        ymax: 25.0
    };

    updateFenceVisual(scene, GEOFENCE);
    updateGroundMap(scene, MAP_WIDTH, MAP_DEPTH);

    // ★ 全地圖建物皆可作為候選，不限面積與跨距
    let validIndices = [];
    tempBuildings.forEach((b, i) => {
        if (b.cx >= GEOFENCE.xmin + 0.5 && b.cx <= GEOFENCE.xmax - 0.5 &&
            b.cz >= GEOFENCE.zmin + 0.5 && b.cz <= GEOFENCE.zmax - 0.5) {
            validIndices.push(i);
        }
    });
    if (validIndices.length < 2) validIndices = tempBuildings.map((_, i) => i);

    // 隨機選出兩棟不同的建築物
    const pickA = Math.floor(rng() * validIndices.length);
    let pickB = Math.floor(rng() * (validIndices.length - 1));
    if (pickB >= pickA) pickB += 1;

    const startIdx = validIndices[pickA];
    const goalIdx = validIndices[pickB];

    // 生成實體幾何
    tempBuildings.forEach((bData, idx) => {
        const extrudeSettings = { depth: bData.bh, bevelEnabled: false };
        const geom = new THREE.ExtrudeGeometry(bData.shape, extrudeSettings);
        geom.rotateX(Math.PI / 2);

        const isStart = (idx === startIdx);
        const isGoal = (idx === goalIdx);

        let mat;
        let edgeColor = 0x00d2ff;
        let edgeOpacity = 0.45;

        if (isStart) {
            // ★ 起點大樓整棟翡翠綠
            mat = new THREE.MeshLambertMaterial({ color: 0x00ff88 });
            edgeColor = 0xffffff;
            edgeOpacity = 0.9;
        } else if (isGoal) {
            // ★ 終點大樓整棟流金黃
            mat = new THREE.MeshLambertMaterial({ color: 0xffd700 });
            edgeColor = 0xffffff;
            edgeOpacity = 0.9;
        } else {
            // ★ 一般建築：深邃高級石墨灰藍
            mat = new THREE.MeshLambertMaterial({ color: 0x1e2430 });
        }

        const mesh = new THREE.Mesh(geom, mat);
        mesh.position.y = bData.bh;
        cityGroup.add(mesh);

        // 簡約科技感俐落線框
        const edges = new THREE.LineSegments(
            new THREE.EdgesGeometry(geom),
            new THREE.LineBasicMaterial({ color: edgeColor, transparent: true, opacity: edgeOpacity })
        );
        mesh.add(edges);

        buildings.push({
            xmin: bData.bMinX, xmax: bData.bMaxX,
            zmin: bData.bMinZ, zmax: bData.bMaxZ,
            height: bData.bh,
            mesh: mesh,
            cx: bData.cx,
            cz: bData.cz,
            width: bData.width,
            depth: bData.depth,
            isStart: isStart,
            isGoal: isGoal
        });
    });

    const startB = buildings[startIdx];
    const goalB = buildings[goalIdx];

    START_POS = [startB.cx, startB.height + droneRadius + 0.05, startB.cz];
    createHelipad(startB.cx, startB.height, startB.cz, 0x00ff88);

    GOAL_POS = [goalB.cx, goalB.height + droneRadius + 0.05, goalB.cz];
    createHelipad(goalB.cx, goalB.height, goalB.cz, 0xffd700);

    BASE_TOTAL_DIST = Math.hypot(GOAL_POS[0] - START_POS[0], GOAL_POS[1] - START_POS[1], GOAL_POS[2] - START_POS[2]);

    const formattedSeed = String(seedValue).padStart(4, '0');
    console.log(`種子 [${formattedSeed}] 起訖大樓已就位：`);
    console.log(`- 起點大樓 (整棟綠色): (${START_POS.map(v => v.toFixed(1)).join(', ')}), 高度 ${startB.height.toFixed(1)}m`);
    console.log(`- 終點大樓 (整棟黃色): (${GOAL_POS.map(v => v.toFixed(1)).join(', ')}), 高度 ${goalB.height.toFixed(1)}m`);
    console.log(`- 航程直線跨距: ${BASE_TOTAL_DIST.toFixed(1)}m`);

    return { mapWidth: MAP_WIDTH, mapDepth: MAP_DEPTH };
}
