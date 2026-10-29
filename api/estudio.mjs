// Administración del estudio: personas, accesos a empresas, roles y empresas. Solo para administradores del estudio, y sin empresa activa:
// se trabaja sobre el estudio completo (la RLS de usuario, rol y empresa es por estudio). Las reglas que no se pueden saltear (no quedarse sin
// administradores, persona/empresa/rol del mismo estudio, aislamiento de los permisos de rol) las impone la base (20_administracion.sql).
import { validar, cuitValido } from './validar.mjs';
import { ErrorApi, invalido } from './errores.mjs';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const enEstudio = (que) => new ErrorApi(404, 'no_encontrado', `${que} no existe en este estudio.`);

/* ---------- el estudio ---------- */
export async function leerEstudio(c) {
  const e = await c.uno(`select id, nombre, cuit, (select count(*)::int from usuario where activo) as personas, (select count(*)::int from empresa where activa) as empresas from estudio where id = fn_estudio_actual()`);
  if (!e) throw enEstudio('El estudio');
  return e;
}
export async function modificarEstudio(c, ctx, cuerpo) {
  const { valor: d } = validar({ nombre: { tipo: 'texto', min: 3, max: 120 }, cuit: { tipo: 'texto', max: 13, nulo: true } }, cuerpo, { parcial: true });
  const errores = {};
  if (d.cuit) { d.cuit = d.cuit.replace(/[\s-]/g, ''); if (!cuitValido(d.cuit)) errores.cuit = 'el CUIT no es válido (dígito verificador o prefijo incorrecto)'; }
  if (Object.keys(errores).length) throw invalido(errores);
  if (Object.keys(d).length === 0) throw invalido({ _: 'No hay nada para cambiar.' });
  const antes = await leerEstudio(c), cambios = [];
  for (const k of Object.keys(d)) if ((antes[k] ?? null) !== d[k]) cambios.push([k, antes[k] ?? null, d[k]]);
  if (cambios.length) await c.consultar(`update estudio set nombre = coalesce($1, nombre), cuit = case when $2::boolean then $3 else cuit end where id = fn_estudio_actual()`, [d.nombre ?? null, 'cuit' in d, d.cuit ?? null]);
  return { estudio: await leerEstudio(c), cambios };
}

/* ---------- roles y permisos ---------- */
export async function listarPermisos(c) { return { datos: await c.consultar('select clave, modulo, descripcion from permiso order by modulo, clave') }; }
export async function listarRoles(c) {
  const roles = await c.consultar(`select r.id, r.nombre, (select count(*)::int from usuario_empresa ue where ue.rol_id = r.id) as accesos from rol r order by r.nombre`);
  const permisos = await c.consultar(`select rol_id, permiso_clave from rol_permiso where valor <> 'no' order by permiso_clave`);
  return { datos: roles.map((r) => ({ ...r, sistema: r.nombre === 'Administrador', permisos: permisos.filter((p) => p.rol_id === r.id).map((p) => p.permiso_clave) })) };
}
async function validarPermisos(c, lista) {
  const claves = new Set((await c.consultar('select clave from permiso')).map((p) => p.clave)), errores = {};
  lista.forEach((p, i) => { if (!claves.has(p)) errores[`permisos[${i}]`] = `el permiso "${p}" no existe`; });
  if (new Set(lista).size !== lista.length) errores.permisos = 'hay permisos repetidos';
  if (Object.keys(errores).length) throw invalido(errores);
}
export async function crearRol(c, ctx, cuerpo) {
  const { permisos: pedidos, ...resto } = cuerpo && typeof cuerpo === 'object' && !Array.isArray(cuerpo) ? cuerpo : {};
  const { valor: d } = validar({ nombre: { tipo: 'texto', min: 3, max: 40, requerido: true } }, resto);
  const permisos = pedidos === undefined ? [] : pedidos;
  if (!Array.isArray(permisos) || permisos.some((p) => typeof p !== 'string')) throw invalido({ permisos: 'tiene que ser una lista de claves de permiso' });
  await validarPermisos(c, permisos);
  if (await c.uno(`select 1 x from rol where lower(nombre) = lower($1)`, [d.nombre])) throw new ErrorApi(409, 'duplicado', `Ya existe un rol llamado "${d.nombre}".`);
  const r = await c.uno('insert into rol (estudio_id, nombre) values (fn_estudio_actual(), $1) returning id', [d.nombre]);
  for (const p of permisos) await c.consultar(`insert into rol_permiso (rol_id, permiso_clave) values ($1, $2)`, [r.id, p]);
  return { rol: (await listarRoles(c)).datos.find((x) => x.id === r.id) };
}
export async function fijarPermisosRol(c, ctx, id, cuerpo) {
  const rol = await c.uno('select id, nombre from rol where id = $1', [id]);
  if (!rol) throw enEstudio('El rol');
  if (rol.nombre === 'Administrador') throw new ErrorApi(422, 'rol_de_sistema', 'El rol Administrador siempre tiene todos los permisos y no se modifica.');
  if (!cuerpo || !Array.isArray(cuerpo.permisos) || Object.keys(cuerpo).length !== 1) throw invalido({ permisos: 'tiene que ser una lista de claves de permiso' });
  if (cuerpo.permisos.some((p) => typeof p !== 'string')) throw invalido({ permisos: 'tiene que ser una lista de claves de permiso' });
  await validarPermisos(c, cuerpo.permisos);
  const antes = (await c.consultar(`select permiso_clave from rol_permiso where rol_id = $1 and valor <> 'no'`, [id])).map((p) => p.permiso_clave);
  const agregados = cuerpo.permisos.filter((p) => !antes.includes(p)), quitados = antes.filter((p) => !cuerpo.permisos.includes(p));
  await c.consultar('delete from rol_permiso where rol_id = $1', [id]);
  for (const p of cuerpo.permisos) await c.consultar('insert into rol_permiso (rol_id, permiso_clave) values ($1, $2)', [id, p]);
  return { rol: (await listarRoles(c)).datos.find((x) => x.id === id), cambios: [...agregados.map((p) => [`permiso ${p}`, null, 'si']), ...quitados.map((p) => [`permiso ${p}`, 'si', null])] };
}

