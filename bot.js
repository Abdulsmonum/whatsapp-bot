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
const QRCode = require('qrcode');
const express = require('express');
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

// ============================================
//   WEB SERVER — QR Code display
// ============================================

const PORT = process.env.PORT || 3000;

// Shared state for the web UI
let currentQR = null;       // base64 data URL of the QR image
let connectionStatus = 'disconnected'; // 'disconnected' | 'qr_ready' | 'connected'

const app = express();

app.get('/', async (req, res) => {
  let bodyContent;

  if (connectionStatus === 'connected') {
    bodyContent = `
      <div class="status connected">
        <span class="dot"></span> WhatsApp Connected
      </div>
      <p class="subtitle">Bot is running and replying to messages automatically.</p>
      <p class="hint">Yeh page refresh karne ki zaroorat nahi — bot chal raha hai ✅</p>
    `;
  } else if (currentQR) {
    bodyContent = `
      <div class="status waiting">
        <span class="dot"></span> Waiting for QR Scan
      </div>
      <p class="subtitle">Neeche QR code scan karo apne WhatsApp se:</p>
      <div class="qr-wrap">
        <img src="${currentQR}" alt="WhatsApp QR Code" />
      </div>
      <ol class="steps">
        <li>WhatsApp kholo apne phone mein</li>
        <li>3 dots (⋮) &rarr; <strong>Linked Devices</strong> tap karo</li>
        <li><strong>Link a Device</strong> tap karo</li>
        <li>Upar wala QR code scan karo</li>
      </ol>
      <p class="hint">QR code 60 seconds mein expire hota hai — agar expire ho jaye toh page refresh karo.</p>
      <script>setTimeout(() => location.reload(), 30000);</script>
    `;
  } else {
    bodyContent = `
      <div class="status waiting">
        <span class="dot"></span> Initializing…
      </div>
      <p class="subtitle">Bot start ho raha hai, thodi der mein QR code yahan aayega.</p>
      <p class="hint">Yeh page automatically refresh hoga.</p>
      <script>setTimeout(() => location.reload(), 4000);</script>
    `;
  }

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>WhatsApp Bot — QR Login</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0a0a;
      color: #e8e8e8;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 2rem;
    }
    h1 {
      font-size: 1.6rem;
      font-weight: 700;
      margin-bottom: 1.5rem;
      color: #25d366;
      letter-spacing: -0.5px;
    }
    .card {
      background: #161616;
      border: 1px solid #2a2a2a;
      border-radius: 16px;
      padding: 2.5rem 2rem;
      max-width: 420px;
      width: 100%;
      text-align: center;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 0.95rem;
      font-weight: 600;
      padding: 6px 14px;
      border-radius: 999px;
      margin-bottom: 1.2rem;
    }
    .status.connected { background: #0d2e1a; color: #25d366; border: 1px solid #25d36640; }
    .status.waiting   { background: #2a2000; color: #f0b429; border: 1px solid #f0b42940; }
    .dot {
      width: 8px; height: 8px;
      border-radius: 50%;
      background: currentColor;
      animation: pulse 1.6s ease-in-out infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50%       { opacity: 0.3; }
    }
    .subtitle {
      font-size: 0.95rem;
      color: #aaa;
      margin-bottom: 1.4rem;
      line-height: 1.5;
    }
    .qr-wrap {
      background: #fff;
      border-radius: 12px;
      padding: 16px;
      display: inline-block;
      margin-bottom: 1.6rem;
    }
    .qr-wrap img { display: block; width: 240px; height: 240px; }
    .steps {
      text-align: left;
      font-size: 0.88rem;
      color: #bbb;
      line-height: 1.8;
      padding-left: 1.2rem;
      margin-bottom: 1.2rem;
    }
    .steps strong { color: #e8e8e8; }
    .hint {
      font-size: 0.8rem;
      color: #666;
      line-height: 1.5;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>🤖 WhatsApp AI Bot</h1>
    ${bodyContent}
  </div>
</body>
</html>`);
});

app.listen(PORT, () => {
  console.log(`🌐 Web server chal raha hai: http://localhost:${PORT}`);
});

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
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      // Terminal mein bhi print karo (backup)
      console.log('\n========================================');
      console.log('  QR Code — WhatsApp se scan karo');
      console.log('========================================\n');
      qrcode.generate(qr, { small: true });
      console.log('\n(WhatsApp > 3 dots > Linked Devices > Link a Device)');
      console.log(`🌐 Ya browser mein kholo: http://localhost:${PORT}\n`);

      // Web UI ke liye QR image generate karo
      try {
        currentQR = await QRCode.toDataURL(qr, { width: 300, margin: 2 });
        connectionStatus = 'qr_ready';
      } catch (err) {
        console.error('QR image generation error:', err.message);
      }
    }

    if (connection === 'close') {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;

      console.log('Connection closed. Reconnecting:', shouldReconnect);
      connectionStatus = 'disconnected';
      currentQR = null;

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
      connectionStatus = 'connected';
      currentQR = null; // QR ab zaroorat nahi
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
