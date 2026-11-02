-- Factura de venta directo contra un pedido, sin remito: un renglón de la factura puede apuntar a un renglón de un pedido de venta confirmado del mismo cliente (comprobante_item.documento_item_id,
-- igual que con un remito). Cuando no hay remito la factura ES la entrega: la aplicación descuenta el stock al emitirla (con remito no, porque ya salió con el remito). La base impone lo de fondo:
--   · el renglón de pedido tiene que ser de un pedido CONFIRMADO del mismo cliente y empresa, y del mismo artículo;
--   · entregado por remitos confirmados + facturado directo no supera lo pedido: lo verifica la factura al confirmarse (fn_verificar_factura_remito) y el remito al confirmarse (fn_verificar_documento).
-- v_documento_pendiente cuenta lo facturado directo como entregado (remitado), así el pendiente de remitir del pedido baja con la factura. Reemplaza lo de 13, 30, 31 y 32 que corresponda.
-- Va DESPUÉS de 32 y ANTES de 34 (el endurecimiento de Supabase, que siempre es el último).

create or replace function fn_verificar_documento(p_id bigint) returns void language plpgsql as
$$
declare
  d documento_comercial%rowtype;
  o documento_comercial%rowtype;
  v_ter tercero%rowtype;
  v_esperado text;
  r record;
  v_total numeric;
begin
  select * into d from documento_comercial where id = p_id;
  select * into v_ter from tercero where id = d.tercero_id;

  if d.tipo in ('presupuesto','pedido_venta','remito_venta') and not v_ter.es_cliente then
    raise exception 'Documento %: el tercero no es cliente', p_id;
  end if;
  if d.tipo in ('orden_compra','remito_compra') and not v_ter.es_proveedor then
    raise exception 'Documento %: el tercero no es proveedor', p_id;
  end if;
  if not exists (select 1 from documento_item where documento_id = p_id) then
    raise exception 'Documento %: no tiene renglones', p_id;
  end if;

  if d.documento_origen_id is not null then
    select * into o from documento_comercial where id = d.documento_origen_id;
    v_esperado := case d.tipo when 'pedido_venta' then 'presupuesto' when 'remito_venta' then 'pedido_venta'
                              when 'remito_compra' then 'orden_compra' end;
    if v_esperado is null or o.tipo <> v_esperado then
      raise exception 'Documento %: un % no puede originarse en un %', p_id, d.tipo, o.tipo;
    end if;
    if o.empresa_id <> d.empresa_id or o.tercero_id <> d.tercero_id then
      raise exception 'Documento %: el origen es de otra empresa o de otro tercero', p_id;
    end if;
    if o.estado <> 'confirmado' then
      raise exception 'Documento %: el origen está %', p_id, o.estado;
    end if;
  end if;

  for r in select di.id, di.articulo_id, di.item_origen_id, di.deposito_id, a.controla_stock
             from documento_item di left join articulo a on a.id = di.articulo_id
            where di.documento_id = p_id loop
    if r.item_origen_id is not null then
      if not exists (select 1 from documento_item x where x.id = r.item_origen_id and x.documento_id = d.documento_origen_id
                      and x.articulo_id is not distinct from r.articulo_id) then
        raise exception 'Documento %: un renglón no corresponde a un renglón del documento de origen', p_id;
      end if;
      if d.tipo in ('pedido_venta','remito_venta','remito_compra') then
        select coalesce(sum(i.cantidad), 0) into v_total
          from documento_item i join documento_comercial dd on dd.id = i.documento_id
         where i.item_origen_id = r.item_origen_id and dd.estado = 'confirmado' and dd.tipo = d.tipo;
        if d.tipo = 'remito_venta' then                                            -- lo facturado directo contra el renglón del pedido (sin remito) ya salió con esa factura
          v_total := v_total + coalesce((select sum(ci.cantidad) from comprobante_item ci join comprobante c on c.id = ci.comprobante_id and c.estado in ('confirmado', 'autorizado')
                                          where ci.documento_item_id = r.item_origen_id), 0);
        end if;
        if v_total > (select cantidad from documento_item where id = r.item_origen_id) then
          raise exception 'Documento %: se % % y el documento de origen solo %', p_id, case d.tipo when 'pedido_venta' then 'pide' else 'remite' end, v_total,
                          case d.tipo when 'pedido_venta' then 'presupuestó ' else 'pide ' end || (select cantidad from documento_item where id = r.item_origen_id);
        end if;
      end if;
    end if;
    if d.tipo in ('remito_venta','remito_compra') and coalesce(r.controla_stock, false) and r.deposito_id is null then
      raise exception 'Documento %: un renglón con control de stock necesita depósito', p_id;
    end if;
  end loop;
