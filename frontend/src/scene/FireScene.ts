import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { AnalysisEvent, FireFeature, Hotspot, Incident, VideoSource } from '../api/types';
import { type GeoFrame, makeFrame, toLonLat, toXZ } from './geo';
import { ESRI_IMAGERY, TERRARIUM, cropToBBox, decodeTerrarium, loadMosaic } from './tiles';

type BBox = [number, number, number, number];
type Ring = [number, number][];

export interface HoverInfo { x: number; y: number; lon: number; lat: number; elevation: number; slope: number; aspect: number; inBurned: boolean; inPerimeter: boolean }
export interface CameraInfo { azimuth: number; zoom: number; metersPerPx: number; polar: number }
export interface SceneLayers {
  terrain: boolean; imagery: number; burned: number; active: number; change: number; hotspots: boolean;
  groundTruth: boolean; perimeter: boolean; footprint: boolean; path: boolean; projection: boolean; trees: boolean; smoke: boolean;
}
export interface SceneCallbacks {
  onHover?: (h: HoverInfo | null) => void;
  onCamera?: (c: CameraInfo) => void;
  onEventClick?: (id: string) => void;
  onDroneClick?: (id: string) => void;
  onReady?: () => void;
  onProgress?: (msg: string) => void;
}

const DEFAULT_LAYERS: SceneLayers = { terrain: true, imagery: 0.18, burned: 0.95, active: 1, change: 0.6, hotspots: true, groundTruth: false, perimeter: true, footprint: true, path: true, projection: false, trees: true, smoke: true };

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
  private gridN = 320;
  private rawHeights!: Float32Array; // inner grid, metres
  private innerMesh?: THREE.Mesh;
  private outerMesh?: THREE.Mesh;
  private outerSampler?: (lon: number, lat: number) => number;
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
  };

  // dynamic content
  private flames?: THREE.Points;
  private smoke?: THREE.Points;
  private trees?: THREE.InstancedMesh;
  private drone?: THREE.Group;
  private rotors: THREE.Object3D[] = [];
  private frustum?: THREE.LineSegments;
  private labels = new Map<string, { el: HTMLElement; pos: THREE.Vector3; minZoom?: number }>();

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
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';
    this.renderer = renderer;

    this.labelRoot = document.createElement('div');
    this.labelRoot.className = 'scene-labels';
    container.appendChild(this.labelRoot);

    this.camera = new THREE.PerspectiveCamera(34, 1, 2, 60000);
    this.camera.position.set(200, 220, 260);
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = THREE.MathUtils.degToRad(84);
    this.controls.minDistance = 15;
    this.controls.maxDistance = 14000;
    this.controls.zoomSpeed = 0.9;
    this.controls.addEventListener('start', () => { this.anim = undefined; });

    // atmosphere
    const haze = new THREE.Color('#d9dcd8');
    this.scene.background = haze.clone();
    this.scene.fog = new THREE.FogExp2(haze.getHex(), 0.00016);
    this.scene.add(this.makeSky());
    const hemi = new THREE.HemisphereLight('#e9eef5', '#7a6248', 1.15);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight('#fff1dc', 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    this.scene.add(this.sun, this.sun.target);

    // overlays
    this.maskCanvas.width = this.maskCanvas.height = 2048;
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
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.85, 0.55, 0.88);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    const ro = new ResizeObserver(() => this.resize());
    ro.observe(container);
    this.resize();
    renderer.domElement.addEventListener('pointermove', this.onPointerMove);
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
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.updatePointUniforms();
  }

  private makeSky() {
    const geo = new THREE.SphereGeometry(40000, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
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

  async load(incident: Incident, source?: VideoSource) {
    this.incident = incident;
    this.source = source;
    const [cx, cy] = source?.pose?.position ?? incident.center;
    this.frame = makeFrame(cx, cy);
    this.innerBBox = incident.bbox;

    this.cb.onProgress?.('Loading elevation tiles');
    const innerDem = await loadMosaic(this.innerBBox, 15, TERRARIUM);
    const dec = decodeTerrarium(innerDem);
    const sampleInner = (lon: number, lat: number) => { const [px, py] = innerDem.px(lon, lat); return dec.sample(px, py); };
    this.h0 = sampleInner(cx, cy);

    const outerBBox: BBox = [cx - 0.11, cy - 0.085, cx + 0.11, cy + 0.085];
    const outerDem = await loadMosaic(outerBBox, 12, TERRARIUM);
    const decO = decodeTerrarium(outerDem);
    this.outerSampler = (lon, lat) => { const [px, py] = outerDem.px(lon, lat); return decO.sample(px, py); };

    this.cb.onProgress?.('Loading aerial imagery');
    const [innerImg, outerImg] = await Promise.all([loadMosaic(this.innerBBox, 17, ESRI_IMAGERY), loadMosaic(outerBBox, 13, ESRI_IMAGERY)]);
    const innerCanvas = cropToBBox(innerImg, this.innerBBox, 4096);
    const outerCanvas = cropToBBox(outerImg, outerBBox, 2048);

    this.cb.onProgress?.('Building terrain');
    const N = this.gridN;
    this.rawHeights = new Float32Array((N + 1) * (N + 1));
    const [w, s, e, n] = this.innerBBox;
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) this.rawHeights[j * (N + 1) + i] = sampleInner(w + ((e - w) * i) / N, n - ((n - s) * j) / N);

    this.innerMesh = new THREE.Mesh(this.buildGrid(this.innerBBox, N, (i, j) => this.rawHeights[j * (N + 1) + i]), this.makeTerrainMaterial(innerCanvas, 1));
    this.innerMesh.receiveShadow = this.innerMesh.castShadow = true;
    const [iw, is, ie, inn] = this.innerBBox;
    const oN = 220;
    const outerH = (i: number, j: number) => {
      const lon = outerBBox[0] + ((outerBBox[2] - outerBBox[0]) * i) / oN, lat = outerBBox[3] - ((outerBBox[3] - outerBBox[1]) * j) / oN;
      const inside = lon > iw + 0.0012 && lon < ie - 0.0012 && lat > is + 0.0009 && lat < inn - 0.0009;
      return this.outerSampler!(lon, lat) - (inside ? 25 : 0);
    };
    this.outerMesh = new THREE.Mesh(this.buildGrid(outerBBox, oN, outerH), this.makeTerrainMaterial(outerCanvas, 0));
    this.outerMesh.receiveShadow = true;
    this.scene.add(this.innerMesh, this.outerMesh);
    (this.outerMesh.userData as { heightFn: typeof outerH }).heightFn = outerH;
    (this.innerMesh.userData as { bbox: BBox }).bbox = this.innerBBox;
    (this.outerMesh.userData as { bbox: BBox }).bbox = outerBBox;

    // sun from WSW, fairly low — long warm shadows like the reference
    const sunDir = new THREE.Vector3(-0.8, 0.42, 0.42).normalize();
    this.sun.position.copy(sunDir.multiplyScalar(3000));
    const sc = this.sun.shadow.camera as THREE.OrthographicCamera;
    sc.left = sc.bottom = -1400; sc.right = sc.top = 1400; sc.near = 100; sc.far = 7000;
    sc.updateProjectionMatrix();

    this.computeOverlayBounds();
    this.placeTrees(innerCanvas);
    this.buildFireSystems();
    if (source) this.buildDrone(source);
    this.redrawOverlays(true);

    this.setInitialCamera();
    this.ready = true;
    this.cb.onReady?.();
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
    tex.anisotropy = 8;
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
  vec2 duv = fsBoundsUv(vWorld.xz, uDecalBounds);
  if (fsInside(duv) > 0.) { vec4 d = texture2D(uDecal, duv); alb = mix(alb, d.rgb, d.a); }
  diffuseColor.rgb *= alb;
`)
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += fireEm;');
    };
    return mat;
  }

  /** Raw DEM elevation (m, MSL) at world xz. */
  elevationAt(x: number, z: number): number {
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
    for (const mesh of [this.innerMesh, this.outerMesh]) {
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
    setSquareBounds(this.maskBounds, pts, 40);
    const dp = [...pts];
    const per = this.incident?.reference_perimeter?.geometry;
    if (per) forEachCoord(per, (c) => dp.push(toXZ(this.frame, c[0], c[1])));
    setSquareBounds(this.decalBounds, dp, 120);
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
  }

  setEvents(events: AnalysisEvent[]) {
    this.events = events;
    if (this.ready) this.rebuildEventLabels();
  }

  setTime(ms: number) { this.time = ms; this.redrawOverlays(); }
  setSelectedEvent(id: string | null) { this.selectedEvent = id; this.drawnKey = ''; this.redrawOverlays(); }
  setCompare(ms: number | null) { this.compareTime = ms; this.drawnKey = ''; this.redrawOverlays(); }

  setLayers(l: Partial<SceneLayers>) {
    const prev = this.layers;
    this.layers = { ...this.layers, ...l };
    const u = this.uniforms;
    u.uImageryMix.value = this.layers.imagery;
    u.uBurnOp.value = this.layers.burned;
    u.uFireOp.value = this.layers.active;
    u.uChangeOp.value = this.layers.change;
    u.uStyleOn.value = this.layers.terrain ? 1 : 0;
    if (this.trees) this.trees.visible = this.layers.trees && !this.mode2D;
    if (this.flames) this.flames.visible = this.layers.active > 0.01;
    if (this.smoke) this.smoke.visible = this.layers.smoke && this.layers.active > 0.01 && !this.mode2D;
    if (this.frustum) this.frustum.visible = this.layers.footprint;
    if (prev.groundTruth !== this.layers.groundTruth || prev.perimeter !== this.layers.perimeter || prev.footprint !== this.layers.footprint || prev.path !== this.layers.path || prev.projection !== this.layers.projection) { this.drawnKey = ''; this.redrawOverlays(); }
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
    const key = [burned?.properties.id, active?.properties.id, change?.properties.id, gt?.properties.id, before?.properties.id, pathIdx].join('|');
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
    this.decalTex.needsUpdate = true;

    this.updateFlames(active, burned);
    this.updateHotspotLabels(t);
    for (const [id, lab] of this.labels) if (id.startsWith('ev_')) {
      const e = this.events.find((x) => 'ev_' + x.event_id === id);
      if (e) { lab.el.classList.toggle('future', Date.parse(e.timestamp) > t); lab.el.classList.toggle('sel', e.event_id === this.selectedEvent); }
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
      vertexShader: /* glsl */ `attribute float aSeed; uniform float uTime, uScale, uSize; varying float vSeed; varying float vF;
        void main(){ vSeed = aSeed; vec3 p = position; float f = fract(uTime*(0.9+aSeed*0.8) + aSeed*7.0); vF = f;
          p.y += f * uSize * 0.9; p.x += sin(uTime*3.+aSeed*20.)*0.25;
          vec4 mv = modelViewMatrix*vec4(p,1.); gl_Position = projectionMatrix*mv;
          gl_PointSize = clamp(uSize*(1.0 - f*0.5)*(0.7+aSeed*0.6) * uScale / -mv.z, 1.5, 180.); }`,
      fragmentShader: /* glsl */ `varying float vSeed; varying float vF;
        void main(){ vec2 uv = gl_PointCoord*2.-1.; uv.y = -uv.y; float d = length(vec2(uv.x*1.6, uv.y*0.85 + 0.15));
          float a = smoothstep(1.0, 0.15, d) * (1.0 - vF);
          vec3 c = mix(vec3(0.9,0.12,0.01), vec3(1.0,0.55,0.12), smoothstep(0.8, 0.2, d)); c = mix(c, vec3(1.,.85,.5), smoothstep(.3,.0,d)*(1.-vF)*0.6);
          gl_FragColor = vec4(c*1.25*a, a); }`,
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
      vertexShader: /* glsl */ `attribute float aSeed; uniform float uTime, uScale; varying float vL; varying float vSeed;
        void main(){ vSeed = aSeed; float L = fract(uTime*0.035 + aSeed*13.7); vL = L; vec3 p = position;
          p += vec3(L*L*38.0 + sin(aSeed*40.)*4., L*42.0, -L*L*14.0 + cos(aSeed*30.)*4.);
          vec4 mv = modelViewMatrix*vec4(p,1.); gl_Position = projectionMatrix*mv;
          gl_PointSize = clamp((5.0 + L*30.0) * uScale / -mv.z, 2., 420.); }`,
      fragmentShader: /* glsl */ `varying float vL; varying float vSeed;
        void main(){ vec2 uv = gl_PointCoord*2.-1.; float d = length(uv); float a = smoothstep(1., .1, d) * smoothstep(0., .12, vL) * (1.-vL) * 0.16;
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
    set(this.flames); set(this.smoke);
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
        const count = Math.min(fp.count - nf, Math.ceil(area / 0.45));
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

  /* ------------------------------------------------------------- labels */

  addLabel(id: string, html: string, pos: THREE.Vector3, onClick?: () => void) {
    this.labels.get(id)?.el.remove();
    const el = document.createElement('div');
    el.className = 'scene-label';
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
      const time = new Date(e.timestamp).toISOString().slice(11, 19);
      const cls = e.severity === 'alert' ? 'alert' : e.severity === 'watch' ? 'watch' : 'info';
      this.addLabel('ev_' + e.event_id, `<div class="lbl-event ${cls}"><span class="ring"></span><span class="txt"><b>${time}</b><span class="full">${e.title}</span></span></div>`, this.worldAt(e.location[0], e.location[1], 0.5), () => this.cb.onEventClick?.(e.event_id));
    }
    this.drawnKey = '';
    this.redrawOverlays();
  }

  private hsShown = '';
  private updateHotspotLabels(t: number) {
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
  private updateLabels() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    const boxes: [number, number, number, number][] = [];
    const items: { el: HTMLElement; x: number; y: number; pri: number }[] = [];
    for (const [id, { el, pos }] of this.labels) {
      this.v.copy(pos).project(this.camera);
      if (this.v.z > 1 || this.v.z < -1) { el.style.visibility = 'hidden'; continue; }
      el.style.visibility = '';
      const x = ((this.v.x + 1) / 2) * w, y = ((1 - this.v.y) / 2) * h;
      el.style.transform = `translate(${x}px, ${y}px)`;
      if (id.startsWith('ev_')) items.push({ el, x, y, pri: el.firstElementChild?.classList.contains('sel') ? 2 : el.firstElementChild?.classList.contains('future') ? 0 : 1 });
    }
    // hide the text of event labels that would overlap a higher-priority one (ring stays visible)
    items.sort((a, b) => b.pri - a.pri || a.y - b.y);
    for (const it of items) {
      const bw = it.pri === 2 ? 170 : 66, bx: [number, number, number, number] = [it.x + 8, it.y - 12, it.x + 8 + bw, it.y + 12];
      const hit = boxes.some((b) => !(bx[2] < b[0] || bx[0] > b[2] || bx[3] < b[1] || bx[1] > b[3]));
      it.el.classList.toggle('collide', hit);
      if (!hit) boxes.push(bx);
    }
  }

  /* ------------------------------------------------------------- camera */

  /** Horizontal unit vector the drone camera looks along (world space). */
  private viewDir() {
    const yaw = THREE.MathUtils.degToRad(this.source?.pose?.yaw_deg ?? -45);
    return new THREE.Vector3(Math.sin(yaw), 0, -Math.cos(yaw));
  }
  private homeOffset() { return this.viewDir().multiplyScalar(-175).add(new THREE.Vector3(0, 44, 0)).applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.42); }

  private setInitialCamera() {
    const t = this.focusPoint();
    const p = t.clone().add(this.homeOffset());
    this.camera.position.copy(p);
    this.controls.target.copy(t);
    this.defaultDist = p.distanceTo(t);
    this.controls.update();
  }

  focusPoint() {
    const b = this.maskBounds;
    const x = (b.x + b.z) / 2, z = (b.y + b.w) / 2;
    return new THREE.Vector3(x, this.groundY(x, z), z);
  }

  flyTo(target: THREE.Vector3, dist?: number, dur = 1400, dirOverride?: THREE.Vector3) {
    const offs = dirOverride ?? this.camera.position.clone().sub(this.controls.target);
    if (dist) offs.setLength(dist);
    this.anim = { t0: performance.now(), dur, from: { p: this.camera.position.clone(), t: this.controls.target.clone() }, to: { p: target.clone().add(offs), t: target.clone() } };
  }
  flyToLonLat(lon: number, lat: number, dist = 110) { this.flyTo(this.worldAt(lon, lat), dist); }
  flyHome() { this.flyTo(this.focusPoint(), undefined, 1400, this.homeOffset()); }
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
  }

  /* -------------------------------------------------------------- input */

  private onPointerMove = (e: PointerEvent) => {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const now = performance.now();
    if (now - this.lastHover < 60 || !this.ready || e.buttons) return;
    this.lastHover = now;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects([this.innerMesh!, this.outerMesh!].filter(Boolean), false)[0];
    if (!hit) { this.cb.onHover?.(null); return; }
    const { x, z } = hit.point;
    const [lon, lat] = toLonLat(this.frame, x, z);
    const d = 3, ex = (this.elevationAt(x + d, z) - this.elevationAt(x - d, z)) / (2 * d), nz = (this.elevationAt(x, z - d) - this.elevationAt(x, z + d)) / (2 * d);
    const slope = THREE.MathUtils.radToDeg(Math.atan(Math.hypot(ex, nz)));
    const aspect = (THREE.MathUtils.radToDeg(Math.atan2(-ex, -nz)) + 360) % 360;
    this.cb.onHover?.({ x: e.clientX - r.left, y: e.clientY - r.top, lon, lat, elevation: this.elevationAt(x, z), slope, aspect, inBurned: this.sampleMask(x, z) > 0.5, inPerimeter: this.inPerimeter(lon, lat) });
  };

  private onClick = () => {
    if (!this.drone) return;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    if (this.raycaster.intersectObject(this.drone, true).length) this.cb.onDroneClick?.(this.drone.userData.sourceId);
  };

  /** DEM profile along the drone's line of sight (real elevation), with burned flags from the current mask. */
  profileAlongView(len = 160, n = 64) {
    const pose = this.source?.pose;
    if (!pose || !this.frame) return [];
    const [x0, z0] = toXZ(this.frame, pose.position[0], pose.position[1]);
    const v = this.viewDir();
    const out: { d: number; elev: number; burned: boolean }[] = [];
    for (let i = 0; i <= n; i++) {
      const d = (len * i) / n, x = x0 + v.x * d, z = z0 + v.z * d;
      out.push({ d, elev: this.elevationAt(x, z), burned: this.sampleMask(x, z) > 0.5 });
    }
    return out;
  }

  private sampleMask(x: number, z: number) {
    const b = this.maskBounds, u = (x - b.x) / (b.z - b.x), v = (z - b.y) / (b.w - b.y);
    if (u < 0 || u > 1 || v < 0 || v > 1) return 0;
    return this.maskCanvas.getContext('2d')!.getImageData(Math.floor(u * 2047), Math.floor(v * 2047), 1, 1).data[0] / 255;
  }
  private inPerimeter(lon: number, lat: number) {
    const g = this.incident?.reference_perimeter?.geometry;
    if (!g || g.type !== 'Polygon') return false;
    return pointInPoly(lon, lat, g.coordinates as unknown as Ring[]);
  }

  /* --------------------------------------------------------------- loop */

  private lastCam = 0;
  /** Advance one frame without rAF (used when the tab is hidden, e.g. for automated screenshots). */
  renderOnce(dt = 1 / 30) { this.step(dt); }
  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    this.step(Math.min(0.1, this.clock.getDelta()));
  };
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
    this.controls.update();
    for (const r of this.rotors) r.rotation.y += dt * 40;
    if (this.drone) this.drone.position.y += Math.sin(this.uniforms.uTime.value * 1.3) * 0.004;
    this.composer.render();
    this.updateLabels();
    const now = performance.now();
    if (now - this.lastCam > 100) {
      this.lastCam = now;
      const dist = this.camera.position.distanceTo(this.controls.target);
      const mpp = (2 * dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) / (this.container.clientHeight || 1);
      this.cb.onCamera?.({ azimuth: THREE.MathUtils.radToDeg(this.controls.getAzimuthalAngle()), zoom: this.defaultDist / dist, metersPerPx: mpp, polar: THREE.MathUtils.radToDeg(this.controls.getPolarAngle()) });
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
