# Mis Horas

Aplicación web local para registrar las horas de trabajo, consultar objetivos y extras, guardar adjuntos y exportar copias de seguridad cifradas.

No tiene backend, no sincroniza datos y no envía información a ningún servidor. Los datos de la app se guardan en el almacenamiento del navegador mediante IndexedDB. La app funciona sin conexión una vez instalada o cargada, y está pensada para usarse como PWA en el móvil, especialmente en iPhone.

## Características

- Vista semanal compacta en **Inicio**, con los siete días y una hoja por día para editar el estado, los tramos, los adjuntos y la nota.
- Registro de tramos de trabajo por día, con hora de inicio, fin, descanso y cuenta. Los cambios del día se confirman juntos con **Guardar día**.
- Tramos de **tiempo de médico**: se registran con su horario y cuentan como horas trabajadas y pagadas.
- Varias cuentas con color, archivo y totales por cuenta.
- Objetivo semanal global, con horas distintas para cada día de la semana.
- Cálculo de horas extra semanales: `max(0, horas de la semana − objetivo de la semana)`.
- Exceso diario informativo cuando un día supera su objetivo, sin alterar el cálculo semanal del extra.
- Resumen semanal, mensual y anual, con totales, ausencias y tiempo de médico.
- Resumen de vacaciones, asuntos propios, bajas, festivos y tiempo de médico del periodo seleccionado.
- Exportación del resumen a PDF por semana, mes o año, con detalle diario y marcas de adjuntos.
- Calendario mensual con resumen del mes, indicadores de horas, ausencias y adjuntos. Al tocar un día se muestra su resumen y se puede editar sin salir del calendario.
- Estados de día: trabajo, vacaciones, asunto propio, festivo y baja. Vacaciones, asuntos propios, festivos y bajas reducen el objetivo diario y se distinguen por color en los resúmenes; no se suman como horas trabajadas.
- Notas por día, editables en la hoja del día y visibles en el calendario y en la vista semanal.
- Adjuntos de imágenes y PDF, con miniaturas y límites de tamaño.
- Compresión de imágenes y optimización de PDF (sin pérdida cuando es posible, con rasterización como alternativa).
- Copias de seguridad cifradas separadas: datos en `.mhdata` y adjuntos por año en `.mhatt`. Se mantiene compatibilidad con las copias antiguas `.mhbackup`.
- Tema claro, oscuro estilo iOS con fondo negro puro o automático.
- Funcionamiento offline mediante service worker.

## Requisitos

- Node.js 22 o superior.
- npm.
- Un navegador moderno con IndexedDB y Web Crypto. En iPhone, Safari actualizado.

## Desarrollo

```bash
npm install
npm run dev
```

La app queda disponible en la dirección que indique Vite, normalmente `http://localhost:5173`.

> El service worker está desactivado en el servidor de desarrollo. Para probar la PWA y el modo offline hay que compilar y usar `npm run preview`, o desplegar la app.

## Pruebas y comprobaciones

```bash
npm test
npm run typecheck
npm run build
```

`npm run build` ejecuta primero la comprobación de tipos de TypeScript.

Las pruebas de interfaz usan Playwright y el Edge instalado en Windows:

```bash
npm run test:e2e
```

Cubren el registro de tiempo de médico, las vacaciones, la tarjeta del día en el calendario, la preparación del PDF y la exportación de datos. En otros sistemas hay que indicar un navegador con `PLAYWRIGHT_CHANNEL` o instalar Chromium con `npx playwright install chromium`.

Para probar la compilación de producción en local:

```bash
npm run build
npm run preview
```

`npm run preview` sirve la app en `http://localhost:4173` (o el puerto que se indique). En `localhost` el service worker funciona aunque no haya HTTPS.

## Compilar para GitHub Pages

El repositorio y la app se llaman `mis-horas`, por lo que la URL de Pages será:

```text
https://<usuario>.github.io/mis-horas/
```

La base de Vite debe coincidir con el nombre del repositorio:

```bash
VITE_BASE=/mis-horas/ npm run build
```

