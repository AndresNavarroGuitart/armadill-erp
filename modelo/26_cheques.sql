-- Cheques: cartera de terceros (se reciben en un cobro, se depositan, se acreditan o rebotan, o se endosan en un pago) y cheques propios (se emiten en un
-- pago y el banco los debita después). La tabla `cheque` y su historial `cheque_evento` ya existían (07 y 08); acá se les agrega el circuito completo EN LA BASE:
--   · al confirmar un cobro o un pago, sus cheques pasan de estado (recibido, entregado, emitido) y dejan su rastro;
--   · al anular, vuelven atrás solo si todavía no siguieron su camino (un cheque depositado o debitado no se "desanula");
--   · fn_cheque_pasar hace depositar, acreditar, rechazar y debitar, con sus fechas, su asiento y el movimiento del banco.
-- Va DESPUÉS de 25 y ANTES de 28 (el endurecimiento de Supabase, que siempre es el último).

insert into permiso (clave, modulo, descripcion) values
  ('cheques.gestionar', 'tesoreria', 'Depositar, acreditar y rechazar cheques de terceros, y debitar los propios');
insert into rol_permiso (rol_id, permiso_clave)
  select r.id, 'cheques.gestionar' from rol r where r.nombre in ('Administrador', 'Contador')
  on conflict do nothing;

-- Un cheque no se carga dos veces: el de un tercero se identifica por banco y número; el propio, por cuenta y número (el anulado libera el número).
create unique index cheque_tercero_unico on cheque (empresa_id, lower(banco), numero) where origen = 'tercero' and estado <> 'anulado';
create unique index cheque_propio_unico on cheque (empresa_id, cuenta_bancaria_id, numero) where origen = 'propio' and estado <> 'anulado';

-- Cuenta para los cheques propios emitidos que el banco todavía no debitó.
alter table cuenta_automatica drop constraint cuenta_automatica_concepto_check;
alter table cuenta_automatica add constraint cuenta_automatica_concepto_check check (concepto in (
    'ventas','compras','iva_debito','iva_credito','deudores','proveedores',
    'percepcion_iva_sufrida','percepcion_iibb_sufrida','percepcion_ganancias_sufrida','otros_tributos_compras',
    'percepcion_iva_practicada','percepcion_iibb_practicada','otros_tributos_ventas',
    'retencion_iva_sufrida','retencion_ganancias_sufrida','retencion_iibb_sufrida','retencion_suss_sufrida',
    'retencion_iva_practicada','retencion_ganancias_practicada','retencion_iibb_practicada','retencion_suss_practicada',
    'descuentos_otorgados','descuentos_obtenidos','valores_a_depositar','cheques_a_pagar'));

create or replace function fn_provisionar_empresa(p_empresa bigint, p_anio int) returns void language plpgsql as
$$
declare
  cuentas text[][] := array[
    ['1.1.1','Caja','activo'], ['1.1.2','Valores a depositar','activo'], ['1.1.3','Deudores por ventas','activo'], ['1.1.4','Bancos','activo'], ['1.1.5','IVA crédito fiscal','activo'],
    ['1.1.6','Percepciones sufridas','activo'], ['1.1.7','Retenciones sufridas','activo'], ['2.1.1','Proveedores','pasivo'], ['2.1.4','IVA débito fiscal','pasivo'],
    ['2.1.5','Percepciones a depositar','pasivo'], ['2.1.6','Retenciones a depositar','pasivo'], ['2.1.7','Cheques a pagar','pasivo'], ['4.1.1','Ventas','ingreso'], ['4.1.9','Descuentos otorgados','egreso'],
    ['5.1.1','Compras','egreso'], ['5.1.9','Descuentos obtenidos','ingreso']];
  mapa text[][] := array[
    ['ventas','4.1.1'], ['compras','5.1.1'], ['iva_debito','2.1.4'], ['iva_credito','1.1.5'], ['deudores','1.1.3'], ['proveedores','2.1.1'],
    ['percepcion_iva_sufrida','1.1.6'], ['percepcion_iibb_sufrida','1.1.6'], ['percepcion_ganancias_sufrida','1.1.6'], ['otros_tributos_compras','5.1.1'],
    ['percepcion_iva_practicada','2.1.5'], ['percepcion_iibb_practicada','2.1.5'], ['otros_tributos_ventas','2.1.5'],
    ['retencion_iva_sufrida','1.1.7'], ['retencion_ganancias_sufrida','1.1.7'], ['retencion_iibb_sufrida','1.1.7'], ['retencion_suss_sufrida','1.1.7'],
    ['retencion_iva_practicada','2.1.6'], ['retencion_ganancias_practicada','2.1.6'], ['retencion_iibb_practicada','2.1.6'], ['retencion_suss_practicada','2.1.6'],
    ['descuentos_otorgados','4.1.9'], ['descuentos_obtenidos','5.1.9'], ['valores_a_depositar','1.1.2'], ['cheques_a_pagar','2.1.7']];
  i int;
