import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dataDirectory = fileURLToPath(new URL('../data/', import.meta.url));
const statePath = path.join(dataDirectory, 'roblox-verification.json');
const expiresAfterMs = 15 * 60 * 1000;
let stateQueue = Promise.resolve();

async function readState() {
  try {
    return JSON.parse(await readFile(statePath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { settings: {}, pending: {}, robloxLinks: {} };
  }
}

function updateState(update) {
  const task = stateQueue.then(async () => {
    await mkdir(dataDirectory, { recursive: true });
    const state = await readState();
    const result = await update(state);
    const temporaryPath = `${statePath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, statePath);
    return result;
  });
  stateQueue = task.then(() => undefined, () => undefined);
  return task;
}

export async function getVerificationSettings() {
  const state = await readState();
  return state.settings ?? {};
}

export async function saveVerificationSettings(settings) {
  return updateState((state) => {
    state.settings = settings;
  });
}

async function lookupRobloxUser(username) {
  const response = await fetch('https://users.roblox.com/v1/usernames/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usernames: [username], excludeBannedUsers: false }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Roblox no respondió correctamente (HTTP ${response.status}).`);
  const result = await response.json();
  const user = result.data?.[0];
  if (!user?.id) throw new Error('No encontré ese nombre de usuario de Roblox. Revisa cómo está escrito.');
  return user;
}

export async function startRobloxVerification(discordUserId, username) {
  const cleanUsername = username.trim();
  if (!/^[A-Za-z0-9_]{3,20}$/.test(cleanUsername)) {
    throw new Error('Escribe tu nombre de usuario de Roblox (de 3 a 20 letras, números o guiones bajos).');
  }

  const user = await lookupRobloxUser(cleanUsername);
  const challenge = `DEVVERSE-${randomBytes(4).toString('hex').toUpperCase()}`;
  const expiresAt = Date.now() + expiresAfterMs;
  await updateState((state) => {
    state.pending ??= {};
    state.pending[discordUserId] = {
      robloxUserId: String(user.id),
      username: user.name,
      challenge,
      expiresAt,
    };
  });
  return { username: user.name, displayName: user.displayName, robloxUserId: String(user.id), challenge, expiresAt };
}

export async function completeRobloxVerification(guild, discordUserId) {
  const state = await readState();
  const settings = state.settings ?? {};
  const pending = state.pending?.[discordUserId];
  if (!pending) throw new Error('No tienes una verificación pendiente. Vuelve a iniciar desde el canal de verificación.');
  if (settings.guildId !== guild.id) throw new Error('La verificación no está configurada para este servidor.');
  if (pending.expiresAt < Date.now()) {
    await updateState((current) => { delete current.pending?.[discordUserId]; });
    throw new Error('El código venció. Inicia otra verificación para recibir uno nuevo.');
  }

  const profileResponse = await fetch(`https://users.roblox.com/v1/users/${encodeURIComponent(pending.robloxUserId)}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!profileResponse.ok) throw new Error(`No pude revisar el perfil de Roblox (HTTP ${profileResponse.status}). Inténtalo de nuevo.`);
  const profile = await profileResponse.json();
  if (!String(profile.description ?? '').includes(pending.challenge)) {
    throw new Error(`Todavía no veo el código en la descripción pública del perfil de Roblox de ${pending.username}. Añádelo y vuelve a pulsar el botón.`);
  }

  const linkedDiscordId = state.robloxLinks?.[pending.robloxUserId];
  if (linkedDiscordId && linkedDiscordId !== discordUserId) {
    throw new Error('Esa cuenta de Roblox ya está vinculada a otra cuenta de Discord. Contacta al Staff si crees que es un error.');
  }

  const member = await guild.members.fetch(discordUserId);
  const roleIds = [...new Set(settings.verifiedRoleIds ?? [])];
  const roles = roleIds.map((roleId) => guild.roles.cache.get(roleId)).filter(Boolean);
  if (roles.length !== roleIds.length || roles.length === 0) {
    throw new Error('Los roles de verificación ya no existen o no están configurados. Avísale a un administrador.');
  }

  await member.roles.add(roles, 'Cuenta de Roblox verificada mediante código de perfil.');
  const unverifiedRoles = (settings.unverifiedRoleIds ?? []).filter((roleId) => guild.roles.cache.has(roleId));
  if (unverifiedRoles.length) {
    await member.roles.remove(unverifiedRoles, 'Miembro completó la verificación de Roblox.');
  }

  await updateState((current) => {
    current.robloxLinks ??= {};
    current.pending ??= {};
    current.robloxLinks[pending.robloxUserId] = discordUserId;
    delete current.pending[discordUserId];
  });

  return { username: pending.username, robloxUserId: pending.robloxUserId, roleIds };
}

