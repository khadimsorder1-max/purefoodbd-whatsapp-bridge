const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, delay, Browsers } = require('baileys');
const pino = require('pino');
const fs = require('fs');
const fetch = require('node-fetch');
const qrcode = require('qrcode-terminal');

const WA_ANONNA_WEBHOOK = 'https://n8n-server-sr4v.onrender.com/webhook/wa-anonna';

// Simple in-memory history (last 6 messages per sender)
const historyMap = {};
function getHistory(sender) { return historyMap[sender] || []; }
function saveHistory(sender, role, text) {
    if (!historyMap[sender]) historyMap[sender] = [];
    historyMap[sender].push({ role, content: text });
    if (historyMap[sender].length > 12) historyMap[sender].splice(0, 2);
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

    // Call Handling: Reject and notify
    sock.ev.on('call', async (call) => {
        const { id, from, status } = call[0];
        if (status === 'offer') {
            console.log(`🚫 Rejecting call from: ${from}`);
            await sock.rejectCall(id, from);
            await sock.sendMessage(from, {
                text: 'আসসালামু আলাইকুম। দুঃখিত, বর্তমানে কল সাপোর্ট করা হয় না। টেক্সট মেসেজ পাঠান।'
            });
        }
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('📱 QR Code:');
            console.log(`https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=300x300`);
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const reason = lastDisconnect.error?.output?.statusCode;
            if (reason !== DisconnectReason.loggedOut) {
                setTimeout(connectToWhatsApp, 5000);
            } else {
                fs.rmSync('./auth_info', { recursive: true, force: true });
                setTimeout(connectToWhatsApp, 3000);
            }
        } else if (connection === 'open') {
            console.log('✅ WhatsApp Connected! Onannya is ready 🌸');
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
            await delay(300);
            await sock.sendPresenceUpdate('composing', sender);

            const history = getHistory(sender);

            // Call the dedicated WhatsApp Onannya n8n workflow
            const response = await fetch(WA_ANONNA_WEBHOOK, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                timeout: 15000,
                body: JSON.stringify({
                    message: text,
                    pushName,
                    sender,
                    history
                })
            });

            const result = await response.json().catch(() => ({}));
            const replyText = result.reply || result.message || result.output || '';

            await sock.sendPresenceUpdate('paused', sender);

            if (replyText) {
                // Save to in-memory history
                saveHistory(sender, 'user', text);
                saveHistory(sender, 'model', replyText);

                await sock.sendMessage(sender, { text: replyText });
                console.log(`🌸 [Onannya → ${pushName}]: ${replyText}`);
            }
        } catch (err) {
            console.error('Error:', err.message);
            await sock.sendPresenceUpdate('paused', sender);
        }
    });
}

connectToWhatsApp();
