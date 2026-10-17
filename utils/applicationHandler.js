import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import config from '../config.json' with { type: 'json' };

const dataDirectory = fileURLToPath(new URL('../data/', import.meta.url));
const statePath = path.join(dataDirectory, 'applications.json');
let queue = Promise.resolve();
let dmApplicationQueue = Promise.resolve();

// Ephemeral responses only make sense in guilds; DMs are already private.
function privateReply(interaction, payload) {
  return interaction.reply({ ...payload, ...(interaction.inGuild() ? { ephemeral: true } : {}) });
}

const commonQuestions = [
  ['Experiencia', 'Cuéntanos tu experiencia relacionada con este rol.'],
  ['Proyectos', 'Describe proyectos o trabajos tuyos y qué hiciste en ellos.'],
  ['Aporte', '¿Qué podrías aportar a DevVerse Studios?'],
  ['Disponibilidad', '¿Cuánto tiempo puedes dedicar por semana?'],
  ['Motivación', '¿Por qué quieres formar parte del equipo?'],
];

const roleQuestions = {
  Desarrollador: [
    ['Especialidad', '¿En qué área destacas: scripting, building, UI, modelado u otra?'],
    ['Luau', '¿Qué experiencia tienes con Luau y Roblox Studio?'],
    ['Diseño técnico', '¿Cómo organizas un sistema o proyecto antes de construirlo?'],
    ['Seguridad', '¿Cómo protegerías un RemoteEvent de exploits?'],
    ['Datos', '¿Qué cuidados tomarías al guardar datos de jugadores?'],
    ['Rendimiento', '¿Cómo buscarías y corregirías lag en una experiencia?'],
    ['Depuración', 'Describe un error difícil que hayas resuelto.'],
    ['Colaboración', '¿Cómo trabajas con scripters, builders y artistas?'],
    ['Herramientas', '¿Qué herramientas, plugins o sistemas sabes usar?'],
    ['Reto', '¿Cómo dividirías una mecánica grande en tareas pequeñas?'],
  ],
  Helper: [
    ['Experiencia de ayuda', '¿Has ayudado antes a comunidades o equipos?'],
    ['Trato', '¿Cómo responderías a una persona nueva que no entiende el servidor?'],
    ['Escalamiento', '¿Cuándo pasarías un caso a Moderación o Administración?'],
    ['Normas', '¿Cómo actuarías si un amigo rompe una regla?'],
    ['Privacidad', '¿Qué datos no compartirías fuera de un ticket?'],
    ['Claridad', '¿Cómo explicarías una solución técnica paso a paso?'],
    ['Conflicto', '¿Cómo ayudarías a dos miembros que están discutiendo?'],
    ['Límites', '¿Qué harías si no sabes responder una pregunta?'],
    ['Disponibilidad', '¿En qué horarios podrías apoyar normalmente?'],
    ['Caso práctico', 'Un miembro está frustrado por un bug: ¿qué harías primero?'],
  ],
  Moderador: [
    ['Experiencia', '¿Qué experiencia tienes moderando comunidades?'],
    ['Evidencia', '¿Cómo comprobarías un reporte antes de sancionar?'],
    ['Proporción', '¿Cómo elegirías entre advertencia, timeout o escalamiento?'],
    ['Imparcialidad', '¿Cómo evitarías favoritismos al moderar?'],
    ['Privacidad', '¿Cómo protegerías reportes y datos de usuarios?'],
    ['Apelación', '¿Cómo responderías a alguien que apela una sanción?'],
    ['Raid', '¿Qué harías si entran muchas cuentas y empiezan a hacer spam?'],
    ['Desacuerdo', '¿Qué harías si no estás de acuerdo con otro moderador?'],
    ['Disponibilidad', '¿En qué horarios y con qué frecuencia podrías moderar?'],
    ['Caso práctico', 'Un amigo publica un enlace sospechoso: ¿cómo actuarías?'],
  ],
};

