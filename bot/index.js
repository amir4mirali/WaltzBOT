import 'dotenv/config'
import { Bot, InlineKeyboard } from 'grammy'

const token = process.env.TELEGRAM_BOT_TOKEN
const miniAppUrl = process.env.MINI_APP_URL

if (!token) {
  console.error('Missing TELEGRAM_BOT_TOKEN in .env')
  process.exit(1)
}

if (!miniAppUrl) {
  console.error('Missing MINI_APP_URL in .env')
  process.exit(1)
}

const bot = new Bot(token)

const appKeyboard = new InlineKeyboard().webApp(
  'Открыть Waltzbot 💃',
  miniAppUrl,
)

bot.command('start', async (ctx) => {
  await ctx.reply(
    'Привет! Это Waltzbot для поиска пары на выпускной вальс. Нажми кнопку ниже, чтобы открыть мини-апп.',
    { reply_markup: appKeyboard },
  )
})

bot.command('app', async (ctx) => {
  await ctx.reply('Открываю мини-апп Waltzbot:', {
    reply_markup: appKeyboard,
  })
})

bot.on('message:text', async (ctx) => {
  await ctx.reply('Напиши /start или /app, чтобы открыть мини-апп.', {
    reply_markup: appKeyboard,
  })
})

bot.catch((err) => {
  console.error('Bot error:', err.error)
})

console.log('Waltzbot started in polling mode')
await bot.start()
