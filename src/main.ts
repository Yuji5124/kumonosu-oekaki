import * as THREE from 'three';
import type { Artwork, Critter, Discovery, Point, Stroke, Weather } from './types';
import { findNearestStroke, getDiscoveries, simplify, weatherLabel } from './simulation/webState';
import { listArtworks, saveArtwork } from './storage';
import './styles.css';

const stage = document.querySelector('.stage') as HTMLElement;
const video = document.querySelector('#camera') as HTMLVideoElement;
const drawing = document.querySelector('#drawing') as HTMLCanvasElement;
const ctx = drawing.getContext('2d')!;
const threeLayer = document.querySelector('#three-layer') as HTMLElement;
const status = document.querySelector('#status') as HTMLElement;
const hint = document.querySelector('#hint') as HTMLElement;
const toast = document.querySelector('#toast') as HTMLElement;
let strokes: Stroke[] = []; let redoStack: Stroke[] = []; let active: Stroke | null = null; let color = '#fffaf0'; let width = 4; let weather: Weather = 'sunny'; let cameraStream: MediaStream | null = null; let eraserMode = false;
const critters: Critter[] = []; let lastTime = performance.now();

const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, powerPreference: 'low-power' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); renderer.setClearColor(0, 0); threeLayer.append(renderer.domElement);
const scene = new THREE.Scene(); const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 100); camera.position.z = 10;
const sprites = new THREE.Group(); scene.add(sprites);

function resize(): void { const rect = stage.getBoundingClientRect(); drawing.width = rect.width * devicePixelRatio; drawing.height = rect.height * devicePixelRatio; drawing.style.width = `${rect.width}px`; drawing.style.height = `${rect.height}px`; renderer.setSize(rect.width, rect.height, false); camera.left = 0; camera.right = rect.width; camera.top = 0; camera.bottom = rect.height; camera.updateProjectionMatrix(); drawStrokes(); }
function pointFromEvent(event: PointerEvent): Point { const rect = drawing.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; }
function drawStrokes(): void { ctx.save(); ctx.scale(devicePixelRatio, devicePixelRatio); ctx.clearRect(0, 0, drawing.width, drawing.height); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; for (const stroke of [...strokes, ...(active ? [active] : [])]) { ctx.strokeStyle = stroke.color; ctx.lineWidth = stroke.width; ctx.beginPath(); stroke.points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.stroke(); } ctx.restore(); }
function showToast(message: string): void { toast.textContent = message; toast.classList.add('visible'); window.setTimeout(() => toast.classList.remove('visible'), 2200); }
function updateStatus(): void { status.textContent = strokes.length ? `${strokes.length}本の糸 · ${weatherLabel[weather]}` : '指で線をかいてみよう'; }

drawing.addEventListener('pointerdown', (event) => { if (event.pointerType === 'mouse' && event.button !== 0) return; const point = pointFromEvent(event); if (eraserMode) { const target = findNearestStroke(point, strokes); if (target) { strokes = strokes.filter((stroke) => stroke.id !== target.id); redoStack.push(target); drawStrokes(); updateStatus(); showToast('いとを1本けしたよ'); } return; } drawing.setPointerCapture(event.pointerId); active = { id: crypto.randomUUID(), points: [point], color, width, createdAt: Date.now() }; hint.classList.remove('visible'); drawStrokes(); });
drawing.addEventListener('pointermove', (event) => { if (!active) return; active.points = simplify([...active.points, pointFromEvent(event)]); drawStrokes(); });
drawing.addEventListener('pointerup', () => { if (!active) return; if (active.points.length > 1) { strokes.push(active); redoStack = []; const discoveries = getDiscoveries(strokes); if (discoveries.includes('spider')) spawnCritter('spider'); if (discoveries.includes('butterfly') && !critters.some((c) => c.kind === 'butterfly')) spawnCritter('butterfly'); if (discoveries.includes('ladybug') && !critters.some((c) => c.kind === 'ladybug')) spawnCritter('ladybug'); showToast(discoveries.length > 1 ? 'すごい！いとがつながったよ ✨' : 'クモがあそびにきたよ 🕷️'); } active = null; drawStrokes(); updateStatus(); });

