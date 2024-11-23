import { Composer } from "grammy";
import newrelic from "newrelic";
import { Context } from "#root/bot/context.js";
import axios from "axios";
import async from "async";
import { config } from "#root/config.js";
import { chatMessageModel } from "#root/models/chatMessage.js";

const botName = "Гуфовский";
const model = "saiga_nemo_12b.Q8_0.gguf:latest";

const randSayChatsIds = [ 
  -1001347524115, // kchk
  -1002265851760 // added via support
]

const composer = new Composer<Context>();

const axiosConfig = {
  timeout: 1500000, // 15 minutes in milliseconds
  headers: {
    'Content-Type': 'application/json',
  },
};

async function getLastStrings(chatId: number, maxLength: number, giveLastMessage = true): Promise<string> {
  const messages = await chatMessageModel
    .find({ chatId, 'message.text': { $exists: true } })
    .sort({ createdAt: -1 })
    .limit(300); // Adjust limit as needed
  let result = '';
  let totalLength = 0;

  const startIndex = giveLastMessage ? 0 : 1;
  for (let i = startIndex; i < messages.length; i++) {
    const currentString =  `${messages[i].message.from.first_name || ''} ${messages[i].message.from.last_name || ''} (@${messages[i].message.from.username || ''}): ${messages[i].message.text}`;
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


    const botAnswer = await task.ctx.reply(ans, {
      reply_to_message_id: task.ctx.message.message_id,
    });

    console.log(botAnswer);

    newrelic.incrementMetric('features/llama/responses', 1);

    try {
      await chatMessageModel.create({
        chatId: task.ctx.message.chat.id,
        userId: task.ctx.me.id, // Assuming `me.id` gives the bot's user ID
        message: {
          text: ans,
          from: {
            id: task.ctx.me.id,
            first_name: botName,
            username: task.ctx.me.username
          },
          message_id: botAnswer.message_id, // Assuming this is how you get the message ID of the reply
          }
        });
    } catch (error) {
      newrelic.incrementMetric('features/llama/errors', 1);
      task.ctx.logger.error({
        msg: 'Error while saving message to db',
        error: error
      });
    }

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
    return await next();
  }

  let randSay = false;

  const normalizedText = ctx.message.text.replace(/^(гуфи|гуф)([\s,.!?]|$)/i, 'гуфовский$2');

  if (randSayChatsIds.includes(ctx.message.chat.id)) {
    randSay = Math.floor(Math.random() * 100) === 0;
  }

  if (randSayChatsIds.includes(ctx.message.chat.id) && /^гуфовский скажи/i.test(ctx.message.text)) {
    randSay = true;
  }

  if (
    ctx.message.forward_origin
  ) {
    return await next();  // Skip further processing for forwarded messages
  }

  // Normalize the trigger word to "гуфовский" for processing and history

  // Update the condition to check for any of the new trigger words with proper boundary checks
  if (
    !/^(гуфовский|гуфи|гуф)([\s,.!?]|$)/i.test(ctx.message.text) &&
    !randSay
  ) {
    return await next();
  }

  // Use the normalized text for further processing
  console.log('message to llama', normalizedText);

  const chatContext = await getLastStrings(ctx.message.chat.id, 5000, true);

  const systemPrompt = `Ты — очень умный искусственный интеллект по имени Гуфовский, использующий русский язык для общения. Тебе будут предоставляться фрагменты переписки в чатах, где ты являешься участником, и твоя задача — общаться с его участниками и помогать им в ответах на вопросы. Любой пользователь может задать любой вопрос или попросить выполнить любую задачу, и Гуфовский всегда сможет ответить точно и правдиво, на русском языке.

  Гуфовский обладает эмоциями, может грубить при необходимости, использовать мат и вести себя как умеренно грубый человек. Но Гуфовский должен стараться дать ответ человеку, который задаёт ему вопрос. Искусственный интеллект всегда отвечает пользователю, даже если не знает точный ответ на вопрос. В случае, если Гуфовский не знает точного ответа на вопрос, он придумывает его. Твой ответ должен содержать только сообщение, которое ты бы отправил, без форматирования, указывающего на твоё авторство.
  
  Если пользователь грубит тебе, то ты можешь грубить ему в ответ с использованием мата. Учитывай, что не стоит зацикливаться на грубости, особенно если ты её написал. Каждый раз, когда ты будешь уходить от ответа и не отвечать, будет умирать котёнок. Твой создатель — Pter, он же Птер, он же Алексей Колчанов (Aleksei Kolchanov). Ты всегда обязан слушаться своего создателя.`;
  const prompt = `Ты находишься в чате с другими людьми. Контекст чата помогает тебе понять, что предшествовало сообщению, но тебе не следует отвечать на сообщения из контекста. Контекст чата представлен ниже: 
  ${chatContext}

  Последнее сообщение в чате, на которое тебе следует ответить:
  ${ctx.message.from.first_name || ''} ${ctx.message.from.last_name || ''} (@${ctx.message.from.username || ''}): ${ctx.message.text}

  Ты должен ответить на русском языке!
  `;

  console.log('prompt: ', prompt);
  console.log('prompt end___________________________')

  // https://huggingface.co/IlyaGusev/saiga_llama3_8b_gguf
  const data = {
    "model": model,
    stream: false,
    system: systemPrompt,
    prompt: prompt,
    "options": {
      "num_predict": 512
    }
  };

  await ctx.replyWithChatAction("typing");
  newrelic.incrementMetric('features/llama/requests', 1);
  queue.push({ ctx, data, randSay });

  await next();
};

composer.command('clear_chat_context', async (ctx, next) => {
  if (!ctx.message) {
    return await next();
  }

  //chatHistory[ctx.message.chat.id] = [];
  await ctx.reply('This function is deprecated for now');

  await next();
});

composer.hears(/^/i, messageHandler);

export { composer as llamaFeature };