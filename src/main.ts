import * as THREE from 'three';
import type { Artwork, Critter, Discovery, Point, Stroke, Weather } from './types';
import { countIntersections, findNearestStroke, getDiscoveries, simplify, weatherLabel } from './simulation/webState';
import { deleteArtwork, listArtworks, saveArtwork } from './storage';
import './styles.css';
import { routePoints } from './simulation/routes';
import { buildWebStructure } from './simulation/webGraph';

const stage = document.querySelector('.stage') as HTMLElement;
const video = document.querySelector('#camera') as HTMLVideoElement;
const drawing = document.querySelector('#drawing') as HTMLCanvasElement;
const ctx = drawing.getContext('2d')!;
const threeLayer = document.querySelector('#three-layer') as HTMLElement;
const status = document.querySelector('#status') as HTMLElement;
const hint = document.querySelector('#hint') as HTMLElement;
const toast = document.querySelector('#toast') as HTMLElement;
const isDebug = new URLSearchParams(location.search).get('debug') === '1';
const debugPanel = document.querySelector('#debug-panel') as HTMLElement | null;
const debugValues = new Map<string, HTMLElement>();
let strokes: Stroke[] = [];
let redoStack: Stroke[] = [];
let active: Stroke | null = null;
let color = '#fffaf0';
let width = 4;
let weather: Weather = 'sunny';
let cameraStream: MediaStream | null = null;
let cameraState = '未起動';
let eraserMode = false;
let currentArtworkId: string | null = null;
let lastStageSize = { width: 0, height: 0 };
let windTime = 0;
let lastTime = performance.now();
let rafHandle = 0;
let lastRenderTime = 0;
let fpsFrames = 0;
let fpsWindowStart = performance.now();
let fps = 0;
let rafCount = 0, updateCount = 0, generated = 0, rainCount = 0, leafCount = 0;
let lastError = '', webglState = '初期化中';
let testStroke: Stroke | null = null;
let routes: Point[][] = [];
let lastDebugTime = 0;
window.addEventListener('error', (event) => { lastError = event.message; });
window.addEventListener('unhandledrejection', (event) => { lastError = String(event.reason); });

const critters: Critter[] = [];
const sprites = new Map<Critter, THREE.Sprite>();
const textureCache = new Map<Discovery, THREE.Texture>();

let renderer: THREE.WebGLRenderer | null = null;
const fallback = document.createElement('canvas');
threeLayer.append(fallback);
try {
  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, powerPreference: 'low-power' });
  // A12-class devices benefit more from a stable fill rate than a dense canvas.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
  renderer.setClearColor(0, 0); threeLayer.append(renderer.domElement); webglState = 'WebGL準備済み';
  renderer.debug.onShaderError = () => { lastError = 'シェーダーコンパイル失敗'; webglState = 'Canvas 2D'; };
  renderer.domElement.addEventListener('webglcontextlost', (event) => { event.preventDefault(); webglState = 'Canvas 2D'; });
  renderer.domElement.addEventListener('webglcontextrestored', () => { webglState = 'WebGL準備済み'; });
} catch (error) { lastError = String(error); webglState = 'Canvas 2D'; }
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 100);
camera.position.z = 10;
const spriteGroup = new THREE.Group();
scene.add(spriteGroup);

function debugValue(name: string, value: string): void { const element = debugValues.get(name); if (element) element.textContent = value; }

