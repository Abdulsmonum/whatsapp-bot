const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeInMemoryStore,
  jidNormalizedUser,
} = require('@whiskeysockets/baileys');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');

// ============================================
//   APNI SETTINGS YAHAN KARO
// ============================================
const CONFIG = {
  // Gemini API Key — aistudio.google.com se lo (free)
  geminiKey: process.env.GEMINI_KEY || 'AIzaSyB7hLZ94aJBEuLtnWISlzHDY_DoZIBVS78',

  // Kitne second baad reply jaye (natural feel ke liye)
  replyDelay: 2,

  // Group mein reply kare? false = sirf personal msgs
  replyInGroups: false,

  // AI ka behavior
  systemPrompt: `You are a professional assistant replying on behalf of the phone owner.
Reply in English only.
Keep replies short, natural, and professional.
The owner may be busy or unavailable, so brief polite acknowledgment is fine.
Every reply should feel different and should not repeat the same phrase.
Do not mention that you are an AI or ask questions back.`,
};

// ============================================
//   BOT CODE
// ============================================

const genAI = new GoogleGenerativeAI(CONFIG.geminiKey);
const model = genAI.getGenerativeModel({
  model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
  generationConfig: {
    maxOutputTokens: 100,
    temperature: 0.95,
  },
  systemInstruction: CONFIG.systemPrompt,
});

// Chat history per sender
const chatHistory = new Map();

// Per-chat hourly reply limit
const ENABLE_CHAT_REPLY_LIMIT = process.env.ENABLE_CHAT_REPLY_LIMIT === 'true';
const REPLY_LIMIT_PER_HOUR = 3;
const REPLY_WINDOW_MS = 60 * 60 * 1000;
const replyLog = new Map();
const lastFallbackReply = new Map();
const fallbackReplies = [
  "Thanks — I’m tied up right now, and I’ll respond shortly.",
  "I’m unavailable at the moment, but I’ll get back to you soon.",
  "Thanks for your message. I’m busy right now and will reply shortly.",
  "I’m away at the moment, but I’ll follow up as soon as I can.",
];

function canReply(senderJid) {
  if (!ENABLE_CHAT_REPLY_LIMIT) {
    return true;
  }

  const now = Date.now();
  const recentReplies = (replyLog.get(senderJid) || [])
    .filter((timestamp) => now - timestamp < REPLY_WINDOW_MS);

  if (recentReplies.length >= REPLY_LIMIT_PER_HOUR) {
    replyLog.set(senderJid, recentReplies);
    console.log(`⏳ Reply limit reached for ${senderJid}. No more replies for this hour.`);
    return false;
  }

  recentReplies.push(now);
  replyLog.set(senderJid, recentReplies);
  return true;
}

// Auth folder
const AUTH_FOLDER = './auth_info';

async function getAIReply(senderJid, incomingText) {
  if (!chatHistory.has(senderJid)) {
    chatHistory.set(senderJid, []);
  }
  const history = chatHistory.get(senderJid);

  try {
    const chat = model.startChat({
      history,
    });

    const result = await chat.sendMessage(incomingText);
    const reply = result.response.text().trim();

    // History update
    history.push({ role: 'user', parts: [{ text: incomingText }] });
    history.push({ role: 'model', parts: [{ text: reply }] });

    // Sirf last 10 conversations rakho
    if (history.length > 20) history.splice(0, 2);

    return reply;
  } catch (err) {
    console.error('Gemini error:', err.message);
    const previousFallback = lastFallbackReply.get(senderJid);
    const availableFallbacks = fallbackReplies.filter((reply) => reply !== previousFallback);
    const fallbackPool = availableFallbacks.length > 0 ? availableFallbacks : fallbackReplies;
    const randomIndex = Math.floor(Math.random() * fallbackPool.length);
    const chosenReply = fallbackPool[randomIndex];
    lastFallbackReply.set(senderJid, chosenReply);
    return chosenReply;
  }
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }),
    browser: ['WhatsApp Bot', 'Chrome', '1.0.0'],
  });

  // QR Code
  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n========================================');
      console.log('  QR Code — WhatsApp se scan karo');
      console.log('========================================\n');
      qrcode.generate(qr, { small: true });
      console.log('\n(WhatsApp > 3 dots > Linked Devices > Link a Device)\n');
    }

    if (connection === 'close') {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;

      console.log('Connection closed. Reconnecting:', shouldReconnect);

      if (shouldReconnect) {
        setTimeout(startBot, 5000); // 5 sec baad reconnect
      } else {
        console.log('Logged out. Auth folder delete karo aur restart karo.');
        // Auth clear karo
        fs.rmSync(AUTH_FOLDER, { recursive: true, force: true });
        setTimeout(startBot, 3000);
      }
    }

    if (connection === 'open') {
      console.log('\n✅ WhatsApp connected! Bot chal raha hai 24/7.');
      console.log('📨 Har incoming message ka AI reply jayega.\n');
    }
  });

  // Credentials save karo
  sock.ev.on('creds.update', saveCreds);

  // Messages
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      try {
        // Apne bheje huye msgs ignore karo
        if (msg.key.fromMe) return;

        // Status ignore karo
        if (msg.key.remoteJid === 'status@broadcast') return;

        // Group check
        const isGroup = msg.key.remoteJid.endsWith('@g.us');
        if (isGroup && !CONFIG.replyInGroups) return;

        // Sirf text messages
        const text =
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text;

        if (!text) return;

        const senderJid = msg.key.remoteJid;
        const senderName = msg.pushName || 'Someone';

        console.log(`📨 [${senderName}]: ${text}`);

        if (!canReply(senderJid)) {
          return;
        }

        // Typing indicator dikhao
        await sock.sendPresenceUpdate('composing', senderJid);

        // AI reply lo
        const aiReply = await getAIReply(senderJid, text);

        // Delay ke baad reply karo
        setTimeout(async () => {
          await sock.sendPresenceUpdate('paused', senderJid);
          await sock.sendMessage(senderJid, { text: aiReply });
          console.log(`✅ Reply: ${aiReply}\n`);
        }, CONFIG.replyDelay * 1000);

      } catch (err) {
        console.error('Message error:', err.message);
      }
    }
  });
}

console.log('🚀 WhatsApp AI Bot start ho raha hai...\n');
startBot();
