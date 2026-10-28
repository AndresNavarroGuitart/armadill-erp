// Servidor de DESARROLLO del asistente: base en memoria (PGlite) + un usuario de prueba. No es el servicio de producción:
// la autenticación es falsa a propósito, por eso se niega a arrancar si NODE_ENV=production.
// Uso:   node asistente/servidor_dev.mjs              (respuestas simuladas, no gasta nada)
//        node asistente/servidor_dev.mjs --claude     (llama a Claude de verdad: GASTA; necesita ANTHROPIC_API_KEY o `ant auth login`)
//        PUERTO=3010 ORIGENES=http://localhost:3007 node asistente/servidor_dev.mjs
import http from 'node:http';
import { crearBase } from '../modelo/cargar.mjs';
import { crearServicio } from './servicio.mjs';
import { crearManejador, crearLimitador } from './http.mjs';
import { crearAdaptadoresPg, conBdPglite } from './datos.mjs';

if (process.env.NODE_ENV === 'production') { console.error('Este servidor es solo para desarrollo (autenticación falsa).'); process.exit(1); }
const usarClaude = process.argv.includes('--claude');

const { db } = await crearBase();
const estudio = (await db.query(`insert into estudio (nombre) values ('Estudio de prueba') returning id`)).rows[0];
const usuario = (await db.query(`insert into usuario (estudio_id, email, nombre) values ($1,'dev@estudio.test','Persona de prueba') returning id`, [estudio.id])).rows[0];
await db.query(`insert into asistente_config (estudio_id) values ($1)`, [estudio.id]);
const ctx = { estudioId: estudio.id, empresaId: null, usuarioId: usuario.id, permisos: new Set(['asistente.usar']), condicionIva: 'responsable inscripto', rol: 'Contadora' };

let proveedor;
if (usarClaude) { const { crearProveedorClaude } = await import('./claude.mjs'); proveedor = crearProveedorClaude(); console.log('Modo Claude: cada consulta GASTA (≈ US$ 0,05).'); }
else {
  proveedor = { async *transmitir(pedido) {
    const pregunta = pedido.messages.at(-1).content;
    for (const t of `Respuesta SIMULADA (no se llamó a Claude). Tu pregunta fue: "${pregunta}".\n[[ir:nueva|Ir a Nueva factura]]\n[[fuente:guia]]`.match(/[\s\S]{1,12}/g)) { yield { tipo: 'texto', texto: t }; await new Promise((r) => setTimeout(r, 30)); }
    yield { tipo: 'fin', stop_reason: 'end_turn', usage: { input_tokens: 300, cache_read_input_tokens: 20000, output_tokens: 120 } };
  } };
  console.log('Modo simulado: no se llama a Claude ni se gasta nada.');
}

const ad = crearAdaptadoresPg(conBdPglite(db));
const servicio = crearServicio({ proveedor, cuota: ad.cuota, registrarUso: ad.registrarUso, registrarEvento: ad.registrarEvento });
const manejador = crearManejador({
  servicio, autenticar: async () => ctx, limitar: crearLimitador(10, 60_000),
  origenesPermitidos: (process.env.ORIGENES || 'http://localhost:3007').split(',').map((s) => s.trim()).filter(Boolean),
  registrarError: (e) => console.error('[error]', e.message),
});
const puerto = Number(process.env.PUERTO || 3010);
http.createServer(manejador).listen(puerto, '127.0.0.1', () => console.log(`Asistente en http://127.0.0.1:${puerto}/api/asistente/mensajes  (guía ${servicio.huella}, ${servicio.secciones.length} secciones)`));
