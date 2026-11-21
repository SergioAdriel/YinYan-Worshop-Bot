# Ejecutar YinYan Workshop en tu computadora

Cada alumno A/B clona el repositorio de GitHub y ejecuta la aplicación en su propia computadora. La página se abre en el navegador y el servidor local guarda las consultas y los ejemplos en esa copia del proyecto.

`127.0.0.1` y `localhost` identifican tu propia computadora. La dirección habitual es **http://127.0.0.1:4173**. GitHub comparte los archivos; no ejecuta este servidor local.

## Preparar cada computadora

1. Instala Git y clona el repositorio que comparta el equipo. La primera configuración está en [publicar-en-github.md](publicar-en-github.md).
2. Instala Node.js 22 o Python 3.12 para ejecutar el servidor. Para entrenar necesitas Python y las dependencias del proyecto.
3. Desde la carpeta clonada, instala las dependencias de entrenamiento si todavía no están disponibles:

   ```powershell
   py -3.12 -m pip install -r requirements-lock.txt
   ```

La carpeta actual incluye intérpretes en `runtime/`, pero esa carpeta está excluida de Git. Si ya tienes ese entorno local, puedes conservarlo en tu copia clonada. `iniciar.cmd` lo utiliza antes que los intérpretes instalados en el sistema. La instalación inicial de dependencias puede necesitar internet.

## Abrir y trabajar por turnos

1. Abre **recibir-aportes.cmd** para traer los cambios que tu compañero haya subido.
2. Haz doble clic en **iniciar.cmd**.
3. Espera a que el servidor esté listo y abre la dirección que indique la consola si el navegador no aparece.
4. Selecciona **Compañero A** o **Compañero B** antes de hacer consultas. Deja abierta la consola mientras uses la página.
5. Al terminar, abre **subir-aportes.cmd** para confirmar los registros de `data/team/` y enviarlos a GitHub.

El servidor asigna fecha y hora reales al guardar cada consulta. Su archivo conserva el autor, el texto, la respuesta y `created_at` en UTC. La página muestra la hora de Ciudad de México en formato de 24 horas. Los registros se guardan por alumno en **data/team/** y mantienen su fecha original cuando el compañero los recibe.

**Pull recibe; push envía.** Las consultas se guardan primero en tu computadora: no se sincronizan automáticamente al escribir en el chat. Si falla un envío, conserva los archivos y revisa el mensaje de Git. Si la página estaba abierta cuando recibiste aportes, actualiza la pestaña Consultas para verlos.

Cierra la consola cuando termines de usar la aplicación para detener el servidor local.

## Revisar consultas y entrenar

En **Consultas**, pulsa **Usar para entrenar**, revisa el texto y selecciona la categoría correcta. En **Entrenar** también puedes agregar ejemplos manuales. Pulsa **Entrenar mi modelo** y, cuando termine, **Probar mi modelo**.

Una conversación no se convierte por sí sola en entrenamiento. El modelo usa los ejemplos iniciales y los ejemplos etiquetados del equipo. El porcentaje se calcula al entrenar y puede subir, mantenerse o bajar.

Los modelos personalizados y su estado están en **data/local/**, excluido de Git. Después de recibir ejemplos nuevos del compañero, vuelve a entrenar tu copia para usarlos. Recibir consultas sin revisar no modifica el modelo.

También puedes entrenar los ejemplos del equipo desde la terminal:

```powershell
py -3.12 -m src.simulation --custom
```

`entrenar.cmd` regenera los quince modelos de la práctica inicial. El botón de la página y el comando `--custom` entrenan con las aportaciones actuales del equipo. `notebook.cmd`, `reproducir-notebook.cmd` y `generar-reporte.cmd` conservan las herramientas del experimento anterior; su notebook y PDF son material de referencia.

## Inicio desde una terminal

Si prefieres abrir el servidor sin el archivo de Windows, ejecuta una alternativa desde la carpeta del proyecto:

```powershell
node scripts/serve.mjs --open
```

```powershell
py -3.12 scripts/serve.py --open
```

El servidor Python usa su biblioteca estándar para servir la página y guardar registros. Las dependencias de `requirements-lock.txt` se necesitan para entrenar y utilizar las herramientas del experimento. No necesitas generar `dist/` para trabajar en local.

## Conexión a internet

El chat, los registros locales y el entrenamiento funcionan sin conexión una vez preparado el entorno. Necesitas conexión para recibir o subir aportes mediante GitHub. El enlace opcional de Instagram también abre un servicio externo.

## Si no abre

| Situación | Qué hacer |
| --- | --- |
| El navegador muestra un error antes de cargar | Espera el mensaje de servidor listo y usa la dirección impresa en la consola |
| Cerraste la ventana de consola | Vuelve a abrir `iniciar.cmd` |
| Abriste `web/index.html` directamente | Cierra esa pestaña y utiliza `iniciar.cmd` |
| Falta un intérprete | Instala Node.js 22 o Python 3.12, o conserva el entorno `runtime/` que ya tengas |
| El entrenamiento no encuentra dependencias | Instala `requirements-lock.txt` en el Python que utiliza el proyecto |
| Otra aplicación ocupa el puerto | Sigue el mensaje del servidor y revisa si ya hay una instancia abierta |
| Git no puede recibir o subir cambios | Revisa la conexión, los permisos del repositorio y el mensaje de Git; los registros locales se conservan |

El repositorio del equipo debe configurarse antes del primer intercambio. Estas instrucciones no afirman que ya se haya publicado en GitHub.
