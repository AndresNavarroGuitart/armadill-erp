-- Factura de compra directo contra una orden de compra, sin remito: es el espejo de la factura de venta contra un pedido (33). Un renglón de la factura puede apuntar a un renglón de una orden
-- de compra confirmada del mismo proveedor y artículo (comprobante_item.documento_item_id). Sin remito la factura ES la recepción: la aplicación ingresa el stock al cargarla (con remito no,
-- porque ya ingresó con el remito). La base impone que lo recibido por remitos confirmados más lo facturado directo no supere lo pedido: lo verifica la factura al confirmarse
-- (fn_verificar_factura_remito) y el remito de entrada al confirmarse (fn_verificar_documento). v_documento_pendiente ya cuenta lo facturado directo como recibido (33).
-- Reemplaza esas dos funciones (idénticas a las de 33 salvo por la orden de compra). Va DESPUÉS de 33 y ANTES de 35 (el endurecimiento de Supabase, que siempre es el último).

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
        if d.tipo in ('remito_venta', 'remito_compra') then                         -- lo facturado directo contra el renglón del pedido o la orden (sin remito) ya salió o ya llegó con esa factura
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
    if (r.tipo <> v_tipo and not (c.sentido = 'venta' and r.tipo = 'pedido_venta') and not (c.sentido = 'compra' and r.tipo = 'orden_compra')) or r.estado <> 'confirmado' or r.empresa_id <> c.empresa_id or r.tercero_id <> c.tercero_id then
      raise exception 'Comprobante %: un renglón toma mercadería de un documento que no es un remito % confirmado del mismo %', p_comprobante,
        case c.sentido when 'compra' then 'de entrada' else 'de salida' end, case c.sentido when 'compra' then 'proveedor' else 'cliente' end;
    end if;
    if r.articulo_factura is distinct from r.articulo_remito then
      raise exception 'Comprobante %: un renglón no es el mismo artículo que el del remito', p_comprobante;
    end if;
    select coalesce(sum(x.cantidad), 0) into v_facturado
      from comprobante_item x join comprobante k on k.id = x.comprobante_id and k.estado in ('confirmado', 'autorizado')
     where x.documento_item_id = r.documento_item_id;
    if r.tipo in ('pedido_venta', 'orden_compra') then
      -- factura directa contra el pedido o la orden: lo ya entregado o recibido con remitos también cuenta contra lo pedido
      select coalesce(sum(i.cantidad), 0) into v_remitado
        from documento_item i join documento_comercial rr on rr.id = i.documento_id and rr.estado = 'confirmado' and rr.tipo in ('remito_venta', 'remito_compra')
       where i.item_origen_id = r.documento_item_id;
      if v_facturado + v_remitado > r.llego then
        if r.tipo = 'pedido_venta' then
          raise exception 'Comprobante %: se entrega % (remitos y facturas) de un renglón de pedido donde se pidió %', p_comprobante, v_facturado + v_remitado, r.llego;
        else
          raise exception 'Comprobante %: se recibe % (remitos y facturas) de un renglón de orden donde se pidió %', p_comprobante, v_facturado + v_remitado, r.llego;
        end if;
      end if;
    elsif v_facturado > r.llego then
      raise exception 'Comprobante %: se factura % de un renglón de remito donde %', p_comprobante, v_facturado, case c.sentido when 'compra' then 'llegó ' else 'se entregó ' end || r.llego;
    end if;
  end loop;
end
$$;