function setupDebug(): void {
  if (!debugPanel) return;
  debugPanel.hidden = !isDebug;
  if (!isDebug) return;
  const details = document.createElement('details'); details.open = true;
  const summary = document.createElement('summary'); summary.textContent = '診断を開く／閉じる · Phase 1.6';
  const content = document.createElement('div');
  while (debugPanel.firstChild) content.append(debugPanel.firstChild);
  details.append(summary, content); debugPanel.append(details);
  const list = content.querySelector('dl')!;
  for (const [name, label] of Object.entries({ raf: 'rAF回数', updates: '更新回数', time: '最終更新', generated: '生成数', visible: '画面内数', positions: '座標', rain: '雨生成', leaf: '葉生成', webgl: '描画状態', error: 'JSエラー' })) {
    const term = document.createElement('dt'); term.textContent = label;
    const value = document.createElement('dd'); value.dataset.debugValue = name; value.textContent = '-'; list.append(term, value);
  }
  const actions = content.querySelector('.debug-actions')!;
  for (const [kind, label] of Object.entries({ spider: 'SPIDER', butterfly: 'BUTTERFLY', ladybug: 'LADYBUG', raindrop: 'RAIN', leaf: 'WIND', all: 'ALL' })) {
    const button = document.createElement('button'); button.dataset.force = kind; button.textContent = `TEST ${label}`; actions.append(button);
  }
  debugPanel.querySelectorAll<HTMLElement>('[data-debug-value]').forEach((element) => debugValues.set(element.dataset.debugValue!, element));
  debugPanel.querySelector('[data-debug-action="spider"]')?.addEventListener('click', () => spawnSpiderReaction());
  debugPanel.querySelector('[data-debug-action="rain"]')?.addEventListener('click', () => setWeather('rain'));
  debugPanel.querySelector('[data-debug-action="wind"]')?.addEventListener('click', () => setWeather('wind'));
  debugPanel.querySelector('[data-debug-action="save"]')?.addEventListener('click', () => void runSaveTest());
  debugPanel.querySelectorAll<HTMLButtonElement>('[data-force]').forEach((button) => button.addEventListener('click', () => {
    const kind = button.dataset.force!;
    if (kind === 'all') ['spider', 'butterfly', 'ladybug', 'raindrop', 'leaf'].forEach((item, index) => window.setTimeout(() => forceTest(item as Discovery), index * 900));
    else forceTest(kind as Discovery);
  }));
}

function resize(): void {
  const rect = stage.getBoundingClientRect();
  if (lastStageSize.width && lastStageSize.height && rect.width && rect.height) {
    const scaleX = rect.width / lastStageSize.width; const scaleY = rect.height / lastStageSize.height;
    strokes = strokes.map((stroke) => ({ ...stroke, points: stroke.points.map((point) => ({ x: point.x * scaleX, y: point.y * scaleY })) }));
    if (active) active.points = active.points.map((point) => ({ x: point.x * scaleX, y: point.y * scaleY }));
    redoStack.forEach((stroke) => stroke.points = stroke.points.map((p) => ({ x: p.x * scaleX, y: p.y * scaleY })));
    critters.forEach((c) => { c.x *= scaleX; c.y *= scaleY; c.targetX *= scaleX; c.targetY *= scaleY; c.path = c.path?.map((p) => ({ x: p.x * scaleX, y: p.y * scaleY })); });
  }
  lastStageSize = { width: rect.width, height: rect.height };
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  drawing.width = Math.max(1, Math.floor(rect.width * dpr)); drawing.height = Math.max(1, Math.floor(rect.height * dpr));
  drawing.style.width = `${rect.width}px`; drawing.style.height = `${rect.height}px`;
  fallback.width = rect.width; fallback.height = rect.height;
  renderer?.setSize(rect.width, rect.height, false); camera.left = 0; camera.right = rect.width; camera.top = rect.height; camera.bottom = 0; camera.updateProjectionMatrix(); drawStrokes();
}

function pointFromEvent(event: PointerEvent): Point {
  const rect = drawing.getBoundingClientRect();
  return { x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)), y: Math.max(0, Math.min(rect.height, event.clientY - rect.top)) };
}

