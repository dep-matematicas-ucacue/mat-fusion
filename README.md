# MAT FUSION · Inscripción de equipos

Landing page institucional de inscripción al concurso matemático **MAT FUSION**.
Organiza el Departamento de Matemáticas de la Facultad de Informática, Ciencias de la Computación e Innovación Tecnológica de la **Universidad Católica de Cuenca**.

**Costo de operación: 0 USD.** No se paga dominio, hosting, servidor, base de datos ni licencias.

---

## Arquitectura

```
 Navegador (PC / tablet / móvil)
        │  HTML5 + CSS3 + Bootstrap 5 + JS vanilla
        ▼
 GitHub Pages / Netlify / Vercel      ← hosting estático gratuito + HTTPS
        │  fetch POST (JSON)
        ▼
 Google Apps Script (Web App)         ← validación en servidor, códigos, correo
        │
        ▼
 Google Sheets                        ← base de datos persistente
        └─ Exportación: Archivo → Descargar → Excel (.xlsx) / CSV
```

| Capa | Herramienta | Costo | Límite gratuito |
|---|---|---|---|
| Frontend | GitHub Pages / Netlify / Vercel | 0 | Más que suficiente para un concurso |
| Backend | Google Apps Script | 0 | ~20 000 ejecuciones/día |
| Base de datos | Google Sheets | 0 | 10 millones de celdas |
| Correo de confirmación | MailApp | 0 | 100/día (Gmail) · 1 500/día (Workspace) |

## Estructura

```
mat-fusion/
├── index.html                      Página (HTML semántico)
├── styles.css                      Estilos con la identidad UCACUE
├── script.js                       Lógica modular (CONFIG al inicio)
├── assets/img/logo-ucacue.png      Logo institucional
├── docs/normativa-mat-fusion-2026.pdf   ← REEMPLAZAR por la normativa oficial
└── backend/Code.gs                 Código de Google Apps Script
```

---

## Paso 1: Probar localmente

```bash
cd mat-fusion
python -m http.server 8000
# abrir http://localhost:8000
```

Si `CONFIG.API_URL` está vacío, el formulario funciona en **modo demostración**: valida todo, muestra la confirmación y guarda el registro solo en el navegador. La confirmación lo indica con un aviso amarillo.

## Paso 2: Backend (Google Sheets + Apps Script), unos 5 minutos

1. Con la cuenta institucional del departamento, cree una hoja nueva en <https://sheets.new> y llámela *MAT FUSION – Inscripciones 2026*.
2. Abra el menú **Extensiones → Apps Script**.
3. Borre el contenido de `Código.gs`, pegue **todo** el archivo `backend/Code.gs` y guarde.
4. En la parte superior del editor, seleccione la función `prepararHojas` y pulse **Ejecutar**. Autorice los permisos cuando se le pidan. Se crearán las hojas *Inscripciones* y *Participantes*.
5. Pulse **Implementar → Nueva implementación**:
   - Tipo: **Aplicación web**
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier usuario**
6. Copie la URL que termina en `/exec`.
7. Pegue esa URL en `script.js`:
   ```js
   API_URL: 'https://script.google.com/macros/s/XXXXXXXX/exec',
   ```
8. Para comprobarlo, abra la URL `/exec` en el navegador. Debe responder `{"ok":true,...}`.

> Si más adelante modifica `Code.gs`, use **Implementar → Gestionar implementaciones → Editar → Nueva versión**. Así la URL no cambia.

### Ajustes del backend (al inicio de `Code.gs`)
- `INSCRIPCIONES_ABIERTAS: false` cierra el registro.
- `ENVIAR_CORREO_CONFIRMACION` activa o desactiva el correo al tutor.
- `CORREO_ORGANIZACION` recibe una copia oculta de cada inscripción.

## Paso 3: Publicar gratis

**GitHub Pages:** cree un repositorio y suba el contenido de `mat-fusion/`. Luego vaya a **Settings → Pages → Deploy from branch → main / (root)**. La URL será `https://<usuario>.github.io/<repo>/`.

**Netlify:** entre a <https://app.netlify.com/drop> y arrastre la carpeta `mat-fusion`.

**Vercel:** ejecute `npx vercel` dentro de la carpeta, o importe el repositorio en vercel.com. No se necesita configuración de build.

---

## Tareas de los organizadores

