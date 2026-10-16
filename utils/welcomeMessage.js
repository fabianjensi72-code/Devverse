import { createCanvas, loadImage } from '@napi-rs/canvas';
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const configPath = fileURLToPath(new URL('../config.json', import.meta.url));
const config = JSON.parse(await readFile(configPath, 'utf8'));
const { channels = {}, server = {} } = config;

const WIDTH = 1200;
const HEIGHT = 500;
const themeColor = 0x5865f2;

function drawCover(ctx, image, x, y, width, height) {
  const scale = Math.max(width / image.width, height / image.height);
  const sourceWidth = width / scale;
  const sourceHeight = height / scale;
  const sourceX = (image.width - sourceWidth) / 2;
  const sourceY = (image.height - sourceHeight) / 2;
  ctx.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height);
}

export async function createWelcomeCard(user) {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  const background = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  background.addColorStop(0, '#0b1020');
  background.addColorStop(0.55, '#121a35');
  background.addColorStop(1, '#20205a');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.fillStyle = 'rgba(77, 117, 255, 0.10)';
  ctx.beginPath();
  ctx.arc(1100, 15, 330, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(133, 158, 255, 0.18)';
  ctx.lineWidth = 2;
  for (let x = 0; x < WIDTH; x += 48) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x - 180, HEIGHT);
    ctx.stroke();
  }

  ctx.fillStyle = '#7187ff';
  ctx.fillRect(0, 0, 12, HEIGHT);
  ctx.fillStyle = 'rgba(5, 9, 24, 0.48)';
  ctx.beginPath();
  ctx.roundRect(54, 52, WIDTH - 108, HEIGHT - 104, 28);
  ctx.fill();

  const avatarSize = 250;
  const avatarX = 112;
  const avatarY = (HEIGHT - avatarSize) / 2;
  ctx.save();
  ctx.shadowColor = '#7288ff';
  ctx.shadowBlur = 32;
  ctx.strokeStyle = '#8294ff';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2 + 3, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
  ctx.clip();
  try {
    const avatar = await loadImage(user.displayAvatarURL({ extension: 'png', size: 512 }));
    drawCover(ctx, avatar, avatarX, avatarY, avatarSize, avatarSize);
  } catch (error) {
    // La bienvenida sigue funcionando si el CDN del avatar está temporalmente inaccesible.
    console.error('No se pudo cargar el avatar; se usará un avatar de reserva:', error);
    ctx.fillStyle = '#5865f2';
    ctx.fillRect(avatarX, avatarY, avatarSize, avatarSize);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.font = '700 112px sans-serif';
    ctx.fillText(user.username?.[0]?.toUpperCase() ?? '?', avatarX + avatarSize / 2, avatarY + 155);
  }
  ctx.restore();

  const textX = 430;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#9eafff';
  ctx.font = '700 25px sans-serif';
  ctx.fillText('DEVVERSE STUDIOS  /  ROBLOX GAME DEVELOPMENT', textX, 145);
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 51px sans-serif';
  ctx.fillText('¡BIENVENIDO/A A', textX, 220);
  ctx.fillText('DEVVERSE STUDIOS!', textX, 280);
  ctx.fillStyle = '#8ea2ff';
  ctx.font = '700 34px sans-serif';
  const username = user.username;
  ctx.fillText(username.length > 28 ? `${username.slice(0, 25)}...` : username, textX, 345);
  ctx.fillStyle = '#d2d8f0';
  ctx.font = '24px sans-serif';
  ctx.fillText('Explora, crea y comparte tu próximo gran juego.', textX, 392);

  return new AttachmentBuilder(await canvas.encode('png'), { name: 'devverse-welcome.png' });
}

function channelButton(label, guildId, channelId, style = ButtonStyle.Secondary) {
  if (channelId) {
    return new ButtonBuilder()
      .setLabel(label)
      .setStyle(ButtonStyle.Link)
      .setURL(`https://discord.com/channels/${guildId}/${channelId}`);
  }

  // Un botón sin canal de destino usa custom_id para seguir siendo válido y muestra que falta configurar.
  return new ButtonBuilder()
    .setCustomId(`welcome-unconfigured-${label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}`)
    .setLabel(label)
    .setStyle(style)
    .setDisabled(true);
}

