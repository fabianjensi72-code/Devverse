import { ActivityType, Events } from 'discord.js';

export default {
  name: Events.ClientReady,
  once: true,
  execute(client) {
    console.log(`Bot conectado como ${client.user.tag}`);
    client.user.setPresence({
      activities: [{ name: 'DevVerse Studios', type: ActivityType.Watching }],
      status: 'online',
    });
  },
};