end
$$;

create or replace function fn_verificar_factura_remito(p_comprobante bigint) returns void language plpgsql as
$$
declare
  c comprobante%rowtype;
  r record;
  v_facturado numeric;
  v_remitado numeric;
  v_tipo text;
begin
  select * into c from comprobante where id = p_comprobante;
  v_tipo := case c.sentido when 'compra' then 'remito_compra' else 'remito_venta' end;
  for r in select ci.id, ci.articulo_id as articulo_factura, ci.documento_item_id, di.articulo_id as articulo_remito, di.cantidad as llego, di.documento_id,
                  d.tipo, d.estado, d.tercero_id, d.empresa_id
             from comprobante_item ci join documento_item di on di.id = ci.documento_item_id join documento_comercial d on d.id = di.documento_id
            where ci.comprobante_id = p_comprobante loop
    if (r.tipo <> v_tipo and not (c.sentido = 'venta' and r.tipo = 'pedido_venta')) or r.estado <> 'confirmado' or r.empresa_id <> c.empresa_id or r.tercero_id <> c.tercero_id then
      raise exception 'Comprobante %: un renglón toma mercadería de un documento que no es un remito % confirmado del mismo %', p_comprobante,
        case c.sentido when 'compra' then 'de entrada' else 'de salida' end, case c.sentido when 'compra' then 'proveedor' else 'cliente' end;
    end if;
    if r.articulo_factura is distinct from r.articulo_remito then
      raise exception 'Comprobante %: un renglón no es el mismo artículo que el del remito', p_comprobante;
    end if;
    select coalesce(sum(x.cantidad), 0) into v_facturado
      from comprobante_item x join comprobante k on k.id = x.comprobante_id and k.estado in ('confirmado', 'autorizado')
     where x.documento_item_id = r.documento_item_id;
    if r.tipo = 'pedido_venta' then
      -- factura directa contra el pedido: lo ya entregado con remitos también cuenta contra lo pedido
      select coalesce(sum(i.cantidad), 0) into v_remitado
        from documento_item i join documento_comercial rr on rr.id = i.documento_id and rr.estado = 'confirmado' and rr.tipo = 'remito_venta'
       where i.item_origen_id = r.documento_item_id;
      if v_facturado + v_remitado > r.llego then
        raise exception 'Comprobante %: se entrega % (remitos y facturas) de un renglón de pedido donde se pidió %', p_comprobante, v_facturado + v_remitado, r.llego;
      end if;
    elsif v_facturado > r.llego then
      raise exception 'Comprobante %: se factura % de un renglón de remito donde %', p_comprobante, v_facturado, case c.sentido when 'compra' then 'llegó ' else 'se entregó ' end || r.llego;
    end if;
  end loop;
end
$$;

-- Cumplimiento de cada renglón de pedido u orden: pedido, remitado (remitos confirmados + lo facturado directo contra el pedido), facturado y pendiente de remitir.
create or replace view v_documento_pendiente with (security_invoker = true) as
select di.empresa_id, d.id as documento_id, d.tipo, d.numero, d.tercero_id, di.id as item_id, di.articulo_id,
       di.cantidad                                                       as pedido,
       coalesce(rm.cantidad, 0) + coalesce(fd.cantidad, 0)               as remitado,
       coalesce(fa.cantidad, 0)                                          as facturado,
       di.cantidad - coalesce(rm.cantidad, 0) - coalesce(fd.cantidad, 0) as pendiente_remitir,
       coalesce(rm.cantidad, 0) + coalesce(fd.cantidad, 0) - coalesce(fa.cantidad, 0) as remitado_sin_facturar
  from documento_item di
  join documento_comercial d on d.id = di.documento_id and d.estado = 'confirmado'
                            and d.tipo in ('pedido_venta','orden_compra')
  left join lateral (
    select sum(i.cantidad) as cantidad
      from documento_item i join documento_comercial r on r.id = i.documento_id and r.estado = 'confirmado'
     where i.item_origen_id = di.id) rm on true
  left join lateral (
    select sum(ci.cantidad) as cantidad
      from comprobante_item ci join comprobante c on c.id = ci.comprobante_id and c.estado in ('confirmado','autorizado')
     where ci.documento_item_id = di.id) fd on true
  left join lateral (
    select sum(ci.cantidad) as cantidad
      from comprobante_item ci join comprobante c on c.id = ci.comprobante_id and c.estado in ('confirmado','autorizado')
     where ci.documento_item_id = di.id
        or ci.documento_item_id in (select i.id from documento_item i where i.item_origen_id = di.id)) fa on true;
