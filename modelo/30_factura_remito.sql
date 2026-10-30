-- Factura de compra contra un remito de entrada: un renglón de la factura puede tomar un renglón de un remito (comprobante_item.documento_item_id). Es la misma mercadería que ya
-- ingresó con el remito: la factura la valoriza y genera la deuda, pero NO vuelve a ingresar el stock (eso lo decide la aplicación). La base impone lo de fondo, al confirmar la factura:
--   · el renglón tiene que ser de un remito de entrada CONFIRMADO del mismo proveedor y de la misma empresa, y del mismo artículo;
--   · no se factura más de lo que llegó (sumando todas las facturas vigentes del renglón del remito).
-- Va DESPUÉS de 29 y ANTES de 31 (el endurecimiento de Supabase, que siempre es el último).

create function fn_verificar_factura_remito(p_comprobante bigint) returns void language plpgsql as
$$
declare
  c comprobante%rowtype;
  r record;
  v_facturado numeric;
begin
  select * into c from comprobante where id = p_comprobante;
  for r in select ci.id, ci.articulo_id as articulo_factura, ci.documento_item_id, di.articulo_id as articulo_remito, di.cantidad as llego, di.documento_id,
                  d.tipo, d.estado, d.tercero_id, d.empresa_id
             from comprobante_item ci join documento_item di on di.id = ci.documento_item_id join documento_comercial d on d.id = di.documento_id
            where ci.comprobante_id = p_comprobante loop
    if r.tipo <> 'remito_compra' or r.estado <> 'confirmado' or r.empresa_id <> c.empresa_id or r.tercero_id <> c.tercero_id or c.sentido <> 'compra' then
      raise exception 'Comprobante %: un renglón toma mercadería de un documento que no es un remito de entrada confirmado del mismo proveedor', p_comprobante;
    end if;
    if r.articulo_factura is distinct from r.articulo_remito then
      raise exception 'Comprobante %: un renglón no es el mismo artículo que el del remito', p_comprobante;
    end if;
    select coalesce(sum(x.cantidad), 0) into v_facturado
      from comprobante_item x join comprobante k on k.id = x.comprobante_id and k.estado in ('confirmado', 'autorizado')
     where x.documento_item_id = r.documento_item_id;
    if v_facturado > r.llego then
      raise exception 'Comprobante %: se factura % de un renglón de remito donde llegó %', p_comprobante, v_facturado, r.llego;
    end if;
  end loop;
end
$$;

create function fn_comprobante_factura_remito() returns trigger language plpgsql as
$$ begin perform fn_verificar_factura_remito(new.id); return null; end $$;
create constraint trigger trg_comprobante_factura_remito after update of estado on comprobante
  deferrable initially immediate for each row
  when (new.sentido = 'compra' and old.estado in ('borrador', 'rechazado') and new.estado in ('confirmado', 'autorizado'))
  execute function fn_comprobante_factura_remito();
