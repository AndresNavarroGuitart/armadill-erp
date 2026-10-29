// Trazabilidad: lectura del libro de eventos del estudio (quién hizo qué, sobre qué empresa y cuándo), detalle con comprobación de la huella,
// exportación a CSV y verificación de la cadena. Solo para administradores del estudio. El libro es de solo agregar y encadenado (SHA-256):
// acá nunca se escribe sobre él salvo para dejar constancia de que se exportó o se verificó (esas dos acciones también quedan en la cadena).
import { ErrorApi, invalido, noEncontrado } from './errores.mjs';

const ZONA = 'America/Argentina/Buenos_Aires';          // los días de los filtros y del CSV son los del estudio, no los del servidor
export const CATEGORIAS = ['acceso', 'comprobantes', 'contabilidad', 'tesoreria', 'stock', 'maestros', 'seguridad', 'asistente'];
const RESULTADOS = ['ok', 'rechazo', 'fallo'];
const MAX_EXPORTACION = 20000;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/* Convierte los parámetros de la dirección en filtros SQL. Todo va por parámetros; los valores se validan antes. */
function filtrar(q = {}) {
  const errores = {}, cond = [], p = [];
  const agregar = (sql, valor) => { p.push(valor); cond.push(sql.replace('?', `$${p.length}`)); };
  const entero = (v, campo) => { if (v === undefined || v === '') return null; if (!/^\d{1,15}$/.test(String(v))) { errores[campo] = 'tiene que ser un número'; return null; } return Number(v); };
  if (q.categoria) { if (!CATEGORIAS.includes(q.categoria)) errores.categoria = `tiene que ser uno de: ${CATEGORIAS.join(', ')}`; else agregar('e.categoria = ?', q.categoria); }
  if (q.resultado) { if (!RESULTADOS.includes(q.resultado)) errores.resultado = `tiene que ser uno de: ${RESULTADOS.join(', ')}`; else agregar('e.resultado = ?', q.resultado); }
  const usuario = entero(q.usuario_id, 'usuario_id'); if (usuario !== null) agregar('e.usuario_id = ?', usuario);
  if (q.empresa_id === 'sin') cond.push('e.empresa_id is null'); else { const emp = entero(q.empresa_id, 'empresa_id'); if (emp !== null) agregar('e.empresa_id = ?', emp); }
  for (const [campo, op] of [['desde', '>='], ['hasta', '<=']]) {
    if (!q[campo]) continue;
    if (!FECHA.test(q[campo]) || Number.isNaN(Date.parse(q[campo] + 'T12:00:00Z'))) errores[campo] = 'tiene que ser una fecha (aaaa-mm-dd)';
    else agregar(`(e.en at time zone '${ZONA}')::date ${op} ?::date`, q[campo]);
  }
  if (q.entidad_tabla) { if (!/^[a-z_]{1,40}$/.test(q.entidad_tabla)) errores.entidad_tabla = 'no es un nombre válido'; else agregar('e.entidad_tabla = ?', q.entidad_tabla); }
  const ent = entero(q.entidad_id, 'entidad_id'); if (ent !== null) agregar('e.entidad_id = ?', ent);
  if (q.q) {
    const texto = String(q.q).trim().slice(0, 60), codigo = /^tr-?0*(\d+)$/i.exec(texto);
    if (codigo) agregar('e.nro = ?', Number(codigo[1]));
    else if (texto) { p.push(`%${texto.replace(/[\\%_]/g, '\\$&')}%`); const i = p.length; cond.push(`(e.accion ilike $${i} or e.detalle ilike $${i} or coalesce(u.nombre, e.usuario_texto) ilike $${i} or em.razon_social ilike $${i})`); }
  }
  if (Object.keys(errores).length) throw invalido(errores);
  return { donde: cond.length ? `where ${cond.join(' and ')}` : '', p };
}
const DESDE = `from evento e left join empresa em on em.id = e.empresa_id left join usuario u on u.id = e.usuario_id`;
const COLUMNAS = `e.id, e.nro, 'TR-' || lpad(e.nro::text, 6, '0') as codigo, e.en, e.empresa_id, em.razon_social as empresa, e.usuario_id, coalesce(u.nombre, e.usuario_texto) as usuario,
  e.categoria, e.accion, e.detalle, e.resultado, e.entidad_tabla, e.entidad_id`;

export async function listarEventos(c, q = {}) {
  const lim = Math.min(Math.max(Number(q.limite) || 50, 1), 100), des = Math.max(Number(q.desplazamiento) || 0, 0), { donde, p } = filtrar(q);
  const filas = await c.consultar(`select ${COLUMNAS} ${DESDE} ${donde} order by e.nro desc limit ${lim} offset ${des}`, p);
  const total = (await c.uno(`select count(*)::int n ${DESDE} ${donde}`, p)).n;
  return { datos: filas, total, limite: lim, desplazamiento: des };
}

/* Un evento completo, con lo que hace falta para auditarlo: el antes y el después, el origen y las dos huellas. `huella_ok` es la huella recalculada
   por la base contra la guardada: si no coincide, ese evento fue alterado. */
export async function leerEvento(c, nro) {
  const e = await c.uno(`select ${COLUMNAS}, e.cambios, host(e.ip) as ip, e.dispositivo, e.huella_prev, e.huella, (fn_evento_huella(e) = e.huella) as huella_ok ${DESDE} where e.nro = $1`, [nro]);
  if (!e) throw noEncontrado('El evento');
  const ant = await c.uno('select huella from evento where nro = $1', [nro - 1]);
  return { ...e, enlace_ok: nro === 1 ? e.huella_prev === '' : !!ant && ant.huella === e.huella_prev };
}