### Consultar y exportar inscripciones
- Abra la hoja de Google. *Inscripciones* tiene una fila por equipo y *Participantes* una fila por persona.
- Para exportar, use **Archivo → Descargar → Microsoft Excel (.xlsx)** o **Valores separados por comas (.csv)**.
- El menú **MAT FUSION** de la hoja permite ver un resumen o hacer un registro de prueba.
- Para compartir con otros organizadores, use el botón **Compartir** de la hoja, con permiso de lector o editor.

### Actualizar la normativa
Reemplace `docs/normativa-mat-fusion-2026.pdf` por el PDF oficial, **con el mismo nombre de archivo**, y vuelva a publicar. No hay que tocar nada más: el sitio lee el tamaño y la fecha de actualización directamente del servidor. El archivo actual es solo un **documento de ejemplo**.

### Editar textos del evento
La fecha, el lugar, la modalidad y las categorías están en `index.html`, sección `<!-- 3. INFORMACIÓN DEL EVENTO -->`. La fecha figura como **"Por confirmar"**.

### Editar límites, niveles o contacto
Todo está en el bloque `CONFIG` al inicio de `script.js`. Si cambia los límites o los niveles, cámbielos también en `CFG` de `Code.gs`.

---

## Validaciones

| Regla | Navegador | Servidor |
|---|---|---|
| Campos obligatorios y vacíos | ✔ | ✔ |
| Formato de correo | ✔ | ✔ |
| Teléfono (7 a 15 dígitos) | ✔ | ✔ |
| Longitud máxima | ✔ | ✔ |
| Nombre y apellido (solo letras) | ✔ | |
| Exactamente 3 titulares; máximo 1 suplente | ✔ | ✔ |
| Suplente o tutor suplente parcialmente lleno → todos sus campos obligatorios | ✔ | ✔ |
| Correos de estudiantes repetidos | ✔ | ✔ |
| Aceptación de normativa | ✔ | ✔ |
| Equipo duplicado (misma institución y nombre) | | ✔ |
| Anti-spam (campo trampa) | ✔ | ✔ |
| Inyección de fórmulas en Excel/Sheets | | ✔ |
| Envíos simultáneos (LockService) | | ✔ |

## Migración futura (React / Next.js / NestJS / PostgreSQL)

- **Interfaz:** cada bloque de `index.html` es un componente: `Hero`, `QueEs`, `Evento`, `NormativaCard`, `FormInscripcion`, `MemberCard` (el `<template>`) y `Footer`. `styles.css` usa variables CSS que se reutilizan sin cambios.
- **Lógica:** los módulos de `script.js` corresponden a hooks y servicios. `Validator` pasa a ser un DTO con `class-validator` y `Api.send` pasa a ser `POST /api/inscripciones`.
- **Contrato JSON:** `Serializer.build()` define el payload. Un backend NestJS solo tiene que aceptar el mismo JSON y cambiar `CONFIG.API_URL`.
- **Modelo de datos sugerido para PostgreSQL**, que refleja la hoja *Participantes*:
  ```sql
  CREATE TABLE inscripcion (
    id SERIAL PRIMARY KEY, codigo VARCHAR(12) UNIQUE NOT NULL,
    institucion VARCHAR(150) NOT NULL, equipo VARCHAR(60) NOT NULL,
    acepta_normativa BOOLEAN NOT NULL, creado_en TIMESTAMPTZ DEFAULT now(),
    UNIQUE (institucion, equipo)
  );
  CREATE TABLE participante (
    id SERIAL PRIMARY KEY,
    inscripcion_id INT REFERENCES inscripcion(id) ON DELETE CASCADE,
    rol VARCHAR(30) NOT NULL,  -- tutor_responsable | tutor_suplente | titular | suplente
    orden SMALLINT, nombre_completo VARCHAR(120) NOT NULL,
    correo VARCHAR(100) NOT NULL, telefono VARCHAR(20), nivel_educativo VARCHAR(20)
  );
  ```
- **Migrar los datos actuales:** descargue *Participantes* en CSV y cárguelo con `COPY` de PostgreSQL.

## Identidad visual

Los valores se tomaron del CSS del portal oficial www.ucacue.edu.ec:
- Tipografía **Poppins**
- Rojo institucional `#E20613`
- Azul marino `#112337`
- Negro corporativo `#141414` (encabezado y pie)
- Grises `#575756`, `#E7E6E6` y `#F5F5F5`
