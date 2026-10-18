import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { AnalysisEvent, FireFeature, Hotspot, Incident, Progression, VideoSource } from '../api/types';
import { type GeoFrame, makeFrame, toLonLat, toXZ } from './geo';
import { ESRI_IMAGERY, TERRARIUM, cropToBBox, decodeTerrarium, imageMosaic, loadMosaic } from './tiles';
import { dropsUntil, firelinesUntil, frontAt, unitState, unitsFor, type SimCtx, type SimUnit } from '../sim/ops';

type BBox = [number, number, number, number];
type Ring = [number, number][];

export interface HoverInfo {
  x: number; y: number; lon: number; lat: number; elevation: number; slope: number; aspect: number; inBurned: boolean; inPerimeter: boolean;
  /** regional incidents: when this place burned (ms, null = it did not) and its burn-severity class (1–5, 0 = none) */
  arrival?: number | null; severity?: number;
}
export interface CameraInfo { azimuth: number; zoom: number; metersPerPx: number; polar: number }
export interface SceneLayers {
  terrain: boolean; imagery: number; burned: number; active: number; change: number; hotspots: boolean;
  groundTruth: boolean; perimeter: boolean; footprint: boolean; path: boolean; projection: boolean; trees: boolean; smoke: boolean;
  /** regional incidents: burn-severity tint (opacity), daily isochrones, dated EMS perimeters */
  severity: number; isochrones: boolean; ems: boolean;
}
export interface SceneCallbacks {
  onHover?: (h: HoverInfo | null) => void;
  onCamera?: (c: CameraInfo) => void;
  onEventClick?: (id: string) => void;
  onDroneClick?: (id: string) => void;
  onUnitClick?: (id: string) => void;
  onFollowEnd?: () => void;
  onScenario?: (s: { on: boolean; hours: number; ha: number; lapse: number }) => void;
  onReady?: () => void;
  onProgress?: (msg: string) => void;
}

const DEFAULT_LAYERS: SceneLayers = { terrain: true, imagery: 0.18, burned: 0.95, active: 1, change: 0.6, hotspots: true, groundTruth: false, perimeter: true, footprint: true, path: true, projection: false, trees: true, smoke: true, severity: 0, isochrones: false, ems: true };

const NOISE_GLSL = /* glsl */ `
float fsHash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float fsNoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(fsHash(i), fsHash(i+vec2(1,0)), f.x), mix(fsHash(i+vec2(0,1)), fsHash(i+vec2(1,1)), f.x), f.y); }
float fsFbm(vec2 p){ float a=.5, s=0.; for(int i=0;i<4;i++){ s+=a*fsNoise(p); p*=2.03; a*=.5; } return s; }
vec2 fsBoundsUv(vec2 xz, vec4 b){ vec2 uv = (xz - b.xy)/(b.zw - b.xy); return vec2(uv.x, 1.0-uv.y); }
float fsInside(vec2 uv){ return step(0.,uv.x)*step(uv.x,1.)*step(0.,uv.y)*step(uv.y,1.); }
`;