En PowerShell:

```powershell
$env:VITE_BASE='/mis-horas/'; npm run build
```

Sin `VITE_BASE`, la base es `/` y la compilación sirve para un dominio propio o para ejecutar en la raíz de un servidor.

## Despliegue en GitHub Pages

El flujo de trabajo está en `.github/workflows/deploy.yml`. Se ejecuta al hacer push a `main` y también se puede lanzar manualmente desde la pestaña **Actions**.

1. Crea un repositorio llamado `mis-horas` y sube el proyecto.
2. En GitHub, entra en **Settings → Pages**.
3. En **Build and deployment → Source**, selecciona **GitHub Actions**.
4. Haz push a `main` o ejecuta el workflow **Desplegar en GitHub Pages**.
5. Cuando termine, abre `https://<usuario>.github.io/mis-horas/`.

Si cambias el nombre del repositorio, actualiza `VITE_BASE` en `.github/workflows/deploy.yml`.

## Instalar en iPhone

1. Abre la URL de GitHub Pages en **Safari**. No uses Chrome ni la vista previa de otra app.
2. Toca el botón **Compartir**.
3. Elige **Añadir a pantalla de inicio**.
4. Abre **Mis Horas** desde el icono de la pantalla de inicio.

La instalación y el service worker requieren HTTPS; GitHub Pages lo proporciona. Al abrirla como app instalada, se muestra en modo independiente y funciona sin conexión.

## Almacenamiento y copias de seguridad

Los datos viven únicamente en el navegador y en el perfil desde el que se usa la app:

- IndexedDB guarda cuentas, tramos, días, ajustes, metadatos de adjuntos y los archivos completos. Los adjuntos restaurados solo como datos quedan marcados como archivados y no ocupan el espacio del archivo.
- Borrar los datos del sitio, desinstalar la app o limpiar el almacenamiento del navegador elimina todo.
- iOS puede liberar almacenamiento del sitio si el dispositivo tiene poco espacio. Por eso conviene exportar copias con frecuencia.
- Safari y la app instalada pueden usar almacenes distintos. Usa siempre el mismo contexto (preferiblemente la app instalada) y exporta las copias desde ahí.
- No hay sincronización entre dispositivos ni copia automática en la nube.

### Exportar e importar

En **Ajustes → Copias de seguridad** hay dos exportaciones independientes:

- **Exportar datos** genera un archivo `.mhdata` con horas, días, cuentas, ajustes y la lista de fotos. No incluye las fotos y suele pesar muy poco.
- **Exportar adjuntos de un año** genera un archivo `.mhatt` con las fotos comprimidas de ese año. Se pueden guardar varios años por separado.
- Tras crear una copia, se puede **descargar** o **compartir**. En iPhone, el menú de compartir permite guardarla en **iCloud Drive**, **Google Drive** o **Files**.
- **Restaurar copia** detecta automáticamente si el archivo es de datos, de adjuntos o una copia completa antigua `.mhbackup`.
- Al restaurar datos, se conservan las fotos que ya existan con el mismo identificador. Las que falten quedan **archivadas** hasta restaurar su archivo de adjuntos.
- Al restaurar un archivo de adjuntos, las fotos se escriben una a una y se verifica su integridad. Se puede cancelar sin perder las ya restauradas.
- Las copias antiguas `.mhbackup` siguen siendo compatibles, pero se restauran completas y pueden consumir mucha memoria si son grandes.

Formato de seguridad de las copias:

- Contraseña derivada con PBKDF2-SHA-256 y 600.000 iteraciones.
- Cifrado AES-256-GCM por bloques de 4 MB, con IV único y datos autenticados adicionales.
- Las copias nuevas usan la cabecera `MHBK2`; las antiguas usan `MHBK1`.
- Una contraseña incorrecta o un archivo alterado se detectan al restaurar.
- La contraseña no se guarda en ningún sitio. Si se pierde, la copia no se puede recuperar.

## Adjuntos