function drawStrokes(): void {
  const scale = drawing.width / Math.max(1, drawing.clientWidth);
  ctx.save(); ctx.scale(scale, scale); ctx.clearRect(0, 0, drawing.clientWidth, drawing.clientHeight);
  if (weather === 'wind') ctx.translate(Math.sin(windTime * 2.1) * 1.4, Math.cos(windTime * 1.7) * .8);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const stroke of [...strokes, ...(active ? [active] : []), ...(testStroke ? [testStroke] : [])]) {
    if (!stroke.points.length) continue;
    ctx.save(); ctx.strokeStyle = '#183c46aa'; ctx.lineWidth = stroke.width + 3; ctx.shadowColor = '#183c4677'; ctx.shadowBlur = 3; ctx.shadowOffsetY = 1;
    ctx.beginPath(); stroke.points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)); ctx.stroke();
    ctx.strokeStyle = stroke.color; ctx.lineWidth = stroke.width; ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
    ctx.beginPath(); stroke.points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)); ctx.stroke(); ctx.restore();
  }
  const structure = buildWebStructure(strokes);
  ctx.fillStyle = '#fff2bd'; ctx.strokeStyle = '#28434d'; ctx.lineWidth = 1.5;
  for (const point of structure.junctions) { ctx.beginPath(); ctx.arc(point.x, point.y, 3.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
  ctx.restore();
}

function showToast(message: string): void { toast.textContent = message; toast.classList.add('visible'); window.setTimeout(() => toast.classList.remove('visible'), 2400); }
function updateStatus(): void { status.textContent = strokes.length ? `${strokes.length}本の糸 · ${weatherLabel[weather]}` : '指で線をかいてみよう'; }

function finishStroke(): void {
  if (!active) return;
  if (active.points.length > 1) {
    strokes.push(active); redoStack = []; const discoveries = getDiscoveries(strokes); spawnSpiderReaction();
    window.setTimeout(() => { if (strokes.length) spawnReaction('butterfly'); }, 900);
    window.setTimeout(() => { if (strokes.length) spawnReaction('ladybug'); }, 1500);
    showToast(discoveries.length > 1 ? 'すごい！いとがつながったよ ✨' : 'クモが線を見つけたよ 🕷️');
  }
  active = null; drawStrokes(); updateStatus();
}

drawing.addEventListener('pointerdown', (event) => {
  event.preventDefault(); if (event.pointerType === 'mouse' && event.button !== 0) return; const point = pointFromEvent(event);
  if (eraserMode) { const target = findNearestStroke(point, strokes); if (target) { strokes = strokes.filter((stroke) => stroke.id !== target.id); redoStack.push(target); drawStrokes(); updateStatus(); showToast('いとを1本けしたよ'); } return; }
  drawing.setPointerCapture(event.pointerId); active = { id: crypto.randomUUID(), points: [point], color, width, createdAt: Date.now() }; hint.classList.remove('visible'); drawStrokes();
}, { passive: false });
drawing.addEventListener('pointermove', (event) => { if (!active) return; event.preventDefault(); active.points = simplify([...active.points, pointFromEvent(event)], 4); drawStrokes(); }, { passive: false });
drawing.addEventListener('pointerup', finishStroke); drawing.addEventListener('pointercancel', finishStroke);

document.querySelectorAll<HTMLButtonElement>('.color-dot').forEach((button) => button.addEventListener('click', () => { color = button.dataset.color!; document.querySelector('.color-dot.selected')?.classList.remove('selected'); button.classList.add('selected'); }));
(document.querySelector('#size') as HTMLInputElement).addEventListener('input', (event) => { width = Number((event.target as HTMLInputElement).value); });
document.querySelector('#undo')!.addEventListener('click', () => { const stroke = strokes.pop(); if (stroke) { redoStack.push(stroke); removeAllCritters(); drawStrokes(); updateStatus(); showToast('ひとつもどしたよ'); } });
document.querySelector('#redo')!.addEventListener('click', () => { const stroke = redoStack.pop(); if (stroke) { strokes.push(stroke); drawStrokes(); updateStatus(); showToast('やりなおしたよ'); } });
document.querySelector('#eraser')!.addEventListener('click', (event) => { eraserMode = !eraserMode; (event.currentTarget as HTMLButtonElement).classList.toggle('active', eraserMode); showToast(eraserMode ? 'けしたい糸をタッチしてね' : 'おえかきにもどったよ'); });
document.querySelector('#clear')!.addEventListener('click', () => { if (!strokes.length) return; redoStack = [...strokes, ...redoStack]; strokes = []; removeAllCritters(); drawStrokes(); updateStatus(); showToast('まっさらになったよ'); });
document.querySelector('#weather-button')!.addEventListener('click', () => (document.querySelector('#weather-dialog') as HTMLDialogElement).showModal());
document.querySelectorAll<HTMLButtonElement>('[data-weather]').forEach((button) => button.addEventListener('click', () => { setWeather(button.dataset.weather as Weather); (document.querySelector('#weather-dialog') as HTMLDialogElement).close(); }));
document.querySelectorAll('.close-dialog').forEach((button) => button.addEventListener('click', () => (button.closest('dialog') as HTMLDialogElement).close()));
document.querySelector('#book')!.addEventListener('click', () => void openBook()); document.querySelector('#done')!.addEventListener('click', () => void saveCurrentArtwork());
(document.querySelector('#camera-button') as HTMLButtonElement).addEventListener('click', () => void startCamera());

function setWeather(nextWeather: Weather): void {
  weather = nextWeather; document.querySelector('#weather-button')!.textContent = weatherLabel[weather]; removeWeatherCritters(); updateStatus(); drawStrokes();
  stage.dataset.weather = weather;
  if (weather === 'rain') { spawnWeatherCritter('raindrop'); spawnWeatherCritter('raindrop'); }
  if (weather === 'wind') spawnWeatherCritter('leaf');
  showToast(weather === 'sunny' ? 'ひかりがぽかぽかだよ ☀️' : weather === 'rain' ? 'しずくがふってきたよ 💧' : 'かぜがそよいできたよ 🍃');
}

async function startCamera(): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia) { cameraState = '非対応（デモ背景）'; status.textContent = 'デモ背景でおえかき中'; return; }
  try { cameraStream?.getTracks().forEach((track) => track.stop()); cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }); video.srcObject = cameraStream; cameraState = '許可済み'; status.textContent = 'カメラの上におえかき中'; }
  catch { cameraState = '拒否（デモ背景）'; status.textContent = 'デモ背景でおえかき中'; showToast('カメラがなくてもあそべるよ'); }
}

