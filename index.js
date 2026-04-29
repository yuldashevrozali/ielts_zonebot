require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const mongoose    = require('mongoose');
const { User, ReferralLog } = require('./models');

const BOT_TOKEN    = process.env.BOT_TOKEN;
const MONGODB_URI  = process.env.MONGODB_URI  || 'mongodb://localhost:27017/ieltsbot';
const ADMIN_ID     = Number(process.env.ADMIN_CHAT_ID);
const ADMIN_USER   = process.env.ADMIN_USERNAME || 'yuldashev_frontend';
const CHANNEL_1    = process.env.CHANNEL_1  || 'ieltszonefergana';
const CHANNEL_2    = process.env.CHANNEL_2  || 'Ieltszoneferganamock';
const BOT_USERNAME = process.env.BOT_USERNAME || 'YourBotUsername';
const CDI_PRICE    = 30;

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

mongoose.connect(MONGODB_URI)
  .then(() => console.log('✅ MongoDB ulandi'))
  .catch(err => { console.error('❌ MongoDB xato:', err); process.exit(1); });

function isAdmin(userId) { return userId === ADMIN_ID; }

function genRefCode() {
  return Math.random().toString(36).slice(2, 9).toUpperCase();
}

async function getOrCreateUser(msg, referralCode = null) {
  const id = msg.from.id;
  let user = await User.findOne({ telegramId: id });
  if (!user) {
    let code;
    do { code = genRefCode(); } while (await User.findOne({ referralCode: code }));
    user = await User.create({
      telegramId:   id,
      username:     msg.from.username   || null,
      firstName:    msg.from.first_name || '',
      lastName:     msg.from.last_name  || '',
      referralCode: code,
    });
    if (referralCode) {
      const referrer = await User.findOne({ referralCode });
      if (referrer && referrer.telegramId !== id) {
        user.referredBy = referrer.telegramId;
        await user.save();
      }
    }
    return { user, isNew: true };
  }
  return { user, isNew: false };
}

async function checkSubscription(userId) {
  try {
    const [s1, s2] = await Promise.all([
      bot.getChatMember(`@${CHANNEL_1}`, userId),
      bot.getChatMember(`@${CHANNEL_2}`, userId),
    ]);
    const ok = s => ['member','administrator','creator'].includes(s.status);
    return ok(s1) && ok(s2);
  } catch { return false; }
}

function mainMenu() {
  return {
    reply_markup: {
      keyboard: [
        ['🛒 CDI sotib olish', '👤 Hisobim'],
        ['🎁 Ball ishlash'],
      ],
      resize_keyboard: true,
    }
  };
}

function adminMenu() {
  return {
    reply_markup: {
      keyboard: [
        ['👥 Jami userlar', '🏆 Top 15'],
        ['➕ Ball qosh', '➖ Ball ayir'],
        ['📢 Hammaga xabar', '🔄 Hammanı 0 ga tushir'],
        ['🔙 Chiqish'],
      ],
      resize_keyboard: true,
    }
  };
}

async function sendSubscribeMessage(chatId) {
  await bot.sendMessage(chatId,
    `👋 <b>Xush kelibsiz!</b>\n\nBotdan foydalanish uchun quyidagi kanallarga obuna bo'ling:\n\n` +
    `📢 1. @${CHANNEL_1}\n📢 2. @${CHANNEL_2}\n\nObuna bo'lgach, pastdagi <b>✅ Tekshirish</b> tugmasini bosing.`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { text: `📢 Kanal 1`, url: `https://t.me/${CHANNEL_1}` },
            { text: `📢 Kanal 2`, url: `https://t.me/${CHANNEL_2}` },
          ],
          [{ text: '✅ Tekshirish', callback_data: 'check_sub' }]
        ]
      }
    }
  );
}

