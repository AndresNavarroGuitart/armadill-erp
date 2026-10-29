// Artículos, listas de precios y precios. El precio se guarda SOLO neto y con vigencia: el final con IVA se calcula.
import { validar } from './validar.mjs';
import { ErrorApi, invalido, noEncontrado } from './errores.mjs';
import { CODIGO_ALICUOTA } from './calculo_venta.mjs';

const ALICUOTAS = Object.keys(CODIGO_ALICUOTA);
const TRATAMIENTOS = ['gravado', 'exento', 'no_gravado'];
const CAMPOS = {
  codigo: { tipo: 'texto', min: 1, max: 30, mayusculas: true, patron: /^[A-Za-z0-9][A-Za-z0-9._/-]*$/, mensajePatron: 'solo letras, números y . _ / -', requerido: true },
  nombre: { tipo: 'texto', min: 2, max: 120, requerido: true },
  tipo: { tipo: 'enum', valores: ['bien', 'servicio', 'gasto', 'bien_de_uso'] },
  rubro_id: { tipo: 'entero', min: 1, nulo: true },
  unidad_id: { tipo: 'entero', min: 1, nulo: true },
  tratamiento_iva_venta: { tipo: 'enum', valores: TRATAMIENTOS },
  alicuota_venta: { tipo: 'enum', valores: ALICUOTAS },
  tratamiento_iva_compra: { tipo: 'enum', valores: TRATAMIENTOS },
  alicuota_compra: { tipo: 'enum', valores: ALICUOTAS },
  controla_stock: { tipo: 'booleano' },
};
const SELECT = `a.id, a.codigo, a.nombre, a.tipo, a.rubro_id, a.unidad_id, a.tratamiento_iva_venta, av.tasa * 100 as alicuota_venta_pct, a.alicuota_venta_codigo,
  a.tratamiento_iva_compra, ac.tasa * 100 as alicuota_compra_pct, a.alicuota_compra_codigo, a.controla_stock, a.activo, a.creado_en`;
const DESDE = `from articulo a left join arca_alicuota_iva av on av.codigo = a.alicuota_venta_codigo left join arca_alicuota_iva ac on ac.codigo = a.alicuota_compra_codigo`;
const pct = (x) => (x == null ? null : String(Number(x)));
const presentar = (f) => f && ({ ...f, alicuota_venta: pct(f.alicuota_venta_pct), alicuota_compra: pct(f.alicuota_compra_pct), alicuota_venta_pct: undefined, alicuota_compra_pct: undefined });

/* Completa y comprueba el tratamiento de IVA: gravado lleva alícuota; exento y no gravado, no. */
function tratamientos(d, previo = {}) {
  const e = {}, salida = {};
  for (const lado of ['venta', 'compra']) {
    const trat = d[`tratamiento_iva_${lado}`] ?? previo[`tratamiento_iva_${lado}`] ?? 'gravado';
    const alic = d[`alicuota_${lado}`] ?? (previo[`alicuota_${lado}`] != null ? pct(previo[`alicuota_${lado}`]) : undefined);
    if (trat === 'gravado') salida[`alicuota_${lado}_codigo`] = CODIGO_ALICUOTA[alic ?? '21'];
    else { salida[`alicuota_${lado}_codigo`] = null; if (d[`alicuota_${lado}`] !== undefined) e[`alicuota_${lado}`] = `un artículo ${trat === 'exento' ? 'exento' : 'no gravado'} no lleva alícuota`; }
    salida[`tratamiento_iva_${lado}`] = trat;
  }
  return { e, salida };
}

export async function listarListas(c) { return c.consultar('select id, nombre, orden from lista_precio order by orden, nombre'); }
export async function crearLista(c, ctx, cuerpo) {
  const { valor } = validar({ nombre: { tipo: 'texto', min: 2, max: 60, requerido: true }, orden: { tipo: 'entero', min: 1, max: 99 } }, cuerpo);
  if (await c.uno('select 1 x from lista_precio where lower(nombre) = lower($1)', [valor.nombre])) throw new ErrorApi(409, 'duplicado', 'Ya existe una lista con ese nombre.');
  return c.uno('insert into lista_precio (empresa_id, nombre, orden) values ($1,$2,$3) returning id, nombre, orden', [ctx.empresaId, valor.nombre, valor.orden ?? 1]);
}

