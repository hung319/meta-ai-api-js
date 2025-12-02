const { v4: uuidv4 } = require("uuid");
const FormData = require("form-data");
const {
  generateOfflineThreadingId,
  getFbSession,
  getSession,
  getCookies,
} = require("./utils");
const { FacebookRegionBlocked } = require("./exceptions");
const { Readable } = require("stream");

// DOC_ID MỚI TỪ CURL CỦA BẠN
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
    this.offline_threading_id = null;
    this.thread_session_id = null;
  }

  async initialize() {
    this.session = await getSession(this.proxy);
    if (this.is_authed) {
        this.cookies = {
            abra_sess: (await getFbSession(this.fb_email, this.fb_password, this.proxy)).abra_sess
        };
        const otherCookies = await getCookies(this.session);
        this.cookies = {...this.cookies, ...otherCookies};
    } else {
        this.cookies = await getCookies(this.session);
    }
  }

  async getAccessToken() {
    if (this.access_token) return this.access_token;

    const url = "https://www.meta.ai/api/graphql/";
    const form = new FormData();
    form.append("lsd", this.cookies.lsd);
    form.append("fb_api_caller_class", "RelayModern");
    form.append("fb_api_req_friendly_name", "useAbraAcceptTOSForTempUserMutation");
    form.append("variables", JSON.stringify({
        dob: "1999-01-01",
        icebreaker_type: "TEXT",
        __relay_internal__pv__WebPixelRatiorelayprovider: 1,
      }));
    form.append("doc_id", "7604648749596940"); // Keep old doc_id for TOS acceptance

    const headers = {
      ...form.getHeaders(),
      cookie: `_js_datr=${this.cookies._js_datr}; abra_csrf=${this.cookies.abra_csrf}; datr=${this.cookies.datr};`,
      "sec-fetch-site": "same-origin",
      "x-fb-friendly-name": "useAbraAcceptTOSForTempUserMutation",
    };
    try {
      const response = await this.session.post(url, form, { headers });
      const auth_json = response.data;
      this.access_token = auth_json.data.xab_abra_accept_terms_of_service.new_temp_user_auth.access_token;
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return this.access_token;
    } catch (error) {
      throw new FacebookRegionBlocked("Region blocked or invalid response.");
    }
  }

  async prompt(message, stream = false, new_conversation = false) {
    return this._promptInternal(message, stream, new_conversation, 0);
  }

  async _promptInternal(message, stream = false, new_conversation = false, attempts = 0) {
    const url = "https://graph.meta.ai/graphql?locale=user";

    if (!this.is_authed) {
      if (!this.access_token) this.access_token = await this.getAccessToken();
    } else {
      if (!this.cookies.fb_dtsg) this.cookies = {...this.cookies, ...(await getCookies(this.session))};
    }

    if (!this.external_conversation_id || new_conversation) {
      this.external_conversation_id = uuidv4();
      this.thread_session_id = uuidv4();
    }

    const offlineThreadingId = generateOfflineThreadingId();
    
    // Cấu trúc variables MỚI dựa trên cURL
    const variables = {
        message: { sensitive_string_value: message },
        externalConversationId: this.external_conversation_id,
        offlineThreadingId: offlineThreadingId,
        threadSessionId: this.thread_session_id,
        isNewConversation: new_conversation, // Quan trọng: Truyền đúng boolean
        suggestedPromptIndex: null,
        promptPrefix: null,
        entrypoint: "KADABRA__CHAT__UNIFIED_INPUT_BAR",
        attachments: [],
        attachmentsV2: [],
        activeMediaSets: [],
        activeCardVersions: [],
        activeArtifactVersion: null,
        userUploadEditModeInput: null,
        reelComposeInput: null,
        qplJoinId: "fd7cc37ed3589c726", 
        sourceRemixPostId: null,
        gkPlannerOrReasoningEnabled: false,
        selectedModel: "BASIC_OPTION",
        conversationMode: null,
        selectedAgentType: "PLANNER",
        agentSettings: null,
        conversationStarterId: null,
        promptType: null,
        artifactRewriteOptions: null,
        imagineOperationRequest: null,
        imagineClientOptions: { orientation: "VERTICAL" },
        spaceId: null,
        sparkSnapshotId: null,
        topicPageId: null,
        includeSpace: false,
        storybookId: null,
        messagePersistentInput: {
            attachment_size: null,
            attachment_type: null,
            // Bot ID thường là ID của user + 1 hoặc random, ở đây ta fake tăng lên 1
            bot_message_offline_threading_id: (BigInt(offlineThreadingId) + 1n).toString(),
            conversation_mode: null,
            external_conversation_id: this.external_conversation_id,
            is_new_conversation: new_conversation,
            meta_ai_entry_point: "KADABRA__CHAT__UNIFIED_INPUT_BAR",
            offline_threading_id: offlineThreadingId,
            prompt_id: null,
            prompt_session_id: this.thread_session_id
        },
        alakazam_enabled: true,
        skipInFlightMessageWithParams: null,
        // Các cờ relay provider (copy y nguyên từ cURL)
        __relay_internal__pv__KadabraSocialSearchEnabledrelayprovider: false,
        __relay_internal__pv__KadabraZeitgeistEnabledrelayprovider: false,
        __relay_internal__pv__alakazam_enabledrelayprovider: true,
        __relay_internal__pv__sp_kadabra_survey_invitationrelayprovider: true,
        __relay_internal__pv__KadabraAINativeUXrelayprovider: false,
        __relay_internal__pv__enable_kadabra_partial_resultsrelayprovider: false,
        __relay_internal__pv__AbraArtifactsEnabledrelayprovider: false,
        __relay_internal__pv__KadabraMemoryEnabledrelayprovider: false,
        __relay_internal__pv__AbraPlannerEnabledrelayprovider: false,
        __relay_internal__pv__AbraWidgetsEnabledrelayprovider: false,
        __relay_internal__pv__KadabraDeepResearchEnabledrelayprovider: false,
        __relay_internal__pv__KadabraThinkHarderEnabledrelayprovider: false,
        __relay_internal__pv__KadabraVergeEnabledrelayprovider: false,
        __relay_internal__pv__KadabraSpacesEnabledrelayprovider: false,
        __relay_internal__pv__KadabraProductSearchEnabledrelayprovider: false,
        __relay_internal__pv__KadabraAreServiceEnabledrelayprovider: false,
        __relay_internal__pv__kadabra_render_reasoning_response_statesrelayprovider: true,
        __relay_internal__pv__kadabra_reasoning_cotrelayprovider: false,
        __relay_internal__pv__AbraSearchInlineReferencesEnabledrelayprovider: true,
        __relay_internal__pv__AbraComposedTextWidgetsrelayprovider: true,
        __relay_internal__pv__KadabraNewCitationsEnabledrelayprovider: true,
        __relay_internal__pv__WebPixelRatiorelayprovider: 3,
        __relay_internal__pv__KadabraVideoDeliveryRequestrelayprovider: {
            dash_manifest_requests: [{}],
            progressive_url_requests: [{ quality: "HD" }, { quality: "SD" }]
        },
        __relay_internal__pv__KadabraWidgetsRedesignEnabledrelayprovider: false,
        __relay_internal__pv__kadabra_enable_send_message_retryrelayprovider: true,
        __relay_internal__pv__KadabraEmailCalendarIntegrationrelayprovider: false,
        __relay_internal__pv__kadabra_reels_connect_featuresrelayprovider: false,
        __relay_internal__pv__AbraBugNubrelayprovider: false,
        __relay_internal__pv__AbraRedteamingrelayprovider: false,
        __relay_internal__pv__AbraDebugDevOnlyrelayprovider: false,
        __relay_internal__pv__kadabra_enable_open_in_editor_message_actionrelayprovider: false,
        __relay_internal__pv__AbraThreadsEnabledrelayprovider: false,
        __relay_internal__pv__kadabra_story_builder_enabledrelayprovider: false,
        __relay_internal__pv__kadabra_imagine_canvas_enable_dev_settingsrelayprovider: false,
        __relay_internal__pv__kadabra_create_media_deletionrelayprovider: false,
        __relay_internal__pv__kadabra_moodboardrelayprovider: false,
        __relay_internal__pv__AbraArtifactDragImagineFromConversationrelayprovider: false,
        __relay_internal__pv__kadabra_media_item_renderer_heightrelayprovider: 545,
        __relay_internal__pv__kadabra_media_item_renderer_widthrelayprovider: 620,
        __relay_internal__pv__AbraQPDocUploadNuxTriggerNamerelayprovider: "meta_dot_ai_abra_web_doc_upload_nux_tour",
        __relay_internal__pv__AbraSurfaceNuxIDrelayprovider: "12177",
        __relay_internal__pv__KadabraConversationRenamingrelayprovider: true,
        __relay_internal__pv__AbraIsLoggedOutrelayprovider: true,
        __relay_internal__pv__KadabraCanvasDisplayHeaderV2relayprovider: true,
        __relay_internal__pv__AbraArtifactEditorDebugModerelayprovider: false,
        __relay_internal__pv__AbraArtifactEditorDownloadHTMLEnabledrelayprovider: false,
        __relay_internal__pv__kadabra_create_row_hover_optionsrelayprovider: false,
        __relay_internal__pv__kadabra_media_info_pillsrelayprovider: true,
        __relay_internal__pv__KadabraConcordInternalProfileBadgeEnabledrelayprovider: false,
        __relay_internal__pv__KadabraSocialGraphrelayprovider: false
    };

    const form = new FormData();
    if(this.is_authed) {
        form.append("fb_dtsg", this.cookies.fb_dtsg);
    } else {
        form.append("access_token", this.access_token);
    }

    form.append("av", 0);
    form.append("__user", 0);
    form.append("__a", 1);
    form.append("__req", "9"); // Updated based on curl
    form.append("__hs", "20424.HYP:kadabra_pkg.2.1...0"); // Updated based on curl
    form.append("dpr", 3);
    form.append("__ccg", "EXCELLENT");
    form.append("__rev", this.cookies.__spin_r || "1030485991");
    form.append("__hsi", "7579273976648694901"); // This usually rotates, but keeping static often works for session
    form.append("__spin_r", this.cookies.__spin_r || "1030485991");
    form.append("__spin_b", "trunk");
    form.append("__spin_t", Math.floor(Date.now() / 1000));
    form.append("lsd", this.cookies.lsd);
    form.append("jazoest", this.cookies.jazoest);
    form.append("fb_api_caller_class", "RelayModern");
    form.append("fb_api_req_friendly_name", "useKadabraSendMessageMutation");
    form.append("variables", JSON.stringify(variables));
    form.append("server_timestamps", "true");
    form.append("doc_id", DOC_ID); // Sử dụng DOC_ID mới

    const headers = {
        ...form.getHeaders(),
        "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36",
        "sec-fetch-site": "same-site",
        "sec-fetch-mode": "cors",
        origin: "https://www.meta.ai",
        referer: "https://www.meta.ai/",
    };

    if (this.is_authed) {
        headers.cookie = `abra_sess=${this.cookies.abra_sess}`;
    } else {
        headers.cookie = `datr=${this.cookies.datr}`;
    }

    try {
        const response = await this.session.post(url, form, {
            headers,
            responseType: stream ? "stream" : "text",
        });

        if (!stream) {
            const raw_response = response.data;
            const last_streamed_response = this.extract_last_response(raw_response);
            if (!last_streamed_response) {
                return await this.retry(message, stream, attempts);
            }
            return await this.extract_data(last_streamed_response);
        } else {
            return this.stream_response(response.data);
        }
    } catch (error) {
        console.error("Error during prompt:", error.response?.data || error.message);
        return await this.retry(message, stream, attempts);
    }
  }

  async retry(message, stream = false, attempts = 0) {
    if (attempts < 3) {
      console.warn(`Retrying... Attempt ${attempts + 1}/3.`);
      await new Promise((resolve) => setTimeout(resolve, 3000));
      return this._promptInternal(message, stream, false, attempts + 1);
    } else {
      throw new Error("Unable to obtain a valid response from Meta AI.");
    }
  }

  extract_last_response(response) {
    let last_valid_chunk = null;
    const lines = response.split("\n");
    for (const line of lines) {
      if (line.startsWith('{')) {
        try {
          const json = JSON.parse(line);
          // Check if it has the data structure we want
          if (json.data?.xfb_silverstone_send_message || json.data?.node?.bot_response_message) {
             last_valid_chunk = json;
          }
        } catch (e) {}
      }
    }
    return last_valid_chunk;
  }

  async* stream_response(lines) {
    let buffer = "";
    const inputStream = lines.data ? lines.data : lines; // Handle axios stream types
    const stream = Readable.from(inputStream);

    for await (const chunk of stream) {
        buffer += chunk.toString();
        let eolIndex;
        while ((eolIndex = buffer.indexOf('\n')) >= 0) {
            const line = buffer.substring(0, eolIndex).trim();
            buffer = buffer.substring(eolIndex + 1);
            if (line.startsWith("{")) {
                try {
                    const json_line = JSON.parse(line);
                    // Bỏ qua lỗi errors trong stream để tránh sập server
                    if (json_line.errors) {
                        // console.warn("Meta Warning:", json_line.errors);
                    }
                    
                    const extracted_data = await this.extract_data(json_line);
                    if (extracted_data && extracted_data.message) {
                        yield extracted_data;
                    }
                } catch (e) { }
            }
        }
    }
  }

  async extract_data(json_line) {
    let bot_response;
    
    // Case 1: Initial response
    if (json_line.data?.xfb_silverstone_send_message) {
        const edges = json_line.data.xfb_silverstone_send_message.agent_stream?.edges;
        if (edges && edges.length > 0) {
            bot_response = edges[0].node.bot_response_message;
        }
    } 
    // Case 2: Streaming update
    else if (json_line.data?.node?.bot_response_message) {
        bot_response = json_line.data.node.bot_response_message;
    }

    if (!bot_response) {
        return null;
    }

    // --- PARSING LOGIC MỚI CHO MULTI-STEP RESPONSE ---
    let message = "";
    const content = bot_response.content;

    if (content) {
        // Kiểm tra loại content mới: XFBAbraMessageMultiStepResponseContent
        if (content.__typename === "XFBAbraMessageMultiStepResponseContent" || content.agent_steps) {
            const steps = content.agent_steps || [];
            // Lấy step cuối cùng hoặc step có text
            for (const stepObj of steps) {
                if (stepObj.composed_text && stepObj.composed_text.content) {
                    for (const block of stepObj.composed_text.content) {
                        if (block.text) {
                            message += block.text;
                        }
                    }
                }
            }
        }
        // Fallback cho loại content cũ (ComposedText)
        else if (content.composed_text && content.composed_text.content) {
             for (const block of content.composed_text.content) {
                if (block.text) message += block.text;
            }
        }
        // Fallback: snippet
        else if (bot_response.snippet) {
            message = bot_response.snippet;
        }
    }

    if (!message) return null;

    // Xử lý search results (nếu có)
    let searchResults = null;
    const action_panel = bot_response.action_panel;
    if (action_panel && action_panel.actions) {
        const searchAction = action_panel.actions.find(
            (action) => action.__typename === "XFBAbraMessageSearchResults"
        );
        if (searchAction && searchAction.search_results) {
            searchResults = searchAction.search_results;
        }
    }

    // Xử lý sources
    const fetch_id = bot_response.fetch_id;
    const sources = fetch_id ? await this.fetch_sources(fetch_id) : [];
    const medias = this.extract_media(bot_response);
    
    return { message, sources, searchResults, media: medias };
  }

  extract_media(bot_response_message) {
    const medias = [];
    const imagine_card = bot_response_message?.imagine_card || {};
    const media_sets = imagine_card?.session?.media_sets || [];
    for (const media_set of media_sets) {
      const imagine_media = media_set.imagine_media || [];
      for (const media of imagine_media) {
        medias.push({
          url: media.uri,
          type: media.media_type,
          prompt: media.prompt,
        });
      }
    }
    return medias;
  }

  async fetch_sources(fetch_id) {
    // Logic fetch source giữ nguyên, có thể cần update doc_id nếu hỏng
    const url = "https://graph.meta.ai/graphql?locale=user";
    const variables = { abraMessageFetchID: fetch_id };
    const form = new FormData();
    if (!this.is_authed) form.append("access_token", this.access_token);
    
    form.append("fb_api_caller_class", "RelayModern");
    form.append("fb_api_req_friendly_name", "AbraSearchPluginDialogQuery");
    form.append("variables", JSON.stringify(variables));
    form.append("server_timestamps", "true");
    form.append("doc_id", "6946734308765963"); // Old doc_id might still work for this specific query

    const headers = {
        ...form.getHeaders(),
        cookie: `datr=${this.cookies.datr}`,
    };

    try {
        const response = await this.session.post(url, form, { headers });
        const response_json = response.data;
        const searchResultsNode = response_json?.data?.message?.searchResults;
        return searchResultsNode ? searchResultsNode.references : [];
    } catch(e) {
        return [];
    }
  }
}

module.exports = { MetaAI };