const celda = (v) => {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;                       // una celda que empieza con = + - @ se tomaría por fórmula en una planilla: se neutraliza
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/* CSV de lo que se está viendo (mismos filtros). Tope de 20.000 filas: más que eso se acota con filtros. Queda constancia de la exportación. */
export async function exportarEventos(c, q = {}) {
  const { donde, p } = filtrar(q);
  const n = (await c.uno(`select count(*)::int n ${DESDE} ${donde}`, p)).n;
  if (n > MAX_EXPORTACION) throw new ErrorApi(422, 'demasiadas_filas', `Son ${n} eventos y se exportan hasta ${MAX_EXPORTACION}. Acotá el período o los filtros.`);
  const filas = await c.consultar(`select 'TR-' || lpad(e.nro::text, 6, '0') as codigo, to_char(e.en at time zone '${ZONA}', 'YYYY-MM-DD HH24:MI:SS') as fecha_hora, em.razon_social as empresa,
      coalesce(u.nombre, e.usuario_texto) as usuario, e.categoria, e.accion, e.detalle, e.resultado, host(e.ip) as ip, e.dispositivo, e.cambios, e.huella ${DESDE} ${donde} order by e.nro desc`, p);
  const cambios = (j) => (Array.isArray(j) ? j.map((x) => `${x.campo}: ${x.antes ?? '—'} → ${x.despues ?? '—'}`).join('; ') : '');
  const cab = ['Código', 'Fecha y hora', 'Empresa', 'Usuario', 'Categoría', 'Actividad', 'Detalle', 'Resultado', 'IP', 'Dispositivo', 'Cambios', 'Huella'];
  const csv = [cab, ...filas.map((f) => [f.codigo, f.fecha_hora, f.empresa, f.usuario, f.categoria, f.accion, f.detalle, f.resultado, f.ip, f.dispositivo, cambios(f.cambios), f.huella])].map((r) => r.map(celda).join(',')).join('\r\n');
  return { csv: csv + '\r\n', filas: n, nombre: `trazabilidad-${new Date().toISOString().slice(0, 10)}.csv`, filtros: Object.entries(q).filter(([k, v]) => v && ['categoria', 'resultado', 'usuario_id', 'empresa_id', 'desde', 'hasta', 'q', 'entidad_tabla', 'entidad_id'].includes(k)).map(([k, v]) => `${k}=${v}`).join(' · ') };
}

/* Recorre la cadena del estudio y la compara, si se la da, con la cabeza guardada por fuera de la base (la única forma de notar que se quitaron
   los últimos eventos). Devuelve el resultado; la ruta deja constancia. Se limita la frecuencia: recorrer una cadena larga cuesta. */
export async function verificarCadena(c, cuerpo = {}) {
  const claves = Object.keys(cuerpo ?? {}), errores = {};
  for (const k of claves) if (!['nro', 'huella'].includes(k)) errores[k] = 'no es un campo que se pueda enviar';
  const traeNro = cuerpo?.nro !== undefined && cuerpo?.nro !== null && cuerpo?.nro !== '', traeHuella = !!cuerpo?.huella;
  if (traeNro !== traeHuella) errores[traeNro ? 'huella' : 'nro'] = 'hay que informar el número y la huella de la cabeza guardada, juntos';
  if (traeNro && !/^\d{1,15}$/.test(String(cuerpo.nro))) errores.nro = 'tiene que ser un número';
  if (traeHuella && !/^[0-9a-f]{64}$/i.test(String(cuerpo.huella))) errores.huella = 'tiene que ser una huella de 64 caracteres hexadecimales';
  if (Object.keys(errores).length) throw invalido(errores);
  const recientes = (await c.uno(`select count(*)::int n from evento where accion like 'Verificó la integridad de la trazabilidad%' and en > now() - interval '1 minute'`)).n;
  if (recientes >= 5) throw new ErrorApi(429, 'verificaciones_limitadas', 'Se verificó varias veces en el último minuto. Esperá un momento.');
  const estudio = (await c.uno('select fn_estudio_actual() as id')).id;
  const roto = (await c.uno('select fn_verificar_trazabilidad($1) as nro', [estudio])).nro;
  const cabeza = await c.uno(`select nro, huella, to_char(en at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as en from evento where estudio_id = $1 order by nro desc limit 1`, [estudio]);
  let resguardo = null;
  if (traeNro) {
    const nro = Number(cuerpo.nro), guardada = String(cuerpo.huella).toLowerCase();
    if (nro > (cabeza?.nro ?? 0)) resguardo = { coincide: false, motivo: `La cabeza guardada es del evento ${nro} y la cadena llega hasta el ${cabeza?.nro ?? 0}: faltan eventos.` };
    else { const e = await c.uno('select huella from evento where nro = $1', [nro]); resguardo = e && e.huella === guardada ? { coincide: true, motivo: nro === cabeza.nro ? 'La cadena actual termina exactamente donde la guardaste.' : `La cadena conserva el evento ${nro} tal como lo guardaste y siguió creciendo.` } : { coincide: false, motivo: `El evento ${nro} no coincide con la huella guardada: la cadena fue modificada.` }; }
  }
  const integra = roto === null && (resguardo === null || resguardo.coincide);
  return { integra, primer_evento_roto: roto, eventos: cabeza?.nro ?? 0, cabeza, resguardo };
}
