-- Documentos comerciales previos o paralelos a la factura:
--   venta : presupuesto -> pedido_venta -> remito_venta -> factura
--   compra: orden_compra -> remito_compra -> factura
-- Un remito CONFIRMADO mueve el stock (el trigger lo genera y lo contrarresta al anular). Una factura
-- emitida a partir de un remito referencia el renglón del remito y NO vuelve a mover stock (lo decide la aplicación).
-- El cumplimiento (pedido / remitado / facturado / pendiente) se deriva en vistas: no se guarda.

create table documento_comercial (
  id                    bigint generated always as identity primary key,
  empresa_id            bigint not null references empresa(id),
  tipo                  text   not null check (tipo in ('presupuesto','pedido_venta','remito_venta','orden_compra','remito_compra')),
  punto_venta           integer not null default 1,
  numero                bigint not null,
  fecha                 date   not null,
  vencimiento           date,
  tercero_id            bigint not null references tercero(id),
  documento_origen_id   bigint references documento_comercial(id),
  moneda                char(3) not null default 'PES' references arca_moneda(codigo),
  cotizacion            numeric(18,6) not null default 1 check (cotizacion > 0),
  estado                text   not null default 'borrador' check (estado in ('borrador','confirmado','anulado')),
  observaciones         text,
  creado_por            bigint references usuario(id),
  creado_en             timestamptz not null default now(),
  check (vencimiento is null or vencimiento >= fecha),
  unique (empresa_id, tipo, punto_venta, numero)
);
create index on documento_comercial (empresa_id, tercero_id, fecha);

create table documento_item (
  id              bigint generated always as identity primary key,
  empresa_id      bigint not null references empresa(id),
  documento_id    bigint not null references documento_comercial(id) on delete cascade,
  orden           smallint not null,
  articulo_id     bigint references articulo(id),
  descripcion     text   not null,
  cantidad        numeric(18,4) not null check (cantidad > 0),
  precio_unitario importe4 not null default 0 check (precio_unitario >= 0),
  deposito_id     bigint references deposito(id),
  item_origen_id  bigint references documento_item(id),     -- renglón del documento anterior de la cadena
  unique (documento_id, orden)
);
create index on documento_item (item_origen_id);

alter table comprobante_item add column documento_item_id bigint references documento_item(id);
alter table movimiento_stock add column documento_item_id bigint references documento_item(id);

create function fn_documento_numero() returns trigger language plpgsql as
$$
begin
  if new.numero is null then
    new.numero := fn_siguiente(new.empresa_id, new.tipo || '-' || new.punto_venta);
  end if;
  return new;
end
$$;
create trigger trg_documento_numero before insert on documento_comercial
  for each row execute function fn_documento_numero();

-- Guardia: borrador editable; confirmado solo puede anularse.
create function fn_documento_guardia() returns trigger language plpgsql as
$$
begin
  if current_setting('app.migracion', true) = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'INSERT' then
    if new.estado <> 'borrador' then raise exception 'Un documento se crea en borrador y se confirma después'; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.estado <> 'borrador' then raise exception 'Un documento % no se borra: se anula', old.estado; end if;
    return old;
  end if;
  if old.estado <> 'borrador' and
     (new.tipo, new.punto_venta, new.numero, new.fecha, new.tercero_id, new.documento_origen_id, new.moneda, new.cotizacion)
     is distinct from
     (old.tipo, old.punto_venta, old.numero, old.fecha, old.tercero_id, old.documento_origen_id, old.moneda, old.cotizacion) then
    raise exception 'El documento % está % y no se modifica', old.id, old.estado;
  end if;
  if new.estado <> old.estado and (old.estado, new.estado) not in
     (('borrador','confirmado'), ('borrador','anulado'), ('confirmado','anulado')) then
    raise exception 'Transición de estado no permitida: % -> %', old.estado, new.estado;
  end if;
  return new;
end
$$;
create trigger trg_documento_guardia before insert or update or delete on documento_comercial
  for each row execute function fn_documento_guardia();