// ─── /start ───────────────────────────────────────────────────────────────────
bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
  const chatId   = msg.chat.id;
  const refParam = match[1] ? match[1].trim() : null;
  const { user, isNew } = await getOrCreateUser(msg, refParam);

  if (!isNew && !user.subscribed) {
    await sendSubscribeMessage(chatId);
    return;
  }
  if (!isNew && user.subscribed) {
    await bot.sendMessage(chatId,
      `👋 Qaytib keldingiz, <b>${user.firstName}</b>!\n\nMenulardan foydalaning:`,
      { parse_mode: 'HTML', ...mainMenu() }
    );
    return;
  }
  await sendSubscribeMessage(chatId);
});

// ─── /adminman ────────────────────────────────────────────────────────────────
bot.onText(/\/adminman/, async (msg) => {
  if (!isAdmin(msg.from.id)) {
    await bot.sendMessage(msg.chat.id, '❌ Siz admin emassiz!');
    return;
  }
  await bot.sendMessage(msg.chat.id,
    `🔐 <b>Admin paneliga xush kelibsiz!</b>\n\nKerakli bo'limni tanlang:`,
    { parse_mode: 'HTML', ...adminMenu() }
  );
});

// ─── Admin state ──────────────────────────────────────────────────────────────
const adminState = new Map();

// ─── Admin: Jami userlar ──────────────────────────────────────────────────────
bot.onText(/👥 Jami userlar/, async (msg) => {
  if (!isAdmin(msg.from.id)) return;
  const count = await User.countDocuments();
  await bot.sendMessage(msg.chat.id,
    `👥 <b>Jami foydalanuvchilar: ${count} ta</b>`,
    { parse_mode: 'HTML', ...adminMenu() }
  );
});

// ─── Admin: Top 15 ────────────────────────────────────────────────────────────
bot.onText(/🏆 Top 15/, async (msg) => {
  if (!isAdmin(msg.from.id)) return;
  const top = await User.find().sort({ balance: -1 }).limit(15);
  if (!top.length) {
    await bot.sendMessage(msg.chat.id, "Hali foydalanuvchilar yo'q.", adminMenu());
    return;
  }
  const medals = ['🥇','🥈','🥉'];
  let text = `🏆 <b>Top 15 — Eng ko'p ball to'plaganlar</b>\n\n`;
  top.forEach((u, i) => {
    const medal = medals[i] || `${i + 1}.`;
    const name  = [u.firstName, u.lastName].filter(Boolean).join(' ') || 'Nomsiz';
    const uname = u.username ? ` @${u.username}` : '';
    text += `${medal} ${name}${uname} — <b>${u.balance} ball</b>\n`;
  });
  await bot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML', ...adminMenu() });
});

// ─── Admin: Ball qosh (bitta yoki hammaga) ────────────────────────────────────
bot.onText(/➕ Ball qosh/, async (msg) => {
  if (!isAdmin(msg.from.id)) return;
  adminState.set(msg.from.id, { action: 'add_ball', step: 'choose_target' });
  await bot.sendMessage(msg.chat.id,
    `➕ <b>Ball qo'shish</b>\n\nKimga qo'shmoqchisiz?`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '👤 Bitta userga', callback_data: 'ball_target_one_add' },
            { text: '👥 Hammaga', callback_data: 'ball_target_all_add' },
          ]
        ]
      }
    }
  );
});

// ─── Admin: Ball ayir (bitta yoki hammadan) ───────────────────────────────────
bot.onText(/➖ Ball ayir/, async (msg) => {
  if (!isAdmin(msg.from.id)) return;
  adminState.set(msg.from.id, { action: 'remove_ball', step: 'choose_target' });
  await bot.sendMessage(msg.chat.id,
    `➖ <b>Ball ayirish</b>\n\nKimdan ayirmoqchisiz?`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '👤 Bitta userdan', callback_data: 'ball_target_one_remove' },
            { text: '👥 Hammadan', callback_data: 'ball_target_all_remove' },
          ]
        ]
      }
    }
  );
});

