-- Asientos automáticos: cada comprobante y cada cobro o pago confirmado genera su asiento, y al anularlo se
-- genera el contraasiento (nunca se edita un asiento contabilizado). Es OPCIONAL por empresa
-- (empresa_parametro.asientos_automaticos) y exige tener configurada la tabla cuenta_automatica.
-- Las reglas contables son las habituales; las debe validar el contador de cada estudio.

alter table empresa_parametro add column asientos_automaticos boolean not null default false;

create table cuenta_automatica (
  empresa_id bigint not null references empresa(id),
  concepto   text   not null check (concepto in (
    'ventas','compras','iva_debito','iva_credito','deudores','proveedores',
    'percepcion_iva_sufrida','percepcion_iibb_sufrida','percepcion_ganancias_sufrida','otros_tributos_compras',
    'percepcion_iva_practicada','percepcion_iibb_practicada','otros_tributos_ventas',
    'retencion_iva_sufrida','retencion_ganancias_sufrida','retencion_iibb_sufrida','retencion_suss_sufrida',
    'retencion_iva_practicada','retencion_ganancias_practicada','retencion_iibb_practicada','retencion_suss_practicada',
    'descuentos_otorgados','descuentos_obtenidos','valores_a_depositar')),
  cuenta_id  bigint not null references plan_cuenta(id),
  primary key (empresa_id, concepto)
);

create function fn_cuenta_auto(p_empresa bigint, p_concepto text) returns bigint language plpgsql as
$$
declare v bigint;
begin
  select cuenta_id into v from cuenta_automatica where empresa_id = p_empresa and concepto = p_concepto;
  if v is null then
    raise exception 'La empresa no tiene cuenta automática para "%": configurarla antes de contabilizar', p_concepto;
  end if;
  return v;
end
$$;

create function fn_ejercicio_de(p_empresa bigint, p_fecha date) returns bigint language plpgsql as
$$
declare v bigint;
begin
  select id into v from ejercicio where empresa_id = p_empresa and p_fecha between desde and hasta and not cerrado;
  if v is null then raise exception 'No hay un ejercicio abierto para la fecha %', p_fecha; end if;
  return v;
end
$$;

-- Inserta una línea; un importe negativo se pasa al otro lado y un importe cero se omite.
create function fn_linea_asiento(p_asiento bigint, p_empresa bigint, p_cuenta bigint, p_importe numeric,
                                 p_debe boolean, p_tercero bigint default null, p_detalle text default null)
returns void language plpgsql as
$$
declare v_debe boolean;
begin
  if p_importe is null or p_importe = 0 then return; end if;
  v_debe := case when p_importe > 0 then p_debe else not p_debe end;
  insert into asiento_linea (empresa_id, asiento_id, cuenta_id, debe, haber, tercero_id, detalle)
  values (p_empresa, p_asiento, p_cuenta, case when v_debe then abs(p_importe) else 0 end,
          case when v_debe then 0 else abs(p_importe) end, p_tercero, p_detalle);
end
$$;

-- Asiento de un comprobante. Ventas: deudores / ventas, IVA débito, tributos. Compras: compras, IVA crédito,
-- percepciones / proveedores. Una nota de crédito invierte los lados.
-- Los ingresos o gastos se reparten entre las cuentas de los renglones en proporción a su importe, con
-- redondeo acumulado: la suma de las partes es SIEMPRE el total exacto.
create function fn_generar_asiento_comprobante(p_id bigint) returns bigint language plpgsql as
$$
declare
  c comprobante%rowtype;
  t arca_tipo_comprobante%rowtype;
  te tercero%rowtype;
  v_ej bigint; v_as bigint; v_tercero_cta bigint; v_default bigint;
  v_base numeric; v_debe_ingreso boolean; v_debe_tercero boolean;
  v_concepto text;
  r record;
