// Servidor de PRODUCCIÓN de la API: base real (pool de `pg`), verificación de tokens de Supabase Auth (claves públicas por JWKS y,
// si se configura, el secreto heredado) y los mismos controles que se prueban en probar_api.mjs.
// Configuración por variables de entorno (api/configuracion.mjs). Antes de la primera vez: aplicar el modelo con
//   DATABASE_URL=… node modelo/migrar_pg.mjs --aplicar
import http from 'node:http';
import { leerConfiguracion } from './configuracion.mjs';
import { crearPool, crearBdPg } from './bd_pg.mjs';
import { crearJwks, crearVerificador } from './jwt.mjs';
import { crearAutenticador } from './auth.mjs';
import { crearApi } from './app.mjs';
import { crearLimitador } from '../asistente/http.mjs';

let config;
try { config = leerConfiguracion(); } catch (e) { console.error(e.message); process.exit(1); }

// Los errores se registran SIN datos de las personas: mensaje y código, nunca el pedido ni los parámetros.
const registrar = (error) => console.error(JSON.stringify({ nivel: 'error', mensaje: String(error?.message ?? error).slice(0, 300), codigo: error?.code ?? null, en: new Date().toISOString() }));

const pool = crearPool({ url: config.baseDeDatos, maximo: config.poolMaximo, ssl: config.baseDeDatosCa ? { ca: config.baseDeDatosCa, rejectUnauthorized: true } : undefined });
const bd = crearBdPg(pool);
const jwks = config.jwt.jwksUrl ? crearJwks({ url: config.jwt.jwksUrl, registrarError: registrar }) : undefined;
const verificador = crearVerificador({ secretoHS256: config.jwt.secretoHS256 ?? undefined, jwks, audiencia: config.jwt.audiencia, emisor: config.jwt.emisor });
const autenticar = crearAutenticador({ bd, verificador, registrarError: (e) => registrar(e) });
const manejador = crearApi({ bd, autenticar, origenesPermitidos: config.origenes, limitar: crearLimitador(config.limitePorMinuto, 60_000), saltosDeProxy: config.saltosDeProxy, registrarError: registrar });

const servidor = http.createServer(manejador);
servidor.requestTimeout = 30_000; servidor.headersTimeout = 10_000; servidor.keepAliveTimeout = 5_000;
servidor.listen(config.puerto, config.escucharEn, () => console.log(JSON.stringify({ nivel: 'info', mensaje: `API escuchando en ${config.escucharEn}:${config.puerto}`, origenes: config.origenes, verificacion: [config.jwt.jwksUrl && 'JWKS', config.jwt.secretoHS256 && 'HS256'].filter(Boolean) })));

// Cierre ordenado: deja de aceptar pedidos, espera los que están en curso y recién entonces cierra la base.
let cerrando = false;
async function cerrar(senal) {
  if (cerrando) return; cerrando = true;
  console.log(JSON.stringify({ nivel: 'info', mensaje: `${senal}: cerrando` }));
  const forzar = setTimeout(() => process.exit(1), 15_000); forzar.unref();
  servidor.close(async () => { try { await pool.end(); } finally { process.exit(0); } });
  servidor.closeIdleConnections?.();
}
process.on('SIGTERM', () => cerrar('SIGTERM')); process.on('SIGINT', () => cerrar('SIGINT'));
process.on('unhandledRejection', (e) => registrar(e));
process.on('uncaughtException', (e) => { registrar(e); process.exit(1); });