begin
  insert into empresa_parametro (empresa_id, asientos_automaticos) values (p_empresa, true) on conflict (empresa_id) do update set asientos_automaticos = true;
  for i in 1 .. array_length(cuentas, 1) loop
    insert into plan_cuenta (empresa_id, codigo, nombre, tipo) values (p_empresa, cuentas[i][1], cuentas[i][2], cuentas[i][3]);
  end loop;
  for i in 1 .. array_length(mapa, 1) loop
    insert into cuenta_automatica (empresa_id, concepto, cuenta_id)
      select p_empresa, mapa[i][1], c.id from plan_cuenta c where c.empresa_id = p_empresa and c.codigo = mapa[i][2];
  end loop;
  insert into ejercicio (empresa_id, desde, hasta) values (p_empresa, make_date(p_anio, 1, 1), make_date(p_anio, 12, 31));
  insert into periodo (empresa_id, desde, hasta)
    select p_empresa, d::date, (d + interval '1 month' - interval '1 day')::date from generate_series(make_date(p_anio, 1, 1)::timestamp, make_date(p_anio, 12, 1)::timestamp, interval '1 month') d;
  insert into punto_venta (empresa_id, numero, sistema) values (p_empresa, 1, 'interno');
  insert into deposito (empresa_id, nombre) values (p_empresa, 'Depósito central');
  insert into lista_precio (empresa_id, nombre, orden) values (p_empresa, 'General', 1);
  insert into caja (empresa_id, nombre, cuenta_contable_id) select p_empresa, 'Caja general', id from plan_cuenta where empresa_id = p_empresa and codigo = '1.1.1';
end
$$;

-- Las empresas que ya existían reciben la cuenta 2.1.7 "Cheques a pagar" y su cuenta automática.
insert into plan_cuenta (empresa_id, codigo, nombre, tipo)
  select e.id, '2.1.7', 'Cheques a pagar', 'pasivo' from empresa e
   where exists (select 1 from plan_cuenta p where p.empresa_id = e.id)
     and not exists (select 1 from plan_cuenta p where p.empresa_id = e.id and p.codigo = '2.1.7');
insert into cuenta_automatica (empresa_id, concepto, cuenta_id)
  select p.empresa_id, 'cheques_a_pagar', p.id from plan_cuenta p
   where p.codigo = '2.1.7' and not exists (select 1 from cuenta_automatica a where a.empresa_id = p.empresa_id and a.concepto = 'cheques_a_pagar');

-- El asiento de un cobro o un pago: un cheque no mueve caja ni banco; va a "Valores a depositar" (el de un tercero) o a "Cheques a pagar" (el propio).
create or replace function fn_generar_asiento_pago(p_id bigint) returns bigint language plpgsql as
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

  for r in select m.medio, m.importe, ca.cuenta_contable_id as cuenta_caja, cb.cuenta_contable_id as cuenta_banco, ch.origen as cheque_origen
             from pago_medio m
             left join caja ca on ca.id = m.caja_id
             left join cuenta_bancaria cb on cb.id = m.cuenta_bancaria_id
             left join cheque ch on ch.id = m.cheque_id
            where m.pago_id = p_id loop
    v_cuenta := case when r.medio = 'cheque'
                     then fn_cuenta_auto(p.empresa_id, case when r.cheque_origen = 'tercero' then 'valores_a_depositar' else 'cheques_a_pagar' end)
                     else coalesce(r.cuenta_caja, r.cuenta_banco) end;
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

