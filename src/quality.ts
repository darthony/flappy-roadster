/**
 * Perfil de calidad: en móvil se recorta lo que más castiga a la GPU
 * (sombras, luces por vehículo, bloom, resolución). Se puede forzar por URL:
 *   ?quality=low | high   ?nobloom   ?noshadow   ?nolights
 */
export interface Quality {
  profile: 'low' | 'high';
  gpu: string;
  reason: string;
  bloom: boolean;
  shadows: boolean;
  neonLights: number;
  vehicleSpots: boolean;
  maxPixelRatio: number;
  particles: number;
  haze: boolean;
  /** Sustituye materiales físicos del modelo por estándar (shaders más simples). */
  simpleMaterials: boolean;
  /** Halos, conos de faro y sombra difusa pintados, en lugar de bloom, focos y sombras reales. */
  fakes: boolean;
  /** Si el dispositivo rinde, activar bloom a baja resolución tras medir fps. */
  adaptiveBloom: boolean;
}

const KEY = 'flappy-roadster-quality';

/** Guarda la decisión de calidad para las próximas visitas (por ejemplo, tras una preparación lenta). */
export function rememberQuality(profile: Quality['profile'] | null): void {
  try { profile ? localStorage.setItem(KEY, profile) : localStorage.removeItem(KEY); } catch { /* sin almacenamiento */ }
}

function remembered(): Quality['profile'] | null {
  try { const v = localStorage.getItem(KEY); return v === 'low' || v === 'high' ? v : null; } catch { return null; }
}

/** Nombre de la GPU según WebGL; sirve para reconocer renderizado por software o gráficos integrados débiles. */
export function gpuName(): string {
  try {
    const gl = document.createElement('canvas').getContext('webgl2') ?? document.createElement('canvas').getContext('webgl');
    if (!gl) return 'sin webgl';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return name;
  } catch { return 'desconocida'; }
}

/** GPUs que no aguantan el perfil alto: renderizado por software y gráficos integrados antiguos. */
const WEAK_GPU = /SwiftShader|llvmpipe|softpipe|Mesa OffScreen|Intel\(R\) (HD|UHD) Graphics (4|5|6)\d\d|Intel\(R\) Iris\(TM\)|Mali-4|Mali-T|Adreno \(TM\) [345]\d\d|PowerVR/i;

export function detectQuality(): Quality {
  const q = new URLSearchParams(location.search);
  const coarse = matchMedia('(pointer: coarse)').matches;
  const small = Math.min(innerWidth, innerHeight) < 700;
  const mobile = coarse || (navigator.maxTouchPoints > 0 && small);
  const forced = q.get('quality');
  if (forced === 'high' || forced === 'low') rememberQuality(null);
  const gpu = gpuName();
  const weak = WEAK_GPU.test(gpu) || (navigator.hardwareConcurrency ?? 8) <= 2;
  const profile: Quality['profile'] = forced === 'high' ? 'high'
    : forced === 'low' || mobile || weak || remembered() === 'low' ? 'low' : 'high';
  const low = profile === 'low';
  return {
    profile,
    gpu,
    reason: forced ? 'url' : mobile ? 'móvil' : weak ? 'gpu débil' : remembered() === 'low' ? 'preparación lenta anterior' : 'por defecto',
    bloom: !q.has('nobloom') && !low,
    shadows: !q.has('noshadow') && !low,
    neonLights: q.has('nolights') ? 0 : low ? 2 : 6,
    vehicleSpots: !q.has('nolights') && !low,
    maxPixelRatio: low ? 1.5 : 2,
    particles: low ? 500 : 1000,
    haze: !low,
    simpleMaterials: low || q.has('simple'),
    fakes: low || q.has('fakes'),
    adaptiveBloom: low && !q.has('nobloom'),
  };
}
