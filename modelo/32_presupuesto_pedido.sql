-- Pedido de venta contra un presupuesto: cada renglón del pedido puede apuntar a un renglón del presupuesto (documento_item.item_origen_id) y, sumando los pedidos confirmados del renglón,
-- no se pide más de lo presupuestado. Es la misma defensa que ya tenían los remitos contra el pedido o la orden de compra; el resto de las reglas de la cadena (tercero, estado del origen,
-- mismo artículo) ya estaban en fn_verificar_documento. Reemplaza esa función (idéntica a la de 13 salvo que el tope vale también para pedido_venta).
-- Va DESPUÉS de 31 y ANTES de 33 (el endurecimiento de Supabase, que siempre es el último).

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