- Se admiten imágenes JPG, PNG, WebP, HEIC/HEIF y archivos PDF.
- Tamaño máximo de entrada: 25 MB por archivo.
- Tamaño máximo guardado: 10 MB por archivo.
- No hay un límite total fijo de adjuntos en la app; el espacio disponible depende de la cuota del navegador y del dispositivo.
- Todas las imágenes se optimizan, independientemente de su tamaño, intentando reducir al menos un 50 % y con un objetivo máximo de 800 KB. Se prueba WebP y, si no alcanza el objetivo, JPEG; si no es posible llegar a la mitad, se usa la versión más pequeña que mejore el original. Se conserva el original si ninguna lo reduce y se guarda una miniatura separada.
- Los PDF con texto suficiente se optimizan sin pérdida cuando el resultado es más pequeño; los PDF sin texto se rasterizan si así se reduce el tamaño.
- Un PDF protegido con contraseña o dañado se rechaza.

Los adjuntos pertenecen al día, no a un tramo concreto. Se añaden desde la hoja del día en **Inicio** y se pueden previsualizar, descargar, compartir y eliminar allí mismo. Las altas y bajas de adjuntos quedan pendientes hasta pulsar **Guardar día**; si se cancela la hoja, se descartan. Si recargas o cierras la app antes de guardar, los adjuntos pendientes se pierden.

## Informes PDF

En **Resumen**, el botón **PDF** permite elegir semana, mes o año. La semana parte de la que está seleccionada y se puede cambiar con las flechas; el mes y el año también se eligen con flechas.

- Semana y mes: detalle diario, ausencias y tiempo de médico.
- Año: resumen mes a mes.
- El clip indica que ese día tiene adjuntos; las fotos no se incluyen en el PDF.
- El archivo se genera en el dispositivo y se comparte o descarga desde el menú del sistema.

## Cálculos

- Los tramos se guardan en minutos y pueden cruzar la medianoche.
- Los tramos de médico suman como horas trabajadas y pagadas; se identifican con la etiqueta «Médico».
- El objetivo diario se toma de las horas configuradas para ese día de la semana.
- El objetivo semanal y mensual suma los objetivos diarios ajustados: los días marcados como vacaciones, asunto propio, festivo o baja no tienen objetivo que cumplir.
- Las horas extra de una semana son las horas trabajadas que superan el objetivo semanal, nunca negativas.
- El exceso de un día sobre su objetivo se muestra como información en **Inicio**, pero no se suma como extra si la semana no supera su objetivo global.
- Los periodos mensual y anual usan sus fechas naturales completas. En los resúmenes, las semanas que cruzan el límite del periodo solo cuentan los días incluidos en ese periodo.
- Las horas justificadas de vacaciones, asuntos propios, festivos y bajas se representan por separado mediante colores, pero no se cuentan como trabajadas ni como extras.

## Estructura del proyecto

```text
src/
  attachments/   Procesado de imágenes y PDF, límites y miniaturas
  backup/        Exportación, importación y cifrado de copias
  components/    Componentes comunes de interfaz
  db/            Dexie, repositorios, validación y datos por defecto
  domain/        Fechas, duraciones, totales y cálculos
  features/      Pantallas: inicio, resumen, calendario, cuentas, ajustes
  styles/        Tokens y estilos CSS
  test/          Configuración de pruebas
public/
  icons/         Iconos de la PWA
scripts/
  generate-icons.ps1
.github/workflows/deploy.yml
```

## Privacidad

No hay analítica, cuentas de usuario, publicidad ni llamadas a servicios externos. Los datos y los adjuntos no salen del dispositivo salvo que tú exportes una copia o compartas un archivo manualmente.

## Limitaciones conocidas

- Es una app de un solo usuario y un solo navegador/perfil.
- No hay sincronización ni resolución de conflictos.
- El almacenamiento del navegador puede borrarse desde los ajustes del sistema; las copias son la única recuperación.
- La rasterización de PDF convierte las páginas en imágenes: el texto deja de ser seleccionable en esos PDF.
- El modo privado o la navegación con almacenamiento restringido pueden impedir el funcionamiento normal.

## Versión

1.0.0
