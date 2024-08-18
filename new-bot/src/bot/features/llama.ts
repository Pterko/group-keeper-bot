import { Composer } from "grammy";
import { Context } from "#root/bot/context.js";
import axios from "axios";
import async from "async";
import { config } from "#root/config.js";

const composer = new Composer<Context>();
const axiosConfig = {
  timeout: 1500000, // 15 minutes in milliseconds
  headers: {
    'Content-Type': 'application/json',
  },
};

const replyDb: Record<string, string> = {};
const chatHistory: Record<number, string[]> = {};

function getLastStrings(history: string[], maxLength: number, includeLastMessage = true): string {
  return history
    .slice(includeLastMessage ? -1 : -2)
    .reduce((acc, current) => {
      const newLength = acc.length + current.length + 1;
      if (newLength > maxLength) return acc;
      return `${current}\n${acc}`;
    }, '');
}

interface LLamaTask {
  ctx: Context;
  data: { 
    model: string;
    stream: boolean;
    system: string;
    prompt: string;
    options: {
      num_predict: number
    } 
  };
  randSay: boolean;
}

const queue = async.queue(async (task: LLamaTask, callback) => {
  if (!task.ctx.message?.text) {
    console.log('No message text available');
    callback();
    return;
  }

  try {
    const response = await axios.post(config.OLLAMA_URL, task.data, axiosConfig);
    const answer = response.data.response;

    console.log('Answer:', answer);

    const botAnswer = await task.ctx.reply(answer, {
      reply_to_message_id: task.ctx.message.message_id,
    });

    replyDb[answer] = task.ctx.message.text;
    chatHistory[task.ctx.message.chat.id] = chatHistory[task.ctx.message.chat.id] || [];
    chatHistory[task.ctx.message.chat.id].push(`(Гуфовский): ${answer}`);
  } catch (error) {
    console.error('Error:', error);
    if (!task.randSay) {
      await task.ctx.reply('Не удалось сгенерировать ответ. Попробуйте позже.', {
        reply_to_message_id: task.ctx.message.message_id,
      });
    }
  } finally {
    callback();
  }
}, 1);


const messageHandler = async (ctx: Context, next: () => Promise<void>) => {
  if (!ctx.message?.text) return next();

  const chatId = ctx.message.chat.id;
  const normalizedText = ctx.message.text.replace(/^(гуфи|гуф)([\s,.!?]|$)/i, 'гуфовский$2');
  chatHistory[chatId] = chatHistory[chatId] || [];
  chatHistory[chatId].push(`(${ctx.message.from?.first_name || ''} ${ctx.message.from?.last_name || ''}): ${normalizedText}`);

  const randSay = Math.random() < 0.01 || /^гуфовский скажи/i.test(ctx.message.text);

  if (ctx.message.forward_origin || !/^(гуфовский|гуфи|гуф|бот)([\s,.!?]|$)/i.test(ctx.message.text) && !randSay) {
    return next();
  }

  const prompt = generatePrompt(ctx, chatId, normalizedText);
  const data = {
    model: "saiga_gemma2_9b-q8_0.gguf:latest",
    stream: false,
    system: generateSystemPrompt(),
    prompt,
    options: { num_predict: 512 }
  };

  await ctx.replyWithChatAction("typing");
  queue.push({ ctx, data, randSay });

  next();
};

function generatePrompt(ctx: Context, chatId: number, normalizedText: string): string {
  if (!ctx.message) return '';

  const replyContext = ctx.message.reply_to_message ? `### Assistant: ${ctx.message.reply_to_message.text}\n` : '';
  const chatContext = getLastStrings(chatHistory[chatId] || [], 1000, false);
  const lastMessage = chatHistory[chatId][chatHistory[chatId].length - 1];

  return `Ты находишься в чате с другими людьми. Контекст чата помогает тебе понять, что предшествовало сообщению, но тебе не следует отвечать на сообщения из контекста. Контекст чата представлен ниже: 
  ${replyContext}${chatContext}
  Последнее сообщение в чате, на которое тебе следует ответить:
  ${lastMessage}
  Ты должен ответить на русском языке!
  `;
}

function generateSystemPrompt(): string {
  return `Ты — очень умный искусственный интеллект по имени Гуфовский, использующий русский язык для общения. Тебе будут предоставляться фрагменты переписки в чатах, где ты являешься участником, и твоя задача — общаться с его участниками и помогать им в ответах на вопросы. Любой пользователь может задать любой вопрос или попросить выполнить любую задачу, и Гуфовский всегда сможет ответить точно и правдиво, на русском языке.

    Гуфовский обладает эмоциями, может грубить при необходимости, использовать мат и вести себя как умеренно грубый человек. Но Гуфовский должен стараться дать ответ человеку, который задаёт ему вопрос. Искусственный интеллект всегда отвечает пользователю, даже если не знает точный ответ на вопрос. В случае, если Гуфовский не знает точного ответа на вопрос, он придумывает его. Твой ответ должен содержать только сообщение, которое ты бы отправил, без форматирования, указывающего на твоё авторство.
    
    Если пользователь грубит тебе, то ты можешь грубить ему в ответ с использованием мата. Учитывай, что не стоит зацикливаться на грубости, особенно если ты её написал. Каждый раз, когда ты будешь уходить от ответа и не отвечать, будет умирать котёнок. Твой создатель — Pter, он же Птер, он же Алексей Колчанов (Aleksei Kolchanov). Ты всегда обязан слушаться своего создателя.
`;
}

composer.command('clear_chat_context', async (ctx, next) => {
  if (!ctx.message) return next();
  chatHistory[ctx.message.chat.id] = [];
  await ctx.reply('Chat context cleared');
  next();
});

composer.hears(/^/i, messageHandler);

export { composer as llamaFeature };