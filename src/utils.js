const { CookieJar } = require("tough-cookie");
const { wrapper } = require("axios-cookiejar-support");
const axios = require("axios");
const cheerio = require("cheerio");
const { FacebookInvalidCredentialsException } = require("./exceptions");

function generateOfflineThreadingId() {
  const max_int = BigInt("0xFFFFFFFFFFFFFFFF");
  const mask22_bits = BigInt((1 << 22) - 1);

  function getCurrentTimestamp() {
    return BigInt(Date.now());
  }

  function getRandom64bitInt() {
    const buffer = new BigUint64Array(1);
    buffer[0] = BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));
    return buffer[0];
  }

  function combineAndMask(timestamp, random_value) {
    const shifted_timestamp = timestamp << BigInt(22);
    const masked_random = random_value & mask22_bits;
    return (shifted_timestamp | masked_random) & max_int;
  }

  const timestamp = getCurrentTimestamp();
  const random_value = getRandom64bitInt();
  const threading_id = combineAndMask(timestamp, random_value);

  return threading_id.toString();
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

  if (proxies) {
    session.defaults.proxy = proxies;
  }

  const loginUrl = "https://www.facebook.com/login/?next";
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "accept-language": "en-US,en;q=0.9",
    "sec-ch-ua":
      '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"macOS"',
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "none",
    "sec-fetch-user": "?1",
    "upgrade-insecure-requests": "1",
  };

  const response = await session.get(loginUrl, { headers });
  const $ = cheerio.load(response.data);

  const lsd = $('input[name="lsd"]').val();
  const jazoest = $('input[name="jazoest"]').val();

  const postUrl = "https://www.facebook.com/login/?next";
  const data = {
    lsd,
    jazoest,
    login_source: "comet_headerless_login",
    email,
    pass: password,
    login: "1",
    next: "",
  };

  const postHeaders = {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:132.0) Gecko/20100101 Firefox/132.0",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
    "Content-Type": "application/x-www-form-urlencoded",
    Origin: "https://www.facebook.com",
    Referer: "https://www.facebook.com/",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-User": "?1",
  };

  await session.post(postUrl, new URLSearchParams(data).toString(), {
    headers: postHeaders,
    maxRedirects: 0,
    validateStatus: (status) => status >= 200 && status < 400,
  });

  const cookies = await jar.getCookies(postUrl);
  const sbCookie = cookies.find((c) => c.key === "sb");
  const xsCookie = cookies.find((c) => c.key === "xs");

  if (!sbCookie || !xsCookie) {
    throw new FacebookInvalidCredentialsException(
      "Was not able to login to Facebook. Please check your credentials. You may also have been rate limited. Try to connect to Facebook manually."
    );
  }

  const metaAiCookies = await getCookies(session);

  let stateUrl = "https://www.meta.ai/state/";
  let payload = `__a=1&lsd=${metaAiCookies.lsd}`;
  let stateHeaders = {
    "content-type": "application/x-www-form-urlencoded",
    origin: "https://www.meta.ai",
    referer: "https://www.meta.ai/",
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  };

  const stateResponse = await session.post(stateUrl, payload, {
    headers: stateHeaders,
  });
  const state = extractValue(stateResponse.data, '"state":"', '"');

  const oidcUrl = `https://www.facebook.com/oidc/?app_id=1358015658191005&scope=openid%20linking&response_type=code&redirect_uri=https%3A%2F%2Fwww.meta.ai%2Fauth%2F&no_universal_links=1&deoia=1&state=${state}`;

  const oidcResponse = await session.get(oidcUrl, {
    maxRedirects: 0,
    validateStatus: null,
  });

  const nextUrl = oidcResponse.headers.location;

  if (!nextUrl) {
    throw new FacebookInvalidCredentialsException("Failed to get redirect URL for OIDC.");
  }

  await session.get(nextUrl);

  const finalCookies = await jar.getCookies("https://www.meta.ai/");
  const abraSessCookie = finalCookies.find((c) => c.key === "abra_sess");

  if (!abraSessCookie) {
    throw new FacebookInvalidCredentialsException(
      "Was not able to login to Facebook. Please check your credentials. You may also have been rate limited. Try to connect to Facebook manually."
    );
  }
  console.info("Successfully logged in to Facebook.");
  return { abra_sess: abraSessCookie.value };
}

async function getCookies(sessionInstance) {
    const session = sessionInstance || axios.create();
    const response = await session.get("https://www.meta.ai/");
    const responseText = response.data;

    const jazoestMatch = responseText.match(/"jazoest" *: *(\d+)/);
    const jazoest = jazoestMatch ? jazoestMatch[1] : null;
    
    const lsdMatch = responseText.match(/"LSD",\[\],{"token":"([^"]+)"}/);
    const lsd = lsdMatch ? lsdMatch[1] : null;

    const spinRMatch = responseText.match(/"__spin_r" *: *(\d+)/);
    const spinR = spinRMatch ? spinRMatch[1] : null;


    return {
        _js_datr: extractValue(responseText, '_js_datr":{"value":"', '",'),
        abra_csrf: extractValue(responseText, 'abra_csrf":{"value":"', '",'),
        datr: extractValue(responseText, 'datr":{"value":"', '",'),
        lsd: lsd,
        jazoest: jazoest,
        __spin_r: spinR,
    };
}


async function getSession(proxy = null, testUrl = "https://api.ipify.org/?format=json") {
  const session = axios.create();
  if (!proxy) {
    return session;
  }
  try {
    const response = await session.get(testUrl, { proxy, timeout: 10000 });
    if (response.status === 200) {
      session.defaults.proxy = proxy;
      return session;
    }
  } catch (error) {
      throw new Error("Proxy is not working.");
  }
  throw new Error("Proxy is not working.");
}


module.exports = {
  generateOfflineThreadingId,
  extractValue,
  getFbSession,
  getCookies,
  getSession,
}; 