const questionPages = Object.fromEntries(config.applications.roles.map((role) => {
  const specialized = roleQuestions[role.name] ?? roleQuestions.Desarrollador;
  return [role.id, [...commonQuestions, ...specialized]];
}));

async function readState() {
  try {
    return JSON.parse(await readFile(statePath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { guilds: {}, pending: {}, applications: {} };
  }
}

function updateState(callback) {
  const operation = queue.then(async () => {
    await mkdir(dataDirectory, { recursive: true });
    const state = await readState();
    const result = await callback(state);
    const tempPath = `${statePath}.${process.pid}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    await rename(tempPath, statePath);
    return result;
  });
  queue = operation.then(() => undefined, () => undefined);
  return operation;
}

export async function areApplicationsOpen(guildId) {
  await queue;
  const state = await readState();
  return state.guilds?.[guildId]?.enabled === true;
}

function panelComponents(enabled) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('application:apply')
      .setLabel('📝 Postúlate')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!enabled),
  )];
}

function panelEmbed(enabled) {
  return new EmbedBuilder()
    .setColor(enabled ? 0x5865f2 : 0x747f8d)
    .setTitle('🛠️ Postulaciones • DevVerse Studios')
    .setDescription(enabled
      ? '¿Quieres formar parte del equipo? Pulsa **Postúlate** y responde el formulario por mensaje privado. La postulación será revisada por el Founder.'
      : 'Las postulaciones están **cerradas por ahora**. Cuando el equipo las habilite, podrás enviar tu solicitud desde este panel.')
    .addFields({ name: 'Proceso', value: 'Te preguntaremos por tu experiencia, disponibilidad y cómo aportarías al equipo. Responde con honestidad; la decisión final la toma el Founder.' })
    .setFooter({ text: 'Nunca compartas contraseñas ni cookies de Roblox.' });
}

export async function publishApplicationPanel(interaction) {
  const message = await interaction.channel.send({
    embeds: [panelEmbed(false)],
    components: panelComponents(false),
  });
  await updateState((state) => {
    state.guilds ??= {};
    state.guilds[interaction.guildId] = { enabled: false, channelId: message.channelId, messageId: message.id };
  });
  return message;
}

export async function setApplicationsOpen(guild, enabled) {
  await queue;
  const state = await readState();
  const panel = state.guilds?.[guild.id];
  if (!panel?.channelId || !panel?.messageId) throw new Error('Primero publica el panel con /postulaciones panel.');
  const channel = await guild.channels.fetch(panel.channelId);
  const message = await channel.messages.fetch(panel.messageId);
  await message.edit({ embeds: [panelEmbed(enabled)], components: panelComponents(enabled) });
  await updateState((current) => {
    current.guilds[guild.id].enabled = enabled;
  });
}

function founderOnly(interaction) {
  if (!interaction.guild) return false;
  const isOwner = interaction.user.id === interaction.guild.ownerId;
  const memberRoles = interaction.member?.roles;
  const isFounder = memberRoles?.cache?.has(config.applications.reviewerRoleId)
    ?? memberRoles?.includes?.(config.applications.reviewerRoleId);
  return isOwner || Boolean(isFounder);
}

function buildApplicationMenu() {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('application:select-role')
    .setPlaceholder('Elige el rol al que quieres postularte')
    .addOptions(config.applications.roles.map((role) => ({ label: role.name, value: role.id })));
  return new ActionRowBuilder().addComponents(menu);
}

function questionEmbed(role, index) {
  const questions = questionPages[role.id];
  const [label, prompt] = questions[index];
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`📝 Postulación • ${role.name}`)
    .setDescription(`**Pregunta ${index + 1} de ${questions.length}: ${label}**\n${prompt}\n\nResponde escribiendo tu respuesta en este chat. Puedes escribir **cancelar** para detener la postulación.`)
    .setFooter({ text: 'Tus respuestas se guardan automáticamente.' });
}

function recommendation(answers) {
  const substantialAnswers = answers.filter((answer) => answer.trim().length >= 60).length;
  const hasPortfolioOrExample = answers[1].trim().length >= 50;
  const score = Math.round((substantialAnswers / answers.length) * 100);
  const label = score >= 75 && hasPortfolioOrExample
    ? 'Recomendación: **AVANZAR A ENTREVISTA**'
    : 'Recomendación: **PEDIR MÁS INFORMACIÓN / NO APROBAR AÚN**';
  return { score, label };
}

async function saveCompletedApplication(userId, answers) {
  const draft = await updateState((state) => state.pending?.[userId] ?? null);
  if (!draft) throw new Error('No encontré tu formulario pendiente. Vuelve a iniciar desde el panel.');
  if (draft.applicationId) {
    const existing = await getApplication(draft.applicationId);
    if (existing) return existing;
  }
  const role = config.applications.roles.find((item) => item.id === draft.roleId);
  const id = randomUUID().slice(0, 12);
  const recommendationResult = recommendation(answers);
  const application = {
    id,
    userId,
    guildId: draft.guildId,
    roleId: draft.roleId,
    roleName: role?.name ?? 'Rol desconocido',
    answers,
    score: recommendationResult.score,
    recommendation: recommendationResult.label,
    status: 'pending',
    createdAt: Date.now(),
  };
  await updateState((state) => {
    state.applications ??= {};
    state.applications[id] = application;
    state.pending[userId].applicationId = id;
  });
  return application;
}

async function finishApplication(message, draft) {
  const questions = questionPages[draft.roleId] ?? [];
  const role = config.applications.roles.find((item) => item.id === draft.roleId);
  if (!role || draft.answers.length !== questions.length) return false;

  const application = await saveCompletedApplication(message.author.id, draft.answers);
  const logChannel = await message.client.channels.fetch(config.applications.logChannelId);
  if (!logChannel?.isTextBased() || typeof logChannel.send !== 'function') {
    throw new Error('El canal privado de postulaciones no está configurado.');
  }
  const transcript = new AttachmentBuilder(Buffer.from(applicationTranscript(application), 'utf8'), { name: `postulacion-${application.id}.txt` });
  const reviewMessage = await logChannel.send({
    embeds: [reviewEmbed(application)],
    files: [transcript],
    components: reviewButtons(application.id),
    allowedMentions: { parse: [] },
  });
  await updateState((state) => {
    state.applications[application.id].logChannelId = reviewMessage.channelId;
    state.applications[application.id].logMessageId = reviewMessage.id;
    delete state.pending[message.author.id];
  });
  await message.channel.send('✅ ¡Listo! Tu postulación fue enviada al Founder para revisión. Te avisaré por este DM cuando haya una decisión.');
  return true;
}

async function processApplicationMessage(message) {
  const state = await readState();
  const draft = state.pending?.[message.author.id];
  if (!draft) return false;

  const content = message.content.trim();
  if (content.toLowerCase() === 'cancelar') {
    await updateState((current) => { delete current.pending[message.author.id]; });
    await message.channel.send('Postulación cancelada. Si quieres volver a empezar, pulsa **Postúlate** en el panel del servidor.');
    return true;
  }

  const role = config.applications.roles.find((item) => item.id === draft.roleId);
  const questions = questionPages[draft.roleId] ?? [];
  if (!role || !questions.length) {
    await message.channel.send('No encuentro el rol de tu formulario. Vuelve a iniciar la postulación desde el panel del servidor.');
    return true;
  }

  if (draft.answers.length >= questions.length) {
    try {
      await finishApplication(message, draft);
    } catch (error) {
      console.error('No se pudo enviar la postulación completa:', error);
      await message.channel.send('Ya guardé tus respuestas, pero no pude enviarlas al equipo. Avísale al staff para que revise el canal de postulaciones.');
    }
    return true;
  }

  if (content.length < 5) {
    await message.channel.send('Escribe una respuesta un poco más detallada (al menos 5 caracteres) para continuar.');
    await message.channel.send({ embeds: [questionEmbed(role, draft.answers.length)] });
    return true;
  }
  if (content.length > 1800) {
    await message.channel.send('Tu respuesta es muy larga. Resúmela a menos de 1800 caracteres, por favor.');
    await message.channel.send({ embeds: [questionEmbed(role, draft.answers.length)] });
    return true;
  }

  const nextDraft = await updateState((current) => {
    const pending = current.pending?.[message.author.id];
    if (!pending || pending.roleId !== draft.roleId) return null;
    pending.answers ??= [];
    pending.answers.push(content);
    return pending;
  });
  if (!nextDraft) {
    await message.channel.send('No pude guardar la respuesta. Vuelve a seleccionar el rol desde el panel e inténtalo otra vez.');
    return true;
  }

  if (nextDraft.answers.length >= questions.length) {
    await message.channel.send('📨 Ya tengo todas tus respuestas. Estoy enviando la postulación al equipo…');
    try {
      await finishApplication(message, nextDraft);
    } catch (error) {
      console.error('No se pudo enviar la postulación completa:', error);
      await message.channel.send('Guardé tus respuestas, pero no pude enviarlas al equipo. Avísale al staff para que revise el canal de postulaciones.');
    }
    return true;
  }

  await message.channel.send({ embeds: [questionEmbed(role, nextDraft.answers.length)] });
  return true;
}

export function handleApplicationMessage(message) {
  if (!message || message.guild || message.author?.bot) return Promise.resolve(false);
  const operation = dmApplicationQueue.then(() => processApplicationMessage(message));
  dmApplicationQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

function reviewEmbed(application) {
  const questions = questionPages[application.roleId] ?? [];
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle(`📝 Postulación • ${application.roleName}`)
    .setDescription(`**Postulante:** <@${application.userId}>\n**ID:** \`${application.userId}\`\n**Estado:** Pendiente de revisión\n\n**Evaluación automática de completitud (${application.score}%):** ${application.recommendation}\n_Es una guía de completitud, no una decisión automática._`)
    .setFooter({ text: `Postulación ${application.id} • Revisión exclusiva del Founder` })
    .setTimestamp(application.createdAt);
  application.answers.forEach((answer, index) => {
    embed.addFields({
      name: `${index + 1}. ${questions[index]?.[0] ?? `Pregunta ${index + 1}`}`.slice(0, 256),
      value: answer.slice(0, 250) || '—',
      inline: false,
    });
  });
  return embed;
}

function applicationTranscript(application) {
  const questions = questionPages[application.roleId] ?? [];
  return application.answers.map((answer, index) =>
    `${index + 1}. ${questions[index]?.[0] ?? `Pregunta ${index + 1}`}\n${answer}`,
  ).join('\n\n');
}

function reviewButtons(id) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`application:approve:${id}`).setLabel('✅ Aprobar').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`application:deny:${id}`).setLabel('❌ Denegar').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`application:other:${id}`).setLabel('🔁 Aprobar como otro rol').setStyle(ButtonStyle.Primary),
  )];
}

