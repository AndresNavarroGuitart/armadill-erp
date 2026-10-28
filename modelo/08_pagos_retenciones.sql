-- Cobranzas y pagos (recibos y órdenes de pago) con su identidad contable:
--     imputado + a_cuenta = medios + retenciones + descuentos
-- Las retenciones las ingresa el operador (como el original); fn_retencion_sugerida solo propone.

create table pago (
  id                  bigint generated always as identity primary key,
  empresa_id          bigint not null references empresa(id),
  sentido             text   not null check (sentido in ('cobro','pago')),
  punto_venta         integer not null default 1,
  numero              bigint not null,
  fecha               date   not null,
  tercero_id          bigint not null references tercero(id),
  total_medios        importe not null default 0 check (total_medios >= 0),
  total_retenciones   importe not null default 0 check (total_retenciones >= 0),
  total_descuentos    importe not null default 0 check (total_descuentos >= 0),
  total_documento     importe generated always as (total_medios + total_retenciones + total_descuentos) stored,
  total_imputado      importe not null default 0 check (total_imputado >= 0),
  a_cuenta            importe generated always as (total_medios + total_retenciones + total_descuentos - total_imputado) stored,
  estado              text   not null default 'borrador' check (estado in ('borrador','confirmado','anulado')),
  asiento_id          bigint references asiento(id),
  observaciones       text,
  creado_por          bigint references usuario(id),
  creado_en           timestamptz not null default now(),
  check (total_imputado <= total_medios + total_retenciones + total_descuentos),
  unique (empresa_id, sentido, punto_venta, numero)
);
create index on pago (empresa_id, tercero_id, fecha);

alter table cheque_evento add constraint cheque_evento_pago_fk foreign key (pago_id) references pago(id);

create function fn_pago_numero() returns trigger language plpgsql as
$$
begin
  if new.numero is null then
    new.numero := fn_siguiente(new.empresa_id, case new.sentido when 'cobro' then 'recibo-' else 'op-' end || new.punto_venta);
  end if;
  return new;
end
$$;
-- numero declarado NOT NULL: el trigger lo completa antes de que se evalúe la restricción
create trigger trg_pago_numero before insert on pago for each row execute function fn_pago_numero();

create table pago_imputacion (
  id             bigint generated always as identity primary key,
  empresa_id     bigint not null references empresa(id),
  pago_id        bigint not null references pago(id) on delete cascade,
  comprobante_id bigint not null references comprobante(id),
  importe        importe not null check (importe > 0),
  unique (pago_id, comprobante_id)
);

create table pago_medio (
  id                  bigint generated always as identity primary key,
  empresa_id          bigint not null references empresa(id),
  pago_id             bigint not null references pago(id) on delete cascade,
  medio               text   not null check (medio in ('efectivo','cheque','transferencia','tarjeta')),
  caja_id             bigint references caja(id),
  cuenta_bancaria_id  bigint references cuenta_bancaria(id),
  cheque_id           bigint references cheque(id),
  importe             importe not null check (importe > 0),
  detalle             jsonb,                             -- tarjeta, plan, cuotas, lote, cupón (como el TPV del original)
  check ((medio in ('efectivo','tarjeta') and caja_id is not null)
      or (medio = 'cheque' and cheque_id is not null)
      or (medio = 'transferencia' and cuenta_bancaria_id is not null)),
  check (num_nonnulls(caja_id, cuenta_bancaria_id) <= 1)
);

-- practicada = la hago yo al pagar (orden de pago); sufrida = me la hacen al cobrar (recibo).
create table retencion (
  id                   bigint generated always as identity primary key,
  empresa_id           bigint not null references empresa(id),
  pago_id              bigint not null references pago(id) on delete cascade,
  origen               text   not null check (origen in ('practicada','sufrida')),
  tipo                 text   not null check (tipo in ('iva','ganancias','iibb','suss')),
  jurisdiccion_codigo  smallint references arca_jurisdiccion(codigo),
  regimen_id           bigint references regimen_retencion(id),
  base_imponible       importe,
  alicuota             tasa,
  importe              importe not null check (importe > 0),
  certificado_numero   text   not null,
  certificado_fecha    date   not null,
  check (tipo <> 'iibb' or jurisdiccion_codigo is not null)
);
create unique index retencion_certificado_practicado on retencion (empresa_id, tipo, certificado_numero)
  where origen = 'practicada';
