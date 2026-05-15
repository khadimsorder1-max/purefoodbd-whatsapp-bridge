require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, delay, Browsers } = require('baileys');
const pino = require('pino');
const fs = require('fs');
const http = require('http');
const qrcode = require('qrcode-terminal');

// n8n Webhook URL (Ultimate Secret Path)
const N8N_WEBHOOK_URL = "https://n8n-server-sr4v.onrender.com/webhook/wa-romance-secret-v7";

// Health-check HTTP server
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('🌸 Onannya Bridge is alive and connected to n8n!');
}).listen(PORT, () => {
    console.log(`🌐 Health server on port ${PORT}`);
});

async function askN8N(sender, pushName, text) {
    try {
        console.log(`📡 Sending to n8n: ${text}`);
        const response = await fetch(N8N_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sender,
                pushName,
                message: text,
                timestamp: new Date().toISOString()
            })
        });

        const data = await response.json();
        console.log(`📥 Received from n8n: ${JSON.stringify(data)}`);
        
        // n8n returns { reply: "...", reaction: "❤️" }
        return {
            reply: data.reply || "হুম,,",
            reaction: data.reaction || null
        }; 
    } catch (error) {
        console.error("n8n Bridge Error:", error);
        return { reply: "হুম,, আসলে একটু নেটে সমস্যা হচ্ছে মনে হয়...", reaction: null }; 
    }
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
            await sock.sendMessage(from, { text: 'ইয়ে,, কল দিয়েন না প্লিজ... মেসেজ লিখুন।' });
        }
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log('📱 Scan QR to login Onannya Bridge:');
            qrcode.generate(qr, { small: true });
        }
        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            if (reason !== DisconnectReason.loggedOut) {
                console.log('Reconnecting...');
                setTimeout(connectToWhatsApp, 5000);
            } else {
                if (fs.existsSync('./auth_info')) {
                    fs.rmSync('./auth_info', { recursive: true, force: true });
                }
                setTimeout(connectToWhatsApp, 3000);
            }
        } else if (connection === 'open') {
            console.log('✅ WhatsApp Bridge Connected! 🌸 Onannya is now powered by n8n!');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (msg.key.fromMe || !msg.message) return;

        const sender = msg.key.remoteJid;
        if (sender.includes('@g.us')) return; // Ignore groups

        const pushName = msg.pushName || 'বন্ধু';
        const text = msg.message.conversation
            || msg.message.extendedTextMessage?.text
            || msg.message.imageMessage?.caption
            || '';

        await sock.readMessages([msg.key]);
        if (!text) return;

        console.log(`📩 [${pushName}]: ${text}`);

        try {
            await delay(1000); 
            await sock.sendPresenceUpdate('composing', sender);

            const { reply, reaction } = await askN8N(sender, pushName, text);

            if (reaction) {
                await sock.sendMessage(sender, { react: { text: reaction, key: msg.key } });
            }

            await delay(Math.max(1000, reply.length * 100)); 
            await sock.sendPresenceUpdate('paused', sender);
            
            await sock.sendMessage(sender, { text: reply });
            console.log(`🌸 [Onannya]: ${reply} (Reaction: ${reaction})`);
        } catch (err) {
            console.error('Bridge Message Error:', err.message);
            await sock.sendPresenceUpdate('paused', sender);
        }
    });
}

connectToWhatsApp();
