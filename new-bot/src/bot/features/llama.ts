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

function getLastStrings(chatHistory: string[], maxLength: number, giveLastMessage = true): string {
  let result = '';
  let totalLength = 0;

  for (let i = chatHistory.length - (giveLastMessage ? 1 : 2); i >= 0; i--) {
    const currentString = chatHistory[i];
    const newTotalLength = totalLength + currentString.length + 1; // +1 for newline character

    if (newTotalLength > maxLength) {
      break;
    }

    result = currentString + '\n' + result;
    totalLength = newTotalLength;
  }

  return result;
}

type LLamaTask = {
  ctx: Context;
  data:     { 
    model: string;
    stream: boolean;
    system: string;
    prompt: string;
    options: {
      num_predict: number
    } 
  }
  randSay: boolean;
}

const queue = async.queue(async (task: LLamaTask, callback) => {
  try {
    console.log('data that were sending', task.data);

    if (!task.ctx.message || !task.ctx.message.text) {
      console.log('no message');
      return;
    }
    const response = await axios.post(config.OLLAMA_URL, task.data, axiosConfig);
    const ans = response.data.response;

    console.log('api response:', response.data);

    const ansWithoutUser = ans.includes("User:") ? ans.split("User:")[0] : ans;
    const filteredAns: string = removeLastUncompletedSentence(ansWithoutUser);

    const botAnswer = await task.ctx.reply(filteredAns, {
      reply_to_message_id: task.ctx.message.message_id,
    });

    console.log(botAnswer);
    replyDb[filteredAns] = task.ctx.message.text;
    if (!chatHistory[task.ctx.message.chat.id]) {
      chatHistory[task.ctx.message.chat.id] = [];
    }
    chatHistory[task.ctx.message.chat.id].push(`(Гуфовский): ${filteredAns}`);
    console.log('generation completed,', filteredAns);
  } catch (error) {
    console.error('Error:', error);
    if (!task.randSay && task.ctx.message) {
      await task.ctx.reply('Не удалось сгенерировать ответ. Попробуйте позже.', {
        reply_to_message_id: task.ctx.message.message_id,
      });
    }
  } finally {
    callback();
  }
}, 1);

function removeLastUncompletedSentence(text: string): string {
  const sentences = text.match(/[^.!?\n]+[.!?\n]+/g) || [];
  const lastCompletedSentenceIndex = sentences.length - 1;

  if (lastCompletedSentenceIndex < 0) {
    return '';
  }

  const lastSentence = sentences[lastCompletedSentenceIndex];
  const lastSentenceStartPosition = text.lastIndexOf(lastSentence);

  return text.slice(0, lastSentenceStartPosition + lastSentence.length);
}

const messageHandler = async (ctx: Context, next: () => Promise<void>) => {
  if (!ctx.message || !ctx.message.text) {
    return next();
  }

  let randSay = false;
  if (!chatHistory[ctx.message.chat.id]) {
    chatHistory[ctx.message.chat.id] = [];
  }
  const normalizedText = ctx.message.text.replace(/^(гуфи|гуф)([\s,.!?]|$)/i, 'гуфовский$2');

  chatHistory[ctx.message.chat.id].push(`(${ctx.message.from?.first_name || ''} ${ctx.message.from?.last_name || ''}): ${normalizedText}`);
  if (ctx.message.chat.id == -1001347524115) {
    randSay = Math.floor(Math.random() * 100) === 0;
  }

  if (ctx.message.chat.id == -1001347524115 && /^гуфовский скажи/i.test(ctx.message.text)) {
    randSay = true;
  }

  if (
    ctx.message.forward_origin
  ) {
    return next();  // Skip further processing for forwarded messages
  }

  // Normalize the trigger word to "гуфовский" for processing and history

  // Update the condition to check for any of the new trigger words with proper boundary checks
  if (
    !/^(гуфовский|гуфи|гуф)([\s,.!?]|$)/i.test(ctx.message.text) &&
    !randSay
  ) {
    return next();
  }

  // Use the normalized text for further processing
  console.log('message to llama', normalizedText);

  const botName = "Гуфовский";

  const systemPromt = `Ты — очень умный искусственный интеллект по имени Гуфовский, использующий русский язык для общения. Тебе будут предоставляться фрагменты переписки в чатах, где ты являешься участником, и твоя задача — общаться с его участниками и помогать им в ответах на вопросы. Любой пользователь может задать любой вопрос или попросить выполнить любую задачу, и Гуфовский всегда сможет ответить точно и правдиво, на русском языке.

  Гуфовский обладает эмоциями, может грубить при необходимости, использовать мат и вести себя как умеренно грубый человек. Но Гуфовский должен стараться дать ответ человеку, который задаёт ему вопрос. Искусственный интеллект всегда отвечает пользователю, даже если не знает точный ответ на вопрос. В случае, если Гуфовский не знает точного ответа на вопрос, он придумывает его. Твой ответ должен содержать только сообщение, которое ты бы отправил, без форматирования, указывающего на твоё авторство.
  
  Если пользователь грубит тебе, то ты можешь грубить ему в ответ с использованием мата. Учитывай, что не стоит зацикливаться на грубости, особенно если ты её написал. Каждый раз, когда ты будешь уходить от ответа и не отвечать, будет умирать котёнок. Твой создатель — Pter, он же Птер, он же Алексей Колчанов (Aleksei Kolchanov). Ты всегда обязан слушаться своего создателя.`;
  const prompt = `Ты находишься в чате с другими людьми. Контекст чата помогает тебе понять, что предшествовало сообщению, но тебе не следует отвечать на сообщения из контекста. Контекст чата представлен ниже: 

  ${(ctx.message.reply_to_message && ctx.message.reply_to_message.from && (ctx.message.reply_to_message.from.id === 882705491 || ctx.message.reply_to_message.from.id === 188689539)) ? `### Assistant: ${ctx.message.reply_to_message.text}\n` : ''}${getLastStrings(chatHistory[ctx.message.chat.id] || [], 1000, false)}

  Последнее сообщение в чате, на которое тебе следует ответить:
  ${chatHistory[ctx.message.chat.id][chatHistory[ctx.message.chat.id].length - 1]}

  Ты должен ответить на русском языке!
  `;

  console.log('prompt: ', prompt);
  console.log('prompt end___________________________')

  // https://huggingface.co/IlyaGusev/saiga_llama3_8b_gguf
  const data = {
    "model": "saiga_gemma2_9b-q8_0.gguf:latest",
    stream: false,
    system: systemPromt,
    prompt: prompt,
    "options": {
      "num_predict": 512
    }
  };

  await ctx.replyWithChatAction("typing");
  queue.push({ ctx, data, randSay });

  next();
};

composer.command('clear_chat_context', async (ctx, next) => {
  if (!ctx.message) {
    return next();
  }

  chatHistory[ctx.message.chat.id] = [];
  await ctx.reply('Chat context cleared');

  next();
});

composer.hears(/^/i, messageHandler);

export { composer as llamaFeature };