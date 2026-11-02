// Costo de ventas automático (inventario permanente): cuando sale mercadería al cliente (remito de salida, factura sin remito) o vuelve (anulación, nota de crédito con devolución) la base
// asienta su costo (Costo de ventas contra Mercaderías, o al revés). Es OPCIONAL por empresa y se activa acá. El remito lo asienta la base sola (trigger); las facturas y las notas, que mueven
// el stock desde la aplicación, llaman a contabilizarCosto con los movimientos que acaban de registrar. El costo es el vigente del artículo y queda grabado en cada movimiento.
import { validar } from './validar.mjs';

/** Asienta el costo de un grupo de movimientos de venta o devolución. No hace nada si la opción está apagada o no hay costo que asentar; devuelve el asiento o null. */
export async function contabilizarCosto(c, ids, { origenTipo, origenId, descripcion, fecha }) {
  if (!ids.length) return null;
  return (await c.uno('select fn_asiento_costo_ventas($1::bigint[], $2, $3, $4, $5) as id', [ids, origenTipo, origenId, descripcion.slice(0, 200), fecha])).id;
}

/** Los artículos con control de stock de una lista que no tienen costo cargado: su salida no genera costo de ventas. */
export async function sinCosto(c, articuloIds) {
  if (!articuloIds.length) return [];
  return c.consultar(`select a.id, a.nombre from articulo a where a.id = any($1::bigint[]) and a.controla_stock and not exists (select 1 from articulo_costo k where k.articulo_id = a.id) order by a.nombre`, [articuloIds]);
}

export async function avisoSinCosto(c, ctx, articuloIds) {
  if (!(await c.uno('select costo_ventas_automatico a from empresa_parametro where empresa_id = $1', [ctx.empresaId]))?.a) return null;
  const f = await sinCosto(c, [...new Set(articuloIds)]);
  return f.length ? `Sin costo cargado: ${f.map((x) => x.nombre).join(', ')}. Su salida no genera costo de ventas hasta que se le cargue un costo.` : null;
}

const cuenta = (f) => (f ? { id: f.id, codigo: f.codigo, nombre: f.nombre } : null);

export async function estadoCostoVentas(c, ctx) {
  const p = await c.uno('select costo_ventas_automatico as activo, asientos_automaticos from empresa_parametro where empresa_id = $1', [ctx.empresaId]);
  const cta = (concepto) => c.uno(`select pc.id, pc.codigo, pc.nombre from cuenta_automatica ca join plan_cuenta pc on pc.id = ca.cuenta_id where ca.empresa_id = $1 and ca.concepto = $2`, [ctx.empresaId, concepto]);
  const sin = await c.uno(`select count(*)::int n from articulo a where a.activo and a.controla_stock and not exists (select 1 from articulo_costo k where k.articulo_id = a.id)`);
  const hechos = await c.uno(`select count(*)::int n, coalesce(sum(l.debe), 0)::text debe from asiento a join asiento_linea l on l.asiento_id = a.id where a.empresa_id = $1 and a.origen_tipo in ('costo_remito', 'costo_comprobante') and a.estado = 'contabilizado' and l.cuenta_id = (select cuenta_id from cuenta_automatica where empresa_id = $1 and concepto = 'costo_ventas')`, [ctx.empresaId]);
  return {
    activo: !!p?.activo, asientos_automaticos: !!p?.asientos_automaticos,
    cuenta_costo_ventas: cuenta(await cta('costo_ventas')), cuenta_mercaderias: cuenta(await cta('mercaderias')),
    articulos_sin_costo: sin.n, asientos_generados: hechos.n,
  };
}

export async function configurarCostoVentas(c, ctx, cuerpo) {
  const { valor: d } = validar({ activo: { tipo: 'booleano', requerido: true } }, cuerpo);
  const antes = await estadoCostoVentas(c, ctx);
  if (d.activo === antes.activo) return { ...antes, cambio: false };
  await c.consultar('select fn_activar_costo_ventas($1, $2)', [ctx.empresaId, d.activo]);                    // si no se puede (p. ej. sin asientos automáticos) la base lo dice
  return { ...(await estadoCostoVentas(c, ctx)), cambio: true };
}
