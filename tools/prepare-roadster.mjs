// Convierte el modelo de Sketchfab (CC-BY-4.0, metarex.4d) en un GLB ligero y blanco.
// Uso: node tools/prepare-roadster.mjs <ruta/scene.gltf> [ratio]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, simplify, resample, textureCompress, quantize, meshopt, flatten, join } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const [,, input, ratioArg] = process.argv;
const ratio = Number(ratioArg ?? 0.35);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(input);

// Pintura: Ano White con clearcoat. Fuera el mapa de normales de 8 MB (escamas metálicas).
for (const mat of doc.getRoot().listMaterials()) {
  const name = mat.getName();
  if (name === 'car_main_paint') {
    mat.setBaseColorFactor([0.93, 0.93, 0.9, 1]).setMetallicFactor(0.3).setRoughnessFactor(0.32);
    const normal = mat.getNormalTexture();
    mat.setNormalTexture(null);
    if (normal) normal.dispose();
  }
  if (name === 'Glass_rear_lights_main' || name === 'Glass_rear_lights_DHO' || name === 'ior_1') {
    mat.setEmissiveFactor([1, 0.05, 0.05]);
  }
  if (name === 'headlights_main' || name === 'headlights_AHO') mat.setEmissiveFactor([1, 1, 1]);
  if (name === 'calipers') mat.setBaseColorFactor([0.85, 0.1, 0.1, 1]); // pinzas rojas, guiño al original
  // Cristales dorados como el visor de un astronauta (Roadster 2026): reflejo metálico dorado, poca transparencia.
  if (name === 'Glass_mid_tint' || name === 'Glass_Tint_max' || name === 'Glass_Clear') {
    mat.setBaseColorFactor([0.85, 0.6, 0.18, 0.9]).setMetallicFactor(0.9).setRoughnessFactor(0.08).setAlphaMode('BLEND');
    const cc = mat.getExtension('KHR_materials_clearcoat'); if (cc) cc.dispose();
    const sp = mat.getExtension('KHR_materials_specular'); if (sp) sp.dispose();
  }
  // Sin transmisión (obliga a un pase de render extra): cristal como transparencia simple.
  const transmission = mat.getExtension('KHR_materials_transmission');
  if (transmission) {
    transmission.dispose();
    const c = mat.getBaseColorFactor();
    if (!/^Glass_(mid_tint|Tint_max|Clear)$/.test(name)) mat.setAlphaMode('BLEND').setBaseColorFactor([c[0], c[1], c[2], Math.min(c[3], 0.55)]);
  }
}

await doc.transform(
  dedup(),
  prune(),
  weld(),
  simplify({ simplifier: MeshoptSimplifier, ratio, error: Number(process.env.SIMPLIFY_ERROR ?? 0.0012), lockBorder: !process.env.NO_LOCK }),
  resample(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 82 }),
  quantize(),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  prune(),
);

let tris = 0;
for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) tris += (p.getIndices()?.getCount() ?? 0) / 3;
await io.write(process.env.OUT ?? 'public/models/roadster.glb', doc);
console.log(`triángulos: ${Math.round(tris)}`);
