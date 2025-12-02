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

let metaInstance = null;

async function getMetaAIInstance() {
    if (!metaInstance) {
        console.log('🔄 Initializing new MetaAI instance...');
        try {
            metaInstance = await MetaAI.create(null, null, PROXY_URL);
            console.log('✅ MetaAI instance initialized.');
        } catch (error) {
            console.error('❌ Failed to initialize MetaAI:', error);
            throw error;
        }
    }
    return metaInstance;
}

app.use(cors());
app.use(bodyParser.json());

// Auth Middleware
app.use((req, res, next) => {
    if (req.path === '/') return next();
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];
    if (token !== SERVER_API_KEY) {
        return res.status(401).json({ error: { message: "Invalid API Key", code: "invalid_api_key" } });
    }
    next();
});

function convertMessagesToPrompt(messages) {
    const lastUserMessage = messages.slice().reverse().find(m => m.role === 'user');
    return lastUserMessage ? lastUserMessage.content : "Hello";
}

app.get('/', (req, res) => res.send('Meta AI Service is running.'));

app.get('/v1/models', (req, res) => {
    res.json({
        object: "list",
        data: [{ id: "meta-llama-3", object: "model", created: 1677610602, owned_by: "meta-ai-wrapper" }]
    });
});

app.post('/v1/chat/completions', async (req, res) => {
    const { messages, stream = false, model } = req.body;

    if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: "Messages array required" });

    try {
        const meta = await getMetaAIInstance();
        const prompt = convertMessagesToPrompt(messages);
        
        // --- FIX QUAN TRỌNG TẠI ĐÂY ---
        // Đặt thành TRUE để luôn tạo hội thoại mới, tránh lỗi 'signatures' field_exception
        const isNewConversation = true; 
        // ------------------------------

        if (!stream) {
            const response = await meta.prompt(prompt, false, isNewConversation);
            res.json({
                id: `chatcmpl-${uuidv4()}`,
                object: "chat.completion",
                created: Math.floor(Date.now() / 1000),
                model: model || "meta-llama-3",
                choices: [{
                    index: 0,
                    message: { role: "assistant", content: response.message },
                    finish_reason: "stop"
                }]
            });
        } else {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');

            const streamResponse = await meta.prompt(prompt, true, isNewConversation);
            let previousText = "";

            for await (const chunk of streamResponse) {
                // Thêm check an toàn để tránh crash nếu chunk null
                const fullText = (chunk && chunk.message) ? chunk.message : "";
                
                let delta = "";
                if (fullText.startsWith(previousText)) {
                    delta = fullText.slice(previousText.length);
                } else {
                    delta = fullText;
                }
                
                previousText = fullText;

                if (delta) {
                    const openaiChunk = {
                        id: `chatcmpl-${uuidv4()}`,
                        object: "chat.completion.chunk",
                        created: Math.floor(Date.now() / 1000),
                        model: model || "meta-llama-3",
                        choices: [{ index: 0, delta: { content: delta }, finish_reason: null }]
                    };
                    res.write(`data: ${JSON.stringify(openaiChunk)}\n\n`);
                }
            }
            res.write('data: [DONE]\n\n');
            res.end();
        }

    } catch (error) {
        console.error("Error processing request:", error);
        metaInstance = null; // Reset instance nếu lỗi
        
        // Trả về lỗi JSON chuẩn OpenAI đễ client không bị treo
        if (!res.headersSent) {
            res.status(500).json({
                error: {
                    message: "Meta AI Server Error: " + (error.message || "Unknown error"),
                    type: "server_error",
                    code: 500
                }
            });
        } else {
            res.end();
        }
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