begin
  select * into c from comprobante where id = p_id;
  if c.asiento_id is not null then raise exception 'El comprobante % ya tiene asiento', p_id; end if;
  select * into t from arca_tipo_comprobante where codigo = c.tipo_comprobante_codigo;
  select * into te from tercero where id = c.tercero_id;
  v_ej := fn_ejercicio_de(c.empresa_id, c.fecha);
  insert into asiento (empresa_id, ejercicio_id, fecha, descripcion, origen_tipo, origen_id, creado_por)
  values (c.empresa_id, v_ej, c.fecha, t.descripcion || ' ' || c.punto_venta || '-' || coalesce(c.numero::text, '?'),
          'comprobante', c.id, fn_usuario_actual())
  returning id into v_as;

  -- venta normal: el tercero va al debe y los ingresos al haber; la nota de crédito lo invierte
  v_debe_tercero := (c.sentido = 'venta') = (t.signo = 1);
  v_debe_ingreso := not v_debe_tercero;
  v_base := c.imp_neto + c.imp_tot_conc + c.imp_op_ex;
  v_concepto := case c.sentido when 'venta' then 'ventas' else 'compras' end;
  v_default := fn_cuenta_auto(c.empresa_id, v_concepto);
  v_tercero_cta := coalesce(case c.sentido when 'venta' then te.cuenta_deudores_id else te.cuenta_acreedores_id end,
                            fn_cuenta_auto(c.empresa_id, case c.sentido when 'venta' then 'deudores' else 'proveedores' end));

  perform fn_linea_asiento(v_as, c.empresa_id, v_tercero_cta, c.imp_total, v_debe_tercero, c.tercero_id, 'Cuenta corriente');

  for r in
    select cuenta_id, acum - coalesce(lag(acum) over (order by cuenta_id), 0) as parte
      from (select cuenta_id, round(v_base * sum(peso) over (order by cuenta_id) / sum(peso) over (), 2) as acum
              from (select coalesce(ci.cuenta_id,
                                    case c.sentido when 'venta' then a.cuenta_venta_id else a.cuenta_compra_id end,
                                    v_default) as cuenta_id,
                           sum(abs(ci.importe_renglon)) as peso
                      from comprobante_item ci left join articulo a on a.id = ci.articulo_id
                     where ci.comprobante_id = p_id group by 1) g
             where peso > 0) h
  loop
    perform fn_linea_asiento(v_as, c.empresa_id, r.cuenta_id, r.parte, v_debe_ingreso, null, 'Ingresos / gastos');
  end loop;

  perform fn_linea_asiento(v_as, c.empresa_id,
    fn_cuenta_auto(c.empresa_id, case c.sentido when 'venta' then 'iva_debito' else 'iva_credito' end),
    c.imp_iva, v_debe_ingreso, null, 'IVA');

  for r in select tipo, sum(importe) as importe from comprobante_tributo where comprobante_id = p_id group by tipo loop
    v_concepto := case
      when c.sentido = 'compra' and r.tipo = 'percepcion_iva'       then 'percepcion_iva_sufrida'
      when c.sentido = 'compra' and r.tipo = 'percepcion_iibb'      then 'percepcion_iibb_sufrida'
      when c.sentido = 'compra' and r.tipo = 'percepcion_ganancias' then 'percepcion_ganancias_sufrida'
      when c.sentido = 'compra'                                     then 'otros_tributos_compras'
      when r.tipo = 'percepcion_iva'                                then 'percepcion_iva_practicada'
      when r.tipo = 'percepcion_iibb'                               then 'percepcion_iibb_practicada'
      else 'otros_tributos_ventas' end;
    perform fn_linea_asiento(v_as, c.empresa_id, fn_cuenta_auto(c.empresa_id, v_concepto), r.importe, v_debe_ingreso, null, r.tipo);
  end loop;

  update asiento set estado = 'contabilizado' where id = v_as;     -- aquí se verifica el balance
  update comprobante set asiento_id = v_as where id = p_id;
  return v_as;
end
$$;

-- Asiento de un cobro (recibo) o pago (orden de pago).
create function fn_generar_asiento_pago(p_id bigint) returns bigint language plpgsql as
$$
declare
  p pago%rowtype;
  te tercero%rowtype;
  v_ej bigint; v_as bigint; v_tercero_cta bigint; v_cuenta bigint;
  v_cobro boolean;
  r record;
