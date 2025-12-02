const { MetaAI } = require("./src/main");

// --- QUAN TRỌNG ---
// Hàm này giúp khởi tạo instance và chạy initialize() (lấy token/cookie) cùng lúc.
// Server.js phụ thuộc hoàn toàn vào hàm này.
MetaAI.create = async (fb_email = null, fb_password = null, proxy = null) => {
    const instance = new MetaAI(fb_email, fb_password, proxy);
    await instance.initialize();
    return instance;
};

module.exports = MetaAI;
