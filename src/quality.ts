/**
 * Perfil de calidad: en móvil se recorta lo que más castiga a la GPU
 * (sombras, luces por vehículo, bloom, resolución). Se puede forzar por URL:
 *   ?quality=low | high   ?nobloom   ?noshadow   ?nolights
 */
export interface Quality {
  profile: 'low' | 'high';
  bloom: boolean;
  shadows: boolean;
  neonLights: number;
  vehicleSpots: boolean;
  maxPixelRatio: number;
  particles: number;
  haze: boolean;
  /** Sustituye materiales físicos del modelo por estándar (shaders más simples). */
  simpleMaterials: boolean;
}

export function detectQuality(): Quality {
  const q = new URLSearchParams(location.search);
  const coarse = matchMedia('(pointer: coarse)').matches;
  const small = Math.min(innerWidth, innerHeight) < 700;
  const mobile = coarse || (navigator.maxTouchPoints > 0 && small);
  const profile: Quality['profile'] = q.get('quality') === 'high' ? 'high' : q.get('quality') === 'low' || mobile ? 'low' : 'high';
  const low = profile === 'low';
  return {
    profile,
    bloom: !q.has('nobloom') && !low,
    shadows: !q.has('noshadow') && !low,
    neonLights: q.has('nolights') ? 0 : low ? 2 : 6,
    vehicleSpots: !q.has('nolights') && !low,
    maxPixelRatio: low ? 1.5 : 2,
    particles: low ? 500 : 1000,
    haze: !low,
    simpleMaterials: low || q.has('simple'),
  };
}