function makeTexture(kind: Discovery): THREE.Texture {
  const cached = textureCache.get(kind); if (cached) return cached;
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 96; const context = canvas.getContext('2d')!;
  // Vector shapes avoid platform emoji/font failures and require no downloads.
  context.strokeStyle = '#183c46'; context.lineWidth = 4;
  context.fillStyle = { spider: '#73504a', butterfly: '#ff9cc3', ladybug: '#ef634f', raindrop: '#70d7ff', leaf: '#91cf62' }[kind];
  if (kind === 'spider') {
    for (let i = 0; i < 4; i++) { context.beginPath(); context.moveTo(48, 40 + i * 5); context.lineTo(12, 20 + i * 18); context.moveTo(48, 40 + i * 5); context.lineTo(84, 20 + i * 18); context.stroke(); }
  }
  context.beginPath(); context.ellipse(48, 48, kind === 'butterfly' ? 36 : 23, kind === 'leaf' ? 14 : 29, kind === 'leaf' ? -.5 : 0, 0, Math.PI * 2); context.fill(); context.stroke();
  if (kind === 'butterfly') { context.beginPath(); context.moveTo(48, 20); context.lineTo(48, 78); context.stroke(); }
  if (kind === 'ladybug') { for (const x of [37, 59]) for (const y of [38, 58]) { context.beginPath(); context.arc(x, y, 5, 0, Math.PI * 2); context.fillStyle = '#183c46'; context.fill(); } }
  if (kind === 'spider') { context.fillStyle = '#fff'; for (const x of [39, 57]) { context.beginPath(); context.arc(x, 39, 7, 0, Math.PI * 2); context.fill(); } }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; textureCache.set(kind, texture); return texture;
}

function addCritter(kind: Discovery, start: Point, path?: Point[]): Critter {
  generated++; if (kind === 'raindrop') rainCount++; if (kind === 'leaf') leafCount++;
  const critter: Critter = { kind, x: start.x, y: start.y, targetX: start.x, targetY: start.y, phase: Math.random() * 6, life: 0, path, pathIndex: path ? 1 : undefined };
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeTexture(kind), transparent: true, depthTest: false })); sprite.scale.set(kind === 'spider' ? 58 : 52, kind === 'spider' ? 58 : 52, 1); sprite.position.set(start.x, start.y, 1);
  sprite.position.y = stage.clientHeight - start.y;
  spriteGroup.add(sprite); sprites.set(critter, sprite); critters.push(critter); return critter;
}

