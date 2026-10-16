import Groq from 'groq-sdk';
import config from '../config.json' with { type: 'json' };

const apiKey = process.env.GROQ_API_KEY;
// Usa el fetch nativo de Node (Undici), igual que la prueba directa de Termux.
// Esto evita cierres prematuros observados con node-fetch en algunos móviles.
const groq = apiKey && apiKey !== 'tu_groq_key_aqui'
  ? new Groq({ apiKey, fetch: globalThis.fetch })
  : null;
const globalIntervalMs = Math.max(0, Number(config.cooldowns?.aiGlobalSeconds ?? 2)) * 1000;
let requestQueue = Promise.resolve();
let lastRequestAt = 0;

function queuedCompletion(payload) {
  const request = requestQueue.then(async () => {
    const waitMs = Math.max(0, globalIntervalMs - (Date.now() - lastRequestAt));
    if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
    lastRequestAt = Date.now();
    return groq.chat.completions.create(payload);
  });
  requestQueue = request.then(() => undefined, () => undefined);
  return request;
}

const channelNames = {
  rules: 'rules',
  promoteYourGame: 'promote-your-game',
  featuredGames: 'featured-games',
  commandsBot: 'commands-bot',
  createTicket: 'create-ticket',
  trailers: 'trailers',
  collaboration: 'colaboracion',
};

const channelGuide = Object.entries(channelNames)
  .map(([key, name]) => {
    const channelId = config.channels?.[key];
    return channelId ? `${name}: <#${channelId}>` : `${name}: sin configurar; no recomiendes ni inventes un enlace`;
  })
  .join('\n');

const SYSTEM_PROMPT = `Eres el asistente de ${config.server?.name ?? 'DevVerse Studios'}, una comunidad enfocada en la creación, desarrollo y promoción de juegos de Roblox.\n\nCanales configurados:\n${channelGuide}\n\nOrienta a los miembros al canal adecuado. Responde con menciones de canal de Discord tal como aparecen arriba (formato <#ID>) para que sean clicables. Nunca escribas IDs como texto, nunca uses #nombre como si fuera un enlace y nunca inventes un ID o canal. Si el canal solicitado aparece como "sin configurar", explica que no tienes un destino configurado y no fabriques un enlace.\n\nResponde de forma amable y concisa, en un máximo de 2-3 párrafos cortos. Usa emojis relevantes de Roblox y de la comunidad con moderación. No inventes reglas ni datos específicos que no conozcas.`;

const TICKET_SYSTEM_PROMPT = `Eres el asistente de soporte de ${config.server?.name ?? 'DevVerse Studios'} dentro de un ticket privado. Tu prioridad es ayudar a la persona con la solicitud de este ticket; mantente en el tema y responde con pasos útiles, claros y amables. No cambies a una conversación general sobre el servidor ni menciones otros canales, promociones o temas ajenos al ticket, salvo que la persona pregunte explícitamente por ellos. Si preguntan por un canal, usa solo las menciones configuradas del contexto (formato <#ID>); nunca escribas IDs como texto, uses #nombre como enlace ni inventes enlaces. No afirmes que has realizado acciones ni prometas decisiones del equipo humano. Si faltan datos, pregunta solo lo necesario. Responde en español, breve y con emojis moderados.`;

/** Consulta Groq con el contexto breve y estable del servidor. */
export async function askGroq(userQuestion, userTag, context = {}) {
  if (!groq) throw new Error('GROQ_API_KEY no está configurada en el archivo .env.');

  const completion = await queuedCompletion({
    model: 'openai/gpt-oss-120b',
    messages: [
      {
        role: 'system',
        content: context.inTicket
          ? `${TICKET_SYSTEM_PROMPT}\n\nTipo de ticket: ${context.ticketType || 'soporte general'}.\n\nCanales del servidor, solo si preguntan por ellos:\n${channelGuide}`
          : SYSTEM_PROMPT,
      },
      { role: 'user', content: `Mi usuario es ${userTag}. Mi pregunta es: ${userQuestion}` },
    ],
    max_tokens: 350,
    temperature: 0.6,
  });

  return completion.choices[0]?.message?.content?.trim() || 'No pude generar una respuesta esta vez. Inténtalo de nuevo.';
}

/** Resume la conversación de un ticket para el miembro del staff que lo reclama. */
export async function summarizeTicketWithGroq(conversation, requesterName, staffName) {
  if (!groq) throw new Error('GROQ_API_KEY no está configurada en el archivo .env.');

  const completion = await queuedCompletion({
    model: 'openai/gpt-oss-120b',
    messages: [
      {
        role: 'system',
        content: 'Resume conversaciones de soporte en español para que un administrador entienda rápidamente el caso. Escribe una sola frase breve y natural, sin viñetas ni lista de mensajes. No inventes hechos ni des consejos; identifica el problema o motivo principal y cualquier dato importante. Si no hay contexto suficiente, dilo con claridad.',
      },
      {
        role: 'user',
        content: `Prepara un resumen para ${staffName} sobre la solicitud de ${requesterName}. Conversación reciente:\n${conversation.slice(0, 5000)}`,
      },
    ],
    max_tokens: 110,
    temperature: 0.2,
  });

  return completion.choices[0]?.message?.content?.trim() || 'No se pudo generar el resumen de esta conversación.';
}

/** Traduce un mensaje en inglés al español sin añadir respuestas ni explicaciones. */
export async function translateEnglishToSpanish(text) {
  if (!groq) throw new Error('GROQ_API_KEY no está configurada en el archivo .env.');

  const completion = await queuedCompletion({
    model: 'openai/gpt-oss-120b',
    messages: [
      {
        role: 'system',
        content: 'Traduce el mensaje recibido del inglés al español natural. Devuelve únicamente la traducción, sin prefacios, comentarios, respuestas ni comillas. Conserva nombres propios, enlaces, IDs, formato de código y el sentido original.',
      },
      { role: 'user', content: text.slice(0, 1800) },
    ],
    max_tokens: 650,
    temperature: 0.1,
  });

  return completion.choices[0]?.message?.content?.trim() || '';
}

