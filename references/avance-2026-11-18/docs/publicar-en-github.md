# Trabajar entre dos compañeros con GitHub

La aplicación se ejecuta en cada computadora. GitHub guarda y comparte el código y los archivos de data/team/. No hace falta importar ni exportar ejemplos desde la página.

## Primera configuración

Una persona crea un repositorio de GitHub e invita a la otra como colaborador. Desde la carpeta completa del proyecto, con Git instalado y la identidad configurada, puede subir la primera versión. Sustituye la URL de ejemplo por la real:

```powershell
git init
git add .
git commit -m "Bot YinYan y bitacora del equipo"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/yinyan-workshop.git
git push -u origin main
```

El compañero debe **clonar** ese repositorio, en lugar de descargar un ZIP para trabajar por turnos:

```powershell
git clone https://github.com/TU-USUARIO/yinyan-workshop.git
cd yinyan-workshop
```

Cada computadora necesita un servidor Node.js o Python. Para entrenar, necesita Python con las dependencias de requirements-lock.txt. Si tienes la copia portable, puedes copiar runtime/ en la carpeta clonada; esa carpeta está excluida de Git. La instalación alternativa está descrita en docs/EJECUTAR-EN-LOCAL.md.

La carpeta actual todavía no se ha publicado en una cuenta: estos comandos preparan ese paso cuando el equipo tenga el repositorio y sus permisos.

## En cada turno

Por ejemplo: martes trabaja A, miércoles trabaja B, jueves vuelve A. Los días se registran al guardar; no se rellenan ni se retroceden las fechas automáticamente.

1. Abre recibir-aportes.cmd. Ejecuta git pull --ff-only; si Git encuentra un problema, detente y revisa su mensaje. El archivo no borra ni fuerza cambios.
2. Abre iniciar.cmd. Selecciona tu identidad A/B en la página.
3. Haz consultas. En Consultas revisa errores, completa la descripción y guarda los ejemplos con su categoría correcta.
4. Entrena y prueba el modelo en tu copia.
5. Abre subir-aportes.cmd. El archivo prepara y confirma únicamente data/team/ y luego ejecuta git push. Los cambios de código se confirman por separado.

Si Git solicita iniciar sesión, utiliza su mecanismo normal de autenticación. Los registros y commits locales permanecen guardados si falla el envío; al corregir el acceso puedes volver a abrir subir-aportes.cmd.

## Qué viaja y qué queda local

Cada consulta y cada ejemplo está en un archivo distinto dentro de data/team/alumno-a/ o data/team/alumno-b/. Los registros tienen identificador único, autor e instante de creación. Las revisiones enlazan con la consulta que las originó. Una retirada de ejemplo queda como otro registro y no borra la conversación.

La fecha de cada consulta la asigna el servidor cuando la guarda. created_at está en UTC y la página la muestra en Ciudad de México. El selector A/B permite atribuir las aportaciones, pero no sustituye la autoría del commit ni un inicio de sesión.

Los datos iniciales de data/simulation.json están marcados como simulados. Las aportaciones nuevas de data/team/ llevan tiempos reales. Los ejemplos antiguos sin fecha no se convierten en aportaciones fechadas retroactivamente.

Los modelos personalizados y el estado del servidor de data/local/ no viajan por Git. Después de recibir ejemplos del compañero, entrena tu copia para producir el modelo actualizado. Si dos personas asignaron categorías distintas a la misma frase, revisen esa contradicción; el entrenamiento la detecta y conserva el modelo anterior hasta corregirla.

## Comprobar el intercambio

A hace una consulta y la sube. B recibe cambios y debe verla en Consultas con la misma fecha y autor. B la revisa y guarda un ejemplo: el nuevo archivo tendrá su propia fecha y source_query_id apuntará a la consulta de A. Después de subir y recibir, A verá esa revisión y podrá entrenar con ella.

Los archivos de data/team/ formarán parte del repositorio que compartan. No escriban datos que no quieran incluir en esa entrega.

## Diferencia con GitHub Pages

GitHub Pages publica archivos estáticos y no ejecuta el servidor Node/Python necesario para guardar consultas y reentrenar. Esta versión se comparte mediante GitHub y se ejecuta localmente. Véase la [documentación oficial de GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site).

