-- Cierre de ejercicio: pasa el resultado del año a patrimonio neto y deja el ejercicio (y sus períodos) cerrado. Lo hace la base, en una sola transacción:
--   · asiento de cierre (origen 'cierre', fechado el último día): salda cada cuenta de ingreso y egreso del ejercicio contra "Resultados no asignados";
--   · cierra todos los períodos del ejercicio y marca el ejercicio como cerrado (después de eso no entra ningún asiento con fecha adentro);
--   · si no existe, crea el ejercicio siguiente con sus períodos.
-- Las cuentas patrimoniales no se "reabren" con un asiento de apertura: sus saldos pasan solos, porque los saldos se derivan de los asientos.
-- Reabrir deshace todo, pero solo si el ejercicio siguiente todavía no tiene movimientos. Los informes muestran los resultados del año sin el asiento de cierre.
-- Va DESPUÉS de 26 y ANTES de 30 (el endurecimiento de Supabase, que siempre es el último).

insert into permiso (clave, modulo, descripcion) values
  ('ejercicios.ver',    'contabilidad', 'Ver los ejercicios contables y su resultado'),
  ('ejercicios.cerrar', 'contabilidad', 'Cerrar y reabrir ejercicios contables');
-- fn_roles_base ya los reparte a los estudios nuevos (todo para Administrador y Contador; lo ".ver" para Auxiliar y Consulta); acá se completan los existentes.
insert into rol_permiso (rol_id, permiso_clave)
  select r.id, 'ejercicios.ver' from rol r where r.nombre in ('Administrador', 'Contador', 'Auxiliar', 'Consulta')
  on conflict do nothing;
insert into rol_permiso (rol_id, permiso_clave)
  select r.id, 'ejercicios.cerrar' from rol r where r.nombre in ('Administrador', 'Contador')
  on conflict do nothing;

alter table ejercicio
  add column asiento_cierre_id bigint references asiento(id),
  add column cerrado_en        timestamptz,
  add column cerrado_por       bigint references usuario(id);

alter table cuenta_automatica drop constraint cuenta_automatica_concepto_check;
alter table cuenta_automatica add constraint cuenta_automatica_concepto_check check (concepto in (
    'ventas','compras','iva_debito','iva_credito','deudores','proveedores',
    'percepcion_iva_sufrida','percepcion_iibb_sufrida','percepcion_ganancias_sufrida','otros_tributos_compras',
    'percepcion_iva_practicada','percepcion_iibb_practicada','otros_tributos_ventas',
    'retencion_iva_sufrida','retencion_ganancias_sufrida','retencion_iibb_sufrida','retencion_suss_sufrida',
    'retencion_iva_practicada','retencion_ganancias_practicada','retencion_iibb_practicada','retencion_suss_practicada',
    'descuentos_otorgados','descuentos_obtenidos','valores_a_depositar','cheques_a_pagar','resultados_no_asignados'));

-- Un ejercicio con sus períodos mensuales (el último se acorta si el ejercicio no termina a fin de mes).
create function fn_crear_ejercicio(p_empresa bigint, p_desde date, p_hasta date) returns bigint language plpgsql as
$$
declare v_id bigint;
begin
  insert into ejercicio (empresa_id, desde, hasta) values (p_empresa, p_desde, p_hasta) returning id into v_id;
  insert into periodo (empresa_id, desde, hasta)
    select p_empresa, greatest(d::date, p_desde), least((d + interval '1 month' - interval '1 day')::date, p_hasta)
      from generate_series(date_trunc('month', p_desde::timestamp), p_hasta::timestamp, interval '1 month') d;
  return v_id;
end
$$;