create index on retencion (empresa_id, tipo, certificado_fecha);

-- Cada medio de pago mueve una caja o una cuenta bancaria (signo: + entra, - sale).
create table movimiento_tesoreria (
  id                  bigint generated always as identity primary key,
  empresa_id          bigint not null references empresa(id),
  fecha               date   not null,
  caja_id             bigint references caja(id),
  cuenta_bancaria_id  bigint references cuenta_bancaria(id),
  importe             importe not null check (importe <> 0),
  pago_medio_id       bigint references pago_medio(id),
  concepto            text,
  conciliado_en       date,
  check (num_nonnulls(caja_id, cuenta_bancaria_id) = 1)
);
create index on movimiento_tesoreria (empresa_id, caja_id);
create index on movimiento_tesoreria (empresa_id, cuenta_bancaria_id);

-- ---------------------------------------------------------------------------
-- Guardias: un pago confirmado no se modifica
-- ---------------------------------------------------------------------------
create function fn_pago_guardia() returns trigger language plpgsql as
$$
begin
  if current_setting('app.migracion', true) = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'INSERT' then
    if new.estado <> 'borrador' then raise exception 'Un pago se crea en borrador y se confirma después'; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.estado <> 'borrador' then raise exception 'Un pago % no se borra: se anula', old.estado; end if;
    return old;
  end if;
  if old.estado <> 'borrador' and
     (new.sentido, new.punto_venta, new.numero, new.fecha, new.tercero_id, new.total_medios,
      new.total_retenciones, new.total_descuentos, new.total_imputado)
     is distinct from
     (old.sentido, old.punto_venta, old.numero, old.fecha, old.tercero_id, old.total_medios,
      old.total_retenciones, old.total_descuentos, old.total_imputado) then
    raise exception 'El pago % está % y sus importes no se modifican', old.id, old.estado;
  end if;
  if new.estado <> old.estado and (old.estado, new.estado) not in
     (('borrador','confirmado'), ('borrador','anulado'), ('confirmado','anulado')) then
    raise exception 'Transición de estado no permitida: % -> %', old.estado, new.estado;
  end if;
  return new;
end
$$;
create trigger trg_pago_guardia before insert or update or delete on pago
  for each row execute function fn_pago_guardia();

create function fn_pago_hijo_guardia() returns trigger language plpgsql as
$$
declare v_estado text;
begin
  if current_setting('app.migracion', true) = 'on' then return coalesce(new, old); end if;
  select estado into v_estado from pago where id = coalesce(new.pago_id, old.pago_id);
  if v_estado is not null and v_estado <> 'borrador' then
    raise exception 'El pago está %; no se modifican sus medios, imputaciones ni retenciones', v_estado;
  end if;
  return coalesce(new, old);
end
$$;
create trigger trg_pago_imputacion_guardia before insert or update or delete on pago_imputacion
  for each row execute function fn_pago_hijo_guardia();
create trigger trg_pago_medio_guardia before insert or update or delete on pago_medio
  for each row execute function fn_pago_hijo_guardia();
create trigger trg_retencion_guardia before insert or update or delete on retencion
  for each row execute function fn_pago_hijo_guardia();

-- ---------------------------------------------------------------------------
-- Verificación al confirmar un pago o cobro
-- ---------------------------------------------------------------------------
create function fn_verificar_pago(p_id bigint) returns void language plpgsql as
$$
declare
  p        pago%rowtype;
  v_ter    tercero%rowtype;
  s_medios importe; s_ret importe; s_imp importe;
  v_per    text;
  v_sent_comprobante text;
  r        record;