async function getApplication(id) {
  await queue;
  const state = await readState();
  return state.applications?.[id] ?? null;
}

async function updateApplication(id, changes) {
  return updateState((state) => {
    const application = state.applications?.[id];
    if (!application || application.status !== 'pending') return null;
    Object.assign(application, changes);
    return application;
  });
}

async function markReviewMessage(guild, application, statusText, color) {
  try {
    const channel = await guild.channels.fetch(application.logChannelId);
    const reviewMessage = await channel.messages.fetch(application.logMessageId);
    const updated = EmbedBuilder.from(reviewMessage.embeds[0])
      .setColor(color)
      .addFields({ name: 'Resolución', value: `${statusText}\nPor <@${application.reviewerId}>` });
    await reviewMessage.edit({ embeds: [updated], components: [] });
  } catch (error) {
    console.error('No se pudo actualizar el mensaje de revisión de la postulación:', error);
  }
}

async function grantRole(interaction, application, roleId, roleName) {
  const role = await interaction.guild.roles.fetch(roleId);
  const botMember = interaction.guild.members.me ?? await interaction.guild.members.fetchMe();
  if (!role || role.managed || role.position >= botMember.roles.highest.position) {
    throw new Error(`No puedo asignar ${roleName}: revisa la jerarquía del rol del bot.`);
  }
  const member = await interaction.guild.members.fetch(application.userId);
  await member.roles.add(role, `Postulación aprobada por el Founder: ${application.id}`);
  const updated = await updateApplication(application.id, {
    status: 'approved',
    reviewerId: interaction.user.id,
    grantedRoleId: role.id,
    grantedRoleName: role.name,
    reviewedAt: Date.now(),
  });
  if (!updated) throw new Error('Esta postulación ya fue revisada.');
  await markReviewMessage(interaction.guild, updated, `Aprobada como **${role.name}**`, 0x2ecc71);
  await member.send(`🎉 ¡Tu postulación a **${application.roleName}** en DevVerse Studios fue aprobada! Recibiste el rol **${role.name}**.`).catch(() => {});
  return role.name;
}

