// Servidor de DESARROLLO de la API: base en memoria (PGlite) con datos de ejemplo y tokens de prueba firmados con un secreto de desarrollo.
// No es el servicio de producción: se niega a arrancar si NODE_ENV=production.
// Uso:   node api/servidor_dev.mjs
//        PUERTO=3020 ORIGENES=http://localhost:3007 node api/servidor_dev.mjs
// Al arrancar imprime un token por persona; se usa con   curl -H "Authorization: Bearer <token>" -H "X-Empresa-Id: 1" http://127.0.0.1:3020/api/yo
import http from 'node:http';
import { crearBase } from '../modelo/cargar.mjs';
import { sembrarDemo } from './semilla.mjs';
import { crearBd } from './bd.mjs';
import { crearAutenticador, firmarJwtHS256 } from './auth.mjs';
import { crearApi } from './app.mjs';
import { ErrorApi } from './errores.mjs';
import { crearLimitador } from '../asistente/http.mjs';

if (process.env.NODE_ENV === 'production') { console.error('Este servidor es solo para desarrollo (secreto y datos de prueba).'); process.exit(1); }

const SECRETO = 'secreto-solo-para-desarrollo-no-usar-en-produccion', EMISOR = 'http://127.0.0.1/auth/v1';
const { db } = await crearBase();
const S = await sembrarDemo(db);
const bd = crearBd(db);
// Invitaciones SIMULADAS: no se envía ningún correo; sirve para recorrer la pantalla. 'ya.tiene.cuenta@…' prueba el otro resultado y 'falla@…' un error del proveedor.
const invitador = { async invitar(email) {
  if (/^falla@/.test(email)) throw new ErrorApi(502, 'proveedor_identidad', 'El servicio de ingreso no pudo enviar la invitación (simulado). Probá de nuevo en unos minutos.');
  console.log(`[invitación simulada] ${email}`); return { estado: /^ya.tiene.cuenta@/.test(email) ? 'ya_tiene_cuenta' : 'invitada' };
} };
const manejador = crearApi({ invitador,
  bd, autenticar: crearAutenticador({ bd, secreto: SECRETO, emisor: EMISOR, registrarError: (e) => console.error('[error]', e.message) }),
  origenesPermitidos: (process.env.ORIGENES || 'http://localhost:3007,http://localhost:3030').split(',').map((s) => s.trim()).filter(Boolean),
  limitar: crearLimitador(300, 60_000), registrarError: (e) => console.error('[error]', e.message),
});
const puerto = Number(process.env.PUERTO || 3020);
// Solo desarrollo: la pantalla de ingreso del front ofrece "entrar como…" con estos tokens. En producción el token lo da el proveedor de identidad.
const PERSONAS = [['Administrador', 'Andrés (administrador) · empresas 1 y 2', { sub: 'sub-admin' }], ['Auxiliar', 'Matías (auxiliar) · primer ingreso por email verificado', { sub: 'sub-auxiliar-dev', email: 'auxiliar@estudio.test', email_verified: true }],
  ['Consulta', 'Sofía (solo consulta)', { sub: 'sub-consulta' }], ['Otro estudio', 'Persona de otro estudio', { sub: 'sub-otro' }], ['Dada de baja', 'Debe ser rechazada', { sub: 'sub-baja' }]];
const sesionesDev = () => PERSONAS.map(([clave, descripcion, datos]) => ({ clave, descripcion, token: firmarJwtHS256({ ...datos, aud: 'authenticated', iss: EMISOR, exp: Math.floor(Date.now() / 1000) + 8 * 3600 }, SECRETO) }));
const servidor = http.createServer((req, res) => {
  if (req.url === '/dev/sesiones' && req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); return res.end(JSON.stringify(sesionesDev())); }
  return manejador(req, res);
});
servidor.listen(puerto, '127.0.0.1', () => {
  console.log(`API en http://127.0.0.1:${puerto}/api/salud   (datos en memoria: se pierden al cortar)`);
  console.log(`Empresas: ${S.empresas.ri.nombre} = ${S.empresas.ri.id} (resp. inscripto), ${S.empresas.mt.nombre} = ${S.empresas.mt.id} (monotributo), ${S.empresas.ajena.nombre} = ${S.empresas.ajena.id} (de otro estudio)`);
  const exp = Math.floor(Date.now() / 1000) + 8 * 3600;
  for (const [quien, sub] of [['admin', 'sub-admin'], ['consulta', 'sub-consulta'], ['otro', 'sub-otro']])
    console.log(`Token ${quien} (8 h): ${firmarJwtHS256({ sub, aud: 'authenticated', iss: EMISOR, exp }, SECRETO)}`);
});