// ─── Admin: Hammaga xabar ─────────────────────────────────────────────────────
bot.onText(/📢 Hammaga xabar/, async (msg) => {
  if (!isAdmin(msg.from.id)) return;
  adminState.set(msg.from.id, { action: 'broadcast', step: 'ask_message' });
  await bot.sendMessage(msg.chat.id,
    `📢 <b>Hammaga xabar yuborish</b>\n\nYubormoqchi bo'lgan xabaringizni yozing:\n\n<i>(HTML teglari ishlaydi: &lt;b&gt;, &lt;i&gt;, &lt;a href=""&gt;)</i>`,
    { parse_mode: 'HTML', reply_markup: { remove_keyboard: true } }
  );
});

// ─── Admin: Hammanı 0 ga tushir ───────────────────────────────────────────────
bot.onText(/🔄 Hammanı 0 ga tushir/, async (msg) => {
  if (!isAdmin(msg.from.id)) return;
  await bot.sendMessage(msg.chat.id,
    `⚠️ <b>Diqqat!</b>\n\nBarcha foydalanuvchilarning bali <b>0 ga</b> tushiriladi.\n\nRostan ham davom ettirasizmi?`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ Ha, tushir', callback_data: 'reset_all_confirm' },
          { text: '❌ Bekor qilish', callback_data: 'reset_all_cancel' },
        ]]
      }
    }
  );
});

// ─── Admin: Chiqish ───────────────────────────────────────────────────────────
bot.onText(/🔙 Chiqish/, async (msg) => {
  if (!isAdmin(msg.from.id)) return;
  adminState.delete(msg.from.id);
  await bot.sendMessage(msg.chat.id, `✅ Admin paneldan chiqdingiz.`, { parse_mode: 'HTML', ...mainMenu() });
});

// ─── 👤 Hisobim ───────────────────────────────────────────────────────────────
bot.onText(/👤 Hisobim/, async (msg) => {
  const chatId = msg.chat.id;
  const user   = await User.findOne({ telegramId: msg.from.id });
  if (!user) { await bot.sendMessage(chatId, 'Iltimos /start ni bosing.'); return; }
  const name  = [user.firstName, user.lastName].filter(Boolean).join(' ') || 'Nomsiz';
  const uname = user.username ? `@${user.username}` : "Yo'q";
  await bot.sendMessage(chatId,
    `👤 <b>Mening hisobim</b>\n\n` +
    `📛 Ism: ${name}\n🔗 Username: ${uname}\n` +
    `💰 Ballar: <b>${user.balance} ball</b>\n` +
    `👥 Taklif qilinganlar: ${user.referralCount} kishi\n` +
    `🛒 CDI xarid: ${user.hasPurchased ? '✅ Xarid qilingan' : '❌ Xarid qilinmagan'}`,
    { parse_mode: 'HTML', ...mainMenu() }
  );
});

// ─── 🎁 Ball ishlash ──────────────────────────────────────────────────────────
bot.onText(/🎁 Ball ishlash/, async (msg) => {
  const chatId = msg.chat.id;
  const user   = await User.findOne({ telegramId: msg.from.id });
  if (!user) { await bot.sendMessage(chatId, 'Iltimos /start ni bosing.'); return; }
  const refLink = `https://t.me/${BOT_USERNAME}?start=${user.referralCode}`;
  await bot.sendMessage(chatId,
    `🎁 <b>Do'stlarni taklif qilib ball ishlang!</b>\n\n` +
    `Har bir yangi do'st havola orqali botga qo'shilganda sizga <b>+1 ball</b> beriladi!\n\n` +
    `🔗 <b>Sizning havolangiz:</b>\n<code>${refLink}</code>\n\n` +
    `👥 Taklif qilganlar: <b>${user.referralCount}</b> kishi\n` +
    `💰 Joriy balingiz: <b>${user.balance} ball</b>`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[
          {
            text: "📤 Do'stlarga ulashish",
            url: `https://t.me/share/url?url=${encodeURIComponent("🎓 IELTS Zone Fergana botiga qo'shiling!")}&text=${encodeURIComponent(refLink)}`
          }
        ]]
      }
    }
  );
});

