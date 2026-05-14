const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, delay, Browsers } = require('baileys');
const pino = require('pino');
const fs = require('fs');
const fetch = require('node-fetch');
const qrcode = require('qrcode-terminal');

// n8n webhook — Onannya persona engine (Gemini free models + sheet-based memory)
const N8N_WEBHOOK = 'https://n8n-server-sr4v.onrender.com/webhook-test/wa-anonna';

// In-memory chat history per sender (last 10 turns) — forwarded to n8n each request
const historyMap = {};
function getHistory(id) { return historyMap[id] || []; }
function addHistory(id, role, text) {
    if (!historyMap[id]) historyMap[id] = [];
    historyMap[id].push({ role, content: text });
    if (historyMap[id].length > 10) historyMap[id].splice(0, 2);
}

async function askAnonna(sender, pushName, text) {
    const history = getHistory(sender);

    // Forward to n8n — n8n handles Gemini (all free models) + sheet-based per-user memory
    const res = await fetch(N8N_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            message: text,
            pushName: pushName,
            sender: sender,
            history: history  // n8n uses this + its own sheet memory
        })
    });

    const data = await res.json();
    // n8n returns { reply: "..." } or { message: "..." }
    const reply = data?.reply || data?.message || data?.data?.reply || 'হ্ম,,';

    // Save to local history (cache)
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
            console.log('📡 n8n webhook:', N8N_WEBHOOK);
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
