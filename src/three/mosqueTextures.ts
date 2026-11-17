import * as THREE from 'three';

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('2D canvas context unavailable');
  }
  return [canvas, ctx];
}

export function createMosqueCarpetTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(1024, 1024);

  // Deep royal blue Ottoman carpet base
  ctx.fillStyle = '#12275A';
  ctx.fillRect(0, 0, 1024, 1024);

  // Subtle woven wool grain
  for (let y = 0; y < 1024; y += 4) {
    ctx.fillStyle = y % 8 === 0 ? 'rgba(255,255,255,0.025)' : 'rgba(5,10,25,0.08)';
    ctx.fillRect(0, y, 1024, 2);
  }

  // Prayer row (Saf) horizontal bands with subtle gold & midnight navy trim
  const rowCount = 4;
  const rowH = 1024 / rowCount;
  for (let r = 0; r < rowCount; r++) {
    const y0 = r * rowH;
    // Outer band
    ctx.strokeStyle = 'rgba(201, 164, 92, 0.42)';
    ctx.lineWidth = 4;
    ctx.strokeRect(18, y0 + 14, 988, rowH - 28);

    ctx.strokeStyle = 'rgba(13, 25, 58, 0.75)';
    ctx.lineWidth = 10;
    ctx.strokeRect(30, y0 + 26, 964, rowH - 52);

    // Subtle arched saf motifs across the width
    const cols = 4;
    const colW = 940 / cols;
    for (let c = 0; c < cols; c++) {
      const cx = 42 + c * colW + colW / 2;
      const cy = y0 + rowH / 2;
      ctx.save();
      ctx.strokeStyle = 'rgba(212, 178, 106, 0.28)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(cx - colW * 0.36, y0 + rowH - 42);
      ctx.lineTo(cx - colW * 0.36, cy - 10);
      ctx.quadraticCurveTo(cx - colW * 0.36, y0 + 44, cx, y0 + 36);
      ctx.quadraticCurveTo(cx + colW * 0.36, y0 + 44, cx + colW * 0.36, cy - 10);
      ctx.lineTo(cx + colW * 0.36, y0 + rowH - 42);
      ctx.stroke();

      // Central 8-point rosette
      ctx.translate(cx, cy + 12);
      ctx.strokeStyle = 'rgba(229, 200, 139, 0.22)';
      ctx.lineWidth = 2;
      ctx.strokeRect(-22, -22, 44, 44);
      ctx.rotate(Math.PI / 4);
      ctx.strokeRect(-22, -22, 44, 44);
      ctx.restore();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2.5, 2.5);
  tex.anisotropy = Math.min(8, maxAnisotropy);
  return tex;
}

export function createIznikTileTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(512, 512);

  // Midnight cobalt glaze
  ctx.fillStyle = '#0D1E47';
  ctx.fillRect(0, 0, 512, 512);

  const cell = 128;
  for (let gx = 0; gx < 512; gx += cell) {
    for (let gy = 0; gy < 512; gy += cell) {
      const cx = gx + cell / 2;
      const cy = gy + cell / 2;

      // Tile grout border
      ctx.strokeStyle = 'rgba(201, 164, 92, 0.32)';
      ctx.lineWidth = 2;
      ctx.strokeRect(gx + 2, gy + 2, cell - 4, cell - 4);

      // Royal blue inner square
      ctx.fillStyle = '#16326E';
      ctx.fillRect(gx + 10, gy + 10, cell - 20, cell - 20);

      // 8-point Islamic geometric star
      ctx.save();
      ctx.translate(cx, cy);
      ctx.strokeStyle = '#D9BA73';
      ctx.lineWidth = 2.2;
      ctx.fillStyle = 'rgba(201, 164, 92, 0.14)';
      ctx.beginPath();
      ctx.rect(-28, -28, 56, 56);
      ctx.fill();
      ctx.stroke();

      ctx.rotate(Math.PI / 4);
      ctx.beginPath();
      ctx.rect(-28, -28, 56, 56);
      ctx.fill();
      ctx.stroke();

      // Center turquoise-blue medallion
      ctx.fillStyle = '#1E4C9A';
      ctx.beginPath();
      ctx.arc(0, 0, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#E6CA8E';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 4);
  tex.anisotropy = Math.min(8, maxAnisotropy);
  return tex;
}

export function createWarmStoneTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(512, 512);
  ctx.fillStyle = '#E5DEC9';
  ctx.fillRect(0, 0, 512, 512);

  // Subtle limestone veining and block seams
  for (let i = 0; i < 650; i++) {
    const x = (i * 73) % 512;
    const y = (i * 137) % 512;
    const w = 12 + (i % 24);
    ctx.fillStyle = i % 2 === 0 ? 'rgba(180, 165, 138, 0.08)' : 'rgba(255, 250, 238, 0.1)';
    ctx.fillRect(x, y, w, 3);
  }

  ctx.strokeStyle = 'rgba(155, 140, 112, 0.25)';
  ctx.lineWidth = 2;
  for (let y = 0; y < 512; y += 128) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(512, y);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  tex.anisotropy = Math.min(8, maxAnisotropy);
  return tex;
}

export function createContactShadowTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(256, 256);
  const grad = ctx.createRadialGradient(128, 128, 12, 128, 128, 122);
  grad.addColorStop(0, 'rgba(3, 6, 15, 0.72)');
  grad.addColorStop(0.55, 'rgba(3, 6, 15, 0.34)');
  grad.addColorStop(1, 'rgba(3, 6, 15, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
