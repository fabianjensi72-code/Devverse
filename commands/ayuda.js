import {
  ActionRowBuilder,
  EmbedBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';
import config from '../config.json' with { type: 'json' };

const channels = config.channels ?? {};
export const HELP_TOPICS = {
  promocionar: {
    title: '🚀 Promocionar tu juego',
    description: `Comparte tu experiencia de Roblox en ${channels.promoteYourGame ? `<#${channels.promoteYourGame}>` : 'el canal de promoción'} o usa **/promocionar** para publicar una ficha ordenada. Incluye un enlace válido, una descripción clara y material propio. Publica solo en los canales de promoción y evita repetir anuncios o enviar publicidad por DM.`,
  },
  desarrolladores: {
    title: '👨‍💻 Encuentra colaboradores',
    description: `Busca colaboradores${channels.collaboration ? ` en <#${channels.collaboration}>` : ' en el canal de colaboración del servidor'}. Explica el alcance, el estilo y el estado del juego, e indica qué perfiles buscas: scripters, builders, UI designers o modeladores. Aclara desde el inicio si el trabajo es remunerado o por participación.`,
  },
  reglas: {
    title: '📜 Reglas y normas',
    description: 'Lee las reglas fijadas en el canal de normas. Mantén el respeto, evita spam y contenido no permitido, usa cada canal para su propósito, acredita el trabajo ajeno y solicita ayuda al Staff mediante Tickets.',
  },
  bot: {
    title: '🤖 Cómo usar el bot de IA',
    description: `Menciona al bot con tu pregunta${channels.botChannelId || channels.commandsBot ? ` o escribe en <#${channels.botChannelId || channels.commandsBot}>` : ' o escribe en el canal de comandos'} para pedir orientación sobre Roblox, desarrollo y la comunidad. También puedes probar **/ping**, **/ayuda** y **/promocionar**. No compartas contraseñas, tokens ni datos privados.`,
  },
};

export default {
  data: new SlashCommandBuilder()
    .setName('ayuda')
    .setDescription('Consulta guías rápidas para participar en DevVerse Studios.'),

  async execute(interaction) {
    const menu = new StringSelectMenuBuilder()
      .setCustomId('ayuda:tema')
      .setPlaceholder('Elige un tema para consultar')
      .addOptions(
        { label: '¿Cómo promocionar juegos?', value: 'promocionar', emoji: '🚀' },
        { label: 'Buscar desarrolladores', value: 'desarrolladores', emoji: '👨‍💻' },
        { label: 'Reglas del servidor', value: 'reglas', emoji: '📜' },
        { label: 'Usar el bot de IA', value: 'bot', emoji: '🤖' },
      );

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('🌌 Centro de ayuda • DevVerse Studios')
      .setDescription('Selecciona un tema del menú para ver una guía rápida para la comunidad de creadores de Roblox. 🎮')
      .setFooter({ text: 'Elige una opción del menú desplegable' });

    await interaction.reply({
      embeds: [embed],
      components: [new ActionRowBuilder().addComponents(menu)],
      ephemeral: true,
    });
  },
};
