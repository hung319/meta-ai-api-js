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

app.get('/', (req, res) => res.send('Meta AI Service is running (Cursor-based Delta).'));

app.get('/v1/models', (req, res) => {
    res.json({
        object: "list",
        data: [{ id: "meta-llama-3", object: "model", created: 1677610602, owned_by: "meta-ai-wrapper" }]
    });
});

app.post('/v1/chat/completions', async (req, res) => {
    const { messages, stream = false, model } = req.body;

    if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: "Messages array required" });

    // Multi-Instance: Mỗi request một instance mới để sạch context
    let meta = null;

    try {
        meta = await MetaAI.create(null, null, PROXY_URL);
        const prompt = convertMessagesToPrompt(messages);
        
        // Luôn tạo hội thoại mới để tránh lỗi signatures
        const isNewConversation = true; 

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
            // --- STREAMING MODE ---
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');

            const streamResponse = await meta.prompt(prompt, true, isNewConversation);
            
            // --- LOGIC DELTA DỰA TRÊN ĐỘ DÀI (CURSOR BASED) ---
            // Cách này khắc phục triệt để lỗi lặp chữ
            let cursor = 0; 

            for await (const chunk of streamResponse) {
                const fullText = chunk.message || "";
                
                // Chỉ xử lý nếu văn bản dài hơn những gì đã gửi
                if (fullText.length > cursor) {
                    // Cắt lấy phần mới nhất
                    const delta = fullText.slice(cursor);
                    
                    // Cập nhật vị trí con trỏ
                    cursor = fullText.length;

                    const openaiChunk = {
                        id: `chatcmpl-${uuidv4()}`,
                        object: "chat.completion.chunk",
                        created: Math.floor(Date.now() / 1000),
                        model: model || "meta-llama-3",
                        choices: [{ 
                            index: 0, 
                            delta: { content: delta }, 
                            finish_reason: null 
                        }]
                    };
                    res.write(`data: ${JSON.stringify(openaiChunk)}\n\n`);
                }
            }
            res.write('data: [DONE]\n\n');
            res.end();
        }

    } catch (error) {
        console.error("Request Error:", error.message);
        if (!res.headersSent) {
            res.status(500).json({ error: "Internal Server Error" });
        } else {
            res.end();
        }
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