begin
  select * into p from pago where id = p_id;
  select * into v_ter from tercero where id = p.tercero_id;
  v_sent_comprobante := case p.sentido when 'cobro' then 'venta' else 'compra' end;

  v_per := fn_periodo_aceptado(p.empresa_id, p.fecha);
  if v_per <> 'ok' then raise exception 'Pago %: período no aceptado (%)', p_id, v_per; end if;

  if p.sentido = 'cobro' and not v_ter.es_cliente then raise exception 'Pago %: el tercero no es cliente', p_id; end if;
  if p.sentido = 'pago' and not v_ter.es_proveedor then raise exception 'Pago %: el tercero no es proveedor', p_id; end if;

  select coalesce(sum(importe), 0) into s_medios from pago_medio where pago_id = p_id;
  select coalesce(sum(importe), 0) into s_ret from retencion where pago_id = p_id;
  select coalesce(sum(importe), 0) into s_imp from pago_imputacion where pago_id = p_id;
  if s_medios <> p.total_medios then
    raise exception 'Pago %: los medios suman % y la cabecera dice %', p_id, s_medios, p.total_medios;
  end if;
  if s_ret <> p.total_retenciones then
    raise exception 'Pago %: las retenciones suman % y la cabecera dice %', p_id, s_ret, p.total_retenciones;
  end if;
  if s_imp <> p.total_imputado then
    raise exception 'Pago %: las imputaciones suman % y la cabecera dice %', p_id, s_imp, p.total_imputado;
  end if;
  if exists (select 1 from retencion where pago_id = p_id
              and origen <> case p.sentido when 'cobro' then 'sufrida' else 'practicada' end) then
    raise exception 'Pago %: una retención no corresponde al sentido del pago', p_id;
  end if;

  -- cada comprobante imputado: mismo tercero y sentido, y su saldo (ya con este pago) no puede quedar negativo
  for r in select pi.comprobante_id, c.tercero_id, c.sentido, c.estado, t.signo, s.saldo
             from pago_imputacion pi
             join comprobante c on c.id = pi.comprobante_id
             join arca_tipo_comprobante t on t.codigo = c.tipo_comprobante_codigo
             left join v_saldo_comprobante s on s.comprobante_id = c.id
            where pi.pago_id = p_id loop
    if r.tercero_id <> p.tercero_id then
      raise exception 'Pago %: el comprobante % es de otro tercero', p_id, r.comprobante_id;
    end if;
    if r.sentido <> v_sent_comprobante then
      raise exception 'Pago %: el comprobante % no corresponde al sentido del pago', p_id, r.comprobante_id;
    end if;
    if r.estado not in ('confirmado','autorizado') or r.signo <> 1 then
      raise exception 'Pago %: el comprobante % no es una deuda imputable', p_id, r.comprobante_id;
    end if;
    if r.saldo < 0 then
      raise exception 'Pago %: se imputa más que el saldo del comprobante % (queda %)', p_id, r.comprobante_id, r.saldo;
    end if;
  end loop;
end
$$;

create function fn_pago_confirmar() returns trigger language plpgsql as
$$ begin perform fn_verificar_pago(new.id); return null; end $$;
create constraint trigger trg_pago_confirmar after update of estado on pago
  deferrable initially immediate for each row
  when (old.estado = 'borrador' and new.estado = 'confirmado')
  execute function fn_pago_confirmar();

