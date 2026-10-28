-- Vistas: saldos y libros se DERIVAN de los comprobantes; nunca se guardan (principio 1 del modelo).
-- Las vistas heredan RLS del usuario que consulta (security_invoker).

-- Saldo de cada comprobante: total menos lo aplicado por recibos/órdenes de pago y por notas de crédito.
create view v_saldo_comprobante with (security_invoker = true) as
select c.id                                  as comprobante_id,
       c.empresa_id,
       c.tercero_id,
       c.sentido,
       t.clase,
       c.imp_total                           as total,
       coalesce(pi.aplicado, 0) + coalesce(af.aplicado, 0) + coalesce(an.aplicado, 0) as aplicado,
       c.imp_total - (coalesce(pi.aplicado, 0) + coalesce(af.aplicado, 0) + coalesce(an.aplicado, 0)) as saldo
  from comprobante c
  join arca_tipo_comprobante t on t.codigo = c.tipo_comprobante_codigo
  left join (select i.comprobante_id, sum(i.importe) as aplicado
               from pago_imputacion i join pago p on p.id = i.pago_id and p.estado = 'confirmado'
              group by i.comprobante_id) pi on pi.comprobante_id = c.id
  left join (select factura_id, sum(importe) as aplicado from comprobante_aplicacion group by factura_id) af
         on af.factura_id = c.id
  left join (select nota_id, sum(importe) as aplicado from comprobante_aplicacion group by nota_id) an
         on an.nota_id = c.id
 where c.estado in ('confirmado','autorizado');

-- Cuenta corriente: facturas y notas de débito suman; notas de crédito y recibos/pagos restan.
create view v_saldo_tercero with (security_invoker = true) as
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
)
select empresa_id, tercero_id, rol, sum(importe)::importe as saldo from mov group by empresa_id, tercero_id, rol;

-- Libro de IVA (ventas y compras). La nota de crédito entra con signo negativo en TODAS las columnas.
-- Exento y no gravado van en columnas separadas, y existe columna para cada alícuota (defectos D-01 y D-02).
create view v_libro_iva with (security_invoker = true) as
select c.empresa_id,
       c.id                                   as comprobante_id,
       c.sentido,
       c.fecha,
       date_trunc('month', c.fecha)::date     as mes,
       t.descripcion                          as tipo,
       c.punto_venta,
       c.numero,
       c.tercero_id,
       te.razon_social,
       te.nro_documento,
       c.estado,
       (t.signo * c.imp_neto)::importe        as neto_gravado,
       (t.signo * coalesce(iv.iva_2_5, 0))::importe  as iva_2_5,
       (t.signo * coalesce(iv.iva_5, 0))::importe    as iva_5,
       (t.signo * coalesce(iv.iva_10_5, 0))::importe as iva_10_5,
       (t.signo * coalesce(iv.iva_21, 0))::importe   as iva_21,
       (t.signo * coalesce(iv.iva_27, 0))::importe   as iva_27,
       (t.signo * c.imp_iva)::importe         as iva_total,
       (t.signo * c.imp_tot_conc)::importe    as no_gravado,
       (t.signo * c.imp_op_ex)::importe       as exento,
       (t.signo * coalesce(tr.perc_iva, 0))::importe  as percepcion_iva,
       (t.signo * coalesce(tr.perc_iibb, 0))::importe as percepcion_iibb,
       (t.signo * coalesce(tr.perc_gan, 0))::importe  as percepcion_ganancias,
       (t.signo * coalesce(tr.otros, 0))::importe     as otros_tributos,
       (t.signo * c.imp_total)::importe       as total
  from comprobante c
  join arca_tipo_comprobante t on t.codigo = c.tipo_comprobante_codigo
  join tercero te on te.id = c.tercero_id
  left join lateral (
    select sum(importe_iva) filter (where alicuota_codigo = 9) as iva_2_5,
           sum(importe_iva) filter (where alicuota_codigo = 8) as iva_5,
           sum(importe_iva) filter (where alicuota_codigo = 4) as iva_10_5,
           sum(importe_iva) filter (where alicuota_codigo = 5) as iva_21,
           sum(importe_iva) filter (where alicuota_codigo = 6) as iva_27
      from comprobante_iva where comprobante_id = c.id) iv on true
  left join lateral (
    select sum(importe) filter (where tipo = 'percepcion_iva')       as perc_iva,
           sum(importe) filter (where tipo = 'percepcion_iibb')      as perc_iibb,
           sum(importe) filter (where tipo = 'percepcion_ganancias') as perc_gan,
           sum(importe) filter (where tipo not in ('percepcion_iva','percepcion_iibb','percepcion_ganancias')) as otros
      from comprobante_tributo where comprobante_id = c.id) tr on true
 where c.estado in ('confirmado','autorizado');

