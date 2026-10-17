/**
 * Perfil de calidad: en móvil se recorta lo que más castiga a la GPU
 * (sombras, luces por vehículo, bloom, resolución). Se puede forzar por URL:
 *   ?quality=low | high   ?nobloom   ?noshadow   ?nolights
 */
export interface Quality {
  profile: 'low' | 'high';
  /** `ultra`: dispositivos muy justos (iPhone 8 y similares): coche procedural, sin modelo descargado. */
  tier: 'ultra' | 'low' | 'high';
  /** Cargar el modelo glTF del Roadster (en ultra se usa el procedural). */
  useModel: boolean;
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
export function rememberQuality(tier: Quality['tier'] | null): void {
  try { tier ? localStorage.setItem(KEY, tier) : localStorage.removeItem(KEY); } catch { /* sin almacenamiento */ }
}

function remembered(): Quality['tier'] | null {
  try { const v = localStorage.getItem(KEY); return v === 'low' || v === 'high' || v === 'ultra' ? v : null; } catch { return null; }
}

/** iPhone 8 / SE y anteriores: iOS 16 o menos, o pantalla de 375x667 a 2x en Safari móvil. */
function tinyIphone(): boolean {
  const ua = navigator.userAgent;
  if (!/iPhone/.test(ua)) return false;
  const ios = Number(ua.match(/OS (\d+)_/)?.[1] ?? 99);
  const smallScreen = Math.max(screen.width, screen.height) <= 667 && devicePixelRatio <= 2;
  return ios <= 16 || smallScreen;
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
  if (forced === 'high' || forced === 'low' || forced === 'ultra') rememberQuality(null);
  const gpu = gpuName();
  const weak = WEAK_GPU.test(gpu) || (navigator.hardwareConcurrency ?? 8) <= 2;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const tiny = tinyIphone() || (mem !== undefined && mem <= 2);
  const tier: Quality['tier'] = forced === 'high' ? 'high' : forced === 'ultra' || tiny || remembered() === 'ultra' ? 'ultra'
    : forced === 'low' || mobile || weak || remembered() === 'low' ? 'low' : 'high';
  const profile: Quality['profile'] = tier === 'high' ? 'high' : 'low';
  const ultra = tier === 'ultra';
  const low = profile === 'low';
  return {
    profile,
    gpu,
    tier,
    useModel: !ultra,
    reason: forced ? 'url' : tiny ? 'dispositivo muy justo' : remembered() ? 'preparación lenta anterior' : mobile ? 'móvil' : weak ? 'gpu débil' : 'por defecto',
    bloom: !q.has('nobloom') && !low,
    shadows: !q.has('noshadow') && !low,
    neonLights: q.has('nolights') ? 0 : ultra ? 1 : low ? 2 : 6,
    vehicleSpots: !q.has('nolights') && !low,
    maxPixelRatio: ultra ? 1 : low ? 1.5 : 2,
    particles: ultra ? 220 : low ? 500 : 1000,
    haze: !low,
    simpleMaterials: low || q.has('simple'),
    fakes: low || q.has('fakes'),
    adaptiveBloom: low && !q.has('nobloom'),
  };
}
