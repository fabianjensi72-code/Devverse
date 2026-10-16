# DevVerse Studios Bot

Bot modular de Discord para la comunidad de desarrollo de juegos de Roblox DevVerse Studios.

## Requisitos

- Node.js 20 o posterior
- Una aplicación/bot de Discord con los intents necesarios habilitados
- Una clave de Groq para las respuestas de IA (opcional hasta usar esa función)

## Instalación

```sh
npm install
cp .env.example .env
```

Completa `.env` con las credenciales del bot. Configura en `config.json` los IDs de los canales del servidor y arranca el bot:

```sh
npm start
```

Para desarrollo, define `GUILD_ID` en `.env` para registrar los comandos slash en ese servidor.

## Comandos

- `/ping`: comprueba la latencia.
- `/ayuda`: abre las guías de la comunidad.
- `/promocionar`: abre el formulario para publicar un juego en el foro de promoción.
- `/test-bienvenida`: previsualiza la bienvenida.

## Despliegue en Android

Consulta [DEPLOY_TERMUX.md](DEPLOY_TERMUX.md) para instrucciones de Termux y PM2.

Nunca subas `.env` ni compartas el token del bot o la clave de Groq.