-- Un cheque rechazado es plata que el cliente vuelve a deber: entra en su saldo (lo cancela un cobro a cuenta).
create or replace view v_saldo_tercero with (security_invoker = true) as
with mov as (
  select c.empresa_id, c.tercero_id,
         case c.sentido when 'venta' then 'cliente' else 'proveedor' end as rol,
         t.signo * c.imp_total as importe
    from comprobante c join arca_tipo_comprobante t on t.codigo = c.tipo_comprobante_codigo
   where c.estado in ('confirmado','autorizado')
  union all
  select p.empresa_id, p.tercero_id,
         case p.sentido when 'cobro' then 'cliente' else 'proveedor' end,
         - p.total_documento
    from pago p where p.estado = 'confirmado'
  union all
  select ch.empresa_id, ch.tercero_id, 'cliente', ch.importe
    from cheque ch where ch.origen = 'tercero' and ch.estado = 'rechazado' and ch.tercero_id is not null
)
select empresa_id, tercero_id, rol, sum(importe)::importe as saldo from mov group by empresa_id, tercero_id, rol;

-- ---------------------------------------------------------------------------
-- Al confirmar o anular un cobro o un pago, sus cheques siguen su camino
-- ---------------------------------------------------------------------------
create function fn_pago_cheques() returns trigger language plpgsql as
$$
declare
  r record;
  v_etiqueta text := case new.sentido when 'cobro' then 'Recibo ' else 'Orden de pago ' end || lpad(new.punto_venta::text, 4, '0') || '-' || lpad(new.numero::text, 8, '0');
begin
  for r in select ch.id, ch.numero, ch.origen, ch.estado, ch.importe as importe_cheque, m.importe as importe_medio, ch.tercero_id,
                  exists (select 1 from cheque_evento e where e.cheque_id = ch.id) as con_historia
             from pago_medio m join cheque ch on ch.id = m.cheque_id where m.pago_id = new.id and m.medio = 'cheque' loop
    if new.estado = 'confirmado' and old.estado = 'borrador' then
      if r.importe_cheque <> r.importe_medio then
        raise exception 'El cheque % es de $ % y se quiere usar por $ %: se entrega entero', r.numero, r.importe_cheque, r.importe_medio;
      end if;
      if new.sentido = 'cobro' then
        if r.origen <> 'tercero' or r.estado <> 'en_cartera' or r.con_historia then
          raise exception 'En un cobro solo se reciben cheques de terceros nuevos (el cheque % no lo es)', r.numero;
        end if;
        insert into cheque_evento (empresa_id, cheque_id, fecha, estado_anterior, estado_nuevo, pago_id, nota)
          values (new.empresa_id, r.id, new.fecha, null, 'en_cartera', new.id, 'Recibido en ' || v_etiqueta);
      elsif r.origen = 'tercero' then
        if r.estado <> 'en_cartera' then raise exception 'El cheque % está %: solo se endosa uno que esté en cartera', r.numero, replace(r.estado, '_', ' '); end if;
        update cheque set estado = 'entregado' where id = r.id;
        insert into cheque_evento (empresa_id, cheque_id, fecha, estado_anterior, estado_nuevo, pago_id, nota)
          values (new.empresa_id, r.id, new.fecha, 'en_cartera', 'entregado', new.id, 'Entregado en ' || v_etiqueta);
      else
        if r.estado <> 'emitido' or r.con_historia then raise exception 'En un pago solo se emiten cheques propios nuevos (el cheque % no lo es)', r.numero; end if;
        insert into cheque_evento (empresa_id, cheque_id, fecha, estado_anterior, estado_nuevo, pago_id, nota)
          values (new.empresa_id, r.id, new.fecha, null, 'emitido', new.id, 'Emitido en ' || v_etiqueta);
      end if;
    elsif new.estado = 'anulado' and old.estado = 'confirmado' then
      if new.sentido = 'cobro' then
        if r.estado <> 'en_cartera' then
          raise exception 'No se puede anular %: el cheque % ya está % (hay que resolver primero qué pasó con el cheque)', v_etiqueta, r.numero, replace(r.estado, '_', ' ');
        end if;
        update cheque set estado = 'anulado' where id = r.id;
        insert into cheque_evento (empresa_id, cheque_id, fecha, estado_anterior, estado_nuevo, pago_id, nota)
          values (new.empresa_id, r.id, current_date, 'en_cartera', 'anulado', new.id, 'Anulación de ' || v_etiqueta);
      elsif r.origen = 'tercero' then
        update cheque set estado = 'en_cartera' where id = r.id;
        insert into cheque_evento (empresa_id, cheque_id, fecha, estado_anterior, estado_nuevo, pago_id, nota)
          values (new.empresa_id, r.id, current_date, 'entregado', 'en_cartera', new.id, 'Vuelve a la cartera por la anulación de ' || v_etiqueta);
      else
        if r.estado <> 'emitido' then
          raise exception 'No se puede anular %: el cheque propio % ya está % (el banco lo debitó)', v_etiqueta, r.numero, replace(r.estado, '_', ' ');
        end if;
        update cheque set estado = 'anulado' where id = r.id;
        insert into cheque_evento (empresa_id, cheque_id, fecha, estado_anterior, estado_nuevo, pago_id, nota)
          values (new.empresa_id, r.id, current_date, 'emitido', 'anulado', new.id, 'Anulación de ' || v_etiqueta);
      end if;
    end if;
  end loop;
  return null;
