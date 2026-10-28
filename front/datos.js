/* Datos de EJEMPLO del prototipo. Todo es inventado (nombres, CUIT, importes); no hay datos reales.
   Los importes son en pesos; la factura calcula en centavos enteros. */
(function () {
  function rng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------- usuarios (trazabilidad y movimientos de stock) ---------- */
  const usuarios = [
    { id: 1, n: 'Andrés Navarro', ini: 'AN', rol: 'Administrador', tono: 0 },
    { id: 2, n: 'Carolina Ríos', ini: 'CR', rol: 'Contadora', tono: 1 },
    { id: 3, n: 'Matías Peña', ini: 'MP', rol: 'Auxiliar contable', tono: 2 },
    { id: 4, n: 'Sofía Lucero', ini: 'SL', rol: 'Administrativa', tono: 0 },
  ];

  const clientes = [
    { n: 'Distribuidora Sur SRL', doc: 'CUIT 30-70811222-3', iva: 'RI' },
    { n: 'Kiosco El Pino', doc: 'CUIT 20-30456789-6', iva: 'MT' },
    { n: 'Marta Gómez', doc: 'DNI 27.345.118', iva: 'CF' },
    { n: 'Fundación Horizonte', doc: 'CUIT 30-65432109-5', iva: 'EX' },
    { n: 'Constructora Almagro SA', doc: 'CUIT 30-71500123-8', iva: 'RI' },
    { n: 'Consumidor Final', doc: 'Sin identificar', iva: 'CF' },
    { n: 'Lucía Fernández', doc: 'DNI 33.907.552', iva: 'CF' },
    { n: 'Tecno Plata SRL', doc: 'CUIT 30-71999888-4', iva: 'RI' },
  ];
  const proveedores = [
    { n: 'Distribuidora Norte SRL', doc: 'CUIT 30-71234890-3', iva: 'RI' },
    { n: 'Papelera del Plata SA', doc: 'CUIT 30-50123987-5', iva: 'RI' },
    { n: 'Tecnología Austral SRL', doc: 'CUIT 30-71654321-9', iva: 'RI' },
    { n: 'Alimentos Serranos SA', doc: 'CUIT 30-69876543-1', iva: 'RI' },
    { n: 'Logística Rápida SRL', doc: 'CUIT 30-70987123-4', iva: 'RI' },
    { n: 'Ferretería Industrial Sur', doc: 'CUIT 20-24567890-3', iva: 'MT' },
    { n: 'Energía y Servicios SA', doc: 'CUIT 30-64321987-6', iva: 'RI' },
    { n: 'Estudio Gráfico Pixel', doc: 'CUIT 27-31987654-2', iva: 'MT' },
  ];
  const condicion = { RI: 'Responsable Inscripto', MT: 'Monotributo', CF: 'Consumidor Final', EX: 'Exento' };

  /* tipo: bien (lleva stock) o servicio; v / c: se vende / se compra; p = precio neto de venta; costo = costo de reposición */
  const articulos = [
    { cod: 'SRV-001', n: 'Honorarios profesionales', p: 85000, al: '21', tipo: 'servicio', c: 0 },
    { cod: 'SRV-002', n: 'Servicio de consultoría', p: 120000, al: '21', tipo: 'servicio', c: 0 },
    { cod: 'ALI-001', n: 'Pan lactal x500 g', p: 1850, al: '10.5', tipo: 'bien', rubro: 'Alimentos', min: 40, costo: 1200 },
    { cod: 'SRV-003', n: 'Servicio de telecomunicaciones', p: 38000, al: '27', tipo: 'servicio', costo: 30000 },
    { cod: 'SRV-004', n: 'Seguro de caución', p: 54000, al: 'ex', tipo: 'servicio', costo: 45000 },
    { cod: 'SRV-005', n: 'Reintegro de gastos', p: 15000, al: 'ng', tipo: 'servicio', c: 0 },
    { cod: 'TEC-001', n: 'Notebook 15"', p: 780000, al: '21', tipo: 'bien', rubro: 'Tecnología', min: 3, costo: 560000 },
    { cod: 'TEC-002', n: 'Monitor 24"', p: 210000, al: '21', tipo: 'bien', rubro: 'Tecnología', min: 4, costo: 150000 },
    { cod: 'TEC-003', n: 'Mouse inalámbrico', p: 12500, al: '21', tipo: 'bien', rubro: 'Tecnología', min: 12, costo: 7800 },
    { cod: 'TEC-004', n: 'Teclado mecánico', p: 38000, al: '21', tipo: 'bien', rubro: 'Tecnología', min: 8, costo: 24000 },
    { cod: 'TEC-005', n: 'Cable HDMI 2 m', p: 6400, al: '21', tipo: 'bien', rubro: 'Tecnología', min: 20, costo: 3300 },
    { cod: 'OFI-001', n: 'Resma A4 x500', p: 9800, al: '21', tipo: 'bien', rubro: 'Oficina', min: 25, costo: 6900 },
    { cod: 'OFI-002', n: 'Silla ergonómica', p: 185000, al: '21', tipo: 'bien', rubro: 'Oficina', min: 3, costo: 128000 },
    { cod: 'ALI-002', n: 'Café molido 1 kg', p: 14500, al: '10.5', tipo: 'bien', rubro: 'Alimentos', min: 15, costo: 10200 },
    { cod: 'ALI-003', n: 'Yerba mate 1 kg', p: 5200, al: '10.5', tipo: 'bien', rubro: 'Alimentos', min: 30, costo: 3600 },
    { cod: 'ALI-004', n: 'Aceite de girasol 900 ml', p: 3100, al: '10.5', tipo: 'bien', rubro: 'Alimentos', min: 36, costo: 2150 },
  ];
  articulos.forEach((a) => {
    a.stock = a.tipo === 'bien'; a.v = a.v == null ? 1 : a.v; a.c = a.c == null ? 1 : a.c;
    a.rubro = a.rubro || 'Servicios'; a.min = a.min || 0; a.costo = a.costo || Math.round(a.p * 0.7);
  });
  const TASA = { '21': 0.21, '10.5': 0.105, '27': 0.27, '5': 0.05, '2.5': 0.025, '0': 0, ex: 0, ng: 0 };
  const redondear = (x) => Math.round(x * 100) / 100;
  /* Totales de un comprobante: IVA por alícuota; exento y no gravado aparte. sinIva = factura C (el IVA no se discrimina). */
  function totales(items, sinIva) {
    const grupos = new Map(); let exento = 0, noGrav = 0, bruto = 0;
    items.forEach((it) => {
      const imp = redondear(it.cant * it.precio * (1 - (it.desc || 0) / 100)); bruto += imp;
      if (sinIva) return;
      if (it.al === 'ex') exento += imp; else if (it.al === 'ng') noGrav += imp; else grupos.set(it.al, (grupos.get(it.al) || 0) + imp);
    });
    if (sinIva) return { neto: redondear(bruto), iva: 0, ivas: [], exento: 0, noGrav: 0, total: redondear(bruto) };
    const ivas = [...grupos].map(([al, base]) => ({ al, base: redondear(base), iva: redondear(base * TASA[al]) })).sort((a, b) => TASA[b.al] - TASA[a.al]);
    const neto = redondear(ivas.reduce((s, x) => s + x.base, 0)), iva = redondear(ivas.reduce((s, x) => s + x.iva, 0));
    return { neto, iva, ivas, exento: redondear(exento), noGrav: redondear(noGrav), total: redondear(neto + iva + exento + noGrav) };
  }

  /* Plan de cuentas (resumido). El balance y los asientos se derivan de los comprobantes. */
  const plan = [
    { cod: '1.1.1', n: 'Caja', tipo: 'activo' }, { cod: '1.1.2', n: 'Bancos', tipo: 'activo' },
    { cod: '1.1.3', n: 'Deudores por ventas', tipo: 'activo' }, { cod: '1.1.4', n: 'Mercaderías', tipo: 'activo' },
    { cod: '1.1.5', n: 'IVA crédito fiscal', tipo: 'activo' }, { cod: '1.2.1', n: 'Bienes de uso', tipo: 'activo' },
    { cod: '2.1.1', n: 'Proveedores', tipo: 'pasivo' }, { cod: '2.1.2', n: 'IVA débito fiscal', tipo: 'pasivo' },
    { cod: '2.1.3', n: 'Deudas fiscales y sociales', tipo: 'pasivo' },
    { cod: '3.1.1', n: 'Capital', tipo: 'patrimonio' }, { cod: '3.2.1', n: 'Resultados acumulados', tipo: 'patrimonio' },
    { cod: '4.1.1', n: 'Ventas de mercaderías', tipo: 'ingreso' }, { cod: '4.1.2', n: 'Prestación de servicios', tipo: 'ingreso' },
    { cod: '5.1.1', n: 'Costo de mercaderías vendidas', tipo: 'gasto' }, { cod: '5.2.1', n: 'Gastos de administración', tipo: 'gasto' },
    { cod: '5.2.2', n: 'Sueldos y jornales', tipo: 'gasto' }, { cod: '5.2.3', n: 'Servicios contratados', tipo: 'gasto' },
  ];

  const base = [
    ['Comercial Andina SA', '30-71234567-1', 'RI', 18500000, 3, 1],
    ['Panadería La Espiga', '20-28765432-4', 'MT', 3200000],
    ['Servicios Norte SRL', '30-70987654-1', 'RI', 9400000, -2, 3],
    ['Estudio Jurídico Paz', '27-30123456-5', 'MT', 2100000],
    ['Agro Pampa SA', '30-71122334-7', 'RI', 41000000, 5, 2],
    ['Taller Mecánico Ruiz', '20-25678901-2', 'MT', 2800000, 12, 6],
    ['Clínica Del Valle SRL', '30-70555444-9', 'RI', 27500000],
    ['Librería Palabra', '27-31456789-0', 'MT', 1700000],
  ];

  const estados = ['Autorizado', 'Autorizado', 'Autorizado', 'Autorizado', 'Borrador', 'Rechazado', 'Autorizado', 'Anulado'];

  function crear(i, d) {
    const r = rng(i * 977 + 13);
    const escala = d[3];
    const ventas = Array.from({ length: 12 }, (_, k) => escala * (0.78 + (k / 11) * 0.3 + (r() - 0.5) * 0.28));
    let saldo = escala * 0.55;
    const flujo = Array.from({ length: 30 }, () => (saldo += (r() - 0.42) * escala * 0.07));
    const ri = d[2] === 'RI', mt = !ri;
    const diasIva = d[4] != null ? d[4] : 2 + Math.floor(r() * 12);
    const movsSinConciliar = 6 + Math.floor(r() * 24);
    const vencidas = d[5] != null ? d[5] : Math.floor(r() * 4);
    const venc = [
      { dias: ri ? diasIva : 20 - new Date().getDate(), nombre: ri ? 'IVA · F.2002' : 'Cuota monotributo', tipo: 'imp' },
      { dias: diasIva + 3, nombre: 'SIRE · Retenciones', tipo: 'imp' },
      { dias: diasIva + 8, nombre: ri ? 'Ganancias · anticipo' : 'Ingresos Brutos', tipo: 'imp' },
      { dias: diasIva + 14, nombre: 'F.931 · cargas sociales', tipo: 'lab' },
      { dias: diasIva + 22, nombre: 'Balance trimestral', tipo: 'est' },
    ].map((v) => ({ ...v, dias: v.dias < -3 ? v.dias + 30 : v.dias }));
    venc.sort((a, b) => a.dias - b.dias);

    /* ----- generadores comunes ----- */
    const pick = (a) => a[Math.floor(r() * a.length)];
    const redond5 = (x) => Math.round(x / 5) * 5;
    const tope = Math.max(escala / 100, 1850);
    const vendibles = articulos.filter((a) => a.v && a.p <= tope);
    const comprables = articulos.filter((a) => a.c && a.costo <= tope * 0.8);
    const bienes = (pool) => { const g = pool.filter((a) => a.stock); return g.length ? g : articulos.filter((a) => a.stock).slice(0, 1); };
    const lineas = (pool, campo) => {
      const usados = new Set(), out = [], n = 1 + Math.floor(r() * 3);
      for (let k = 0; k < n; k++) {
        const a = pick(pool); if (usados.has(a.cod)) continue; usados.add(a.cod);
        out.push({ art: a.n, cod: a.cod, cant: a.stock ? 1 + Math.floor(r() * 12) : 1 + Math.floor(r() * 2), precio: a[campo], al: a.al });
      }
      return out;
    };

    /* ----- clientes y proveedores con su situación ----- */
    const clientesE = clientes.map((c) => {
      const saldoC = r() < 0.3 ? 0 : Math.round((escala * r() * 0.08) / 100) * 100;
      return { ...c, plazo: pick([0, 15, 30, 30, 45]), lista: pick(['General', 'Mayorista', 'Minorista']), saldo: saldoC,
        vencido: saldoC && r() < 0.5 ? Math.round((saldoC * (0.3 + r() * 0.6)) / 100) * 100 : 0, ultima: Math.floor(r() * 40), anio: Math.round((escala * (0.04 + r() * 0.3)) / 1000) * 1000 };
    });
    const proveedoresE = proveedores.map((p) => {
      const saldoP = r() < 0.25 ? 0 : Math.round((escala * r() * 0.06) / 100) * 100;
      return { ...p, plazo: pick([0, 15, 30, 30, 45, 60]), saldo: saldoP,
        vencido: saldoP && r() < 0.35 ? Math.round((saldoP * (0.3 + r() * 0.5)) / 100) * 100 : 0, ultima: Math.floor(r() * 40), anio: Math.round((escala * (0.03 + r() * 0.2)) / 1000) * 1000 };
    });

    /* ----- ventas ----- */
    const comp = Array.from({ length: 14 }, (_, k) => {
      const cli = clientes[Math.floor(r() * clientes.length)];
      const letra = ri ? (cli.iva === 'RI' || cli.iva === 'MT' ? 'A' : 'B') : 'C';
      const est = estados[Math.floor(r() * estados.length)];
      const items = lineas(vendibles, 'p');
      return { letra, cliente: cli.n, dias: k === 0 ? 0 : Math.floor(k * 1.5 + r() * 2), nro: '0003-' + String(1240 - k * 3).padStart(8, '0'), items, total: totales(items, mt).total, estado: est };
    });
    const presup = Array.from({ length: 9 }, (_, k) => {
      const items = lineas(vendibles, 'p'), dias = Math.floor(k * 3 + r() * 3);
      let estado = pick(['Borrador', 'Enviado', 'Enviado', 'Aceptado', 'Aceptado', 'Convertido', 'Convertido', 'Vencido']);
      if ((estado === 'Enviado' || estado === 'Borrador') && dias > 15) estado = 'Vencido';
      return { nro: '0001-' + String(88 - k).padStart(8, '0'), tercero: pick(clientesE).n, dias, items, estado, total: totales(items, mt).total };
    });
    const pedidos = Array.from({ length: 10 }, (_, k) => {
      const items = lineas(vendibles, 'p'), estado = pick(['Pendiente', 'Pendiente', 'Parcial', 'Parcial', 'Completo', 'Completo', 'Completo', 'Cancelado']);
      const rem = estado === 'Parcial' ? redond5(30 + r() * 40) : estado === 'Completo' ? 100 : 0;
      const fac = estado === 'Parcial' ? redond5(rem * r()) : estado === 'Completo' ? (r() < 0.6 ? 100 : redond5(50 + r() * 40)) : 0;
      return { nro: '0001-' + String(64 - k).padStart(8, '0'), tercero: pick(clientesE).n, dias: Math.floor(k * 3 + r() * 3), items, estado, rem, fac, total: totales(items, mt).total };
    });
    const remitos = Array.from({ length: 12 }, (_, k) => {
      const items = lineas(bienes(vendibles), 'p');
      return { nro: '0002-' + String(150 - k * 2).padStart(8, '0'), tercero: pick(clientesE).n, dias: Math.floor(k * 2.4 + r() * 2), items, dep: 1 + Math.floor(r() * 2),
        estado: pick(['Sin facturar', 'Sin facturar', 'Facturado', 'Facturado', 'Facturado', 'Anulado']), total: totales(items, mt).total };
    });

    /* ----- compras ----- */
    const oc = Array.from({ length: 8 }, (_, k) => {
      const items = lineas(comprables, 'costo');
      return { nro: '0001-' + String(41 - k).padStart(8, '0'), tercero: pick(proveedoresE).n, dias: Math.floor(k * 4 + r() * 3), items, entrega: Math.floor(r() * 14) - 6,
        estado: pick(['Borrador', 'Enviada', 'Enviada', 'Recibida parcial', 'Recibida', 'Recibida', 'Cancelada']), total: totales(items).total };
    });
    const remC = Array.from({ length: 8 }, (_, k) => {
      const items = lineas(bienes(comprables), 'costo');
      return { nro: '0007-' + String(5230 - k * 7).padStart(8, '0'), tercero: pick(proveedoresE).n, dias: Math.floor(k * 4 + r() * 3), items, dep: 1 + Math.floor(r() * 2),
        estado: pick(['Sin facturar', 'Facturado', 'Facturado', 'Facturado', 'Anulado']), total: totales(items).total };
    });
    const factC = Array.from({ length: 12 }, (_, k) => {
      const items = lineas(comprables, 'costo'), dias = Math.floor(k * 3.5 + r() * 3), prov = pick(proveedoresE), venc2 = prov.plazo - dias;
      const estado = r() < 0.06 ? 'Anulada' : r() < 0.35 ? 'Pagada' : venc2 < 0 ? 'Vencida' : 'Impaga';
      return { nro: 'A 0005-' + String(8800 - k * 11).padStart(8, '0'), tercero: prov.n, dias, items, venc: venc2, estado, total: totales(items).total };
    });

    /* ----- stock: libro de movimientos (el stock se deriva de sumarlos) ----- */
    const deps = [{ id: 1, n: 'Depósito central' }, { id: 2, n: mt ? 'Mostrador' : 'Sucursal' }];
    const bienesTodos = articulos.filter((a) => a.stock);
    const hoy0 = new Date(); hoy0.setHours(0, 0, 0, 0);
    const minutosAhora = new Date().getHours() * 60 + new Date().getMinutes();
    const sd = {}; const clave = (c, dep) => c + '|' + dep; const lib = []; let nid = 1;
    const mover = (dias, min, cod, dep, cant, tipo, ref, u) => {
      sd[clave(cod, dep)] = (sd[clave(cod, dep)] || 0) + cant;
      lib.push({ id: nid++, ts: hoy0.getTime() - dias * 864e5 + min * 6e4, cod, dep, cant, tipo, ref, u });
    };
    bienesTodos.forEach((a) => deps.forEach((dp) => {
      const q = r() < 0.18 ? Math.floor(r() * 6) : dp.id === 1 ? 8 + Math.floor(r() * 70) : Math.floor(r() * 30);
      if (q) mover(31, 480, a.cod, dp.id, q, 'Saldo inicial', 'Apertura', 1);
    }));
    for (let dias = 30; dias >= 0; dias--) {
      let min = 8 * 60 + Math.floor(r() * 30);
      for (let n = 1 + Math.floor(r() * 3); n > 0; n--) {
        min += 20 + Math.floor(r() * 90);
        if (dias === 0 && min > minutosAhora) break;
        if (dias % 7 === 3 && n === 1 && r() < 0.5) continue;
        const a = pick(bienesTodos), u = pick(usuarios).id, tiene = (dp) => sd[clave(a.cod, dp)] || 0, roll = r();
        const mayor = tiene(1) >= tiene(2) ? 1 : 2;
        if (roll < 0.5) {
          const q = Math.min(1 + Math.floor(r() * 8), tiene(mayor)); if (q > 0) mover(dias, min, a.cod, mayor, -q, 'Remito de venta', pick(remitos).nro, u);
        } else if (roll < 0.8) {
          mover(dias, min, a.cod, r() < 0.8 ? 1 : 2, 10 + Math.floor(r() * 40), 'Remito de compra', pick(remC).nro, u);
        } else if (roll < 0.9) {
          const q = 1 + Math.floor(r() * 4), baja = r() < 0.5 && tiene(mayor) >= q;
          mover(dias, min, a.cod, mayor, baja ? -q : q, 'Ajuste de inventario', 'Conteo físico', u);
        } else {
          const q = Math.min(1 + Math.floor(r() * 10), tiene(mayor)), otro = mayor === 1 ? 2 : 1;
          if (q > 0) { const ref = 'TRF-' + String(100 + nid).padStart(5, '0'); mover(dias, min, a.cod, mayor, -q, 'Transferencia', ref, u); mover(dias, min, a.cod, otro, q, 'Transferencia', ref, u); }
        }
      }
    }
    const movs = lib.reverse();    /* el más nuevo primero */

    /* ----- tesorería ----- */
    const caja = Math.round(escala * (0.5 + r() * 0.5));
    const cuentas = [
      { id: 'caja', n: 'Caja en pesos', tipo: 'Caja', saldo: Math.round(caja * 0.12) },
      { id: 'bna', n: 'Banco Nación · cuenta corriente', tipo: 'Banco', saldo: Math.round(caja * 0.58) },
      { id: 'gal', n: 'Banco Galicia · caja de ahorro', tipo: 'Banco', saldo: 0 },
    ];
    cuentas[2].saldo = caja - cuentas[0].saldo - cuentas[1].saldo;
    const tmov = Array.from({ length: 14 }, (_, k) => {
      const cobro = r() < 0.55, cu = pick(cuentas), imp = Math.round((escala / 80) * (0.3 + r() * 1.4) / 100) * 100;
      return { dias: Math.floor(k * 1.2 + r()), cuenta: cu.n, tipo: cobro ? 'Cobro' : r() < 0.2 ? 'Comisión bancaria' : 'Pago',
        concepto: cobro ? pick(clientesE).n : r() < 0.2 ? 'Comisión y mantenimiento' : pick(proveedoresE).n, importe: cobro ? imp : -(r() < 0.2 ? Math.round(imp / 40) : imp) };
    });
    const cheques = Array.from({ length: 8 }, (_, k) => {
      const recibido = r() < 0.7;
      return { nro: String(20400000 + Math.floor(r() * 99999)), banco: pick(['Banco Nación', 'Banco Galicia', 'Banco Macro', 'Banco Santander']), tercero: recibido ? pick(clientesE).n : pick(proveedoresE).n,
        sentido: recibido ? 'Recibido' : 'Propio', importe: Math.round((escala / 60) * (0.3 + r() * 1.2) / 100) * 100, vence: Math.floor(r() * 70) - 12,
        estado: recibido ? pick(['En cartera', 'En cartera', 'Depositado', 'Cobrado', 'Rechazado']) : pick(['Entregado', 'Entregado', 'Cobrado']) };
    }).sort((a, b) => a.vence - b.vence);
    const cobrosPagos = Array.from({ length: 10 }, (_, k) => {
      const cobro = k % 3 !== 2, imp = Math.round((escala / 70) * (0.3 + r() * 1.3) / 100) * 100;
      return { nro: (cobro ? 'REC 0001-' : 'OP 0001-') + String(cobro ? 320 - k * 2 : 88 - k).padStart(8, '0'), tipo: cobro ? 'Cobro' : 'Pago', tercero: cobro ? pick(clientesE).n : pick(proveedoresE).n,
        dias: Math.floor(k * 2.4 + r() * 2), medio: pick(['Transferencia', 'Transferencia', 'Efectivo', 'Cheque']), importe: imp, estado: pick(['Confirmado', 'Confirmado', 'Confirmado', 'Confirmado', 'Confirmado', 'Borrador', 'Anulado']) };
    });
    const retenciones = Array.from({ length: 7 }, (_, k) => {
      const base = Math.round((escala / 50) * (0.4 + r() * 1.2) / 100) * 100, sufrida = r() < 0.6, impuesto = pick(['IIBB', 'IIBB', 'Ganancias', 'IVA']);
      const alic = impuesto === 'IIBB' ? pick([1.5, 2, 3]) : impuesto === 'Ganancias' ? pick([2, 6]) : 10.5;
      return { dias: Math.floor(k * 3.5 + r() * 3), impuesto, sentido: sufrida ? 'Sufrida' : 'Practicada', tercero: sufrida ? pick(clientesE).n : pick(proveedoresE).n, base, alic, importe: Math.round(base * alic) / 100 };
    });
    const manuales = [
      ['Sueldos y jornales del período', '5.2.2', '1.1.2', 0.05, 4], ['Pago de cargas sociales', '2.1.3', '1.1.2', 0.02, 11],
      ['Provisión de aguinaldo', '5.2.2', '2.1.3', 0.01, 17], ['Honorarios por servicios contratados', '5.2.3', '1.1.2', 0.008, 23],
    ].map(([concepto, debe, haber, f, dias]) => ({ concepto, dias, debe, haber, importe: Math.round((escala * f) / 100) * 100 }));

    return {
      id: i + 1, nombre: d[0], cuit: d[1], cond: d[2], ini: d[0].split(' ').slice(0, 2).map((p) => p[0]).join(''), tono: i % 3,
      ventas, flujo, ventasMes: ventas[11], ventasPrev: ventas[10],
      ivaPagar: ri ? Math.round(escala * (0.06 + r() * 0.05)) : 0,
      caja, porCobrar: Math.round(escala * (0.25 + r() * 0.3)), vencido: vencidas,
      conciliar: movsSinConciliar, venc, comp,
      clientes: clientesE, proveedores: proveedoresE, presup, pedidos, remitos, oc, remC, factC, deps, movs,
      tes: { cuentas, movs: tmov, cheques, cobrosPagos }, retenciones, manuales,
    };
  }

  /* ---------- trazabilidad: movimientos de ejemplo ---------- */
  const empresas = base.map((d, i) => crear(i, d));
  const categorias = { acceso: 'Acceso', comprobantes: 'Comprobantes', contabilidad: 'Contabilidad', tesoreria: 'Tesorería', stock: 'Stock', maestros: 'Maestros', seguridad: 'Seguridad' };
  const equipos = ['Chrome en Windows', 'Edge en Windows', 'Safari en iPhone', 'Chrome en Mac'];

  function crearBitacora() {
    const r = rng(4242), pick = (a) => a[Math.floor(r() * a.length)], n = (a, b) => a + Math.floor(r() * (b - a + 1));
    const pesos = (x) => '$ ' + x.toLocaleString('es-AR');
    const nro = () => '0003-' + String(n(1180, 1260)).padStart(8, '0');
    const art = () => pick(articulos);
    /* w = peso relativo; quien = usuarios que pueden hacerlo; sinEmp = no pertenece a una empresa */
    const T = [
      { w: 5, cat: 'acceso', quien: [1, 2, 3, 4], sinEmp: true, f: () => ({ accion: 'Inició sesión', detalle: 'Ingreso con usuario y segundo factor' }) },
      { w: 3, cat: 'acceso', quien: [1, 2, 3, 4], sinEmp: true, f: () => ({ accion: 'Cerró sesión', detalle: 'Cierre manual' }) },
      { w: 1, cat: 'acceso', quien: [3, 4], sinEmp: true, f: () => ({ accion: 'Intento de ingreso fallido', detalle: 'Contraseña incorrecta (intento ' + n(1, 3) + ' de 5)', res: 'fallo' }) },
      { w: 9, cat: 'comprobantes', quien: [1, 2, 4], f: () => { const c = pick(clientes), t = n(8, 480) * 1000; return { accion: 'Emitió Factura ' + pick(['A', 'A', 'B']) + ' ' + nro(), detalle: c.n + ' · ' + pesos(t) + ' · CAE obtenido' }; } },
      { w: 2, cat: 'comprobantes', quien: [1, 2], f: () => { const c = pick(clientes); return { accion: 'Anuló Factura A ' + nro(), detalle: c.n + ' · se generó la nota de crédito correspondiente', cambios: [['Estado', 'Autorizado', 'Anulado']] }; } },
      { w: 2, cat: 'comprobantes', quien: [1, 2, 4], f: () => ({ accion: 'ARCA rechazó Factura B ' + nro(), detalle: 'Observación: condición IVA del receptor no informada (RG 5616)', res: 'rechazo' }) },
      { w: 3, cat: 'comprobantes', quien: [3, 4], f: () => ({ accion: 'Guardó borrador de factura', detalle: pick(clientes).n + ' · ' + n(1, 4) + ' renglones' }) },
      { w: 5, cat: 'contabilidad', quien: [1, 2, 3], f: () => ({ accion: 'Registró asiento N° ' + n(4300, 4620), detalle: pick(['Honorarios del mes', 'Pago de alquiler', 'Provisión de aguinaldo', 'Ajuste de inventario', 'Cargas sociales']) + ' · Debe = Haber' }) },
      { w: 1, cat: 'contabilidad', quien: [1, 2], f: () => { const a = n(4300, 4620); return { accion: 'Reversó el asiento N° ' + a, detalle: 'Se generó el contraasiento; el original no se modifica', cambios: [['Asiento ' + a, 'Vigente', 'Reversado']] }; } },
      { w: 1, cat: 'contabilidad', quien: [1, 2], f: () => ({ accion: 'Cerró el período ' + pick(['agosto', 'septiembre']) + ' 2026', detalle: 'Ya no admite asientos con fecha dentro del período', cambios: [['Período', 'Abierto', 'Cerrado']] }) },
      { w: 4, cat: 'tesoreria', quien: [1, 2, 3], f: () => ({ accion: 'Concilió ' + n(3, 28) + ' movimientos bancarios', detalle: pick(['Banco Nación', 'Banco Galicia', 'Banco Macro']) + ' · cuenta corriente' }) },
      { w: 3, cat: 'tesoreria', quien: [1, 2, 4], f: () => ({ accion: 'Registró un cobro', detalle: pick(clientes).n + ' · ' + pesos(n(5, 300) * 1000) + ' · transferencia' }) },
      { w: 1, cat: 'tesoreria', quien: [3], f: () => ({ accion: 'Importó un extracto bancario', detalle: n(40, 160) + ' movimientos leídos, ' + n(0, 2) + ' duplicados descartados' }) },
      { w: 3, cat: 'stock', quien: [1, 3], f: () => { const a = pick(articulos.filter((x) => x.stock)), antes = n(10, 40); return { accion: 'Ajustó el stock de ' + a.n, detalle: 'Conteo físico · Depósito central', cambios: [['Stock en Depósito central', String(antes), String(antes + n(1, 4))]] }; } },
      { w: 3, cat: 'maestros', quien: [1, 2, 4], f: () => { const c = pick(clientes); return { accion: 'Modificó el cliente ' + c.n, detalle: 'Cambió la condición frente al IVA', cambios: [['Condición IVA', 'Consumidor Final', 'Responsable Inscripto']] }; } },
      { w: 2, cat: 'maestros', quien: [1, 2, 3], f: () => { const a = art(), p = a.p; return { accion: 'Cambió el precio de ' + a.n, detalle: 'Lista de precios general', cambios: [['Precio neto', pesos(Math.round(p * 0.92)), pesos(p)]] }; } },
      { w: 1, cat: 'maestros', quien: [1, 4], f: () => ({ accion: 'Dio de alta un cliente', detalle: pick(['Distribuidora Norte SRL', 'Panificados Del Centro', 'Vet. San Roque']) + ' · CUIT validado' }) },
      { w: 1, cat: 'seguridad', quien: [1], sinEmp: true, f: () => { const u = pick(['Matías Peña', 'Sofía Lucero']); return { accion: 'Cambió los permisos de ' + u, detalle: 'Rol y empresas habilitadas', cambios: [['Puede anular comprobantes', 'No', 'Sí']] }; } },
      { w: 1, cat: 'seguridad', quien: [1, 2], sinEmp: true, f: () => ({ accion: 'Exportó un listado a Excel', detalle: pick(['Libro IVA Ventas', 'Mayor de cuentas', 'Cuentas a cobrar']) }) },
    ];
    const total = T.reduce((s, t) => s + t.w, 0), ahora = new Date(), out = [];
    for (let dia = 29; dia >= 0; dia--) {
      const d = new Date(ahora); d.setDate(d.getDate() - dia); d.setHours(0, 0, 0, 0);
      const finde = d.getDay() === 0 || d.getDay() === 6;
      const cant = finde ? (r() < .25 ? 1 : 0) : n(5, 10);
      for (let k = 0; k < cant; k++) {
        let x = r() * total, t = T[0];
        for (const c of T) { x -= c.w; if (x <= 0) { t = c; break; } }
        const min = n(8 * 60 + 5, 19 * 60);
        const ts = new Date(d); ts.setMinutes(min, n(0, 59), 0);
        if (ts > ahora) continue;
        const u = pick(t.quien), e = t.sinEmp ? null : pick(empresas);
        const ev = t.f();
        out.push({ ts: ts.getTime(), u, emp: e ? e.id : null, cat: t.cat, res: 'ok', ip: '203.0.113.' + n(10, 90), disp: pick(equipos), ...ev });
      }
    }
    out.sort((a, b) => a.ts - b.ts);
    out.forEach((ev, i) => { ev.id = i + 1; });
    return out.reverse();
  }

  window.DATOS = { empresas, clientes, proveedores, articulos, condicion, usuarios, categorias, plan, totales, TASA, bitacora: crearBitacora() };
})();
