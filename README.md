# Mis Horas

Aplicación web local para registrar las horas de trabajo, consultar objetivos y extras, guardar adjuntos y exportar copias de seguridad cifradas.

No tiene backend, no sincroniza datos y no envía información a ningún servidor. Todo se guarda en el almacenamiento del navegador mediante IndexedDB. La app funciona sin conexión una vez instalada o cargada, y está pensada para usarse como PWA en el móvil, especialmente en iPhone.

## Características

- Vista semanal compacta en **Inicio**, con los siete días y una hoja por día para editar el estado, los tramos, los adjuntos y la nota.
- Registro de tramos de trabajo por día, con hora de inicio, fin, descanso y cuenta. Los cambios del día se confirman juntos con **Guardar día**.
- Varias cuentas con color, archivo y totales por cuenta.
- Objetivo semanal global, con horas distintas para cada día de la semana.
- Excepciones de objetivo para fechas concretas.
- Cálculo de horas extra semanales: `max(0, horas de la semana − objetivo de la semana)`.
- Exceso diario informativo cuando un día supera su objetivo, sin alterar el cálculo semanal del extra.
- Resumen semanal, mensual y anual, con desglose por cuenta.
- Calendario mensual con indicadores de horas, ausencias y adjuntos.
- Estados de día informativos: trabajo, vacaciones, festivo y baja. Un día marcado como ausencia no admite tramos y no altera los totales.
- Notas por día.
- Adjuntos de imágenes y PDF, con miniaturas y límites de tamaño.
- Compresión de imágenes y optimización de PDF (sin pérdida cuando es posible, con rasterización como alternativa).
- Copias de seguridad cifradas con contraseña en formato `.mhbackup`.
- Tema claro, oscuro o automático.
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

- IndexedDB guarda cuentas, tramos, días, ajustes, metadatos de adjuntos y los archivos completos.
- Borrar los datos del sitio, desinstalar la app o limpiar el almacenamiento del navegador elimina todo.
- iOS puede liberar almacenamiento del sitio si el dispositivo tiene poco espacio. Por eso conviene exportar copias con frecuencia.
- Safari y la app instalada pueden usar almacenes distintos. Usa siempre el mismo contexto (preferiblemente la app instalada) y exporta las copias desde ahí.
- No hay sincronización entre dispositivos ni copia automática en la nube.

### Exportar e importar

En **Ajustes → Copias de seguridad**:

- **Exportar copia cifrada** genera un archivo `.mhbackup`.
- La copia se cifra con una contraseña elegida por ti.
- **Importar copia cifrada** reemplaza todos los datos actuales por los de la copia. No fusiona.
- La contraseña no se guarda en ningún sitio. Si se pierde, la copia no se puede recuperar.

Formato de seguridad de las copias:

- Contraseña derivada con PBKDF2-SHA-256 y 600.000 iteraciones.
- Cifrado AES-256-GCM por bloques de 4 MB, con IV único y datos autenticados adicionales.
- Cabecera `MHBK1` y metadatos necesarios para reconstruir la base de datos.
- Una contraseña incorrecta o un archivo alterado se detectan al importar.

## Adjuntos

- Se admiten imágenes JPG, PNG, WebP, HEIC/HEIF y archivos PDF.
- Tamaño máximo de entrada: 25 MB por archivo.
- Tamaño máximo guardado: 10 MB por archivo.
- Límite total: 100 MB de adjuntos.
- Las imágenes se recomprimen y se guardan con una miniatura separada.
- Los PDF con texto suficiente se optimizan sin pérdida cuando el resultado es más pequeño; los PDF sin texto se rasterizan si así se reduce el tamaño.
- Un PDF protegido con contraseña o dañado se rechaza.

Los adjuntos pertenecen al día, no a un tramo concreto. Se añaden desde la hoja del día en **Inicio** y se pueden previsualizar, descargar, compartir y eliminar allí mismo. Las altas y bajas de adjuntos quedan pendientes hasta pulsar **Guardar día**; si se cancela la hoja, se descartan. Si recargas o cierras la app antes de guardar, los adjuntos pendientes se pierden.

## Cálculos

- Los tramos se guardan en minutos y pueden cruzar la medianoche.
- El objetivo diario se toma de las horas configuradas para ese día de la semana o de una excepción de fecha.
- El objetivo semanal es la suma de los objetivos de los días de la semana.
- Las horas extra de una semana son las horas trabajadas que superan el objetivo semanal, nunca negativas.
- El exceso de un día sobre su objetivo se muestra como información en **Inicio**, pero no se suma como extra si la semana no supera su objetivo global.
- En los resúmenes mensual y anual, las horas extra se suman por semanas cuyo primer día cae dentro del periodo.
- Las ausencias son informativas: no restan horas ni cambian el objetivo.

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
