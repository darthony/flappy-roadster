import * as THREE from 'three';

/**
 * Efectos "pintados" para el perfil móvil: halos aditivos, conos de faro y sombra difusa.
 * Imitan el bloom, los focos y las sombras en tiempo real a coste casi nulo.
 */

let discTex: THREE.Texture | undefined;
function disc(): THREE.Texture {
  if (discTex) return discTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  discTex = new THREE.CanvasTexture(c);
  discTex.colorSpace = THREE.SRGBColorSpace;
  return discTex;
}

let coneTex: THREE.Texture | undefined;
function cone(): THREE.Texture {
  if (coneTex) return coneTex;
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const ctx = c.getContext('2d')!;
  // Haz que se abre y se desvanece hacia abajo (el origen del faro está arriba).
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.25)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.moveTo(56, 0); ctx.lineTo(72, 0); ctx.lineTo(128, 256); ctx.lineTo(0, 256); ctx.closePath(); ctx.fill();
  coneTex = new THREE.CanvasTexture(c);
  coneTex.colorSpace = THREE.SRGBColorSpace;
  return coneTex;
}

/** Halo aditivo (sprite que siempre mira a cámara). */
export function glowSprite(color: THREE.ColorRepresentation, size: number, opacity = 0.8): THREE.Sprite {
  const m = new THREE.SpriteMaterial({ map: disc(), color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
  const s = new THREE.Sprite(m);
  s.scale.set(size, size, 1);
  return s;
}

/** Halo alargado sobre una tira (neón): plano aditivo tumbado. */
export function glowStrip(color: THREE.ColorRepresentation, length: number, width: number, opacity = 0.55): THREE.Mesh {
  const m = new THREE.MeshBasicMaterial({ map: disc(), color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(length, width), m);
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

/** Cono de luz de un faro, apuntando hacia +X local y cayendo al suelo. */
export function headlightCone(length = 9, width = 3.2, opacity = 0.35): THREE.Mesh {
  const m = new THREE.MeshBasicMaterial({ map: cone(), color: 0xdfe9ff, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, length), m);
  // El plano se tumba sobre el suelo y su "arriba" (origen del haz) queda en el faro.
  mesh.rotation.x = -Math.PI / 2;
  mesh.rotation.z = Math.PI / 2;
  mesh.position.set(length / 2, 0.02, 0);
  return mesh;
}

/** Charco de luz en el suelo bajo un faro. */
export function lightPool(color: THREE.ColorRepresentation, size: number, opacity = 0.5): THREE.Mesh {
  const m = new THREE.MeshBasicMaterial({ map: disc(), color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), m);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.015;
  return mesh;
}

/** Sombra difusa bajo el coche: sustituye al mapa de sombras. */
export function blobShadow(length: number, width: number): THREE.Mesh {
  const m = new THREE.MeshBasicMaterial({ map: disc(), color: 0x000000, transparent: true, opacity: 0.75, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(length, width), m);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.01;
  return mesh;
}