export async function handleApplicationInteraction(interaction) {
  const customId = interaction.customId ?? '';
  if (!customId.startsWith('application:')) return false;

  if (interaction.isButton() && customId === 'application:apply') {
    if (!interaction.guild || !(await areApplicationsOpen(interaction.guildId))) {
      await interaction.reply({ content: 'Las postulaciones están cerradas por ahora.', ephemeral: true });
      return true;
    }
    try {
      await updateState((state) => {
        state.pending ??= {};
        state.pending[interaction.user.id] = { guildId: interaction.guildId, roleId: null, answers: [] };
      });
      const dm = await interaction.user.createDM();
      await dm.send({
        embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('📝 Postulación a DevVerse Studios').setDescription('Primero elige el rol. Después te haré **15 preguntas, una por una** en este chat. Responde con un mensaje normal; puedes escribir **cancelar** cuando quieras.')],
        components: [buildApplicationMenu()],
      });
      await interaction.reply({ content: 'Te envié un mensaje privado para comenzar la postulación.', ephemeral: true });
    } catch {
      await interaction.reply({ content: 'No pude enviarte un DM. Activa los mensajes directos para miembros del servidor e inténtalo otra vez.', ephemeral: true });
    }
    return true;
  }

  if (interaction.isStringSelectMenu() && customId === 'application:select-role') {
    const role = config.applications.roles.find((item) => item.id === interaction.values[0]);
    if (!role) {
      await privateReply(interaction, { content: 'Ese rol ya no está disponible.' });
      return true;
    }
    const draft = await updateState((state) => {
      const current = state.pending?.[interaction.user.id];
      if (!current) return null;
      current.roleId = role.id;
      current.answers = [];
      return current;
    });
    if (!draft?.guildId) {
      await privateReply(interaction, { content: 'No pude asociar este formulario al servidor. Vuelve a iniciar desde el panel.' });
      return true;
    }
    await interaction.update({
      embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('📝 Rol seleccionado').setDescription(`Elegiste **${role.name}**. Empezamos la postulación aquí mismo, pregunta por pregunta.`)],
      components: [],
    });
    await interaction.channel.send({ embeds: [questionEmbed(role, 0)] });
    return true;
  }

  if (interaction.isButton() && /^application:(approve|deny|other):/.test(customId)) {
    if (!founderOnly(interaction)) {
      await interaction.reply({ content: 'Solo el Founder puede revisar postulaciones por ahora.', ephemeral: true });
      return true;
    }
    const [, action, id] = customId.split(':');
    const application = await getApplication(id);
    if (!application || application.status !== 'pending') {
      await interaction.reply({ content: 'Esta postulación ya fue revisada o no existe.', ephemeral: true });
      return true;
    }
    if (action === 'deny') {
      const modal = new ModalBuilder().setCustomId(`application:denyreason:${id}`).setTitle('Denegar postulación')
        .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder()
          .setCustomId('reason').setLabel('Motivo para el postulante').setStyle(TextInputStyle.Paragraph)
          .setMinLength(3).setMaxLength(500).setRequired(true)));
      await interaction.showModal(modal);
      return true;
    }
    if (action === 'other') {
      const available = config.applications.roles.filter((role) => role.id !== application.roleId);
      if (!available.length) {
        await interaction.reply({ content: 'No hay otros roles configurados para aprobar esta postulación.', ephemeral: true });
        return true;
      }
      const menu = new StringSelectMenuBuilder()
        .setCustomId(`application:other-role:${id}`)
        .setPlaceholder('Elige el rol que recibirá')
        .addOptions(available.map((role) => ({ label: role.name, value: role.id })));
      await interaction.reply({ content: 'Selecciona el rol alternativo:', components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
      return true;
    }
    await interaction.deferReply({ ephemeral: true });
    try {
      const role = config.applications.roles.find((item) => item.id === application.roleId);
      if (!role) throw new Error('El rol solicitado ya no está configurado.');
      const grantedRole = await grantRole(interaction, application, role.id, role.name);
      await interaction.editReply(`Aprobada. Se asignó **${grantedRole}** a <@${application.userId}>.`);
    } catch (error) {
      console.error('No se pudo aprobar la postulación:', error);
      if (interaction.deferred) await interaction.editReply('No pude aprobarla. Revisa que el miembro y el rol sigan disponibles, y que el rol del bot esté por encima.');
    }
    return true;
  }

  if (interaction.isStringSelectMenu() && customId.startsWith('application:other-role:')) {
    if (!founderOnly(interaction)) {
      await interaction.reply({ content: 'Solo el Founder puede revisar postulaciones.', ephemeral: true });
      return true;
    }
    const id = customId.split(':').at(-1);
    const application = await getApplication(id);
    const role = config.applications.roles.find((item) => item.id === interaction.values[0]);
    if (!application || application.status !== 'pending' || !role) {
      await interaction.reply({ content: 'La postulación o el rol seleccionado ya no están disponibles.', ephemeral: true });
      return true;
    }
    await interaction.deferReply({ ephemeral: true });
    try {
      const grantedRole = await grantRole(interaction, application, role.id, role.name);
      await interaction.editReply(`Aprobada como **${grantedRole}**.`);
    } catch (error) {
      console.error('No se pudo aprobar con otro rol:', error);
      await interaction.editReply('No pude asignar ese rol. Revisa la posición del rol del bot.');
    }
    return true;
  }

  if (interaction.isModalSubmit() && customId.startsWith('application:denyreason:')) {
    if (!founderOnly(interaction)) {
      await interaction.reply({ content: 'Solo el Founder puede revisar postulaciones.', ephemeral: true });
      return true;
    }
    const id = customId.split(':').at(-1);
    const application = await getApplication(id);
    if (!application || application.status !== 'pending') {
      await interaction.reply({ content: 'Esta postulación ya fue revisada o no existe.', ephemeral: true });
      return true;
    }
    const reason = interaction.fields.getTextInputValue('reason').trim();
    const updated = await updateApplication(id, { status: 'denied', reviewerId: interaction.user.id, reviewReason: reason, reviewedAt: Date.now() });
    if (!updated) {
      await interaction.reply({ content: 'Esta postulación ya fue revisada.', ephemeral: true });
      return true;
    }
    await interaction.reply({ content: 'Postulación denegada y notificación enviada al postulante.', ephemeral: true });
    await markReviewMessage(interaction.guild, updated, `Denegada\nMotivo: ${reason}`, 0xe74c3c);
    const member = await interaction.guild.members.fetch(application.userId).catch(() => null);
    await member?.send(`Gracias por postularte a **${application.roleName}** en DevVerse Studios. Por ahora no fue aprobada. Motivo: ${reason}`).catch(() => {});
    return true;
  }

  return true;
}

