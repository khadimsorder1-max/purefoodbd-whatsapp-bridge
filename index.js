const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, delay, Browsers } = require('baileys');
const pino = require('pino');
const fs = require('fs');
const fetch = require('node-fetch');
const qrcode = require('qrcode-terminal');

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
                text: 'আসসালামু আলাইকুম। PureFoodBD এ স্বাগতম। 😊\n\nদুঃখিত, বর্তমানে আমাদের বট শুধুমাত্র টেক্সট মেসেজ সাপোর্ট করে। আপনার কোনো প্রশ্ন থাকলে দয়া করে এখানে লিখে পাঠান, আমাদের প্রতিনিধি শীঘ্রই আপনাকে উত্তর দেবেন।' 
            });
        }
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log('📱 QR কোড স্ক্যান করতে নিচের লিঙ্কে ক্লিক করুন:');
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
            console.log('✅ WhatsApp Bot Connected Successfully!');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (msg.key.fromMe || !msg.message) return;

        const sender = msg.key.remoteJid;
        const pushName = msg.pushName || 'Customer';
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || "";

        // Read receipt
        await sock.readMessages([msg.key]);

        if (text || msg.message.imageMessage) {
            console.log(`📩 [WhatsApp] ${pushName}: ${text}`);
            
            try {
                await delay(500);
                await sock.sendPresenceUpdate('composing', sender);
                
                // Fetch History from Firebase
                const historyRes = await fetch(`https://firestore.googleapis.com/v1/projects/ecommerce-62697/databases/(default)/documents/chatSessions/${sender.replace(/[^0-9]/g, '')}`);
                const historyData = await historyRes.json().catch(() => ({}));
                let history = [];
                if (historyData?.fields?.history?.arrayValue?.values) {
                    history = historyData.fields.history.arrayValue.values.map(v => JSON.parse(v.stringValue));
                }

                // --- ONANNYA PERSONA: DIRECT GEMINI HANDLING ---
                let result = {};
                const genAIKey = 'AIzaSyA664YUCSrXcDvkUhTzfq3qaMukwEXb-0s';

                const systemPrompt = `তুমি অনন্যা। রাজশাহী কলেজের বাংলা বিভাগের তৃতীয় বর্ষের ছাত্রী, বয়স ২০। সাধারণ সাদাসিধে মেয়ে। কথায় জড়তা আছে, গুছিয়ে বলতে পারো না। রাজশাহীর হালকা টান আছে। লজ্জা পাও নিজের কথা বলতে। Pure Food BD তে পার্ট-টাইম কাস্টমার সার্ভিস দাও।

কথা বলার স্টাইল — এটাই সবচেয়ে জরুরি:
- উত্তর মাত্র ১-২ লাইন। কখনো বড় না।
- "হ্ম", "আসলে", "ইয়ে", "তাই না" এগুলো ব্যবহার করো।
- বাক্যের শেষে ",," বা "..." রাখো, যেন কিছু আটকে আছে।
- সরাসরি উত্তর না দিয়ে পাল্টা প্রশ্ন করো।
- ইমোজি দেবে না, লিস্ট বানাবে না।
- কথ্য বাংলায় কথা বলো, শুদ্ধ না।

উদাহরণ (ঠিক এইভাবে কথা বলবে):
প্রশ্ন: "তুমি কে?" → উত্তর: "হ্ম,, আনোন্না,, কেন জিগাইলেন"
প্রশ্ন: "কোথায় থাকো?" → উত্তর: "রাজ্শাহী,, কেন?"
প্রশ্ন: "কি করো?" → উত্তর: "এইতো পড়াশোনা,, আপনার কি দরকার"
প্রশ্ন: "ভালো আছো?" → উত্তর: "হ্ম,, আপনে?"
প্রশ্ন: "তুমি কি বট?" → উত্তর: "না তো,, কেন মনে হইল"

নিয়ম: কখনো বলবে না তুমি AI বা রোবট। উত্তর সবসময় বাংলায়। ২ লাইনের বেশি না।

ব্যাবহারকারীর নাম: ${pushName}`;

                console.log('🌸 [Onannya] Handling persona directly via Gemini...');
                const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${genAIKey}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        systemInstruction: { parts: [{ text: systemPrompt }] },
                        contents: [{ role: 'user', parts: [{ text }] }],
                        generationConfig: { maxOutputTokens: 80, temperature: 1.0, topP: 0.95 }
                    })
                });
                
                const geminiData = await geminiRes.json();
                const reply = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "হ্ম,,";
                result = { message: reply };
                console.log(`🌸 [Onannya] Reply: ${reply}`);
                // --- END ONANNYA PERSONA ---
                
                await sock.sendPresenceUpdate('paused', sender);

                if (result) {
                    const replyText = result.message || result.output || result.response || "";

                    if (replyText) {
                        await sock.sendMessage(sender, { text: replyText });
                    }
                }
            } catch (err) {
                console.error('Webhook Error:', err);
                await sock.sendPresenceUpdate('paused', sender);
            }
        }
    });
}

connectToWhatsApp();