/* ---------- personas y accesos ---------- */
async function accesosDe(c, ids) {
  if (!ids.length) return new Map();
  const filas = await c.consultar(`select ue.usuario_id, ue.empresa_id, e.razon_social as empresa, ue.rol_id, r.nombre as rol from usuario_empresa ue join empresa e on e.id = ue.empresa_id join rol r on r.id = ue.rol_id where ue.usuario_id = any($1::bigint[]) order by e.razon_social`, [ids]);
  const m = new Map(); for (const f of filas) { if (!m.has(f.usuario_id)) m.set(f.usuario_id, []); m.get(f.usuario_id).push({ empresa_id: f.empresa_id, empresa: f.empresa, rol_id: f.rol_id, rol: f.rol }); }
  return m;
}
const SELECT_PERSONA = `select id, email, nombre, activo, admin_estudio, (auth_sub is not null) as vinculada, creado_en,
  (select max(e.en) from evento e where e.entidad_tabla = 'usuario' and e.entidad_id = usuario.id and e.accion like 'Invitó a %' and e.resultado = 'ok') as invitada_en from usuario`;
const conAccesos = async (c, filas) => { const m = await accesosDe(c, filas.map((f) => f.id)); return filas.map((f) => ({ ...f, accesos: m.get(f.id) ?? [] })); };

export async function listarPersonas(c, { q, activo } = {}) {
  const patron = q ? `%${String(q).replace(/[\\%_]/g, '\\$&').slice(0, 60)}%` : null, act = activo === undefined || activo === '' ? null : activo === true || activo === 'true';
  const filas = await c.consultar(`${SELECT_PERSONA} where ($1::text is null or nombre ilike $1 or email ilike $1) and ($2::boolean is null or activo = $2) order by nombre`, [patron, act]);
  return { datos: await conAccesos(c, filas), total: filas.length };
}
export async function leerPersona(c, id) {
  const f = await c.uno(`${SELECT_PERSONA} where id = $1`, [id]);
  if (!f) throw enEstudio('La persona');
  return (await conAccesos(c, [f]))[0];
}

