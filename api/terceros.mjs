// Clientes y proveedores. En el modelo son UN solo "tercero" con roles: si una persona ya existe como cliente y se la da de alta
// como proveedor, se le agrega el rol en lugar de duplicarla.
import { validar, cuitValido } from './validar.mjs';
import { ErrorApi, invalido, noEncontrado } from './errores.mjs';

const TIPO_DOC = { CUIT: 80, CUIL: 86, DNI: 96, SIN_IDENTIFICAR: 99 };
const CODIGO_A_TIPO = Object.fromEntries(Object.entries(TIPO_DOC).map(([k, v]) => [v, k]));
const CAMPOS = {
  tipo_documento: { tipo: 'enum', valores: Object.keys(TIPO_DOC), requerido: true },
  nro_documento: { tipo: 'texto', max: 20, requerido: true },
  razon_social: { tipo: 'texto', min: 3, max: 120, requerido: true },
  nombre_fantasia: { tipo: 'texto', max: 120, nulo: true },
  condicion_iva_codigo: { tipo: 'entero', min: 1, max: 99, requerido: true },
  email: { tipo: 'texto', max: 120, patron: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, mensajePatron: 'no es un email válido', nulo: true },
  telefono: { tipo: 'texto', max: 40, nulo: true },
  nro_iibb: { tipo: 'texto', max: 30, nulo: true },
  convenio_multilateral: { tipo: 'booleano' },
  condicion_pago_dias: { tipo: 'entero', min: 0, max: 365 },
  limite_credito: { tipo: 'importe', min: 0, max: 999999999999 },
  lista_precio_id: { tipo: 'entero', min: 1, nulo: true },
};
const EDITABLES = Object.keys(CAMPOS).filter((k) => !['tipo_documento', 'nro_documento'].includes(k));   // el documento no se cambia: es la identidad del tercero
const COLUMNAS = `t.id, t.tipo_documento_codigo, t.nro_documento, t.razon_social, t.nombre_fantasia, t.condicion_iva_codigo, t.es_cliente, t.es_proveedor, t.activo,
  t.email, t.telefono, t.nro_iibb, t.convenio_multilateral, t.condicion_pago_dias, t.limite_credito, t.lista_precio_id, t.creado_en, t.actualizado_en`;

const presentar = (f) => f && ({ ...f, tipo_documento: CODIGO_A_TIPO[f.tipo_documento_codigo], tipo_documento_codigo: undefined });
const soloDigitos = (s) => String(s).replace(/[\s.\-]/g, '');

/* Reglas del documento. Son las mismas del prototipo y de la RG 5616: quien no es consumidor final se identifica con CUIT. */
function reglas(d, rol) {
  const e = {};
  if (d.tipo_documento === 'CUIT' || d.tipo_documento === 'CUIL') { if (!cuitValido(d.nro_documento)) e.nro_documento = d.nro_documento.length === 11 ? 'el CUIT no es válido (dígito verificador o prefijo incorrecto)' : 'el CUIT tiene 11 dígitos'; }
  else if (d.tipo_documento === 'DNI') { if (!/^\d{7,8}$/.test(d.nro_documento)) e.nro_documento = 'el DNI tiene 7 u 8 dígitos'; }
  else if (d.nro_documento !== '0') e.nro_documento = 'sin identificar va con documento 0';
  if (d.tipo_documento === 'SIN_IDENTIFICAR' && d.condicion_iva_codigo !== 5) e.tipo_documento = 'sin identificar solo se admite para consumidor final';
  if (d.condicion_iva_codigo !== 5 && d.tipo_documento !== 'CUIT') e.tipo_documento = 'la condición frente al IVA elegida requiere CUIT (RG 5616)';
  if (rol === 'proveedor' && !['CUIT', 'CUIL'].includes(d.tipo_documento)) e.tipo_documento = 'un proveedor se identifica con CUIT o CUIL';
  return e;
}

async function condicionesValidas(c) { return new Set((await c.consultar('select codigo from arca_condicion_iva')).map((r) => Number(r.codigo))); }

export async function crearTercero(c, ctx, rol, cuerpo) {
  const esquema = { ...CAMPOS }; if (rol === 'proveedor') delete esquema.lista_precio_id;
  const { valor: d } = validar(esquema, cuerpo);
  d.nro_documento = d.tipo_documento === 'SIN_IDENTIFICAR' ? d.nro_documento : soloDigitos(d.nro_documento);
  const errores = reglas(d, rol);
  if (!(await condicionesValidas(c)).has(d.condicion_iva_codigo)) errores.condicion_iva_codigo = 'no es una condición frente al IVA válida';
  if (d.lista_precio_id && !(await c.uno('select 1 x from lista_precio where id = $1', [d.lista_precio_id]))) errores.lista_precio_id = 'la lista de precios no existe';
  if (Object.keys(errores).length) throw invalido(errores);

  const codigo = TIPO_DOC[d.tipo_documento];
  const previo = await c.uno('select id, razon_social, es_cliente, es_proveedor from tercero where tipo_documento_codigo = $1 and nro_documento = $2', [codigo, d.nro_documento]);
  if (previo) {
    if (previo[rol === 'cliente' ? 'es_cliente' : 'es_proveedor']) throw new ErrorApi(409, 'duplicado', `Ya existe ${rol === 'cliente' ? 'un cliente' : 'un proveedor'} con ese documento: ${previo.razon_social}.`);
    await c.consultar(`update tercero set ${rol === 'cliente' ? 'es_cliente' : 'es_proveedor'} = true, activo = true where id = $1`, [previo.id]);
    return { creado: false, rolAgregado: true, tercero: await leerTercero(c, previo.id) };
  }
  const r = await c.uno(
    `insert into tercero (empresa_id, tipo_documento_codigo, nro_documento, razon_social, nombre_fantasia, condicion_iva_codigo, es_cliente, es_proveedor, email, telefono,
        nro_iibb, convenio_multilateral, condicion_pago_dias, limite_credito, lista_precio_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning id`,
    [ctx.empresaId, codigo, d.nro_documento, d.razon_social, d.nombre_fantasia ?? null, d.condicion_iva_codigo, rol === 'cliente', rol === 'proveedor', d.email ?? null, d.telefono ?? null,
     d.nro_iibb ?? null, d.convenio_multilateral ?? false, d.condicion_pago_dias ?? 0, d.limite_credito ?? '0', d.lista_precio_id ?? null]);
  return { creado: true, tercero: await leerTercero(c, r.id) };
}