function spawnReaction(kind: Discovery): void {
  if (critters.some((critter) => critter.kind === kind) || critters.length >= 10) return;
  const rect = stage.getBoundingClientRect(); const source = strokes[strokes.length - 1];
  const critter = addCritter(kind, kind === 'ladybug' && source ? source.points[Math.floor(source.points.length / 2)] : { x: rect.width * .45, y: rect.height * .45 });
  critter.targetX = Math.random() * Math.max(1, rect.width - 120) + 60; critter.targetY = Math.random() * (rect.height * .6) + rect.height * .2;
}
function spawnSpiderReaction(): void { const stroke = strokes[strokes.length - 1]; if (!stroke || stroke.points.length < 2) return; routes = strokes.map((s) => routePoints(s, strokes)); critters.filter((critter) => critter.kind === 'spider').forEach(removeCritter); addCritter('spider', stroke.points[0], [...routes[routes.length - 1]]); }

function spawnWeatherCritter(kind: 'raindrop' | 'leaf'): void {
  if (critters.filter((critter) => critter.kind === kind).length >= 4 || critters.length >= 10) return;
  const rect = stage.getBoundingClientRect();
  addCritter(kind, { x: kind === 'leaf' ? rect.width - 35 : 35 + Math.random() * Math.max(1, rect.width - 70), y: 35 + Math.random() * rect.height * .3 });
}

function removeCritter(critter: Critter): void { const sprite = sprites.get(critter); if (sprite) { spriteGroup.remove(sprite); sprite.material.dispose(); sprites.delete(critter); } const index = critters.indexOf(critter); if (index >= 0) critters.splice(index, 1); }
function removeAllCritters(): void { [...critters].forEach(removeCritter); }
function removeWeatherCritters(): void { [...critters].filter((critter) => critter.kind === 'raindrop' || critter.kind === 'leaf').forEach(removeCritter); }

function advanceCritter(critter: Critter, dt: number, index: number, rect: DOMRect): void {
  critter.life += dt;
  if (critter.kind === 'raindrop') { critter.y += 120 * dt; if (critter.y > rect.height + 30) { removeCritter(critter); return; } }
  else if (critter.kind === 'leaf') { critter.x -= 90 * dt; critter.y += Math.sin(critter.life * 3) * 20 * dt; if (critter.x < -30) { removeCritter(critter); return; } }
  else if (critter.kind === 'ladybug') { /* rests on the thread */ }
  else if (critter.path && critter.pathIndex !== undefined) {
    const target = critter.path[critter.pathIndex]; if (!target) { critter.path.reverse(); critter.pathIndex = 1; return; }
    const distance = Math.hypot(target.x - critter.x, target.y - critter.y); const speed = critter.kind === 'spider' ? 75 : 95;
    if (distance <= speed * dt) {
      critter.x = target.x; critter.y = target.y; critter.pathIndex += 1;
      if (critter.kind === 'spider' && !testStroke && Math.random() < .35) {
        const choices = routes.filter((route) => route.some((p) => Math.hypot(p.x - target.x, p.y - target.y) < .01));
        const route = choices[Math.floor(Math.random() * choices.length)];
        if (choices.length > 1 && route) { const at = route.findIndex((p) => Math.hypot(p.x - target.x, p.y - target.y) < .01); const branch = Math.random() < .5 ? route.slice(at) : route.slice(0, at + 1).reverse(); if (branch.length > 1) { critter.path = [...branch]; critter.pathIndex = 1; } }
      }
    } else { critter.x += (target.x - critter.x) / distance * speed * dt; critter.y += (target.y - critter.y) / distance * speed * dt; }
  } else {
    const speed = critter.kind === 'butterfly' ? 48 : 70; const angle = Math.atan2(critter.targetY - critter.y, critter.targetX - critter.x);
    critter.x += Math.cos(angle) * speed * dt; critter.y += Math.sin(angle) * speed * dt + Math.sin(critter.life * 5 + index) * .7;
    if (Math.hypot(critter.targetX - critter.x, critter.targetY - critter.y) < 16) { critter.targetX = Math.random() * Math.max(1, rect.width - 80) + 40; critter.targetY = Math.random() * (rect.height * .6) + rect.height * .2; }
  }
  const sprite = sprites.get(critter); if (!sprite) return; sprite.position.set(critter.x, rect.height - critter.y, 1); sprite.material.opacity = Math.min(1, critter.life * 3);
  if (critter.kind === 'butterfly') sprite.scale.x = 52 * (.65 + .35 * Math.abs(Math.sin(critter.life * 10)));
}