const ESQUEMA_ACCESO = { empresa_id: { tipo: 'entero', min: 1, requerido: true }, rol_id: { tipo: 'entero', min: 1, requerido: true } };
/* Comprueba que cada empresa (activa) y cada rol existan en el estudio y que no se repita una empresa. Devuelve los accesos limpios. */
async function validarAccesos(c, lista, campo = 'accesos') {
  const { valor } = validar({ [campo]: { tipo: 'lista', max: 200, requerido: true, elemento: ESQUEMA_ACCESO } }, { [campo]: lista });
  const accesos = valor[campo], errores = {};
  const empresas = new Map((await c.consultar('select id, activa from empresa')).map((e) => [e.id, e.activa])), roles = new Set((await c.consultar('select id from rol')).map((r) => r.id)), vistas = new Set();
  accesos.forEach((a, i) => {
    if (!empresas.has(a.empresa_id)) errores[`${campo}[${i}].empresa_id`] = 'la empresa no existe en este estudio';
    else if (!empresas.get(a.empresa_id)) errores[`${campo}[${i}].empresa_id`] = 'la empresa está dada de baja';
    if (!roles.has(a.rol_id)) errores[`${campo}[${i}].rol_id`] = 'el rol no existe en este estudio';
    if (vistas.has(a.empresa_id)) errores[`${campo}[${i}].empresa_id`] = 'esa empresa está repetida';
    vistas.add(a.empresa_id);
  });
  if (Object.keys(errores).length) throw invalido(errores);
  return accesos;
}
const nombresDeAccesos = async (c) => ({ empresas: new Map((await c.consultar('select id, razon_social from empresa')).map((e) => [e.id, e.razon_social])), roles: new Map((await c.consultar('select id, nombre from rol')).map((r) => [r.id, r.nombre])) });

export async function crearPersona(c, ctx, cuerpo) {
  const { valor: d } = validar({
    email: { tipo: 'texto', min: 5, max: 120, patron: EMAIL, mensajePatron: 'no es un email válido', requerido: true }, nombre: { tipo: 'texto', min: 2, max: 120, requerido: true },
    admin_estudio: { tipo: 'booleano' }, accesos: { tipo: 'lista', max: 200, elemento: ESQUEMA_ACCESO },
  }, cuerpo);
  const email = d.email.toLowerCase();
  const accesos = d.accesos ? await validarAccesos(c, d.accesos) : [];
  if (await c.uno('select 1 x from usuario where email = $1', [email])) throw new ErrorApi(409, 'duplicado', 'Ese email ya está en uso en el sistema.');
  const p = await c.uno('insert into usuario (estudio_id, email, nombre, admin_estudio) values (fn_estudio_actual(), $1, $2, $3) returning id', [email, d.nombre, d.admin_estudio ?? false]);
  for (const a of accesos) await c.consultar('insert into usuario_empresa (usuario_id, empresa_id, rol_id) values ($1, $2, $3)', [p.id, a.empresa_id, a.rol_id]);
  return leerPersona(c, p.id);
}

export async function modificarPersona(c, ctx, id, cuerpo) {
  const { valor: d } = validar({
    nombre: { tipo: 'texto', min: 2, max: 120 }, email: { tipo: 'texto', min: 5, max: 120, patron: EMAIL, mensajePatron: 'no es un email válido' },
    activo: { tipo: 'booleano' }, admin_estudio: { tipo: 'booleano' },
  }, cuerpo, { parcial: true });
  if (Object.keys(d).length === 0) throw invalido({ _: 'No hay nada para cambiar.' });
  const antes = await c.uno('select id, email, nombre, activo, admin_estudio, auth_sub from usuario where id = $1', [id]);
  if (!antes) throw enEstudio('La persona');
  const errores = {};
  if (d.activo === false && id === ctx.usuarioId) errores.activo = 'no podés dar de baja tu propio usuario';
  if (d.email !== undefined) { d.email = d.email.toLowerCase(); if (d.email !== antes.email && antes.auth_sub) errores.email = 'esta persona ya ingresó al sistema: su email no se cambia (creá una persona nueva si cambió de casilla)'; }
  if (Object.keys(errores).length) throw invalido(errores);
  if (d.email && d.email !== antes.email && await c.uno('select 1 x from usuario where email = $1 and id <> $2', [d.email, id])) throw new ErrorApi(409, 'duplicado', 'Ese email ya está en uso en el sistema.');
  const cambios = [];
  for (const k of ['nombre', 'email', 'activo', 'admin_estudio']) if (k in d && d[k] !== antes[k]) cambios.push([k, antes[k], d[k]]);
  if (cambios.length) await c.consultar(`update usuario set nombre = coalesce($2, nombre), email = coalesce($3, email), activo = coalesce($4, activo), admin_estudio = coalesce($5, admin_estudio) where id = $1`, [id, d.nombre ?? null, d.email ?? null, d.activo ?? null, d.admin_estudio ?? null]);
  return { persona: await leerPersona(c, id), cambios };
}