export function createWelcomePayload(user, guildId, { mention = true } = {}) {
  const buttonDefinitions = [
    ['📜 Ver las normas', channels.rules, ButtonStyle.Secondary],
    ['🎮 Promocionar un juego', channels.promoteYourGame, ButtonStyle.Secondary],
    ['🎫 Abrir un ticket', channels.createTicket, ButtonStyle.Primary],
  ];
  const buttons = new ActionRowBuilder().addComponents(
    ...buttonDefinitions.map(([label, channelId, style]) => channelButton(label, guildId, channelId, style)),
  );

  const avatarUrl = user.displayAvatarURL({ size: 256 });
  const embed = new EmbedBuilder()
    .setColor(themeColor)
    .setTitle(`¡Te damos la bienvenida a ${server.name ?? 'DevVerse Studios'}!`)
    .setDescription(`¡Hola <@${user.id}>! 👋\n\nAquí puedes crear, desarrollar y compartir tus juegos de Roblox. Empieza revisando las normas y conoce a la comunidad de creadores.`)
    .setFooter({ text: 'DevVerse Studios • Crea. Comparte. Evoluciona.' })
    .setTimestamp()
    .setImage('attachment://devverse-welcome.png');
  if (avatarUrl) embed.setThumbnail(avatarUrl);

  return {
    ...(mention ? { content: `<@${user.id}>` } : {}),
    embeds: [embed],
    components: [buttons],
    allowedMentions: { users: mention ? [user.id] : [] },
  };
}

export function getWelcomeChannelId() {
  return channels.welcomeChannelId || channels.welcome;
}

export function createRulesEmbed() {
  return new EmbedBuilder()
    .setColor(themeColor)
    .setTitle('🌌 REGLAS DE DEVVERSE STUDIOS 🎮🚀')
    .setDescription([
      '⚖️ **CONDUCTA GENERAL**',
      '🤝 **Respeto total:** Cero tolerancia al acoso, racismo o discriminación. Baneo inmediato.',
      '🚫🔞 **Contenido seguro:** Prohibido estrictamente el contenido +18 o la violencia extrema.',
      '🧭 **Sentido común:** No busques vacíos legales; el Staff tiene la palabra final.',
      '',
      '🛡️ **ORDEN Y COMUNICACIÓN**',
      '🫧 **Cero spam:** No satures el chat con mensajes repetidos, mayúsculas o emojis.',
      '📂 **Uso de canales:** Respeta el propósito de cada canal. Pide ayuda técnica en los canales de ayuda.',
      '🎫 **Menciones:** No etiquetes al Staff sin una razón urgente. Usa Tickets para soporte.',
      '📩❌ **No DM spam:** Prohibido enviar publicidad por privado a los miembros.',
      '',
      '🚀 **DESARROLLO Y SEGURIDAD**',
      '🧠 **Créditos:** No robes trabajo ajeno. Da crédito si usas scripts o modelos de otros.',
      '🎬 **Promoción:** Solo se permite publicidad en los canales de la categoría PROMOCIÓN.',
      '🛡️ **Cero estafas:** Intentar robar cuentas o prometer Robux falsos resultará en baneo permanente.',
      '',
      '🎫 **SOPORTE**',
      'Usa el canal <#1502442612127436960> para cualquier queja o duda técnica.',
      '⚖️ **Sanciones:** Las decisiones de moderación se respetan. Puedes apelar vía Ticket con educación.',
      '',
      '*«Tu código crea mundos, tus acciones definen tu lugar aquí.»*',
      'Al participar, aceptas este código de conducta.',
    ].join('\n'))
    .setFooter({ text: 'DevVerse Studios • Crea. Comparte. Evoluciona.' })
    .setTimestamp();
}

/** Publica las reglas en su canal y menciona al miembro que acaba de entrar. */
export async function sendRulesWelcome(guild, user) {
  if (!channels.rules) {
    console.error('No se publicó el mensaje de reglas: configura channels.rules en config.json.');
    return;
  }

  const channel = await guild.channels.fetch(channels.rules);
  if (!channel?.isTextBased() || !channel.send) {
    throw new Error(`El canal de reglas ${channels.rules} no existe o no admite mensajes.`);
  }

  await channel.send({
    content: `<@${user.id}> ¡bienvenido/a! Revisa estas reglas para formar parte de DevVerse Studios.`,
    embeds: [createRulesEmbed()],
    allowedMentions: { users: [user.id] },
  });
}
