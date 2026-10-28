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
  const condicion = { RI: 'Responsable Inscripto', MT: 'Monotributo', CF: 'Consumidor Final', EX: 'Exento' };

  const articulos = [
    { n: 'Honorarios profesionales', p: 85000, al: '21' },
    { n: 'Servicio de consultoría', p: 120000, al: '21' },
    { n: 'Pan lactal x500 g', p: 1850, al: '10.5' },
    { n: 'Servicio de telecomunicaciones', p: 38000, al: '27' },
    { n: 'Seguro de caución', p: 54000, al: 'ex' },
    { n: 'Reintegro de gastos', p: 15000, al: 'ng' },
    { n: 'Notebook 15"', p: 780000, al: '21' },
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
    const ri = d[2] === 'RI';
    const diasIva = d[4] != null ? d[4] : 2 + Math.floor(r() * 12);
    const movs = 6 + Math.floor(r() * 24);
    const vencidas = d[5] != null ? d[5] : Math.floor(r() * 4);
    const venc = [
      { dias: ri ? diasIva : 20 - new Date().getDate(), nombre: ri ? 'IVA · F.2002' : 'Cuota monotributo', tipo: 'imp' },
      { dias: diasIva + 3, nombre: 'SIRE · Retenciones', tipo: 'imp' },
      { dias: diasIva + 8, nombre: ri ? 'Ganancias · anticipo' : 'Ingresos Brutos', tipo: 'imp' },
      { dias: diasIva + 14, nombre: 'F.931 · cargas sociales', tipo: 'lab' },
      { dias: diasIva + 22, nombre: 'Balance trimestral', tipo: 'est' },
    ].map((v) => ({ ...v, dias: v.dias < -3 ? v.dias + 30 : v.dias }));
    venc.sort((a, b) => a.dias - b.dias);
    const comp = Array.from({ length: 14 }, (_, k) => {
      const cli = clientes[Math.floor(r() * clientes.length)];
      const letra = ri ? (cli.iva === 'RI' || cli.iva === 'MT' ? 'A' : 'B') : 'C';
      const est = estados[Math.floor(r() * estados.length)];
      return {
        letra, cliente: cli.n, dias: k === 0 ? 0 : Math.floor(k * 1.5 + r() * 2),
        nro: '0003-' + String(1240 - k * 3).padStart(8, '0'),
        total: Math.round((escala / 90) * (0.2 + r() * 1.6) / 100) * 100, estado: est,
      };
    });
    return {
      id: i + 1, nombre: d[0], cuit: d[1], cond: d[2], ini: d[0].split(' ').slice(0, 2).map((p) => p[0]).join(''), tono: i % 3,
      ventas, flujo, ventasMes: ventas[11], ventasPrev: ventas[10],
      ivaPagar: ri ? Math.round(escala * (0.06 + r() * 0.05)) : 0,
      caja: Math.round(escala * (0.5 + r() * 0.5)), porCobrar: Math.round(escala * (0.25 + r() * 0.3)), vencido: vencidas,
      conciliar: movs, venc, comp,
    };
  }

  /* ---------- trazabilidad: usuarios y movimientos de ejemplo ---------- */
  const usuarios = [
    { id: 1, n: 'Andrés Navarro', ini: 'AN', rol: 'Administrador', tono: 0 },
    { id: 2, n: 'Carolina Ríos', ini: 'CR', rol: 'Contadora', tono: 1 },
    { id: 3, n: 'Matías Peña', ini: 'MP', rol: 'Auxiliar contable', tono: 2 },
    { id: 4, n: 'Sofía Lucero', ini: 'SL', rol: 'Administrativa', tono: 0 },
  ];
  const empresas = base.map((d, i) => crear(i, d));
  const categorias = { acceso: 'Acceso', comprobantes: 'Comprobantes', contabilidad: 'Contabilidad', tesoreria: 'Tesorería', maestros: 'Maestros', seguridad: 'Seguridad' };
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

  window.DATOS = { empresas, clientes, articulos, condicion, usuarios, categorias, bitacora: crearBitacora() };
})();
