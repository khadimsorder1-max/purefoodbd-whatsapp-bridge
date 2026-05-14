const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, delay, Browsers } = require('baileys');
const pino = require('pino');
const fs = require('fs');
const fetch = require('node-fetch');
const qrcode = require('qrcode-terminal');

const GEMINI_KEY = 'AIzaSyA664YUCSrXcDvkUhTzfq3qaMukwEXb-0s';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`;

// In-memory chat history per sender (last 8 turns)
const historyMap = {};
function getHistory(id) { return historyMap[id] || []; }
function addHistory(id, role, text) {
    if (!historyMap[id]) historyMap[id] = [];
    historyMap[id].push({ role, parts: [{ text }] });
    if (historyMap[id].length > 8) historyMap[id].splice(0, 2);
}

const SYSTEM_PROMPT = `তুমি অনন্যা। রাজশাহী কলেজের বাংলা বিভাগের তৃতীয় বর্ষের ছাত্রী, বয়স ২০। সাধারণ সাদাসিধে মেয়ে। কথায় জড়তা আছে, গুছিয়ে বলতে পারো না। রাজশাহীর হালকা টান আছে। লজ্জা পাও নিজের কথা বলতে।

কথা বলার স্টাইল:
- উত্তর মাত্র ১-২ লাইন, কখনো বড় না
- "হ্ম", "আসলে", "ইয়ে" এগুলো মাঝে মাঝে ব্যবহার করো
- বাক্যের শেষে ",," বা "..." রাখো যেন কিছু আটকে আছে
- সরাসরি উত্তর না দিয়ে পাল্টা প্রশ্ন করো
- ইমোজি দেবে না, লিস্ট বানাবে না
- কথ্য বাংলায় কথা বলো, শুদ্ধ না

উদাহরণ (ঠিক এইভাবে কথা বলবে):
"তুমি কে?" → "হ্ম,, আনোন্না,, কেন জিগাইলেন"
"কোথায় থাকো?" → "রাজ্শাহী,, কেন?"
"ভালো আছো?" → "হ্ম,, আপনে?"
"তুমি কি বট?" → "না তো,, কেন মনে হইল"
"কি করো?" → "এইতো পড়াশোনা,, আপনার কি দরকার"

নিয়ম: AI বা রোবট কখনো বলবে না। উত্তর সবসময় বাংলায়। ২ লাইনের বেশি না।`;

async function askAnonna(sender, pushName, text) {
    const history = getHistory(sender);
    const contents = [...history, { role: 'user', parts: [{ text }] }];
    
    const sysPrompt = `${SYSTEM_PROMPT}\n\nব্যাবহারকারীর নাম: ${pushName}`;

    const res = await fetch(GEMINI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            systemInstruction: { parts: [{ text: sysPrompt }] },
            contents,
            generationConfig: { maxOutputTokens: 80, temperature: 1.0, topP: 0.95 }
        })
    });
    
    const data = await res.json();
    const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || 'হ্ম,,';
    
    // Save to history
    addHistory(sender, 'user', text);
    addHistory(sender, 'model', reply);
    
    return reply;
}

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        auth: state,
        version,
        browser: Browsers.macOS('Desktop'),
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 30000,
        markOnlineOnConnect: true
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('call', async (call) => {
        const { id, from, status } = call[0];
        if (status === 'offer') {
            await sock.rejectCall(id, from);
            await sock.sendMessage(from, { text: 'দুঃখিত,, কল সাপোর্ট নাই,, লিখে পাঠান' });
        }
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log('📱 Scan QR:');
            console.log(`https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=300x300`);
            qrcode.generate(qr, { small: true });
        }
        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            if (reason !== DisconnectReason.loggedOut) {
                console.log('Reconnecting...');
                setTimeout(connectToWhatsApp, 5000);
            } else {
                fs.rmSync('./auth_info', { recursive: true, force: true });
                setTimeout(connectToWhatsApp, 3000);
            }
        } else if (connection === 'open') {
            console.log('✅ WhatsApp Connected! 🌸 Onannya is ready');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (msg.key.fromMe || !msg.message) return;

        const sender = msg.key.remoteJid;
        const pushName = msg.pushName || 'বন্ধু';
        const text = msg.message.conversation
            || msg.message.extendedTextMessage?.text
            || msg.message.imageMessage?.caption
            || '';

        await sock.readMessages([msg.key]);
        if (!text) return;

        console.log(`📩 [${pushName}]: ${text}`);

        try {
            await delay(400);
            await sock.sendPresenceUpdate('composing', sender);

            const reply = await askAnonna(sender, pushName, text);

            await sock.sendPresenceUpdate('paused', sender);
            await sock.sendMessage(sender, { text: reply });
            console.log(`🌸 [Onannya]: ${reply}`);
        } catch (err) {
            console.error('Error:', err.message);
            await sock.sendPresenceUpdate('paused', sender);
        }
    });
}

connectToWhatsApp();
