// Listas de precios: alta, cambio de nombre y orden, baja de las que no se usan, y ajuste de precios en bloque por porcentaje.
// El precio se guarda solo neto y con vigencia (articulo_precio): un ajuste agrega precios nuevos con su fecha, no pisa el historial.
// Las cuentas son exactas (enteros con 6 decimales, reglas/calculo.mjs), nunca con punto flotante.
import { validar } from './validar.mjs';
import { ErrorApi, invalido, noEncontrado } from './errores.mjs';
import { dec, div, mul, redondear, texto } from '../reglas/calculo.mjs';

const MAX_ARTICULOS_POR_AJUSTE = 5000;
const hoyISO = () => new Date().toISOString().slice(0, 10);
const enEmpresa = () => noEncontrado('La lista de precios');

export async function listarListas(c) {
  return c.consultar(`select l.id, l.nombre, l.orden,
    (select count(distinct p.articulo_id)::int from articulo_precio p where p.lista_id = l.id) as articulos,
    (select count(*)::int from tercero t where t.lista_precio_id = l.id and t.activo) as clientes
    from lista_precio l order by l.orden, l.nombre`);
}
async function leerLista(c, id) {
  const l = (await listarListas(c)).find((x) => x.id === id);
  if (!l) throw enEmpresa();
  return l;
}

export async function crearLista(c, ctx, cuerpo) {
  const { valor } = validar({ nombre: { tipo: 'texto', min: 2, max: 60, requerido: true }, orden: { tipo: 'entero', min: 1, max: 99 } }, cuerpo);
  if (await c.uno('select 1 x from lista_precio where lower(nombre) = lower($1)', [valor.nombre])) throw new ErrorApi(409, 'duplicado', 'Ya existe una lista con ese nombre.');
  const r = await c.uno('insert into lista_precio (empresa_id, nombre, orden) values ($1,$2,$3) returning id', [ctx.empresaId, valor.nombre, valor.orden ?? 1]);
  return leerLista(c, r.id);
}

export async function modificarLista(c, ctx, id, cuerpo) {
  const { valor: d } = validar({ nombre: { tipo: 'texto', min: 2, max: 60 }, orden: { tipo: 'entero', min: 1, max: 99 } }, cuerpo, { parcial: true });
  if (!Object.keys(d).length) throw invalido({ _: 'No hay nada para modificar.' });
  const antes = await leerLista(c, id);
  if (d.nombre !== undefined && await c.uno('select 1 x from lista_precio where lower(nombre) = lower($1) and id <> $2', [d.nombre, id])) throw new ErrorApi(409, 'duplicado', 'Ya existe una lista con ese nombre.');
  const cambios = ['nombre', 'orden'].filter((k) => k in d && d[k] !== antes[k]).map((k) => [k, String(antes[k]), String(d[k])]);
  if (cambios.length) await c.consultar('update lista_precio set nombre = coalesce($2, nombre), orden = coalesce($3, orden) where id = $1', [id, d.nombre ?? null, d.orden ?? null]);
  return { lista: await leerLista(c, id), cambios };
}

/* Solo se borra una lista que nadie usa: sin precios cargados y sin clientes asignados (aunque estén dados de baja). Y la empresa conserva al menos una. */
export async function eliminarLista(c, id) {
  const l = await leerLista(c, id);
  const usos = await c.uno('select (select count(*)::int from articulo_precio where lista_id = $1) as precios, (select count(*)::int from tercero where lista_precio_id = $1) as clientes', [id]);
  if (usos.precios || usos.clientes) throw new ErrorApi(422, 'lista_en_uso', `La lista ${l.nombre} se usa: tiene ${usos.precios} precios cargados y ${usos.clientes} clientes asignados. Quitale el uso antes de borrarla.`);
  if ((await c.uno('select count(*)::int n from lista_precio')).n <= 1) throw new ErrorApi(422, 'ultima_lista', 'La empresa necesita al menos una lista de precios.');
  await c.consultar('delete from lista_precio where id = $1', [id]);
  return l;
}

const REDONDEOS = { centavos: (x) => redondear(x, 2), entero: (x) => redondear(x, 0), decena: (x) => redondear(div(x, dec('10')), 0) * 10n };

/* Ajuste en bloque: precio nuevo = precio de la lista base (vigente a esa fecha) × (1 + porcentaje / 100), redondeado como se pida.
   Con simular = true solo muestra qué pasaría. Los precios nuevos rigen desde `vigente_desde`; si ya había uno cargado para esa fecha exacta, se reemplaza. */