// ─── 🛒 CDI sotib olish ───────────────────────────────────────────────────────
bot.onText(/🛒 CDI sotib olish/, async (msg) => {
  const chatId = msg.chat.id;
  const user   = await User.findOne({ telegramId: msg.from.id });
  if (!user) { await bot.sendMessage(chatId, 'Iltimos /start ni bosing.'); return; }
  await bot.sendMessage(chatId,
    `🛒 <b>CDI sotib olish</b>\n\nNarxi: <b>${CDI_PRICE} ball</b>\nSizning balingiz: <b>${user.balance} ball</b>\n\nSotib olishni tasdiqlaysizmi?`,
    {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: '💳 Sotib olish', callback_data: 'buy_cdi' }]] }
    }
  );
});

// ─── Callback handler ─────────────────────────────────────────────────────────
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const data   = query.data;

  // ── Obuna tekshirish ────────────────────────────────────────────────────────
  if (data === 'check_sub') {
    const user = await User.findOne({ telegramId: userId });
    if (!user) {
      await bot.answerCallbackQuery(query.id, { text: 'Iltimos /start bosing.', show_alert: true });
      return;
    }
    const isSub = await checkSubscription(userId);
    if (!isSub) {
      await bot.answerCallbackQuery(query.id, {
        text: "❌ Ikkala kanalga ham obuna bo'ling, so'ng tekshiring!",
        show_alert: true
      });
      return;
    }
    await bot.answerCallbackQuery(query.id, { text: '✅ Obuna tasdiqlandi!' });

    user.subscribed = true;
    let bonusText = '';
    if (!user.startBonus) {
      user.balance   += 5;
      user.startBonus = true;
      bonusText = `\n\n🎉 <b>Tabriklaymiz!</b> Kanallarga obuna bo'lganingiz uchun sizga <b>5 ball</b> taqdim qilindi!`;
      if (user.referredBy) {
        const alreadyLogged = await ReferralLog.findOne({ newUserId: userId });
        if (!alreadyLogged) {
          await ReferralLog.create({ referrerId: user.referredBy, newUserId: userId });
          await User.findOneAndUpdate(
            { telegramId: user.referredBy },
            { $inc: { balance: 1, referralCount: 1 } }
          );
          try {
            await bot.sendMessage(user.referredBy,
              `🎁 Siz taklif qilgan do'stingiz botga qo'shildi! Hisobingizga <b>+1 ball</b> qo'shildi.`,
              { parse_mode: 'HTML' }
            );
          } catch {}
        }
      }
    }
    await user.save();
    try {
      await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
        chat_id: chatId, message_id: query.message.message_id
      });
    } catch {}

    if (user.phone) {
      await bot.sendMessage(chatId,
        `✅ <b>Obuna tasdiqlandi!</b>${bonusText}\n\n💰 Joriy balingiz: <b>${user.balance} ball</b>\n\n👇 Menyudan foydalaning:`,
        { parse_mode: 'HTML', ...mainMenu() }
      );
    } else {
      await bot.sendMessage(chatId,
        `✅ <b>Obuna tasdiqlandi!</b>${bonusText}\n\n📱 Endi telefon raqamingizni ulashing:`,
        {
          parse_mode: 'HTML',
          reply_markup: {
            keyboard: [[{ text: '📱 Kontakt ulashish', request_contact: true }]],
            resize_keyboard: true,
            one_time_keyboard: true,
          }
        }
      );
    }
    return;
  }

  // ── CDI sotib olish ─────────────────────────────────────────────────────────
  if (data === 'buy_cdi') {
    await bot.answerCallbackQuery(query.id);
    const user = await User.findOne({ telegramId: userId });
    if (!user) { await bot.sendMessage(chatId, 'Iltimos /start ni bosing.'); return; }
    if (user.balance >= CDI_PRICE) {
      user.balance     -= CDI_PRICE;
      user.hasPurchased = true;
      await user.save();
      const name  = [user.firstName, user.lastName].filter(Boolean).join(' ') || 'Nomsiz';
      const uname = user.username ? `@${user.username}` : "Yo'q";
      await bot.sendMessage(chatId,
        `✅ <b>Siz xarid qildingiz!</b>\n\nEndi <b>@${ADMIN_USER}</b> ga yozishingiz mumkin.\nQolgan balingiz: <b>${user.balance} ball</b>`,
        { parse_mode: 'HTML', ...mainMenu() }
      );
      try {
        await bot.sendMessage(ADMIN_ID,
          `🛒 <b>Yangi CDI xaridi!</b>\n\n👤 Ism: ${name}\n🔗 Username: ${uname}\n🆔 Telegram ID: <code>${userId}</code>\n📞 Telefon: ${user.phone || 'Kiritilmagan'}\n⏰ Vaqt: ${new Date().toLocaleString('uz-UZ')}`,
          { parse_mode: 'HTML' }
        );
      } catch (e) { console.error('Adminga xabar xato:', e.message); }
    } else {
      const needed = CDI_PRICE - user.balance;
      await bot.sendMessage(chatId,
        `❌ <b>Ball yetarli emas!</b>\n\nKerakli: ${CDI_PRICE} ball\nSizda: ${user.balance} ball\n<b>${needed} ball yetmayabdi</b>\n\n💡 Do'stlarni taklif qilib ball to'plang 👉 🎁 Ball ishlash`,
        { parse_mode: 'HTML', ...mainMenu() }
      );
    }
    return;
  }

  // ── Admin: Ball maqsadi tanlash (bitta user) ────────────────────────────────
  if (data === 'ball_target_one_add' || data === 'ball_target_one_remove') {
    if (!isAdmin(userId)) return;
    await bot.answerCallbackQuery(query.id);
    const action = data === 'ball_target_one_add' ? 'add_ball' : 'remove_ball';
    adminState.set(userId, { action, step: 'ask_id', target: 'one' });
    await bot.sendMessage(chatId,
      `👤 Foydalanuvchining <b>Telegram ID</b> sini yuboring:`,
      { parse_mode: 'HTML', reply_markup: { remove_keyboard: true } }
    );
    return;
  }

  // ── Admin: Ball maqsadi tanlash (hammaga) ──────────────────────────────────
  if (data === 'ball_target_all_add' || data === 'ball_target_all_remove') {
    if (!isAdmin(userId)) return;
    await bot.answerCallbackQuery(query.id);
    const action = data === 'ball_target_all_add' ? 'add_ball' : 'remove_ball';
    adminState.set(userId, { action, step: 'ask_amount', target: 'all' });
    const label = action === 'add_ball' ? "qo'shish" : 'ayirish';
    await bot.sendMessage(chatId,
      `👥 <b>Barcha foydalanuvchilarga</b> necha ball ${label}ni kiriting:`,
      { parse_mode: 'HTML', reply_markup: { remove_keyboard: true } }
    );
    return;
  }

  // ── Admin: Hammanı 0 ga tushir tasdiqlash ──────────────────────────────────
  if (data === 'reset_all_confirm') {
    if (!isAdmin(userId)) return;
    await bot.answerCallbackQuery(query.id);
    await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
      chat_id: chatId, message_id: query.message.message_id
    });
    const result = await User.updateMany({}, { $set: { balance: 0 } });
    await bot.sendMessage(chatId,
      `✅ <b>Barcha foydalanuvchilarning bali 0 ga tushirildi!</b>\n\nJami: ${result.modifiedCount} ta user`,
      { parse_mode: 'HTML', ...adminMenu() }
    );
    return;
  }

  if (data === 'reset_all_cancel') {
    if (!isAdmin(userId)) return;
    await bot.answerCallbackQuery(query.id, { text: 'Bekor qilindi.' });
    await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
      chat_id: chatId, message_id: query.message.message_id
    });
    await bot.sendMessage(chatId, '❌ Bekor qilindi.', adminMenu());
    return;
  }
});

