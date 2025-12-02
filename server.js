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

// Hàm nối context đã tối ưu
function convertMessagesToPrompt(messages) {
    if (!messages || messages.length === 0) return "Hello";
    let prompt = "";
    for (const msg of messages) {
        const roleName = msg.role === 'user' ? 'User' : 'Assistant';
        // Xử lý xuống dòng để prompt rõ ràng hơn
        if (msg.role === 'system') prompt += `System Instructions: ${msg.content}\n\n`;
        else prompt += `${roleName}: ${msg.content}\n`;
    }
    prompt += "Assistant:"; 
    return prompt;
}

app.get('/', (req, res) => res.send('Meta AI Server (Fix: Emoji + RateLimit).'));
app.get('/v1/models', (req, res) => res.json({ object: "list", data: [{ id: "meta-llama-3", object: "model" }] }));

app.post('/v1/chat/completions', async (req, res) => {
    const { messages, stream = false, model } = req.body;
    if (!messages) return res.status(400).json({ error: "Messages required" });

    let meta = null;
    try {
        meta = await MetaAI.create(null, null, PROXY_URL);
        const prompt = convertMessagesToPrompt(messages);
        
        if (!stream) {
            const response = await meta.prompt(prompt, false, true);
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

            const streamResponse = await meta.prompt(prompt, true, true);
            let cursor = 0; 

            for await (const chunk of streamResponse) {
                const fullText = chunk.message || "";
                if (fullText.length > cursor) {
                    const delta = fullText.slice(cursor);
                    cursor = fullText.length;
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