create or replace function fn_provisionar_empresa(p_empresa bigint, p_anio int) returns void language plpgsql as
$$
declare
  cuentas text[][] := array[
    ['1.1.1','Caja','activo'], ['1.1.2','Valores a depositar','activo'], ['1.1.3','Deudores por ventas','activo'], ['1.1.4','Bancos','activo'], ['1.1.5','IVA crédito fiscal','activo'],
    ['1.1.6','Percepciones sufridas','activo'], ['1.1.7','Retenciones sufridas','activo'], ['2.1.1','Proveedores','pasivo'], ['2.1.4','IVA débito fiscal','pasivo'],
    ['2.1.5','Percepciones a depositar','pasivo'], ['2.1.6','Retenciones a depositar','pasivo'], ['2.1.7','Cheques a pagar','pasivo'], ['3.1.1','Capital','patrimonio_neto'], ['3.2.1','Resultados no asignados','patrimonio_neto'], ['4.1.1','Ventas','ingreso'], ['4.1.9','Descuentos otorgados','egreso'],
    ['5.1.1','Compras','egreso'], ['5.1.9','Descuentos obtenidos','ingreso']];
  mapa text[][] := array[
    ['ventas','4.1.1'], ['compras','5.1.1'], ['iva_debito','2.1.4'], ['iva_credito','1.1.5'], ['deudores','1.1.3'], ['proveedores','2.1.1'],
    ['percepcion_iva_sufrida','1.1.6'], ['percepcion_iibb_sufrida','1.1.6'], ['percepcion_ganancias_sufrida','1.1.6'], ['otros_tributos_compras','5.1.1'],
    ['percepcion_iva_practicada','2.1.5'], ['percepcion_iibb_practicada','2.1.5'], ['otros_tributos_ventas','2.1.5'],
    ['retencion_iva_sufrida','1.1.7'], ['retencion_ganancias_sufrida','1.1.7'], ['retencion_iibb_sufrida','1.1.7'], ['retencion_suss_sufrida','1.1.7'],
    ['retencion_iva_practicada','2.1.6'], ['retencion_ganancias_practicada','2.1.6'], ['retencion_iibb_practicada','2.1.6'], ['retencion_suss_practicada','2.1.6'],
    ['descuentos_otorgados','4.1.9'], ['descuentos_obtenidos','5.1.9'], ['valores_a_depositar','1.1.2'], ['cheques_a_pagar','2.1.7'], ['resultados_no_asignados','3.2.1']];
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

-- Las empresas que ya existían reciben el capital y los resultados no asignados.
insert into plan_cuenta (empresa_id, codigo, nombre, tipo)
  select e.id, x.codigo, x.nombre, 'patrimonio_neto' from empresa e cross join (values ('3.1.1', 'Capital'), ('3.2.1', 'Resultados no asignados')) x(codigo, nombre)
   where exists (select 1 from plan_cuenta p where p.empresa_id = e.id)
     and not exists (select 1 from plan_cuenta p where p.empresa_id = e.id and p.codigo = x.codigo);
insert into cuenta_automatica (empresa_id, concepto, cuenta_id)
  select p.empresa_id, 'resultados_no_asignados', p.id from plan_cuenta p
   where p.codigo = '3.2.1' and not exists (select 1 from cuenta_automatica a where a.empresa_id = p.empresa_id and a.concepto = 'resultados_no_asignados');

-- ---------------------------------------------------------------------------
-- Cerrar un ejercicio
-- ---------------------------------------------------------------------------
create function fn_cerrar_ejercicio(p_ejercicio bigint) returns bigint language plpgsql as
$$
declare
  e ejercicio%rowtype;
  v_rna bigint; v_as bigint; v_total numeric := 0; v_anterior date; v_borradores int;
  r record;
