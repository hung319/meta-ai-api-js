// src/main.js
const { v4: uuidv4 } = require("uuid");
const FormData = require("form-data");
const { 
    generateOfflineThreadingId, 
    getSession, 
    getCookies, 
    getRandomUserAgent, 
    delay 
} = require("./utils");
const { FacebookRegionBlocked } = require("./exceptions");
const { Readable } = require("stream");

const DOC_ID = "26191548920434983";

class MetaAI {
  constructor(fb_email = null, fb_password = null, proxy = null) {
    this.proxy = proxy;
    this.is_authed = false; // Force Anonymous để tránh lỗi 400 do auth hỏng
    this.session = null;
    this.cookies = null;
    this.access_token = null;
    this.external_conversation_id = null;
    this.thread_session_id = null;
    // TẠO USER AGENT 1 LẦN DUY NHẤT CHO CẢ PHIÊN
    this.userAgent = getRandomUserAgent(); 
  }

  async initialize() {
    this.session = await getSession(this.proxy);
    // Truyền UserAgent vào để lấy Cookie khớp với UA
    this.cookies = await getCookies(this.session, this.userAgent);
  }

  async getAccessToken() {
    if (this.access_token) return this.access_token;
    
    // Delay nhẹ để giống người thật
    await delay(200, 500);

    const url = "https://www.meta.ai/api/graphql/";
    const form = new FormData();
    form.append("lsd", this.cookies.lsd);
    form.append("fb_api_caller_class", "RelayModern");
    form.append("fb_api_req_friendly_name", "useAbraAcceptTOSForTempUserMutation");
    form.append("variables", JSON.stringify({ dob: "1999-01-01", icebreaker_type: "TEXT", __relay_internal__pv__WebPixelRatiorelayprovider: 1 }));
    form.append("doc_id", "7604648749596940"); 

    const headers = {
      ...form.getHeaders(),
      cookie: `_js_datr=${this.cookies._js_datr}; abra_csrf=${this.cookies.abra_csrf}; datr=${this.cookies.datr};`,
      "sec-fetch-site": "same-origin",
      "x-fb-friendly-name": "useAbraAcceptTOSForTempUserMutation",
      "User-Agent": this.userAgent, // QUAN TRỌNG: Dùng đúng UA
    };

    try {
      const response = await this.session.post(url, form, { headers });
      this.access_token = response.data.data.xab_abra_accept_terms_of_service.new_temp_user_auth.access_token;
      return this.access_token;
    } catch (e) { 
        console.error("AccessToken Error:", e.response?.data || e.message);
        throw new FacebookRegionBlocked("Failed to get Access Token (Status 400 likely due to Cookie mismatch)"); 
    }
  }

  async prompt(message, stream = false, new_conversation = false) {
    return this._promptInternal(message, stream, new_conversation);
  }