export class FireScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private clock = new THREE.Clock();
  private raf = 0;
  private container: HTMLElement;
  private labelRoot: HTMLDivElement;
  private cb: SceneCallbacks;

  frame!: GeoFrame;
  private innerBBox!: BBox;
  private h0 = 0;
  exaggeration = 1.8;
  private gridN = 448;
  private rawHeights!: Float32Array; // inner grid, metres
  private innerMesh?: THREE.Mesh;
  private outerSampler?: (lon: number, lat: number) => number;
  private ringSamplers: { bbox: BBox; sample: (lon: number, lat: number) => number }[] = [];
  private rings: THREE.Mesh[] = [];
  private sun!: THREE.DirectionalLight;

  // overlays
  private maskCanvas = document.createElement('canvas');
  private maskTex: THREE.CanvasTexture;
  private decalCanvas = document.createElement('canvas');
  private decalTex: THREE.CanvasTexture;
  private maskBounds = new THREE.Vector4();
  private decalBounds = new THREE.Vector4();
  private uniforms = {
    uMask: { value: null as THREE.Texture | null }, uDecal: { value: null as THREE.Texture | null },
    uMaskBounds: { value: new THREE.Vector4() }, uDecalBounds: { value: new THREE.Vector4() },
    uTime: { value: 0 }, uBurnOp: { value: 1 }, uFireOp: { value: 1 }, uChangeOp: { value: 0.6 },
    uImageryMix: { value: 0.18 }, uMapStyle: { value: 0 }, uStyleOn: { value: 1 },
    uScen: { value: null as THREE.Texture | null }, uScenBounds: { value: new THREE.Vector4() }, uScenT: { value: 0 }, uScenOn: { value: 0 },
    // regional incidents: reconstructed arrival time (hours after progression.t0) and burn severity
    uArr: { value: null as THREE.Texture | null }, uSev: { value: null as THREE.Texture | null }, uArrBounds: { value: new THREE.Vector4() },
    uArrT: { value: -1 }, uArrOn: { value: 0 }, uArrBefore: { value: -1 }, uSevOp: { value: 0 }, uIsoOp: { value: 0 }, uFrontH: { value: 3 },
    uSim: { value: null as THREE.Texture | null }, uSimOn: { value: 0 },   // retrospective scenario (same grid as uArr)
  };

  // dynamic content
  private flames?: THREE.Points;
  private smoke?: THREE.Points;
  private trees?: THREE.InstancedMesh;
  private drone?: THREE.Group;
  private rotors: THREE.Object3D[] = [];
  private frustum?: THREE.LineSegments;
  private labels = new Map<string, { el: HTMLElement; pos: THREE.Vector3; minZoom?: number }>();
  // simulated operations (clearly labelled in UI)
  private simCtx?: SimCtx;
  private units = new Map<string, { u: SimUnit; obj: THREE.Group }>();
  private opsMode: 'incident' | 'drones' | 'resources' = 'incident';
  private selectedUnit: string | null = null;
  private follow: { id: string; mode: 'chase' | 'overview' | 'ride' } | null = null;
  private viewRT?: THREE.WebGLRenderTarget;
  private viewCam = new THREE.PerspectiveCamera(52, 16 / 9, 0.5, 60000);
  // SIMULATED large-fire scenario (arrival-time field)
  private scen?: { N: number; arr: Uint8Array; cell: number; tMaxS: number; bucket: number };
  private sFlames?: THREE.Points;
  private sSmoke?: THREE.Points;
  scenarioInfo = { on: false, hours: 0, ha: 0, lapse: 1 };

  // regional incidents (a whole wildfire, tens of km): see setProgression()
  /** 'regional' incidents are ~240× the size of the drone's view: distances, zooms, fog and effects scale with it */
  regional = false;
  private k = 1;
  private progT0 = 0;
  private prog?: { p: Progression; W: number; H: number; minutes: Uint16Array; sev: Uint8Array; order: Uint32Array; sortedMin: Uint16Array; bucket: number };
  private rFlames?: THREE.Points;
  private rSmoke?: THREE.Points;
  private firms?: THREE.Points;
  private innerTex?: THREE.CanvasTexture;
  private assetBase = '';
  private innerCanvas?: HTMLCanvasElement;
  private sky?: THREE.Mesh;
  private windU = { value: new THREE.Vector2(0.5, 0.2) };

  // data
  private incident?: Incident;
  private source?: VideoSource;
  private byClass = new Map<string, FireFeature[]>();
  private hotspots: Hotspot[] = [];
  private events: AnalysisEvent[] = [];
  private time = 0;
  selectedEvent: string | null = null;
  private compareTime: number | null = null;
  private drawnKey = '';
  layers: SceneLayers = { ...DEFAULT_LAYERS };
  private mode2D = false;
  private defaultDist = 320;
  private anim?: { t0: number; dur: number; from: { p: THREE.Vector3; t: THREE.Vector3 }; to: { p: THREE.Vector3; t: THREE.Vector3 }; onDone?: () => void };
  private styleAnim?: { from: number; to: number; t0: number };
  private lastHover = 0;
  private pointer = new THREE.Vector2();
  private raycaster = new THREE.Raycaster();
  private ready = false;

  constructor(container: HTMLElement, cb: SceneCallbacks = {}) {
    this.container = container;
    this.cb = cb;
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', logarithmicDepthBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;   // re-rendered only when a shadow caster moves (see shadowDirty)
    container.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';
    this.renderer = renderer;

    this.labelRoot = document.createElement('div');
    this.labelRoot.className = 'scene-labels';
    container.appendChild(this.labelRoot);

    this.camera = new THREE.PerspectiveCamera(34, 1, 0.5, 200000);
    this.camera.position.set(200, 220, 260);
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.addEventListener('change', this.markActive);
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = THREE.MathUtils.degToRad(84);
    this.controls.minDistance = 8;
    this.controls.maxDistance = 40000;
    this.controls.zoomToCursor = true;
    this.controls.rotateSpeed = 0.55;
    this.controls.panSpeed = 0.9;
    this.controls.zoomSpeed = 0.9;
    this.controls.addEventListener('start', () => { this.anim = undefined; if (this.follow) { this.follow = null; this.cb.onFollowEnd?.(); } });

    // atmosphere
    const haze = new THREE.Color('#d9dcd8');
    this.scene.background = haze.clone();
    this.scene.fog = new THREE.FogExp2(haze.getHex(), 0.000052);
    this.sky = this.makeSky();
    this.scene.add(this.sky);
    const hemi = new THREE.HemisphereLight('#dfe6ef', '#6e5440', 0.85);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight('#ffe9cc', 3.3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    this.scene.add(this.sun, this.sun.target);

    // overlays
    this.maskCanvas.width = this.maskCanvas.height = 2048;
    this.maskCanvas.getContext('2d', { willReadFrequently: true });   // sampled per pixel by hover and the terrain profile
    this.decalCanvas.width = this.decalCanvas.height = 2048;
    this.maskTex = new THREE.CanvasTexture(this.maskCanvas);
    this.maskTex.anisotropy = 8;
    this.decalTex = new THREE.CanvasTexture(this.decalCanvas);
    this.decalTex.colorSpace = THREE.SRGBColorSpace;
    this.decalTex.anisotropy = 8;
    this.uniforms.uMask.value = this.maskTex;
    this.uniforms.uDecal.value = this.decalTex;
    this.uniforms.uMaskBounds.value = this.maskBounds;
    this.uniforms.uDecalBounds.value = this.decalBounds;

    // post
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.7, 0.45, 0.9);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    const ro = new ResizeObserver(() => this.resize());
    ro.observe(container);
    this.resize();
    renderer.domElement.addEventListener('pointermove', this.onPointerMove);
    renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    renderer.domElement.addEventListener('pointerup', this.onPointerUp);
    renderer.domElement.addEventListener('pointerleave', () => cb.onHover?.(null));
    renderer.domElement.addEventListener('click', this.onClick);
    this.loop();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labelRoot.remove();
  }

  private resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.vw = w; this.vh = h;   // cached: per-frame code must not force a layout read
    this.markActive();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
    this.camera.aspect = w / h;
    this.applyInset();
    this.updatePointUniforms();
  }
  /* A panel covering the bottom of the map (the phone sheet) lifts the picture's centre into the part that stays
   * visible, so whatever the camera looks at is never hidden under it. Picking and labels follow, since they use
   * the same projection. Eased in step() to move with the sheet. */
  private insetTarget = { b: 0, l: 0 };
  private insetCur = { b: 0, l: 0 };
  setViewInset(bottomPx: number, leftPx = 0) {
    this.insetTarget = { b: Math.max(0, Math.min(bottomPx, this.vh * 0.6)), l: Math.max(0, Math.min(leftPx, this.vw * 0.6)) };
    this.markActive();
  }
  private applyInset() {
    const { b, l } = this.insetCur;
    if (b > 0.5 || l > 0.5) this.camera.setViewOffset(this.vw, this.vh, -l / 2, b / 2, this.vw, this.vh);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  private makeSky() {
    const geo = new THREE.SphereGeometry(150000, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
      uniforms: { top: { value: new THREE.Color('#aebccb') }, bottom: { value: new THREE.Color('#dedfd9') } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = clamp(vP.y*2.2, 0., 1.); gl_FragColor = vec4(mix(bottom, top, pow(h, .7)), 1.); }',
    });
    const m = new THREE.Mesh(geo, mat);
    m.renderOrder = -1;
    m.frustumCulled = false;
    return m;
  }

  /* ------------------------------------------------------------ terrain */

  /** `assetBase`: URL prefix of the incident package, for its packaged basemap (if any). */
  async load(incident: Incident, source?: VideoSource, assetBase = '') {
    this.incident = incident;
    this.assetBase = assetBase;
    this.source = source;
    this.regional = incident.scale === 'regional';
    this.k = this.regional ? 240 : 1;
    if (incident.progression) this.progT0 = Date.parse(incident.progression.t0);
    const [cx, cy] = source?.pose?.position ?? incident.center;
    this.frame = makeFrame(cx, cy);
    this.innerBBox = incident.bbox;
    if (this.regional) {
      this.gridN = 640;   // ~66 m cells over ~42 km
      this.controls.minDistance = 250; this.controls.maxDistance = 260000;
      this.camera.near = 5; this.camera.far = 2e6; this.camera.updateProjectionMatrix();
      (this.scene.fog as THREE.FogExp2).density = 0.0000105;
      this.sky?.scale.setScalar(8);
    }

    // Inner terrain first (what the overlay waits for); the outer LOD rings stream in afterwards.
    // Zooms match the mesh resolution. Drone view: ~6 m cells (Terrarium z14 ≈ 7 m px, the source is SRTM-class anyway),
    // imagery z16 over the inner box with a z17 patch around the fire. Regional: ~66 m cells (z11), imagery z12, then a
    // z13 patch over the scar once the scene is up.
    this.cb.onProgress?.('Loading terrain');
    const Z = this.regional ? { dem: 11, img: 12 } : { dem: 14, img: 16 };
    const core: BBox | null = this.regional ? null : [cx - 0.0065, cy - 0.005, cx + 0.0065, cy + 0.005];   // ~1.1 × 1.1 km around the drone
    const bm = incident.basemap, A = (f: string) => this.assetBase + f;
    if (bm) this.innerBBox = bm.inner.bbox;
    const [innerDem, innerImg, coreImg] = await Promise.all([
      bm ? imageMosaic(A(bm.inner.dem), bm.inner.bbox) : loadMosaic(this.innerBBox, Z.dem, TERRARIUM),
      bm ? imageMosaic(A(bm.inner.imagery), bm.inner.bbox) : loadMosaic(this.innerBBox, Z.img, ESRI_IMAGERY),
      core ? loadMosaic(core, 17, ESRI_IMAGERY) : Promise.resolve(null),
    ]);
    const dec = decodeTerrarium(innerDem);
    const sampleInner = (lon: number, lat: number) => { const [px, py] = innerDem.px(lon, lat); return dec.sample(px, py); };
    this.h0 = sampleInner(cx, cy);
    const innerCanvas = cropToBBox(innerImg, this.innerBBox, 4096);
    this.innerCanvas = innerCanvas;
    if (core && coreImg) this.paintPatch(coreImg, core, 2048);

    this.cb.onProgress?.('Building terrain');
    const N = this.gridN;
    this.rawHeights = new Float32Array((N + 1) * (N + 1));
    const [w, s, e, n] = this.innerBBox;
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) this.rawHeights[j * (N + 1) + i] = sampleInner(w + ((e - w) * i) / N, n - ((n - s) * j) / N);

    const mat = this.makeTerrainMaterial(innerCanvas, 1);
    this.innerTex = mat.map as THREE.CanvasTexture;
    this.innerMesh = new THREE.Mesh(this.buildGrid(this.innerBBox, N, (i, j) => this.rawHeights[j * (N + 1) + i]), mat);
    this.innerMesh.receiveShadow = this.innerMesh.castShadow = true;
    this.scene.add(this.innerMesh);
    (this.innerMesh.userData as { bbox: BBox }).bbox = this.innerBBox;

    // sun from WSW, fairly low — long warm shadows like the reference
    const sunDir = new THREE.Vector3(-0.85, 0.36, 0.38).normalize();
    const sc = this.sun.shadow.camera as THREE.OrthographicCamera;
    if (this.regional) {
      this.sun.position.copy(sunDir.multiplyScalar(120000));
      sc.left = sc.bottom = -26000; sc.right = sc.top = 26000; sc.near = 1000; sc.far = 260000;
      this.sun.shadow.normalBias = 20;
    } else {
      this.sun.position.copy(sunDir.multiplyScalar(3000));
      sc.left = sc.bottom = -1400; sc.right = sc.top = 1400; sc.near = 100; sc.far = 7000;
    }
    sc.updateProjectionMatrix();

    this.computeOverlayBounds();
    this.addPeakLabels();
    if (this.regional) this.buildRegionalFire();
    else { this.placeTrees(innerCanvas); this.buildFireSystems(); }
    if (source) this.buildDrone(source);
    this.redrawOverlays(true);

    this.setInitialCamera();
    if (!/[?&](nointro|cam)=?/.test(location.search) && !this.reduceMotion) this.intro();
    this.ready = true;
    this.cb.onReady?.();
    this.ringsReady = this.loadRings(cx, cy);
    if (this.regional) this.ringsReady.then(() => this.loadScarImagery());
  }

  /** Draw a sharper imagery mosaic over part of the inner terrain texture. */
  private paintPatch(m: Awaited<ReturnType<typeof loadMosaic>>, b: BBox, size: number) {
    const c = this.innerCanvas;
    if (!c) return;
    const [w, s, e, n] = this.innerBBox, W = c.width;
    const x0 = ((b[0] - w) / (e - w)) * W, x1 = ((b[2] - w) / (e - w)) * W, y0 = ((n - b[3]) / (n - s)) * W, y1 = ((n - b[1]) / (n - s)) * W;
    c.getContext('2d')!.drawImage(cropToBBox(m, b, size), x0, y0, x1 - x0, y1 - y0);
    if (this.innerTex) this.innerTex.needsUpdate = true;
  }
  /** Regional: z13 imagery (~14 m) over the scar, after everything else has loaded. */
  private async loadScarImagery() {
    const pt = this.incident?.basemap?.patch;
    if (pt) { const m = await imageMosaic(this.assetBase + pt.imagery, pt.bbox); if (this.frame) { this.paintPatch(m, pt.bbox, 4096); this.markActive(); } return; }
    const g = this.incident?.reference_perimeter?.geometry;
    if (!g) return;
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    forEachCoord(g, (c) => { w = Math.min(w, c[0]); e = Math.max(e, c[0]); s = Math.min(s, c[1]); n = Math.max(n, c[1]); });
    const b: BBox = [w - 0.02, s - 0.015, e + 0.02, n + 0.015];
    const m = await loadMosaic(b, 13, ESRI_IMAGERY);
    if (!this.frame) return;
    this.paintPatch(m, b, 3072);
    this.markActive();
  }

  /** Outer LOD rings (clipmap-style): ~14 km and ~70 km horizon, coarser the further out. Loaded after the inner terrain. */
  ringsReady: Promise<void> = Promise.resolve();
  private async loadRings(cx: number, cy: number) {
    const RINGS = this.regional ? [
      { half: [0.95, 0.72], demZ: 9, imgZ: 10, N: 240, img: 2048 },      // ~160 km: 660 m cells
      { half: [3.6, 2.7], demZ: 6, imgZ: 7, N: 180, img: 2048 },         // ~600 km horizon
    ] : [
      { half: [0.085, 0.065], demZ: 12, imgZ: 14, N: 240, img: 2048 },   // ~14 km: 58 m cells, z12 DEM ≈ 30 m px
      { half: [0.42, 0.32], demZ: 9, imgZ: 11, N: 200, img: 2048 },      // ~70 km horizon: 350 m cells, z9 DEM ≈ 240 m px
    ];
    const tuck = this.regional ? [120, 600] : [30, 90];
    let finer: BBox = this.innerBBox;
    for (const [k, r] of RINGS.entries()) {
      const pk = this.incident?.basemap?.rings[k];
      const bbox: BBox = pk ? pk.bbox : [cx - r.half[0], cy - r.half[1], cx + r.half[0], cy + r.half[1]];
      const [dem, img] = await Promise.all(pk
        ? [imageMosaic(this.assetBase + pk.dem, pk.bbox), imageMosaic(this.assetBase + pk.imagery, pk.bbox)]
        : [loadMosaic(bbox, r.demZ, TERRARIUM), loadMosaic(bbox, r.imgZ, ESRI_IMAGERY)]);
      if (!this.frame) return;   // disposed meanwhile
      const d = decodeTerrarium(dem);
      const sample = (lon: number, lat: number) => { const [px, py] = dem.px(lon, lat); return d.sample(px, py); };
      this.ringSamplers.push({ bbox, sample });
      this.outerSampler = (lon, lat) => {
        for (const q of this.ringSamplers) if (lon >= q.bbox[0] && lon <= q.bbox[2] && lat >= q.bbox[1] && lat <= q.bbox[3]) return q.sample(lon, lat);
        return this.h0;
      };
      const inner = finer, rN = r.N;
      const cellLon = (bbox[2] - bbox[0]) / rN, cellLat = (bbox[3] - bbox[1]) / rN;
      const hFn = (i: number, j: number) => {
        const lon = bbox[0] + (bbox[2] - bbox[0]) * (i / rN), lat = bbox[3] - (bbox[3] - bbox[1]) * (j / rN);
        const inside = lon > inner[0] + cellLon && lon < inner[2] - cellLon && lat > inner[1] + cellLat && lat < inner[3] - cellLat;
        return sample(lon, lat) - (inside ? tuck[k] : 0);   // tuck under the finer ring
      };
      const mesh = new THREE.Mesh(this.buildGrid(bbox, rN, hFn), this.makeTerrainMaterial(cropToBBox(img, bbox, r.img), 0));
      mesh.receiveShadow = k === 0;
      (mesh.userData as { bbox: BBox }).bbox = bbox;
      this.rings.push(mesh);
      this.scene.add(mesh);
      this.shadowDirty = 3;
      finer = bbox;
    }
  }

  private buildGrid(bbox: BBox, N: number, h: (i: number, j: number) => number) {
    const [w, s, e, n] = bbox;
    const pos = new Float32Array((N + 1) * (N + 1) * 3), uv = new Float32Array((N + 1) * (N + 1) * 2);
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const k = j * (N + 1) + i;
      const [x, z] = toXZ(this.frame, w + ((e - w) * i) / N, n - ((n - s) * j) / N);
      pos[k * 3] = x; pos[k * 3 + 1] = (h(i, j) - this.h0) * this.exaggeration; pos[k * 3 + 2] = z;
      uv[k * 2] = i / N; uv[k * 2 + 1] = 1 - j / N;
    }
    const idx: number[] = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.userData = { N, h };
    return g;
  }

  private makeTerrainMaterial(imagery: HTMLCanvasElement, inner: number) {
    const tex = new THREE.CanvasTexture(imagery);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.97, metalness: 0 });
    const u = this.uniforms;
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u, { uInner: { value: inner } });
      sh.vertexShader = sh.vertexShader
        .replace('void main() {', 'varying vec3 vWorld;\nvoid main() {')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n vWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('void main() {', `varying vec3 vWorld;
uniform sampler2D uMask; uniform sampler2D uDecal; uniform vec4 uMaskBounds; uniform vec4 uDecalBounds;
uniform float uTime, uBurnOp, uFireOp, uChangeOp, uImageryMix, uMapStyle, uStyleOn, uInner;
uniform sampler2D uScen; uniform vec4 uScenBounds; uniform float uScenT, uScenOn;
uniform sampler2D uArr; uniform sampler2D uSev; uniform vec4 uArrBounds; uniform float uArrT, uArrOn, uArrBefore, uSevOp, uIsoOp, uFrontH;
uniform sampler2D uSim; uniform float uSimOn;
${NOISE_GLSL}
void main() {`)
        .replace('#include <map_fragment>', /* glsl */ `
  vec3 img = texture2D(map, vMapUv).rgb;
  float lum = dot(img, vec3(.2126,.7152,.0722));
  float exg = 2.0*img.g - img.r - img.b;
  float n1 = fsFbm(vWorld.xz*0.045), n2 = fsNoise(vWorld.xz*0.6);
  vec3 sandD = vec3(0.47,0.32,0.17), sandL = vec3(0.78,0.60,0.37);
  vec3 sand = mix(sandD, sandL, smoothstep(0.02, 0.30, lum + (n1-.5)*0.06));
  sand *= 0.93 + 0.10*n2;
  float shrub = smoothstep(0.012, 0.05, exg + (n1-.5)*0.012);
  float canopy = smoothstep(0.03, 0.07, exg) * (1.0 - smoothstep(0.05, 0.14, lum));
  vec3 style = mix(sand, vec3(0.30,0.25,0.12), shrub*0.55);
  style = mix(style, vec3(0.05,0.075,0.03), canopy*0.85);
  float vm = max(shrub*0.6, canopy);
  vec3 alb = mix(style, img*1.15, uImageryMix);
  alb = mix(img, alb, uStyleOn);
  vec3 mapC = mix(vec3(0.86,0.83,0.75), vec3(0.55,0.70,0.45), vm*0.85);
  alb = mix(alb, mapC, uMapStyle);
  vec3 fireEm = vec3(0.);
  vec2 muv = fsBoundsUv(vWorld.xz, uMaskBounds);
  float mi = fsInside(muv);
  if (mi > 0.) {
    vec4 m = texture2D(uMask, muv, 1.0);
    float bb = texture2D(uMask, muv, 3.0).r;
    float burned = m.r * uBurnOp, actv = m.g * uFireOp, change = m.b * uChangeOp;
    vec3 burnC = mix(vec3(0.022,0.016,0.015), vec3(0.15,0.075,0.065), fsFbm(vWorld.xz*0.35));
    burnC = mix(burnC, vec3(0.30,0.24,0.21), smoothstep(0.55, 0.9, fsNoise(vWorld.xz*1.7))*0.35);
    alb = mix(alb, mix(burnC, vec3(0.58,0.30,0.27), uMapStyle*0.6), burned);
    float rim = clamp((bb - m.r)*3.0, 0., 1.) * uBurnOp;
    alb = mix(alb, mix(vec3(0.55,0.07,0.03), vec3(0.85,0.30,0.22), uMapStyle), rim*0.55);
    alb = mix(alb, vec3(0.75,0.22,0.04), change*0.45);
    float fl = fsNoise(vWorld.xz*0.9 + vec2(0., -uTime*2.3)) * fsNoise(vWorld.xz*2.1 + vec2(uTime*1.3, 0.));
    fireEm = vec3(1.0, 0.34, 0.06) * actv * (1.6 + 5.0*fl);
    fireEm += vec3(0.9, 0.25, 0.04) * change * 0.25 * (0.6 + 0.4*sin(uTime*2.0));
    alb = mix(alb, vec3(0.05,0.02,0.01), actv*0.6);
  }
  if (uScenOn > 0.5) {   // SIMULATED large-fire scenario: arrival-time field vs scenario clock
    vec2 suv = fsBoundsUv(vWorld.xz, uScenBounds);
    if (fsInside(suv) > 0.) {
      float a = texture2D(uScen, suv).r;
      float burnt = smoothstep(uScenT + 0.003, uScenT - 0.003, a) * step(a, 0.995);
      float front = burnt * smoothstep(uScenT - 0.011, uScenT - 0.001, a);
      vec3 sc = mix(vec3(0.012,0.010,0.010), vec3(0.09,0.05,0.04), fsFbm(vWorld.xz*0.05));
      alb = mix(alb, mix(sc, vec3(0.58,0.30,0.27), uMapStyle*0.6), burnt*0.96);
      fireEm += vec3(0.5, 0.08, 0.02) * burnt * smoothstep(uScenT - 0.06, uScenT - 0.01, a) * 0.6;   // smouldering behind the front
      float sfl = fsNoise(vWorld.xz*0.12 + vec2(0., -uTime*1.6)) * fsNoise(vWorld.xz*0.33 + vec2(uTime, 0.));
      fireEm += vec3(1.0, 0.32, 0.05) * front * (2.2 + 6.0*sfl);
      float glow = smoothstep(uScenT - 0.05, uScenT, a) * (1.0 - burnt) * step(a, 0.995) * smoothstep(uScenT + 0.012, uScenT, a);
      fireEm += vec3(0.9, 0.18, 0.03) * glow * 0.8;
    }
  }
  if (uArrOn > 0.5) {   // regional: when each place burned (reconstructed) vs the timeline clock, in hours
    vec2 auv = fsBoundsUv(vWorld.xz, uArrBounds);
    if (fsInside(auv) > 0.) {
      float a = texture2D(uArr, auv).r;
      float cls = floor(texture2D(uSev, auv).r * 255.0 / 40.0 + 0.5);
      float age = uArrT - a;
      float burnt = step(0.0, age) * step(a, 50000.0);
      float n = fsFbm(vWorld.xz*0.004);
      // fresh char darkens to grey ash over two days; higher severity stays darker
      vec3 charC = mix(vec3(0.018,0.014,0.013), vec3(0.07,0.045,0.035), n);
      vec3 ashC = mix(vec3(0.20,0.18,0.17), vec3(0.06,0.05,0.05), clamp((cls - 1.0) / 4.0, 0.0, 1.0)) * (0.8 + 0.4*n);
      vec3 burnC = mix(charC, ashC, smoothstep(6.0, 48.0, age));
      vec3 sevC = cls < 1.5 ? vec3(0.42,0.62,0.30) : cls < 2.5 ? vec3(0.96,0.86,0.42) : cls < 3.5 ? vec3(0.95,0.60,0.22) : cls < 4.5 ? vec3(0.82,0.24,0.12) : vec3(0.42,0.05,0.12);
      burnC = mix(burnC, sevC, uSevOp * step(0.5, cls));
      alb = mix(alb, mix(burnC, vec3(0.58,0.30,0.27), uMapStyle*0.6*(1.0 - uSevOp)), burnt * uBurnOp);
      // burned between "before" and now (compare)
      float chg = burnt * step(0.0, uArrBefore) * step(uArrBefore, a);
      alb = mix(alb, vec3(0.75,0.22,0.04), chg * uChangeOp * 0.55);
      // active front (reached in the last uFrontH hours) and embers behind it
      float front = burnt * (1.0 - smoothstep(0.0, uFrontH, age));
      float fl = fsNoise(vWorld.xz*0.012 + vec2(0., -uTime*0.9)) * fsNoise(vWorld.xz*0.031 + vec2(uTime*0.6, 0.));
      fireEm += vec3(1.0, 0.34, 0.06) * front * uFireOp * (1.4 + 5.0*fl);
      fireEm += vec3(0.6, 0.10, 0.02) * burnt * (1.0 - smoothstep(uFrontH, 14.0, age)) * smoothstep(0.55, 0.8, fsNoise(vWorld.xz*0.05 + uTime*0.15)) * uFireOp * 0.9;
      // daily isochrones (00:00 UTC) inside what has burned
      float da = a / 24.0, w = fwidth(da);
      float iso = (1.0 - smoothstep(0.0, w * 1.4, abs(fract(da + 0.5) - 0.5))) * step(w, 0.2) * burnt;
      alb = mix(alb, vec3(1.0, 0.55, 0.30), iso * uIsoOp * 0.85);
      if (uSimOn > 0.5) {   // retrospective scenario: violet where the model has burned and the real fire had not, and its front
        float sa = texture2D(uSim, auv).r, sb = step(sa, uArrT) * step(sa, 50000.0);
        float hatch = step(0.5, fract((vWorld.x + vWorld.z) * 0.004));
        alb = mix(alb, vec3(0.55, 0.38, 0.86), sb * (1.0 - burnt * uBurnOp) * (0.32 + 0.18 * hatch));
        float sf = sb * (1.0 - smoothstep(0.0, 2.0, uArrT - sa));
        alb = mix(alb, vec3(0.62, 0.42, 1.0), sf * 0.85);
        fireEm += vec3(0.35, 0.18, 0.9) * sf * 0.6;
      }
    }
  }
  vec2 duv = fsBoundsUv(vWorld.xz, uDecalBounds);
  if (fsInside(duv) > 0.) { vec4 d = texture2D(uDecal, duv); alb = mix(alb, d.rgb, d.a); }
  diffuseColor.rgb *= alb;
`)
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += fireEm;');
    };
    return mat;
  }

  /** Label the highest local maxima of the DEM (real elevations, unnamed — we don't invent toponyms). */
  private addPeakLabels() {
    const N = this.gridN, R = N + 1, H = this.rawHeights, win = 22, peaks: { i: number; j: number; h: number }[] = [];
    for (let j = win; j < N - win; j += 3) for (let i = win; i < N - win; i += 3) {
      const h = H[j * R + i];
      let isMax = true;
      for (let dj = -win; dj <= win && isMax; dj += 2) for (let di = -win; di <= win; di += 2) if (H[(j + dj) * R + i + di] > h) { isMax = false; break; }
      if (isMax) peaks.push({ i, j, h });
    }
    peaks.sort((a, b) => b.h - a.h);
    const [w, s, e, n] = this.innerBBox;
    peaks.slice(0, 4).forEach((p, k) => {
      const lon = w + ((e - w) * p.i) / N, lat = n - ((n - s) * p.j) / N;
      this.addLabel('peak_' + k, `<div class="lbl-peak"><span>▲</span><div>Summit<b>${Math.round(p.h).toLocaleString()} m</b></div></div>`, this.worldAt(lon, lat, 2));
    });
    const lm = this.incident?.landmarks ?? [];
    lm.forEach((l, k) => this.addLabel('lm_' + k, `<div class="lbl-peak place"><span>●</span><div>${l.name}</div></div>`, this.worldAt(l.position[0], l.position[1], 1)));
  }

  /** Raw DEM elevation (m, MSL) at world xz. */
  elevationAt(x: number, z: number): number {
    if (!this.rawHeights || !this.frame) return this.h0;   // terrain not loaded yet (e.g. timeline scrubbed during load)
    const [lon, lat] = toLonLat(this.frame, x, z);
    const [w, s, e, n] = this.innerBBox;
    if (lon >= w && lon <= e && lat >= s && lat <= n) {
      const N = this.gridN, fi = ((lon - w) / (e - w)) * N, fj = ((n - lat) / (n - s)) * N;
      const i = Math.min(N - 1, Math.floor(fi)), j = Math.min(N - 1, Math.floor(fj)), a = fi - i, b = fj - j, H = this.rawHeights, R = N + 1;
      return (H[j * R + i] * (1 - a) + H[j * R + i + 1] * a) * (1 - b) + (H[(j + 1) * R + i] * (1 - a) + H[(j + 1) * R + i + 1] * a) * b;
    }
    return this.outerSampler ? this.outerSampler(lon, lat) : this.h0;
  }
  /** World y of the ground at xz (exaggerated). */
  groundY(x: number, z: number) { return (this.elevationAt(x, z) - this.h0) * this.exaggeration; }
  worldAt(lon: number, lat: number, up = 0) { const [x, z] = toXZ(this.frame, lon, lat); return new THREE.Vector3(x, this.groundY(x, z) + up, z); }

  setExaggeration(v: number) {
    this.exaggeration = v;
    this.shadowDirty = 3;
    for (const mesh of [this.innerMesh, ...this.rings]) {
      if (!mesh) continue;
      const g = mesh.geometry, { N, h } = g.userData as { N: number; h: (i: number, j: number) => number };
      const p = g.attributes.position as THREE.BufferAttribute;
      for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) p.setY(j * (N + 1) + i, (h(i, j) - this.h0) * v);
      p.needsUpdate = true;
      g.computeVertexNormals();
      g.computeBoundingSphere();
    }
    this.placeTreesFromCache();
    if (this.source) this.buildDrone(this.source);
    this.drawnKey = '';
    this.redrawOverlays(true);
  }

  /* ----------------------------------------------------------- overlays */

  private computeOverlayBounds() {
    // mask: tight around the observations; decal: around the reference perimeter + footprint
    const pts: [number, number][] = [];
    for (const list of this.byClass.values()) for (const f of list) forEachCoord(f.geometry, (c) => pts.push(toXZ(this.frame, c[0], c[1])));
    const fp = this.source?.footprint?.geometry;
    if (fp) forEachCoord(fp, (c) => pts.push(toXZ(this.frame, c[0], c[1])));
    if (!pts.length) pts.push([-80, -80], [80, 80]);
    setSquareBounds(this.maskBounds, pts, 40 * (this.regional ? 50 : 1));
    const dp = [...pts];
    const per = this.incident?.reference_perimeter?.geometry;
    if (per) forEachCoord(per, (c) => dp.push(toXZ(this.frame, c[0], c[1])));
    setSquareBounds(this.decalBounds, dp, 120 * (this.regional ? 25 : 1));
  }

  setObservations(features: FireFeature[], hotspots: Hotspot[]) {
    this.byClass.clear();
    for (const f of features) {
      const k = f.properties.classification;
      if (!this.byClass.has(k)) this.byClass.set(k, []);
      this.byClass.get(k)!.push(f);
    }
    for (const l of this.byClass.values()) l.sort((a, b) => Date.parse(a.properties.timestamp) - Date.parse(b.properties.timestamp));
    this.hotspots = [...hotspots].sort((a, b) => Date.parse(a.properties.timestamp) - Date.parse(b.properties.timestamp));
    if (this.frame) { this.computeOverlayBounds(); this.drawnKey = ''; this.redrawOverlays(true); }
    if (this.prog) this.buildFirms();
  }

  setEvents(events: AnalysisEvent[]) {
    this.events = events;
    if (this.ready) this.rebuildEventLabels();
  }

  setTime(ms: number) {
    if (ms !== this.time) { this.markActive(); this.shadowDirty = 2; }
    this.time = ms;
    if (this.progT0) this.uniforms.uArrT.value = (ms - this.progT0) / 3.6e6;
    this.redrawOverlays(); this.updateScenario(); this.updateRegionalFire();
  }
  setSelectedEvent(id: string | null) { this.selectedEvent = id; this.drawnKey = ''; this.redrawOverlays(); }
  setCompare(ms: number | null) { this.compareTime = ms; this.uniforms.uArrBefore.value = ms != null && this.progT0 ? (ms - this.progT0) / 3.6e6 : -1; this.drawnKey = ''; this.redrawOverlays(); }

  setLayers(l: Partial<SceneLayers>) {
    this.shadowDirty = 3;
    const prev = this.layers;
    this.layers = { ...this.layers, ...l };
    const u = this.uniforms;
    u.uImageryMix.value = this.layers.imagery;
    u.uBurnOp.value = this.layers.burned;
    u.uFireOp.value = this.layers.active;
    u.uChangeOp.value = this.layers.change;
    u.uStyleOn.value = this.layers.terrain ? 1 : 0;
    u.uSevOp.value = this.layers.severity;
    u.uSimOn.value = this.regional && this.layers.projection && u.uSim.value ? 1 : 0;
    u.uIsoOp.value = this.layers.isochrones ? 1 : 0;
    if (this.rFlames) this.rFlames.visible = this.layers.active > 0.01 && !this.mode2D;
    if (this.rSmoke) this.rSmoke.visible = this.layers.smoke && this.layers.active > 0.01 && !this.mode2D;
    if (this.firms) this.firms.visible = this.layers.hotspots;
    if (this.trees) this.trees.visible = this.layers.trees && !this.mode2D;
    if (this.flames) this.flames.visible = this.layers.active > 0.01 && !this.mode2D;
    if (this.smoke) this.smoke.visible = this.layers.smoke && this.layers.active > 0.01 && !this.mode2D;
    if (this.frustum) this.frustum.visible = this.layers.footprint;
    if (prev.groundTruth !== this.layers.groundTruth || prev.perimeter !== this.layers.perimeter || prev.footprint !== this.layers.footprint || prev.path !== this.layers.path || prev.projection !== this.layers.projection || prev.ems !== this.layers.ems) { this.drawnKey = ''; this.redrawOverlays(); }
    for (const [id, lab] of this.labels) if (id.startsWith('hs_')) lab.el.style.display = this.layers.hotspots ? '' : 'none';
  }

  private latestAt<T extends { properties: { timestamp: string } }>(list: T[] | undefined, t: number): T | undefined {
    if (!list?.length) return undefined;
    let lo = 0, hi = list.length - 1, best = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (Date.parse(list[mid].properties.timestamp) <= t) { best = mid; lo = mid + 1; } else hi = mid - 1; }
    return best >= 0 ? list[best] : undefined;
  }

  private redrawOverlays(force = false) {
    if (!this.frame) return;
    const t = this.time;
    const burned = this.latestAt(this.byClass.get('burned_area'), t);
    const active = this.latestAt(this.byClass.get('visible_active_fire'), t);
    const change = this.latestAt(this.byClass.get('area_change'), t);
    const gt = this.layers.groundTruth ? this.latestAt(this.byClass.get('ground_truth_burned'), t) : undefined;
    const before = this.compareTime != null ? this.latestAt(this.byClass.get('burned_area'), this.compareTime) : undefined;
    const pathIdx = this.events.filter((e) => Date.parse(e.timestamp) <= t).length;
    const ems = this.layers.ems ? this.latestAt(this.byClass.get('external_perimeter'), t) : undefined;
    const drops = this.simCtx && this.opsMode === 'resources' ? dropsUntil(t, this.simCtx) : [];
    const lineKey = this.simCtx && this.opsMode === 'resources' ? Math.floor((t - this.simCtx.t0) / 10000) : -1;
    const key = [burned?.properties.id, active?.properties.id, change?.properties.id, gt?.properties.id, before?.properties.id, ems?.properties.id, pathIdx, drops.length, lineKey, this.opsMode].join('|');
    if (!force && key === this.drawnKey) return;
    this.drawnKey = key;

    // ---- mask (R burned, G active, B change)
    const mc = this.maskCanvas.getContext('2d')!;
    mc.globalCompositeOperation = 'source-over';
    mc.filter = 'none';
    mc.fillStyle = '#000';
    mc.fillRect(0, 0, 2048, 2048);
    mc.globalCompositeOperation = 'lighter';
    const mp = (lon: number, lat: number) => this.toCanvas(this.maskBounds, lon, lat);
    if (burned) { fillGeom(mc, burned.geometry, mp, '#ff0000'); }
    if (active) { fillGeom(mc, active.geometry, mp, '#00ff00'); }
    if (this.compareTime != null && before && burned) {
      // change since BEFORE: current burned minus before burned → blue
      const tmp = document.createElement('canvas'); tmp.width = tmp.height = 2048;
      const tc = tmp.getContext('2d')!;
      fillGeom(tc, burned.geometry, mp, '#0000ff');
      tc.globalCompositeOperation = 'destination-out';
      fillGeom(tc, before.geometry, mp, '#000');
      mc.drawImage(tmp, 0, 0);
    } else if (change) { fillGeom(mc, change.geometry, mp, '#0000ff'); }
    mc.filter = 'none';
    mc.globalCompositeOperation = 'source-over';
    this.maskTex.needsUpdate = true;

    // ---- decal (lines)
    const dc = this.decalCanvas.getContext('2d')!;
    dc.clearRect(0, 0, 2048, 2048);
    const dp = (lon: number, lat: number) => this.toCanvas(this.decalBounds, lon, lat);
    const pxPerM = 2048 / (this.decalBounds.z - this.decalBounds.x);
    const per = this.incident?.reference_perimeter?.geometry;
    if (per && this.layers.perimeter) strokeGeom(dc, per, dp, 'rgba(255,255,255,0.95)', Math.max(1.6, 1.1 * pxPerM), [7, 5]);
    const fp = this.source?.footprint?.geometry;
    if (fp && this.layers.footprint) strokeGeom(dc, fp, dp, 'rgba(255,255,255,0.85)', 1.4, []);
    if (gt) { strokeGeom(dc, gt.geometry, dp, 'rgba(64,200,255,0.95)', 1.4, []); }
    if (ems) strokeGeom(dc, ems.geometry, dp, 'rgba(120,220,255,0.95)', 1.5, []);   // latest Copernicus EMS perimeter ≤ t
    if (before) strokeGeom(dc, before.geometry, dp, 'rgba(255,255,255,0.95)', 1.6, [4, 3]);
    if (this.layers.projection) {
      for (const f of this.byClass.get('projection') ?? []) {
        fillGeom(dc, f.geometry, dp, 'rgba(168,85,247,0.10)');
        strokeGeom(dc, f.geometry, dp, 'rgba(168,85,247,0.95)', 1.6, [5, 4]);
      }
    }
    if (this.layers.path) {
      const pts = this.events.filter((e) => e.location).map((e) => ({ p: dp(e.location![0], e.location![1]), past: Date.parse(e.timestamp) <= t }));
      for (let i = 0; i < pts.length - 1; i++) {
        dc.beginPath(); dc.moveTo(...pts[i].p); dc.lineTo(...pts[i + 1].p);
        dc.strokeStyle = pts[i + 1].past ? 'rgba(255,196,64,1)' : 'rgba(255,196,64,0.9)';
        dc.setLineDash(pts[i + 1].past ? [] : [3, 3]);
        dc.lineWidth = pts[i + 1].past ? 2.2 : 1.6;
        dc.stroke();
      }
      dc.setLineDash([]);
    }
    if (this.simCtx && this.opsMode === 'resources') {
      for (const ln of firelinesUntil(t, this.simCtx)) {
        dc.beginPath(); ln.forEach((p, i) => { const [x, y] = dp(p[0], p[1]); if (i) dc.lineTo(x, y); else dc.moveTo(x, y); });
        dc.strokeStyle = 'rgba(92,52,24,0.95)'; dc.lineWidth = Math.max(2, 3 * pxPerM); dc.setLineDash([]); dc.stroke();
      }
      for (const d of drops) {
        const age = (t - d.t) / (this.regional ? 3600000 : 60000), a = Math.max(0.25, 0.85 - age * 0.08);   // minutes (drone view) or hours (regional)
        const [x0, y0] = dp(d.line[0][0], d.line[0][1]), [x1, y1] = dp(d.line[1][0], d.line[1][1]);
        dc.beginPath(); dc.moveTo(x0, y0); dc.lineTo(x1, y1);
        dc.strokeStyle = d.kind === 'retardant' ? `rgba(220,38,38,${a})` : `rgba(59,130,246,${a})`;
        dc.lineWidth = Math.max(4, (d.kind === 'retardant' ? 22 : 14) * pxPerM); dc.lineCap = 'round'; dc.stroke(); dc.lineCap = 'butt';
      }
    }
    this.decalTex.needsUpdate = true;

    if (!this.regional) { this.updateFlames(active, burned); this.updateHotspotLabels(t); }
    for (const [id, lab] of this.labels) if (id.startsWith('ev_')) {
      const e = this.events.find((x) => 'ev_' + x.event_id === id);
      if (e) { lab.el.classList.toggle('future', Date.parse(e.timestamp) > t); const sel = e.event_id === this.selectedEvent; if (lab.el.classList.contains('sel') !== sel) delete lab.el.dataset.w; lab.el.classList.toggle('sel', sel); }
    }
  }

  private toCanvas(b: THREE.Vector4, lon: number, lat: number): [number, number] {
    const [x, z] = toXZ(this.frame, lon, lat);
    return [((x - b.x) / (b.z - b.x)) * 2048, ((z - b.y) / (b.w - b.y)) * 2048];
  }

  /* --------------------------------------------------------------- fire */

  private buildFireSystems() {
    const CAP = 3000;
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(CAP * 3), 3));
    fg.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(CAP), 1));
    fg.setDrawRange(0, 0);
    const pu = { uTime: this.uniforms.uTime, uScale: { value: 1 }, uSize: { value: 3.6 } };
    this.flames = new THREE.Points(fg, new THREE.ShaderMaterial({
      uniforms: pu, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `#include <common>
#include <logdepthbuf_pars_vertex>
attribute float aSeed; uniform float uTime, uScale, uSize; varying float vSeed; varying float vF;
        void main(){ vSeed = aSeed; vec3 p = position; float f = fract(uTime*(0.9+aSeed*0.8) + aSeed*7.0); vF = f;
          p.y += f * uSize * 0.55 + uSize*0.35; p.x += sin(uTime*3.+aSeed*20.)*0.25;
          vec4 mv = modelViewMatrix*vec4(p,1.); gl_Position = projectionMatrix*mv;
          gl_PointSize = clamp(uSize*(1.0 - f*0.45)*(0.75+aSeed*0.7) * uScale / -mv.z, 1.5, 220.);
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: /* glsl */ `#include <logdepthbuf_pars_fragment>
varying float vSeed; varying float vF; uniform float uTime;
        void main(){
          #include <logdepthbuf_fragment>
 vec2 uv = gl_PointCoord*2.-1.; uv.y = -uv.y;
          float wob = sin(uv.y*5.0 + uTime*9.0 + vSeed*30.0)*0.12*(uv.y+1.0);
          float w = mix(0.62, 0.08, clamp((uv.y+1.0)*0.5, 0., 1.));            // wide base, pointed tip
          float d = abs(uv.x + wob) / w;
          float body = smoothstep(1.0, 0.35, d) * smoothstep(1.0, 0.55, uv.y) * smoothstep(-1.0, -0.7, uv.y);
          float a = body * (1.0 - vF*0.85);
          float core = smoothstep(0.5, 0.0, d) * smoothstep(0.2, -0.8, uv.y);
          vec3 c = mix(vec3(0.85,0.10,0.01), vec3(1.0,0.48,0.08), smoothstep(0.9, 0.2, d));
          c = mix(c, vec3(1.0,0.82,0.45), core*0.7);
          gl_FragColor = vec4(c*0.62*a, a*0.8); }`,
    }));
    this.flames.frustumCulled = false;
    this.flames.renderOrder = 5;

    const SC = 900;
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SC * 3), 3));
    sg.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(SC), 1));
    sg.setDrawRange(0, 0);
    const su = { uTime: this.uniforms.uTime, uScale: pu.uScale };
    this.smoke = new THREE.Points(sg, new THREE.ShaderMaterial({
      uniforms: su, transparent: true, depthWrite: false,
      vertexShader: /* glsl */ `#include <common>
#include <logdepthbuf_pars_vertex>
attribute float aSeed; uniform float uTime, uScale; varying float vL; varying float vSeed;
        void main(){ vSeed = aSeed; float L = fract(uTime*0.035 + aSeed*13.7); vL = L; vec3 p = position;
          p += vec3(L*L*38.0 + sin(aSeed*40.)*4., L*42.0, -L*L*14.0 + cos(aSeed*30.)*4.);
          vec4 mv = modelViewMatrix*vec4(p,1.); gl_Position = projectionMatrix*mv;
          gl_PointSize = clamp((5.0 + L*30.0) * uScale / -mv.z, 2., 420.);
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: /* glsl */ `#include <logdepthbuf_pars_fragment>
varying float vL; varying float vSeed;
        void main(){
          #include <logdepthbuf_fragment>
 vec2 uv = gl_PointCoord*2.-1.; float d = length(uv); float a = smoothstep(1., .1, d) * smoothstep(0., .12, vL) * (1.-vL) * 0.16;
          vec3 c = mix(vec3(.22,.20,.19), vec3(.62,.60,.58), vL); gl_FragColor = vec4(c, a); }`,
    }));
    this.smoke.frustumCulled = false;
    this.smoke.renderOrder = 6;
    this.scene.add(this.flames, this.smoke);
    this.updatePointUniforms();
  }

  private updatePointUniforms() {
    const h = this.renderer.domElement.height || 800;
    const scale = h / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
    const set = (p?: THREE.Points) => { const m = p?.material as THREE.ShaderMaterial | undefined; if (m) m.uniforms.uScale.value = scale; };
    set(this.flames); set(this.smoke); set(this.rFlames);
  }

  private updateFlames(active?: FireFeature, burned?: FireFeature) {
    if (!this.flames || !this.smoke) return;
    const fp = this.flames.geometry.attributes.position as THREE.BufferAttribute, fs = this.flames.geometry.attributes.aSeed as THREE.BufferAttribute;
    const sp = this.smoke.geometry.attributes.position as THREE.BufferAttribute, ss = this.smoke.geometry.attributes.aSeed as THREE.BufferAttribute;
    let nf = 0, ns = 0;
    const rnd = mulberry32(active ? hashStr(active.properties.id) : 1);
    if (active) {
      const rings = polygonsXZ(active.geometry, this.frame);
      for (const poly of rings) {
        const area = ringArea(poly[0]);
        const count = Math.min(fp.count - nf, Math.ceil(area / 1.1));
        const [minx, minz, maxx, maxz] = ringBBox(poly[0]);
        let tries = 0, made = 0;
        while (made < count && tries < count * 30) {
          tries++;
          const x = minx + rnd() * (maxx - minx), z = minz + rnd() * (maxz - minz);
          if (!pointInPoly(x, z, poly)) continue;
          fp.setXYZ(nf, x, this.groundY(x, z) + 0.2, z); fs.setX(nf, rnd()); nf++; made++;
          if (made % 9 === 0 && ns < sp.count) { sp.setXYZ(ns, x, this.groundY(x, z) + 1, z); ss.setX(ns, rnd()); ns++; }
        }
      }
    }
    void burned;
    fp.needsUpdate = fs.needsUpdate = sp.needsUpdate = ss.needsUpdate = true;
    this.flames.geometry.setDrawRange(0, nf);
    this.smoke.geometry.setDrawRange(0, ns);
  }

  /* ------------------------------------------------- regional wildfire */

  /** Flames along the active front, smoke columns leaning with the ERA5 wind, and the FIRMS detections. */
  private buildRegionalFire() {
    const pts = (cap: number, mat: THREE.ShaderMaterial, order: number) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cap * 3), 3));
      g.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(cap), 1));
      g.setDrawRange(0, 0);
      const p = new THREE.Points(g, mat); p.frustumCulled = false; p.renderOrder = order; this.scene.add(p); return p;
    };
    const scaleU = { value: 1 };
    this.rFlames = pts(4000, new THREE.ShaderMaterial({
      uniforms: { uTime: this.uniforms.uTime, uScale: scaleU }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `#include <common>
#include <logdepthbuf_pars_vertex>
attribute float aSeed; uniform float uTime, uScale; varying float vF; varying float vSeed;
        void main(){ vSeed = aSeed; vec3 p = position; float f = fract(uTime*(0.5+aSeed*0.5) + aSeed*7.0); vF = f;
          p.y += 18.0 + f*70.0;
          vec4 mv = modelViewMatrix*vec4(p,1.); gl_Position = projectionMatrix*mv;
          gl_PointSize = clamp((60.0 + aSeed*70.0) * (1.0 - f*0.5) * uScale / -mv.z, 1.2, 90.);
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: /* glsl */ `#include <logdepthbuf_pars_fragment>
varying float vF; varying float vSeed;
        void main(){
          #include <logdepthbuf_fragment>
          vec2 uv = gl_PointCoord*2.-1.; float d = length(uv);
          float a = smoothstep(1.0, 0.1, d) * (1.0 - vF*0.8);
          vec3 c = mix(vec3(0.95,0.20,0.02), vec3(1.0,0.62,0.18), smoothstep(0.8, 0.0, d));
          gl_FragColor = vec4(c*0.75*a, a*0.85); }`,
    }), 5);
    this.rSmoke = pts(700, new THREE.ShaderMaterial({
      uniforms: { uTime: this.uniforms.uTime, uScale: scaleU, uWind: this.windU }, transparent: true, depthWrite: false,
      vertexShader: /* glsl */ `#include <common>
#include <logdepthbuf_pars_vertex>
attribute float aSeed; uniform float uTime, uScale; uniform vec2 uWind; varying float vL; varying float vNear;
        void main(){ float L = fract(uTime*0.022 + aSeed*13.7); vL = L; vec3 p = position;
          // a column that rises ~2.5 km and bends downwind (uWind: direction × strength)
          p += vec3(uWind.x * L*L*5200.0 + sin(aSeed*40.)*180., L*2500.0, uWind.y * L*L*5200.0 + cos(aSeed*30.)*180.);
          vec4 mv = modelViewMatrix*vec4(p,1.); gl_Position = projectionMatrix*mv;
          gl_PointSize = clamp((260.0 + L*1500.0) * uScale / -mv.z, 2., 520.);
          vNear = smoothstep(1500.0, 6000.0, -mv.z);   // thin out the columns the camera is in or next to
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: /* glsl */ `#include <logdepthbuf_pars_fragment>
varying float vL; varying float vNear;
        void main(){
          #include <logdepthbuf_fragment>
          vec2 uv = gl_PointCoord*2.-1.; float d = length(uv);
          float a = smoothstep(1., .15, d) * smoothstep(0., .1, vL) * (1.-vL) * 0.20 * vNear;
          vec3 c = mix(vec3(.26,.23,.21), vec3(.72,.70,.67), vL); gl_FragColor = vec4(c, a); }`,
    }), 6);
    (this.rFlames.material as THREE.ShaderMaterial).userData.scaleU = scaleU;
    this.updatePointUniforms();
  }

  /** FIRMS detections as ground sprites the size of the satellite pixel, shown for 12 h after their pass. */
  private buildFirms() {
    if (this.firms) { this.scene.remove(this.firms); this.firms.geometry.dispose(); this.firms = undefined; }
    const hs = this.hotspots.filter((h) => h.properties.kind === 'satellite_firms');
    if (!hs.length || !this.frame || !this.progT0) return;
    const pos = new Float32Array(hs.length * 3), at = new Float32Array(hs.length), frp = new Float32Array(hs.length), rad = new Float32Array(hs.length);
    hs.forEach((h, i) => {
      const p = this.worldAt(h.geometry.coordinates[0], h.geometry.coordinates[1], 25);
      pos.set([p.x, p.y, p.z], i * 3);
      at[i] = (Date.parse(h.properties.timestamp) - this.progT0) / 3.6e6;
      frp[i] = h.properties.frp_mw ?? 0; rad[i] = h.properties.radius_m ?? 200;
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aT', new THREE.BufferAttribute(at, 1));
    g.setAttribute('aFrp', new THREE.BufferAttribute(frp, 1));
    g.setAttribute('aR', new THREE.BufferAttribute(rad, 1));
    const scaleU = (this.rFlames?.material as THREE.ShaderMaterial | undefined)?.userData.scaleU ?? { value: 1 };
    this.firms = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: { uArrT: this.uniforms.uArrT, uScale: scaleU }, transparent: true, depthWrite: false,
      vertexShader: /* glsl */ `#include <common>
#include <logdepthbuf_pars_vertex>
attribute float aT, aFrp, aR; uniform float uArrT, uScale; varying float vA; varying float vHot;
        void main(){ float age = uArrT - aT; vA = step(0.0, age) * (1.0 - smoothstep(0.0, 12.0, age)); vHot = clamp(log(1.0 + aFrp) / 6.0, 0.0, 1.0);
          vec4 mv = modelViewMatrix*vec4(position,1.); gl_Position = projectionMatrix*mv;
          gl_PointSize = vA > 0.0 ? clamp(1.1 * aR * uScale / -mv.z, 3.0, 34.0) : 0.0;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: /* glsl */ `#include <logdepthbuf_pars_fragment>
varying float vA; varying float vHot;
        void main(){
          #include <logdepthbuf_fragment>
          vec2 uv = gl_PointCoord*2.-1.; float d = length(uv); if (d > 1.0 || vA <= 0.0) discard;
          float ring = smoothstep(0.72, 0.82, d) * (1.0 - smoothstep(0.9, 1.0, d));
          float core = smoothstep(0.45, 0.0, d);
          vec3 c = mix(vec3(1.0,0.80,0.25), vec3(1.0,0.25,0.08), vHot);
          gl_FragColor = vec4(c, (ring*0.55 + core*0.9) * vA); }`,
    }));
    this.firms.frustumCulled = false;
    this.firms.renderOrder = 8;
    this.firms.visible = this.layers.hotspots;
    this.scene.add(this.firms);
  }

  /** Wind for the smoke columns: direction it blows FROM (deg) and speed (km/h). */
  setWind(fromDeg: number | null, kmh: number | null) {
    if (fromDeg == null || kmh == null) return;
    const to = THREE.MathUtils.degToRad(fromDeg + 180), k = Math.min(1.4, 0.15 + kmh / 30);
    this.windU.value.set(Math.sin(to) * k, -Math.cos(to) * k);
  }

  /** Regional: load the reconstructed arrival-time field (arrival.png) and the burn severity. */
  async setProgression(p: Progression, url: string) {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('arrival field unavailable: ' + url)); im.src = url; });
    const W = p.width, H = p.height, c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, W, H).data;
    const n = W * H, minutes = new Uint16Array(n), sev = new Uint8Array(n);
    const half = new Uint16Array(n), sevTex = new Uint8Array(n);
    const NEVER = THREE.DataUtils.toHalfFloat(60000);
    const count = new Uint32Array(65536);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const k = j * W + i, m = d[k * 4] * 256 + d[k * 4 + 1], cl = Math.round(d[k * 4 + 2] / 40);
      minutes[k] = m; sev[k] = cl;
      // texture rows run south → north (fsBoundsUv puts north at v = 1)
      const t = (H - 1 - j) * W + i;
      half[t] = m === p.never ? NEVER : THREE.DataUtils.toHalfFloat(m / 60);
      sevTex[t] = d[k * 4 + 2];
      if (m !== p.never) count[m]++;
    }
    // burned cells sorted by arrival (counting sort) — the front at any time is a contiguous slice
    const start = new Uint32Array(65536);
    let acc = 0;
    for (let m = 0; m < 65536; m++) { start[m] = acc; acc += count[m]; }
    const order = new Uint32Array(acc), sortedMin = new Uint16Array(acc);
    for (let k = 0; k < n; k++) { const m = minutes[k]; if (m === p.never) continue; const q = start[m]++; order[q] = k; sortedMin[q] = m; }
    const tex = new THREE.DataTexture(half, W, H, THREE.RedFormat, THREE.HalfFloatType);
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true;
    const st = new THREE.DataTexture(sevTex, W, H, THREE.RedFormat, THREE.UnsignedByteType);
    st.magFilter = THREE.NearestFilter; st.minFilter = THREE.NearestFilter; st.needsUpdate = true;
    const [w, s, e, nn] = p.bbox, [x0, z0] = toXZ(this.frame, w, nn), [x1, z1] = toXZ(this.frame, e, s);
    this.uniforms.uArr.value = tex; this.uniforms.uSev.value = st;
    this.uniforms.uArrBounds.value.set(x0, z0, x1, z1);
    this.uniforms.uArrOn.value = 1;
    this.prog = { p, W, H, minutes, sev, order, sortedMin, bucket: -1 };
    const sc = this.incident?.scenario;
    if (sc) this.loadScenarioField(url.replace(/[^/]*$/, sc.image), W, H).catch((e) => console.warn(e));
    this.buildFirms();
    this.updateRegionalFire(true);
    this.markActive();
  }

  /** The retrospective scenario's arrival field (same grid and encoding as arrival.png). */
  private async loadScenarioField(url: string, W: number, H: number) {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('scenario field unavailable: ' + url)); im.src = url; });
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d', { willReadFrequently: true })!; ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, W, H).data, half = new Uint16Array(W * H), NEVER = THREE.DataUtils.toHalfFloat(60000), nv = this.prog?.p.never ?? 65535;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const k = j * W + i, m = d[k * 4] * 256 + d[k * 4 + 1]; half[(H - 1 - j) * W + i] = m === nv ? NEVER : THREE.DataUtils.toHalfFloat(m / 60); }
    const tex = new THREE.DataTexture(half, W, H, THREE.RedFormat, THREE.HalfFloatType);
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true;
    this.uniforms.uSim.value = tex;
    this.uniforms.uSimOn.value = this.layers.projection ? 1 : 0;
    this.markActive();
  }

  /** Arrival (ms, null = did not burn) and severity class at a lon/lat. */
  progressionAt(lon: number, lat: number): { arrival: number | null; severity: number } | null {
    const g = this.prog;
    if (!g) return null;
    const [w, s, e, n] = g.p.bbox, i = Math.floor(((lon - w) / (e - w)) * g.W), j = Math.floor(((n - lat) / (n - s)) * g.H);
    if (i < 0 || j < 0 || i >= g.W || j >= g.H) return null;
    const m = g.minutes[j * g.W + i];
    return { arrival: m === g.p.never ? null : this.progT0 + m * 60000, severity: g.sev[j * g.W + i] };
  }

  /** Re-seed the flames on the cells reached in the last 3 h and smoke on the last 2 h (every 10 min of fire time). */
  private updateRegionalFire(force = false) {
    const g = this.prog;
    if (!g || !this.rFlames || !this.rSmoke) return;
    const mNow = (this.time - this.progT0) / 60000, bucket = Math.floor(mNow / 10);
    if (!force && bucket === g.bucket) return;
    g.bucket = bucket;
    const lower = (v: number) => { let lo = 0, hi = g.sortedMin.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (g.sortedMin[mid] < v) lo = mid + 1; else hi = mid; } return lo; };
    const iNow = lower(mNow + 0.001);
    const [w, s, e, n] = g.p.bbox, dLon = (e - w) / g.W, dLat = (n - s) / g.H, rnd = mulberry32(bucket * 31 + 7);
    const fill = (pts: THREE.Points, from: number, up: number) => {
      const pa = pts.geometry.attributes.position as THREE.BufferAttribute, sa = pts.geometry.attributes.aSeed as THREE.BufferAttribute;
      const span = iNow - from, cap = pa.count, step = Math.max(1, span / cap);
      let c = 0;
      for (let q = from; q < iNow && c < cap; q += step) {
        const k = g.order[Math.floor(q)], i = k % g.W, j = Math.floor(k / g.W);
        const [x, z] = toXZ(this.frame, w + (i + rnd()) * dLon, n - (j + rnd()) * dLat);
        pa.setXYZ(c, x, this.groundY(x, z) + up, z); sa.setX(c, rnd()); c++;
      }
      pa.needsUpdate = sa.needsUpdate = true;
      pts.geometry.setDrawRange(0, c);
    };
    fill(this.rFlames, lower(mNow - 180), 0);
    fill(this.rSmoke, lower(mNow - 120), 60);
  }

  /* -------------------------------------------------------------- trees */

  private treeCache: { lon: number; lat: number; h: number; r: number; c: THREE.Color }[] = [];
  private placeTrees(img: HTMLCanvasElement) {
    const S = 1024;
    const c = document.createElement('canvas'); c.width = c.height = S;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, S, S);
    const d = ctx.getImageData(0, 0, S, S).data;
    const rnd = mulberry32(42);
    const [w, s, e, n] = this.innerBBox;
    this.treeCache = [];
    for (let k = 0; k < 260000 && this.treeCache.length < 16000; k++) {
      const u = rnd(), v = rnd(), i = ((Math.floor(v * S) * S + Math.floor(u * S)) * 4);
      const r = d[i], g = d[i + 1], b = d[i + 2], exg = 2 * g - r - b, lum = (r + g + b) / 3;
      if (exg < 14 || lum > 120 || rnd() > 0.55) continue;
      const big = lum < 70 ? 1 : 0.6;
      const h = (3.5 + rnd() * 6) * big;
      this.treeCache.push({ lon: w + u * (e - w), lat: n - v * (n - s), h, r: h * (0.32 + rnd() * 0.08), c: new THREE.Color().setHSL(0.24 + rnd() * 0.06, 0.38 + rnd() * 0.2, 0.13 + rnd() * 0.08) });
    }
    this.placeTreesFromCache();
  }

  private placeTreesFromCache() {
    this.shadowDirty = 3;
    if (this.trees) { this.scene.remove(this.trees); this.trees.geometry.dispose(); }
    const geo = new THREE.ConeGeometry(1, 1, 6, 1);
    geo.translate(0, 0.5, 0);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true });
    const u = this.uniforms;
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, { uMask: u.uMask, uMaskBounds: u.uMaskBounds, uBurnOp: u.uBurnOp, uMapStyle: u.uMapStyle });
      sh.vertexShader = sh.vertexShader.replace('void main() {', 'varying vec2 vBase;\nvoid main() {')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n vBase = (modelMatrix * instanceMatrix * vec4(0.,0.,0.,1.)).xz;');
      sh.fragmentShader = sh.fragmentShader.replace('void main() {', `varying vec2 vBase; uniform sampler2D uMask; uniform vec4 uMaskBounds; uniform float uBurnOp;\n${NOISE_GLSL}\nvoid main() {`)
        .replace('#include <color_fragment>', '#include <color_fragment>\n vec2 tuv = fsBoundsUv(vBase, uMaskBounds); if (fsInside(tuv) > 0.) { float b = texture2D(uMask, tuv).r * uBurnOp; diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.02,0.015,0.012), b); }');
    };
    const mesh = new THREE.InstancedMesh(geo, mat, this.treeCache.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    this.treeCache.forEach((t, i) => {
      const p = this.worldAt(t.lon, t.lat, -0.3);
      m.compose(p, q, new THREE.Vector3(t.r, t.h, t.r));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, t.c);
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.trees = mesh;
    mesh.visible = this.layers.trees && !this.mode2D;
    this.scene.add(mesh);
  }

  /* -------------------------------------------------------------- drone */

  private buildDrone(src: VideoSource) {
    if (this.drone) this.scene.remove(this.drone);
    if (this.frustum) this.scene.remove(this.frustum);
    const pose = src.pose;
    if (!pose) return;
    const g = new THREE.Group();
    const S = 2.2; // drawn ~6x real size so it reads at incident scale
    const white = new THREE.MeshStandardMaterial({ color: '#f4f2ee', roughness: 0.4 });
    const dark = new THREE.MeshStandardMaterial({ color: '#2a2a2a', roughness: 0.6 });
    const red = new THREE.MeshStandardMaterial({ color: '#d4372a', emissive: '#d4372a', emissiveIntensity: 0.6 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.9 * S, 0.35 * S, 1.2 * S), white);
    g.add(body);
    this.rotors = [];
    for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12 * S, 0.1 * S, 1.3 * S), white);
      arm.position.set(sx * 0.55 * S, 0, sz * 0.55 * S); arm.rotation.y = Math.atan2(sx, sz); g.add(arm);
      const rotor = new THREE.Mesh(new THREE.CylinderGeometry(0.55 * S, 0.55 * S, 0.02 * S, 16), new THREE.MeshBasicMaterial({ color: '#999', transparent: true, opacity: 0.35 }));
      rotor.position.set(sx * 0.95 * S, 0.2 * S, sz * 0.95 * S); g.add(rotor); this.rotors.push(rotor);
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.09 * S), sz > 0 ? red : new THREE.MeshBasicMaterial({ color: '#4ade80' }));
      led.position.set(sx * 0.95 * S, -0.1 * S, sz * 0.95 * S); g.add(led);
    }
    const cam = new THREE.Mesh(new THREE.SphereGeometry(0.22 * S, 12, 8), dark);
    cam.position.set(0, -0.3 * S, -0.45 * S); g.add(cam);
    const [lon, lat] = pose.position;
    const pos = this.worldAt(lon, lat, (pose.altitude_agl_m ?? 25) * this.exaggeration);
    g.position.copy(pos);
    g.rotation.y = -THREE.MathUtils.degToRad(pose.yaw_deg ?? 0);
    g.traverse((o) => { o.castShadow = true; });
    g.userData.sourceId = src.id;
    this.drone = g;
    this.scene.add(g);

    // frustum from camera to footprint corners
    const fp = src.footprint?.geometry.coordinates[0];
    if (fp) {
      const corners = fp.slice(0, 4).map((c) => this.worldAt(c[0], c[1], 0.3));
      const arr: number[] = [];
      for (const c of corners) arr.push(pos.x, pos.y - 0.5, pos.z, c.x, c.y, c.z);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      this.frustum = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55 }));
      this.frustum.visible = this.layers.footprint;
      this.scene.add(this.frustum);
    }
    this.addLabel('drone_' + src.id, `<div class="lbl-drone"><span class="dot"></span>${src.label} <b>${Math.round(pose.altitude_agl_m ?? 0)} m</b></div>`, pos.clone().add(new THREE.Vector3(0, 6, 0)), () => this.cb.onDroneClick?.(src.id));
  }

  /* ---------------------------------------------- simulated large fire */

  /** Huygens-style arrival times on the real DEM: elliptical wind enhancement + slope factor, Dijkstra on a 16-neighbour grid.
   *  Assumptions (shown in the UI): uniform fuel, constant scenario wind, no suppression. Purely illustrative. */
  setScenario(on: boolean, opts: { windFromDeg?: number; windKmh?: number } = {}) {
    if (this.regional) on = false;   // a real large fire is on screen: the illustrative scenario does not apply
    this.scenarioInfo.on = on;
    this.uniforms.uScenOn.value = on ? 1 : 0;
    if (on && !this.scen) {
      if (this.rings.length < 2) { this.uniforms.uScenOn.value = 0; this.ringsReady.then(() => { if (this.scenarioInfo.on) this.setScenario(true, opts); }); return; }   // needs the outer terrain
      this.buildScenario(opts.windFromDeg ?? 225, opts.windKmh ?? 30);
    }
    if (this.sFlames) this.sFlames.visible = on;
    if (this.sSmoke) this.sSmoke.visible = on && this.layers.smoke;
    this.updateScenario(true);
  }

  private buildScenario(windFromDeg: number, windKmh: number) {
    const N = 300, half = 4200, cell = (2 * half) / N;
    const f = this.focusPoint();
    const x0 = f.x - half, z0 = f.z - half;
    const H = new Float32Array((N + 1) * (N + 1));
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) H[j * (N + 1) + i] = this.elevationAt(x0 + i * cell, z0 + j * cell);
    const to = THREE.MathUtils.degToRad(windFromDeg + 180);           // direction the fire is pushed toward
    const wx = Math.sin(to), wz = -Math.cos(to), U = windKmh / 30;
    const R0 = 0.28;                                                    // m/s backing/flank base rate
    const T = new Float64Array((N + 1) * (N + 1)).fill(Infinity);
    const done = new Uint8Array((N + 1) * (N + 1));
    const nb: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1], [2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2]];
    // binary heap
    const heap: number[] = [], push = (k: number) => { heap.push(k); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (T[heap[p]] <= T[heap[i]]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop()!; if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && T[heap[l]] < T[heap[m]]) m = l; if (r < heap.length && T[heap[r]] < T[heap[m]]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    const ci = Math.round(N / 2), seed = ci * (N + 1) + ci;
    T[seed] = 0; push(seed);
    while (heap.length) {
      const k = pop();
      if (done[k]) continue;
      done[k] = 1;
      const i = k % (N + 1), j = (k / (N + 1)) | 0, tk = T[k];
      for (const [di, dj] of nb) {
        const a = i + di, b = j + dj;
        if (a < 0 || b < 0 || a > N || b > N) continue;
        const kk = b * (N + 1) + a, d = Math.hypot(di, dj) * cell, ux = di * cell / d, uz = dj * cell / d;
        const cosw = ux * wx + uz * wz;
        const ell = 1 + 4.2 * U * Math.max(0, cosw) ** 1.6 - 0.35 * Math.max(0, -cosw);   // elongated head, slower back
        const slope = (H[kk] - H[k]) / d;                                                // +upslope
        const sf = Math.min(4, Math.max(0.35, Math.exp(3.2 * slope)));
        const R = R0 * Math.max(0.25, ell) * sf * fuelJS(a, b);                                 // smooth fuel heterogeneity (illustrative)
        const nt = tk + d / R;
        if (!done[kk] && nt < T[kk] - 1e-9) { T[kk] = nt; push(kk); }
      }
    }
    const sorted = Array.from(T).filter(isFinite).sort((p, q) => p - q);
    const tMaxS = sorted[Math.floor(sorted.length * 0.62)];             // scenario clock ends when ~62 % of the box burned
    const arr = new Uint8Array((N + 1) * (N + 1));
    for (let k = 0; k < arr.length; k++) arr[k] = Math.min(255, Math.round((T[k] / tMaxS) * 254));
    // texture rows: row 0 = north (min z) → same convention as the other overlays (flipY false: we write north first at v=1)
    const tex = new THREE.DataTexture(arr, N + 1, N + 1, THREE.RedFormat, THREE.UnsignedByteType);
    tex.flipY = false; tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true;
    // fsBoundsUv flips v (1 = north). DataTexture row 0 maps to v = 0 → store south first:
    const flipped = new Uint8Array(arr.length);
    for (let j = 0; j <= N; j++) flipped.set(arr.subarray(j * (N + 1), (j + 1) * (N + 1)), (N - j) * (N + 1));
    tex.image.data = flipped;
    this.uniforms.uScen.value = tex;
    this.uniforms.uScenBounds.value.set(x0, z0, x0 + 2 * half, z0 + 2 * half);
    this.scen = { N, arr, cell, tMaxS, bucket: -1 };
    // big-scale flames + smoke for the scenario front
    if (this.flames && this.smoke) {
      const mk = (src: THREE.Points, cap: number, size: number) => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cap * 3), 3));
        g.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(cap), 1));
        g.setDrawRange(0, 0);
        const m = (src.material as THREE.ShaderMaterial).clone();
        m.uniforms.uTime = this.uniforms.uTime; m.uniforms.uScale = (src.material as THREE.ShaderMaterial).uniforms.uScale;
        if (m.uniforms.uSize) m.uniforms.uSize = { value: size };
        const pts = new THREE.Points(g, m); pts.frustumCulled = false; pts.renderOrder = src.renderOrder; this.scene.add(pts); return pts;
      };
      this.sFlames = mk(this.flames, 4000, 22);
      this.sSmoke = mk(this.smoke, 700, 1);
      this.sSmoke.scale.setScalar(1);
    }
  }

  private updateScenario(force = false) {
    const sc = this.scen;
    if (!sc || !this.scenarioInfo.on) return;
    const span = Math.max(1, this.simCtx ? this.simCtx.t1 - this.simCtx.t0 : 1);
    const T = Math.min(1, Math.max(0, (this.time - (this.simCtx?.t0 ?? this.time)) / span));
    this.uniforms.uScenT.value = T;
    const b = Math.round(T * 400);
    if (!force && b === sc.bucket) return;
    sc.bucket = b;
    const thr = Math.round(T * 254), band = 6;
    let burned = 0;
    const fp = this.sFlames!.geometry.attributes.position as THREE.BufferAttribute, fs = this.sFlames!.geometry.attributes.aSeed as THREE.BufferAttribute;
    const sp = this.sSmoke!.geometry.attributes.position as THREE.BufferAttribute, ss = this.sSmoke!.geometry.attributes.aSeed as THREE.BufferAttribute;
    const b4 = this.uniforms.uScenBounds.value, rnd = mulberry32(b + 7);
    const front: number[] = [];
    for (let k = 0; k < sc.arr.length; k++) { const a = sc.arr[k]; if (a < thr && a < 254) { burned++; if (a > thr - band) front.push(k); } }
    let nf = 0, ns = 0;
    const stepF = Math.max(1, front.length / fp.count), stepS = Math.max(1, front.length / sp.count);
    for (let q = 0; q < front.length && nf < fp.count; q += stepF) {
      const k = front[Math.floor(q)], i = k % (sc.N + 1), j = Math.floor(k / (sc.N + 1));
      const x = b4.x + (i + rnd() - 0.5) * sc.cell, z = b4.y + (j + rnd() - 0.5) * sc.cell;
      fp.setXYZ(nf, x, this.groundY(x, z) + 0.5, z); fs.setX(nf, rnd()); nf++;
    }
    for (let q = 0; q < front.length && ns < sp.count; q += stepS) {
      const k = front[Math.floor(q)], i = k % (sc.N + 1), j = Math.floor(k / (sc.N + 1));
      const x = b4.x + i * sc.cell, z = b4.y + j * sc.cell;
      sp.setXYZ(ns, x, this.groundY(x, z) + 4, z); ss.setX(ns, rnd()); ns++;
    }
    fp.needsUpdate = fs.needsUpdate = sp.needsUpdate = ss.needsUpdate = true;
    this.sFlames!.geometry.setDrawRange(0, nf);
    this.sSmoke!.geometry.setDrawRange(0, ns);
    this.scenarioInfo.ha = (burned * sc.cell * sc.cell) / 10000;
    this.scenarioInfo.hours = (T * sc.tMaxS) / 3600;
    this.scenarioInfo.lapse = sc.tMaxS / (span / 1000);   // the recording's timeline is replayed as a time-lapse of the scenario
    this.cb.onScenario?.({ ...this.scenarioInfo });
  }

  /* ------------------------------------------------- simulated operations */

  setSim(ctx: SimCtx) {
    this.simCtx = ctx;
    for (const { obj } of this.units.values()) this.scene.remove(obj);
    this.units.clear();
    this.removeLabels('unit_');
    // decal must also cover drop lines and the cell perimeter (already included) — nothing to extend
    for (const u of unitsFor(ctx)) {
      const obj = makeUnitMesh(u);
      obj.traverse((o) => { o.castShadow = true; });
      this.scene.add(obj);
      this.units.set(u.id, { u, obj });
      const lbl = `<div class="lbl-unit g-${u.group}"><b>${u.id}</b><span>${u.group === 'drones' ? u.name : u.type}</span></div>`;
      this.addLabel('unit_' + u.id, lbl, new THREE.Vector3(), () => this.cb.onUnitClick?.(u.id));
    }
    this.setOpsMode(this.opsMode);
  }

  setOpsMode(m: 'incident' | 'drones' | 'resources') {
    this.opsMode = m;
    this.shadowDirty = 3;
    for (const { u, obj } of this.units.values()) {
      const vis = (m === 'drones' && u.group === 'drones') || (m === 'resources' && u.group !== 'drones');
      obj.visible = vis;
      const l = this.labels.get('unit_' + u.id);
      if (l) l.el.style.display = vis ? '' : 'none';
    }
    this.drawnKey = '';
    this.redrawOverlays();
  }

  setSelectedUnit(id: string | null) {
    this.selectedUnit = id;
    for (const [lid, l] of this.labels) if (lid.startsWith('unit_')) { l.el.classList.toggle('sel', lid === 'unit_' + id); delete l.el.dataset.w; }
  }

  get selectedUnitId() { return this.selectedUnit; }
  setFollow(f: { id: string; mode: 'chase' | 'overview' | 'ride' } | null) { this.follow = f; this.anim = undefined; }

  unitWorld(id: string): THREE.Vector3 | null { return this.units.get(id)?.obj.position.clone() ?? null; }
  flyToUnit(id: string, dist = 260) { const p = this.unitWorld(id); if (p) this.flyTo(p, dist * (this.regional ? 30 : 1)); }

  private updateUnits(dt: number) {
    if (!this.simCtx || !this.frame) return;
    for (const { u, obj } of this.units.values()) {
      if (!obj.visible && !(this.follow?.id === u.id)) continue;
      const st = unitState(u, this.time, this.simCtx);
      const [x, z] = toXZ(this.frame, st.lon, st.lat);
      const gy = this.groundY(x, z);
      obj.position.set(x, gy + st.agl * this.exaggeration + (u.group === 'drones' || u.group === 'aircraft' ? 2 : 0.6), z);
      obj.rotation.y = -THREE.MathUtils.degToRad(st.heading);
      if (u.kind === 'helicopter' || u.kind === 'drone') obj.children.forEach((ch) => { if (ch.userData.rotor) ch.rotation.y += dt * 30; });
      obj.userData.hidden = !st.visible;
      if (obj.visible) obj.scale.setScalar(st.visible ? 1 : 0.001);
      const l = this.labels.get('unit_' + u.id);
      if (l) { l.pos.copy(obj.position).add(new THREE.Vector3(0, (u.group === 'aircraft' ? 22 : u.group === 'drones' ? 6 : 9) * (this.regional ? 6 : 1), 0)); }
    }
    if (this.follow) {
      const o = this.units.get(this.follow.id)?.obj ?? (this.drone && this.follow.id === 'UAV-01' ? this.drone : undefined);
      if (o) {
        const h = -o.rotation.y, f = new THREE.Vector3(Math.sin(h), 0, -Math.cos(h));
        const air = (this.units.get(this.follow.id)?.u.group ?? 'aircraft') === 'aircraft';
        let pos: THREE.Vector3, tgt: THREE.Vector3;
        if (this.follow.mode === 'overview') { pos = o.position.clone().add(f.clone().multiplyScalar(-520)).add(new THREE.Vector3(0, 380, 0)); tgt = o.position.clone(); }
        else if (this.follow.mode === 'ride') { pos = o.position.clone().add(f.clone().multiplyScalar(-22)).add(new THREE.Vector3(0, 9, 0)); tgt = o.position.clone().add(f.clone().multiplyScalar(40)); }
        else { pos = o.position.clone().add(f.clone().multiplyScalar(air ? -190 : -30)).add(new THREE.Vector3(0, air ? 48 : 12, 0)); tgt = o.position.clone().add(f.clone().multiplyScalar(air ? 260 : 30)).add(new THREE.Vector3(0, air ? -40 : 0, 0)); }
        const gy = this.groundY(pos.x, pos.z) + 4;
        if (pos.y < gy) pos.y = gy;                                    // never clip into terrain
        const k = Math.min(1, dt * 3.5);
        this.camera.position.lerp(pos, k);
        this.controls.target.lerp(tgt, Math.min(1, dt * 5));
      }
    }
  }

  /** Render the 3D twin from a simulated drone's camera (EO view) into pixels for its PiP. The GPU→CPU copy is
   *  asynchronous (WebGL2 pixel buffer + fence), so it no longer stalls the main thread. */
  async renderUnitView(id: string, w: number, h: number): Promise<ImageData | null> {
    const o = this.units.get(id)?.obj;
    if (!o || !this.ready) return null;
    if (!this.viewRT || this.viewRT.width !== w || this.viewRT.height !== h) { this.viewRT?.dispose(); this.viewRT = new THREE.WebGLRenderTarget(w, h, { samples: 4 }); }
    const hd = -o.rotation.y, f = new THREE.Vector3(Math.sin(hd), 0, -Math.cos(hd));
    // gimbal: look at the fire front if it is near, otherwise 35° down along the heading
    const fire = this.fireFocus(), toFire = fire.clone().sub(o.position);
    const look = toFire.length() < 450 * this.k ? fire : o.position.clone().add(f.multiplyScalar(120 * this.k)).add(new THREE.Vector3(0, -85 * this.k, 0));
    this.viewCam.aspect = w / h; this.viewCam.updateProjectionMatrix();
    this.viewCam.position.copy(o.position).add(new THREE.Vector3(0, -1, 0));
    this.viewCam.lookAt(look);
    const was = o.visible; o.visible = false;
    this.renderer.setRenderTarget(this.viewRT);
    this.renderer.render(this.scene, this.viewCam);
    this.renderer.setRenderTarget(null);
    o.visible = was;
    const buf = new Uint8Array(w * h * 4);
    await this.renderer.readRenderTargetPixelsAsync(this.viewRT, 0, 0, w, h, buf);
    const img = new ImageData(w, h);
    for (let y = 0; y < h; y++) {
      const src = (h - 1 - y) * w * 4, dst = y * w * 4;
      for (let x = 0; x < w * 4; x += 4) { img.data[dst + x] = SRGB[buf[src + x]]; img.data[dst + x + 1] = SRGB[buf[src + x + 1]]; img.data[dst + x + 2] = SRGB[buf[src + x + 2]]; img.data[dst + x + 3] = 255; }
    }
    return img;
  }

  /* ------------------------------------------------------------- labels */

  addLabel(id: string, html: string, pos: THREE.Vector3, onClick?: () => void) {
    this.labels.get(id)?.el.remove();
    const el = document.createElement('div');
    el.className = 'scene-label';
    el.style.visibility = 'hidden';   // until the next frame positions it (otherwise it flashes at the top-left corner)
    el.innerHTML = html;
    if (onClick) { el.style.pointerEvents = 'auto'; el.style.cursor = 'pointer'; el.addEventListener('click', (e) => { e.stopPropagation(); onClick(); }); }
    this.labelRoot.appendChild(el);
    this.labels.set(id, { el, pos });
  }
  removeLabels(prefix: string) { for (const [id, l] of this.labels) if (id.startsWith(prefix)) { l.el.remove(); this.labels.delete(id); } }

  private rebuildEventLabels() {
    this.removeLabels('ev_');
    for (const e of this.events) {
      if (!e.location) continue;
      const iso = new Date(e.timestamp).toISOString(), time = this.regional ? `${MON[+iso.slice(5, 7) - 1]} ${+iso.slice(8, 10)} ${iso.slice(11, 16)}` : iso.slice(11, 19);
      const cls = e.severity === 'alert' ? 'alert' : e.severity === 'watch' ? 'watch' : 'info';
      this.addLabel('ev_' + e.event_id, `<div class="lbl-event ${cls}"><span class="ring"></span><span class="txt"><b>${time}</b><span class="full">${e.title}</span></span></div>`, this.worldAt(e.location[0], e.location[1], 0.5), () => this.cb.onEventClick?.(e.event_id));
    }
    this.drawnKey = '';
    this.redrawOverlays();
  }

  private hsShown = '';
  private updateHotspotLabels(t: number) {
    if (!this.ready) return;
    // show RGB-flame hotspots of the current frame as small pulsing dots
    const cur = this.latestAt(this.hotspots, t);
    const ts = cur?.properties.timestamp ?? '';
    if (ts === this.hsShown) return;
    this.hsShown = ts;
    this.removeLabels('hs_');
    if (!cur) return;
    for (const h of this.hotspots) if (h.properties.timestamp === ts) {
      const [lon, lat] = h.geometry.coordinates;
      this.addLabel('hs_' + h.properties.id, '<div class="lbl-hotspot"></div>', this.worldAt(lon, lat, 0.4));
      const l = this.labels.get('hs_' + h.properties.id)!;
      l.el.style.display = this.layers.hotspots ? '' : 'none';
    }
  }

  private v = new THREE.Vector3();
  /** Map-pane UI that labels must never sit under: drone camera window, map controls, attribution, compass, banners. */
  private reserved: number[][] = [];
  private reservedAt = 0;
  private refreshReserved() {
    const now = performance.now();
    if (now - this.reservedAt < 250) return;
    this.reservedAt = now;
    const map = this.container.parentElement, c = this.container.getBoundingClientRect();
    if (!map) return;
    this.reserved = [...map.querySelectorAll<HTMLElement>(':scope > .feed, :scope > .mapctl, :scope > .attribution, :scope > .compass, :scope > .banner > *, :scope > .sheet, :scope > .drawer.open')]
      .map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0)
      .map((r) => [r.left - c.left - 4, r.top - c.top - 4, r.right - c.left + 4, r.bottom - c.top + 4]);
  }
  private updateLabels() {
    const w = this.vw, h = this.vh;
    this.refreshReserved();
    const hsPts: { el: HTMLElement; x: number; y: number }[] = [];
    const items: { el: HTMLElement; x: number; y: number; pri: number; kind: 'ev' | 'drone' | 'place' }[] = [];
    for (const [id, { el, pos }] of this.labels) {
      this.v.copy(pos).project(this.camera);
      if (this.v.z > 1 || this.v.z < -1) { el.style.visibility = 'hidden'; continue; }
      const x = ((this.v.x + 1) / 2) * w, y = ((1 - this.v.y) / 2) * h;
      if (x < -40 || x > w + 40 || y < -40 || y > h + 40) { el.style.visibility = 'hidden'; continue; }
      el.style.visibility = '';
      el.style.transform = `translate(${x}px, ${y}px)`;
      if (id.startsWith('hs_')) { hsPts.push({ el, x, y }); continue; }
      const c = el.firstElementChild as HTMLElement | null;
      const kind = id.startsWith('ev_') ? 'ev' : id.startsWith('drone_') || id.startsWith('unit_') ? 'drone' : 'place';
      if (id.startsWith('unit_') && el.style.display === 'none') continue;
      void c;
      // a selected unit outranks the selected event outside Incident mode, so the two never overlap
      const sel = el.classList.contains('sel'), selEv = sel && kind === 'ev';
      const pri = selEv ? (this.opsMode === 'incident' ? 4 : 3.4) : sel ? 4 : kind === 'ev' ? (el.classList.contains('future') ? 1 : 2) : id.startsWith('drone_') ? 3 : kind === 'drone' ? 2.5 : 0;
      items.push({ el, x, y, pri, kind });
    }
    // greedy collision manager: higher priority first, 6 px padding. Nothing may sit under the map UI (reserved),
    // event pins closer than 13 px merge into one pin with a count, and flame dots under a pin are hidden.
    items.sort((a, b) => b.pri - a.pri || a.y - b.y);
    const over = (a: number[], b: number[]) => !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
    const boxes: number[][] = [];
    const pins: { x: number; y: number; el: HTMLElement; n: number }[] = [];
    for (const it of items) {
      const c = it.el.firstElementChild as HTMLElement | null;
      // measure with the text visible once, then reuse (avoids flicker when the text is hidden)
      if (!it.el.dataset.w && c && !it.el.classList.contains('collide')) { it.el.dataset.w = String(c.offsetWidth); it.el.dataset.h = String(c.offsetHeight); }
      const bw = +(it.el.dataset.w ?? 80), bh = +(it.el.dataset.h ?? 20);
      const box = it.kind === 'drone' ? [it.x - bw / 2 - 6, it.y - bh - 6, it.x + bw / 2 + 6, it.y + 6] : [it.x - 10, it.y - bh / 2 - 6, it.x + bw + 6, it.y + bh / 2 + 6];
      if (it.kind === 'ev') {
        const ring = [it.x - 9, it.y - 9, it.x + 9, it.y + 9];
        const host = pins.find((p) => Math.hypot(p.x - it.x, p.y - it.y) < 16);
        // a pin that would sit on another pin, on a placed label or under the map UI folds into the nearest pin (count badge)
        if (host || this.reserved.some((r) => over(ring, r)) || (it.pri < 4 && boxes.some((b) => over(ring, b)))) {
          it.el.style.visibility = 'hidden'; it.el.classList.add('collide');
          const near = host ?? pins.reduce<typeof pins[number] | null>((a, p) => { const d = Math.hypot(p.x - it.x, p.y - it.y); return d < 40 && (!a || d < Math.hypot(a.x - it.x, a.y - it.y)) ? p : a; }, null);
          if (near) near.n++;
          continue;
        }
        pins.push({ x: it.x, y: it.y, el: it.el, n: 1 });
        // text to the right of the pin, or flipped to its left when the right side is taken
        const boxL = [it.x - bw - 6, box[1], it.x + 10, box[3]];
        const hitR = boxes.some((b) => over(box, b)) || this.reserved.some((r) => over(box, r));
        const hitL = boxes.some((b) => over(boxL, b)) || this.reserved.some((r) => over(boxL, r));
        const flip = hitR && !hitL, use = flip ? boxL : box;
        c?.classList.toggle('flip', flip);
        const collide = hitR && hitL && (it.pri < 4 || this.reserved.some((r) => over(use, r)));
        it.el.classList.toggle('collide', collide);
        boxes.push(collide ? ring : use);
      } else {
        const hit = this.reserved.some((r) => over(box, r)) || (it.pri < 3 && boxes.some((b) => over(box, b)));
        it.el.style.visibility = hit ? 'hidden' : '';
        if (!hit) boxes.push(box);
      }
    }
    const dots: { x: number; y: number }[] = [];
    for (const d of hsPts) {
      const inside = (r: number[]) => d.x > r[0] - 4 && d.x < r[2] + 4 && d.y > r[1] - 4 && d.y < r[3] + 4;
      const hide = pins.some((p) => Math.hypot(p.x - d.x, p.y - d.y) < 14) || dots.some((q) => Math.hypot(q.x - d.x, q.y - d.y) < 14) || this.reserved.some(inside) || boxes.some(inside);
      if (hide) d.el.style.visibility = 'hidden'; else dots.push(d);
    }
  }

  /* ------------------------------------------------------------- camera */

  /** Horizontal unit vector the drone camera looks along (world space). */
  private viewDir() {
    // regional: from the south-south-west, looking up-valley the way the fire ran (north)
    const yaw = THREE.MathUtils.degToRad(this.source?.pose?.yaw_deg ?? (this.regional ? 12 : -45));
    return new THREE.Vector3(Math.sin(yaw), 0, -Math.cos(yaw));
  }
  private homeOffset() {
    // regional: tall (portrait) screens step back so the whole scar still fits across
    const k = this.regional ? 230 * Math.max(1, Math.min(2.2, 1.25 / (this.camera.aspect || 1))) : 1;
    return this.viewDir().multiplyScalar(-118 * k).add(new THREE.Vector3(0, (this.regional ? 62 : 34) * k, 0)).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.regional ? 0.12 : 0.38);
  }

  private setInitialCamera() {
    const t = this.focusPoint();
    const p = t.clone().add(this.homeOffset());
    this.camera.position.copy(p);
    this.controls.target.copy(t);
    this.defaultDist = p.distanceTo(t);
    this.controls.update();
  }

  /** Establishing shot over the whole burn cell, then glide down to the drone's fire front (like the reference's fly-ins). */
  private intro() {
    const t = this.focusPoint();
    const k = this.regional ? 120 : 1;
    const wide = this.homeOffset().setLength(780 * k).setY(420 * k);
    this.camera.position.copy(t.clone().add(wide.applyAxisAngle(new THREE.Vector3(0, 1, 0), -0.5)));
    this.controls.target.copy(t.clone().add(this.viewDir().multiplyScalar(160 * k)));
    this.controls.update();
    setTimeout(() => this.flyTo(t, undefined, 3600, this.homeOffset()), 700);
  }

  /** Where the fire is now: the observed fire zone (drone view), or the reconstructed front at the current time (regional). */
  fireFocus() {
    if (this.regional && this.simCtx?.regional) { const f = frontAt(this.simCtx, this.time); return this.worldAt(f.c[0], f.c[1]); }
    return this.focusPoint();
  }

  focusPoint() {
    const b = this.maskBounds;
    const x = (b.x + b.z) / 2, z = (b.y + b.w) / 2;
    return new THREE.Vector3(x, this.groundY(x, z), z);
  }

  private reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  flyTo(target: THREE.Vector3, dist?: number, dur = 1400, dirOverride?: THREE.Vector3) {
    if (this.reduceMotion) dur = Math.min(dur, 1);   // jump instead of flying
    const offs = dirOverride ?? this.camera.position.clone().sub(this.controls.target);
    if (dist) offs.setLength(dist);
    this.anim = { t0: performance.now(), dur, from: { p: this.camera.position.clone(), t: this.controls.target.clone() }, to: { p: target.clone().add(offs), t: target.clone() } };
  }
  /** `dist` is in drone-view metres; a regional fire scales it up (an event there is km wide, not metres). */
  flyToLonLat(lon: number, lat: number, dist = 110) { this.flyTo(this.worldAt(lon, lat), dist * (this.regional ? 110 : 1)); }
  /** Camera position + target (world metres), for shareable links. */
  cameraState() { const p = this.camera.position, t = this.controls.target; return [p.x, p.y, p.z, t.x, t.y, t.z].map((v) => Math.round(v * 10) / 10); }
  setCameraState(v: number[], ms = 0) {
    if (v.length !== 6 || v.some((n) => !isFinite(n))) return;
    const t = new THREE.Vector3(v[3], v[4], v[5]);
    this.flyTo(t, undefined, Math.max(1, ms), new THREE.Vector3(v[0], v[1], v[2]).sub(t));
  }
  /** Wide shot that shows the whole simulated large-fire box. */
  frameScenario(ms = 2800) { this.controls.autoRotate = false; this.flyTo(this.focusPoint(), undefined, ms, new THREE.Vector3(-3600, 1650, 2600)); }
  /** Fly so that a unit and the observed fire are both in view. `leftShare` < 1 keeps them in the left part of the
   *  map (e.g. 0.52 when the drone camera window covers the right half). */
  flyToUnitAndFire(id: string, minDist = 220, leftShare = 1) {
    const p = this.unitWorld(id); if (!p) return;
    const f = this.fireFocus(), mid = p.clone().add(f).multiplyScalar(0.5), sep = p.distanceTo(f);
    const kk = this.regional ? 40 : 1;
    const dist = THREE.MathUtils.clamp((sep * 1.6 + 120 * kk) / Math.max(0.4, leftShare), minDist * kk, 3000 * kk);
    const dir = this.camera.position.clone().sub(this.controls.target).setY(0);
    if (dir.lengthSq() < 1) dir.copy(this.viewDir()).multiplyScalar(-1);
    const e = THREE.MathUtils.degToRad(34);
    const off = dir.normalize().multiplyScalar(Math.cos(e) * dist).add(new THREE.Vector3(0, Math.sin(e) * dist, 0));
    if (leftShare < 1) {   // slide the view so the subject's centre lands in the middle of the visible left part
      const right = off.clone().negate().normalize().cross(new THREE.Vector3(0, 1, 0)).normalize();
      const halfW = dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * this.camera.aspect;
      mid.add(right.multiplyScalar(halfW * (1 - leftShare)));
    }
    this.flyTo(mid, undefined, 1600, off);
  }
  flyHome() { this.flyTo(this.focusPoint(), undefined, 1400, this.homeOffset()); }
  /** Cinematic framing of the fire zone: distance (m), elevation angle (deg), azimuth offset from the drone's view (rad). */
  flyFrame(dist = 260, elevDeg = 30, az = 0.45, ms = 2600) {
    const e = THREE.MathUtils.degToRad(elevDeg), v = this.viewDir().multiplyScalar(-1).applyAxisAngle(new THREE.Vector3(0, 1, 0), az);
    const off = v.multiplyScalar(Math.cos(e) * dist).add(new THREE.Vector3(0, Math.sin(e) * dist, 0));
    this.controls.autoRotate = false;
    this.flyTo(this.focusPoint(), undefined, ms, off);
  }
  /** Screen-space box (container px) of the observed fire zone, for UI that must not cover it. */
  fireScreenBox(): { x0: number; y0: number; x1: number; y1: number } | null {
    if (!this.frame) return null;
    const b = this.maskBounds, w = this.vw, h = this.vh;
    const pts = [[b.x, b.y], [b.z, b.y], [b.x, b.w], [b.z, b.w], [(b.x + b.z) / 2, (b.y + b.w) / 2]];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, n = 0;
    for (const [x, z] of pts) {
      this.v.set(x, this.groundY(x, z) + 4, z).project(this.camera);
      if (this.v.z > 1) continue;
      const sx = ((this.v.x + 1) / 2) * w, sy = ((1 - this.v.y) / 2) * h; n++;
      x0 = Math.min(x0, sx); y0 = Math.min(y0, sy); x1 = Math.max(x1, sx); y1 = Math.max(y1, sy);
    }
    return n ? { x0, y0, x1, y1 } : null;
  }
  flyToDrone() {
    if (!this.drone) return;
    const v = this.viewDir();
    this.flyTo(this.drone.position.clone().add(v.clone().multiplyScalar(30)).setY(this.drone.position.y - 8), undefined, 1600, v.multiplyScalar(-62).add(new THREE.Vector3(0, 22, 0)));
  }
  resetNorth() {
    const t = this.controls.target, off = this.camera.position.clone().sub(t);
    const r = Math.hypot(off.x, off.z);
    this.flyTo(t, undefined, 900, new THREE.Vector3(0, off.y, r));
  }
  zoomBy(f: number) {
    const off = this.camera.position.clone().sub(this.controls.target).multiplyScalar(f);
    this.flyTo(this.controls.target.clone(), undefined, 400, off);
  }

  set2D(on: boolean) {
    this.shadowDirty = 3;
    this.mode2D = on;
    this.styleAnim = { from: this.uniforms.uMapStyle.value, to: on ? 1 : 0, t0: performance.now() };
    const t = this.controls.target.clone();
    const dist = this.camera.position.distanceTo(t);
    if (on) {
      this.controls.minPolarAngle = 0; this.controls.maxPolarAngle = 0.0001;
      this.flyTo(t, undefined, 1100, new THREE.Vector3(0, dist * 1.1, 0.01));
    } else {
      this.controls.maxPolarAngle = THREE.MathUtils.degToRad(84);
      const az = this.controls.getAzimuthalAngle();
      this.flyTo(t, undefined, 1100, new THREE.Vector3(Math.sin(az) * dist * 0.7, dist * 0.62, Math.cos(az) * dist * 0.7));
    }
    if (this.trees) this.trees.visible = this.layers.trees && !on;
    if (this.smoke) this.smoke.visible = this.layers.smoke && !on;
    if (this.flames) this.flames.visible = this.layers.active > 0.01 && !on;
    if (this.rFlames) this.rFlames.visible = this.layers.active > 0.01 && !on;
    if (this.rSmoke) this.rSmoke.visible = this.layers.smoke && this.layers.active > 0.01 && !on;
  }

  /* -------------------------------------------------------------- input */

  private onPointerMove = (e: PointerEvent) => {
    this.markActive();
    if (e.pointerType === 'touch') return;   // touch shows terrain info on tap instead (see onPointerUp)
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const now = performance.now();
    if (now - this.lastHover < 60 || !this.ready || e.buttons) return;
    this.lastHover = now;
    this.hoverAt(e);
  };
  /** Touch: a quick tap (no drag) shows the terrain info at that point for a few seconds. */
  private tapStart: { x: number; y: number; t: number } | null = null;
  private tapTimer = 0;
  private onPointerDown = (e: PointerEvent) => { if (e.pointerType === 'touch') this.tapStart = { x: e.clientX, y: e.clientY, t: performance.now() }; };
  private onPointerUp = (e: PointerEvent) => {
    const t = this.tapStart; this.tapStart = null;
    if (e.pointerType !== 'touch' || !t || !this.ready || Math.hypot(e.clientX - t.x, e.clientY - t.y) > 10 || performance.now() - t.t > 400) return;
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.hoverAt(e);
    clearTimeout(this.tapTimer);
    this.tapTimer = window.setTimeout(() => this.cb.onHover?.(null), 4500);
  };
  private hoverAt(e: { clientX: number; clientY: number }) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects([this.innerMesh!, ...this.rings].filter(Boolean), false)[0];
    if (!hit) { this.cb.onHover?.(null); return; }
    const { x, z } = hit.point;
    const [lon, lat] = toLonLat(this.frame, x, z);
    const d = this.regional ? 60 : 3, ex = (this.elevationAt(x + d, z) - this.elevationAt(x - d, z)) / (2 * d), nz = (this.elevationAt(x, z - d) - this.elevationAt(x, z + d)) / (2 * d);
    const slope = THREE.MathUtils.radToDeg(Math.atan(Math.hypot(ex, nz)));
    const aspect = (THREE.MathUtils.radToDeg(Math.atan2(-ex, -nz)) + 360) % 360;
    const pr = this.progressionAt(lon, lat);
    const inBurned = pr ? pr.arrival != null && pr.arrival <= this.time : this.sampleMask(x, z) > 0.5;
    this.cb.onHover?.({ x: e.clientX - r.left, y: e.clientY - r.top, lon, lat, elevation: this.elevationAt(x, z), slope, aspect, inBurned, inPerimeter: this.inPerimeter(lon, lat), ...(pr ? { arrival: pr.arrival, severity: pr.severity } : {}) });
  };

  private onClick = () => {
    if (!this.drone) return;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    if (this.raycaster.intersectObject(this.drone, true).length) this.cb.onDroneClick?.(this.drone.userData.sourceId);
  };

  /** DEM profile along the burn cell's long axis, through the observed fire: where the burn sits on the slope. */
  profileAcrossCell(n = 120) {
    if (this.regional) return [];
    const ring = this.incident?.reference_perimeter?.geometry.coordinates[0] as [number, number][] | undefined;
    if (!ring?.length || !this.frame || !this.ready) return [];
    const pts = ring.map(([lon, lat]) => toXZ(this.frame!, lon, lat));
    // principal axis of the cell outline
    const mx = pts.reduce((a, p) => a + p[0], 0) / pts.length, mz = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    let sxx = 0, szz = 0, sxz = 0;
    for (const [x, z] of pts) { sxx += (x - mx) ** 2; szz += (z - mz) ** 2; sxz += (x - mx) * (z - mz); }
    const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz), ux = Math.cos(ang), uz = Math.sin(ang);
    const proj = pts.map(([x, z]) => (x - mx) * ux + (z - mz) * uz), lo = Math.min(...proj) - 60, hi = Math.max(...proj) + 60;
    const f = this.focusPoint(), off = (f.x - mx) * ux + (f.z - mz) * uz, cx = f.x - off * ux, cz = f.z - off * uz;   // line through the fire
    const pose = this.source?.pose, dp = pose ? toXZ(this.frame, pose.position[0], pose.position[1]) : null;
    const out: { d: number; elev: number; burned: boolean; inCell: boolean }[] = [];
    for (let i = 0; i <= n; i++) {
      const s = lo + ((hi - lo) * i) / n, x = cx + ux * s, z = cz + uz * s;
      const [lon, lat] = toLonLat(this.frame, x, z);
      out.push({ d: s - lo, elev: this.elevationAt(x, z), burned: this.sampleMask(x, z) > 0.5, inCell: this.inPerimeter(lon, lat) });
    }
    const droneD = dp ? (dp[0] - cx) * ux + (dp[1] - cz) * uz - lo : null;
    return Object.assign(out, { fireD: off - lo, droneD, bearing: (THREE.MathUtils.radToDeg(Math.atan2(ux, -uz)) + 360) % 360 });
  }

  private sampleMask(x: number, z: number) {
    if (!(this.maskBounds.z > this.maskBounds.x)) return 0;
    const b = this.maskBounds, u = (x - b.x) / (b.z - b.x), v = (z - b.y) / (b.w - b.y);
    if (u < 0 || u > 1 || v < 0 || v > 1) return 0;
    return this.maskCanvas.getContext('2d')!.getImageData(Math.floor(u * 2047), Math.floor(v * 2047), 1, 1).data[0] / 255;
  }
  private inPerimeter(lon: number, lat: number) {
    const g = this.incident?.reference_perimeter?.geometry;
    if (!g) return false;
    if (g.type === 'MultiPolygon') return g.coordinates.some((poly) => pointInPoly(lon, lat, poly as unknown as Ring[]));
    return pointInPoly(lon, lat, g.coordinates as unknown as Ring[]);
  }

  /* --------------------------------------------------------------- loop */

  private lastCam = 0;
  private lastCamKey = '';
  /** First terrain hit of the camera ray through a screen point (ray-marched on the height field). */
  private groundHit(ndcX: number, ndcY: number): THREE.Vector3 | null {
    if (!this.frame || !this.rawHeights) return null;
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const o = this.raycaster.ray.origin, d = this.raycaster.ray.direction, p = new THREE.Vector3();
    let t = 0.5, prev = 0;
    for (let i = 0; i < 520 && t < 60000 * (this.regional ? 20 : 1); i++) {
      p.copy(d).multiplyScalar(t).add(o);
      if (p.y <= this.groundY(p.x, p.z)) {
        let a = prev, b = t;                                   // refine by bisection
        for (let k = 0; k < 18; k++) { const m = (a + b) / 2; p.copy(d).multiplyScalar(m).add(o); if (p.y <= this.groundY(p.x, p.z)) b = m; else a = m; }
        return p.copy(d).multiplyScalar(b).add(o);
      }
      prev = t; t = t * 1.04 + 0.5;
    }
    return null;
  }
  /** Ground metres per screen pixel around the centre of the view (what the scale bar shows). */
  private groundMetersPerPx(): number | null {
    const w = this.vw || 1, dx = 120 / w;           // ±120/w in NDC = 120 px apart on screen
    const a = this.groundHit(-dx, 0), b = this.groundHit(dx, 0);
    return a && b ? a.distanceTo(b) / 120 : null;
  }
  /** Advance one frame without rAF (used when the tab is hidden, e.g. for automated screenshots). */
  renderOnce(dt = 1 / 30) { this.step(dt); }
  /* Frame pacing: full rate while anything moves (camera, timeline, follow, fly-tos, pointer), 30 fps at rest — the
   * flames still flicker, at half the GPU/CPU cost. Pixel ratio adapts if frames stay slow (weak GPUs, 4K screens). */
  private vw = 1;
  private vh = 1;
  private lastActive = performance.now();
  private lastFrame = 0;
  private slowSince = 0;
  private fastSince = 0;
  private maxPR = Math.min(window.devicePixelRatio, 2);
  markActive = () => { this.lastActive = performance.now(); };
  /** frames left that must refresh the shadow map (casters moved: units, drone, terrain, trees) */
  shadowDirty = 3;
  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const busy = !!(this.anim || this.styleAnim || this.follow || this.controls.autoRotate) || now - this.lastActive < 900;
    if (!busy && now - this.lastFrame < 1000 / 30 - 3) return;
    const gap = now - this.lastFrame;
    this.lastFrame = now;
    this.step(Math.min(0.1, this.clock.getDelta()));
    if (busy && gap < 100) this.adaptQuality(now, performance.now() - now, gap);
  };
  private adaptQuality(now: number, work: number, gap: number) {
    const pr = this.renderer.getPixelRatio(), slow = gap > 26 || work > 20, fast = gap < 18 && work < 8;
    this.slowSince = slow ? this.slowSince || now : 0;
    this.fastSince = fast ? this.fastSince || now : 0;
    const setPR = (v: number) => { this.renderer.setPixelRatio(v); this.composer.setPixelRatio(v); this.resize(); this.slowSince = this.fastSince = 0; };
    if (this.slowSince && now - this.slowSince > 2500 && pr > 1) setPR(Math.max(1, +(pr - 0.25).toFixed(2)));
    else if (this.fastSince && now - this.fastSince > 8000 && pr < this.maxPR) setPR(Math.min(this.maxPR, +(pr + 0.25).toFixed(2)));
  }
  private step(dt: number) {
    this.uniforms.uTime.value += dt;
    if (this.anim) {
      const k = Math.min(1, (performance.now() - this.anim.t0) / this.anim.dur), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      this.camera.position.lerpVectors(this.anim.from.p, this.anim.to.p, e);
      this.controls.target.lerpVectors(this.anim.from.t, this.anim.to.t, e);
      if (k >= 1) { const done = this.anim.onDone; this.anim = undefined; done?.(); }
    }
    if (this.styleAnim) {
      const k = Math.min(1, (performance.now() - this.styleAnim.t0) / 900);
      this.uniforms.uMapStyle.value = this.styleAnim.from + (this.styleAnim.to - this.styleAnim.from) * k;
      if (k >= 1) this.styleAnim = undefined;
    }
    if (this.insetCur.b !== this.insetTarget.b || this.insetCur.l !== this.insetTarget.l) {
      const ease = (c: number, t: number) => (Math.abs(t - c) < 0.5 || this.reduceMotion ? t : c + (t - c) * Math.min(1, dt * 12));
      this.insetCur = { b: ease(this.insetCur.b, this.insetTarget.b), l: ease(this.insetCur.l, this.insetTarget.l) };
      this.applyInset(); this.markActive();
    }
    this.controls.update();
    for (const r of this.rotors) r.rotation.y += dt * 40;
    this.updateUnits(dt);
    if (this.drone) this.drone.position.y += Math.sin(this.uniforms.uTime.value * 1.3) * 0.004;
    if (this.drone && this.frustum) {
      this.v.copy(this.drone.position).project(this.camera);
      const onScreen = this.v.z < 1 && Math.abs(this.v.x) < 1.05 && Math.abs(this.v.y) < 1.05;
      (this.frustum.material as THREE.LineBasicMaterial).opacity = onScreen ? 0.55 : 0.12;
    }
    if (this.shadowDirty > 0 || this.follow) { this.renderer.shadowMap.needsUpdate = true; this.shadowDirty--; }
    this.composer.render();
    this.updateLabels();
    const now = performance.now();
    if (now - this.lastCam > 100) {
      this.lastCam = now;
      const key = this.cameraState().join(',') + ':' + this.vw + 'x' + this.vh;
      if (key !== this.lastCamKey) {
        this.lastCamKey = key;
        const dist = this.camera.position.distanceTo(this.controls.target);
        const mpp = this.groundMetersPerPx() ?? (2 * dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) / (this.vh || 1);
        this.cb.onCamera?.({ azimuth: THREE.MathUtils.radToDeg(this.controls.getAzimuthalAngle()), zoom: this.defaultDist / dist, metersPerPx: mpp, polar: THREE.MathUtils.radToDeg(this.controls.getPolarAngle()) });
      }
    }
  }
}

/* ------------------------------------------------------------ helpers */

function forEachCoord(g: GeoJSON.Geometry, fn: (c: number[]) => void) {
  if (g.type === 'Polygon') g.coordinates.forEach((r) => r.forEach(fn));
  else if (g.type === 'MultiPolygon') g.coordinates.forEach((p) => p.forEach((r) => r.forEach(fn)));
  else if (g.type === 'Point') fn(g.coordinates);
  else if (g.type === 'LineString') g.coordinates.forEach(fn);
}
function setSquareBounds(b: THREE.Vector4, pts: [number, number][], margin: number) {
  let minx = Infinity, minz = Infinity, maxx = -Infinity, maxz = -Infinity;
  for (const [x, z] of pts) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); minz = Math.min(minz, z); maxz = Math.max(maxz, z); }
  const cx = (minx + maxx) / 2, cz = (minz + maxz) / 2, half = Math.max(maxx - minx, maxz - minz) / 2 + margin;
  b.set(cx - half, cz - half, cx + half, cz + half);
}
function rings(g: GeoJSON.Geometry): number[][][][] {
  if (g.type === 'Polygon') return [g.coordinates];
  if (g.type === 'MultiPolygon') return g.coordinates;
  return [];
}
function fillGeom(ctx: CanvasRenderingContext2D, g: GeoJSON.Geometry, p: (lon: number, lat: number) => [number, number], style: string) {
  ctx.fillStyle = style;
  ctx.beginPath();
  for (const poly of rings(g)) for (const r of poly) r.forEach((c, i) => { const [x, y] = p(c[0], c[1]); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
  ctx.fill('evenodd');
}
function strokeGeom(ctx: CanvasRenderingContext2D, g: GeoJSON.Geometry, p: (lon: number, lat: number) => [number, number], style: string, width: number, dash: number[]) {
  ctx.strokeStyle = style; ctx.lineWidth = width; ctx.setLineDash(dash); ctx.lineJoin = 'round';
  ctx.beginPath();
  for (const poly of rings(g)) for (const r of poly) { r.forEach((c, i) => { const [x, y] = p(c[0], c[1]); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.closePath(); }
  ctx.stroke(); ctx.setLineDash([]);
}
function polygonsXZ(g: GeoJSON.Geometry, f: GeoFrame): Ring[][] {
  return rings(g).map((poly) => poly.map((r) => r.map((c) => toXZ(f, c[0], c[1]))));
}
function ringArea(r: Ring) { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a / 2); }
function ringBBox(r: Ring): [number, number, number, number] {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const [x, z] of r) { a = Math.min(a, x); b = Math.min(b, z); c = Math.max(c, x); d = Math.max(d, z); }
  return [a, b, c, d];
}
function pointInPoly(x: number, y: number, poly: Ring[] | number[][][]) {
  let inside = false;
  for (const r of poly as number[][][]) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function mulberry32(a: number) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function hashStr(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h; }

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SRGB = (() => { const t = new Uint8Array(256); for (let i = 0; i < 256; i++) { const v = i / 255; t[i] = Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)); } return t; })();

function makeUnitMesh(u: SimUnit): THREE.Group {
  const g = new THREE.Group();
  const M = (c: string, e = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, metalness: 0.1, emissive: e ? c : '#000', emissiveIntensity: e });
  const box = (w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); g.add(o); return o; };
  const white = M('#f3f1ec'), dark = M('#2b2b2b');
  if (u.kind === 'drone') {
    box(1.6, 0.6, 2.2, white); box(4.6, 0.2, 0.35, white); box(0.35, 0.2, 4.6, white);
    for (const [x, z] of [[2.1, 2.1], [-2.1, 2.1], [2.1, -2.1], [-2.1, -2.1]]) { const r = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.05, 14), new THREE.MeshBasicMaterial({ color: '#888', transparent: true, opacity: 0.35 })); r.position.set(x, 0.35, z); r.userData.rotor = true; g.add(r); }
    box(0.35, 0.35, 0.35, M('#d2402a', 0.8), 0, -0.4, -1.1);
  } else if (u.kind === 'air_tanker' || u.kind === 'air_attack') {
    const L = u.kind === 'air_attack' ? 12 : u.id === 'T-910' ? 50 : 30, s = L / 30;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(1.7 * s, 1.4 * s, L, 12), white); body.rotation.x = Math.PI / 2; g.add(body);
    box(38 * s, 0.6 * s, 5 * s, white, 0, 0, 1 * s); box(12 * s, 0.5 * s, 3 * s, white, 0, 0.6 * s, L / 2 - 2 * s);
    box(0.5 * s, 6 * s, 4 * s, M(u.kind === 'air_attack' ? '#6b7280' : '#c0392b'), 0, 3 * s, L / 2 - 2 * s);
    box(2.8 * s, 0.4 * s, 4 * s, M('#c0392b'), 0, -1.7 * s, -2 * s);
  } else if (u.kind === 'helicopter') {
    const s = u.id === 'H-743' ? 1.4 : 1;
    box(3 * s, 3 * s, 9 * s, M(u.id === 'H-743' ? '#d97706' : '#e5e7eb')); box(0.6 * s, 0.6 * s, 8 * s, M('#d97706'), 0, 0.8 * s, 8 * s);
    const r = new THREE.Mesh(new THREE.CylinderGeometry(9 * s, 9 * s, 0.08, 20), new THREE.MeshBasicMaterial({ color: '#555', transparent: true, opacity: 0.3 })); r.position.y = 2.1 * s; r.userData.rotor = true; g.add(r);
    box(2 * s, 1.4 * s, 2 * s, M('#2f6fb3'), 0, -4 * s, 0);
  } else if (u.kind === 'engine' || u.kind === 'tender') {
    box(2.6, 2.6, 8, M(u.kind === 'tender' ? '#1d4ed8' : '#b91c1c')); box(2.5, 1.6, 2.4, dark, 0, 0.4, -3.4); box(2.7, 0.4, 7.6, M('#f3f1ec'), 0, 1.4, 0.4);
  } else if (u.kind === 'crew') {
    for (let i = 0; i < 6; i++) { const p = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1.1, 3, 6), M('#ea580c')); p.position.set((i % 3 - 1) * 1.4, 0.9, Math.floor(i / 3) * 1.6 - 0.8); g.add(p); }
  } else if (u.kind === 'dozer') {
    box(3.2, 2.2, 5, M('#ca8a04')); box(4, 1.6, 0.4, dark, 0, -0.3, -3); box(1.8, 1.4, 1.8, dark, 0, 1.8, 0.6);
  }
  return g;
}

function fsHashJS(a: number, b: number) { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); }

function vnoiseJS(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const h = (a: number, b: number) => fsHashJS(a, b);
  return (h(xi, yi) * (1 - u) + h(xi + 1, yi) * u) * (1 - v) + (h(xi, yi + 1) * (1 - u) + h(xi + 1, yi + 1) * u) * v;
}
/** Illustrative fuel-availability multiplier (0.35–1.5) with km-scale patches — NOT a calibrated fuel model. */
function fuelJS(a: number, b: number) {
  const n = 0.6 * vnoiseJS(a / 18, b / 18) + 0.3 * vnoiseJS(a / 7, b / 7) + 0.1 * vnoiseJS(a / 2.5, b / 2.5);
  return 0.35 + 1.15 * n * n * 1.6;
}
