// Prueba de humo contra Claude REAL: GASTA DINERO (≈ US$ 0,10 en total). No forma parte de `npm test`.
// Verifica de verdad tres cosas que las pruebas con proveedor falso no pueden: que Claude acepta el pedido,
// que el caché funciona (la segunda consulta lee el corpus del caché) y cuánto cuesta una consulta real.
// Uso:  node asistente/probar_claude.mjs --acepto-el-gasto
import { crearServicio } from './servicio.mjs';
import { crearProveedorClaude } from './claude.mjs';

if (!process.argv.includes('--acepto-el-gasto')) { console.error('Esto llama a Claude y cuesta dinero. Repetí con --acepto-el-gasto para confirmarlo.'); process.exit(1); }
const ctx = { estudioId: 1, empresaId: null, usuarioId: 1, permisos: new Set(['asistente.usar']), condicionIva: 'responsable inscripto', rol: 'Contadora' };
const usos = [];
const servicio = crearServicio({ proveedor: crearProveedorClaude(), cuota: { verificar: async () => ({ motivo: null }) }, registrarUso: async (u) => { usos.push(u); }, registrarEvento: async () => {} });

for (const pregunta of ['¿Cómo emito una factura?', '¿Cuál es el porcentaje del IVA?', '¿Cuánto paga de Ganancias una sociedad?']) {
  let texto = '', acciones = [], fuentes = [], fin = null, error = null;
  for await (const ev of servicio.conversar({ ctx, historial: [], pregunta })) {
    if (ev.tipo === 'texto') texto += ev.texto; if (ev.tipo === 'acciones') acciones = ev.acciones; if (ev.tipo === 'fuentes') fuentes = ev.fuentes; if (ev.tipo === 'fin') fin = ev; if (ev.tipo === 'error') error = ev;
  }
  console.log(`\n── ${pregunta}\n${texto.trim()}\n   acciones: ${JSON.stringify(acciones)} · fuentes: ${JSON.stringify(fuentes)}${error ? ' · ERROR ' + error.mensaje : ''}`);
  if (fin && fin.uso) console.log(`   modo ${fin.modo} · entrada ${fin.uso.entrada} · caché leída ${fin.uso.cacheLectura} · caché escrita ${fin.uso.cacheEscritura} · salida ${fin.uso.salida} · US$ ${fin.uso.costoUsd}`);
  else console.log(`   modo ${fin && fin.modo}${fin && fin.motivo ? ' (' + fin.motivo + ')' : ''}`);
}
const leyoCache = usos.slice(1).some((u) => (u.usage.cache_read_input_tokens || 0) > 0);
console.log(`\nCaché del corpus: ${leyoCache ? 'FUNCIONA (las consultas siguientes leen del caché)' : 'NO LEE DEL CACHÉ: revisar que el corpus supere el mínimo cacheable y que el bloque fijo no cambie'}`);
console.log(`Gasto total de esta prueba: US$ ${usos.reduce((s, u) => s + (u.costo || 0), 0).toFixed(4)}`);
