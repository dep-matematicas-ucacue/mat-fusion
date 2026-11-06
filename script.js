/* ==========================================================================
   MAT FUSION · Universidad Católica de Cuenca
   Lógica de la landing de inscripción (JavaScript vanilla, sin dependencias)

   Arquitectura (cada módulo equivale a un futuro componente/servicio):
     CONFIG      → parámetros editables (URL del backend, límites, contacto)
     Utils       → utilidades puras
     Normativa   → lee tamaño/fecha del PDF publicado     (React: <NormativaCard/>)
     Members     → alta/baja dinámica de integrantes      (React: <MemberList/>)
     Validator   → reglas de validación                   (NestJS: class-validator DTO)
     Serializer  → construye el JSON de inscripción       (DTO CreateInscripcionDto)
     Api         → envío al backend (Google Apps Script)  (fetch → POST /inscripciones)
     UI          → estados visuales (errores, carga, éxito)
     App         → arranque y orquestación
   ========================================================================== */
'use strict';

/* --------------------------------------------------------------------------
   CONFIG — ÚNICO BLOQUE QUE LOS ORGANIZADORES NECESITAN EDITAR
   -------------------------------------------------------------------------- */
const CONFIG = Object.freeze({
  /**
   * URL del Web App de Google Apps Script (termina en /exec).
   * Ver README.md → "Paso 2: Backend". Si se deja vacío, el sitio funciona en
   * MODO DEMOSTRACIÓN (los registros solo se guardan en el navegador local).
   */
  API_URL: 'https://script.google.com/macros/s/AKfycbzb2hqegfQop40se0SaVSFbrzy-ER64LCkdE6RM7zmOgVbdyBqO5OX41aUkxFzsseGRnA/exec',

  /** Tiempo máximo de espera del envío (ms). */
  TIMEOUT_MS: 25000,

  /** Límites de conformación del equipo. */
  TITULARES: { min: 3, max: 3, iniciales: 3 },
  SUPLENTES: { min: 0, max: 1, iniciales: 1 },

  /** Opciones del campo "Nivel educativo". */
  NIVELES: [
    '8.º EGB', '9.º EGB', '10.º EGB',
    '1.º BGU', '2.º BGU', '3.º BGU'
  ],

  /** Contacto que se muestra en la confirmación y el footer. */
  CONTACTO: {
    email: 'info@ucacue.edu.ec',
    telefono: '+593984713417',
    telefonoVisible: '098 471 3417'
  },

  /** Longitudes máximas (deben coincidir con backend/Code.gs). */
  MAX_LEN: { institucion: 150, equipo: 60, nombre: 120, correo: 100, telefono: 20 }
});

/* --------------------------------------------------------------------------
   Utils
   -------------------------------------------------------------------------- */