document.querySelectorAll<HTMLButtonElement>('.color-dot').forEach((button) => button.addEventListener('click', () => { color = button.dataset.color!; document.querySelector('.color-dot.selected')?.classList.remove('selected'); button.classList.add('selected'); }));
(document.querySelector('#size') as HTMLInputElement).addEventListener('input', (event) => { width = Number((event.target as HTMLInputElement).value); });
document.querySelector('#undo')!.addEventListener('click', () => { const stroke = strokes.pop(); if (stroke) { redoStack.push(stroke); drawStrokes(); updateStatus(); showToast('ひとつもどしたよ'); } });
document.querySelector('#redo')!.addEventListener('click', () => { const stroke = redoStack.pop(); if (stroke) { strokes.push(stroke); drawStrokes(); updateStatus(); showToast('やりなおしたよ'); } });
document.querySelector('#eraser')!.addEventListener('click', (event) => { eraserMode = !eraserMode; (event.currentTarget as HTMLButtonElement).classList.toggle('active', eraserMode); showToast(eraserMode ? 'けしたい糸をタッチしてね' : 'おえかきにもどったよ'); });
document.querySelector('#clear')!.addEventListener('click', () => { if (!strokes.length) return; redoStack = [...strokes, ...redoStack]; strokes = []; critters.length = 0; sprites.clear(); drawStrokes(); updateStatus(); showToast('まっさらになったよ'); });
document.querySelector('#weather-button')!.addEventListener('click', () => (document.querySelector('#weather-dialog') as HTMLDialogElement).showModal());
document.querySelectorAll<HTMLButtonElement>('[data-weather]').forEach((button) => button.addEventListener('click', () => { weather = button.dataset.weather as Weather; (document.querySelector('#weather-dialog') as HTMLDialogElement).close(); (document.querySelector('#weather-button') as HTMLButtonElement).textContent = weatherLabel[weather]; updateStatus(); showToast(`${weatherLabel[weather]}にしたよ`); }));
document.querySelectorAll('.close-dialog').forEach((button) => button.addEventListener('click', () => (button.closest('dialog') as HTMLDialogElement).close()));
(document.querySelector('#book') as HTMLButtonElement).addEventListener('click', async () => { const list = await listArtworks(); const discoveries = [...new Set(list.flatMap((a) => a.discoveries))]; (document.querySelector('#book-list') as HTMLElement).innerHTML = ['spider', 'butterfly', 'ladybug', 'raindrop', 'leaf'].map((item) => `<span class="discovery ${discoveries.includes(item as Discovery) ? '' : 'locked'}">${({ spider: '🕷️', butterfly: '🦋', ladybug: '🐞', raindrop: '💧', leaf: '🍃' } as Record<string, string>)[item]}<small>${discoveries.includes(item as Discovery) ? item : '？？？'}</small></span>`).join(''); (document.querySelector('#book-dialog') as HTMLDialogElement).showModal(); });
(document.querySelector('#done') as HTMLButtonElement).addEventListener('click', async () => { const artwork: Artwork = { id: crypto.randomUUID(), createdAt: Date.now(), strokes, weather, discoveries: [...new Set([...getDiscoveries(strokes), ...(weather === 'rain' ? ['raindrop' as Discovery] : []), ...(weather === 'wind' ? ['leaf' as Discovery] : [])]) ] }; await saveArtwork(artwork); if (weather === 'rain') spawnCritter('raindrop'); if (weather === 'wind') spawnCritter('leaf'); showToast('作品をしまったよ 💛'); });
(document.querySelector('#camera-button') as HTMLButtonElement).addEventListener('click', startCamera);

async function startCamera(): Promise<void> { if (!navigator.mediaDevices?.getUserMedia) { status.textContent = 'デモ背景でおえかき中'; return; } try { cameraStream?.getTracks().forEach((track) => track.stop()); cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }); video.srcObject = cameraStream; status.textContent = 'カメラの上におえかき中'; } catch { status.textContent = 'デモ背景でおえかき中'; showToast('カメラがなくてもあそべるよ'); } }

function spawnCritter(kind: Discovery): void { const rect = stage.getBoundingClientRect(); critters.push({ kind, x: Math.random() * rect.width, y: Math.random() * rect.height * .7 + rect.height * .15, targetX: Math.random() * rect.width, targetY: Math.random() * rect.height * .7 + rect.height * .15, phase: Math.random() * 6, life: 0 }); }
function emojiTexture(kind: Discovery): THREE.Sprite { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 96; const context = canvas.getContext('2d')!; context.font = '72px sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText(({ spider: '🕷️', butterfly: '🦋', ladybug: '🐞', raindrop: '💧', leaf: '🍃' } as Record<string, string>)[kind], 48, 50); const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true })); sprite.scale.set(52, 52, 1); return sprite; }
function animate(now: number): void { const dt = Math.min((now - lastTime) / 1000, .05); lastTime = now; const rect = stage.getBoundingClientRect(); for (let i = sprites.children.length - 1; i >= 0; i--) sprites.remove(sprites.children[i]); critters.forEach((critter, index) => { critter.life += dt; if (Math.hypot(critter.targetX - critter.x, critter.targetY - critter.y) < 12) { critter.targetX = Math.random() * rect.width; critter.targetY = Math.random() * rect.height * .7 + rect.height * .15; } const speed = critter.kind === 'spider' ? 24 : 38; const angle = Math.atan2(critter.targetY - critter.y, critter.targetX - critter.x); critter.x += Math.cos(angle) * speed * dt; critter.y += Math.sin(angle) * speed * dt + Math.sin(critter.life * 4 + index) * 0.3; const sprite = emojiTexture(critter.kind); sprite.position.set(critter.x, critter.y, 1); sprite.material.opacity = Math.min(1, critter.life * 2); sprites.add(sprite); }); if (weather === 'rain' && Math.random() < dt * 5) spawnCritter('raindrop'); if (weather === 'wind' && Math.random() < dt * 1.2) spawnCritter('leaf'); while (critters.length > 10) critters.shift(); renderer.render(scene, camera); requestAnimationFrame(animate); }

window.addEventListener('resize', resize); resize(); startCamera(); updateStatus(); requestAnimationFrame(animate);