-- La caja y el banco se mueven SOLO por la confirmación (o anulación) del pago: nadie carga movimientos a mano
-- para un pago, así no quedan movimientos huérfanos de un borrador que nunca se confirmó.
create function fn_pago_tesoreria() returns trigger language plpgsql as
$$
begin
  if new.estado = 'confirmado' then
    insert into movimiento_tesoreria (empresa_id, fecha, caja_id, cuenta_bancaria_id, importe, pago_medio_id, concepto)
    select m.empresa_id, new.fecha, m.caja_id, m.cuenta_bancaria_id,
           case new.sentido when 'cobro' then m.importe else - m.importe end, m.id,
           case new.sentido when 'cobro' then 'Cobro ' else 'Pago ' end || new.punto_venta || '-' || new.numero
      from pago_medio m
     where m.pago_id = new.id and num_nonnulls(m.caja_id, m.cuenta_bancaria_id) = 1;
  elsif new.estado = 'anulado' then
    insert into movimiento_tesoreria (empresa_id, fecha, caja_id, cuenta_bancaria_id, importe, pago_medio_id, concepto)
    select t.empresa_id, current_date, t.caja_id, t.cuenta_bancaria_id, - t.importe, t.pago_medio_id,
           'Anulación ' || new.punto_venta || '-' || new.numero
      from movimiento_tesoreria t
     where t.pago_medio_id in (select id from pago_medio where pago_id = new.id);
  end if;
  return null;
end
$$;
create trigger trg_pago_tesoreria after update of estado on pago
  for each row when (old.estado is distinct from new.estado and new.estado in ('confirmado','anulado'))
  execute function fn_pago_tesoreria();

-- Un movimiento de tesorería no se borra ni se edita (solo se marca conciliado): se contrarresta con otro.
create function fn_movimiento_tesoreria_guardia() returns trigger language plpgsql as
$$
begin
  if tg_op = 'DELETE' then raise exception 'Un movimiento de tesorería no se borra: se registra el contrario'; end if;
  if (new.fecha, new.caja_id, new.cuenta_bancaria_id, new.importe, new.pago_medio_id)
     is distinct from (old.fecha, old.caja_id, old.cuenta_bancaria_id, old.importe, old.pago_medio_id) then
    raise exception 'Un movimiento de tesorería no se edita: solo se marca conciliado';
  end if;
  return new;
end
$$;
create trigger trg_movimiento_tesoreria_guardia before update or delete on movimiento_tesoreria
  for each row execute function fn_movimiento_tesoreria_guardia();

-- Aplicación de una nota de crédito a una factura: mismo tercero y ninguno de los dos saldos negativo.
create function fn_aplicacion_verificar() returns trigger language plpgsql as
$$
declare
  n comprobante%rowtype; f comprobante%rowtype;
  tn arca_tipo_comprobante%rowtype; tf arca_tipo_comprobante%rowtype;
  sn importe; sf importe;
begin
  select * into n from comprobante where id = new.nota_id;
  select * into f from comprobante where id = new.factura_id;
  select * into tn from arca_tipo_comprobante where codigo = n.tipo_comprobante_codigo;
  select * into tf from arca_tipo_comprobante where codigo = f.tipo_comprobante_codigo;
  if tn.clase <> 'nota_credito' then raise exception 'El comprobante % no es una nota de crédito', n.id; end if;
  if tf.signo <> 1 then raise exception 'El comprobante % no es una deuda aplicable', f.id; end if;
  if n.tercero_id <> f.tercero_id or n.empresa_id <> f.empresa_id or n.sentido <> f.sentido then
    raise exception 'La nota y la factura deben ser del mismo tercero y sentido';
  end if;
  if n.estado not in ('confirmado','autorizado') or f.estado not in ('confirmado','autorizado') then
    raise exception 'Solo se aplican comprobantes confirmados';
  end if;
  select saldo into sn from v_saldo_comprobante where comprobante_id = n.id;
  select saldo into sf from v_saldo_comprobante where comprobante_id = f.id;
  if sn < 0 or sf < 0 then raise exception 'La aplicación supera el saldo de la nota (%) o de la factura (%)', sn, sf; end if;
  return null;
end
$$;
create constraint trigger trg_aplicacion_verificar after insert or update on comprobante_aplicacion
  deferrable initially immediate for each row execute function fn_aplicacion_verificar();