export async function precioVigente(c, articuloId, listaId, fecha) {
  const f = await c.uno(`select precio_neto::text p from articulo_precio where articulo_id = $1 and lista_id = $2 and vigente_desde <= $3 order by vigente_desde desc limit 1`, [articuloId, listaId, fecha]);
  return f ? f.p : null;
}

async function preciosDe(c, id) {
  return c.consultar(`select p.lista_id, l.nombre as lista, p.vigente_desde::text, p.precio_neto::text from articulo_precio p join lista_precio l on l.id = p.lista_id
    where p.articulo_id = $1 order by l.orden, l.nombre, p.vigente_desde desc`, [id]);
}
export async function leerArticulo(c, id) {
  const f = presentar(await c.uno(`select ${SELECT} ${DESDE} where a.id = $1`, [id]));
  if (!f) throw noEncontrado('El artículo');
  return { ...f, precios: await preciosDe(c, id), costo: (await c.uno('select costo::text c from articulo_costo where articulo_id = $1 order by fecha desc, id desc limit 1', [id]))?.c ?? null };
}

export async function crearArticulo(c, ctx, cuerpo) {
  const extra = { lista_id: { tipo: 'entero', min: 1 }, precio_neto: { tipo: 'importe', min: 0, max: 999999999999 }, costo: { tipo: 'importe', min: 0, max: 999999999999 } };
  const { valor: d } = validar({ ...CAMPOS, ...extra }, cuerpo);
  const errores = {}, { e, salida } = tratamientos(d); Object.assign(errores, e);
  if (d.precio_neto !== undefined && d.lista_id === undefined) errores.lista_id = 'indicá la lista a la que corresponde el precio';
  if (d.lista_id && !(await c.uno('select 1 x from lista_precio where id = $1', [d.lista_id]))) errores.lista_id = 'la lista de precios no existe';
  if (d.rubro_id && !(await c.uno('select 1 x from rubro where id = $1', [d.rubro_id]))) errores.rubro_id = 'el rubro no existe';
  if (d.unidad_id && !(await c.uno('select 1 x from unidad_medida where id = $1', [d.unidad_id]))) errores.unidad_id = 'la unidad no existe';
  if (Object.keys(errores).length) throw invalido(errores);
  if (await c.uno('select 1 x from articulo where codigo = $1', [d.codigo])) throw new ErrorApi(409, 'duplicado', `Ya existe un artículo con el código ${d.codigo}.`);
  const tipo = d.tipo ?? 'bien';
  const r = await c.uno(`insert into articulo (empresa_id, codigo, nombre, tipo, rubro_id, unidad_id, tratamiento_iva_venta, alicuota_venta_codigo, tratamiento_iva_compra, alicuota_compra_codigo, controla_stock)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
    [ctx.empresaId, d.codigo, d.nombre, tipo, d.rubro_id ?? null, d.unidad_id ?? null, salida.tratamiento_iva_venta, salida.alicuota_venta_codigo, salida.tratamiento_iva_compra, salida.alicuota_compra_codigo, d.controla_stock ?? tipo === 'bien']);
  if (d.precio_neto !== undefined) await c.consultar('insert into articulo_precio (empresa_id, articulo_id, lista_id, vigente_desde, precio_neto) values ($1,$2,$3,current_date,$4)', [ctx.empresaId, r.id, d.lista_id, d.precio_neto]);
  if (d.costo !== undefined) await c.consultar(`insert into articulo_costo (empresa_id, articulo_id, fecha, costo, origen) values ($1,$2,current_date,$3,'manual')`, [ctx.empresaId, r.id, d.costo]);
  return leerArticulo(c, r.id);
}

export async function listarArticulos(c, { q, activo, tipo, lista_id, fecha, limite = 50, desplazamiento = 0 } = {}) {
  const lim = Math.min(Math.max(Number(limite) || 50, 1), 100), des = Math.max(Number(desplazamiento) || 0, 0);
  const patron = q ? `%${String(q).replace(/[\\%_]/g, '\\$&').slice(0, 60)}%` : null, act = activo === undefined || activo === '' ? null : activo === true || activo === 'true';
  const lista = lista_id ? Number(lista_id) : null, f = fecha || new Date().toISOString().slice(0, 10);
  if (lista !== null && !Number.isInteger(lista)) throw invalido({ lista_id: 'tiene que ser un número' });
  const filtros = `($1::text is null or a.nombre ilike $1 or a.codigo ilike $1) and ($2::boolean is null or a.activo = $2) and ($3::text is null or a.tipo = $3)`;
  const filas = await c.consultar(`select ${SELECT}, (select p.precio_neto::text from articulo_precio p where p.articulo_id = a.id and p.lista_id = $4 and p.vigente_desde <= $5 order by p.vigente_desde desc limit 1) as precio_neto ${DESDE}
    where ${filtros} order by a.nombre limit ${lim} offset ${des}`, [patron, act, tipo || null, lista, f]);
  return { datos: filas.map(presentar), total: (await c.uno(`select count(*)::int n from articulo a where ${filtros}`, [patron, act, tipo || null])).n, limite: lim, desplazamiento: des };
}

export async function modificarArticulo(c, ctx, id, cuerpo) {
  const esquema = { ...Object.fromEntries(Object.entries(CAMPOS).filter(([k]) => !['codigo', 'tipo'].includes(k))), activo: { tipo: 'booleano' } };   // el código y el tipo no cambian: hay historia detrás
  const { valor: d } = validar(esquema, cuerpo, { parcial: true });
  if (!Object.keys(d).length) throw invalido({ _: 'No hay nada para modificar.' });
  const antes = await leerArticulo(c, id), { e, salida } = tratamientos(d, antes);
  if (Object.keys(e).length) throw invalido(e);
  const cambios = { ...d }; delete cambios.alicuota_venta; delete cambios.alicuota_compra;
  if (d.tratamiento_iva_venta !== undefined || d.alicuota_venta !== undefined) { cambios.tratamiento_iva_venta = salida.tratamiento_iva_venta; cambios.alicuota_venta_codigo = salida.alicuota_venta_codigo; }
  if (d.tratamiento_iva_compra !== undefined || d.alicuota_compra !== undefined) { cambios.tratamiento_iva_compra = salida.tratamiento_iva_compra; cambios.alicuota_compra_codigo = salida.alicuota_compra_codigo; }
  const claves = Object.keys(cambios);
  await c.consultar(`update articulo set ${claves.map((k, i) => `${k} = $${i + 2}`).join(', ')} where id = $1`, [id, ...claves.map((k) => cambios[k])]);
  const despues = await leerArticulo(c, id);
  const nombres = ['nombre', 'rubro_id', 'unidad_id', 'tratamiento_iva_venta', 'alicuota_venta', 'tratamiento_iva_compra', 'alicuota_compra', 'controla_stock', 'activo'];
  return { articulo: despues, cambios: nombres.filter((k) => String(antes[k] ?? '') !== String(despues[k] ?? '')).map((k) => [k, String(antes[k] ?? '—'), String(despues[k] ?? '—')]) };
}

/* Un cambio de precio rige desde la fecha indicada (hoy por defecto) y no toca lo ya emitido. */
export async function fijarPrecio(c, ctx, id, cuerpo) {
  const { valor: d } = validar({ lista_id: { tipo: 'entero', min: 1, requerido: true }, precio_neto: { tipo: 'importe', min: 0, max: 999999999999, requerido: true }, vigente_desde: { tipo: 'fecha' } }, cuerpo);
  if (!(await c.uno('select 1 x from articulo where id = $1', [id]))) throw noEncontrado('El artículo');
  if (!(await c.uno('select 1 x from lista_precio where id = $1', [d.lista_id]))) throw invalido({ lista_id: 'la lista de precios no existe' });
  const desde = d.vigente_desde || new Date().toISOString().slice(0, 10), antes = await precioVigente(c, id, d.lista_id, desde);
  await c.consultar(`insert into articulo_precio (empresa_id, articulo_id, lista_id, vigente_desde, precio_neto) values ($1,$2,$3,$4,$5)
    on conflict (articulo_id, lista_id, vigente_desde) do update set precio_neto = excluded.precio_neto`, [ctx.empresaId, id, d.lista_id, desde, d.precio_neto]);
  return { precios: await preciosDe(c, id), cambio: [`precio_neto (lista ${d.lista_id}, desde ${desde})`, antes ?? '—', d.precio_neto] };
}
