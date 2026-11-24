/**
 * ==========================================================================
 * Mentes que Programan · Backend gratuito con Google Apps Script + Google Sheets
 * Universidad Católica de Cuenca · Departamento de Matemáticas
 *
 * Qué hace:
 *   - Recibe las inscripciones (POST JSON) desde la landing page.
 *   - Valida los datos en el servidor (nunca confiar solo en el navegador).
 *   - Evita equipos duplicados (misma institución + mismo nombre de equipo).
 *   - Guarda en dos hojas:
 *       "Inscripciones"  → 1 fila por equipo (vista resumida para revisar/exportar)
 *       "Participantes"  → 1 fila por persona (normalizada, lista para PostgreSQL)
 *   - Genera un código único: MQP26-0001, MQP26-0002, ...
 *   - (Opcional) Envía un correo de confirmación al tutor responsable.
 *
 * Instalación: ver README.md → "Paso 2: Backend".
 * Costo: 0 USD (cuotas gratuitas de Google: ~20 000 ejecuciones/día,
 *        100 correos/día en cuentas gmail.com, 1 500 en Workspace).
 * ==========================================================================
 */

/* ----------------------------- CONFIGURACIÓN ----------------------------- */
const CFG = {
  PREFIJO_CODIGO: 'MQP26',
  HOJA_INSCRIPCIONES: 'Inscripciones',
  HOJA_PARTICIPANTES: 'Participantes',
  ENVIAR_CORREO_CONFIRMACION: true,       // false para desactivar
  CORREO_ORGANIZACION: 'jaime.segarra@ucacue.edu.ec', // copia oculta de cada confirmación ('' = ninguna)
  INSCRIPCIONES_ABIERTAS: true,           // false para cerrar el registro
  TITULARES: { min: 3, max: 3 },
  SUPLENTES: { max: 1 },
  NIVELES: ['8.º EGB', '9.º EGB', '10.º EGB', '1.º BGU', '2.º BGU', '3.º BGU'],
  MAX_LEN: { institucion: 150, equipo: 60, nombre: 120, correo: 100, telefono: 20 }
};

const ENCABEZADOS_INSCRIPCIONES = [
  'Código', 'Fecha de registro', 'Institución', 'Equipo',
  'Tutor responsable', 'Correo tutor responsable', 'Teléfono tutor responsable',
  'Tutor suplente', 'Correo tutor suplente', 'Teléfono tutor suplente',
  'N.º titulares', 'Integrantes titulares', 'N.º suplentes', 'Estudiantes suplentes',
  'Acepta normativa', 'Estado', 'Origen'
];

const ENCABEZADOS_PARTICIPANTES = [
  'Código inscripción', 'Institución', 'Equipo', 'Rol', 'Orden',
  'Nombre completo', 'Correo electrónico', 'Teléfono', 'Nivel educativo'
];

/* ------------------------------- ENDPOINTS ------------------------------- */

/** GET: comprobación de estado (útil para verificar el despliegue). */
function doGet() {
  return json_({ ok: true, servicio: 'Mentes que Programan – Inscripciones', abiertas: CFG.INSCRIPCIONES_ABIERTAS });
}