const Utils = (() => {
  let uidCounter = 0;

  /** Genera identificadores únicos para asociar <label for> con inputs. */
  const uid = (prefix = 'id') => `${prefix}-${Date.now().toString(36)}-${++uidCounter}`;

  /** Normaliza espacios: recorta y colapsa espacios múltiples. */
  const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

  /** Formatea bytes en KB / MB. */
  const formatBytes = (bytes) => {
    if (!Number.isFinite(bytes) || bytes <= 0) return '—';
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  /** Fecha en formato local ecuatoriano dd/mm/aaaa. */
  const formatDate = (date, withTime = false) => {
    const opts = { day: '2-digit', month: '2-digit', year: 'numeric' };
    if (withTime) Object.assign(opts, { hour: '2-digit', minute: '2-digit' });
    return new Intl.DateTimeFormat('es-EC', opts).format(date);
  };

  return { uid, clean, formatBytes, formatDate };
})();

/* --------------------------------------------------------------------------
   Normativa — obtiene metadatos reales del PDF publicado.
   Para actualizar la normativa solo se reemplaza el archivo PDF:
   tamaño y fecha se leen de las cabeceras HTTP del servidor.
   -------------------------------------------------------------------------- */
const Normativa = (() => {
  const init = async () => {
    const card = document.getElementById('docNormativa');
    if (!card) return;
    const file = card.dataset.file;

    // En file:// no hay cabeceras HTTP: se mantienen los valores del HTML.
    if (!location.protocol.startsWith('http')) return;

    try {
      const res = await fetch(file, { method: 'HEAD', cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const size = Number(res.headers.get('content-length'));
      const modified = res.headers.get('last-modified');

      document.getElementById('docTamano').textContent = Utils.formatBytes(size);
      if (modified) {
        const d = new Date(modified);
        if (!Number.isNaN(d.getTime())) document.getElementById('docFecha').textContent = Utils.formatDate(d);
      }
    } catch (err) {
      // El PDF aún no se ha publicado: se informa sin romper la página.
      console.warn('[Normativa] No se pudo verificar el documento:', err.message);
      if (String(err.message).includes('404')) {
        card.classList.add('is-unavailable');
        document.getElementById('docTamano').textContent = 'Documento no disponible aún';
      }
    }
  };
  return { init };
})();

/* --------------------------------------------------------------------------
   Members — gestión dinámica de integrantes titulares y suplentes
   -------------------------------------------------------------------------- */
const Members = (() => {
  const groups = {
    titulares: {
      list: null, button: null, limits: CONFIG.TITULARES,
      label: 'Integrante', required: true
    },
    suplentes: {
      list: null, button: null, limits: CONFIG.SUPLENTES,
      label: 'Suplente', required: false
    }
  };
  let template = null;

  /** Crea una ficha de integrante a partir del <template>. */
  const createCard = (groupKey) => {
    const g = groups[groupKey];
    const node = template.content.firstElementChild.cloneNode(true);
    const id = Utils.uid(groupKey);

    if (!g.required) node.setAttribute('data-optional-group', '');

    node.querySelectorAll('[data-field]').forEach((input) => {
      const field = input.dataset.field;
      const inputId = `${id}-${field}`;
      const errorId = `${inputId}-error`;
      const label = node.querySelector(`label[data-for="${field}"]`);
      const feedback = input.nextElementSibling;

      input.id = inputId;
      input.setAttribute('aria-describedby', errorId);
      feedback.id = errorId;
      label.htmlFor = inputId;

      if (g.required) {
        input.required = true;
        label.insertAdjacentHTML('beforeend', ' <span class="req">*</span>');
      }
      if (field === 'nombre') input.autocomplete = 'off';
      if (field === 'nivel') fillLevels(input);
    });

    node.querySelector('[data-remove]').addEventListener('click', () => remove(groupKey, node));
    return node;
  };

  /** Rellena el <select> de niveles educativos. */
  const fillLevels = (select) => {
    select.add(new Option('Seleccione…', ''));
    CONFIG.NIVELES.forEach((n) => select.add(new Option(n, n)));
  };

  /** Renumera fichas y actualiza visibilidad de botones según límites. */
  const refresh = (groupKey) => {
    const g = groups[groupKey];
    const cards = g.list.querySelectorAll('[data-member]');
    cards.forEach((card, i) => {
      const text = `${g.label} ${i + 1}`;
      card.querySelector('[data-member-label]').textContent = text;
      const removeBtn = card.querySelector('[data-remove]');
      removeBtn.hidden = cards.length <= g.limits.min;
      removeBtn.setAttribute('aria-label', `Quitar ${text}`);
    });
    // Con el cupo lleno el botón "+ Agregar" se oculta; reaparece si se quita una ficha.
    const full = cards.length >= g.limits.max;
    g.button.disabled = full;
    g.button.hidden = full;
  };

  /** Agrega una ficha. Devuelve la ficha creada o null si se alcanzó el máximo. */
  const add = (groupKey, { focus = false } = {}) => {
    const g = groups[groupKey];
    if (g.list.children.length >= g.limits.max) return null;
    const card = createCard(groupKey);
    g.list.appendChild(card);
    refresh(groupKey);
    if (focus) card.querySelector('input').focus();
    return card;
  };

  /** Quita una ficha respetando el mínimo. */
  const remove = (groupKey, card) => {
    const g = groups[groupKey];
    if (g.list.children.length <= g.limits.min) return;
    card.remove();
    refresh(groupKey);
    g.button.focus();
  };

  /** Restablece las fichas iniciales (tras una inscripción exitosa). */
  const reset = () => {
    Object.keys(groups).forEach((key) => {
      groups[key].list.innerHTML = '';
      for (let i = 0; i < groups[key].limits.iniciales; i++) add(key);
    });
  };

  const init = () => {
    template = document.getElementById('tplMiembro');
    groups.titulares.list = document.getElementById('listaTitulares');
    groups.titulares.button = document.getElementById('btnAgregarTitular');
    groups.suplentes.list = document.getElementById('listaSuplentes');
    groups.suplentes.button = document.getElementById('btnAgregarSuplente');

    // Textos de límites en el HTML
    document.querySelectorAll('[data-min="titulares"]').forEach((el) => { el.textContent = CONFIG.TITULARES.min; });
    document.querySelectorAll('[data-max="titulares"]').forEach((el) => { el.textContent = CONFIG.TITULARES.max; });
    document.querySelectorAll('[data-max="suplentes"]').forEach((el) => { el.textContent = CONFIG.SUPLENTES.max; });

    groups.titulares.button.addEventListener('click', () => add('titulares', { focus: true }));
    groups.suplentes.button.addEventListener('click', () => add('suplentes', { focus: true }));
    reset();
  };

  return { init, reset };
})();

/* --------------------------------------------------------------------------
   Validator — reglas de validación con mensajes en español
   -------------------------------------------------------------------------- */
const Validator = (() => {
  const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const RE_PERSON = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ' .-]+$/;
  const PERSON_CONTAINERS = '[data-person], [data-member]';

  /** ¿Pertenece el campo a un grupo opcional con algún dato ingresado? */
  const isRequired = (input) => {
    if (input.required) return true;
    const group = input.closest('[data-optional-group]');
    if (!group) return false;
    return [...group.querySelectorAll('[data-field]')].some((el) => Utils.clean(el.value) !== '');
  };

  /** Devuelve el mensaje de error del campo, o '' si es válido. */
  const check = (input) => {
    if (input.type === 'checkbox') {
      return input.checked ? '' : 'Debe aceptar la normativa oficial para continuar con la inscripción.';
    }

    const value = Utils.clean(input.value);
    const max = Number(input.getAttribute('maxlength')) || Infinity;

    if (!value) return isRequired(input) ? (input.tagName === 'SELECT' ? 'Seleccione una opción.' : 'Este campo es obligatorio.') : '';
    if (value.length > max) return `Máximo ${max} caracteres.`;
    if (value.length < 2) return 'Ingrese al menos 2 caracteres.';

    if (input.type === 'email' && !RE_EMAIL.test(value)) {
      return 'Ingrese un correo válido (ejemplo: nombre@dominio.com).';
    }
    if (input.dataset.rule === 'phone') {
      const digits = value.replace(/[\s()-]/g, '');
      if (!/^\+?\d{7,15}$/.test(digits)) return 'Ingrese un teléfono válido (7 a 15 dígitos).';
    }
    if (input.dataset.field === 'nombre' && input.closest(PERSON_CONTAINERS)) {
      if (!RE_PERSON.test(value)) return 'El nombre solo puede contener letras y espacios.';
      if (value.split(' ').length < 2) return 'Ingrese nombre y apellido.';
    }
    return '';
  };

  /** Pinta el estado visual del campo. */
  const paint = (input, message) => {
    const feedback = document.getElementById(input.getAttribute('aria-describedby'));
    const hasValue = input.type === 'checkbox' ? input.checked : Utils.clean(input.value) !== '';
    input.classList.toggle('is-invalid', !!message);
    input.classList.toggle('is-valid', !message && hasValue);
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
    if (feedback) feedback.textContent = message;
  };

  const validateField = (input) => {
    const msg = check(input);
    paint(input, msg);
    return msg;
  };

  /** Detecta correos repetidos entre estudiantes (titulares + suplentes). */
  const checkDuplicateEmails = (form) => {
    const seen = new Map();
    const errors = [];
    form.querySelectorAll('[data-member] [data-field="correo"]').forEach((input) => {
      const v = Utils.clean(input.value).toLowerCase();
      if (!v || input.classList.contains('is-invalid')) return;
      if (seen.has(v)) {
        paint(input, 'Este correo ya fue registrado para otro estudiante del equipo.');
        errors.push(input);
      } else {
        seen.set(v, input);
      }
    });
    return errors;
  };

  /** Valida todo el formulario. Devuelve la lista de campos inválidos. */
  const validateForm = (form) => {
    const fields = form.querySelectorAll('input:not([type="hidden"]):not(#sitioWeb), select');
    const invalid = [];
    fields.forEach((f) => { if (validateField(f)) invalid.push(f); });
    invalid.push(...checkDuplicateEmails(form));
    return invalid;
  };

  /** Validación en vivo: al salir del campo y al corregir un campo con error. */
  const bindLive = (form) => {
    form.addEventListener('focusout', (e) => {
      const el = e.target;
      if (!el.matches('input, select') || el.id === 'sitioWeb') return;
      if (el.type !== 'checkbox') el.value = Utils.clean(el.value);
      validateField(el);
      // Revalida el resto del grupo opcional (si se llenó uno, los demás pasan a obligatorios)
      const group = el.closest('[data-optional-group]');
      if (group) group.querySelectorAll('[data-field]').forEach((f) => { if (f !== el && f.classList.contains('is-invalid')) validateField(f); });
    });
    form.addEventListener('input', (e) => {
      if (e.target.classList.contains('is-invalid')) validateField(e.target);
    });
    form.addEventListener('change', (e) => {
      if (e.target.matches('select, [type="checkbox"]')) validateField(e.target);
    });
  };

  return { validateForm, bindLive };
})();

/* --------------------------------------------------------------------------
   Serializer — construye el objeto de inscripción (contrato con el backend)
   Estructura pensada para mapear 1:1 a tablas PostgreSQL:
   institucion · equipo · tutor · estudiante(rol: titular|suplente)
   -------------------------------------------------------------------------- */
const Serializer = (() => {
  const readPerson = (container) => {
    const get = (f) => Utils.clean(container.querySelector(`[data-field="${f}"]`)?.value);
    const p = { nombreCompleto: get('nombre'), correo: get('correo').toLowerCase() };
    if (container.querySelector('[data-field="telefono"]')) p.telefono = get('telefono');
    if (container.querySelector('[data-field="nivel"]')) p.nivelEducativo = get('nivel');
    return p;
  };
  const isEmpty = (p) => !p.nombreCompleto && !p.correo && !p.telefono && !p.nivelEducativo;

  const build = (form) => {
    const tutorSuplente = readPerson(form.querySelector('[data-person="tutorSuplente"]'));
    return {
      version: '1.0',
      institucion: { nombre: Utils.clean(form.institucion.value) },
      equipo: { nombre: Utils.clean(form.equipo.value) },
      tutorResponsable: readPerson(form.querySelector('[data-person="tutorResponsable"]')),
      tutorSuplente: isEmpty(tutorSuplente) ? null : tutorSuplente,
      integrantes: [...form.querySelectorAll('#listaTitulares [data-member]')].map(readPerson),
      suplentes: [...form.querySelectorAll('#listaSuplentes [data-member]')].map(readPerson).filter((p) => !isEmpty(p)),
      aceptaNormativa: form.querySelector('#aceptaNormativa').checked,
      honeypot: form.querySelector('#sitioWeb').value,
      metadatos: {
        enviadoEn: new Date().toISOString(),
        origen: location.href,
        userAgent: navigator.userAgent.slice(0, 250)
      }
    };
  };
  return { build };
})();

/* --------------------------------------------------------------------------
   Api — comunicación con Google Apps Script
   Se envía como text/plain para evitar la verificación CORS "preflight",
   que Apps Script no soporta. La respuesta JSON sí es legible.
   -------------------------------------------------------------------------- */
const Api = (() => {
  const DEMO_KEY = 'matfusion_demo_inscripciones';

  const sendDemo = async (payload) => {
    await new Promise((r) => setTimeout(r, 900)); // simula latencia de red
    let list = [];
    try { list = JSON.parse(localStorage.getItem(DEMO_KEY)) || []; } catch { /* almacenamiento no disponible */ }
    const codigo = `MF26-DEMO-${String(list.length + 1).padStart(4, '0')}`;
    try { localStorage.setItem(DEMO_KEY, JSON.stringify([...list, { codigo, ...payload }])); } catch { /* ignorar */ }
    console.info('[MAT FUSION] Modo demostración. Registro guardado localmente:', { codigo, ...payload });
    return { ok: true, codigo, fecha: new Date().toISOString(), demo: true };
  };

  const send = async (payload) => {
    if (!CONFIG.API_URL) return sendDemo(payload);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONFIG.TIMEOUT_MS);
    try {
      const res = await fetch(CONFIG.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
        signal: controller.signal,
        redirect: 'follow'
      });
      if (!res.ok) throw new Error(`El servidor respondió con estado ${res.status}.`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'No se pudo registrar la inscripción.');
      return data;
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('El servidor tardó demasiado en responder. Verifique su conexión e intente nuevamente.');
      if (err instanceof TypeError) throw new Error('No se pudo conectar con el servidor. Verifique su conexión a Internet.');
      throw err;
    } finally {
      clearTimeout(timer);
    }
  };
  return { send };
})();

/* --------------------------------------------------------------------------
   UI — estados visuales del formulario
   -------------------------------------------------------------------------- */
const UI = (() => {
  const $ = (id) => document.getElementById(id);

  const setLoading = (loading) => {
    const btn = $('btnEnviar');
    btn.disabled = loading;
    btn.setAttribute('aria-busy', String(loading));
    btn.querySelector('.btn-label').classList.toggle('d-none', loading);
    btn.querySelector('.btn-loading').classList.toggle('d-none', !loading);
  };

  const hideAlert = () => $('formAlert').classList.add('d-none');

  /** Muestra un aviso (danger/warning) con lista opcional de detalles. */
  const showAlert = (type, title, items = []) => {
    const box = $('formAlert');
    box.className = `alert alert-${type}`;
    box.innerHTML = '';
    const strong = document.createElement('strong');
    strong.innerHTML = `<i class="bi bi-exclamation-octagon-fill me-2" aria-hidden="true"></i>`;
    strong.append(title);
    box.append(strong);
    if (items.length) {
      const ul = document.createElement('ul');
      items.forEach((t) => { const li = document.createElement('li'); li.textContent = t; ul.append(li); });
      box.append(ul);
    }
    box.focus({ preventScroll: true });
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  /** Resume errores de validación y lleva el foco al primer campo inválido. */
  const showValidationErrors = (invalid) => {
    const unique = [...new Set(invalid)];
    const labels = unique.slice(0, 6).map((el) => {
      const card = el.closest('[data-member]');
      const prefix = card ? `${card.querySelector('[data-member-label]').textContent} – ` : '';
      const label = document.querySelector(`label[for="${el.id}"]`);
      const name = label ? label.textContent.replace('*', '').trim() : 'Campo';
      return `${prefix}${name}`;
    });
    if (unique.length > 6) labels.push(`y ${unique.length - 6} campo(s) más.`);
    showAlert('danger', `Revise ${unique.length} campo(s) antes de enviar:`, labels);
    setTimeout(() => unique[0].focus({ preventScroll: false }), 400);
  };

  const showSuccess = (payload, result) => {
    $('okEquipo').textContent = payload.equipo.nombre;
    $('okInstitucion').textContent = payload.institucion.nombre;
    $('okCodigo').textContent = result.codigo || '—';
    $('okFecha').textContent = Utils.formatDate(new Date(result.fecha || Date.now()), true);
    $('okDemo').classList.toggle('d-none', !result.demo);

    hideAlert();
    $('formInscripcion').classList.add('d-none');
    const panel = $('confirmacion');
    panel.classList.remove('d-none');
    panel.focus({ preventScroll: true });
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const resetForm = () => {
    const form = $('formInscripcion');
    form.reset();
    form.querySelectorAll('.is-valid, .is-invalid').forEach((el) => el.classList.remove('is-valid', 'is-invalid'));
    Members.reset();
    $('confirmacion').classList.add('d-none');
    form.classList.remove('d-none');
    hideAlert();
    $('institucion').focus({ preventScroll: true });
    $('inscripcion').scrollIntoView({ behavior: 'smooth' });
  };

  /** Aplica los datos de contacto de CONFIG a todos los enlaces marcados. */
  const applyContact = () => {
    document.querySelectorAll('[data-contact="email"]').forEach((a) => {
      a.href = `mailto:${CONFIG.CONTACTO.email}`; a.textContent = CONFIG.CONTACTO.email;
    });
    document.querySelectorAll('[data-contact="phone"]').forEach((a) => {
      a.href = `tel:${CONFIG.CONTACTO.telefono}`; a.textContent = CONFIG.CONTACTO.telefonoVisible;
    });
  };

  return { setLoading, showAlert, hideAlert, showValidationErrors, showSuccess, resetForm, applyContact };
})();

/* --------------------------------------------------------------------------
   App — arranque
   -------------------------------------------------------------------------- */
const App = (() => {
  let sending = false;

  const onSubmit = async (e) => {
    e.preventDefault();
    if (sending) return; // evita doble envío
    const form = e.currentTarget;
    UI.hideAlert();

    const invalid = Validator.validateForm(form);
    if (invalid.length) { UI.showValidationErrors(invalid); return; }

    const payload = Serializer.build(form);
    sending = true;
    UI.setLoading(true);
    try {
      const result = await Api.send(payload);
      UI.showSuccess(payload, result);
    } catch (err) {
      UI.showAlert('danger', err.message || 'Ocurrió un error inesperado. Intente nuevamente.');
    } finally {
      sending = false;
      UI.setLoading(false);
    }
  };

  /** Cierra el menú móvil al elegir una sección. */
  const bindNav = () => {
    const menu = document.getElementById('menu');
    menu.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => {
      if (menu.classList.contains('show') && window.bootstrap) bootstrap.Collapse.getOrCreateInstance(menu).hide();
    }));
  };

  const init = () => {
    const form = document.getElementById('formInscripcion');
    Members.init();
    Validator.bindLive(form);
    form.addEventListener('submit', onSubmit);
    document.getElementById('btnNuevaInscripcion').addEventListener('click', UI.resetForm);
    document.getElementById('btnImprimir').addEventListener('click', () => window.print());
    document.getElementById('anioActual').textContent = new Date().getFullYear();
    UI.applyContact();
    bindNav();
    Normativa.init();

    if (!CONFIG.API_URL) {
      console.warn('[MAT FUSION] CONFIG.API_URL está vacío: el formulario funciona en MODO DEMOSTRACIÓN. Consulte README.md para conectar Google Sheets.');
    }
  };

  return { init };
})();

document.addEventListener('DOMContentLoaded', App.init);