export async function leerTercero(c, id, rol) {
  const f = await c.uno(`select ${COLUMNAS}, s.saldo from tercero t left join v_saldo_tercero s on s.tercero_id = t.id and s.rol = $2 where t.id = $1`, [id, rol || 'cliente']);
  return presentar(f);
}
export async function obtenerTercero(c, id, rol) {
  const f = await c.uno(`select ${COLUMNAS}, s.saldo from tercero t left join v_saldo_tercero s on s.tercero_id = t.id and s.rol = $3
    where t.id = $1 and (case $2 when 'cliente' then t.es_cliente else t.es_proveedor end)`, [id, rol, rol]);
  if (!f) throw noEncontrado(rol === 'cliente' ? 'El cliente' : 'El proveedor');
  return presentar(f);
}

export async function listarTerceros(c, rol, { q, activo, limite = 50, desplazamiento = 0 } = {}) {
  const lim = Math.min(Math.max(Number(limite) || 50, 1), 100), des = Math.max(Number(desplazamiento) || 0, 0);
  const patron = q ? `%${String(q).replace(/[\\%_]/g, '\\$&').slice(0, 60)}%` : null;
  const filtros = `(case $1 when 'cliente' then t.es_cliente else t.es_proveedor end) and ($2::text is null or t.razon_social ilike $2 or t.nro_documento like $2) and ($3::boolean is null or t.activo = $3)`;
  const filas = await c.consultar(`select ${COLUMNAS}, s.saldo from tercero t left join v_saldo_tercero s on s.tercero_id = t.id and s.rol = $1 where ${filtros} order by t.razon_social limit ${lim} offset ${des}`,
    [rol, patron, activo === undefined || activo === '' ? null : activo === true || activo === 'true']);
  const total = (await c.uno(`select count(*)::int n from tercero t where ${filtros}`, [rol, patron, activo === undefined || activo === '' ? null : activo === true || activo === 'true']));
  return { datos: filas.map(presentar), total: total.n, limite: lim, desplazamiento: des };
}

/* Cambia datos del tercero. Devuelve también la lista de cambios (antes → después) para la trazabilidad. */
export async function modificarTercero(c, ctx, rol, id, cuerpo) {
  const esquema = { ...Object.fromEntries(EDITABLES.map((k) => [k, CAMPOS[k]])), activo: { tipo: 'booleano' } }; if (rol === 'proveedor') delete esquema.lista_precio_id;
  const { valor: d } = validar(esquema, cuerpo, { parcial: true });
  if (!Object.keys(d).length) throw invalido({ _: 'No hay nada para modificar.' });
  const antes = await obtenerTercero(c, id, rol), errores = {};
  const nuevaCondicion = d.condicion_iva_codigo ?? antes.condicion_iva_codigo;
  if (d.condicion_iva_codigo !== undefined) {
    if (!(await condicionesValidas(c)).has(d.condicion_iva_codigo)) errores.condicion_iva_codigo = 'no es una condición frente al IVA válida';
    if (nuevaCondicion !== 5 && antes.tipo_documento !== 'CUIT') errores.condicion_iva_codigo = 'esa condición requiere que el tercero tenga CUIT (RG 5616)';
    if (nuevaCondicion !== 5 && antes.tipo_documento === 'SIN_IDENTIFICAR') errores.condicion_iva_codigo = 'un tercero sin identificar solo puede ser consumidor final';
  }
  if (d.lista_precio_id && !(await c.uno('select 1 x from lista_precio where id = $1', [d.lista_precio_id]))) errores.lista_precio_id = 'la lista de precios no existe';
  if (Object.keys(errores).length) throw invalido(errores);
  const claves = Object.keys(d);
  await c.consultar(`update tercero set ${claves.map((k, i) => `${k} = $${i + 2}`).join(', ')} where id = $1`, [id, ...claves.map((k) => d[k])]);
  const despues = await leerTercero(c, id, rol);
  const cambios = claves.filter((k) => String(antes[k] ?? '') !== String(despues[k] ?? '')).map((k) => [k, String(antes[k] ?? '—'), String(despues[k] ?? '—')]);
  return { tercero: despues, cambios };
}
