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
import { crearLimitador } from '../asistente/http.mjs';

if (process.env.NODE_ENV === 'production') { console.error('Este servidor es solo para desarrollo (secreto y datos de prueba).'); process.exit(1); }

const SECRETO = 'secreto-solo-para-desarrollo-no-usar-en-produccion', EMISOR = 'http://127.0.0.1/auth/v1';
const { db } = await crearBase();
const S = await sembrarDemo(db);
const bd = crearBd(db);
const manejador = crearApi({
  bd, autenticar: crearAutenticador({ bd, secreto: SECRETO, emisor: EMISOR, registrarError: (e) => console.error('[error]', e.message) }),
  origenesPermitidos: (process.env.ORIGENES || 'http://localhost:3007').split(',').map((s) => s.trim()).filter(Boolean),
  limitar: crearLimitador(300, 60_000), registrarError: (e) => console.error('[error]', e.message),
});
const puerto = Number(process.env.PUERTO || 3020);
http.createServer(manejador).listen(puerto, '127.0.0.1', () => {
  console.log(`API en http://127.0.0.1:${puerto}/api/salud   (datos en memoria: se pierden al cortar)`);
  console.log(`Empresas: ${S.empresas.ri.nombre} = ${S.empresas.ri.id} (resp. inscripto), ${S.empresas.mt.nombre} = ${S.empresas.mt.id} (monotributo), ${S.empresas.ajena.nombre} = ${S.empresas.ajena.id} (de otro estudio)`);
  const exp = Math.floor(Date.now() / 1000) + 8 * 3600;
  for (const [quien, sub] of [['admin', 'sub-admin'], ['consulta', 'sub-consulta'], ['otro', 'sub-otro']])
    console.log(`Token ${quien} (8 h): ${firmarJwtHS256({ sub, aud: 'authenticated', iss: EMISOR, exp }, SECRETO)}`);
});
