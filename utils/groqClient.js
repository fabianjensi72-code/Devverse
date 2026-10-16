import Groq from 'groq-sdk';
import config from '../config.json' with { type: 'json' };

const apiKey = process.env.GROQ_API_KEY;
const groq = apiKey && apiKey !== 'tu_groq_key_aqui' ? new Groq({ apiKey }) : null;

const channelNames = {
  rules: 'rules',
  promoteYourGame: 'promote-your-game',
  featuredGames: 'featured-games',
  botChannelId: 'commands-bot',
  createTicket: 'create-ticket',
  trailers: 'trailers',
  collaboration: 'colaboracion',
};

const channelGuide = Object.entries(channelNames)
  .map(([key, name]) => `#${name}: ${config.channels?.[key] ? `ID ${config.channels[key]}` : 'canal clave del servidor'}`)
  .join('\n');

const SYSTEM_PROMPT = `Eres el asistente de ${config.server?.name ?? 'DevVerse Studios'}, una comunidad enfocada en la creación, desarrollo y promoción de juegos de Roblox.\n\nCanales clave:\n${channelGuide}\n\nOrienta a los miembros al canal adecuado. #rules contiene las normas; #promote-your-game sirve para promocionar juegos; #featured-games muestra juegos destacados; #commands-bot es para comandos e interacción con el bot; #create-ticket ofrece soporte; #trailers es para trailers; y #colaboracion ayuda a encontrar desarrolladores, scripters, builders y UI designers.\n\nResponde de forma amable y concisa, en un máximo de 2-3 párrafos cortos. Usa emojis relevantes de Roblox y de la comunidad con moderación. No inventes reglas, canales ni datos específicos que no conozcas.`;

/** Consulta Groq con el contexto breve y estable del servidor. */
export async function askGroq(userQuestion, userTag) {
  if (!groq) throw new Error('GROQ_API_KEY no está configurada en el archivo .env.');

  const completion = await groq.chat.completions.create({
    model: 'openai/gpt-oss-120b',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Mi usuario es ${userTag}. Mi pregunta es: ${userQuestion}` },
    ],
    max_tokens: 350,
    temperature: 0.6,
  });

  return completion.choices[0]?.message?.content?.trim() || 'No pude generar una respuesta esta vez.';
}