async function saveCurrentArtwork(): Promise<void> {
  const artwork: Artwork = { id: currentArtworkId ?? crypto.randomUUID(), createdAt: Date.now(), strokes: strokes.map((stroke) => ({ ...stroke, points: stroke.points.map((point) => ({ ...point })) })), weather, discoveries: [...new Set([...getDiscoveries(strokes), ...(weather === 'rain' ? ['raindrop' as Discovery] : []), ...(weather === 'wind' ? ['leaf' as Discovery] : [])])], webStructure: buildWebStructure(strokes) };
  try { await saveArtwork(artwork); currentArtworkId = artwork.id; debugValue('save', '成功'); showToast('作品をしまったよ 💛'); if (weather === 'rain') spawnWeatherCritter('raindrop'); if (weather === 'wind') spawnWeatherCritter('leaf'); }
  catch { debugValue('save', '失敗'); showToast('保存できなかったよ。もう一度ためしてね'); }
}

async function openBook(): Promise<void> {
  const list = await listArtworks(); const discoveries = [...new Set(list.flatMap((artwork) => artwork.discoveries))]; const bookList = document.querySelector('#book-list') as HTMLElement;
  bookList.innerHTML = `<div class="saved-artworks">${list.length ? list.map((artwork) => `<button class="saved-artwork" data-load-artwork="${artwork.id}">${new Date(artwork.createdAt).toLocaleDateString('ja-JP')} · ${artwork.strokes.length}本<br /><small>${weatherLabel[artwork.weather]}</small></button>`).join('') : '<p>まだ作品がないよ。描いて保存してみよう。</p>'}</div><div class="discovery-list">${['spider', 'butterfly', 'ladybug', 'raindrop', 'leaf'].map((item) => `<span class="discovery ${discoveries.includes(item as Discovery) ? '' : 'locked'}">${({ spider: '🕷️', butterfly: '🦋', ladybug: '🐞', raindrop: '💧', leaf: '🍃' } as Record<string, string>)[item]}<small>${discoveries.includes(item as Discovery) ? item : '？？？'}</small></span>`).join('')}</div>`;
  bookList.querySelectorAll<HTMLButtonElement>('[data-load-artwork]').forEach((button) => button.addEventListener('click', () => void loadArtwork(button.dataset.loadArtwork!))); (document.querySelector('#book-dialog') as HTMLDialogElement).showModal();
}

async function loadArtwork(id: string): Promise<void> {
  const artwork = (await listArtworks()).find((item) => item.id === id); if (!artwork) return; strokes = artwork.strokes.map((stroke) => ({ ...stroke, points: stroke.points.map((point) => ({ ...point })) })); redoStack = []; currentArtworkId = artwork.id; setWeather(artwork.weather); removeAllCritters(); if (strokes.length) spawnSpiderReaction(); drawStrokes(); updateStatus(); (document.querySelector('#book-dialog') as HTMLDialogElement).close(); showToast('作品をひらいたよ');
}

async function runSaveTest(): Promise<void> {
  if (!('indexedDB' in window)) { debugValue('save', 'IndexedDB非対応：既存保存を保護しテスト省略'); return; }
  const testArtwork: Artwork = { id: `debug-${crypto.randomUUID()}`, createdAt: Date.now(), strokes: [{ id: 'debug-stroke', points: [{ x: 2, y: 2 }, { x: 12, y: 12 }], color: '#fffaf0', width: 2, createdAt: Date.now() }], weather: 'sunny', discoveries: ['spider'] };
  try { await saveArtwork(testArtwork); const found = (await listArtworks()).some((artwork) => artwork.id === testArtwork.id); await deleteArtwork(testArtwork.id); debugValue('save', found ? 'テスト成功' : 'テスト失敗'); showToast(found ? '保存テスト成功 🌟' : '保存テスト失敗'); } catch { debugValue('save', 'テスト失敗'); showToast('保存テストに失敗したよ'); }
}