/** POST: registra una inscripción. */
function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    if (!CFG.INSCRIPCIONES_ABIERTAS) return json_({ ok: false, error: 'Las inscripciones se encuentran cerradas.' });

    const data = JSON.parse((e && e.postData && e.postData.contents) || '{}');

    // Anti-spam: el campo trampa debe llegar vacío.
    if (data.honeypot) return json_({ ok: true, codigo: CFG.PREFIJO_CODIGO + '-0000', fecha: new Date().toISOString() });

    const errores = validar_(data);
    if (errores.length) return json_({ ok: false, error: 'Datos inválidos: ' + errores.join(' ') });

    // Bloqueo para evitar códigos duplicados ante envíos simultáneos.
    lock.waitLock(20000);

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const hojaI = obtenerHoja_(ss, CFG.HOJA_INSCRIPCIONES, ENCABEZADOS_INSCRIPCIONES);
    const hojaP = obtenerHoja_(ss, CFG.HOJA_PARTICIPANTES, ENCABEZADOS_PARTICIPANTES);

    if (equipoDuplicado_(hojaI, data.institucion.nombre, data.equipo.nombre)) {
      return json_({ ok: false, error: 'Ya existe un equipo con el nombre "' + data.equipo.nombre + '" registrado por esta institución.' });
    }

    const codigo = siguienteCodigo_(hojaI);
    const fecha = new Date();
    const tr = data.tutorResponsable;
    const ts = data.tutorSuplente || {};
    const fmt = (p) => p.nombreCompleto + ' <' + p.correo + '> (' + p.nivelEducativo + ')';

    hojaI.appendRow(texto_([
      codigo, fecha, data.institucion.nombre, data.equipo.nombre,
      tr.nombreCompleto, tr.correo, tr.telefono,
      ts.nombreCompleto || '', ts.correo || '', ts.telefono || '',
      data.integrantes.length, data.integrantes.map(fmt).join('\n'),
      data.suplentes.length, data.suplentes.map(fmt).join('\n'),
      'Sí', 'Registrada', String((data.metadatos && data.metadatos.origen) || '').slice(0, 200)
    ]));

    // Filas normalizadas por persona
    const filas = [];
    const push = (rol, i, p) => filas.push(texto_([
      codigo, data.institucion.nombre, data.equipo.nombre, rol, i,
      p.nombreCompleto, p.correo, p.telefono || '', p.nivelEducativo || ''
    ]));
    push('Tutor responsable', 1, tr);
    if (data.tutorSuplente) push('Tutor suplente', 1, ts);
    data.integrantes.forEach((p, i) => push('Integrante titular', i + 1, p));
    data.suplentes.forEach((p, i) => push('Estudiante suplente', i + 1, p));
    hojaP.getRange(hojaP.getLastRow() + 1, 1, filas.length, filas[0].length).setValues(filas);

    SpreadsheetApp.flush();
    lock.releaseLock();

    if (CFG.ENVIAR_CORREO_CONFIRMACION) enviarConfirmacion_(codigo, data);

    return json_({ ok: true, codigo: codigo, fecha: fecha.toISOString() });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: 'Error interno al registrar la inscripción. Intente nuevamente en unos minutos.' });
  } finally {
    try { lock.releaseLock(); } catch (_) { /* ya liberado */ }
  }
}

/* ------------------------------ VALIDACIÓN ------------------------------- */
function validar_(d) {
  const e = [];
  const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const RE_TEL = /^\+?\d{7,15}$/;
  const txt = (v, max, campo) => {
    if (typeof v !== 'string' || !v.trim()) { e.push(campo + ' es obligatorio.'); return; }
    if (v.length > max) e.push(campo + ' supera ' + max + ' caracteres.');
  };
  const persona = (p, campo, conTelefono, conNivel) => {
    if (!p || typeof p !== 'object') { e.push(campo + ' es obligatorio.'); return; }
    txt(p.nombreCompleto, CFG.MAX_LEN.nombre, campo + ': nombre');
    txt(p.correo, CFG.MAX_LEN.correo, campo + ': correo');
    if (p.correo && !RE_EMAIL.test(p.correo)) e.push(campo + ': correo inválido.');
    if (conTelefono) {
      txt(p.telefono, CFG.MAX_LEN.telefono, campo + ': teléfono');
      if (p.telefono && !RE_TEL.test(String(p.telefono).replace(/[\s()-]/g, ''))) e.push(campo + ': teléfono inválido.');
    }
    if (conNivel && CFG.NIVELES.indexOf(p.nivelEducativo) === -1) e.push(campo + ': nivel educativo inválido.');
  };

  if (!d || typeof d !== 'object') return ['Solicitud vacía.'];
  txt(d.institucion && d.institucion.nombre, CFG.MAX_LEN.institucion, 'Institución');
  txt(d.equipo && d.equipo.nombre, CFG.MAX_LEN.equipo, 'Nombre del equipo');
  persona(d.tutorResponsable, 'Tutor responsable', true, false);
  if (d.tutorSuplente) persona(d.tutorSuplente, 'Tutor suplente', true, false);

  if (!Array.isArray(d.integrantes) || d.integrantes.length < CFG.TITULARES.min || d.integrantes.length > CFG.TITULARES.max) {
    e.push(CFG.TITULARES.min === CFG.TITULARES.max
      ? 'Se requieren exactamente ' + CFG.TITULARES.min + ' integrantes titulares.'
      : 'Se requieren entre ' + CFG.TITULARES.min + ' y ' + CFG.TITULARES.max + ' integrantes titulares.');
  } else {
    d.integrantes.forEach((p, i) => persona(p, 'Integrante ' + (i + 1), false, true));
  }
  if (!Array.isArray(d.suplentes) || d.suplentes.length > CFG.SUPLENTES.max) {
    e.push('Máximo ' + CFG.SUPLENTES.max + ' estudiante(s) suplente(s).');
  } else {
    d.suplentes.forEach((p, i) => persona(p, 'Suplente ' + (i + 1), false, true));
  }

  // Correos de estudiantes únicos dentro del equipo
  const correos = [].concat(d.integrantes || [], d.suplentes || []).map((p) => String(p && p.correo || '').toLowerCase());
  if (new Set(correos).size !== correos.length) e.push('Hay correos de estudiantes repetidos.');

  if (d.aceptaNormativa !== true) e.push('Debe aceptar la normativa oficial.');
  return e;
}

