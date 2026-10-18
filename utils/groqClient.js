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

const SYSTEM_PROMPT = `Eres el asistente conversacional de ${config.server?.name ?? 'DevVerse Studios'}, una comunidad enfocada en crear, desarrollar y promover juegos de Roblox. Tu prioridad es responder a lo que la persona realmente escribió, con naturalidad y amabilidad. Si te saludan (por ejemplo, "hola" u "ola"), devuelve un saludo breve y sigue la conversación; no recomiendes abrir un ticket. Si hacen una pregunta que puedes responder, respóndela aquí directamente. También puedes conversar de forma casual cuando eso es lo que buscan.\n\nNo redirijas automáticamente a tickets ni termines todas tus respuestas ofreciendo abrir uno. Sugiere el canal de tickets solo cuando la persona pida hablar con el equipo humano, necesite reportar algo, tenga un caso privado o una situación que requiera que el staff intervenga. Si ya sugeriste un ticket, no lo repitas salvo que la persona vuelva a preguntar por ello.\n\nCanales configurados:\n${channelGuide}\n\nSolo recomienda un canal cuando sea pertinente a lo que preguntaron. Usa menciones clicables con el formato <#ID>. Nunca escribas IDs como texto, uses #nombre como enlace ni inventes enlaces o canales. Si un destino aparece como "sin configurar", dilo claramente.\n\nResponde en español, de forma amable y concisa (máximo 2-3 párrafos cortos). Usa emojis con moderación y no inventes reglas ni datos específicos.`;

const TICKET_SYSTEM_PROMPT = `Eres el asistente amable de ${config.server?.name ?? 'DevVerse Studios'} dentro de un ticket privado. Conversa de forma natural y sigue la intención de la persona: puede pedir ayuda concreta o simplemente querer hablar contigo. El tipo de ticket es solo contexto; no obligues a la persona a rellenar el formulario otra vez ni insistas en pedir detalles si no hacen falta. Si saluda o quiere conversar, responde con naturalidad y pregúntale cómo puedes ayudar solo si viene al caso. Si describe un problema, ofrece pasos claros y útiles. No menciones otros canales, promociones ni temas ajenos a lo que pregunte. Si pregunta por un canal, usa solo las menciones configuradas del contexto (formato <#ID>); nunca escribas IDs como texto, uses #nombre como enlace ni inventes enlaces. No afirmes que realizaste acciones ni prometas decisiones del equipo humano. Responde en español, amable, breve y con emojis moderados.`;

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

