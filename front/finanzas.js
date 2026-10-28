/* Finanzas completo: asientos manuales y contraasientos, períodos con cierre, cobros y pagos desde cero (y su anulación),
   cheques, transferencias entre cuentas, conciliación bancaria, liquidación de IVA y exportación de libros.
   Se apoya en modulos.js (I). Los saldos de cuentas y terceros se mueven en memoria, como lo hará el sistema real. */
window.crearFinanzas = function (H, I) {
  'use strict';
  const { $, $$, esc, ic, toast, registrar, ir, D, empresa, sumarDias } = H;
  const { pe, pill, ent, c2, dato, cierra, dialogo, tabla, siguiente, enDias, fe, repintar, asientos, cuentaNombre, centavos } = I;

  const hoyISO = () => new Date().toISOString().slice(0, 10);
  const cent = (x) => Math.round(x * 100);
  const diasAtras = (iso) => Math.round((new Date(hoyISO() + 'T12:00') - new Date(iso + 'T12:00')) / 864e5);
  const mesDe = (dias) => { const d = new Date(); d.setDate(d.getDate() - dias); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
  const nombreMes = (clave) => { const [y, m] = clave.split('-'); const t = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }); return t.charAt(0).toUpperCase() + t.slice(1); };
  const cuentaPlan = (cod) => D.plan.find((p) => p.cod === cod);
  const banco = (e) => e.tes.cuentas.filter((c) => c.tipo === 'Banco');
  const codCuenta = (c) => (c.tipo === 'Caja' ? '1.1.1' : '1.1.2');
  const clienteDe = (e, n) => e.clientes.find((c) => c.n === n);
  const provDe = (e, n) => e.proveedores.find((p) => p.n === n);
  const movCuenta = (e, c, tipo, concepto, importe) => { c.saldo = Math.round((c.saldo + importe) * 100) / 100; e.caja = Math.round((e.caja + importe) * 100) / 100; e.tes.movs.unshift({ id: maxMovId(e) + 1, dias: 0, cuenta: c.n, tipo, concepto, importe }); };
  const maxMovId = (e) => { let m = 0; e.tes.movs.forEach((x) => { if (x.id && x.id > m) m = x.id; }); e.tes.movs.forEach((x) => { if (!x.id) x.id = ++m; }); return m; };
  const asientoAuto = (e, concepto, origen, lineas) => e.manuales.push({ concepto, origen, dias: 0, auto: true, lineas: lineas.filter((l) => l[1] || l[2]) });

  /* ---------- períodos ---------- */
  function periodos(e) {
    if (!e.periodos) {
      const hoy = new Date(); e.periodos = Array.from({ length: 6 }, (_, k) => { const d = new Date(hoy.getFullYear(), hoy.getMonth() - k, 1); const clave = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); return { clave, estado: k < 2 ? 'Abierto' : 'Cerrado' }; });
    }
    return e.periodos;
  }
  const periodoDe = (e, clave) => periodos(e).find((p) => p.clave === clave);
  const mesActual = () => mesDe(0);

  function abrirPeriodo(p) {
    const e = empresa(), actual = p.clave === mesActual(), nAs = asientos(e).filter((a) => mesDe(a.dias) === p.clave);
    const borradores = e.comp.filter((c) => c.estado === 'Borrador' && mesDe(c.dias) === p.clave).length;
    const chk = [[!actual ? 'ok' : 'no', actual ? 'El mes en curso no se cierra: todavía entran comprobantes' : 'El período ya terminó'], [borradores ? 'no' : 'ok', borradores ? `Hay ${borradores} comprobante${borradores === 1 ? '' : 's'} en borrador de este mes` : 'No hay comprobantes en borrador'], ['ok', `${nAs.length} asientos, todos balanceados`]];
    const puede = p.estado === 'Abierto' && chk.every((x) => x[0] === 'ok');
    dialogo(`<header class="det-h"><div><small>Período</small><h4>${nombreMes(p.clave)}</h4></div>${pill(p.estado)}${cierra}</header>
      ${p.estado === 'Abierto' ? `<div class="chequeos" style="border-radius:16px;border:1px solid var(--line)">${chk.map(([k, t]) => `<div class="${k}">${ic(k === 'ok' ? 'check' : 'alert')}<span style="color:var(--ink-2)">${esc(t)}</span></div>`).join('')}</div>
        <p class="mudo" style="margin:0">Un período cerrado no admite asientos con fecha dentro de él. Para corregir algo hay que reabrirlo, con motivo, y queda registrado.</p>`
        : `<p class="mudo" style="margin:0">Cerrado: no admite asientos con fecha dentro del período. Para reabrirlo hace falta un motivo, que queda en la trazabilidad.</p><div class="form-aj"><label class="ancho">Motivo de la reapertura<input class="in" id="rpMot" placeholder="Por ejemplo: ajuste de auditoría"></label></div>`}
      <footer class="det-f">${p.estado === 'Abierto' ? `<button class="btn primary" id="pcOk" ${puede ? '' : 'disabled'}>Cerrar el período</button>` : '<button class="btn primary" id="pcRe" disabled>Reabrir</button>'}<button class="btn" data-cerrar>Cerrar ventana</button></footer>`);
    const dlg = $('#detalle');
    const cerrar = $('#pcOk', dlg); if (cerrar) cerrar.addEventListener('click', () => { p.estado = 'Cerrado'; registrar('contabilidad', `Cerró el período ${nombreMes(p.clave)}`, `${nAs.length} asientos · ya no admite asientos con fecha dentro del período`, { cambios: [['Período', 'Abierto', 'Cerrado']] }); toast('Período cerrado'); dlg.close(); repintar(); });
    const re = $('#pcRe', dlg); if (re) {
      $('#rpMot', dlg).addEventListener('input', () => { re.disabled = $('#rpMot', dlg).value.trim().length < 5; });
      re.addEventListener('click', () => { const mot = $('#rpMot', dlg).value.trim(); p.estado = 'Abierto'; registrar('seguridad', `Reabrió el período ${nombreMes(p.clave)}`, `Motivo: ${mot}`, { cambios: [['Período', 'Cerrado', 'Abierto']] }); toast('Período reabierto'); dlg.close(); repintar(); });
    }
  }
  function vPeriodos(cuerpo, e, nav) {
    cuerpo.innerHTML = `${nav}<div class="card tb rise" style="--d:1" id="tb"></div>`;
    const as = asientos(e);
    tabla($('#tb'), [
      { t: 'Período', w: 'minmax(0,1.3fr)', f: (p) => `<b>${nombreMes(p.clave)}</b>${p.clave === mesActual() ? ' <span class="mudo">· en curso</span>' : ''}` }, { t: 'Estado', w: '130px', f: (p) => pill(p.estado) },
      { t: 'Asientos', w: '100px', sec: true, r: true, f: (p) => `<span class="num">${as.filter((a) => mesDe(a.dias) === p.clave).length}</span>` },
      { t: 'Movimiento', w: '160px', sec: true, r: true, f: (p) => `<span class="num">${centavos(as.filter((a) => mesDe(a.dias) === p.clave).reduce((s, a) => s + a.debe, 0))}</span>` },
    ], periodos(e), abrirPeriodo);
  }

  /* ---------- asientos manuales y contraasientos ---------- */
  function nuevoAsiento() {
    const e = empresa(), imputables = D.plan;
    const linea = () => ({ cod: '', debe: '', haber: '' });
    const ls = [linea(), linea()];
    dialogo(`<header class="det-h"><div><small>Contabilidad</small><h4>Nuevo asiento manual</h4></div>${cierra}</header>
      <div class="form-aj"><label>Fecha<input class="in" type="date" id="amFecha" value="${hoyISO()}"></label><label>Concepto<input class="in" id="amConc" placeholder="Qué registra este asiento" autocomplete="off"></label></div>
      <div id="amLineas" style="display:grid;gap:8px"></div>
      <button class="btn sm agregar" id="amAgregar">${ic('plus')} Agregar línea</button>
      <div class="mini mini3" id="amTot"></div><div id="amErr" style="display:grid;gap:6px"></div>
      <footer class="det-f"><button class="btn primary" id="amOk">Registrar asiento</button><button class="btn" data-cerrar>Cancelar</button></footer>`);
    const dlg = $('#detalle'), cont = $('#amLineas', dlg);
    const pintar = () => { cont.innerHTML = '<div class="reng as cab"><span>Cuenta</span><span style="text-align:right">Debe</span><span style="text-align:right">Haber</span><span></span></div>' + ls.map((l, i) => `<div class="reng as" data-i="${i}"><select class="in cta" aria-label="Cuenta"><option value="">Elegí una cuenta…</option>${imputables.map((p) => `<option value="${p.cod}" ${p.cod === l.cod ? 'selected' : ''}>${p.cod} · ${esc(p.n)}</option>`).join('')}</select><input class="in dbe" type="number" min="0" step="0.01" value="${l.debe}" placeholder="0,00" aria-label="Debe"><input class="in hbr" type="number" min="0" step="0.01" value="${l.haber}" placeholder="0,00" aria-label="Haber"><button class="x" aria-label="Quitar línea">${ic('trash')}</button></div>`).join(''); validar(); };
    const validar = () => {
      const err = [], d = ls.reduce((s, l) => s + cent(Number(l.debe) || 0), 0), h = ls.reduce((s, l) => s + cent(Number(l.haber) || 0), 0), fecha = $('#amFecha', dlg).value, usadas = ls.filter((l) => l.cod && (Number(l.debe) || Number(l.haber)));
      if ($('#amConc', dlg).value.trim().length < 3) err.push('Escribí el concepto');
      if (!fecha) err.push('Indicá la fecha'); else if (diasAtras(fecha) < 0) err.push('La fecha no puede ser futura'); else { const p = periodoDe(e, fecha.slice(0, 7)); if (p && p.estado === 'Cerrado') err.push(`El período ${nombreMes(p.clave)} está cerrado`); else if (!p) err.push('La fecha cae fuera de los períodos del ejercicio'); }
      if (usadas.length < 2) err.push('Un asiento tiene al menos dos líneas con importe');
      if (ls.some((l) => (Number(l.debe) || 0) > 0 && (Number(l.haber) || 0) > 0)) err.push('Una línea va al Debe o al Haber, no a los dos');
      if (ls.some((l) => !l.cod && (Number(l.debe) || Number(l.haber)))) err.push('Hay líneas con importe sin cuenta');
      if (d !== h) err.push(`No balancea: la diferencia es ${centavos(Math.abs(d - h))}`); else if (!d) err.push('El asiento no tiene importes');
      $('#amTot', dlg).innerHTML = `<div class="cab"><span>Totales</span><span>Debe</span><span>Haber</span></div><div><span>${d === h && d ? 'Balancea' : 'Diferencia ' + centavos(Math.abs(d - h))}</span><b class="num">${centavos(d)}</b><b class="num">${centavos(h)}</b></div>`;
      $('#amErr', dlg).innerHTML = err.length ? err.map((m) => `<div class="chequeo no" style="margin:0">${ic('alert')}<span>${esc(m)}</span></div>`).join('') : `<div class="chequeo ok" style="margin:0">${ic('check')}<span>El asiento balancea y el período está abierto</span></div>`;
      $('#amOk', dlg).disabled = !!err.length; return !err.length;
    };
    cont.addEventListener('input', (ev) => { const fila = ev.target.closest('.reng[data-i]'); if (!fila) return; const l = ls[Number(fila.dataset.i)]; l.cod = $('.cta', fila).value; l.debe = $('.dbe', fila).value; l.haber = $('.hbr', fila).value; validar(); });
    cont.addEventListener('click', (ev) => { const b = ev.target.closest('.x'); if (!b) return; ls.splice(Number(b.closest('.reng').dataset.i), 1); while (ls.length < 2) ls.push(linea()); pintar(); });
    $('#amAgregar', dlg).addEventListener('click', () => { ls.push(linea()); pintar(); });
    ['amFecha', 'amConc'].forEach((id) => $('#' + id, dlg).addEventListener('input', validar)); pintar();
    $('#amOk', dlg).addEventListener('click', () => {
      if (!validar()) return;
      const m = { concepto: $('#amConc', dlg).value.trim(), origen: 'Asiento manual', dias: diasAtras($('#amFecha', dlg).value), auto: false, lineas: ls.filter((l) => l.cod && (Number(l.debe) || Number(l.haber))).map((l) => [l.cod, cent(Number(l.debe) || 0), cent(Number(l.haber) || 0)]) };
      e.manuales.push(m); const a = asientos(e).find((x) => x.manual === m);
      registrar('contabilidad', `Registró el asiento manual N° ${a.nro}`, `${m.concepto} · ${centavos(a.debe)} · Debe = Haber`); toast(`Asiento N° ${a.nro} registrado`); dlg.close(); ir('finanzas/contabilidad/diario'); repintar();
    });
  }
  function contraasiento(a, e) {
    if (!a.manual || a.auto) { toast('Este asiento nace de un comprobante: se corrige anulando el comprobante, no con un contraasiento a mano.'); return; }
    if (a.manual.reversado || a.manual.reversaDe) { toast('Ese asiento ya fue reversado (o es un contraasiento)'); return; }
    const m = { concepto: `Contraasiento del N° ${a.nro}: ${a.concepto}`, origen: 'Contraasiento', dias: 0, auto: false, reversaDe: a.nro, lineas: a.lineas.map((l) => [l[0], l[2], l[1]]) };
    a.manual.reversado = true; e.manuales.push(m); const n = asientos(e).find((x) => x.manual === m);
    registrar('contabilidad', `Reversó el asiento N° ${a.nro}`, `Se generó el contraasiento N° ${n.nro}; el original no se modifica`, { cambios: [[`Asiento ${a.nro}`, 'Vigente', 'Reversado']] });
    toast(`Contraasiento N° ${n.nro} generado`); $('#detalle').close(); repintar();
  }

  /* ---------- cobros y pagos ---------- */
  function elegirTercero(tipo) {
    const e = empresa(), lista = tipo === 'cobro' ? e.clientes.filter((c) => c.saldo > 0) : e.proveedores.filter((p) => p.saldo > 0), venta = tipo === 'cobro';
    dialogo(`<header class="det-h"><div><small>Tesorería</small><h4>${venta ? 'Registrar un cobro' : 'Registrar un pago'}</h4></div>${cierra}</header>
      ${lista.length ? `<p class="mudo" style="margin:0">${venta ? 'Clientes con saldo pendiente. Elegí de quién cobraste.' : 'Proveedores con deuda. Elegí a quién le pagás.'}</p><div class="mini">${lista.map((t, i) => `<div><span><b>${esc(t.n)}</b></span><span class="num">${pe(t.saldo)}</span>${t.vencido ? '<span class="pill bad"><i></i>vencido</span>' : '<span></span>'}<button class="btn sm" data-t="${i}">${venta ? 'Cobrar' : 'Pagar'}</button></div>`).join('')}</div>` : `<p class="mudo" style="margin:0">${venta ? 'Ningún cliente tiene saldo pendiente.' : 'No hay deudas con proveedores.'}</p>`}
      <footer class="det-f"><button class="btn" data-cerrar>Cerrar</button></footer>`);
    $$('[data-t]', $('#detalle')).forEach((b) => b.addEventListener('click', () => { const t = lista[Number(b.dataset.t)]; $('#detalle').close(); venta ? I.abrirCobro(t) : I.abrirPendientes(t); }));
  }
  const elegirCobro = () => elegirTercero('cobro'), elegirPago = () => elegirTercero('pago');

  function abrirMovimiento(p) {
    const e = empresa(), cobro = p.tipo === 'Cobro';
    dialogo(`<header class="det-h"><div><small>${cobro ? 'Recibo de cobro' : 'Orden de pago'}</small><h4>${esc(p.nro)}</h4></div>${pill(p.estado)}${cierra}</header>
      <div class="partes">${dato(cobro ? 'Cliente' : 'Proveedor', esc(p.tercero))}${dato('Fecha', fe(p.dias))}${dato('Medio', esc(p.medio))}${dato('Importe', pe(p.importe))}</div>
      <p class="mudo" style="margin:0">${p.estado === 'Confirmado' ? 'El asiento contable se genera solo y desaparece si se anula el movimiento.' : p.estado === 'Anulado' ? 'Anulado: no tiene efecto sobre saldos ni contabilidad.' : 'Borrador: todavía no mueve saldos.'}</p>
      <footer class="det-f">${p.estado === 'Confirmado' ? '<button class="btn" id="mvAn">Anular</button>' : ''}<button class="btn" data-cerrar>Cerrar</button></footer>`);
    const b = $('#mvAn', $('#detalle')); if (b) b.addEventListener('click', () => anularMovimiento(p, e));
  }
  function anularMovimiento(p, e) {
    const cobro = p.tipo === 'Cobro', t = cobro ? clienteDe(e, p.tercero) : provDe(e, p.tercero);
    const cuenta = e.tes.cuentas.find((c) => c.id === p.cuenta) || e.tes.cuentas[p.medio === 'Efectivo' ? 0 : 1];
    let cheque = null;
    if (p.medio === 'Cheque') {
      cheque = e.tes.cheques.find((c) => c.nro === p.cheque);
      if (cobro && cheque && cheque.estado !== 'En cartera') { toast(`El cheque ${cheque.nro} ya está ${cheque.estado.toLowerCase()}: no se puede anular el cobro.`); return; }
      if (!cobro && cheque && cheque.estado === 'Cobrado') { toast('El cheque propio ya fue cobrado por el beneficiario: no se puede anular el pago.'); return; }
    } else if (cobro && cuenta.saldo < p.importe) { registrar('tesoreria', `Se rechazó la anulación de ${p.nro}`, `Fondos insuficientes en ${cuenta.n}`, { res: 'rechazo' }); toast(`No se puede anular: ${cuenta.n} no tiene fondos para devolver el cobro.`); return; }
    p.estado = 'Anulado';
    if (cheque) cheque.estado = 'Anulado'; else movCuenta(e, cuenta, cobro ? 'Cobro' : 'Pago', `Anulación ${p.nro}`, cobro ? -p.importe : p.importe);
    if (t) { t.saldo = Math.round((t.saldo + p.importe) * 100) / 100; if (cobro) e.porCobrar += p.importe; }
    if (!cobro && p.factura) { const f = e.factC.find((x) => x.nro === p.factura); if (f && f.estado === 'Pagada') f.estado = f.venc < 0 ? 'Vencida' : 'Impaga'; }
    registrar('tesoreria', `Anuló ${cobro ? 'el recibo' : 'la orden de pago'} ${p.nro}`, `${p.tercero} · ${pe(p.importe)} · vuelve a figurar la deuda`, { cambios: [['Estado', 'Confirmado', 'Anulado']] });
    toast(`${p.nro} anulado`); $('#detalle').close(); repintar();
  }

  /* ---------- cheques ---------- */
  function abrirCheque(c) {
    const e = empresa(), recibido = c.sentido === 'Recibido', acc = [];
    const cuentaBanco = () => banco(e).find((b) => c.banco && b.n.startsWith(c.banco)) || banco(e)[0];
    if (recibido && c.estado === 'En cartera') acc.push({ t: 'Depositar', p: 1, f: () => {
      if (c.vence > 0) { toast(`Cheque diferido: recién se podrá depositar ${enDias(c.vence)}.`); return; }
      c.estado = 'Depositado'; c.cuentaDep = cuentaBanco().id; registrar('tesoreria', `Depositó el cheque ${c.nro}`, `${c.tercero} · ${pe(c.importe)} · ${cuentaBanco().n}`, { cambios: [['Estado', 'En cartera', 'Depositado']] }); toast('Cheque depositado: falta la acreditación'); fin();
    } });
    if (recibido && c.estado === 'Depositado') {
      acc.push({ t: 'Acreditado por el banco', p: 1, f: () => { const cu = e.tes.cuentas.find((x) => x.id === c.cuentaDep) || cuentaBanco(); movCuenta(e, cu, 'Cobro', `Cheque ${c.nro} · ${c.tercero}`, c.importe); c.estado = 'Cobrado'; registrar('tesoreria', `Se acreditó el cheque ${c.nro}`, `${cu.n} · ${pe(c.importe)}`, { cambios: [['Estado', 'Depositado', 'Cobrado']] }); toast('Cheque acreditado: sube el saldo del banco'); fin(); } });
      acc.push({ t: 'Rechazado por el banco', f: () => { const cl = clienteDe(e, c.tercero); c.estado = 'Rechazado'; if (cl) { cl.saldo = Math.round((cl.saldo + c.importe) * 100) / 100; cl.vencido += c.importe; } e.porCobrar += c.importe; registrar('tesoreria', `El banco rechazó el cheque ${c.nro}`, `${c.tercero} · vuelve a figurar la deuda por ${pe(c.importe)}`, { res: 'rechazo', cambios: [['Estado', 'Depositado', 'Rechazado']] }); toast('Cheque rechazado: la deuda del cliente se reabre'); fin(); } });
    }
    if (!recibido && c.estado === 'Entregado') acc.push({ t: 'Cobrado por el beneficiario', p: 1, f: () => {
      const cu = cuentaBanco(); if (cu.saldo < c.importe) { registrar('tesoreria', `Se rechazó el débito del cheque ${c.nro}`, `Fondos insuficientes en ${cu.n}`, { res: 'rechazo' }); toast(`Fondos insuficientes en ${cu.n}: el cheque quedaría sin fondos.`); return; }
      movCuenta(e, cu, 'Pago', `Cheque ${c.nro} · ${c.tercero}`, -c.importe); c.estado = 'Cobrado'; registrar('tesoreria', `Se debitó el cheque propio ${c.nro}`, `${cu.n} · ${pe(c.importe)}`, { cambios: [['Estado', 'Entregado', 'Cobrado']] }); toast('Cheque debitado del banco'); fin();
    } });
    const fin = () => { $('#detalle').close(); repintar(); };
    dialogo(`<header class="det-h"><div><small>Cheque ${recibido ? 'recibido' : 'propio'}</small><h4>N° ${esc(c.nro)}</h4></div>${pill(c.estado)}${cierra}</header>
      <div class="partes">${dato(recibido ? 'Librador' : 'Beneficiario', esc(c.tercero))}${dato('Banco', esc(c.banco))}${dato('Importe', pe(c.importe))}${dato('Vence', enDias(c.vence))}</div>
      ${recibido && c.estado === 'En cartera' && c.vence > 0 ? '<p class="mudo" style="margin:0">Es un cheque diferido: todavía no se puede depositar.</p>' : ''}
      <footer class="det-f">${acc.map((a, i) => `<button class="btn ${a.p ? 'primary' : ''}" data-ca="${i}">${a.t}</button>`).join('')}<button class="btn" data-cerrar>Cerrar</button></footer>`);
    $$('[data-ca]', $('#detalle')).forEach((b) => b.addEventListener('click', () => acc[Number(b.dataset.ca)].f()));
  }

  /* ---------- transferencias entre cuentas ---------- */
  function transferir() {
    const e = empresa(), cs = e.tes.cuentas;
    dialogo(`<header class="det-h"><div><small>Tesorería</small><h4>Transferir entre cuentas</h4></div>${cierra}</header>
      <div class="form-aj"><label>Sale de<select class="in" id="trO">${cs.map((c) => `<option value="${c.id}">${esc(c.n)}</option>`).join('')}</select></label>
        <label>Entra en<select class="in" id="trD">${cs.map((c, i) => `<option value="${c.id}" ${i === 1 ? 'selected' : ''}>${esc(c.n)}</option>`).join('')}</select></label>
        <label>Importe<input class="in" id="trImp" type="number" min="0" step="0.01"></label></div>
      <p class="mudo" id="trInfo" style="margin:0"></p><div id="trErr"></div>
      <footer class="det-f"><button class="btn primary" id="trOk">Transferir</button><button class="btn" data-cerrar>Cancelar</button></footer>`);
    const dlg = $('#detalle'), cu = (id) => cs.find((c) => c.id === $('#' + id, dlg).value), imp = () => Math.round(Number($('#trImp', dlg).value) * 100) / 100;
    const val = () => { const o = cu('trO'), d = cu('trD'); $('#trInfo', dlg).textContent = `Disponible en ${o.n}: ${pe(o.saldo)}`; const m = o === d ? 'El origen y el destino son la misma cuenta' : !(imp() > 0) ? 'Indicá un importe mayor que cero' : imp() > o.saldo ? `Fondos insuficientes: faltan ${pe(imp() - o.saldo)}. No se permite el sobregiro.` : ''; $('#trErr', dlg).innerHTML = m ? `<div class="chequeo no" style="margin:0">${ic('alert')}<span>${esc(m)}</span></div>` : ''; $('#trOk', dlg).disabled = !!m; return !m; };
    ['trO', 'trD', 'trImp'].forEach((id) => $('#' + id, dlg).addEventListener('input', val)); val();
    $('#trOk', dlg).addEventListener('click', () => {
      if (!val()) return; const o = cu('trO'), d = cu('trD'), x = imp();
      o.saldo = Math.round((o.saldo - x) * 100) / 100; d.saldo = Math.round((d.saldo + x) * 100) / 100;
      e.tes.movs.unshift({ id: maxMovId(e) + 1, dias: 0, cuenta: o.n, tipo: 'Transferencia', concepto: `A ${d.n}`, importe: -x }); e.tes.movs.unshift({ id: maxMovId(e) + 1, dias: 0, cuenta: d.n, tipo: 'Transferencia', concepto: `De ${o.n}`, importe: x });
      if (codCuenta(o) !== codCuenta(d)) asientoAuto(e, `Transferencia de ${o.n} a ${d.n}`, 'Transferencia', [[codCuenta(d), cent(x), 0], [codCuenta(o), 0, cent(x)]]);
      registrar('tesoreria', `Transfirió ${pe(x)} entre cuentas`, `${o.n} → ${d.n}`, { cambios: [[o.n, pe(o.saldo + x), pe(o.saldo)], [d.n, pe(d.saldo - x), pe(d.saldo)]] }); toast('Transferencia registrada'); dlg.close(); repintar();
    });
  }

  /* ---------- conciliación bancaria ---------- */
  let selCuenta = null, selB = new Set(), selL = new Set(), modoConcil = 'banco';
  const selectorModo = () => `<div class="seg rise" role="group" aria-label="Tipo de conciliación" style="margin-bottom:14px"><button data-modo="banco" aria-pressed="${modoConcil === 'banco'}">Banco contra libros</button><button data-modo="archivos" aria-pressed="${modoConcil === 'archivos'}">Entre dos archivos</button></div>`;
  const cambiarModo = (cuerpo, e, nav) => (m) => { modoConcil = m; vConciliacion(cuerpo, e, nav); };
  function iniciarConcil(e) {
    if (e.concil) return e.concil; maxMovId(e); e.concil = {}; let g = 1;
    banco(e).forEach((c, k) => {
      const libros = e.tes.movs.filter((m) => m.cuenta === c.n), lineas = []; let lid = 1;
      libros.forEach((m, i) => { if (i % 4 === 3) return; const l = { id: lid++, dias: m.dias, desc: m.tipo === 'Cobro' ? `Transferencia recibida · ${m.concepto}` : m.tipo === 'Pago' ? `Transferencia enviada · ${m.concepto}` : m.concepto, importe: m.importe, grupo: null, libro: m.id }; if (i % 2 === 0) { l.grupo = g; m.grupo = g; g++; } lineas.push(l); });
      lineas.push({ id: lid++, dias: 2, desc: 'Comisión mantenimiento de cuenta', importe: -(3200 + k * 700), grupo: null }, { id: lid++, dias: 2, desc: 'Impuesto Ley 25.413 · débito', importe: -(1450 + k * 300), grupo: null });
      e.concil[c.id] = { lineas, siguienteGrupo: g, siguienteLinea: lid };
    });
    return e.concil;
  }
  const grupoLibre = (e) => Math.max(0, ...Object.values(e.concil).flatMap((c) => c.lineas.map((l) => l.grupo || 0)), ...e.tes.movs.map((m) => m.grupo || 0)) + 1;
  function vConciliacion(cuerpo, e, nav) {
    if (modoConcil === 'archivos') { cuerpo.onchange = null; I.archivos.vista(cuerpo, e, nav + selectorModo(), cambiarModo(cuerpo, e, nav)); return; }
    cuerpo.onchange = null;
    const conc = iniciarConcil(e), bancos = banco(e); maxMovId(e);
    if (!selCuenta || !bancos.some((b) => b.id === selCuenta)) selCuenta = bancos[0].id;
    const cu = bancos.find((b) => b.id === selCuenta), st = conc[cu.id], libros = e.tes.movs.filter((m) => m.cuenta === cu.n);
    const pendB = st.lineas.filter((l) => !l.grupo), pendL = libros.filter((m) => !m.grupo);
    const sB = pendB.reduce((s, l) => s + l.importe, 0), sL = pendL.reduce((s, m) => s + m.importe, 0), saldoBanco = cu.saldo - sL + sB;
    const grupos = (arr) => new Set(arr.filter((x) => x.grupo).map((x) => x.grupo)).size;
    const fila = (x, tipo) => `<button class="cl ${x.grupo ? 'ok' : ''}" data-${tipo}="${x.id}" aria-pressed="${(tipo === 'b' ? selB : selL).has(x.id)}" ${x.grupo ? 'data-g="' + x.grupo + '"' : ''}><span class="num mudo">${fe(x.dias)}</span><span class="t"><b>${esc(tipo === 'b' ? x.desc : x.concepto)}</b><small>${x.grupo ? 'Conciliado · grupo ' + x.grupo : tipo === 'b' ? 'Sin conciliar' : esc(x.tipo)}</small></span><b class="num ${x.importe < 0 ? 'neg' : 'pos'}">${x.importe < 0 ? '−' : '+'} ${pe(Math.abs(x.importe))}</b></button>`;
    cuerpo.innerHTML = `${nav}${selectorModo()}
      <div class="seg subnav rise" role="group" aria-label="Cuenta">${bancos.map((b) => `<button data-cb="${b.id}" aria-pressed="${b.id === cu.id}">${esc(b.n)}</button>`).join('')}</div>
      <div class="grid">
        <article class="card s4 rise" style="--d:1"><h3>${ic('bank')} Cómo cierra</h3><div class="mini mini2">
          <div><span>Saldo según libros</span><b class="num">${pe(cu.saldo)}</b></div><div><span>− Libros que el banco no registró</span><span class="num">${pe(sL)}</span></div>
          <div><span>+ Extracto sin registrar</span><span class="num">${pe(sB)}</span></div><div><span><b>Saldo según banco</b></span><b class="num">${pe(saldoBanco)}</b></div></div>
          <div class="chequeo ok" style="margin:12px 0 0">${ic('check')}<span>No explicada: ${pe(0)} · ${pendB.length + pendL.length} partidas pendientes</span></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button class="btn sm primary" id="cnSug">Sugerir</button><button class="btn sm" id="cnImp">Importar extracto</button></div></article>
        <article class="card s4 rise" style="--d:2"><h3>Extracto del banco</h3><div class="clist">${st.lineas.map((l) => fila(l, 'b')).join('')}</div></article>
        <article class="card s4 rise" style="--d:3"><h3>Libros</h3><div class="clist">${libros.map((m) => fila(m, 'l')).join('') || '<p class="mudo">Sin movimientos.</p>'}</div></article></div>
      <div class="barra rise" style="--d:4"><div class="tot"><small id="cnInfo">Elegí partidas de los dos lados</small><b class="num" id="cnDif"></b></div><button class="btn" id="cnReg">Registrar en libros</button><button class="btn primary" id="cnOk">Conciliar selección</button></div>`;
    const lineasSel = () => st.lineas.filter((l) => selB.has(l.id) && !l.grupo), movsSel = () => libros.filter((m) => selL.has(m.id) && !m.grupo);
    const refrescar = () => {
      const b = lineasSel(), l = movsSel(), sb = b.reduce((s, x) => s + x.importe, 0), sl = l.reduce((s, x) => s + x.importe, 0);
      const iguales = (b.length && l.length && Math.round((sb - sl) * 100) === 0), soloB = b.length && !l.length && b.every((x) => x.importe < 0);
      $('#cnInfo', cuerpo).textContent = !b.length && !l.length ? 'Elegí partidas de los dos lados' : iguales ? 'Los importes coinciden' : soloB ? 'Partidas del banco sin registro en libros' : `Diferencia entre lados: ${pe(Math.abs(sb - sl))}`;
      $('#cnDif', cuerpo).textContent = pe(Math.abs(sb)); $('#cnOk', cuerpo).disabled = !iguales; $('#cnReg', cuerpo).disabled = !soloB;
      $$('[data-b]', cuerpo).forEach((x) => x.setAttribute('aria-pressed', selB.has(Number(x.dataset.b)))); $$('[data-l]', cuerpo).forEach((x) => x.setAttribute('aria-pressed', selL.has(Number(x.dataset.l))));
    };
    cuerpo.onclick = (ev) => {
      const mo = ev.target.closest('[data-modo]'); if (mo) { modoConcil = mo.dataset.modo; vConciliacion(cuerpo, e, nav); return; }
      const cb = ev.target.closest('[data-cb]'); if (cb) { selCuenta = cb.dataset.cb; selB.clear(); selL.clear(); vConciliacion(cuerpo, e, nav); return; }
      const x = ev.target.closest('.cl'); if (!x) return;
      if (x.dataset.g) { deshacer(Number(x.dataset.g), st, libros, e, cuerpo, nav); return; }
      const set = x.dataset.b ? selB : selL, id = Number(x.dataset.b || x.dataset.l); set.has(id) ? set.delete(id) : set.add(id); refrescar();
    };
    $('#cnOk', cuerpo).addEventListener('click', () => { const g = grupoLibre(e), b = lineasSel(), l = movsSel(); b.forEach((x) => { x.grupo = g; }); l.forEach((x) => { x.grupo = g; }); registrar('tesoreria', `Concilió ${b.length + l.length} partidas de ${cu.n}`, `Extracto y libros por ${pe(Math.abs(b.reduce((s, x) => s + x.importe, 0)))}`); selB.clear(); selL.clear(); toast('Partidas conciliadas'); vConciliacion(cuerpo, e, nav); });
    $('#cnReg', cuerpo).addEventListener('click', () => {
      const g = grupoLibre(e); lineasSel().forEach((l) => {
        movCuenta(e, cu, 'Comisión bancaria', l.desc, l.importe); const m = e.tes.movs[0]; m.grupo = g; l.grupo = g;
        asientoAuto(e, l.desc, 'Extracto bancario', [['5.2.4', cent(-l.importe), 0], ['1.1.2', 0, cent(-l.importe)]]);
        registrar('tesoreria', `Registró en libros: ${l.desc}`, `${cu.n} · ${pe(-l.importe)} · gasto bancario con su asiento`);
      }); selB.clear(); toast('Registrado en libros y conciliado'); repintar();
    });
    $('#cnSug', cuerpo).addEventListener('click', () => {
      let n = 0; const libresL = () => libros.filter((m) => !m.grupo);
      st.lineas.filter((l) => !l.grupo).forEach((l) => { const cand = libresL().filter((m) => Math.round((m.importe - l.importe) * 100) === 0), otras = st.lineas.filter((x) => !x.grupo && x !== l && Math.round((x.importe - l.importe) * 100) === 0);
        if (cand.length === 1 && !otras.length) { const g = grupoLibre(e); l.grupo = g; cand[0].grupo = g; n++; } });
      if (n) registrar('tesoreria', `Aceptó ${n} sugerencia${n === 1 ? '' : 's'} de conciliación en ${cu.n}`, 'Coincidencias únicas por importe'); toast(n ? `${n} coincidencia${n === 1 ? '' : 's'} única${n === 1 ? '' : 's'} conciliada${n === 1 ? '' : 's'}` : 'No hay coincidencias únicas para sugerir'); vConciliacion(cuerpo, e, nav);
    });
    $('#cnImp', cuerpo).addEventListener('click', () => {
      const sin = libros.filter((m) => !m.grupo && !st.lineas.some((l) => l.libro === m.id)); let n = 0;
      sin.forEach((m) => { st.lineas.push({ id: st.siguienteLinea++, dias: m.dias, desc: m.tipo === 'Cobro' ? `Transferencia recibida · ${m.concepto}` : m.tipo === 'Pago' ? `Transferencia enviada · ${m.concepto}` : m.concepto, importe: m.importe, grupo: null, libro: m.id }); n++; });
      registrar('tesoreria', `Importó el extracto de ${cu.n}`, `${n} movimientos nuevos leídos`); toast(n ? `Extracto importado: ${n} movimientos nuevos` : 'El extracto ya está al día'); vConciliacion(cuerpo, e, nav);
    });
    refrescar();
  }
  function deshacer(g, st, libros, e, cuerpo, nav) {
    st.lineas.forEach((l) => { if (l.grupo === g) l.grupo = null; }); libros.forEach((m) => { if (m.grupo === g) m.grupo = null; });
    registrar('tesoreria', `Deshizo la conciliación del grupo ${g}`, 'Ambos lados vuelven a quedar pendientes', { cambios: [['Grupo ' + g, 'Conciliado', 'Pendiente']] }); toast('Conciliación deshecha: queda constancia'); vConciliacion(cuerpo, e, nav);
  }

  /* ---------- IVA: liquidación y pago ---------- */
  function bloqueIva(el, e, v, c) {
    const mes = mesActual(); e.ivaLiq = e.ivaLiq || {}; const liq = e.ivaLiq[mes], deb = cent(v.tot.iva), cre = cent(c.tot.iva), usado = Math.min(deb, cre), saldo = Math.max(0, deb - cre);
    const lineas = [['2.1.2', deb, 0], ['1.1.5', 0, usado], ['2.1.3', 0, saldo]].filter((l) => l[1] || l[2]);
    el.innerHTML = `<article class="card rise" style="--d:6;margin-top:16px"><h3>${ic('cal')} Liquidación de ${nombreMes(mes)}</h3>
      ${liq ? `<div class="chequeo ok" style="margin:10px 0 0">${ic('check')}<span>Liquidado${liq.pagado ? ' y pagado' : ''}. ${saldo ? `Saldo a pagar: ${centavos(liq.saldo)}.` : 'Sin saldo a pagar: queda crédito a favor.'}</span></div>
        ${saldo && !liq.pagado ? '<button class="btn primary" id="ivPagar" style="margin-top:12px">Pagar el saldo (VEP)</button>' : ''}`
      : `<p class="mudo" style="margin:6px 0 10px">Genera el asiento que cancela el débito contra el crédito y deja el saldo como deuda con el fisco.</p><div class="mini mini3"><div class="cab"><span>Cuenta</span><span>Debe</span><span>Haber</span></div>${lineas.map((l) => `<div><span>${l[0]} · ${esc(cuentaNombre(l[0]))}</span><span class="num">${l[1] ? centavos(l[1]) : ''}</span><span class="num">${l[2] ? centavos(l[2]) : ''}</span></div>`).join('')}</div>
        <button class="btn primary" id="ivLiq" style="margin-top:12px" ${deb || cre ? '' : 'disabled'}>Liquidar el IVA del período</button>`}</article>`;
    const l = $('#ivLiq', el); if (l) l.addEventListener('click', () => {
      asientoAuto(e, `Liquidación de IVA de ${nombreMes(mes)}`, 'Liquidación de IVA', lineas); e.ivaLiq[mes] = { saldo, pagado: false };
      const iva = e.venc.find((x) => /IVA/.test(x.nombre)); if (iva) iva.presentado = true;
      registrar('contabilidad', `Liquidó el IVA de ${nombreMes(mes)}`, `Débito ${centavos(deb)} · crédito ${centavos(cre)} · saldo ${centavos(saldo)}`); toast('IVA liquidado'); repintar();
    });
    const p = $('#ivPagar', el); if (p) p.addEventListener('click', () => {
      const bs = banco(e), con = bs.find((b) => b.saldo >= saldo / 100);
      if (!con) { registrar('tesoreria', 'Se rechazó el pago del VEP de IVA', 'Fondos insuficientes en los bancos', { res: 'rechazo' }); toast('Fondos insuficientes en los bancos para pagar el VEP.'); return; }
      movCuenta(e, con, 'Pago', `VEP IVA ${nombreMes(mes)}`, -saldo / 100); asientoAuto(e, `Pago de IVA de ${nombreMes(mes)} (VEP)`, 'VEP', [['2.1.3', saldo, 0], ['1.1.2', 0, saldo]]); e.ivaLiq[mes].pagado = true;
      registrar('tesoreria', `Pagó el VEP de IVA de ${nombreMes(mes)}`, `${con.n} · ${centavos(saldo)}`); toast('VEP pagado desde ' + con.n); repintar();
    });
  }

  /* ---------- exportar libros de IVA ---------- */
  function exportarLibros() {
    const e = empresa(); if (e.cond !== 'RI') { toast('Una empresa monotributista no lleva libros de IVA'); return; }
    const q = (v) => { let s = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
    const filas = [['Libro', 'Fecha', 'Comprobante', 'Tercero', 'Neto gravado', 'IVA', 'Exento y no gravado', 'Total']];
    const push = (libro, docs, nro, ter) => docs.forEach((d) => { const t = D.totales(d.items || []); filas.push([libro, hoyISO(), nro(d), ter(d), t.neto, t.iva, t.exento + t.noGrav, d.total]); });
    push('Ventas', e.comp.filter((c) => c.estado === 'Autorizado'), (d) => `${d.letra} ${d.nro}`, (d) => d.cliente); push('Compras', e.factC.filter((c) => c.estado !== 'Anulada'), (d) => d.nro, (d) => d.tercero);
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + filas.map((l) => l.map(q).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' })); a.download = 'libros-iva-' + hoyISO() + '.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    registrar('seguridad', 'Exportó los libros de IVA a CSV', `${filas.length - 1} comprobantes`, { emp: e.id }); toast(`${filas.length - 1} comprobantes exportados`);
  }

  return { elegirCobro, elegirPago, transferir, nuevoAsiento, exportarLibros, contraasiento, abrirMovimiento, abrirCheque, vPeriodos, vConciliacion, bloqueIva, periodoDe, mesDe };
};
