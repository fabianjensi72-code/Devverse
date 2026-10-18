const DAY_MS = 24 * 60 * 60 * 1000;
const HISTORY_DAYS = 7;
const MAX_TRACKED_MEMBERS = 10_000;
const activity = new Map();

/** Cuenta mensajes sin guardar contenido, solo para medir participación reciente. */
export function recordMemberMessage(guildId, userId, timestamp = Date.now()) {
  const day = Math.floor(timestamp / DAY_MS);
  let members = activity.get(guildId);
  if (!members) {
    members = new Map();
    activity.set(guildId, members);
  }

  const member = members.get(userId) ?? { days: new Map(), lastSeen: timestamp };
  for (const previousDay of member.days.keys()) {
    if (previousDay < day - HISTORY_DAYS + 1) member.days.delete(previousDay);
  }
  member.days.set(day, (member.days.get(day) ?? 0) + 1);
  member.lastSeen = timestamp;
  members.delete(userId);
  members.set(userId, member);

  if (members.size > MAX_TRACKED_MEMBERS) {
    const nowDay = Math.floor(Date.now() / DAY_MS);
    for (const [id, tracked] of members) {
      for (const previousDay of tracked.days.keys()) {
        if (previousDay < nowDay - HISTORY_DAYS + 1) tracked.days.delete(previousDay);
      }
      if (tracked.days.size === 0) members.delete(id);
      if (members.size <= MAX_TRACKED_MEMBERS) break;
    }
    while (members.size > MAX_TRACKED_MEMBERS) members.delete(members.keys().next().value);
  }
}

export function getTopActiveMembers(guildId, limit = 5) {
  const members = activity.get(guildId);
  if (!members) return [];
  const today = Math.floor(Date.now() / DAY_MS);
  const result = [];
  for (const [userId, member] of members) {
    let messages = 0;
    for (const [day, count] of member.days) {
      if (day >= today - HISTORY_DAYS + 1) messages += count;
    }
    if (messages > 0) result.push({ userId, messages, lastSeen: member.lastSeen });
  }
  return result.sort((a, b) => b.messages - a.messages || b.lastSeen - a.lastSeen).slice(0, limit);
}