begin
  select * into e from ejercicio where id = p_ejercicio for update;
  if not found then raise exception 'El ejercicio no existe'; end if;
  if e.cerrado then raise exception 'El ejercicio ya está cerrado'; end if;
  if e.hasta > current_date then raise exception 'El ejercicio termina el %: no se puede cerrar antes de esa fecha', to_char(e.hasta, 'DD/MM/YYYY'); end if;
  select min(desde) into v_anterior from ejercicio where empresa_id = e.empresa_id and hasta < e.desde and not cerrado;
  if v_anterior is not null then raise exception 'Primero hay que cerrar el ejercicio anterior (el que empieza el %)', to_char(v_anterior, 'DD/MM/YYYY'); end if;
  select count(*) into v_borradores from asiento where empresa_id = e.empresa_id and estado = 'borrador' and fecha between e.desde and e.hasta;
  if v_borradores > 0 then raise exception 'Hay % asiento(s) en borrador dentro del ejercicio: hay que contabilizarlos o descartarlos antes de cerrar', v_borradores; end if;
  v_rna := fn_cuenta_auto(e.empresa_id, 'resultados_no_asignados');

  if not exists (select 1 from ejercicio where empresa_id = e.empresa_id and desde = e.hasta + 1) then
    perform fn_crear_ejercicio(e.empresa_id, e.hasta + 1, (e.hasta + 1 + interval '1 year' - interval '1 day')::date);
  end if;
  -- el período del último día tiene que aceptar el asiento de cierre (se vuelve a cerrar más abajo)
  update periodo set estado = 'abierto' where empresa_id = e.empresa_id and not anulado and e.hasta between desde and hasta and estado = 'cerrado';

  for r in select pc.id as cuenta_id, sum(l.debe - l.haber) as saldo
             from asiento_linea l join asiento a on a.id = l.asiento_id and a.estado = 'contabilizado' join plan_cuenta pc on pc.id = l.cuenta_id
            where a.empresa_id = e.empresa_id and a.fecha between e.desde and e.hasta and a.origen_tipo is distinct from 'cierre' and pc.tipo in ('ingreso', 'egreso')
            group by pc.id having sum(l.debe - l.haber) <> 0 order by pc.id loop
    if v_as is null then
      insert into asiento (empresa_id, ejercicio_id, fecha, descripcion, origen_tipo, origen_id, creado_por)
      values (e.empresa_id, e.id, e.hasta, 'Cierre del ejercicio ' || to_char(e.desde, 'DD/MM/YYYY') || ' al ' || to_char(e.hasta, 'DD/MM/YYYY'), 'cierre', e.id, fn_usuario_actual())
      returning id into v_as;
    end if;
    perform fn_linea_asiento(v_as, e.empresa_id, r.cuenta_id, r.saldo, false, null, 'Cierre del ejercicio');      -- saldo deudor → al haber, y al revés
    v_total := v_total + r.saldo;
  end loop;
  if v_as is not null then
    perform fn_linea_asiento(v_as, e.empresa_id, v_rna, v_total, true, null, 'Resultado del ejercicio');          -- pérdida al debe, ganancia al haber
    update asiento set estado = 'contabilizado' where id = v_as;                                                  -- acá la base verifica el balance y el período
  end if;
  update periodo set estado = 'cerrado' where empresa_id = e.empresa_id and not anulado and desde >= e.desde and hasta <= e.hasta;
  update ejercicio set cerrado = true, asiento_cierre_id = v_as, cerrado_en = now(), cerrado_por = fn_usuario_actual() where id = e.id;
  return v_as;
end
$$;

-- ---------------------------------------------------------------------------
-- Reabrir el último ejercicio cerrado (solo si el siguiente todavía no tiene movimientos)
-- ---------------------------------------------------------------------------
create function fn_reabrir_ejercicio(p_ejercicio bigint) returns void language plpgsql as
$$
declare e ejercicio%rowtype;
begin
  select * into e from ejercicio where id = p_ejercicio for update;
  if not found then raise exception 'El ejercicio no existe'; end if;
  if not e.cerrado then raise exception 'El ejercicio no está cerrado'; end if;
  if exists (select 1 from ejercicio where empresa_id = e.empresa_id and desde > e.hasta and cerrado) then raise exception 'Primero hay que reabrir el ejercicio siguiente'; end if;
  if exists (select 1 from asiento where empresa_id = e.empresa_id and estado = 'contabilizado' and fecha > e.hasta) then
    raise exception 'El ejercicio siguiente ya tiene movimientos: este no se puede reabrir';
  end if;
  if e.asiento_cierre_id is not null then update asiento set estado = 'anulado' where id = e.asiento_cierre_id; end if;
  update periodo set estado = 'abierto' where empresa_id = e.empresa_id and not anulado and desde >= e.desde and hasta <= e.hasta;
  update ejercicio set cerrado = false, asiento_cierre_id = null, cerrado_en = null, cerrado_por = null where id = e.id;
end
$$;
