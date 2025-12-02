// src/main.js
const { v4: uuidv4 } = require("uuid");
const FormData = require("form-data");
const { generateOfflineThreadingId, getSession, getCookies, getFbSession } = require("./utils");
const { FacebookRegionBlocked } = require("./exceptions");
const { Readable } = require("stream");

// DOC_ID LẤY TỪ REQUEST CỦA BẠN
const DOC_ID = "26191548920434983";

class MetaAI {
  constructor(fb_email = null, fb_password = null, proxy = null) {
    this.fb_email = fb_email;
    this.fb_password = fb_password;
    this.proxy = proxy;
    this.is_authed = fb_password !== null && fb_email !== null;
    this.session = null;
    this.cookies = null;
    this.access_token = null;
    this.external_conversation_id = null;
    this.thread_session_id = null;
  }

  async initialize() {
    this.session = await getSession(this.proxy);
    if (this.is_authed) {
        const fbSess = await getFbSession(this.fb_email, this.fb_password, this.proxy);
        this.cookies = { abra_sess: fbSess.abra_sess };
        const otherCookies = await getCookies(this.session);
        this.cookies = { ...this.cookies, ...otherCookies };
    } else {
        this.cookies = await getCookies(this.session);
    }
  }

  async getAccessToken() {
    if (this.access_token) return this.access_token;
    // Logic lấy token giữ nguyên như cũ để accept TOS
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
    };
    try {
      const response = await this.session.post(url, form, { headers });
      this.access_token = response.data.data.xab_abra_accept_terms_of_service.new_temp_user_auth.access_token;
      await new Promise(r => setTimeout(r, 1000));
      return this.access_token;
    } catch (e) { throw new FacebookRegionBlocked("Region blocked"); }
  }

  async prompt(message, stream = false, new_conversation = false) {
    return this._promptInternal(message, stream, new_conversation);
  }

  async _promptInternal(message, stream = false, new_conversation = false, attempts = 0) {
    const url = "https://graph.meta.ai/graphql?locale=user";
    if (!this.is_authed && !this.access_token) this.access_token = await this.getAccessToken();
    else if (this.is_authed && !this.cookies.fb_dtsg) this.cookies = { ...this.cookies, ...(await getCookies(this.session)) };

    if (!this.external_conversation_id || new_conversation) {
      this.external_conversation_id = uuidv4();
      this.thread_session_id = uuidv4();
    }

    const offlineThreadingId = generateOfflineThreadingId();
    // Variables cập nhật theo log cURL mới nhất của bạn
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
            // Fake bot ID bằng cách +1 vào user ID
            bot_message_offline_threading_id: (BigInt(offlineThreadingId) + 1n).toString(),
            external_conversation_id: this.external_conversation_id,
            is_new_conversation: new_conversation,
            meta_ai_entry_point: "KADABRA__CHAT__UNIFIED_INPUT_BAR",
            offline_threading_id: offlineThreadingId,
            prompt_session_id: this.thread_session_id
        },
        // Các cờ bắt buộc
        __relay_internal__pv__AbraSearchInlineReferencesEnabledrelayprovider: true,
        __relay_internal__pv__AbraComposedTextWidgetsrelayprovider: true,
        __relay_internal__pv__KadabraNewCitationsEnabledrelayprovider: true,
        __relay_internal__pv__AbraSurfaceNuxIDrelayprovider: "12177",
        __relay_internal__pv__AbraIsLoggedOutrelayprovider: true,
    };

    const form = new FormData();
    if(this.is_authed) form.append("fb_dtsg", this.cookies.fb_dtsg);
    else form.append("access_token", this.access_token);

    form.append("fb_api_caller_class", "RelayModern");
    form.append("fb_api_req_friendly_name", "useKadabraSendMessageMutation");
    form.append("variables", JSON.stringify(variables));
    form.append("server_timestamps", "true");
    form.append("doc_id", DOC_ID);

    const headers = {
        ...form.getHeaders(),
        "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36",
        cookie: this.is_authed ? `abra_sess=${this.cookies.abra_sess}` : `datr=${this.cookies.datr}`
    };

    try {
        const response = await this.session.post(url, form, { headers, responseType: stream ? "stream" : "text" });
        if (!stream) {
            const last_chunk = this.extract_last_response(response.data);
            return last_chunk ? await this.extract_data(last_chunk) : await this.retry(message, stream, attempts);
        } else {
            return this.stream_response(response.data);
        }
    } catch (error) {
        console.error("Meta API Error:", error.message);
        return await this.retry(message, stream, attempts);
    }
  }

  async retry(message, stream, attempts) {
    if (attempts < 2) {
      await new Promise(r => setTimeout(r, 2000));
      return this._promptInternal(message, stream, false, attempts + 1);
    }
    throw new Error("Meta AI Timeout.");
  }

  extract_last_response(raw) {
    const lines = raw.split("\n");
    let last = null;
    for (const line of lines) {
        try { if(line.startsWith('{')) last = JSON.parse(line); } catch(e){}
    }
    return last;
  }

  async* stream_response(streamData) {
    const stream = Readable.from(streamData);
    let buffer = "";
    for await (const chunk of stream) {
        buffer += chunk.toString();
        let eolIndex;
        while ((eolIndex = buffer.indexOf('\n')) >= 0) {
            const line = buffer.substring(0, eolIndex).trim();
            buffer = buffer.substring(eolIndex + 1);
            if (line.startsWith("{")) {
                try {
                    const json = JSON.parse(line);
                    // BỎ QUA LỖI ERROR LOG ĐỂ KHÔNG BỊ RÁC CONSOLE
                    if (json.errors) { /* Silent Ignore */ }
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
    
    // Parse kiểu dữ liệu mới
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

    // Chỉ trả về message text, bỏ qua sources/media cho nhẹ
    return { message, sources: [], media: [] };
  }
}

module.exports = { MetaAI };