create view v_libro_iva_ventas  with (security_invoker = true) as select * from v_libro_iva where sentido = 'venta';
create view v_libro_iva_compras with (security_invoker = true) as select * from v_libro_iva where sentido = 'compra';

-- Posición de IVA mensual: saldo = (débito - crédito) - retención IVA sufrida - percepción IVA sufrida.
create view v_posicion_iva with (security_invoker = true) as
with libro as (
  select empresa_id, mes,
         sum(iva_total) filter (where sentido = 'venta')  as debito,
         sum(iva_total) filter (where sentido = 'compra') as credito,
         sum(percepcion_iva) filter (where sentido = 'compra') as percepcion
    from v_libro_iva group by empresa_id, mes
), ret as (
  select r.empresa_id, date_trunc('month', p.fecha)::date as mes, sum(r.importe) as retencion
    from retencion r join pago p on p.id = r.pago_id and p.estado = 'confirmado'
   where r.tipo = 'iva' and r.origen = 'sufrida'
   group by r.empresa_id, date_trunc('month', p.fecha)
)
select l.empresa_id, l.mes,
       coalesce(l.debito, 0)::importe  as debito,
       coalesce(l.credito, 0)::importe as credito,
       (coalesce(l.debito, 0) - coalesce(l.credito, 0))::importe as saldo_tecnico,
       coalesce(r.retencion, 0)::importe  as retencion,
       coalesce(l.percepcion, 0)::importe as percepcion,
       (coalesce(l.debito, 0) - coalesce(l.credito, 0) - coalesce(r.retencion, 0) - coalesce(l.percepcion, 0))::importe as saldo
  from libro l left join ret r on r.empresa_id = l.empresa_id and r.mes = l.mes;

create view v_stock_saldo with (security_invoker = true) as
select empresa_id, articulo_id, deposito_id, sum(cantidad) as saldo
  from movimiento_stock group by empresa_id, articulo_id, deposito_id;

create view v_saldo_caja with (security_invoker = true) as
select empresa_id, caja_id, cuenta_bancaria_id, sum(importe)::importe as saldo
  from movimiento_tesoreria group by empresa_id, caja_id, cuenta_bancaria_id;

create view v_balance_sumas_saldos with (security_invoker = true) as
select c.empresa_id, c.id as cuenta_id, c.codigo, c.nombre, c.tipo,
       coalesce(s.debe, 0)::importe  as debe,
       coalesce(s.haber, 0)::importe as haber,
       (coalesce(s.debe, 0) - coalesce(s.haber, 0))::importe as saldo
  from plan_cuenta c
  left join (select l.cuenta_id, sum(l.debe) as debe, sum(l.haber) as haber
               from asiento_linea l
               join asiento a on a.id = l.asiento_id and a.estado = 'contabilizado'
              group by l.cuenta_id) s on s.cuenta_id = c.id;

create view v_cartera_cheques with (security_invoker = true) as
select empresa_id, origen, estado, count(*) as cantidad, sum(importe)::importe as importe
  from cheque group by empresa_id, origen, estado;
