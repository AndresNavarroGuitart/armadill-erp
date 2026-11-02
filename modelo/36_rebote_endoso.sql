-- Cheque de un tercero que rebota DESPUÉS de haberlo endosado a un proveedor (hasta ahora solo se podía rechazar uno depositado por la propia empresa). El proveedor lo presenta en su banco,
-- vuelve rechazado y nos lo devuelve: la deuda con el proveedor se repone (la orden de pago ya no la cubre) y el cliente que nos lo dio vuelve a deber ese importe. El cheque queda "rechazado".
-- Asiento: Deudores (el cliente que lo entregó) / Proveedores (a quien se lo endosamos), porque al endosarlo ya había salido de Valores a depositar.
-- El saldo del proveedor sube con esa deuda repuesta (v_saldo_tercero), igual que el del cliente con un cheque rechazado. Si se anula la orden de pago en que se había endosado, ya no puede volver
-- el cheque a la cartera (está rechazado): fn_pago_cheques lo impide. Va DESPUÉS de 35 y ANTES de 37 (el endurecimiento de Supabase, que siempre es el último).

alter table cheque add column rebotado_proveedor_id bigint references tercero(id);
alter table cheque add constraint cheque_rebote_coherente check (rebotado_proveedor_id is null or (origen = 'tercero' and estado = 'rechazado'));

-- Saldo: además de lo que el cliente vuelve a deber por un cheque rechazado, lo que se vuelve a deber al proveedor al que se lo habíamos endosado.
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
  union all
  select ch.empresa_id, ch.rebotado_proveedor_id, 'proveedor', ch.importe
    from cheque ch where ch.origen = 'tercero' and ch.estado = 'rechazado' and ch.rebotado_proveedor_id is not null
)
select empresa_id, tercero_id, rol, sum(importe)::importe as saldo from mov group by empresa_id, tercero_id, rol;

create function fn_cheque_rebotar(p_cheque bigint, p_fecha date, p_nota text) returns void language plpgsql as
$$
declare
  ch cheque%rowtype;
  v_pago pago%rowtype;
  v_ultimo date;
  v_auto boolean; v_as bigint; v_cta_cli bigint; v_cta_prov bigint;
begin
  select * into ch from cheque where id = p_cheque for update;
  if not found then raise exception 'El cheque no existe'; end if;
  if ch.origen <> 'tercero' or ch.estado <> 'entregado' then
    raise exception 'Solo rebota un cheque de un tercero que esté entregado a un proveedor (este está %)', replace(ch.estado, '_', ' ');
  end if;
  if p_fecha is null or p_fecha > current_date then raise exception 'La fecha no puede ser futura'; end if;
  select max(fecha) into v_ultimo from cheque_evento where cheque_id = ch.id;
  if p_fecha < coalesce(v_ultimo, p_fecha) then raise exception 'La fecha no puede ser anterior a la del último movimiento del cheque (%)', v_ultimo; end if;
  if p_nota is null or length(btrim(p_nota)) < 3 then raise exception 'Indicá el motivo del rebote'; end if;
  if ch.tercero_id is null then raise exception 'El cheque no tiene cliente: no se puede reponer la deuda'; end if;
  -- la orden de pago donde se lo entregó al proveedor
  select p.* into v_pago from cheque_evento e join pago p on p.id = e.pago_id where e.cheque_id = ch.id and e.estado_nuevo = 'entregado' order by e.id desc limit 1;
  if not found or v_pago.estado <> 'confirmado' then raise exception 'No se encuentra la orden de pago vigente donde se entregó el cheque %', ch.numero; end if;
  if fn_periodo_aceptado(ch.empresa_id, p_fecha) <> 'ok' then raise exception 'El período contable de esa fecha no está abierto'; end if;

  update cheque set estado = 'rechazado', rebotado_proveedor_id = v_pago.tercero_id where id = ch.id;
  select asientos_automaticos into v_auto from empresa_parametro where empresa_id = ch.empresa_id;
  if coalesce(v_auto, false) then
    select coalesce(te.cuenta_deudores_id, fn_cuenta_auto(ch.empresa_id, 'deudores')) into v_cta_cli from tercero te where te.id = ch.tercero_id;
    select coalesce(te.cuenta_acreedores_id, fn_cuenta_auto(ch.empresa_id, 'proveedores')) into v_cta_prov from tercero te where te.id = v_pago.tercero_id;
    insert into asiento (empresa_id, ejercicio_id, fecha, descripcion, origen_tipo, origen_id, creado_por)
    values (ch.empresa_id, fn_ejercicio_de(ch.empresa_id, p_fecha), p_fecha, 'Rebote del cheque endosado ' || ch.numero, 'cheque', ch.id, fn_usuario_actual()) returning id into v_as;
    perform fn_linea_asiento(v_as, ch.empresa_id, v_cta_cli, ch.importe, true, ch.tercero_id, 'Cheque ' || ch.numero || ' rebotado');
    perform fn_linea_asiento(v_as, ch.empresa_id, v_cta_prov, ch.importe, false, v_pago.tercero_id, 'Cheque ' || ch.numero || ' devuelto por el proveedor');
    update asiento set estado = 'contabilizado' where id = v_as;
  end if;
  insert into cheque_evento (empresa_id, cheque_id, fecha, estado_anterior, estado_nuevo, pago_id, nota)
  values (ch.empresa_id, ch.id, p_fecha, 'entregado', 'rechazado', v_pago.id, btrim(p_nota));
end
$$;

-- Si se anula la orden de pago en que se endosó un cheque, el cheque vuelve a la cartera solo si sigue entregado.
create or replace function fn_pago_cheques() returns trigger language plpgsql as
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
        if r.estado <> 'entregado' then
          raise exception 'No se puede anular %: el cheque % ya está % (el proveedor lo devolvió o siguió su camino: hay que resolver primero qué pasó con el cheque)', v_etiqueta, r.numero, replace(r.estado, '_', ' ');
        end if;
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
