import {useEffect, useRef, useState} from 'react';
import {Box, RotateCcw} from 'lucide-react';
import Tooltip from '../../ui/Tooltip';

// One conventional FCC cell centred at the origin, in half-lattice units.
const sites: number[][] = [];
for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) {
  if ([x, y, z].filter(value => value === 0).length % 2 === 0) sites.push([x, y, z]);
}
const pairs = sites.flatMap((from, a) => sites.slice(a + 1).flatMap((to, offset) => {
  const distance = from.reduce((sum, value, i) => sum + (value - to[i]) ** 2, 0);
  const edge = distance === 4 && from.every(Boolean) && to.every(Boolean);
  return distance === 2 || edge ? [{a, b: a + offset + 1, edge}] : [];
}));
const initial = {yaw: -0.62, pitch: 0.36};

function draw(canvas: HTMLCanvasElement, yaw: number, pitch: number) {
  const ctx = canvas.getContext('2d');
  const {width, height} = canvas.getBoundingClientRect();
  if (!ctx || !width || !height) return;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * pixelRatio);
  canvas.height = Math.round(height * pixelRatio);
  ctx.scale(pixelRatio, pixelRatio);
  const scale = Math.min(width / 3.7, height / 3.8);
  const points = sites.map(([x, y, z]) => {
    const side = z * Math.cos(yaw) - x * Math.sin(yaw);
    const depth = side * Math.cos(pitch) + y * Math.sin(pitch);
    return {x: width / 2 + (x * Math.cos(yaw) + z * Math.sin(yaw)) * scale,
      y: height / 2 - (y * Math.cos(pitch) - side * Math.sin(pitch)) * scale,
      z: depth, r: scale * (0.155 + depth * 0.013)};
  });
  const elements = [
    ...points.map((p, i) => ({z: p.z, atom: i, pair: -1})),
    ...pairs.map((pair, i) => ({z: (points[pair.a].z + points[pair.b].z) / 2, atom: -1, pair: i}))
  ].sort((a, b) => a.z - b.z);
  for (const {atom, pair, z} of elements) {
    if (pair >= 0) {
      const {a, b, edge} = pairs[pair], from = points[a], to = points[b];
      const length = Math.hypot(to.x - from.x, to.y - from.y);
      if (length <= from.r + to.r) continue;
      const dx = (to.x - from.x) / length, dy = (to.y - from.y) / length;
      ctx.strokeStyle = edge ? 'rgba(224,204,248,.56)' : 'rgba(215,178,227,' + (0.34 + z * 0.09) + ')';
      ctx.lineWidth = edge ? 1.3 : 2.4;
      ctx.beginPath(); ctx.moveTo(from.x + dx * from.r, from.y + dy * from.r);
      ctx.lineTo(to.x - dx * to.r, to.y - dy * to.r); ctx.stroke();
      continue;
    }
    const p = points[atom], r = p.r;
    const surface = ctx.createRadialGradient(p.x - r * 0.38, p.y - r * 0.47, r * 0.04, p.x, p.y, r);
    surface.addColorStop(0, '#fff5e6'); surface.addColorStop(0.18, '#f8d6c4');
    surface.addColorStop(0.43, '#d6a3a6'); surface.addColorStop(0.75, '#9a748e');
    surface.addColorStop(0.91, '#605572'); surface.addColorStop(1, '#b5a4be');
    ctx.fillStyle = surface; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
  }
}

export default function CopperCell({english}: {english: boolean}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{x: number; y: number} | null>(null);
  const [angle, setAngle] = useState(initial);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const paint = () => draw(element, angle.yaw, angle.pitch);
    paint();
    const observer = new ResizeObserver(paint);
    observer.observe(element);
    return () => observer.disconnect();
  }, [angle]);
  function rotate(dx: number, dy: number) {
    setAngle(previous => ({yaw: previous.yaw + dx, pitch: Math.max(-1.4, Math.min(1.4, previous.pitch + dy))}));
  }
  return <aside className="setup-specimen">
    <div className="setup-specimen-head"><span><Box size={16}/>{english ? 'Drag to rotate' : '拖动旋转晶胞'}</span>
      <Tooltip asChild content={english?'Reset view':'复位视角'}><button type="button" onClick={()=>setAngle(initial)} aria-label={english?'Reset view':'复位视角'}><RotateCcw size={16} aria-hidden="true"/></button></Tooltip></div>
    <canvas ref={canvas} tabIndex={0} role="img" aria-label={english ? 'Copper unit cell. Drag or use arrow keys to rotate.' : '铜的面心立方晶胞。拖动或使用方向键旋转。'}
      onKeyDown={event => {
        if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
        event.preventDefault(); rotate(event.key === 'ArrowLeft' ? -0.16 : event.key === 'ArrowRight' ? 0.16 : 0, event.key === 'ArrowUp' ? 0.16 : event.key === 'ArrowDown' ? -0.16 : 0);
      }}
      onPointerDown={event => {drag.current = {x:event.clientX, y:event.clientY}; event.currentTarget.setPointerCapture(event.pointerId);}}
      onPointerMove={event => {if (!drag.current) return; rotate((event.clientX-drag.current.x)*0.012, (event.clientY-drag.current.y)*0.012); drag.current={x:event.clientX,y:event.clientY};}}
      onLostPointerCapture={() => {drag.current=null;}}/>
    <div className="setup-specimen-caption"><div className="setup-element"><small>29</small><strong>Cu</strong></div>
      <div><strong>{english ? 'Copper' : '铜'}</strong><span>{english ? 'Face-centred cubic' : '面心立方晶体'}</span></div></div>
  </aside>;
}