/* Reemplaza el conjunto de accesos de la persona. Devuelve el detalle de lo que se agregó, cambió y quitó (para la trazabilidad). */
export async function fijarAccesos(c, ctx, id, cuerpo) {
  if (!cuerpo || Object.keys(cuerpo).some((k) => k !== 'accesos')) throw invalido({ accesos: 'es la única propiedad que se puede enviar' });
  if (!(await c.uno('select 1 x from usuario where id = $1', [id]))) throw enEstudio('La persona');
  const nuevos = await validarAccesos(c, cuerpo.accesos), nombres = await nombresDeAccesos(c);
  const actuales = await c.consultar('select empresa_id, rol_id from usuario_empresa where usuario_id = $1', [id]);
  const rolActual = new Map(actuales.map((a) => [a.empresa_id, a.rol_id])), rolNuevo = new Map(nuevos.map((a) => [a.empresa_id, a.rol_id])), cambios = [];
  for (const [e, r] of rolNuevo) { if (!rolActual.has(e)) cambios.push([`acceso a ${nombres.empresas.get(e)}`, null, nombres.roles.get(r)]); else if (rolActual.get(e) !== r) cambios.push([`acceso a ${nombres.empresas.get(e)}`, nombres.roles.get(rolActual.get(e)), nombres.roles.get(r)]); }
  for (const [e, r] of rolActual) if (!rolNuevo.has(e)) cambios.push([`acceso a ${nombres.empresas.get(e) ?? `la empresa ${e}`}`, nombres.roles.get(r), null]);
  for (const [e] of rolActual) if (!rolNuevo.has(e)) await c.consultar('delete from usuario_empresa where usuario_id = $1 and empresa_id = $2', [id, e]);
  for (const [e, r] of rolNuevo) {
    if (!rolActual.has(e)) await c.consultar('insert into usuario_empresa (usuario_id, empresa_id, rol_id) values ($1, $2, $3)', [id, e, r]);
    else if (rolActual.get(e) !== r) await c.consultar('update usuario_empresa set rol_id = $3 where usuario_id = $1 and empresa_id = $2', [id, e, r]);
  }
  return { persona: await leerPersona(c, id), cambios };
}

/* ---------- empresas ---------- */
const SELECT_EMPRESA = `select e.id, e.cuit, e.razon_social, e.condicion_iva_codigo, e.inicio_actividades::text as inicio_actividades, e.nro_iibb, e.domicilio_fiscal, e.convenio_multilateral, e.activa,
  (select count(*)::int from usuario_empresa ue join usuario u on u.id = ue.usuario_id where ue.empresa_id = e.id and u.activo) as personas from empresa e`;
const ESQUEMA_EMPRESA = {
  cuit: { tipo: 'texto', max: 13, requerido: true }, razon_social: { tipo: 'texto', min: 3, max: 120, requerido: true }, condicion_iva_codigo: { tipo: 'entero', min: 1, max: 99, requerido: true },
  inicio_actividades: { tipo: 'fecha', nulo: true }, nro_iibb: { tipo: 'texto', max: 30, nulo: true }, domicilio_fiscal: { tipo: 'texto', max: 200, nulo: true },
};
const condicionExiste = async (c, codigo) => !!(await c.uno('select 1 x from arca_condicion_iva where codigo = $1', [codigo]));

