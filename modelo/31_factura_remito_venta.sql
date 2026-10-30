-- Factura de venta contra un remito de salida: el mismo vínculo que en compras (comprobante_item.documento_item_id), ahora también para ventas. La mercadería ya salió del depósito
-- con el remito: la factura la valoriza y genera el cobro pendiente, pero NO vuelve a descontar el stock (eso lo decide la aplicación). La base impone lo de fondo, al confirmar la factura:
--   · el renglón tiene que ser de un remito CONFIRMADO del mismo tercero y de la misma empresa, del tipo que corresponde al sentido (remito de entrada en compras, de salida en ventas);
--   · tiene que ser el mismo artículo;
--   · no se factura más de lo que se entregó (sumando todas las facturas vigentes del renglón del remito).
-- Reemplaza la función y el disparador de 30. Va DESPUÉS de 30 y ANTES de 32 (el endurecimiento de Supabase, que siempre es el último).

create or replace function fn_verificar_factura_remito(p_comprobante bigint) returns void language plpgsql as
$$
declare
  c comprobante%rowtype;
  r record;
  v_facturado numeric;
  v_tipo text;
begin
  select * into c from comprobante where id = p_comprobante;
  v_tipo := case c.sentido when 'compra' then 'remito_compra' else 'remito_venta' end;
  for r in select ci.id, ci.articulo_id as articulo_factura, ci.documento_item_id, di.articulo_id as articulo_remito, di.cantidad as llego, di.documento_id,
                  d.tipo, d.estado, d.tercero_id, d.empresa_id
             from comprobante_item ci join documento_item di on di.id = ci.documento_item_id join documento_comercial d on d.id = di.documento_id
            where ci.comprobante_id = p_comprobante loop
    if r.tipo <> v_tipo or r.estado <> 'confirmado' or r.empresa_id <> c.empresa_id or r.tercero_id <> c.tercero_id then
      raise exception 'Comprobante %: un renglón toma mercadería de un documento que no es un remito % confirmado del mismo %', p_comprobante,
        case c.sentido when 'compra' then 'de entrada' else 'de salida' end, case c.sentido when 'compra' then 'proveedor' else 'cliente' end;
    end if;
    if r.articulo_factura is distinct from r.articulo_remito then
      raise exception 'Comprobante %: un renglón no es el mismo artículo que el del remito', p_comprobante;
    end if;
    select coalesce(sum(x.cantidad), 0) into v_facturado
      from comprobante_item x join comprobante k on k.id = x.comprobante_id and k.estado in ('confirmado', 'autorizado')
     where x.documento_item_id = r.documento_item_id;
    if v_facturado > r.llego then
      raise exception 'Comprobante %: se factura % de un renglón de remito donde %', p_comprobante, v_facturado, case c.sentido when 'compra' then 'llegó ' else 'se entregó ' end || r.llego;
    end if;
  end loop;
end
$$;

drop trigger trg_comprobante_factura_remito on comprobante;
create constraint trigger trg_comprobante_factura_remito after update of estado on comprobante
  deferrable initially immediate for each row
  when (new.sentido in ('compra', 'venta') and old.estado in ('borrador', 'rechazado') and new.estado in ('confirmado', 'autorizado'))
  execute function fn_comprobante_factura_remito();
