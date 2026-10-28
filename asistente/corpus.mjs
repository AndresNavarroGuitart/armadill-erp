// Corpus de ayuda del asistente: lee docs/ayuda/*.md y lo arma de forma DETERMINISTA (mismos bytes siempre),
// porque el caché de Claude solo sirve si el comienzo del pedido no cambia ni un carácter.
// Formato de cada archivo:  "## Título" y, justo debajo, líneas opcionales "Palabras clave: a, b" y "Pantallas: ruta1, ruta2".
import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const carpeta = new URL('../docs/ayuda/', import.meta.url);

/* Pantallas a las que el asistente puede mandar. Es la ÚNICA lista válida: una ruta que no esté acá se descarta. */
export const RUTAS = {
  inicio: 'Inicio', estudio: 'Cartera del estudio', trazabilidad: 'Trazabilidad', asistente: 'Asistente', nueva: 'Nueva factura',
  'ventas/presupuestos': 'Presupuestos', 'ventas/pedidos': 'Pedidos', 'ventas/remitos': 'Remitos', 'ventas/facturas': 'Facturas de venta',
  'ventas/clientes': 'Clientes', 'ventas/precios': 'Precios', 'ventas/nuevo/presupuesto': 'Nuevo presupuesto', 'ventas/nuevo/pedido': 'Nuevo pedido', 'ventas/nuevo/remito': 'Nuevo remito',
  'compras/ordenes': 'Órdenes de compra', 'compras/remitos': 'Recepciones', 'compras/facturas': 'Facturas de compra', 'compras/proveedores': 'Proveedores',
  'compras/stock': 'Stock', 'compras/stock/movimientos': 'Movimientos de stock',
  'compras/nuevo/orden': 'Nueva orden de compra', 'compras/nuevo/recepcion': 'Nueva recepción', 'compras/nuevo/factura': 'Nueva factura de compra',
  'finanzas/tesoreria': 'Cajas y bancos', 'finanzas/tesoreria/cheques': 'Cheques', 'finanzas/tesoreria/cobros': 'Cobros y pagos', 'finanzas/tesoreria/conciliacion': 'Conciliación',
  'finanzas/contabilidad': 'Libro diario', 'finanzas/contabilidad/balance': 'Sumas y saldos', 'finanzas/contabilidad/periodos': 'Períodos',
  'finanzas/impuestos': 'Posición de IVA', 'finanzas/impuestos/retenciones': 'Retenciones', 'finanzas/impuestos/vencimientos': 'Vencimientos',
};

const lista = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function cargarSecciones(dir = carpeta) {
  const archivos = readdirSync(dir).filter((f) => /^\d\d_.*\.md$/.test(f)).sort();
  const secciones = [];
  for (const archivo of archivos) {
    const texto = readFileSync(new URL(archivo, dir), 'utf8').replace(/\r\n/g, '\n');
    for (const bloque of texto.split(/^## /m).slice(1)) {
      const [titulo, ...resto] = bloque.split('\n');
      let claves = [], rutas = [], enMeta = true; const cuerpo = [];
      for (const linea of resto) {
        if (enMeta && /^Palabras clave:/.test(linea)) { claves = lista(linea.replace(/^Palabras clave:/, '')); continue; }
        if (enMeta && /^Pantallas:/.test(linea)) { rutas = lista(linea.replace(/^Pantallas:/, '')); continue; }
        if (enMeta && linea.trim() === '') continue;
        enMeta = false; cuerpo.push(linea);
      }
      secciones.push({ id: `${archivo.slice(0, 2)}-${slug(titulo)}`, archivo, titulo: titulo.trim(), claves, rutas, texto: cuerpo.join('\n').trim() });
    }
  }
  return secciones;
}

/* Texto que va al modelo: sin las palabras clave (eso es solo para el modo básico). */
export function construirCorpus(secciones = cargarSecciones()) {
  return secciones.map((s) => `### ${s.titulo}\n${s.rutas.length ? `Pantallas: ${s.rutas.join(', ')}\n` : ''}${s.texto}`).join('\n\n');
}
export const huellaCorpus = (corpus) => createHash('sha256').update(corpus, 'utf8').digest('hex').slice(0, 12);

/* Comprobaciones del propio corpus (las corre la prueba): rutas válidas, títulos únicos, sin fechas ni datos variables. */
export function validarCorpus(secciones = cargarSecciones()) {
  const errores = [], vistos = new Set();
  for (const s of secciones) {
    if (vistos.has(s.id)) errores.push(`título repetido: ${s.titulo}`); vistos.add(s.id);
    if (!s.texto) errores.push(`sección vacía: ${s.titulo}`);
    for (const r of s.rutas) if (!RUTAS[r]) errores.push(`ruta inexistente en "${s.titulo}": ${r}`);
    if (/\b(20\d\d-\d\d-\d\d|\d{1,2}\/\d{1,2}\/20\d\d)\b/.test(s.texto)) errores.push(`fecha fija en "${s.titulo}" (rompería el caché o quedaría vieja)`);
  }
  return errores;
}