export async function listarEmpresas(c, { activa } = {}) {
  const a = activa === undefined || activa === '' ? null : activa === true || activa === 'true';
  return { datos: await c.consultar(`${SELECT_EMPRESA} where ($1::boolean is null or e.activa = $1) order by e.razon_social`, [a]) };
}
export async function leerEmpresa(c, id) {
  const e = await c.uno(`${SELECT_EMPRESA} where e.id = $1`, [id]);
  if (!e) throw enEstudio('La empresa');
  return e;
}
export async function crearEmpresa(c, ctx, cuerpo, { anio = new Date().getFullYear() } = {}) {
  const { valor: d } = validar({ ...ESQUEMA_EMPRESA, dar_acceso: { tipo: 'booleano' } }, cuerpo);
  const cuit = d.cuit.replace(/[\s-]/g, ''), errores = {};
  if (!cuitValido(cuit)) errores.cuit = 'el CUIT no es válido (dígito verificador o prefijo incorrecto)';
  if (!(await condicionExiste(c, d.condicion_iva_codigo))) errores.condicion_iva_codigo = 'la condición frente al IVA no existe';
  if (Object.keys(errores).length) throw invalido(errores);
  if (await c.uno('select 1 x from empresa where cuit = $1', [cuit])) throw new ErrorApi(409, 'duplicado', 'Ya existe una empresa con ese CUIT en el estudio.');
  const r = await c.uno('select fn_alta_empresa($1, $2, $3::smallint, $4::date, $5, $6, $7, $8) as id', [cuit, d.razon_social, d.condicion_iva_codigo, d.inicio_actividades ?? null, d.nro_iibb ?? null, d.domicilio_fiscal ?? null, anio, d.dar_acceso ?? true]);
  return leerEmpresa(c, r.id);
}
export async function modificarEmpresa(c, ctx, id, cuerpo) {
  const { cuit: _cuit, dar_acceso: _acceso, ...editables } = ESQUEMA_EMPRESA;
  const { valor: d } = validar({ ...Object.fromEntries(Object.entries(editables).map(([k, v]) => [k, { ...v, requerido: false }])), activa: { tipo: 'booleano' }, convenio_multilateral: { tipo: 'booleano' } }, cuerpo, { parcial: true });
  if (Object.keys(d).length === 0) throw invalido({ _: 'No hay nada para cambiar (el CUIT no se modifica).' });
  const antes = await leerEmpresa(c, id), errores = {};
  if (d.condicion_iva_codigo !== undefined && !(await condicionExiste(c, d.condicion_iva_codigo))) errores.condicion_iva_codigo = 'la condición frente al IVA no existe';
  if (Object.keys(errores).length) throw invalido(errores);
  const cambios = [];
  for (const k of Object.keys(d)) if ((antes[k] ?? null) !== (d[k] ?? null)) cambios.push([k, antes[k] ?? null, d[k] ?? null]);
  if (cambios.length) {
    const claves = cambios.map((x) => x[0]);
    await c.consultar(`update empresa set ${claves.map((k, i) => `${k} = $${i + 2}`).join(', ')} where id = $1`, [id, ...claves.map((k) => d[k] ?? null)]);
  }
  return { empresa: await leerEmpresa(c, id), cambios };
}

/* ---------- invitaciones ---------- */
const INVITACIONES_POR_HORA = 3, INVITACIONES_POR_DIA_Y_ESTUDIO = 50;
/** Comprueba que se pueda invitar a esta persona (existe, está activa, todavía no ingresó, y no se pasó de los límites) y devuelve sus datos.
 *  Los límites se cuentan en la trazabilidad (intentos fallidos incluidos), así valen aunque haya varias copias del servidor. */
export async function prepararInvitacion(c, id) {
  const p = await c.uno('select id, email, nombre, activo, (auth_sub is not null) as vinculada from usuario where id = $1', [id]);
  if (!p) throw enEstudio('La persona');
  if (!p.activo) throw new ErrorApi(422, 'no_se_puede_invitar', 'La persona está dada de baja: reactivala antes de invitarla.');
  if (p.vinculada) throw new ErrorApi(422, 'ya_ingreso', 'Esta persona ya ingresó al sistema: no hace falta invitarla.');
  const n = await c.uno(`select count(*) filter (where e.entidad_id = $1 and e.en > now() - interval '1 hour')::int as hora, count(*) filter (where e.en > now() - interval '1 day')::int as dia
    from evento e where e.entidad_tabla = 'usuario' and (e.accion like 'Invitó a %' or e.accion like 'Intentó invitar a %')`, [id]);
  if (n.hora >= INVITACIONES_POR_HORA) throw new ErrorApi(429, 'invitaciones_limitadas', `Ya se le enviaron ${INVITACIONES_POR_HORA} invitaciones en la última hora. Esperá un rato antes de reenviar.`);
  if (n.dia >= INVITACIONES_POR_DIA_Y_ESTUDIO) throw new ErrorApi(429, 'invitaciones_limitadas', 'El estudio alcanzó el máximo de invitaciones por día. Probá mañana.');
  return p;
}
