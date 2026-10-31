# Guía del usuario de MobAlt

Esta guía en: [English](USER_GUIDE.md) · [한국어](USER_GUIDE.ko.md) · [简体中文](USER_GUIDE.zh-CN.md) · [日本語](USER_GUIDE.ja.md) · [Tiếng Việt](USER_GUIDE.vi.md) · [हिन्दी](USER_GUIDE.hi.md) · [Deutsch](USER_GUIDE.de.md) · [Français](USER_GUIDE.fr.md) · [Español](USER_GUIDE.es.md) · [Português](USER_GUIDE.pt.md)

MobAlt es una mesa de trabajo al estilo de MobaXterm para macOS: un árbol de sesiones a la izquierda, terminales
en pestañas y paneles divididos en el centro, y un explorador SFTP, herramientas de red y macros en los paneles laterales.

Ver también: [Paridad de funciones con MobaXterm 26.6](MOBAXTERM_PARITY.md) — lo que MobAlt tiene, lo que le falta y lo que hace de otra manera, con la hoja de ruta.

![MobAlt con dos shells remotos lado a lado](images/hero.png)

Contenido: [Instalación](#instalación) · [Actualización](#actualización) · [Sesiones](#sesiones) · [Conexión](#conexión) ·
[Terminal](#terminal) · [Archivos (SFTP / FTP)](#archivos-sftp--ftp) · [Túneles](#túneles-reenvío-de-puertos) ·
[X11, Mosh, serie, RDP/VNC](#x11-mosh-serie-rdpvnc) · [Herramientas y macros](#herramientas-y-macros) ·
[Espacio de trabajo y ajustes](#espacio-de-trabajo-y-ajustes) · [Funciones rápidas de teclado](#funciones-rápidas-de-teclado) ·
[Datos y privacidad](#datos-y-privacidad) · [Solución de problemas](#solución-de-problemas)

## Instalación

- **Homebrew**: `brew tap Hyeongcheol-An/tap && brew trust Hyeongcheol-An/tap && brew install --cask mobalt`
  (Homebrew 7 pide confiar en un tap de terceros una sola vez; `brew upgrade --cask mobalt` actualiza después)
- **DMG**: descarga el DMG para Apple Silicon (`arm64`) o Intel (`x64`) desde
  [Releases](https://github.com/Hyeongcheol-An/MobAlt/releases) y arrastra MobAlt a Aplicaciones.

Las versiones publicadas están firmadas y notarizadas. Requisitos: macOS 13 o posterior. Ayudantes opcionales:
[XQuartz](https://www.xquartz.org/) para el reenvío de X11, `brew install mosh` para las sesiones Mosh,
Windows App para RDP.

MobAlt comprueba al iniciar si hay una versión más reciente en GitHub Releases y la ofrece en un diálogo; nada se
descarga ni se instala sin tu confirmación. Consulta [Actualización](#actualización).

## Actualización

Hay tres caminos hacia una versión nueva; todos terminan con el paquete nuevo en `/Applications/MobAlt.app`:

- **Actualizador integrado**: MobAlt consulta GitHub Releases al iniciar (se desactiva en Ajustes → Actualizaciones) y
  Ayuda → Buscar actualizaciones… o «Buscar ahora» en Ajustes → Actualizaciones lanzan la comprobación a mano. Una
  versión más reciente se ofrece en un diálogo, se descarga solo cuando tú lo dices y se instala al salir, o de
  inmediato con «Reiniciar ahora».
- **Homebrew**: `brew upgrade --cask mobalt` reemplaza la app en Aplicaciones.
- **DMG**: descarga el DMG nuevo desde [Releases](https://github.com/Hyeongcheol-An/MobAlt/releases) y arrastra
  MobAlt a Aplicaciones reemplazando el anterior.

El actualizador integrado y Homebrew se llevan bien. Con «Buscar actualizaciones al iniciar» activado (Ajustes →
Actualizaciones) MobAlt se mantiene al día por sí solo, y `brew upgrade --cask mobalt` sigue siendo seguro en cualquier
momento: si la app ya se actualizó sola, Homebrew simplemente reinstala la versión que ya está. Como el cask declara
`auto_updates`, un `brew upgrade` a secas (sin nombrar el cask) se salta MobAlt a menos que añadas `--greedy`; nombra el
cask, o añade `--greedy`, cuando quieras que sea Homebrew quien actualice.

Actualizar con MobAlt en marcha no da problemas, incluso desde uno de los propios terminales de MobAlt. La app en
ejecución sigue con la versión antigua en memoria, detecta el paquete nuevo en el disco (en menos de un minuto, o en
cuanto la ventana vuelve a tener el foco) y muestra un aviso sobre las pestañas: *MobAlt 0.11.0 está instalada en el
disco; estás usando 0.10.1. Reinicia para usarla.* **Reiniciar** pregunta primero por las conexiones SSH/FTP abiertas
(como hace ⌘Q), guarda el espacio de trabajo e inicia la versión nueva; tus pestañas vuelven gracias a la restauración
del espacio de trabajo. **Después** oculta el aviso hasta que aparezca otra versión más. Si el paquete nuevo ya está en
el disco cuando se ejecuta el actualizador, no se descarga nada otra vez: la comprobación informa de que «0.11.0 ya está
instalada en el disco; reinicia para usarla» y ofrece el mismo reinicio.

## Sesiones

El panel **Sesiones** es tu árbol de marcadores. Crea una sesión con `＋ Sesión` (⌘N), elige un tipo y rellena la
pestaña Básico. Haz doble clic en una sesión para conectar; el clic derecho abre el menú contextual (abrir, dividir a la
derecha/hacia abajo, editar, duplicar, eliminar, iniciar un túnel, nueva sesión en esta carpeta).

![Editor de sesiones](images/session-editor.png)

| Tipo | Qué hace |
|---|---|
| SSH | Terminal por SSH con explorador SFTP, túneles, X11 y reenvío del agente |
| Mosh | Terminal itinerante mediante el cliente `mosh` (arrancado por SSH) |
| Local | Tu shell de inicio de sesión de macOS (zsh/bash) con seguimiento de carpeta |
| Telnet | Telnet clásico con negociación NAWS/TTYPE |
| Serial | Consola USB-serie (baudios, trama, control de flujo, eco local) |
| FTP | Explorador de archivos FTP / FTPS (TLS explícito) en el panel Sftp |
| RDP / VNC | Delega en Windows App o en Compartir Pantalla de macOS |

**Carpetas**: el botón de carpeta en la cabecera del panel (Nueva carpeta) crea una carpeta; arrastra sesiones y
carpetas para moverlas (suéltalas en la zona vacía para llevarlas a la raíz). El menú contextual de una carpeta puede
abrir todas las sesiones que contiene en una cuadrícula o en pestañas.

**Iconos y colores**: elige un emoji y un color en el editor. Se muestran en la fila, la pestaña y la cabecera del
panel, así que una sesión roja de «producción» no se confunde con una verde de «staging».

**Importar / exportar**: el pie del panel importa `~/.ssh/config` (hosts, usuarios, puertos, claves, ProxyJump) y un
`MobaXterm.ini` de MobaXterm (marcadores). Exporta e importa todas las sesiones como JSON desde el menú contextual del
árbol. El archivo JSON contiene todas las sesiones y carpetas, pero nunca una contraseña ni una frase de contraseña:
esas se quedan en el almacén cifrado de MobAlt en este Mac, y el archivo solo anota que había una guardada
(`hasPassword`), de modo que una sesión importada en otro Mac la pide en su primera conexión. La importación se fusiona
con lo que ya tienes: una sesión cuyo `id` coincide con una existente se reemplaza por la versión del archivo (una
contraseña guardada aquí para ella se conserva), y todas las demás se añaden; una entrada escrita a mano sin `id` se
añade siempre, y una `password` escrita en el archivo se toma y se guarda cifrada; las carpetas se añaden y nada se
elimina, así que importar dos veces el mismo archivo no cambia nada. Las entradas sin nombre, con un tipo desconocido
o con un puerto incorrecto se omiten y se cuentan en el aviso; un archivo que no es un archivo de sesiones de MobAlt se
rechaza indicando el motivo. `~/.ssh/config` se salta los hosts que ya tienes (misma carpeta y nombre). Los marcadores
de MobaXterm van a una carpeta `MobaXterm`; uno importado antes (misma carpeta, nombre y host) se actualiza en su
sitio: host, puerto, usuario, X11 y compresión siguen al `.ini`, mientras que su contraseña guardada, icono, color,
túneles y una ruta de clave que hayas puesto se conservan, de modo que importar dos veces el mismo `.ini` tampoco
cambia nada.

**Comandos de inicio** (pestaña Terminal): un comando por línea, escrito en el terminal en cuanto está listo. En SSH,
justo después del inicio de sesión; en los shells locales, justo después de que aparezca el prompt. Ejemplo: una
sesión local con *Carpeta inicial* apuntando a un proyecto y `claude --resume <id>` como comando. La *Carpeta inicial*
de una sesión local admite una ruta escrita completa o elegida con su botón Seleccionar…, que abre un diálogo de
carpetas y deja el campo como estaba si cancelas.

## Conexión

- **Conexión rápida**: escribe `usuario@host[:puerto]` en la barra de herramientas y pulsa Intro. Los prefijos eligen
  el tipo: `ssh://`, `mosh://`, `telnet://`, `ftp://`, `ftps://`, `rdp://`, `vnc://`. Si coincide con una sesión
  guardada, se usa esa.
- **Autenticación**: *Automática* prueba una clave configurada, la contraseña guardada, el agente SSH y las claves por
  omisión de `~/.ssh` antes de preguntar. Elige *Contraseña*, *Clave privada* o *Agente SSH* para restringirla. Las
  claves con frase de contraseña la piden una vez; marca «Guardar en la sesión» para conservarla.
- **Claves del host**: la primera conexión muestra la huella (SHA256 y MD5). Al aceptar, la clave se guarda; una clave
  cambiada se señala de forma bien visible y nunca se acepta en silencio.
- **Claves SSH**: Sesión → Generar clave SSH… (también en el panel Herramientas, y *Generar…* junto al campo de clave
  privada del editor de sesiones) ejecuta el `ssh-keygen` de macOS por ti: Ed25519 (por omisión), RSA 4096 o ECDSA, un
  comentario, una frase de contraseña opcional con indicador de fortaleza y el archivo (por omisión
  `~/.ssh/id_<tipo>`, numerado si ese nombre ya está ocupado; `~/.ssh` se crea con permisos privados si no existe, y los
  archivos quedan en 0600 / 0644). Muestra la clave pública con un botón Copiar y la huella. «Añadir a ssh-agent»
  ejecuta `ssh-add --apple-use-keychain`; «Instalar en un servidor…» se conecta a una sesión guardada con su
  autenticación habitual y añade la clave pública a su `~/.ssh/authorized_keys` como `ssh-copy-id` (nunca dos veces).
  Desde el editor, *Usar en esta sesión* rellena el campo de la clave.
- **Algoritmos**: SSH avanzado → Algoritmos enumera lo que la sesión ofrece para intercambio de claves, clave del host,
  cifrados y MAC, prerrellenado con los valores integrados; edita una lista para restringirla o reordenarla (los nombres
  desconocidos se rechazan en el acto), *Restablecer por omisión* devuelve las listas a su estado original y «Algoritmos
  antiguos (dispositivos viejos)» es un preajuste que añade los intercambios de claves SHA-1, los cifrados CBC y las
  claves de host DSA que los aparatos antiguos todavía necesitan. Solo se guardan las listas que difieren de las de
  por omisión.
- **Hosts de salto**: SSH avanzado → Host de salto elige otra sesión guardada como bastión (ProxyJump).
- **Cuando falla**: el terminal explica qué ha pasado, por ejemplo
  `autenticación fallida — el servidor acepta: publickey; se probó: ~/.ssh/id_ed25519`, o una pista de que nada
  respondió en el puerto. Consulta [Solución de problemas](#solución-de-problemas).

## Terminal

![Cuadrícula dividida](images/split-grid.png)

- **Pestañas**: cada sesión abre una pestaña. Arrastra las pestañas para reordenarlas, doble clic para renombrar,
  clic central para cerrar. Las pestañas locales llevan el nombre de su carpeta actual. El menú contextual de la
  pestaña (clic derecho, o ⇧F10 en la pestaña con el foco) renombra, duplica, colorea, divide y cierra: *Cerrar las
  otras*, *Cerrar pestañas a la izquierda*, *Cerrar pestañas a la derecha* y *Cerrar todas* cierran varias pestañas de
  una vez y hacen una sola pregunta que cuenta todas las conexiones activas entre ellas («¿Cerrar 3 pestañas con 2
  conexiones activas?»).
- **Pestañas fijadas** (*Fijar pestaña* en el menú, ⇧⌘P): una pestaña fijada se desplaza a la izquierda de la tira, en
  el orden en que se fijaron, y se reduce a su punto de estado, su icono y un título corto, con una pequeña chincheta
  donde estaba la ✕. Los cierres masivos de arriba y el clic central no tocan las pestañas fijadas (⌘W, *Cerrar* en el
  menú y ⌫ en la pestaña con el foco siguen cerrando una), y una pestaña fijada no se puede arrastrar más allá de una
  sin fijar. Las chinchetas forman parte del espacio de trabajo, así que vuelven tras un reinicio. *Desfijar pestaña*
  coloca la pestaña justo después del bloque de fijadas.
- **Separar una pestaña en su propia ventana** (*Separar en una ventana nueva* en el menú de la pestaña, ⌥⌘N, o el
  menú Sesión): la pestaña pasa a una segunda ventana de MobAlt y conserva sus terminales; nada se reconecta ni se
  reinicia. La ventana nueva vuelve a dibujar los últimos 256 KB de la salida de cada terminal y continúa desde ahí; una
  pestaña dividida se traslada con todos sus paneles. La ventana tiene la misma barra de herramientas, los mismos menús
  y las mismas funciones rápidas, y arranca con la barra lateral contraída (⌘B la muestra ahí); MultiExec es por
  ventana. Una segunda ventana separada se abre desplazada respecto a la primera, para que ninguna tape a otra. Cerrar
  una ventana separada devuelve sus pestañas a la ventana principal con las sesiones aún en marcha; nunca termina una
  sesión. Cerrar su última pestaña (⌘W) cierra la propia ventana, porque ya no queda nada que devolver; cerrar la
  ventana principal sale de MobAlt, ventanas separadas incluidas. El espacio de trabajo recuerda las ventanas separadas
  y las vuelve a abrir en el siguiente arranque, reconectando sus sesiones igual que las de la ventana principal. Las
  pestañas no se pueden arrastrar entre ventanas: cierra la ventana para recuperarlas, o sepáralas de nuevo desde allí.
- **Divisiones y cuadrículas**: `Dividir ▾` (⌘D derecha, ⇧⌘D abajo) añade un panel vacío; las entradas de cuadrícula
  crean disposiciones de 1×2 … 2×4 (⌥⌘2/4/6/8). Suelta una sesión del árbol sobre un panel vacío para conectar ahí,
  sobre el borde de un panel para dividir en esa dirección, o sobre su centro para reemplazarlo. Arrastra una pestaña
  sobre un panel para mover ese terminal a la división. ⌥⌘1 (Visualización → Deshacer división, `Dividir ▾` →
  Deshacer división) deshace la división de la pestaña: por omisión, cada uno de los demás paneles se convierte en una
  pestaña propia, colocada justo después de la pestaña actual en el orden de los paneles, con su terminal, título y
  estado tal cual: nada se reconecta ni se pierde salida; el panel con el foco se queda con la pestaña. Ajustes →
  Terminal → **Deshacer división** elige qué ocurre en su lugar: *Conservar el panel activo y cerrar los demás* (los
  otros paneles se cierran, con la pregunta habitual cuando se perderían conexiones activas) o *Preguntar siempre* (un
  pequeño diálogo ofrece *Mover paneles a pestañas*, *Conservar solo este panel* o Cancelar, que mantiene la división).
  Una pestaña con un solo panel se deja en paz, y un panel maximizado se restaura primero.
- **Maximizar un panel** (⇧⌘⏎, el botón ⤢ en la cabecera del panel, o `Dividir ▾` → Maximizar panel): el panel con el
  foco ocupa toda la pestaña, como el zoom de tmux o el maximizar de iTerm2. Los demás paneles siguen conectados, pero
  ocultos; la cabecera del panel muestra una etiqueta *maximizado* y la pestaña un pequeño ⤢. Pulsa de nuevo (o ⤡ en la
  cabecera) para recuperar la disposición. Dividir, cerrar un panel, una disposición en cuadrícula o dar el foco a un
  panel oculto (⌘]) restauran la disposición primero. Cada pestaña conserva su propio estado de maximizado, también
  tras un reinicio.
- **MultiExec** (⇧⌘M): mientras está activado, cada pulsación va a todos los terminales visibles en pantalla: los
  paneles activos de la pestaña actual, o solo el panel maximizado mientras uno ocupa la pestaña. Las demás pestañas
  nunca la reciben, así que divide la pestaña (o usa una cuadrícula) para poner lado a lado los servidores que quieres
  manejar. El aviso indica cuántos terminales visibles escuchan y sigue a la pestaña a la que cambies.
- **Barra de monitoreo remoto**: cada panel SSH muestra una franja de una línea bajo su cabecera: CPU, memoria usada /
  total, disco raíz usado, tasas de red ↓ / ↑, carga media, tiempo encendido y el nombre del host, actualizada cada 3 s
  (Ajustes → Funciones → Monitoreo, 2–30 s). Un pequeño fragmento de `sh` POSIX se ejecuta por la propia conexión de la
  sesión, así que no necesita un segundo inicio de sesión, funciona a través de hosts de salto y nunca escribe en el
  terminal; los hosts Linux se leen desde `/proc`, macOS y los BSD mediante `sysctl`, `vm_stat` y `netstat`. Un host que
  no puede ejecutarlo (sin `sh`, permiso denegado) muestra un tenue *monitoreo no disponible* y no se le vuelve a
  preguntar hasta que se reconecta. El sondeo se pausa mientras el panel no está en pantalla (otra pestaña delante, un
  panel hermano maximizado, la ventana oculta) y se reanuda cuando vuelve. Desactívalo por sesión (SSH avanzado →
  *Mostrar barra de monitoreo remoto*), por panel (el botón de pulso en la cabecera del panel, Visualización → Barra de
  monitoreo remoto, o el menú contextual del terminal) o para todas las sesiones en Ajustes. Un panel Mosh no tiene
  canal SSH propio: su barra se muestra a través de la conexión SFTP auxiliar mientras esta está abierta.
- **Buscar** (⌘F): búsqueda incremental con conmutadores de mayúsculas y regex y un contador de coincidencias.
- **Resaltado de palabras clave**: errores, avisos, OK/done, direcciones IP, URL y tamaños (`512M`, `3.2GB`) se
  colorean según llegan, con colores tomados del tema del terminal para que se lean bien en cualquier paleta.
  Ajustes → Funciones → *Resaltado de palabras clave* lo desactiva; *Reglas…* abre la tabla: cada regla es un texto sin
  formato o una expresión regular, ignorar mayúsculas, un color, un fondo opcional, negrita y subrayado;
  *Restaurar por omisión* devuelve el conjunto integrado. Cuando varias reglas se solapan, gana la coincidencia más
  temprana y, después, la más larga. La pestaña Terminal de una sesión puede forzarlo activado o desactivado
  (*Resaltado de palabras clave: Por omisión / Activado / Desactivado*). Solo se analizan las líneas recién escritas (las
  apps a pantalla completa como vim se dejan en paz); como máximo se mantienen decoradas 2000 coincidencias por
  terminal (en una ráfaga larga, las filas más antiguas vuelven primero al texto plano) y ⌘K las descarta todas.
- **Zmodem (rz/sz)**: mueve archivos a través del propio terminal, a la manera clásica, por una consola serie o un host
  de salto donde SFTP no está disponible. Ejecuta `sz archivo …` en el remoto para descargar al Mac, o `rz` para subir
  desde él; MobAlt detecta la transferencia en el flujo, pausa el terminal y la muestra en la lista de transferencias
  del panel Sftp (con Cancelar) y en el contador de la barra de estado. Las descargas van a la Carpeta de descargas
  (Ajustes → General), o a una carpeta que elijas cuando no hay ninguna configurada; las subidas abren un selector de
  archivos. Funciona en paneles SSH, locales, telnet y serie, pero no en Mosh (su flujo es el del cliente mosh, no un
  flujo de bytes en bruto). Desactívalo con Ajustes → Funciones → Transferencias → *Transferencias Zmodem (rz/sz)*
  (activado por omisión); con él desactivado, los bytes de `rz`/`sz` aparecen como basura, igual que antes. Ctrl-C en el
  panel o Cancelar en la lista termina una transferencia: se le dice al `sz`/`rz` remoto que pare, lo que aún tenía en
  vuelo se descarta en vez de dibujarse, y el prompt vuelve en un segundo; un `sz` remoto que muere se detecta en pocos
  segundos. Una segunda descarga con el mismo nombre se guarda como `nombre (1).ext` y se lista con ese nombre.
- **Portapapeles**: seleccionar copia (Ajustes → Terminal → Copiar al seleccionar); el clic derecho pega (⇧-clic
  derecho abre el menú). Soltar archivos desde el Finder sobre un terminal SSH los sube; sobre un terminal local, pega
  las rutas.
- **Protección de pegado**: un pegado de más de una línea (o de más de 1000 caracteres) pregunta primero: *¿Pegar N
  líneas en …?* muestra el texto en una vista previa editable; ⌘⏎ pega, Esc cancela. Cada pegado se revisa además en
  busca de lo que el portapapeles no muestra: caracteres de ancho cero y bidireccionales, espacios de no separación (un
  espacio a la vista, parte de la palabra para el shell), caracteres de control, un salto de línea final (la última
  línea se ejecutaría de inmediato), un retorno de carro dentro de una línea, `curl … | sh`, escrituras en `~/.zshrc`
  y compañía o en `~/.ssh/authorized_keys`, comandos del estilo `rm -rf /` y palabras latinas con letras cirílicas o
  griegas parecidas. Los hallazgos se enumeran y se marcan en la vista previa; *Pegar limpio* quita los caracteres
  ocultos y el salto de línea final, *Pegar tal cual* envía el texto sin cambios. Ambas comprobaciones son conmutadores
  de Ajustes → Funciones → Protección de pegado (activados por omisión); cubren ⌘V, el clic derecho y el texto soltado
  sobre un panel, no las macros. Con MultiExec activado, una sola confirmación vale para todos los terminales visibles.
- **Teclas**: Mayús+Intro y Opción+Intro envían ESC+CR (un salto de línea en apps TUI como Claude Code); Opción actúa
  como Meta por omisión.
- **Registro**: Terminal → Iniciar/detener registro de sesión, o la opción de la sesión, escribe la salida en bruto en
  `~/Documents/MobAlt Logs/`. Ajustes → Registro → *Quitar colores y secuencias de control* guarda en su lugar los
  registros como texto sin formato (se eliminan los colores ANSI, los movimientos del cursor y el hook de seguimiento
  de carpeta).
- **Temas y apariencia**: Ajustes → Terminal → Tema colorea todo el programa, no solo los terminales. La barra de
  herramientas, la barra lateral, las pestañas, la barra de estado, los diálogos, los menús, los avisos y las franjas
  toman una paleta de interfaz derivada del tema elegido: *Moba Dark* es la interfaz oscura de siempre, *Light* es una
  aplicación clara con paneles casi blancos y texto oscuro, *One Dark*, *Dracula*, *Solarized Dark* y *Gruvbox Dark*
  tiñen la interfaz con su propio matiz, y los controles nativos y la franja de la barra de título los siguen. Todos
  los colores de texto de la interfaz mantienen un contraste de al menos 4,5:1 sobre su fondo, en todos los temas. El
  selector de tema muestra un prompt de ejemplo con los colores de la propia paleta; Guardar lo aplica al instante.
  Ajustes → Terminal → Tipo de letra se aplica a todos los terminales; una sesión puede sobrescribir tema y letra en su
  pestaña Terminal: su propio tema colorea solo el terminal de ese panel, y la ventana conserva el global.

## Archivos (SFTP / FTP)

![Panel SFTP](images/sftp-panel.png)

El panel **Sftp** sigue al panel SSH o FTP activo. Se abre automáticamente al conectar
(Ajustes → General → «Cambiar al panel Sftp al conectar por SSH»).

- Navega haciendo doble clic en las carpetas, escribiendo una ruta (`~` funciona) o con ⬆ / 🏠 / ⟳.
  «Seguir al terminal» mantiene el panel en el directorio actual del shell (necesita la opción de la sesión, que
  inyecta un pequeño hook en el prompt). `>_` envía `cd` al terminal.
- Barra de herramientas y menú contextual: nueva carpeta, renombrar, permisos, eliminar, descargar, subir. Selección
  múltiple con ⌘ / ⇧. Arrastra archivos desde el Finder sobre la lista para subirlos; los nombres existentes preguntan
  antes de sobrescribir.
- Doble clic en un archivo de texto para editarlo en el editor integrado (⌘S guarda de vuelta). «Editar en el editor
  externo» lo abre en tu editor (Ajustes → General → Editor externo) y lo vuelve a subir con cada guardado.
- Las transferencias muestran progreso, velocidad y un botón de cancelar; «Mostrar en el Finder» tras una descarga.
- Las cabeceras de columna ordenan por nombre, tamaño o fecha. Cuando la barra lateral es estrecha, la columna de fecha
  se oculta.

## Túneles (reenvío de puertos)

![Túneles](images/tunnels.png)

`Túneles` (⇧⌘U) gestiona los reenvíos de puertos SSH:

- **Local (-L)**: `127.0.0.1:8080 → db.internal:5432` a través del host SSH.
- **Remoto (-R)**: un puerto del servidor reenviado a un servicio local.
- **Dinámico (-D)**: un proxy SOCKS5 local a través del servidor.

Inicia un túnel sobre una conexión abierta o deja que MobAlt abra una conexión dedicada a una sesión guardada. Los
túneles listados en la pestaña **Túneles** de una sesión se inician automáticamente cuando esa sesión conecta, y se te
avisa si alguno no consigue enlazar su puerto.

## X11, Mosh, serie, RDP/VNC

- **X11**: marca «Reenvío de X11» en SSH avanzado. MobAlt inicia XQuartz cuando hace falta, reenvía la pantalla e
  intercambia la cookie de autenticación, así que `xeyes` o `gedit` simplemente funcionan. La barra de estado muestra
  la disponibilidad de X11.
- **Mosh**: necesita `brew install mosh` en local y `mosh-server` en el host (UDP 60000-61000). El panel ejecuta el
  cliente mosh; el arranque por SSH usa tu clave, el agente o una petición interactiva. Indica la ruta de
  `mosh-server` si no está en el PATH remoto.
- **Mosh + SFTP**: mosh no lleva canal SFTP, así que el panel Sftp explora un host Mosh mediante una conexión SSH aparte
  sin shell al mismo host (misma clave, agente y peticiones). Se abre automáticamente cuando «Abrir el explorador SFTP
  automáticamente» está activado en la sesión (y «Cambiar al panel Sftp» en Ajustes → General); si no, desde el botón
  «Abrir SFTP para este host (vía SSH)» del panel o «Abrir explorador SFTP» en el menú del panel; se cierra junto con el
  panel.
- **Serie**: el editor enumera los dispositivos USB-serie; configura baudios, bits de datos/parada, paridad, control
  de flujo, eco local y lo que envía Intro (CR, LF, CRLF).
- **RDP / VNC**: MobAlt escribe un archivo `.rdp` y abre Windows App, o abre `vnc://` en Compartir Pantalla. La sesión
  guarda host, usuario y carpeta como cualquier otro marcador.

## Herramientas y macros

- Panel **Herramientas**: ping, traceroute, consulta DNS, escaneo de puertos e información de la red local, con un
  botón Detener para las ejecuciones largas.
- **Wake-on-LAN** (panel Herramientas): escribe la dirección MAC con cualquier notación (`aa:bb:cc:dd:ee:ff`,
  `aa-bb-…`, `aabb.ccdd.eeff` o hexadecimal sin separadores) y pulsa Despertar: el paquete mágico sale tres veces como
  broadcast UDP (255.255.255.255, puerto 9 por omisión; un broadcast dirigido como 192.168.1.255 llega a otra subred).
  Las 10 últimas direcciones se recuerdan con una etiqueta opcional y se sugieren mientras escribes.
- **Escáner de red** (panel Herramientas): escanea un CIDR (`192.168.1.0/24`), un rango (`10.0.0.1-10.0.0.50` o
  `10.0.0.1-50`) o un solo host, hasta un /16, mediante ping ICMP y/o conexiones TCP a una lista corta de puertos (22,
  80, 443, 3389, 5900 por omisión), con concurrencia y tiempo de espera ajustables y una consulta DNS inversa de cada
  resultado. Los hosts que responden aparecen en una tabla ordenable según se encuentran (IP, nombre de host, tiempo de
  ida y vuelta, puertos abiertos) mientras la barra de progreso cuenta `123/254`; Detener cancela, ＋ abre el editor de
  sesiones con SSH a ese host ya rellenado, y «Copiar texto» pone la tabla en el portapapeles.
- Panel **Macros**: graba pulsaciones en un terminal (● Grabar / ■ Detener), guárdalas con un nombre y reprodúcelas en
  el terminal activo o en todos los terminales. Las macros de texto se pueden escribir directamente; se admiten
  secuencias de escape como `\n` o `\x1b[A`.

## Espacio de trabajo y ajustes

MobAlt restaura tus pestañas, divisiones y sesiones (las pestañas separadas en ventanas propias vuelven como ventanas)
en el siguiente arranque y reconecta las sesiones SSH (los shells locales se reabren en su última carpeta).
Desactívalo en Ajustes → General → Comportamiento.

![Ajustes](images/settings.png)

Ajustes tiene cinco pestañas, y cada una cabe en la ventana más pequeña sin desplazamiento: **General** (el idioma de la
interfaz, la confirmación al salir, el cambio al panel SFTP, la restauración del espacio de trabajo, el shell local y su
integración de carpetas, el editor externo, la carpeta de descargas, el keep-alive de SSH y «Abrir carpeta de
configuración», que muestra dónde se guarda todo), **Terminal** (tipo de letra, interlineado, cursor, historial, tema
—el aspecto de toda la ventana, ver *Temas y apariencia*—, ratón/teclas, y qué hace *Deshacer división* con los demás
paneles de una pestaña dividida: moverlos a pestañas propias, cerrarlos o preguntar siempre), **Funciones** (la
protección de pegado, la barra de monitoreo remoto y su frecuencia de actualización, el resaltado de palabras clave y su
tabla de reglas, y las transferencias Zmodem), **Registro** (carpeta de registros, registros de sesión en texto sin
formato) y **Actualizaciones** (la comprobación al iniciar y «Buscar ahora»).

### Idioma de la interfaz

Los menús, la barra de herramientas, los paneles, los diálogos y los mensajes de MobAlt están en diez idiomas: English,
한국어, 简体中文, 日本語, Tiếng Việt, हिन्दी, Deutsch, Français, Español y Português. Por omisión (**Por omisión del
sistema**) la interfaz sigue la lista de idiomas de macOS (Ajustes del Sistema → General → Idioma y región): gana el
primer idioma de esa lista que MobAlt incluya, y English cuando ninguno lo está. Ajustes → General → **Idioma** elige
uno explícitamente; el cambio se aplica al instante en todas las ventanas (nada se reinicia, las conexiones siguen
abiertas) y se recuerda. La salida del terminal nunca se traduce: lo que imprime un host remoto se muestra tal cual. La
guía del usuario existe en los mismos diez idiomas (`docs/USER_GUIDE.<idioma>.md`); Ayuda → **Guía del usuario** abre la
del idioma actual.

Para ejecutar MobAlt una sola vez en un idioma sin cambiar el ajuste (capturas de pantalla, una prueba), inícialo con
`MOBALT_LANG=<código>` en el entorno (`en`, `ko`, `zh-CN`, `ja`, `vi`, `hi`, `de`, `fr`, `es`, `pt`).

## Funciones rápidas de teclado

| Acción | Teclas |
|---|---|
| Nueva sesión / terminal local / conexión rápida | ⌘N / ⌘T / ⇧⌘N |
| Duplicar / reconectar / cerrar pestaña / cerrar panel | ⇧⌘T / ⌘R / ⌘W / ⇧⌘W |
| Fijar / desfijar la pestaña activa | ⇧⌘P |
| Separar la pestaña activa en su propia ventana | ⌥⌘N |
| Cerrar las otras pestañas / las de la izquierda / las de la derecha | Menú Sesión, o el menú contextual de la pestaña |
| Dividir a la derecha / hacia abajo, deshacer división | ⌘D / ⇧⌘D, ⌥⌘1 |
| Cuadrícula de 2 / 4 / 6 / 8 paneles | ⌥⌘2 / ⌥⌘4 / ⌥⌘6 / ⌥⌘8 |
| Panel siguiente, pestaña siguiente / anterior, pestaña 1-9 | ⌘] , ⌃Tab / ⌃⇧Tab, ⌃⌘1-9 |
| Maximizar panel (ocupar la pestaña) / restaurar la disposición | ⇧⌘⏎ |
| Buscar, borrar, zoom | ⌘F, ⌘K, ⌘= / ⌘- / ⌘0 |
| Barra lateral, Sesiones / SFTP / Herramientas / Macros | ⌘B, ⌘1 / ⌘2 / ⌘3 / ⌘4 |
| MultiExec, túneles, ajustes | ⇧⌘M, ⇧⌘U, ⌘, |
| Salto de línea en apps TUI | ⇧Intro o ⌥Intro |
| Diálogo de protección de pegado (varias líneas o pegado sospechoso): pegar / cancelar | ⌘⏎ / Esc |
| Pestaña con el foco: mover / activar / cerrar, menú contextual | ← → / ⏎ / ⌫, ⇧F10 o la tecla Menú |
| Fila de sesión con el foco: mover / plegar / abrir / abrir en un panel dividido / eliminar | ↑ ↓ / ← → / ⏎ / ⌘⏎ o ⇧⏎ / ⌫ |
| Fila de sesión o carpeta con el foco: menú contextual (carpetas: Mover a carpeta…) | ⇧F10 o la tecla Menú |
| Macro con el foco: mover / reproducir / eliminar, menú contextual | ↑ ↓ / ⏎ / ⌫, ⇧F10 o la tecla Menú |
| Lista SFTP: mover / abrir / carpeta superior / eliminar, menú contextual | ↑ ↓ Inicio Fin RePág AvPág / ⏎ / ⌫ / Supr, ⇧F10 o la tecla Menú |
| Lista SFTP: extender la selección / alternar la fila con el foco / seleccionar todo | ⇧↑ ⇧↓ ⇧Inicio ⇧Fin / Espacio / ⌘A |
| Lista SFTP: ordenar por una columna | Tab hasta la cabecera Nombre / Tamaño / Modificado, ⏎ o Espacio |
| Árbol de sesiones y lista SFTP: saltar a un nombre | escribe sus primeras letras, espacios incluidos (la misma letra otra vez: siguiente coincidencia) |
| Selectores de icono y color en el editor de sesiones: mover / elegir | ← → ↑ ↓ / ⏎ o Espacio |
| Botones de panel de la tira lateral / ⌘1-4 | ⏎ lleva el teclado al panel; al cambiar de panel se recuerda dónde estaba |

Ayuda → Funciones rápidas de teclado muestra la misma lista dentro de la app. Tab llega a la barra de herramientas, la
tira lateral, el árbol de sesiones, la lista de macros, la lista SFTP y la tira de pestañas (cada lista es una sola
parada de Tab; las flechas se mueven dentro de ella); los diálogos mantienen Tab dentro de ellos y devuelven el foco a
la pestaña, fila o botón que los abrió cuando se cierran; los menús contextuales usan ↑ ↓ / ⏎ / Esc. Esc en el filtro de
sesiones o en el cuadro de conexión rápida lo vacía y vuelve al terminal.


## Datos y privacidad

Todo se queda en `~/Library/Application Support/MobAlt/`: `sessions.json` (contraseñas y frases de contraseña
cifradas mediante el llavero de macOS), `settings.json`, `known_hosts`, `workspace.json` y los archivos de
integración con zsh. Los registros de sesión van a `~/Documents/MobAlt Logs/`. MobAlt solo se conecta a los hosts que
configuras; la comprobación de actualizaciones opcional lee la lista de versiones publicadas en GitHub y nada más.
Detalles: [SECURITY.md](../SECURITY.md).

## Solución de problemas

- **«Timed out while waiting for handshake» / ETIMEDOUT**: nada respondió en ese puerto. Revisa la dirección, la VPN y
  el reenvío del router; prueba `nc -vz host puerto` en un terminal local.
- **«autenticación fallida — el servidor acepta: …; se probó: …»**: el servidor no aceptó lo que MobAlt ofreció.
  Compara la lista «acepta» con el método de autenticación de tu sesión; para servidores que solo admiten clave, elige
  el archivo de clave correcto. Los fallos repetidos pueden hacer que fail2ban o las penalizaciones por origen de sshd
  bloqueen tu IP durante un tiempo.
- **«no hay intercambio de claves / clave del host / cifrado / MAC en común: esta sesión ofrece …; el servidor ofrece
  …»**: las dos partes no tienen ningún algoritmo en común. El mensaje enumera lo que el servidor sí habla: añade uno
  de ellos en SSH avanzado → Algoritmos (o *Restablecer por omisión*); para un aparato antiguo que solo ofrece
  SHA-1 / CBC, marca «Algoritmos antiguos (dispositivos viejos)».
- **La clave del host ha cambiado**: el servidor se reinstaló, o algo está interceptando la conexión. Acepta solo si
  sabes por qué; la clave antigua se puede quitar de `known_hosts` en la carpeta de configuración.
- **La app X11 no aparece**: instala XQuartz y asegúrate de que el shell remoto no sobrescribe `DISPLAY` en sus archivos
  de inicio.
- **Mosh**: «no se encontró el cliente mosh» significa que falta `brew install mosh` en local; «mosh-server not found»
  significa que falta en el host o no está en su PATH (indica la ruta en la sesión).
- **Aviso de Gatekeeper con una app compilada por ti**: clic derecho → Abrir una vez, o
  `xattr -dr com.apple.quarantine /Applications/MobAlt.app`.
- **`hdiutil: attach failed – Resource busy` al ejecutar `brew upgrade --cask mobalt`**: otro proceso de Homebrew (por
  ejemplo `brew audit` o `brew fetch`) tenía el mismo DMG montado en ese momento. Simplemente vuelve a ejecutar el
  comando.
