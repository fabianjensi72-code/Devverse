import { Events } from 'discord.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder } from 'discord.js';
import config from '../config.json' with { type: 'json' };
import { HELP_TOPICS } from '../commands/ayuda.js';
import { handleTicketInteraction } from '../utils/ticketHandler.js';
import { handleRobloxVerificationInteraction } from '../utils/robloxVerificationHandler.js';
import { handleApplicationInteraction } from '../utils/applicationHandler.js';

const channels = config.channels ?? {};

async function handleComponent(interaction) {
  if (await handleApplicationInteraction(interaction)) return true;
  if (await handleRobloxVerificationInteraction(interaction)) return true;
  if (await handleTicketInteraction(interaction)) return true;

  if (interaction.isStringSelectMenu() && interaction.customId === 'ayuda:tema') {
    const topic = HELP_TOPICS[interaction.values[0]];
    if (!topic) {
      await interaction.reply({ content: 'No reconozco esa opción. Ejecuta /ayuda e inténtalo de nuevo.', ephemeral: true });
      return true;
    }

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(topic.title)
      .setDescription(topic.description)
      .setFooter({ text: 'DevVerse Studios • Guía de la comunidad' });
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return true;
  }

  if (interaction.isModalSubmit() && interaction.customId === 'promocionar:formulario') {
    await interaction.deferReply({ ephemeral: true });

    const title = interaction.fields.getTextInputValue('titulo').trim();
    const rawUrl = interaction.fields.getTextInputValue('enlace').trim();
    const description = interaction.fields.getTextInputValue('descripcion').trim();
    const image = interaction.fields.getUploadedFiles('imagen')?.first() ?? null;
    let url;

    try {
      url = new URL(rawUrl);
    } catch {
      await interaction.editReply('El enlace no parece válido. Usa un enlace público de Roblox, por ejemplo https://www.roblox.com/games/…');
      return true;
    }

    // Roblox puede anteponer una ruta de idioma, por ejemplo /es/games/123/...
    const isRobloxHost = ['roblox.com', 'www.roblox.com', 'www.roblox.cn'].includes(url.hostname.toLowerCase());
    const isExperiencePath = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?games\/\d+(?:\/|$)/i.test(url.pathname);
    if (url.protocol !== 'https:' || !isRobloxHost || !isExperiencePath) {
      await interaction.editReply('Usa un enlace de una experiencia de Roblox con formato https://www.roblox.com/games/…');
      return true;
    }
    if (!title || !description) {
      await interaction.editReply('Completa el título y la descripción antes de enviar.');
      return true;
    }
    if (image && !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(image.contentType?.toLowerCase())) {
      await interaction.editReply('El archivo debe ser una imagen PNG, JPG, GIF o WEBP.');
      return true;
    }

    const channelId = channels.promoteYourGame || channels.mediaShare;
    if (!channelId) {
      await interaction.editReply('El canal de promoción no está configurado. Avísale al Staff.');
      return true;
    }

    try {
      const channel = await interaction.guild.channels.fetch(channelId);
      if (!channel) throw new Error('El canal configurado no existe.');

      const filename = image ? image.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100) : null;
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(title)
        .setURL(url.toString())
        .setDescription(description)
        .addFields({ name: 'Creador', value: `<@${interaction.user.id}>`, inline: true })
        .setFooter({ text: 'DevVerse Studios • Juego de Roblox' })
        .setTimestamp();
      if (filename) embed.setImage(`attachment://${filename}`);

      const postPayload = {
        content: `🎮 **Nuevo juego de la comunidad** • <@${interaction.user.id}>`,
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setLabel('🎮 Jugar ahora')
            .setStyle(ButtonStyle.Link)
            .setURL(url.toString()),
        )],
        allowedMentions: { users: [interaction.user.id] },
        ...(image ? { files: [{ attachment: image.url, name: filename }] } : {}),
      };

      if (channel.type === ChannelType.GuildForum || channel.type === ChannelType.GuildMedia) {
        // Los foros publican cada envío como un hilo/post; el título del juego queda como título del post.
        await channel.threads.create({
          name: title.slice(0, 100),
          message: postPayload,
          reason: `Promoción de juego enviada por ${interaction.user.tag}`,
        });
      } else if (channel.isTextBased() && channel.send) {
        await channel.send(postPayload);
      } else {
        throw new Error('El canal configurado no es un canal de texto ni un foro compatible.');
      }
      await interaction.editReply(`¡Publicado! Tu juego ya está en <#${channelId}>. 🚀`);
    } catch (error) {
      console.error('Error al publicar promoción:', error);
      await interaction.editReply('No pude publicar la ficha. Comprueba que el bot pueda ver y enviar mensajes en el canal de promoción.');
    }
    return true;
  }

  return false;
}

export default {
  name: Events.InteractionCreate,
  async execute(interaction, client) {
    try {
      if (await handleComponent(interaction)) return;
    } catch (error) {
      console.error('Error manejando componente interactivo:', error);
      const response = { content: 'Hubo un problema al procesar esta interacción. Inténtalo de nuevo.', ephemeral: true };
      if (interaction.deferred || interaction.replied) await interaction.followUp(response).catch(console.error);
      else await interaction.reply(response).catch(console.error);
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
      await command.execute(interaction);
    } catch (error) {
      console.error(`Error ejecutando /${interaction.commandName}:`, error);
      const response = {
        content: 'Ocurrió un error al ejecutar este comando.',
        ephemeral: true,
      };

      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(response).catch(console.error);
      } else {
        await interaction.reply(response).catch(console.error);
      }
    }
  },
};

