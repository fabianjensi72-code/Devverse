# Desplegar DevVerse Studios en Termux (Android)

Esta guía ejecuta el bot dentro de Termux con Node.js y PM2. PM2 reinicia el proceso si falla; Android puede cerrar aplicaciones en segundo plano por ahorro de energía, así que activa también el bloqueo de suspensión y, si quieres iniciar el bot después de reiniciar el teléfono, configura Termux:Boot.

## 1. Instalar Termux

Instala Termux desde [F-Droid](https://f-droid.org/packages/com.termux/) o desde los [releases oficiales de GitHub](https://github.com/termux/termux-app/releases). Instala los complementos Termux:API y Termux:Boot desde la misma fuente que Termux; no mezcles APK de fuentes distintas porque sus firmas pueden no coincidir.

Abre Termux y actualiza los paquetes:

```sh
pkg update && pkg upgrade -y
pkg install nodejs-lts git termux-api -y
npm install -g pm2
node --version
npm --version
pm2 --version
```

## 2. Descargar el bot

En GitHub, abre el repositorio del bot, pulsa **Code** y copia su URL HTTPS o SSH. En Termux, sustituye la URL de ejemplo por la URL real:

```sh
cd ~
git clone https://github.com/USUARIO/REPOSITORIO.git devverse-bot
cd ~/devverse-bot
npm install
```

Si el repositorio es privado, configura acceso a GitHub en Termux antes de clonar. No pongas tokens de acceso en la URL del repositorio ni en este archivo.

## 3. Crear `.env` en el teléfono

El archivo `.env` no se sube a Git. Créalo directamente en Termux:

```sh
cd ~/devverse-bot
nano .env
```

Escribe tus valores reales, cada uno en su propia línea:

```env
DISCORD_TOKEN=token_del_bot
CLIENT_ID=id_de_la_aplicacion
GUILD_ID=id_de_tu_servidor
GROQ_API_KEY=clave_de_groq
```

Guarda en nano con **Ctrl+O**, confirma con **Enter** y sal con **Ctrl+X**. Mantén `.env` privado y no lo envíes al repositorio. El ecosistema de PM2 carga este archivo al arrancar y entrega `NODE_ENV=production` al proceso.

## 4. Mantener Termux activo

Instala y abre Termux:API desde la misma fuente de Termux, vuelve a Termux y ejecuta:

```sh
termux-wake-lock
```

Esto mantiene despierta la CPU mientras corre el proceso y aumenta el consumo de batería. Para liberar el bloqueo cuando pares el bot:

```sh
termux-wake-unlock
```

En los ajustes de Android, busca **Aplicaciones → Termux → Batería** y selecciona **Sin restricciones** o **No optimizar**. Desactiva también la optimización para Termux:API y Termux:Boot si tu dispositivo lo permite. Los nombres cambian según la versión de Android y el fabricante.

## 5. Iniciar el bot con PM2

Desde la carpeta del proyecto:

```sh
cd ~/devverse-bot
pm2 start ecosystem.config.cjs --env production
pm2 save
pm2 status
pm2 logs devverse-bot
```

PM2 aplicará `autorestart` y reiniciará el proceso si supera el límite configurado de **250 MB**. `pm2 save` guarda la lista de procesos para poder recuperarla.

### Iniciar automáticamente después de reiniciar Android (opcional)

Instala Termux:Boot desde la misma fuente que Termux y ábrelo una vez. Luego crea un script de arranque:

```sh
mkdir -p ~/.termux/boot
nano ~/.termux/boot/start-devverse
```

Pega:

```sh
#!/data/data/com.termux/files/usr/bin/sh
termux-wake-lock
cd "$HOME/devverse-bot" || exit 1
pm2 resurrect || pm2 start ecosystem.config.cjs --env production
```

Guarda el archivo y dale permiso de ejecución:

```sh
chmod +x ~/.termux/boot/start-devverse
```

Después de arrancar el bot una primera vez y ejecutar `pm2 save`, Android podrá pedir a Termux:Boot que restaure la lista guardada tras un reinicio. El fabricante todavía puede limitar procesos en segundo plano.

## 6. Actualizar el bot desde el teléfono

Desde la carpeta del repositorio, actualiza el código y reinicia el proceso:

```sh
cd ~/devverse-bot && git pull --ff-only && pm2 restart devverse-bot
```

Si la actualización cambió dependencias, instala también los paquetes antes de reiniciar:

```sh
cd ~/devverse-bot && git pull --ff-only && npm install && pm2 restart devverse-bot
```

Revisa el estado y los registros cuando necesites diagnosticar:

```sh
pm2 status
pm2 logs devverse-bot --lines 100
```

## Nota sobre imágenes y compatibilidad

El proyecto usa `@napi-rs/canvas` para las tarjetas de bienvenida. La biblioteca publica paquetes nativos para Android ARM64 y ARM EABI; instala las dependencias en Termux en el propio teléfono para que npm seleccione el binario de la plataforma correcta. Si `npm install` o el arranque falla al cargar Canvas, revisa la arquitectura con `uname -m` y los registros de npm/PM2.

## Referencias

- [Instalación oficial de Termux y compatibilidad de firmas](https://github.com/termux/termux-app#installation)
- [Termux:API](https://github.com/termux/termux-api)
- [Comando termux-wake-lock](https://github.com/termux/termux-tools/blob/master/scripts/termux-wake-lock.in)
- [Configuración de aplicaciones y memoria en PM2](https://pm2.keymetrics.io/docs/usage/application-declaration/)
- [Paquetes de `@napi-rs/canvas`](https://github.com/Brooooooklyn/canvas)
