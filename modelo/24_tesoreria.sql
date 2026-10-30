-- Cobros y pagos desde la aplicación: permisos propios, constancia de la anulación, idempotencia también para pagos y la caja y el banco con los
-- que nace una empresa. Las reglas de fondo (identidad contable del pago, imputación sin pasarse del saldo, asiento automático, movimientos de
-- tesorería generados solo al confirmar o anular, retenciones con certificado) ya las imponen 07, 08 y 15.
-- Va DESPUÉS de 23 y ANTES de 30 (el endurecimiento de Supabase, que siempre es el último).

insert into permiso (clave, modulo, descripcion) values
  ('tesoreria.ver',          'tesoreria', 'Ver cobros, pagos, cajas, bancos y sus movimientos'),
  ('cobros.registrar',       'tesoreria', 'Registrar cobros (recibos)'),
  ('pagos.registrar',        'tesoreria', 'Registrar pagos a proveedores (órdenes de pago)'),
  ('tesoreria.anular',       'tesoreria', 'Anular cobros y pagos'),
  ('tesoreria.administrar',  'tesoreria', 'Crear y modificar cajas y cuentas bancarias');
insert into rol_permiso (rol_id, permiso_clave)
  select r.id, p.clave from rol r cross join permiso p
   where p.clave in ('tesoreria.ver', 'cobros.registrar', 'pagos.registrar', 'tesoreria.anular', 'tesoreria.administrar') and r.nombre in ('Administrador', 'Contador')
  on conflict do nothing;
insert into rol_permiso (rol_id, permiso_clave) select r.id, 'tesoreria.ver' from rol r where r.nombre in ('Auxiliar', 'Consulta') on conflict do nothing;

-- Quién anuló un cobro o un pago, cuándo y por qué.
alter table pago
  add column motivo_anulacion text check (motivo_anulacion is null or length(btrim(motivo_anulacion)) between 3 and 200),
  add column anulado_en       timestamptz,
  add column anulado_por      bigint references usuario(id);

-- Un doble clic o un reintento no registra dos veces el mismo cobro: la clave de idempotencia ahora puede apuntar a un comprobante o a un pago.
alter table api_idempotencia alter column comprobante_id drop not null;
alter table api_idempotencia add column pago_id bigint references pago(id);
alter table api_idempotencia add constraint api_idempotencia_un_destino check (num_nonnulls(comprobante_id, pago_id) = 1);

create or replace function fn_provisionar_empresa(p_empresa bigint, p_anio int) returns void language plpgsql as
$$
declare
  cuentas text[][] := array[
    ['1.1.1','Caja','activo'], ['1.1.2','Valores a depositar','activo'], ['1.1.3','Deudores por ventas','activo'], ['1.1.4','Bancos','activo'], ['1.1.5','IVA crédito fiscal','activo'],
    ['1.1.6','Percepciones sufridas','activo'], ['1.1.7','Retenciones sufridas','activo'], ['2.1.1','Proveedores','pasivo'], ['2.1.4','IVA débito fiscal','pasivo'],
    ['2.1.5','Percepciones a depositar','pasivo'], ['2.1.6','Retenciones a depositar','pasivo'], ['4.1.1','Ventas','ingreso'], ['4.1.9','Descuentos otorgados','egreso'],
    ['5.1.1','Compras','egreso'], ['5.1.9','Descuentos obtenidos','ingreso']];
  mapa text[][] := array[
    ['ventas','4.1.1'], ['compras','5.1.1'], ['iva_debito','2.1.4'], ['iva_credito','1.1.5'], ['deudores','1.1.3'], ['proveedores','2.1.1'],
    ['percepcion_iva_sufrida','1.1.6'], ['percepcion_iibb_sufrida','1.1.6'], ['percepcion_ganancias_sufrida','1.1.6'], ['otros_tributos_compras','5.1.1'],
    ['percepcion_iva_practicada','2.1.5'], ['percepcion_iibb_practicada','2.1.5'], ['otros_tributos_ventas','2.1.5'],
    ['retencion_iva_sufrida','1.1.7'], ['retencion_ganancias_sufrida','1.1.7'], ['retencion_iibb_sufrida','1.1.7'], ['retencion_suss_sufrida','1.1.7'],
    ['retencion_iva_practicada','2.1.6'], ['retencion_ganancias_practicada','2.1.6'], ['retencion_iibb_practicada','2.1.6'], ['retencion_suss_practicada','2.1.6'],
    ['descuentos_otorgados','4.1.9'], ['descuentos_obtenidos','5.1.9'], ['valores_a_depositar','1.1.2']];
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

-- Las empresas que ya existían reciben la cuenta "Bancos" y una caja.
insert into plan_cuenta (empresa_id, codigo, nombre, tipo)
  select e.id, '1.1.4', 'Bancos', 'activo' from empresa e
   where exists (select 1 from plan_cuenta p where p.empresa_id = e.id)
     and not exists (select 1 from plan_cuenta p where p.empresa_id = e.id and p.codigo = '1.1.4');
insert into caja (empresa_id, nombre, cuenta_contable_id)
  select e.id, 'Caja general', (select p.id from plan_cuenta p where p.empresa_id = e.id and p.codigo = '1.1.1') from empresa e
   where not exists (select 1 from caja c where c.empresa_id = e.id)
     and exists (select 1 from plan_cuenta p where p.empresa_id = e.id and p.codigo = '1.1.1');