/* ------------------------------- UTILIDADES ------------------------------ */
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Obtiene (o crea con formato) una hoja con sus encabezados. */
function obtenerHoja_(ss, nombre, encabezados) {
  let hoja = ss.getSheetByName(nombre);
  if (!hoja) {
    hoja = ss.insertSheet(nombre);
    hoja.getRange(1, 1, 1, encabezados.length).setValues([encabezados])
      .setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#112337');
    hoja.setFrozenRows(1);
    hoja.getRange('A:A').setFontWeight('bold');
    // Formato texto: evita que Sheets convierta teléfonos (0999…) o nombres numéricos en números.
    const columnasTexto = nombre === CFG.HOJA_INSCRIPCIONES ? ['A:A', 'C:J', 'L:L', 'N:Q'] : ['A:D', 'F:I'];
    hoja.getRangeList(columnasTexto).setNumberFormat('@');
    hoja.getRange('B:B').setNumberFormat(nombre === CFG.HOJA_INSCRIPCIONES ? 'dd/mm/yyyy hh:mm' : '@');
  }
  return hoja;
}

/** Siguiente código correlativo: MQP26-0001, MQP26-0002, ... */
function siguienteCodigo_(hoja) {
  const props = PropertiesService.getScriptProperties();
  const n = Number(props.getProperty('ULTIMO_CORRELATIVO') || Math.max(hoja.getLastRow() - 1, 0)) + 1;
  props.setProperty('ULTIMO_CORRELATIVO', String(n));
  return CFG.PREFIJO_CODIGO + '-' + ('000' + n).slice(-4);
}

function equipoDuplicado_(hoja, institucion, equipo) {
  const filas = hoja.getLastRow() - 1;
  if (filas < 1) return false;
  const norm = (s) => String(s).trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const datos = hoja.getRange(2, 3, filas, 2).getValues(); // columnas C (Institución) y D (Equipo)
  return datos.some((r) => norm(r[0]) === norm(institucion) && norm(r[1]) === norm(equipo));
}

/**
 * Neutraliza "inyección de fórmulas" en Sheets/Excel: un texto que empiece
 * con = + - @ se guardaría como fórmula. Se antepone un apóstrofo.
 */
function texto_(fila) {
  return fila.map((v) => (typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v));
}