  async _promptInternal(message, stream = false, new_conversation = false, attempts = 0) {
    const url = "https://graph.meta.ai/graphql?locale=user";
    
    if (!this.access_token) await this.getAccessToken();

    if (!this.external_conversation_id || new_conversation) {
      this.external_conversation_id = uuidv4();
      this.thread_session_id = uuidv4();
    }

    const offlineThreadingId = generateOfflineThreadingId();
    
    const variables = {
        message: { sensitive_string_value: message },
        externalConversationId: this.external_conversation_id,
        offlineThreadingId: offlineThreadingId,
        threadSessionId: this.thread_session_id,
        isNewConversation: new_conversation,
        entrypoint: "KADABRA__CHAT__UNIFIED_INPUT_BAR",
        qplJoinId: "fd7cc37ed3589c726", 
        imagineClientOptions: { orientation: "VERTICAL" },
        messagePersistentInput: {
            bot_message_offline_threading_id: (BigInt(offlineThreadingId) + 1n).toString(),
            external_conversation_id: this.external_conversation_id,
            is_new_conversation: new_conversation,
            meta_ai_entry_point: "KADABRA__CHAT__UNIFIED_INPUT_BAR",
            offline_threading_id: offlineThreadingId,
            prompt_session_id: this.thread_session_id
        },
        __relay_internal__pv__AbraSearchInlineReferencesEnabledrelayprovider: true,
        __relay_internal__pv__AbraComposedTextWidgetsrelayprovider: true,
        __relay_internal__pv__KadabraNewCitationsEnabledrelayprovider: true,
        __relay_internal__pv__AbraSurfaceNuxIDrelayprovider: "12177",
        __relay_internal__pv__AbraIsLoggedOutrelayprovider: true,
    };

    const form = new FormData();
    form.append("access_token", this.access_token);
    form.append("fb_api_caller_class", "RelayModern");
    form.append("fb_api_req_friendly_name", "useKadabraSendMessageMutation");
    form.append("variables", JSON.stringify(variables));
    form.append("server_timestamps", "true");
    form.append("doc_id", DOC_ID);

    const headers = {
        ...form.getHeaders(),
        "User-Agent": this.userAgent, // QUAN TRỌNG: Đồng bộ UA
        "Sec-Fetch-Site": "same-site",
        "Sec-Fetch-Mode": "cors",
        "Origin": "https://www.meta.ai",
        "Referer": "https://www.meta.ai/",
        cookie: `datr=${this.cookies.datr}` // Chỉ cần datr cho authenticated calls
    };

    try {
        const response = await this.session.post(url, form, { 
            headers, 
            responseType: stream ? "stream" : "text" 
        });
        
        if (!stream) {
            const last_chunk = this.extract_last_response(response.data);
            return last_chunk ? await this.extract_data(last_chunk) : await this.retry(message, stream, attempts);
        } else {
            return this.stream_response(response.data);
        }
    } catch (error) {
        // Nếu lỗi 400, thường do Cookie/Token hết hạn hoặc sai lệch.
        console.error(`Meta API Error (${attempts}):`, error.response?.status, error.message);
        return await this.retry(message, stream, attempts);
    }
  }

  async retry(message, stream, attempts) {
    if (attempts < 2) { 
      await delay(1000, 2000);
      return this._promptInternal(message, stream, false, attempts + 1);
    }
    throw new Error("Meta AI Request Failed.");
  }

  extract_last_response(raw) {
    const lines = raw.split("\n");
    let last = null;
    for (const line of lines) {
        try { if(line.startsWith('{')) last = JSON.parse(line); } catch(e){}
    }
    return last;
  }

  // --- LOGIC BUFFER CHO EMOJI KHÔNG LỖI ---
  async* stream_response(streamData) {
    let buffer = Buffer.alloc(0);
    
    for await (const chunk of streamData) {
        buffer = Buffer.concat([buffer, chunk]);
        
        let eolIndex;
        while ((eolIndex = buffer.indexOf(10)) >= 0) { // 10 is newline \n
            const lineBuffer = buffer.subarray(0, eolIndex);
            buffer = buffer.subarray(eolIndex + 1);
            
            const line = lineBuffer.toString('utf-8').trim();
            
            if (line.startsWith("{")) {
                try {
                    const json = JSON.parse(line);
                    if (json.errors) { /* Ignore */ }
                    const data = await this.extract_data(json);
                    if (data && data.message) yield data;
                } catch (e) {}
            }
        }
    }
  }

  async extract_data(json) {
    let bot_msg = json.data?.node?.bot_response_message || 
                  json.data?.xfb_silverstone_send_message?.agent_stream?.edges?.[0]?.node?.bot_response_message;
    
    if (!bot_msg) return null;

    let message = "";
    const content = bot_msg.content;
    
    if (content?.__typename === "XFBAbraMessageMultiStepResponseContent" || content?.agent_steps) {
        const steps = content.agent_steps || [];
        for (const step of steps) {
            if (step.composed_text?.content) {
                for (const block of step.composed_text.content) {
                    if (block.text) message += block.text;
                }
            }
        }
    } else if (bot_msg.snippet) {
        message = bot_msg.snippet;
    }

    if (!message) return null;
    return { message, sources: [], media: [] };
  }
}

module.exports = { MetaAI };
