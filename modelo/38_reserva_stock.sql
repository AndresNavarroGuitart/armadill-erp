-- Reserva de stock por pedido de venta: un pedido CONFIRMADO aparta la mercadería que todavía no entregó (pedido − remitado, lo que ya calcula v_documento_pendiente) de los artículos con control de stock.
-- La reserva es por artículo, sin importar el depósito. Lo reservado no se borra ni se mueve: es una cuenta aparte, así que el stock físico (movimiento_stock) sigue siendo lo que hay en los depósitos y
-- "disponible" = existencia − reservado. La reserva se libera sola cuando el pedido se entrega, se factura directo o se anula (la vista solo mira pedidos confirmados con renglones pendientes).
-- Quién respeta la reserva lo decide la aplicación: una entrega o una factura SIN pedido no puede tomar lo reservado para otros; una entrega contra el pedido usa su propia reserva.
-- Parámetro de la empresa: con `pedido_reserva_estricta` un pedido no se confirma si no hay disponible para todo lo que pide; sin él se confirma igual (queda en espera de mercadería) y avisa.
-- Va DESPUÉS de 37 y ANTES de 40 (el endurecimiento de Supabase, que siempre es el último).

alter table empresa_parametro add column pedido_reserva_estricta boolean not null default false;

create view v_stock_reservado with (security_invoker = true) as
select v.empresa_id, v.articulo_id, sum(v.pendiente_remitir)::numeric as reservado
  from v_documento_pendiente v
  join articulo a on a.id = v.articulo_id and a.controla_stock
 where v.tipo = 'pedido_venta' and v.pendiente_remitir > 0
 group by v.empresa_id, v.articulo_id;

grant select on v_stock_reservado to app_usuario;
