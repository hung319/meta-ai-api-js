// server.js
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const MetaAI = require('./index');

const app = express();
const PORT = process.env.PORT || 3000;
const SERVER_API_KEY = process.env.API_KEY || "1";
const PROXY_URL = process.env.PROXY_URL || null;

app.use(cors());
app.use(bodyParser.json());

app.use((req, res, next) => {
    if (req.path === '/') return next();
    const token = req.headers.authorization?.split(' ')[1];
    if (token !== SERVER_API_KEY) return res.status(401).json({ error: "Invalid API Key" });
    next();
});

app.get('/', (req, res) => res.send('Meta AI Server (Cursor Delta) Running.'));
app.get('/v1/models', (req, res) => res.json({ object: "list", data: [{ id: "meta-llama-3", object: "model" }] }));

app.post('/v1/chat/completions', async (req, res) => {
    const { messages, stream = false, model } = req.body;
    if (!messages) return res.status(400).json({ error: "Messages required" });

    let meta = null;
    try {
        // Multi-instance: Tạo mới cho mỗi request
        meta = await MetaAI.create(null, null, PROXY_URL);
        const prompt = messages.slice().reverse().find(m => m.role === 'user')?.content || "Hello";
        
        // Luôn tạo hội thoại mới để tránh lỗi signatures
        const isNewConversation = true; 

        if (!stream) {
            const response = await meta.prompt(prompt, false, isNewConversation);
            res.json({
                id: `chatcmpl-${uuidv4()}`,
                object: "chat.completion",
                created: Date.now(),
                model: model || "meta-llama-3",
                choices: [{ index: 0, message: { role: "assistant", content: response.message }, finish_reason: "stop" }]
            });
        } else {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');

            const streamResponse = await meta.prompt(prompt, true, isNewConversation);
            
            // --- LOGIC CHỐNG LẶP CHỮ (CURSOR) ---
            let cursor = 0; 

            for await (const chunk of streamResponse) {
                const fullText = chunk.message || "";
                
                // Chỉ gửi phần văn bản MỚI (chưa từng gửi)
                if (fullText.length > cursor) {
                    const delta = fullText.slice(cursor);
                    cursor = fullText.length; // Cập nhật vị trí con trỏ

                    res.write(`data: ${JSON.stringify({
                        id: `chatcmpl-${uuidv4()}`,
                        object: "chat.completion.chunk",
                        created: Date.now(),
                        model: model || "meta-llama-3",
                        choices: [{ index: 0, delta: { content: delta }, finish_reason: null }]
                    })}\n\n`);
                }
            }
            res.write('data: [DONE]\n\n');
            res.end();
        }
    } catch (error) {
        console.error("Server Error:", error.message);
        if (!res.headersSent) res.status(500).json({ error: "Internal Server Error" });
    }
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