function updateDebug(now: number): void {
  if (now - fpsWindowStart >= 500) { fps = Math.round(fpsFrames * 1000 / (now - fpsWindowStart)); fpsFrames = 0; fpsWindowStart = now; }
  debugValue('fps', `${fps}`); debugValue('strokes', `${strokes.length}`); debugValue('points', `${strokes.reduce((total, stroke) => total + stroke.points.length, 0)}`); debugValue('intersections', `${countIntersections(strokes)}`); debugValue('critters', critters.map((critter) => critter.kind).join(', ') || 'なし'); debugValue('weather', weatherLabel[weather]); debugValue('camera', cameraState);
  debugValue('raf', String(rafCount)); debugValue('updates', String(updateCount)); debugValue('time', `${Math.round(now)} ms`);
  debugValue('generated', String(generated)); debugValue('visible', String(critters.filter((c) => c.x >= 0 && c.x <= stage.clientWidth && c.y >= 0 && c.y <= stage.clientHeight).length));
  debugValue('positions', critters.map((c) => `${c.kind}: ${Math.round(c.x)},${Math.round(c.y)}`).join('\n'));
  debugValue('rain', String(rainCount)); debugValue('leaf', String(leafCount)); debugValue('webgl', webglState); debugValue('error', lastError || 'なし');
}

function forceTest(kind: Discovery): void {
  const x = stage.clientWidth / 2, y = stage.clientHeight / 2;
  if (kind === 'spider') {
    testStroke = { id: 'diagnostic-only', createdAt: 0, color: '#ffd166', width: 5, points: [{ x: x - 100, y }, { x: x + 100, y }] };
    drawStrokes(); addCritter(kind, testStroke.points[0], [...testStroke.points]);
    window.setTimeout(() => { testStroke = null; drawStrokes(); }, 15000);
  } else if (kind === 'raindrop' || kind === 'leaf') { setWeather(kind === 'raindrop' ? 'rain' : 'wind'); addCritter(kind, { x, y }); }
  else addCritter(kind, { x, y });
  while (critters.length > 10) removeCritter(critters[0]);
}

function renderEffects(): void {
  const context = fallback.getContext('2d')!;
  context.clearRect(0, 0, fallback.width, fallback.height);
  if (renderer && webglState !== 'Canvas 2D') { renderer.domElement.style.visibility = 'visible'; renderer.render(scene, camera); if (webglState !== 'Canvas 2D') webglState = 'WebGL描画中'; return; }
  if (renderer) renderer.domElement.style.visibility = 'hidden';
  for (const c of critters) {
    const image = makeTexture(c.kind).image as HTMLCanvasElement;
    context.drawImage(image, c.x - 26, c.y - 26, 52, 52);
  }
}

function animate(now: number): void {
  if (document.hidden) { rafHandle = 0; return; }
  rafHandle = requestAnimationFrame(animate); rafCount++;
  if (now - lastRenderTime < 1000 / 30) return;
  lastRenderTime = now;
  try {
  const dt = Math.min((now - lastTime) / 1000, .05); lastTime = now; windTime += dt; const rect = stage.getBoundingClientRect();
  updateCount++;
  if (weather === 'rain' && Math.random() < dt * 5) spawnWeatherCritter('raindrop'); if (weather === 'wind' && Math.random() < dt * 1.2) spawnWeatherCritter('leaf');
  [...critters].forEach((critter, index) => { advanceCritter(critter, dt, index, rect); if ((critter.kind === 'leaf' && critter.x < -60) || (critter.kind === 'raindrop' && critter.y > rect.height + 60)) removeCritter(critter); });
  while (critters.length > 10) removeCritter(critters[0]); if (weather === 'wind') drawStrokes(); renderEffects();
  } catch (error) { lastError = String(error); webglState = 'Canvas 2D'; }
  if (isDebug) { fpsFrames++; if (now - lastDebugTime > 250) { updateDebug(now); lastDebugTime = now; } }
}

document.addEventListener('visibilitychange', () => { lastTime = performance.now(); });
function resumeAnimation(): void { lastTime = performance.now(); lastRenderTime = lastTime; if (!document.hidden && !rafHandle) rafHandle = requestAnimationFrame(animate); }
document.addEventListener('visibilitychange', resumeAnimation);
window.addEventListener('pageshow', resumeAnimation);
window.addEventListener('pagehide', () => { if (rafHandle) cancelAnimationFrame(rafHandle); rafHandle = 0; cameraStream?.getTracks().forEach((track) => track.stop()); cameraStream = null; });

setupDebug(); window.addEventListener('resize', resize); resize(); void startCamera(); updateStatus(); requestAnimationFrame(animate);