// ─── Xabar handler (admin holatlari + oddiy xabarlar) ────────────────────────
bot.on('message', async (msg) => {
  if (!msg.text) return;
  const text   = msg.text.trim();
  const userId = msg.from.id;
  const chatId = msg.chat.id;

  if (!isAdmin(userId)) return;

  const state = adminState.get(userId);
  if (!state) return;

  // Menyu tugmalarini o'tkazib yuborish
  const menuButtons = [
    '👥 Jami userlar','🏆 Top 15','➕ Ball qosh','➖ Ball ayir',
    '📢 Hammaga xabar','🔄 Hammanı 0 ga tushir','🔙 Chiqish',
    '🛒 CDI sotib olish','👤 Hisobim','🎁 Ball ishlash'
  ];
  if (menuButtons.includes(text) || text.startsWith('/')) return;

  // ── Broadcast: xabar matni kutilmoqda ──────────────────────────────────────
  if (state.action === 'broadcast' && state.step === 'ask_message') {
    adminState.delete(userId);
    const users = await User.find({}, 'telegramId');
    let sent = 0, failed = 0;
    await bot.sendMessage(chatId,
      `📤 <b>Xabar yuborilmoqda...</b>\nJami: ${users.length} ta user`,
      { parse_mode: 'HTML' }
    );
    for (const u of users) {
      try {
        await bot.sendMessage(u.telegramId, text, { parse_mode: 'HTML' });
        sent++;
      } catch { failed++; }
      // Telegram flood limitiga tushmaslik uchun kichik delay
      await new Promise(r => setTimeout(r, 35));
    }
    await bot.sendMessage(chatId,
      `✅ <b>Xabar yuborishni yakunlandi!</b>\n\n✔️ Muvaffaqiyatli: ${sent} ta\n❌ Yetkazilmadi: ${failed} ta`,
      { parse_mode: 'HTML', ...adminMenu() }
    );
    return;
  }

  // ── Bitta userga: ID so'rash ────────────────────────────────────────────────
  if (state.step === 'ask_id' && state.target === 'one') {
    const targetId = Number(text);
    if (isNaN(targetId)) {
      await bot.sendMessage(chatId, "❌ Noto'g'ri ID. Raqam kiriting:");
      return;
    }
    const targetUser = await User.findOne({ telegramId: targetId });
    if (!targetUser) {
      await bot.sendMessage(chatId, `❌ ID: ${targetId} — foydalanuvchi topilmadi.`, adminMenu());
      adminState.delete(userId);
      return;
    }
    const name = [targetUser.firstName, targetUser.lastName].filter(Boolean).join(' ') || 'Nomsiz';
    adminState.set(userId, { ...state, step: 'ask_amount', targetId, targetName: name });
    const label = state.action === 'add_ball' ? "qo'shish" : 'ayirish';
    await bot.sendMessage(chatId,
      `👤 <b>${name}</b> (ID: ${targetId})\n💰 Joriy balans: <b>${targetUser.balance} ball</b>\n\nNecha ball ${label}ni kiriting:`,
      { parse_mode: 'HTML' }
    );
    return;
  }

  // ── Miqdor so'rash (bitta yoki hammaga) ────────────────────────────────────
  if (state.step === 'ask_amount') {
    const amount = Number(text);
    if (isNaN(amount) || amount <= 0) {
      await bot.sendMessage(chatId, "❌ Noto'g'ri miqdor. Musbat raqam kiriting:");
      return;
    }

    // Hammaga
    if (state.target === 'all') {
      adminState.delete(userId);
      if (state.action === 'add_ball') {
        const result = await User.updateMany({}, { $inc: { balance: amount } });
        await bot.sendMessage(chatId,
          `✅ <b>Barcha foydalanuvchilarga +${amount} ball qo'shildi!</b>\n\nJami: ${result.modifiedCount} ta user`,
          { parse_mode: 'HTML', ...adminMenu() }
        );
      } else {
        // Manfiy bo'lib ketmasin
        await User.updateMany({ balance: { $gte: amount } }, { $inc: { balance: -amount } });
        await User.updateMany({ balance: { $lt: amount } }, { $set: { balance: 0 } });
        const total = await User.countDocuments();
        await bot.sendMessage(chatId,
          `✅ <b>Barcha foydalanuvchilardan -${amount} ball ayirildi!</b>\n\nJami: ${total} ta user\n<i>(Bali yetmaganlar 0 ga tushirildi)</i>`,
          { parse_mode: 'HTML', ...adminMenu() }
        );
      }
      return;
    }

    // Bitta userga
    if (state.target === 'one') {
      adminState.delete(userId);
      const targetUser = await User.findOne({ telegramId: state.targetId });
      if (!targetUser) {
        await bot.sendMessage(chatId, '❌ Foydalanuvchi topilmadi.', adminMenu());
        return;
      }
      if (state.action === 'add_ball') {
        targetUser.balance += amount;
        await targetUser.save();
        await bot.sendMessage(chatId,
          `✅ <b>${state.targetName}</b> ga <b>+${amount} ball</b> qo'shildi.\n💰 Yangi balans: <b>${targetUser.balance} ball</b>`,
          { parse_mode: 'HTML', ...adminMenu() }
        );
        try {
          await bot.sendMessage(state.targetId,
            `🎉 Hisobingizga admin tomonidan <b>+${amount} ball</b> qo'shildi!\n💰 Balansiz: <b>${targetUser.balance} ball</b>`,
            { parse_mode: 'HTML' }
          );
        } catch {}
      } else {
        if (targetUser.balance < amount) {
          await bot.sendMessage(chatId,
            `❌ Foydalanuvchida faqat <b>${targetUser.balance} ball</b> mavjud. ${amount} ayirib bo'lmaydi.`,
            { parse_mode: 'HTML', ...adminMenu() }
          );
          return;
        }
        targetUser.balance -= amount;
        await targetUser.save();
        await bot.sendMessage(chatId,
          `✅ <b>${state.targetName}</b> dan <b>-${amount} ball</b> ayirildi.\n💰 Yangi balans: <b>${targetUser.balance} ball</b>`,
          { parse_mode: 'HTML', ...adminMenu() }
        );
        try {
          await bot.sendMessage(state.targetId,
            `⚠️ Hisobingizdan admin tomonidan <b>-${amount} ball</b> ayirildi.\n💰 Balansiz: <b>${targetUser.balance} ball</b>`,
            { parse_mode: 'HTML' }
          );
        } catch {}
      }
      return;
    }
  }
});


