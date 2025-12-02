// src/utils.js
const { CookieJar } = require("tough-cookie");
const { wrapper } = require("axios-cookiejar-support");
const axios = require("axios");
const cheerio = require("cheerio");
const { FacebookInvalidCredentialsException } = require("./exceptions");

// Danh sách User-Agent hiện đại để Bypass
const USER_AGENTS = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0"
];

function getRandomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// Tạo độ trễ ngẫu nhiên (Jitter) để giống người thật
const delay = (min, max) => new Promise(resolve => setTimeout(resolve, Math.random() * (max - min) + min));

function generateOfflineThreadingId() {
  const max_int = BigInt("0xFFFFFFFFFFFFFFFF");
  const mask22_bits = BigInt((1 << 22) - 1);
  function getCurrentTimestamp() { return BigInt(Date.now()); }
  function getRandom64bitInt() {
    const buffer = new BigUint64Array(1);
    // Fallback nếu môi trường ko hỗ trợ crypto
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

async function getFbSession(email, password, proxies = null) {
  const jar = new CookieJar();
  const session = wrapper(axios.create({ jar, withCredentials: true }));
  if (proxies) session.defaults.proxy = proxies;

  const loginUrl = "https://www.facebook.com/login/?next";
  const headers = {
    "User-Agent": getRandomUserAgent(),
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "sec-fetch-user": "?1",
    "upgrade-insecure-requests": "1",
  };

  const response = await session.get(loginUrl, { headers });
  const $ = cheerio.load(response.data);
  const lsd = $('input[name="lsd"]').val();
  const jazoest = $('input[name="jazoest"]').val();

  const postUrl = "https://www.facebook.com/login/?next";
  const data = { lsd, jazoest, login_source: "comet_headerless_login", email, pass: password, login: "1", next: "" };
  
  await session.post(postUrl, new URLSearchParams(data).toString(), {
    headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded", Referer: "https://www.facebook.com/" },
    maxRedirects: 0,
    validateStatus: (status) => status >= 200 && status < 400,
  });

  const finalCookies = await jar.getCookies("https://www.meta.ai/");
  const abraSessCookie = finalCookies.find((c) => c.key === "abra_sess");
  if (!abraSessCookie) throw new FacebookInvalidCredentialsException("Failed to login.");
  return { abra_sess: abraSessCookie.value };
}

async function getCookies(sessionInstance) {
    const session = sessionInstance || axios.create();
    const response = await session.get("https://www.meta.ai/", {
        headers: { "User-Agent": getRandomUserAgent() }
    });
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
  getRandomUserAgent, // Export mới
  delay // Export mới
};