begin
  select * into p from pago where id = p_id;
  if p.asiento_id is not null then raise exception 'El pago % ya tiene asiento', p_id; end if;
  select * into te from tercero where id = p.tercero_id;
  v_cobro := p.sentido = 'cobro';
  v_ej := fn_ejercicio_de(p.empresa_id, p.fecha);
  insert into asiento (empresa_id, ejercicio_id, fecha, descripcion, origen_tipo, origen_id, creado_por)
  values (p.empresa_id, v_ej, p.fecha, case when v_cobro then 'Recibo ' else 'Orden de pago ' end || p.punto_venta || '-' || p.numero,
          'pago', p.id, fn_usuario_actual())
  returning id into v_as;

  v_tercero_cta := coalesce(case when v_cobro then te.cuenta_deudores_id else te.cuenta_acreedores_id end,
                            fn_cuenta_auto(p.empresa_id, case when v_cobro then 'deudores' else 'proveedores' end));
  -- cobro: los medios, las retenciones sufridas y los descuentos van al debe y el cliente al haber; el pago, al revés
  perform fn_linea_asiento(v_as, p.empresa_id, v_tercero_cta, p.total_documento, not v_cobro, p.tercero_id, 'Cuenta corriente');

  for r in select m.medio, m.importe, ca.cuenta_contable_id as cuenta_caja, cb.cuenta_contable_id as cuenta_banco,
                  ch.cuenta_bancaria_id as cheque_banco, (select cuenta_contable_id from cuenta_bancaria where id = ch.cuenta_bancaria_id) as cuenta_cheque
             from pago_medio m
             left join caja ca on ca.id = m.caja_id
             left join cuenta_bancaria cb on cb.id = m.cuenta_bancaria_id
             left join cheque ch on ch.id = m.cheque_id
            where m.pago_id = p_id loop
    v_cuenta := coalesce(r.cuenta_caja, r.cuenta_banco, r.cuenta_cheque,
                         case when v_cobro and r.medio = 'cheque' then fn_cuenta_auto(p.empresa_id, 'valores_a_depositar') end);
    if v_cuenta is null then
      raise exception 'El medio de pago "%" no tiene cuenta contable (configurar la caja o la cuenta bancaria)', r.medio;
    end if;
    perform fn_linea_asiento(v_as, p.empresa_id, v_cuenta, r.importe, v_cobro, null, r.medio);
  end loop;

  for r in select tipo, sum(importe) as importe from retencion where pago_id = p_id group by tipo loop
    perform fn_linea_asiento(v_as, p.empresa_id,
      fn_cuenta_auto(p.empresa_id, 'retencion_' || r.tipo || case when v_cobro then '_sufrida' else '_practicada' end),
      r.importe, v_cobro, null, 'Retención ' || r.tipo);
  end loop;

  perform fn_linea_asiento(v_as, p.empresa_id,
    fn_cuenta_auto(p.empresa_id, case when v_cobro then 'descuentos_otorgados' else 'descuentos_obtenidos' end),
    p.total_descuentos, v_cobro, null, 'Descuentos');

  update asiento set estado = 'contabilizado' where id = v_as;
  update pago set asiento_id = v_as where id = p_id;
  return v_as;
end
$$;

-- Anular = asiento contrario (el original no se toca, así queda la huella contable completa).
create function fn_contraasiento(p_asiento bigint, p_fecha date default current_date) returns bigint language plpgsql as
$$
declare a asiento%rowtype; v_as bigint;
begin
  select * into a from asiento where id = p_asiento;
  if a.estado <> 'contabilizado' then raise exception 'Solo se contrarresta un asiento contabilizado'; end if;
  insert into asiento (empresa_id, ejercicio_id, fecha, descripcion, origen_tipo, origen_id, creado_por)
  values (a.empresa_id, fn_ejercicio_de(a.empresa_id, p_fecha), p_fecha, 'Contraasiento de ' || a.numero,
          'contraasiento', a.id, fn_usuario_actual())
  returning id into v_as;
  insert into asiento_linea (empresa_id, asiento_id, cuenta_id, debe, haber, tercero_id, detalle)
  select empresa_id, v_as, cuenta_id, haber, debe, tercero_id, 'Contraasiento' from asiento_linea where asiento_id = p_asiento;
  update asiento set estado = 'contabilizado' where id = v_as;
  return v_as;
end
$$;

-- Disparadores: solo actúan si la empresa activó los asientos automáticos.
create function fn_comprobante_contabilizar() returns trigger language plpgsql as
$$
declare v_auto boolean;
begin
  select asientos_automaticos into v_auto from empresa_parametro where empresa_id = new.empresa_id;
  if not coalesce(v_auto, false) then return null; end if;
  if new.estado in ('confirmado','autorizado') and old.estado in ('borrador','rechazado') then
    perform fn_generar_asiento_comprobante(new.id);
  elsif new.estado = 'anulado' and new.asiento_id is not null then
    perform fn_contraasiento(new.asiento_id);
  end if;
  return null;
end
$$;
create trigger trg_comprobante_contabilizar after update of estado on comprobante
  for each row when (old.estado is distinct from new.estado) execute function fn_comprobante_contabilizar();

create function fn_pago_contabilizar() returns trigger language plpgsql as
$$
declare v_auto boolean;
begin
  select asientos_automaticos into v_auto from empresa_parametro where empresa_id = new.empresa_id;
  if not coalesce(v_auto, false) then return null; end if;
  if new.estado = 'confirmado' and old.estado = 'borrador' then
    perform fn_generar_asiento_pago(new.id);
  elsif new.estado = 'anulado' and new.asiento_id is not null then
    perform fn_contraasiento(new.asiento_id);
  end if;
  return null;
end
$$;
create trigger trg_pago_contabilizar after update of estado on pago
  for each row when (old.estado is distinct from new.estado) execute function fn_pago_contabilizar();