end
$$;
create trigger trg_pago_cheques after update of estado on pago
  for each row when (old.estado is distinct from new.estado and new.estado in ('confirmado', 'anulado'))
  execute function fn_pago_cheques();

-- ---------------------------------------------------------------------------
-- Depositar, acreditar, rechazar (de terceros) y debitar (propios)
-- ---------------------------------------------------------------------------
create function fn_cheque_pasar(p_cheque bigint, p_accion text, p_fecha date, p_cuenta_bancaria bigint default null, p_nota text default null)
returns void language plpgsql as
$$
declare
  ch cheque%rowtype;
  v_banco cuenta_bancaria%rowtype;
  v_ultimo date;
  v_auto boolean; v_as bigint; v_cuenta bigint; v_nuevo text;
  v_desc text;
begin
  select * into ch from cheque where id = p_cheque for update;
  if not found then raise exception 'El cheque no existe'; end if;
  if p_fecha is null or p_fecha > current_date then raise exception 'La fecha no puede ser futura'; end if;
  select max(fecha) into v_ultimo from cheque_evento where cheque_id = ch.id;
  if p_fecha < coalesce(v_ultimo, p_fecha) then raise exception 'La fecha no puede ser anterior a la del último movimiento del cheque (%)', v_ultimo; end if;

  if p_accion = 'depositar' then
    if ch.origen <> 'tercero' or ch.estado <> 'en_cartera' then raise exception 'Solo se deposita un cheque de un tercero que esté en cartera (este está %)', replace(ch.estado, '_', ' '); end if;
    if ch.fecha_pago is not null and p_fecha < ch.fecha_pago then raise exception 'Es un cheque diferido: se puede depositar desde el %', to_char(ch.fecha_pago, 'DD/MM/YYYY'); end if;
    select * into v_banco from cuenta_bancaria where id = p_cuenta_bancaria;
    if not found then raise exception 'Elegí la cuenta bancaria donde se deposita'; end if;
    if not v_banco.activa then raise exception 'La cuenta bancaria está dada de baja'; end if;
    if v_banco.moneda <> 'PES' then raise exception 'Por ahora solo se depositan cheques en cuentas en pesos'; end if;
    update cheque set estado = 'depositado', cuenta_bancaria_id = v_banco.id where id = ch.id;
    v_nuevo := 'depositado';
  elsif p_accion = 'acreditar' then
    if ch.estado <> 'depositado' then raise exception 'Solo se acredita un cheque depositado (este está %)', replace(ch.estado, '_', ' '); end if;
    v_nuevo := 'acreditado';
  elsif p_accion = 'rechazar' then
    if ch.estado <> 'depositado' then raise exception 'Solo se rechaza un cheque depositado (este está %)', replace(ch.estado, '_', ' '); end if;
    if ch.tercero_id is null then raise exception 'El cheque no tiene cliente: no se puede reponer la deuda'; end if;
    if p_nota is null or length(btrim(p_nota)) < 3 then raise exception 'Indicá el motivo del rechazo'; end if;
    v_nuevo := 'rechazado';
  elsif p_accion = 'debitar' then
    if ch.origen <> 'propio' or ch.estado <> 'emitido' then raise exception 'Solo se debita un cheque propio emitido (este está %)', replace(ch.estado, '_', ' '); end if;
    if p_fecha < coalesce(ch.fecha_pago, ch.fecha_emision, p_fecha) then raise exception 'El cheque es de pago diferido: el banco lo puede debitar desde el %', to_char(coalesce(ch.fecha_pago, ch.fecha_emision), 'DD/MM/YYYY'); end if;
    v_nuevo := 'cobrado';
  else
    raise exception 'Acción desconocida: %', p_accion;
  end if;

  if p_accion <> 'depositar' then
    if fn_periodo_aceptado(ch.empresa_id, p_fecha) <> 'ok' then raise exception 'El período contable de esa fecha no está abierto'; end if;
    update cheque set estado = v_nuevo where id = ch.id;
    select * into v_banco from cuenta_bancaria where id = ch.cuenta_bancaria_id;
    if p_accion in ('acreditar', 'debitar') then
      insert into movimiento_tesoreria (empresa_id, fecha, cuenta_bancaria_id, importe, concepto)
      values (ch.empresa_id, p_fecha, v_banco.id, case p_accion when 'acreditar' then ch.importe else - ch.importe end,
              case p_accion when 'acreditar' then 'Cheque ' || ch.numero || ' acreditado' else 'Cheque propio ' || ch.numero || ' debitado' end);
    end if;
    select asientos_automaticos into v_auto from empresa_parametro where empresa_id = ch.empresa_id;
    if coalesce(v_auto, false) then
      v_desc := case p_accion when 'acreditar' then 'Acreditación del cheque ' when 'rechazar' then 'Rechazo del cheque ' else 'Débito del cheque propio ' end || ch.numero;
      insert into asiento (empresa_id, ejercicio_id, fecha, descripcion, origen_tipo, origen_id, creado_por)
      values (ch.empresa_id, fn_ejercicio_de(ch.empresa_id, p_fecha), p_fecha, v_desc, 'cheque', ch.id, fn_usuario_actual()) returning id into v_as;
      if p_accion = 'acreditar' then
        if v_banco.cuenta_contable_id is null then raise exception 'La cuenta bancaria no tiene cuenta contable'; end if;
        perform fn_linea_asiento(v_as, ch.empresa_id, v_banco.cuenta_contable_id, ch.importe, true, null, 'Cheque ' || ch.numero);
        perform fn_linea_asiento(v_as, ch.empresa_id, fn_cuenta_auto(ch.empresa_id, 'valores_a_depositar'), ch.importe, false, null, 'Cheque ' || ch.numero);
      elsif p_accion = 'rechazar' then
        select coalesce(te.cuenta_deudores_id, fn_cuenta_auto(ch.empresa_id, 'deudores')) into v_cuenta from tercero te where te.id = ch.tercero_id;
        perform fn_linea_asiento(v_as, ch.empresa_id, v_cuenta, ch.importe, true, ch.tercero_id, 'Cheque ' || ch.numero || ' rechazado');
        perform fn_linea_asiento(v_as, ch.empresa_id, fn_cuenta_auto(ch.empresa_id, 'valores_a_depositar'), ch.importe, false, null, 'Cheque ' || ch.numero);
      else
        if v_banco.cuenta_contable_id is null then raise exception 'La cuenta bancaria no tiene cuenta contable'; end if;
        perform fn_linea_asiento(v_as, ch.empresa_id, fn_cuenta_auto(ch.empresa_id, 'cheques_a_pagar'), ch.importe, true, null, 'Cheque ' || ch.numero);
        perform fn_linea_asiento(v_as, ch.empresa_id, v_banco.cuenta_contable_id, ch.importe, false, null, 'Cheque ' || ch.numero);
      end if;
      update asiento set estado = 'contabilizado' where id = v_as;
    end if;
  end if;

  insert into cheque_evento (empresa_id, cheque_id, fecha, estado_anterior, estado_nuevo, nota)
  values (ch.empresa_id, ch.id, p_fecha, ch.estado, v_nuevo, nullif(btrim(p_nota), ''));
end
$$;