export async function ajustarPrecios(c, ctx, id, cuerpo) {
  const { valor: d } = validar({
    porcentaje: { tipo: 'importe', min: -99.99, max: 1000, requerido: true }, base_lista_id: { tipo: 'entero', min: 1 }, vigente_desde: { tipo: 'fecha' },
    redondeo: { tipo: 'enum', valores: Object.keys(REDONDEOS) }, articulo_ids: { tipo: 'lista', max: MAX_ARTICULOS_POR_AJUSTE, elemento: { id: { tipo: 'entero', min: 1, requerido: true } } }, simular: { tipo: 'booleano' },
  }, { ...cuerpo, articulo_ids: Array.isArray(cuerpo?.articulo_ids) ? cuerpo.articulo_ids.map((x) => ({ id: x })) : cuerpo?.articulo_ids });
  const lista = await leerLista(c, id), baseId = d.base_lista_id ?? id, fecha = d.vigente_desde ?? hoyISO(), errores = {};
  if (baseId !== id && !(await c.uno('select 1 x from lista_precio where id = $1', [baseId]))) errores.base_lista_id = 'la lista base no existe';
  if (baseId === id && Number(d.porcentaje) === 0) errores.porcentaje = 'con la misma lista como base, un ajuste de 0 % no cambia nada';
  if (fecha < '2000-01-01' || fecha > '2100-01-01') errores.vigente_desde = 'la fecha no es razonable';
  if (Object.keys(errores).length) throw invalido(errores);
  const ids = d.articulo_ids ? d.articulo_ids.map((x) => x.id) : null;

  const filas = await c.consultar(`select a.id, a.codigo, a.nombre, bp.precio::text as base, tp.precio::text as actual,
      (select k.costo::text from articulo_costo k where k.articulo_id = a.id order by k.fecha desc, k.id desc limit 1) as costo
    from articulo a
    join lateral (select p.precio_neto as precio from articulo_precio p where p.articulo_id = a.id and p.lista_id = $1 and p.vigente_desde <= $3 order by p.vigente_desde desc limit 1) bp on true
    left join lateral (select p.precio_neto as precio from articulo_precio p where p.articulo_id = a.id and p.lista_id = $2 and p.vigente_desde <= $3 order by p.vigente_desde desc limit 1) tp on true
    where a.activo and ($4::bigint[] is null or a.id = any($4)) order by a.codigo limit ${MAX_ARTICULOS_POR_AJUSTE + 1}`, [baseId, id, fecha, ids]);
  if (filas.length > MAX_ARTICULOS_POR_AJUSTE) throw new ErrorApi(422, 'demasiados_articulos', `Son más de ${MAX_ARTICULOS_POR_AJUSTE} artículos: elegí un grupo más chico.`);

  const factor = div(dec('100') + dec(d.porcentaje), dec('100')), redondea = REDONDEOS[d.redondeo ?? 'centavos'];
  const calculadas = filas.map((f) => {
    const nuevo = texto(redondea(mul(dec(f.base), factor)), 2);
    return { articulo_id: f.id, codigo: f.codigo, nombre: f.nombre, base: f.base, actual: f.actual, nuevo, cambia: f.actual === null || dec(f.actual) !== dec(nuevo), bajo_costo: f.costo !== null && dec(nuevo) < dec(f.costo), costo: f.costo };
  });
  const aCambiar = calculadas.filter((x) => x.cambia);
  const conBase = filas.length, sinPrecioBase = ids ? ids.length - conBase : (await c.uno(`select count(*)::int n from articulo a where a.activo and not exists (select 1 from articulo_precio p where p.articulo_id = a.id and p.lista_id = $1 and p.vigente_desde <= $2)`, [baseId, fecha])).n;
  const resumen = { lista: lista.nombre, base_lista_id: baseId, porcentaje: d.porcentaje, vigente_desde: fecha, redondeo: d.redondeo ?? 'centavos', total: conBase, cambian: aCambiar.length, sin_cambio: conBase - aCambiar.length, sin_precio_base: Math.max(sinPrecioBase, 0), bajo_costo: aCambiar.filter((x) => x.bajo_costo).length };
  if (d.simular) return { aplicado: false, ...resumen, datos: aCambiar.slice(0, 200).map(({ cambia, ...x }) => x) };
  if (!aCambiar.length) throw new ErrorApi(422, 'sin_cambios', 'Con esos datos ningún precio cambia.');
  await c.consultar(`insert into articulo_precio (empresa_id, articulo_id, lista_id, vigente_desde, precio_neto)
    select $1, t.a, $2, $3::date, t.p from unnest($4::bigint[], $5::numeric[]) as t(a, p)
    on conflict (articulo_id, lista_id, vigente_desde) do update set precio_neto = excluded.precio_neto`, [ctx.empresaId, id, fecha, aCambiar.map((x) => x.articulo_id), aCambiar.map((x) => x.nuevo)]);
  return { aplicado: true, ...resumen };
}
