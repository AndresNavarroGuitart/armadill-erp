-- Conciliación bancaria desde la aplicación: permiso propio y los movimientos bancarios que no vienen de un cobro o un pago (comisiones, intereses, impuestos al débito y al crédito, gastos).
-- El modelo de 14 ya tenía el extracto, su cierre, la conciliación n a n, deshacerla, las sugerencias y el estado por cuenta; lo que le faltaba es que un movimiento suelto del banco
-- también llegue a la contabilidad: fn_movimiento_bancario lo registra en la cuenta bancaria con su asiento (banco contra la cuenta de gasto o de ingreso que se elija).
-- Va DESPUÉS de 36 y ANTES de 38 (el endurecimiento de Supabase, que siempre es el último).

insert into permiso (clave, modulo, descripcion) values
  ('conciliacion.gestionar', 'tesoreria', 'Importar extractos bancarios, conciliarlos y registrar los movimientos que solo están en el banco');
insert into rol_permiso (rol_id, permiso_clave)
  select r.id, 'conciliacion.gestionar' from rol r where r.nombre in ('Administrador', 'Contador')
  on conflict do nothing;

alter table movimiento_tesoreria add column asiento_id bigint references asiento(id);

-- Un movimiento de la cuenta bancaria que no viene de un cobro ni de un pago. El importe lleva el signo del banco: negativo sale de la cuenta (comisión, impuesto), positivo entra (interés a favor).
-- Asiento: el banco contra la cuenta elegida (gasto, ingreso, impuesto...). Sin asientos automáticos solo queda el movimiento.
create function fn_movimiento_bancario(p_cuenta bigint, p_fecha date, p_importe numeric, p_concepto text, p_contrapartida bigint)
returns bigint language plpgsql as
$$
declare
  b cuenta_bancaria%rowtype;
  v_auto boolean; v_as bigint; v_mov bigint; v_contra plan_cuenta%rowtype;
begin
  select * into b from cuenta_bancaria where id = p_cuenta;
  if not found then raise exception 'La cuenta bancaria no existe'; end if;
  if not b.activa then raise exception 'La cuenta bancaria está dada de baja'; end if;
  if b.moneda <> 'PES' then raise exception 'Por ahora solo se registran movimientos en cuentas en pesos'; end if;
  if p_importe is null or p_importe = 0 then raise exception 'El importe no puede ser cero'; end if;
  if p_fecha is null or p_fecha > current_date then raise exception 'La fecha no puede ser futura'; end if;
  if p_concepto is null or length(btrim(p_concepto)) < 3 then raise exception 'Indicá el concepto del movimiento'; end if;
  if fn_periodo_aceptado(b.empresa_id, p_fecha) <> 'ok' then raise exception 'El período contable de esa fecha no está abierto'; end if;
  select * into v_contra from plan_cuenta where id = p_contrapartida and empresa_id = b.empresa_id;
  if not found or not v_contra.imputable or not v_contra.activa then raise exception 'La cuenta contable de contrapartida no existe o no es imputable'; end if;
  select asientos_automaticos into v_auto from empresa_parametro where empresa_id = b.empresa_id;
  if coalesce(v_auto, false) and b.cuenta_contable_id is null then raise exception 'La cuenta bancaria no tiene cuenta contable'; end if;

  insert into movimiento_tesoreria (empresa_id, fecha, cuenta_bancaria_id, importe, concepto)
  values (b.empresa_id, p_fecha, b.id, p_importe, btrim(p_concepto)) returning id into v_mov;
  if coalesce(v_auto, false) then
    insert into asiento (empresa_id, ejercicio_id, fecha, descripcion, origen_tipo, origen_id, creado_por)
    values (b.empresa_id, fn_ejercicio_de(b.empresa_id, p_fecha), p_fecha, btrim(p_concepto), 'movimiento_bancario', v_mov, fn_usuario_actual()) returning id into v_as;
    perform fn_linea_asiento(v_as, b.empresa_id, b.cuenta_contable_id, p_importe, true, null, btrim(p_concepto));
    perform fn_linea_asiento(v_as, b.empresa_id, p_contrapartida, p_importe, false, null, btrim(p_concepto));
    update asiento set estado = 'contabilizado' where id = v_as;
    update movimiento_tesoreria set asiento_id = v_as where id = v_mov;
  end if;
  return v_mov;
end
$$;