// ─── Kontakt qabul qilish ─────────────────────────────────────────────────────
bot.on('message', async (msg) => {
  if (!msg.contact) return;
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  // Faqat o'zining kontaktini qabul qilish
  if (msg.contact.user_id !== userId) {
    await bot.sendMessage(chatId,
      "❌ Iltimos, faqat o'z telefon raqamingizni yuboring.",
      { reply_markup: { keyboard: [[{ text: '📱 Kontakt ulashish', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true } }
    );
    return;
  }

  const phone = msg.contact.phone_number;

  // +998 bilan boshlanishini tekshirish
  const cleanPhone = phone.replace(/[^0-9+]/g, '');
  if (!cleanPhone.startsWith('+998') && !cleanPhone.startsWith('998')) {
    await bot.sendMessage(chatId,
      "🚫 <b>Kechirasiz, botdan faqat O'zbekiston fuqarolari foydalanishi mumkin.</b>\n\nSizning raqamingiz O'zbekiston raqami emas.",
      { parse_mode: 'HTML', reply_markup: { remove_keyboard: true } }
    );
    return;
  }

  // Raqamni saqlash
  const user = await User.findOne({ telegramId: userId });
  if (!user) { await bot.sendMessage(chatId, 'Iltimos /start ni bosing.'); return; }

  user.phone = cleanPhone.startsWith('+') ? cleanPhone : '+' + cleanPhone;
  await user.save();

  await bot.sendMessage(chatId,
    `✅ <b>Telefon raqamingiz saqlandi!</b>\n📞 ${user.phone}\n\n👇 Menyudan foydalaning:`,
    { parse_mode: 'HTML', ...mainMenu() }
  );
});

bot.on('polling_error', (err) => console.error('Polling xato:', err.message));
console.log('🤖 Bot ishga tushdi...');