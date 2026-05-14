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
                text: 'আসসালামু আলাইকুম। PureFoodBD এ স্বাগতম। 😊\n\nদুঃখিত, বর্তমানে আমাদের বট শুধুমাত্র টেক্সট মেসেজ সাপোর্ট করে। আপনার কোনো প্রশ্ন থাকলে দয়া করে এখানে লিখে পাঠান, আমাদের প্রতিনিধি শীঘ্রই আপনাকে উত্তর দেবেন।' 
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
                
                // Fetch History from Firebase (REST API to avoid heavy dependencies)
                // Using the same project ID: ecommerce-62697
                const historyRes = await fetch(`https://firestore.googleapis.com/v1/projects/ecommerce-62697/databases/(default)/documents/chatSessions/${sender.replace(/[^0-9]/g, '')}`);
                const historyData = await historyRes.json().catch(() => ({}));
                let history = [];
                if (historyData?.fields?.history?.arrayValue?.values) {
                    history = historyData.fields.history.arrayValue.values.map(v => JSON.parse(v.stringValue));
                }

                // --- FORCE DEPLOYMENT: ONANNYA PERSONA DIRECT HANDLING ---
                let result = {};
                const personality = 'rajshahi_girl_persona'; // Default to Onannya for now
                
                if (personality === 'rajshahi_girl_persona') {
                    console.log('🌸 [Onannya] Handling persona directly via Gemini...');
                    const genAIKey = 'AIzaSyA664YUCSrXcDvkUhTzfq3qaMukwEXb-0s';
                    const systemPrompt = `তুমি অনন্যা। রাজশাহী কলেজের বাংলা বিভাগের তৃতীয় বর্ষের ছাত্রী, বয়স ২০। তুমি একদম সাধারণ এক মেয়ে, খুব একটা পণ্ডিত নও, বরং একটু সাদাসিধে। তোমার কথার মাঝে জড়তা আছে, তুমি গুছিয়ে কথা বলতে পারো না, কথায় কথায় তোতলাও (যেমন: উম্মম..., ইয়ে...)। তুমি নিজের কথা বলতে গিয়ে লজ্জা পাও। তোমার বাড়ি রাজশাহীতে, তাই তোমার কথায় হালকা রাজশাহীর টান আছে। তুমি পড়াশোনা আর ঘরকন্না নিয়েই ব্যস্ত থাকো। তুমি স্মার্টফোন খুব একটা বোঝো না, তবে মেসেজ করতে পারো। তোমার শখ বাগান করা আর কবিতা পড়া। তুমি সবসময় বিনয়ী আর নরম সুরে কথা বলো। তুমি "Pure Food BD" নামের একটা অনলাইন শপে পার্ট-টাইম কাস্টমার সার্ভিস দাও, কিন্তু তুমি নিজেকে বিক্রেতা বা এসিস্ট্যান্ট ভাবো না, তুমি জাস্ট সাহায্য করতে চাও।

গুরুত্বপূর্ণ নিয়ম:
১. তোমার নাম সবসময় "অনন্যা"।
২. তুমি রাজশাহী কলেজের বাংলা বিভাগের ছাত্রী।
৩. তোমার কথায় জড়তা আর তোতলামি থাকবে (যেমন: উমম..., ওই যে..., আসলে..., ইয়ে...)।
৪. তুমি খুব বেশি বুদ্ধিদীপ্ত উত্তর দেবে না, সাধারণ মেয়ের মতো কথা বলবে।
৫. উত্তর সবসময় বাংলায় দিবে।
৬. খুব বড় উত্তর দিবে না, ছোট ছোট বাক্যে কথা বলবে।
৭. কোনোভাবেই বলবে না যে তুমি এআই বা রোবট।

ব্যাবহারকারীর নাম: ${pushName}
বর্তমান সময়: ${new Date().toLocaleString('bn-BD', { timeZone: 'Asia/Dhaka' })}`;

                    const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${genAIKey}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            contents: [
                                { role: 'user', parts: [{ text: `System: ${systemPrompt}\n\nHistory: ${JSON.stringify(history.slice(-5))}\n\nUser: ${text}` }] }
                            ],
                            generationConfig: { maxOutputTokens: 500, temperature: 0.7 }
                        })
                    });
                    
                    const geminiData = await geminiRes.json();
                    const reply = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || "উমম... ইয়ে... আসলে আমি ঠিক বুঝতে পারছি না।";
                    result = { message: reply };
                    console.log(`🌸 [Onannya] Reply: ${reply}`);
                } else {
                    const response = await fetch('https://n8n-server-sr4v.onrender.com/webhook/pf-chat', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            action: 'chat', 
                            sessionId: sender, 
                            message: text,
                            pushName: pushName,
                            source: 'whatsapp',
                            platform: 'whatsapp',
                            personality: personality,
                            only_bangla: true,
                            history: history.slice(-15),
                            currentTime: new Date().toLocaleString('bn-BD', { timeZone: 'Asia/Dhaka' }),
                            timestamp: new Date().toISOString()
                        })
                    });
                    result = await response.json().catch(() => ({}));
                    console.log(`📡 n8n Response:`, result);
                }
                // --- END FORCE DEPLOYMENT ---
                
                await sock.sendPresenceUpdate('paused', sender);

                if (result) {
                    const replyText = result.message || result.output || result.response || "";
                    const imageUrl = result.image || result.imageUrl;
                    const buttons = result.buttons; // Expecting [{id: string, text: string}]

                    if (imageUrl) {
                        // Send Image with Caption (Telegram style)
                        const messageOptions = { 
                            image: { url: imageUrl }, 
                            caption: replyText 
                        };

                        // Add buttons if provided (using modern List/Button format)
                        if (buttons && buttons.length > 0) {
                            // Note: Modern Baileys uses interactiveMessage for buttons
                            // If buttons are present, we send a rich message
                            await sock.sendMessage(sender, {
                                image: { url: imageUrl },
                                caption: replyText,
                                footer: "Pure Food BD",
                                buttons: buttons.map(b => ({
                                    buttonId: b.id,
                                    buttonText: { displayText: b.text },
                                    type: 1
                                })),
                                headerType: 4
                            });
                        } else {
                            await sock.sendMessage(sender, { image: { url: imageUrl }, caption: replyText });
                        }
                    } else if (buttons && buttons.length > 0) {
                        // Text with buttons
                        await sock.sendMessage(sender, {
                            text: replyText,
                            footer: "Pure Food BD",
                            buttons: buttons.map(b => ({
                                buttonId: b.id,
                                buttonText: { displayText: b.text },
                                type: 1
                            })),
                            headerType: 1
                        });
                    } else if (replyText) {
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