function enviarConfirmacion_(codigo, d) {
  try {
    const lista = (arr) => arr.map((p) => '<li>' + esc_(p.nombreCompleto) + ' — ' + esc_(p.nivelEducativo) + '</li>').join('');
    const html =
      '<div style="font-family:Arial,sans-serif;color:#222;max-width:600px">' +
      '<div style="background:#112337;color:#fff;padding:20px;border-bottom:5px solid #E20613">' +
      '<h2 style="margin:0">Mentes que Programan · Concurso Matemático</h2>' +
      '<p style="margin:4px 0 0">Universidad Católica de Cuenca</p></div>' +
      '<div style="padding:20px">' +
      '<p>Estimado/a <b>' + esc_(d.tutorResponsable.nombreCompleto) + '</b>:</p>' +
      '<p>Se ha registrado correctamente la inscripción del equipo <b>' + esc_(d.equipo.nombre) +
      '</b> de <b>' + esc_(d.institucion.nombre) + '</b>.</p>' +
      '<p style="background:#F5F5F5;padding:12px;border-left:4px solid #E20613">Código de inscripción: <b>' + codigo + '</b></p>' +
      '<p><b>Integrantes titulares:</b></p><ul>' + lista(d.integrantes) + '</ul>' +
      (d.suplentes.length ? '<p><b>Suplentes:</b></p><ul>' + lista(d.suplentes) + '</ul>' : '') +
      '<p>Departamento de Matemáticas<br>Facultad de Informática, Ciencias de la Computación e Innovación Tecnológica</p>' +
      '</div></div>';

    const opciones = { htmlBody: html, name: 'Mentes que Programan · UCACUE' };
    if (CFG.CORREO_ORGANIZACION) opciones.bcc = CFG.CORREO_ORGANIZACION;
    if (d.tutorSuplente && d.tutorSuplente.correo) opciones.cc = d.tutorSuplente.correo;

    MailApp.sendEmail(d.tutorResponsable.correo, 'Inscripción Mentes que Programan – ' + codigo, 'Código de inscripción: ' + codigo, opciones);
  } catch (err) {
    // La inscripción ya está guardada: un fallo de correo (p. ej. cuota diaria) no la invalida.
    console.warn('No se pudo enviar el correo de confirmación: ' + err);
  }
}

function esc_(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ------------------------- MENÚ PARA ORGANIZADORES ------------------------ */

/** Agrega un menú "Mentes que Programan" a la hoja de cálculo. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Mentes que Programan')
    .addItem('Preparar hojas', 'prepararHojas')
    .addItem('Ver resumen de inscripciones', 'verResumen')
    .addSeparator()
    .addItem('Probar envío (registro de prueba)', 'registroDePrueba')
    .addToUi();
}

/** Crea las hojas con encabezados (ejecutar una vez tras instalar). */
function prepararHojas() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  obtenerHoja_(ss, CFG.HOJA_INSCRIPCIONES, ENCABEZADOS_INSCRIPCIONES);
  obtenerHoja_(ss, CFG.HOJA_PARTICIPANTES, ENCABEZADOS_PARTICIPANTES);
}

function verResumen() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hojaI = obtenerHoja_(ss, CFG.HOJA_INSCRIPCIONES, ENCABEZADOS_INSCRIPCIONES);
  const hojaP = obtenerHoja_(ss, CFG.HOJA_PARTICIPANTES, ENCABEZADOS_PARTICIPANTES);
  const equipos = Math.max(hojaI.getLastRow() - 1, 0);
  const personas = Math.max(hojaP.getLastRow() - 1, 0);
  SpreadsheetApp.getUi().alert('Resumen Mentes que Programan',
    'Equipos inscritos: ' + equipos + '\nPersonas registradas (tutores + estudiantes): ' + personas +
    '\n\nPara exportar: Archivo → Descargar → Microsoft Excel (.xlsx) o CSV.',
    SpreadsheetApp.getUi().ButtonSet.OK);
}

/** Inserta un registro de prueba usando el mismo flujo del doPost. */
function registroDePrueba() {
  const ejemplo = {
    institucion: { nombre: 'Unidad Educativa de Prueba' },
    equipo: { nombre: 'Equipo Prueba ' + new Date().getTime() },
    tutorResponsable: { nombreCompleto: 'Ana Pérez', correo: Session.getActiveUser().getEmail() || 'prueba@example.com', telefono: '0999999999' },
    tutorSuplente: null,
    integrantes: [
      { nombreCompleto: 'Luis Torres', correo: 'luis@example.com', nivelEducativo: '1.º BGU' },
      { nombreCompleto: 'María Vega', correo: 'maria@example.com', nivelEducativo: '2.º BGU' },
      { nombreCompleto: 'José Ríos', correo: 'jose@example.com', nivelEducativo: '3.º BGU' }
    ],
    suplentes: [],
    aceptaNormativa: true,
    metadatos: { origen: 'Prueba desde Apps Script' }
  };
  const res = doPost({ postData: { contents: JSON.stringify(ejemplo) } });
  SpreadsheetApp.getUi().alert('Resultado: ' + res.getContent());
}
