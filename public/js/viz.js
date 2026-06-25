import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const COLORS = {
  root: 0xff5d73,
  theme: 0x5b8cff,
  chunk: 0x57d9a3,
};

// 在单位球面上均匀分布 n 个点（Fibonacci 球）
function fibonacciSphere(n) {
  const pts = [];
  const phi = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = n === 1 ? 0 : 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = phi * i;
    pts.push([Math.cos(theta) * r, y, Math.sin(theta) * r]);
  }
  return pts;
}

// 用 canvas 生成文字贴图精灵
function makeLabel(text, scale = 1) {
  const pad = 16;
  const font = 48;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  ctx.font = `600 ${font}px sans-serif`;
  const clipped = text.length > 22 ? text.slice(0, 21) + "…" : text;
  const w = ctx.measureText(clipped).width + pad * 2;
  canvas.width = w;
  canvas.height = font + pad * 2;
  ctx.font = `600 ${font}px sans-serif`;
  ctx.fillStyle = "rgba(11,14,22,0.75)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#e8ecf5";
  ctx.textBaseline = "middle";
  ctx.fillText(clipped, pad, canvas.height / 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  const aspect = canvas.width / canvas.height;
  const h = 3.2 * scale;
  sprite.scale.set(h * aspect, h, 1);
  return sprite;
}

export class BookGraph {
  constructor(canvas) {
    this.canvas = canvas;
    this.nodes = []; // { mesh, type, data }
    this.lines = [];
    this.onSelect = () => {};

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b0e16);
    this.scene.fog = new THREE.FogExp2(0x0b0e16, 0.012);

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 2000);
    this.camera.position.set(0, 10, 70);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.5;

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const p1 = new THREE.PointLight(0xffffff, 1.2, 0, 0);
    p1.position.set(50, 60, 80);
    this.scene.add(p1);
    const p2 = new THREE.PointLight(0x5b8cff, 0.8, 0, 0);
    p2.position.set(-60, -40, -50);
    this.scene.add(p2);

    this.sphereGeo = new THREE.SphereGeometry(1, 32, 32);
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    this._hoverLabel = document.createElement("div");
    this._hoverLabel.id = "hover-label";
    document.body.appendChild(this._hoverLabel);

    this._bindEvents();
    this._resize();
    this._animate();
  }

  _bindEvents() {
    window.addEventListener("resize", () => this._resize());
    this.canvas.addEventListener("pointermove", (e) => this._onMove(e));
    this.canvas.addEventListener("click", (e) => this._onClick(e));
  }

  _resize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _addNode(type, data, position, radius, labelText, persistentLabel) {
    const mat = new THREE.MeshStandardMaterial({
      color: COLORS[type],
      emissive: COLORS[type],
      emissiveIntensity: 0.35,
      roughness: 0.4,
      metalness: 0.1,
    });
    const mesh = new THREE.Mesh(this.sphereGeo, mat);
    mesh.position.copy(position);
    mesh.scale.setScalar(radius);
    this.scene.add(mesh);

    const node = { mesh, type, data, baseColor: COLORS[type] };
    if (persistentLabel) {
      const label = makeLabel(labelText, type === "root" ? 1.4 : 1);
      label.position.copy(position).add(new THREE.Vector3(0, radius + 2.2, 0));
      this.scene.add(label);
      node.label = label;
    }
    this.nodes.push(node);
    return node;
  }

  _link(a, b) {
    const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
    const mat = new THREE.LineBasicMaterial({
      color: 0x33405e,
      transparent: true,
      opacity: 0.5,
    });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    this.lines.push(line);
  }

  clear() {
    for (const n of this.nodes) {
      this.scene.remove(n.mesh);
      n.mesh.material.dispose();
      if (n.label) {
        this.scene.remove(n.label);
        n.label.material.map?.dispose();
        n.label.material.dispose();
      }
    }
    for (const l of this.lines) {
      this.scene.remove(l);
      l.geometry.dispose();
      l.material.dispose();
    }
    this.nodes = [];
    this.lines = [];
  }

  render(book, onSelect) {
    this.clear();
    this.onSelect = onSelect || (() => {});

    const rootPos = new THREE.Vector3(0, 0, 0);
    const root = this._addNode("root", book, rootPos, 4, book.title, true);

    const themes = book.themes || [];
    const themeRadius = Math.max(26, themes.length * 5);
    const themePts = fibonacciSphere(themes.length);

    themes.forEach((theme, i) => {
      const tp = new THREE.Vector3(...themePts[i]).multiplyScalar(themeRadius);
      const themeNode = this._addNode("theme", theme, tp, 2.4, theme.title, true);
      this._link(rootPos, tp);

      const chunks = theme.chunks || [];
      const chunkRadius = Math.max(8, chunks.length * 1.6);
      const chunkPts = fibonacciSphere(chunks.length);
      chunks.forEach((chunk, j) => {
        const cp = new THREE.Vector3(...chunkPts[j])
          .multiplyScalar(chunkRadius)
          .add(tp);
        this._addNode("chunk", chunk, cp, 1.1, chunk.title, false);
        this._link(tp, cp);
      });
    });

    // 把相机拉到能看全的距离
    const extent = themeRadius + 20;
    this.camera.position.set(0, extent * 0.25, extent * 1.9);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  _pick(event) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const meshes = this.nodes.map((n) => n.mesh);
    const hits = this.raycaster.intersectObjects(meshes, false);
    if (hits.length === 0) return null;
    return this.nodes.find((n) => n.mesh === hits[0].object);
  }

  _onMove(event) {
    const node = this._pick(event);
    // 还原上一个高亮
    if (this._hovered && this._hovered !== node) {
      this._hovered.mesh.material.emissiveIntensity = 0.35;
      this._hovered.mesh.scale.multiplyScalar(1 / 1.25);
    }
    if (node) {
      if (this._hovered !== node) {
        node.mesh.material.emissiveIntensity = 0.9;
        node.mesh.scale.multiplyScalar(1.25);
      }
      this._hovered = node;
      this.canvas.style.cursor = "pointer";
      const t = node.data.title || "未命名";
      this._hoverLabel.textContent =
        node.type === "theme" ? `主题：${t}` : node.type === "root" ? `📖 ${t}` : t;
      this._hoverLabel.style.display = "block";
      this._hoverLabel.style.left = event.clientX + 14 + "px";
      this._hoverLabel.style.top = event.clientY + 14 + "px";
    } else {
      this._hovered = null;
      this.canvas.style.cursor = "default";
      this._hoverLabel.style.display = "none";
    }
  }

  _onClick(event) {
    const node = this._pick(event);
    if (node) {
      this.controls.autoRotate = false;
      this.onSelect(node.type, node.data);
    }
  }

  _animate() {
    this._raf = requestAnimationFrame(() => this._animate());
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
