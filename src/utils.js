// src/utils.js
const { CookieJar } = require("tough-cookie");
const { wrapper } = require("axios-cookiejar-support");
const axios = require("axios");
const cheerio = require("cheerio");
const { FacebookInvalidCredentialsException } = require("./exceptions");

const USER_AGENTS = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
];

function getRandomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

const delay = (min, max) => new Promise(resolve => setTimeout(resolve, Math.random() * (max - min) + min));

function generateOfflineThreadingId() {
  const max_int = BigInt("0xFFFFFFFFFFFFFFFF");
  const mask22_bits = BigInt((1 << 22) - 1);
  function getCurrentTimestamp() { return BigInt(Date.now()); }
  function getRandom64bitInt() {
    const buffer = new BigUint64Array(1);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        crypto.getRandomValues(buffer);
    } else {
        buffer[0] = BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));
    }
    return buffer[0];
  }
  function combineAndMask(timestamp, random_value) {
    const shifted_timestamp = timestamp << BigInt(22);
    const masked_random = random_value & mask22_bits;
    return (shifted_timestamp | masked_random) & max_int;
  }
  const timestamp = getCurrentTimestamp();
  const random_value = getRandom64bitInt();
  return (combineAndMask(timestamp, random_value)).toString();
}

function extractValue(text, startStr, endStr) {
  const start = text.indexOf(startStr);
  if (start === -1) return "";
  const end = text.indexOf(endStr, start + startStr.length);
  if (end === -1) return "";
  return text.substring(start + startStr.length, end);
}

// --- FIX QUAN TRỌNG: NHẬN USER AGENT TỪ THAM SỐ ---
async function getCookies(sessionInstance, userAgent) {
    const session = sessionInstance || axios.create();
    const headers = userAgent ? { "User-Agent": userAgent } : {};
    
    const response = await session.get("https://www.meta.ai/", { headers });
    const responseText = response.data;
    
    return {
        _js_datr: extractValue(responseText, '_js_datr":{"value":"', '",'),
        abra_csrf: extractValue(responseText, 'abra_csrf":{"value":"', '",'),
        datr: extractValue(responseText, 'datr":{"value":"', '",'),
        lsd: extractValue(responseText, '"LSD",\[\],{"token":"', '"'),
        jazoest: extractValue(responseText, '"jazoest" *: *(\d+)', ''),
        __spin_r: extractValue(responseText, '"__spin_r" *: *(\d+)', ''),
    };
}

async function getFbSession(email, password, proxies = null) {
    // Giữ nguyên logic cũ nếu bạn dùng auth, 
    // nhưng khuyến nghị dùng Anonymous mode cho ổn định
    throw new Error("Auth mode currently disabled for stability. Please use Anonymous mode.");
}

async function getSession(proxy = null) {
  const session = axios.create();
  if (proxy) session.defaults.proxy = proxy;
  return session;
}

module.exports = {
  generateOfflineThreadingId,
  extractValue,
  getFbSession,
  getCookies,
  getSession,
  getRandomUserAgent,
  delay
};
