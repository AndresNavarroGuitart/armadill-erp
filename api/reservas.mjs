// Reserva de stock por pedido de venta: un pedido confirmado aparta lo que todavía no entregó (v_stock_reservado). Acá viven las cuentas que usan los pedidos, los remitos, las facturas y la pantalla de
// stock: existencia (lo que hay en los depósitos), reservado (lo apartado por pedidos) y disponible (existencia − reservado). La reserva es por artículo, sin importar el depósito.
import { dec, texto } from '../reglas/calculo.mjs';
import { invalido } from './errores.mjs';

export const cantTexto = (x) => texto(dec(x), 4).replace(/\.?0+$/, '');

/* Lo que hay y lo que está reservado de un artículo (como enteros escalados, para comparar sin errores de redondeo). */
export async function existenciaYReservado(c, articuloId) {
  const f = await c.uno(`select coalesce((select sum(cantidad) from movimiento_stock where articulo_id = $1), 0)::text as existencia, coalesce((select reservado from v_stock_reservado where articulo_id = $1), 0)::text as reservado`, [articuloId]);
  return { existencia: dec(f.existencia), reservado: dec(f.reservado) };
}

/* El texto que se le muestra a quien quiere sacar mercadería que otros pedidos tienen reservada. */
export function textoReservado(nombre, { existencia, reservado }) {
  const disponible = existencia - reservado > 0n ? existencia - reservado : 0n;
  return `hay ${cantTexto(texto(existencia, 4))} de ${nombre} pero ${cantTexto(texto(reservado, 4))} están reservados para pedidos de clientes: quedan ${cantTexto(texto(disponible, 4))} disponibles`;
}

export async function reservaEstricta(c) {                                        // la empresa activa es la única que deja ver el aislamiento por empresa
  return !!(await c.uno('select pedido_reserva_estricta e from empresa_parametro limit 1'))?.e;
}

/* Verifica, por artículo, que lo que se quiere sacar SIN pedido no toque lo reservado para otros. Devuelve null o { articuloId, nombre, estado }. */
export async function chocaConReservas(c, pedidas) {
  for (const [articuloId, { cantidad, nombre }] of pedidas) {
    const estado = await existenciaYReservado(c, articuloId);
    if (estado.reservado > 0n && estado.existencia - estado.reservado < cantidad) return { articuloId, nombre, estado };
  }
  return null;
}

/* Reservas vigentes: qué pedidos tienen apartada mercadería de qué artículo, con lo que falta entregar de cada renglón. */
export async function listarReservas(c, { articulo_id } = {}) {
  if (articulo_id && !/^\d{1,15}$/.test(String(articulo_id))) throw invalido({ articulo_id: 'tiene que ser un número' });
  const filas = await c.consultar(`select d.id as pedido_id, d.punto_venta, d.numero, d.fecha::text as fecha, d.vencimiento::text as entrega_prevista, te.razon_social as cliente, a.id as articulo_id, a.codigo, a.nombre as articulo,
      v.pedido::text as pedido, v.remitado::text as entregado, v.pendiente_remitir::text as reservado
    from v_documento_pendiente v join documento_comercial d on d.id = v.documento_id and d.tipo = 'pedido_venta' join tercero te on te.id = d.tercero_id join articulo a on a.id = v.articulo_id and a.controla_stock
   where v.pendiente_remitir > 0 and ($1::bigint is null or a.id = $1) order by d.fecha, d.id, v.item_id`, [articulo_id ? Number(articulo_id) : null]);
  return { datos: filas.map(({ punto_venta, numero, ...f }) => ({ ...f, pedido_numero: `${String(punto_venta).padStart(4, '0')}-${String(numero).padStart(8, '0')}` })) };
}
