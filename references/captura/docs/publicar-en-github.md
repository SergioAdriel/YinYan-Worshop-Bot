# Compartir el proyecto y las jornadas mediante GitHub

El equipo comparte el código, las aportaciones de **data/team/** y las versiones de **data/training/**. Cada integrante clona el repositorio y ejecuta el servidor localmente. No hay que importar ni exportar ejemplos desde la página.

El avance se documenta al **18 de noviembre de 2026**, con entrega final prevista para el **4 de diciembre de 2026**. No se rellenan consultas o jornadas pasadas ni se cambian sus fechas.

## Integrantes y turnos

| Responsable | Función principal |
| --- | --- |
| Erick Mendoza Mendoza | Incorporar ejemplos y revisar expresiones y categorías. |
| Daniel Gibran Luciano Tellez | Organizar el dataset, revisar etiquetas y diversificar expresiones. |
| Sergio Adriel Muñoz Camarena | Desarrollo principal, diálogo, integración e interfaz. |
| Raynier Jetsahe Torres Flores | Desarrollo, entrenamiento, evaluación y verificación. |

La selección de nombre en la aplicación identifica operaciones; no es un control de acceso seguro. La autoría del commit procede de la configuración de Git de cada computadora.

## Primera configuración

Una persona crea el repositorio en GitHub e invita a los otros tres integrantes como colaboradores. Con Git instalado y su identidad configurada, puede preparar la primera versión desde la carpeta del proyecto. Sustituye la URL de ejemplo por la del repositorio real:

```powershell
git init
git add .
git commit -m "Prototipo YinYan y jornadas de entrenamiento"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/yinyan-workshop.git
git push -u origin main
```

Los demás integrantes clonan ese repositorio:

```powershell
git clone https://github.com/TU-USUARIO/yinyan-workshop.git
cd yinyan-workshop
```

Cada computadora necesita Node.js o Python para el servidor y Python con `requirements-lock.txt` para entrenar y regenerar los documentos. `runtime/` está excluido de Git; puede conservarse localmente si ya está disponible. La instalación está en [EJECUTAR-EN-LOCAL.md](EJECUTAR-EN-LOCAL.md).

Estos pasos necesitan la URL real y los permisos de la cuenta del equipo. La existencia de esta guía no significa que el proyecto ya esté publicado.

## Antes y después de cada turno

1. Abre **recibir-aportes.cmd**. Ejecuta `git pull --ff-only`. Si falla, revisa el mensaje; el ayudante no fuerza cambios ni borra registros.
2. Abre **iniciar.cmd** y selecciona tu nombre. Si recibiste una versión activa diferente, recarga la página para cargarla.
3. Erick y Daniel incorporan ejemplos pendientes, revisan diversidad y categorías y los aprueban o rechazan. Solo los aprobados entran al entrenamiento.
4. Sergio y Raynier revisan los datos, crean jornadas y comparan los dos clasificadores. Cada jornada nueva termina como provisional hasta su activación explícita, después de las comprobaciones.
5. Espera a que cualquier entrenamiento termine antes de compartir el historial. Evita editar el modelo activo desde dos computadoras a la vez.
6. Abre **subir-aportes.cmd**. Prepara y confirma únicamente **data/team/** y **data/training/** y ejecuta `git push`. Los cambios de código se confirman por separado.

**Pull recibe; push envía.** Conversar guarda primero en la copia local y no dispara un envío automático. Los registros y commits permanecen disponibles si falla el envío; corrige la conexión o los permisos y vuelve a intentar.

Los ayudantes no incluyen cambios de código ajenos que ya estuvieran preparados para otro commit. Si estás actualizando el programa, confirma expresamente esos archivos por separado y coordina su publicación con el equipo.

## Archivos que viajan

- **data/team/** conserva consultas, ejemplos y eventos de edición, aprobación, rechazo y retirada. Cada registro tiene identificador, responsable y hora real. Las revisiones de consultas incluyen `source_query_id` para mantener el enlace.
- **data/training/runs/UUID/** conserva cada jornada con su instantánea, manifiesto, modelos, vectorizadores, configuración, métricas, matrices y errores. Los pipelines y las exportaciones pertenecen al mismo entrenamiento.
- **data/training/active.json** señala la versión activa. Las activaciones dejan trazabilidad y las versiones anteriores se mantienen para consulta o recuperación.
- **data/local/** contiene cachés y estado del servidor; está excluido de Git. **runtime/** también queda local.

Los identificadores nuevos reducen conflictos entre aportaciones, pero Git no sustituye la coordinación. Las ediciones se representan con eventos y el sistema detecta revisiones obsoletas; un conflicto de categorías debe resolverse revisando el ejemplo. Un conflicto en `active.json` requiere decidir qué versión aprobada utilizar. No lo resuelvas borrando jornadas ni inventando fechas.

Las fechas `created_at` se asignan al guardar en UTC y se muestran en Ciudad de México. Pull conserva las fechas originales. Los ejemplos antiguos sin fecha original permanecen identificados como tales. La base histórica sintética conserva su metodología separada de las nuevas aportaciones.

Los archivos y los datos que confirmen formarán parte del repositorio. Revisa que las consultas no incluyan credenciales, información sensible o datos personales innecesarios para la práctica.

## Comprobar el intercambio

Erick agrega un ejemplo pendiente y lo envía. Daniel recibe los cambios y debe verlo con el mismo texto, responsable, estado y hora. Tras revisarlo y aprobarlo, envía el evento de revisión. Sergio recibe los datos, entrena y conserva una nueva jornada provisional. Después de revisar resultados y activar la versión elegida, envía el historial y el apuntador activo. Raynier recibe esos archivos y carga la misma versión aprobada al recargar la página.

Cada ejecución conserva su número e identificador, incluso si hay varias el mismo día. Un entrenamiento incompleto o fallido no debe presentarse como terminado. La prueba final reservada se utiliza mediante su procedimiento específico; no se añade al entrenamiento ni se usa para elegir modelos de manera reiterada. Consulta [FLUJO-DE-TRABAJO.md](FLUJO-DE-TRABAJO.md).

## Código compartido y ejecución local

GitHub funciona como repositorio de colaboración y entrega. La aplicación necesita su servidor Node/Python para guardar ejemplos, entrenar y consultar versiones; no requiere publicación como web pública para este flujo.