create function fn_documento_item_guardia() returns trigger language plpgsql as
$$
declare v_estado text;
begin
  if current_setting('app.migracion', true) = 'on' then return coalesce(new, old); end if;
  select estado into v_estado from documento_comercial where id = coalesce(new.documento_id, old.documento_id);
  if v_estado is not null and v_estado <> 'borrador' then
    raise exception 'El documento está %; no se modifican sus renglones', v_estado;
  end if;
  return coalesce(new, old);
end
$$;
create trigger trg_documento_item_guardia before insert or update or delete on documento_item
  for each row execute function fn_documento_item_guardia();

-- Verificación al confirmar: rol del tercero, cadena de documentos y sobre-entrega.
create function fn_verificar_documento(p_id bigint) returns void language plpgsql as
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
      if d.tipo in ('remito_venta','remito_compra') then
        select coalesce(sum(i.cantidad), 0) into v_total
          from documento_item i join documento_comercial dd on dd.id = i.documento_id
         where i.item_origen_id = r.item_origen_id and dd.estado = 'confirmado' and dd.tipo = d.tipo;
        if v_total > (select cantidad from documento_item where id = r.item_origen_id) then
          raise exception 'Documento %: se remite % y el documento de origen solo pide %', p_id, v_total,
                          (select cantidad from documento_item where id = r.item_origen_id);
        end if;
      end if;
    end if;
    if d.tipo in ('remito_venta','remito_compra') and coalesce(r.controla_stock, false) and r.deposito_id is null then
      raise exception 'Documento %: un renglón con control de stock necesita depósito', p_id;
    end if;
  end loop;
end
$$;

create function fn_documento_confirmar() returns trigger language plpgsql as
$$ begin perform fn_verificar_documento(new.id); return null; end $$;
create constraint trigger trg_documento_confirmar after update of estado on documento_comercial
  deferrable initially immediate for each row
  when (old.estado = 'borrador' and new.estado = 'confirmado')
  execute function fn_documento_confirmar();

-- Un remito confirmado mueve el stock; al anularlo se contrarresta.
create function fn_remito_stock() returns trigger language plpgsql as
$$
declare v_signo int;
begin
  if new.tipo not in ('remito_venta','remito_compra') then return null; end if;
  v_signo := case new.tipo when 'remito_compra' then 1 else -1 end;
  if new.estado = 'confirmado' then
    insert into movimiento_stock (empresa_id, fecha, articulo_id, deposito_id, cantidad, tipo, documento_item_id, costo_unitario)
    select di.empresa_id, new.fecha, di.articulo_id, di.deposito_id, v_signo * di.cantidad,
           case new.tipo when 'remito_compra' then 'compra' else 'venta' end, di.id,
           case when new.tipo = 'remito_compra' then di.precio_unitario end
      from documento_item di join articulo a on a.id = di.articulo_id
     where di.documento_id = new.id and a.controla_stock;
  elsif new.estado = 'anulado' then
    insert into movimiento_stock (empresa_id, fecha, articulo_id, deposito_id, cantidad, tipo, documento_item_id)
    select m.empresa_id, current_date, m.articulo_id, m.deposito_id, - m.cantidad,
           case new.tipo when 'remito_compra' then 'devolucion_compra' else 'devolucion_venta' end, m.documento_item_id
      from movimiento_stock m
     where m.documento_item_id in (select id from documento_item where documento_id = new.id);
  end if;
  return null;
end
$$;
create trigger trg_remito_stock after update of estado on documento_comercial
  for each row when (old.estado is distinct from new.estado and new.estado in ('confirmado','anulado'))
  execute function fn_remito_stock();

-- Cumplimiento de cada renglón de pedido u orden: pedido, remitado, facturado y pendiente de remitir.
create view v_documento_pendiente with (security_invoker = true) as
select di.empresa_id, d.id as documento_id, d.tipo, d.numero, d.tercero_id, di.id as item_id, di.articulo_id,
       di.cantidad                                   as pedido,
       coalesce(rm.cantidad, 0)                      as remitado,
       coalesce(fa.cantidad, 0)                      as facturado,
       di.cantidad - coalesce(rm.cantidad, 0)        as pendiente_remitir,
       coalesce(rm.cantidad, 0) - coalesce(fa.cantidad, 0) as remitado_sin_facturar
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
     where ci.documento_item_id = di.id
        or ci.documento_item_id in (select i.id from documento_item i where i.item_origen_id = di.id)) fa on true;
