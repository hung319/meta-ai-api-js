// server.js
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const MetaAI = require('./index'); // Import từ source code gốc

const app = express();
const PORT = process.env.PORT || 3000;

// CẤU HÌNH API KEY (Mặc định là "1" nếu không có env)
const SERVER_API_KEY = process.env.API_KEY || "1";
const PROXY_URL = process.env.PROXY_URL || null;

// --- GLOBAL INSTANCE MANAGER ---
// Biến này giữ kết nối để không phải login lại mỗi request
let metaInstance = null;

async function getMetaAIInstance() {
    if (!metaInstance) {
        console.log('🔄 Initializing new MetaAI instance...');
        try {
            // Khởi tạo MetaAI (có thể truyền email/pass vào đây nếu muốn login Facebook)
            // Ví dụ: await MetaAI.create(process.env.FB_EMAIL, process.env.FB_PASS, PROXY_URL);
            metaInstance = await MetaAI.create(null, null, PROXY_URL);
            console.log('✅ MetaAI instance initialized.');
        } catch (error) {
            console.error('❌ Failed to initialize MetaAI:', error);
            throw error;
        }
    }
    return metaInstance;
}

// --- MIDDLEWARES ---
app.use(cors());
app.use(bodyParser.json());

// Auth Middleware
app.use((req, res, next) => {
    // Bỏ qua check auth cho health check hoặc root
    if (req.path === '/') return next();

    // Lấy token từ header Authorization
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1]; // Format: "Bearer <token>"

    if (token !== SERVER_API_KEY) {
        return res.status(401).json({
            error: {
                message: "Invalid API Key",
                type: "invalid_request_error",
                param: null,
                code: "invalid_api_key"
            }
        });
    }
    next();
});

// --- HELPER FUNCTIONS ---

function convertMessagesToPrompt(messages) {
    // Lấy tin nhắn cuối cùng của User để gửi cho Meta AI
    // (Lý do: MetaAI instance tự lưu context hội thoại bên trong nó rồi)
    const lastUserMessage = messages.slice().reverse().find(m => m.role === 'user');
    return lastUserMessage ? lastUserMessage.content : "Hello";
}

// --- ENDPOINTS ---

// Health check
app.get('/', (req, res) => {
    res.send('Meta AI OpenAI Wrapper is running. Use endpoint /v1/chat/completions');
});

// 1. List Models Endpoint
app.get('/v1/models', (req, res) => {
    res.json({
        object: "list",
        data: [
            {
                id: "meta-llama-3",
                object: "model",
                created: 1677610602,
                owned_by: "meta-ai-wrapper",
            },
            {
                id: "gpt-3.5-turbo", // Alias cho tương thích client cũ
                object: "model",
                created: 1677610602,
                owned_by: "meta-ai-wrapper"
            }
        ]
    });
});

// 2. Chat Completions Endpoint
app.post('/v1/chat/completions', async (req, res) => {
    const { messages, stream = false, model } = req.body;

    if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ error: "Messages array is required" });
    }

    try {
        const meta = await getMetaAIInstance();
        const prompt = convertMessagesToPrompt(messages);
        
        // Mặc định false để giữ context hội thoại. 
        // Nếu muốn reset, client có thể gửi param riêng (nhưng API OpenAI chuẩn không có param này)
        const isNewConversation = false; 

        if (!stream) {
            // --- NON-STREAMING RESPONSE ---
            const response = await meta.prompt(prompt, false, isNewConversation);
            
            res.json({
                id: `chatcmpl-${uuidv4()}`,
                object: "chat.completion",
                created: Math.floor(Date.now() / 1000),
                model: model || "meta-llama-3",
                choices: [{
                    index: 0,
                    message: {
                        role: "assistant",
                        content: response.message,
                    },
                    finish_reason: "stop"
                }],
                usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
            });

        } else {
            // --- STREAMING RESPONSE (SSE) ---
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');

            const streamResponse = await meta.prompt(prompt, true, isNewConversation);

            let previousText = ""; // Biến để theo dõi text cũ nhằm tính delta

            for await (const chunk of streamResponse) {
                const fullText = chunk.message || "";
                
                // Tính toán delta (phần mới thêm vào)
                // Meta AI trả về full text tích lũy, OpenAI cần delta
                let delta = "";
                if (fullText.startsWith(previousText)) {
                    delta = fullText.slice(previousText.length);
                } else {
                    // Trường hợp hiếm: text bị thay đổi cấu trúc, gửi luôn full text mới
                    delta = fullText;
                }
                
                previousText = fullText;

                if (delta) {
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

            // Kết thúc stream
            res.write('data: [DONE]\n\n');
            res.end();
        }

    } catch (error) {
        console.error("Error processing request:", error);
        
        // Nếu lỗi liên quan đến session hoặc mạng, reset instance để lần sau init lại
        metaInstance = null;
        
        if (!res.headersSent) {
            res.status(500).json({
                error: {
                    message: error.message || "Internal Server Error",
                    type: "server_error",
                    code: 500
                }
            });
        } else {
            res.end();
        }
    }
});

// Start Server
app.listen(PORT, () => {
    console.log(`🚀 OpenAI-compatible MetaAI server running on port ${PORT}`);
    console.log(`🔑 API Key: ${SERVER_API_KEY}`);
});
