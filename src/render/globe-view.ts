import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CATEGORY_BY_ID } from '../config.ts';
import { gmstRad, sunDirectionEci } from '../core/astro.ts';
import type { PerfProfile, PositionFrame, Satellite } from '../core/types.ts';
import {
  atmosphereFragment,
  atmosphereVertex,
  cloudsFragment,
  earthFragment,
  earthVertex,
  markerFragment,
  markerVertex,
  satFragment,
  satVertex,
} from './shaders.ts';

export interface GlobeCallbacks {
  onPick(index: number): void;
  onQualityChange(level: number): void;
}

const RED = 0xfc3d21;
const MIN_DIST = 1.12;
const MAX_DIST = 14;
const LABEL_DIST = 3.2;
const IDLE_ROTATE_MS = 15_000;

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const easeInOut = (k: number): number => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

/**
 * Three.js tabanlı 3D Dünya görünümü.
 * Çerçeve: sahne = ataletsel (TEME) çerçeve. Dünya küresi GMST kadar döndürülür;
 * böylece hem Dünya'nın gerçek dönüşü hem de yörüngelerin kapalı elips biçimi doğru görünür.
 */
export class GlobeView {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly clock = new THREE.Clock();
  private readonly earthGroup = new THREE.Group();
  private readonly sunDir = new THREE.Vector3(1, 0, 0);
  private earthMat!: THREE.ShaderMaterial;
  private atmoMat!: THREE.ShaderMaterial;
  private atmosphere!: THREE.Mesh;
  private clouds: THREE.Mesh | null = null;
  private stars: THREE.Points | null = null;

  private satGeom: THREE.BufferGeometry | null = null;
  private satPoints: THREE.Points | null = null;
  private readonly satMat: THREE.ShaderMaterial;
  private vis: Uint8Array = new Uint8Array(0);
  private names: string[] = [];
  private frame: PositionFrame | null = null;

  private readonly marker: THREE.Points;
  private readonly markerMat: THREE.ShaderMaterial;
  private readonly arrow: THREE.ArrowHelper;
  private orbitLine: THREE.Line | null = null;
  private selected = -1;
  private following = false;
  private readonly prevDir = new THREE.Vector3();
  private focusAnim: { from: THREE.Vector3; toDist: number; start: number; dur: number } | null = null;

  private autoRotate = true;
  private lastInteract = 0;
  private raf = 0;
  private labelPool: HTMLDivElement[] = [];
  private selectedLabel: HTMLDivElement;
  private lastLabelUpdate = 0;
  private quality = 0;
  private fpsFrames = 0;
  private fpsStart = 0;
  private lastFps = 0;
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private disposed = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly labelsLayer: HTMLElement,
    private readonly profile: PerfProfile,
    private readonly cb: GlobeCallbacks,
    private readonly simTime: () => number,
  ) {
    // WebGL yoksa burada hata fırlatılır; çağıran taraf arayüzü 3D'siz sürdürür.
    this.renderer = new THREE.WebGLRenderer({
      antialias: profile.antialias,
      powerPreference: 'high-performance',
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, profile.pixelRatioMax));
    this.renderer.setClearColor(0x02060f, 1);
    this.renderer.domElement.className = 'globe-canvas';
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.005, 400);
    this.camera.position.set(0.9, 1.1, 3.4);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.rotateSpeed = 0.5;
    this.controls.zoomSpeed = 0.9;
    this.controls.minDistance = MIN_DIST;
    this.controls.maxDistance = MAX_DIST;
    this.controls.autoRotateSpeed = 0.35;
    this.controls.addEventListener('start', () => {
      this.lastInteract = performance.now();
      this.focusAnim = null;
    });

    this.satMat = new THREE.ShaderMaterial({
      vertexShader: satVertex,
      fragmentShader: satFragment,
      uniforms: {
        uDt: { value: 0 },
        uSize: { value: profile.pointScale },
        uPixelRatio: { value: this.renderer.getPixelRatio() },
      },
      transparent: true,
      depthWrite: false,
    });

    this.markerMat = new THREE.ShaderMaterial({
      vertexShader: markerVertex,
      fragmentShader: markerFragment,
      uniforms: { uPx: { value: 26 * this.renderer.getPixelRatio() } },
      transparent: true,
      depthWrite: false,
    });
    const mg = new THREE.BufferGeometry();
    mg.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
    this.marker = new THREE.Points(mg, this.markerMat);
    this.marker.frustumCulled = false;
    this.marker.visible = false;
    this.marker.renderOrder = 3;

    this.arrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 0.2, RED, 0.06, 0.035);
    this.arrow.visible = false;
    this.arrow.renderOrder = 3;

    this.selectedLabel = document.createElement('div');
    this.selectedLabel.className = 'sat-label selected';
    this.selectedLabel.hidden = true;
    labelsLayer.appendChild(this.selectedLabel);

    this.bindPointer();
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  /** Dokuları yükler ve sahneyi kurar. Doku eksikse yordamsal küreye düşer. */
  async init(): Promise<{ textures: boolean }> {
    const loader = new THREE.TextureLoader();
    const maxAniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const load = async (url: string, srgb: boolean): Promise<THREE.Texture | null> => {
      try {
        const t = await loader.loadAsync(url);
        t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.anisotropy = maxAniso;
        return t;
      } catch {
        return null;
      }
    };
    const [day, night, cloudTex] = await Promise.all([
      load('textures/earth_day.jpg', true),
      load('textures/earth_night.jpg', true),
      this.profile.clouds ? load('textures/earth_clouds.jpg', false) : Promise.resolve(null),
    ]);

    const seg = this.profile.sphereSegments;
    this.earthMat = new THREE.ShaderMaterial({
      vertexShader: earthVertex,
      fragmentShader: earthFragment,
      uniforms: {
        uDay: { value: day },
        uNight: { value: night },
        uHasDay: { value: day ? 1 : 0 },
        uHasNight: { value: night ? 1 : 0 },
        uSunDir: { value: this.sunDir },
      },
    });
    const earth = new THREE.Mesh(new THREE.SphereGeometry(1, seg, seg / 2), this.earthMat);
    earth.renderOrder = 0;
    this.earthGroup.add(earth);

    if (cloudTex) {
      const cmat = new THREE.ShaderMaterial({
        vertexShader: earthVertex,
        fragmentShader: cloudsFragment,
        uniforms: { uClouds: { value: cloudTex }, uSunDir: { value: this.sunDir } },
        transparent: true,
        depthWrite: false,
      });
      this.clouds = new THREE.Mesh(new THREE.SphereGeometry(1.006, seg, seg / 2), cmat);
      this.clouds.renderOrder = 1;
      this.earthGroup.add(this.clouds);
    }
    this.scene.add(this.earthGroup);

    this.atmoMat = new THREE.ShaderMaterial({
      vertexShader: atmosphereVertex,
      fragmentShader: atmosphereFragment,
      uniforms: { uSunDir: { value: this.sunDir } },
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    this.atmosphere = new THREE.Mesh(new THREE.SphereGeometry(1.055, 64, 32), this.atmoMat);
    this.scene.add(this.atmosphere);

    if (this.profile.stars) this.addStars();
    this.scene.add(this.marker, this.arrow);

    this.clock.start();
    this.fpsStart = performance.now();
    this.raf = requestAnimationFrame(this.loop);
    return { textures: !!day };
  }

  /** Dekoratif, sabit arka plan yıldızları (uydu verisiyle ilgisi yoktur). */
  private addStars(): void {
    const n = 1400;
    const arr = new Float32Array(n * 3);
    let seed = 1234567;
    const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < n; i++) {
      const u = rnd() * 2 - 1;
      const th = rnd() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      arr.set([150 * s * Math.cos(th), 150 * u, 150 * s * Math.sin(th)], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    this.stars = new THREE.Points(
      g,
      new THREE.PointsMaterial({ color: 0xc8d6f0, size: 1.1, sizeAttenuation: false, transparent: true, opacity: 0.55 }),
    );
    this.scene.add(this.stars);
  }

  setCatalog(sats: Satellite[]): void {
    const n = sats.length;
    this.names = sats.map((s) => s.name);
    this.frame = null;
    if (this.satPoints) {
      this.scene.remove(this.satPoints);
      this.satGeom?.dispose();
    }
    const g = new THREE.BufferGeometry();
    const colors = new Float32Array(n * 3);
    for (const s of sats) colors.set(hexToRgb(CATEGORY_BY_ID.get(s.category)!.color), s.index * 3);
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aVel', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    g.setAttribute('aVis', new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage));
    this.satGeom = g;
    this.satPoints = new THREE.Points(g, this.satMat);
    this.satPoints.frustumCulled = false;
    this.satPoints.renderOrder = 2;
    this.scene.add(this.satPoints);
    if (this.vis.length !== n) this.vis = new Uint8Array(n).fill(1);
    this.syncVisibility();
  }

  setVisibility(mask: Uint8Array): void {
    this.vis = mask;
    this.syncVisibility();
  }

  private syncVisibility(): void {
    const g = this.satGeom;
    if (!g) return;
    const attr = g.getAttribute('aVis') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    const valid = this.frame?.valid;
    for (let i = 0; i < arr.length; i++) arr[i] = this.vis[i] && (!valid || valid[i]) ? 1 : 0;
    attr.needsUpdate = true;
  }

  updateFrame(f: PositionFrame): void {
    const g = this.satGeom;
    if (!g || f.pos.length !== (g.getAttribute('position') as THREE.BufferAttribute).array.length) return;
    this.frame = f;
    const pa = g.getAttribute('position') as THREE.BufferAttribute;
    const va = g.getAttribute('aVel') as THREE.BufferAttribute;
    (pa.array as Float32Array).set(f.pos);
    (va.array as Float32Array).set(f.vel);
    pa.needsUpdate = true;
    va.needsUpdate = true;
    this.syncVisibility();
  }

  select(index: number): void {
    this.selected = index;
    this.setOrbit(null);
    if (index < 0) {
      this.following = false;
      this.marker.visible = false;
      this.arrow.visible = false;
      this.selectedLabel.hidden = true;
    }
  }

  setOrbit(points: Float32Array | null): void {
    if (this.orbitLine) {
      this.scene.remove(this.orbitLine);
      this.orbitLine.geometry.dispose();
      (this.orbitLine.material as THREE.Material).dispose();
      this.orbitLine = null;
    }
    if (!points || points.length < 6) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(points, 3));
    this.orbitLine = new THREE.Line(
      g,
      new THREE.LineBasicMaterial({ color: RED, transparent: true, opacity: 0.85, depthWrite: false }),
    );
    this.orbitLine.frustumCulled = false;
    this.orbitLine.renderOrder = 2;
    this.scene.add(this.orbitLine);
  }

  /** Kamerayı seçili uyduya yumuşak geçişle yöneltir. */
  focus(): void {
    const p = this.currentPos(this.selected, this.tmp);
    if (!p) return;
    const toDist = THREE.MathUtils.clamp(p.length() * 1.35 + 0.9, MIN_DIST + 0.3, MAX_DIST);
    this.focusAnim = { from: this.camera.position.clone(), toDist, start: performance.now(), dur: 1200 };
    this.controls.enabled = false;
  }

  setFollow(on: boolean): void {
    this.following = on && this.selected >= 0;
    const p = this.currentPos(this.selected, this.tmp);
    if (p) this.prevDir.copy(p).normalize();
  }

  get isFollowing(): boolean {
    return this.following;
  }

  setAutoRotate(on: boolean): void {
    this.autoRotate = on;
    this.lastInteract = on ? 0 : performance.now();
  }

  /** Uydunun şu anki (çizimle aynı) sahne konumu. */
  private currentPos(i: number, out: THREE.Vector3): THREE.Vector3 | null {
    const f = this.frame;
    if (!f || i < 0 || !f.valid[i]) return null;
    const dt = this.frameDt();
    const k = i * 3;
    return out.set(f.pos[k]! + f.vel[k]! * dt, f.pos[k + 1]! + f.vel[k + 1]! * dt, f.pos[k + 2]! + f.vel[k + 2]! * dt);
  }

  private frameDt(): number {
    return this.frame ? THREE.MathUtils.clamp((this.simTime() - this.frame.t) / 1000, -10, 10) : 0;
  }

  private occluded(p: THREE.Vector3): boolean {
    const c = this.camera.position;
    const d = this.tmp2.subVectors(p, c);
    const a = d.dot(d);
    const b = 2 * c.dot(d);
    const cc = c.dot(c) - 1;
    const disc = b * b - 4 * a * cc;
    if (disc < 0) return false;
    const s = (-b - Math.sqrt(disc)) / (2 * a);
    return s > 0 && s < 1;
  }

  /** Ekran koordinatına en yakın görünür uydu (Dünya'nın arkasındakiler hariç). */
  private pick(clientX: number, clientY: number): number {
    const f = this.frame;
    if (!f) return -1;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    const m = new THREE.Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    const e = m.elements;
    const dt = this.frameDt();
    const thr = this.profile.pickRadiusPx;
    let best = -1;
    let bestD = thr * thr;
    const n = f.valid.length;
    for (let i = 0; i < n; i++) {
      if (!f.valid[i] || !this.vis[i]) continue;
      const k = i * 3;
      const x = f.pos[k]! + f.vel[k]! * dt;
      const y = f.pos[k + 1]! + f.vel[k + 1]! * dt;
      const z = f.pos[k + 2]! + f.vel[k + 2]! * dt;
      const w = e[3]! * x + e[7]! * y + e[11]! * z + e[15]!;
      if (w <= 0) continue;
      const sx = ((e[0]! * x + e[4]! * y + e[8]! * z + e[12]!) / w * 0.5 + 0.5) * rect.width;
      const sy = (0.5 - ((e[1]! * x + e[5]! * y + e[9]! * z + e[13]!) / w) * 0.5) * rect.height;
      const d2 = (sx - mx) ** 2 + (sy - my) ** 2;
      if (d2 < bestD && !this.occluded(this.tmp.set(x, y, z))) {
        bestD = d2;
        best = i;
      }
    }
    return best;
  }

  private bindPointer(): void {
    const el = this.renderer.domElement;
    let down: { x: number; y: number; t: number } | null = null;
    el.addEventListener('pointerdown', (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY, t: performance.now() };
    });
    el.addEventListener('pointerup', (e: PointerEvent) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const quick = performance.now() - down.t < 600;
      down = null;
      if (moved < 8 && quick) {
        const i = this.pick(e.clientX, e.clientY);
        if (i >= 0) this.cb.onPick(i);
      }
    });
    el.addEventListener('wheel', () => (this.lastInteract = performance.now()), { passive: true });
  }

  private resize(): void {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private loop = (): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const now = performance.now();
    const t = this.simTime();

    // Dünya dönüşü (GMST) ve gerçek zamanlı Güneş yönü
    this.earthGroup.rotation.y = gmstRad(t);
    const s = sunDirectionEci(t);
    this.sunDir.set(s[0], s[2], -s[1]);

    this.satMat.uniforms.uDt!.value = this.frameDt();

    // Seçili uydu: işaret, yön oku, takip
    const p = this.currentPos(this.selected, this.tmp);
    if (p && this.frame) {
      this.marker.visible = true;
      this.marker.position.copy(p);
      const k = this.selected * 3;
      const v = this.tmp2.set(this.frame.vel[k]!, this.frame.vel[k + 1]!, this.frame.vel[k + 2]!);
      if (v.lengthSq() > 0) {
        const camDist = this.camera.position.distanceTo(p);
        const len = THREE.MathUtils.clamp(camDist * 0.09, 0.02, 0.6);
        this.arrow.position.copy(p);
        this.arrow.setDirection(v.normalize());
        this.arrow.setLength(len, len * 0.32, len * 0.18);
        this.arrow.visible = true;
      }
      if (this.following && !this.focusAnim) {
        const dir = this.tmp2.copy(p).normalize();
        const q = new THREE.Quaternion().setFromUnitVectors(this.prevDir, dir);
        this.camera.position.applyQuaternion(q);
        this.prevDir.copy(dir);
      }
    } else {
      this.marker.visible = false;
      this.arrow.visible = false;
    }

    // Odak animasyonu (uydu hareket etse de hedefi her karede günceller)
    if (this.focusAnim && p) {
      const a = this.focusAnim;
      const k = easeInOut(Math.min(1, (now - a.start) / a.dur));
      const fromDir = a.from.clone().normalize();
      const toDir = p.clone().normalize();
      const q = new THREE.Quaternion().slerp(new THREE.Quaternion().setFromUnitVectors(fromDir, toDir), k);
      this.camera.position.copy(fromDir.applyQuaternion(q)).multiplyScalar(THREE.MathUtils.lerp(a.from.length(), a.toDist, k));
      if (k >= 1) {
        this.focusAnim = null;
        this.prevDir.copy(toDir);
        this.controls.enabled = true;
      }
    } else if (this.focusAnim) {
      this.focusAnim = null;
      this.controls.enabled = true;
    }

    this.controls.autoRotate =
      this.autoRotate && !this.following && !this.focusAnim && now - this.lastInteract > IDLE_ROTATE_MS;
    this.controls.update(dt);

    this.renderer.render(this.scene, this.camera);
    this.updateLabels(now, p);
    this.monitorFps(now);
  };

  private updateLabels(now: number, selPos: THREE.Vector3 | null): void {
    const w = this.renderer.domElement.clientWidth;
    const h = this.renderer.domElement.clientHeight;
    const project = (v: THREE.Vector3, el: HTMLDivElement): boolean => {
      const sp = this.tmp2.copy(v).project(this.camera);
      if (sp.z > 1 || sp.x < -1.1 || sp.x > 1.1 || sp.y < -1.1 || sp.y > 1.1) return false;
      el.style.transform = `translate(${((sp.x + 1) / 2) * w}px, ${((1 - sp.y) / 2) * h}px)`;
      return true;
    };

    // Seçili uydunun etiketi her karede
    if (selPos && !this.occluded(selPos)) {
      this.selectedLabel.textContent = this.names[this.selected] ?? '';
      this.selectedLabel.hidden = !project(selPos.clone(), this.selectedLabel);
    } else {
      this.selectedLabel.hidden = true;
    }

    if (now - this.lastLabelUpdate < 220) return;
    this.lastLabelUpdate = now;
    const f = this.frame;
    const camDist = this.camera.position.length();
    const max = this.quality >= 2 ? Math.ceil(this.profile.maxLabels / 2) : this.profile.maxLabels;
    const chosen: Array<{ i: number; d: number }> = [];

    if (f && camDist < LABEL_DIST) {
      const dt = this.frameDt();
      const c = this.camera.position;
      const v = new THREE.Vector3();
      for (let i = 0; i < f.valid.length; i++) {
        if (!f.valid[i] || !this.vis[i] || i === this.selected) continue;
        const k = i * 3;
        v.set(f.pos[k]! + f.vel[k]! * dt, f.pos[k + 1]! + f.vel[k + 1]! * dt, f.pos[k + 2]! + f.vel[k + 2]! * dt);
        const d = v.distanceToSquared(c);
        if (chosen.length >= max && d >= chosen[chosen.length - 1]!.d) continue;
        if (this.occluded(v)) continue;
        const sp = this.tmp2.copy(v).project(this.camera);
        if (sp.z > 1 || Math.abs(sp.x) > 1 || Math.abs(sp.y) > 1) continue;
        chosen.push({ i, d });
        chosen.sort((a, b) => a.d - b.d);
        if (chosen.length > max) chosen.pop();
      }
    }

    while (this.labelPool.length < chosen.length) {
      const el = document.createElement('div');
      el.className = 'sat-label';
      this.labelsLayer.appendChild(el);
      this.labelPool.push(el);
    }
    const v = new THREE.Vector3();
    this.labelPool.forEach((el, j) => {
      const c = chosen[j];
      if (!c || !f) {
        el.hidden = true;
        return;
      }
      const k = c.i * 3;
      const dt = this.frameDt();
      v.set(f.pos[k]! + f.vel[k]! * dt, f.pos[k + 1]! + f.vel[k + 1]! * dt, f.pos[k + 2]! + f.vel[k + 2]! * dt);
      el.textContent = this.names[c.i] ?? '';
      el.hidden = !project(v, el);
    });
  }

  /** FPS düşükse grafik kalitesini kademeli olarak azaltır (geri alınmaz). */
  private monitorFps(now: number): void {
    this.fpsFrames++;
    const elapsed = now - this.fpsStart;
    if (elapsed < 4000) return;
    const fps = (this.fpsFrames * 1000) / elapsed;
    this.lastFps = fps;
    this.fpsFrames = 0;
    this.fpsStart = now;
    if (document.hidden || fps >= 28 || this.quality >= 2) return;
    this.quality++;
    if (this.quality === 1) {
      this.renderer.setPixelRatio(1);
      this.satMat.uniforms.uPixelRatio!.value = 1;
      this.markerMat.uniforms.uPx!.value = 26;
      if (this.clouds) this.clouds.visible = false;
      this.resize();
    } else {
      if (this.stars) this.stars.visible = false;
      this.atmosphere.visible = false;
    }
    this.cb.onQualityChange(this.quality);
  }

  /** Son 4 sn'lik ortalama kare hızı (test ve tanı için). */
  get fps(): number {
    return this.lastFps;
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.controls.dispose();
    this.renderer.dispose();
  }
}
