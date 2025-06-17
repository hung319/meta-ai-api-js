const { v4: uuidv4 } = require("uuid");
const FormData = require("form-data");
const axios = require("axios");
const {
  generateOfflineThreadingId,
  formatResponse,
  getFbSession,
  getSession,
  getCookies,
} = require("./utils");
const { FacebookRegionBlocked } = require("./exceptions");
const { Readable } = require("stream");

const MAX_RETRIES = 3;

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
        // Also fetch other cookies
        const otherCookies = await getCookies(this.session);
        this.cookies = {...this.cookies, ...otherCookies};
    } else {
        this.cookies = await getCookies(this.session);
    }
  }

  async getAccessToken() {
    if (this.access_token) {
      return this.access_token;
    }

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
    form.append("doc_id", "7604648749596940");

    const headers = {
      ...form.getHeaders(),
      cookie: `_js_datr=${this.cookies._js_datr}; abra_csrf=${this.cookies.abra_csrf}; datr=${this.cookies.datr};`,
      "sec-fetch-site": "same-origin",
      "x-fb-friendly-name": "useAbraAcceptTOSForTempUserMutation",
    };

    try {
      const response = await this.session.post(url, form, { headers });
      const auth_json = response.data;
      this.access_token =
        auth_json.data.xab_abra_accept_terms_of_service.new_temp_user_auth
          .access_token;
      // Sleep for a bit for the API to register the new token.
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return this.access_token;
    } catch (error) {
      throw new FacebookRegionBlocked(
        "Unable to receive a valid response from Meta AI. This is likely due to your region being blocked. Try manually accessing https://www.meta.ai/ to confirm."
      );
    }
  }

  async prompt(message, stream = false, new_conversation = false) {
    return this._promptInternal(message, stream, new_conversation, 0);
  }

  async _promptInternal(
    message,
    stream = false,
    new_conversation = false,
    attempts = 0
  ) {
    let auth_payload;
    const url = "https://graph.meta.ai/graphql?locale=user";

    if (!this.is_authed) {
      if (!this.access_token) {
          this.access_token = await this.getAccessToken();
      }
      auth_payload = { access_token: this.access_token };
    } else {
        // This part would need significant updates for authenticated users
        // based on the new API structure, which is not fully provided.
        // Sticking to access_token (temporary user) flow for now.
      if (!this.cookies.fb_dtsg) {
          this.cookies = {...this.cookies, ...(await getCookies(this.session))};
      }
      auth_payload = { fb_dtsg: this.cookies.fb_dtsg };
    }

    if (!this.external_conversation_id || new_conversation) {
      this.external_conversation_id = uuidv4();
      this.thread_session_id = uuidv4();
    }

    const variables = {
        message: { sensitive_string_value: message },
        externalConversationId: this.external_conversation_id,
        offlineThreadingId: generateOfflineThreadingId(),
        threadSessionId: this.thread_session_id,
        suggestedPromptIndex: null,
        promptPrefix: null,
        entrypoint: "KADABRA__HOME__UNIFIED_INPUT_BAR",
        attachments: [],
        attachmentsV2: [],
        activeMediaSets: [],
        activeCardVersions: [],
        activeArtifactVersion: null,
        userUploadEditModeInput: null,
        reelComposeInput: null,
        qplJoinId: "fd205321fb1f6178a", // This seems static from curl
        sourceRemixPostId: null,
        gkPlannerOrReasoningEnabled: false,
        selectedModel: "BASIC_OPTION",
        conversationMode: null,
        conversationStarterId: null,
        promptType: null,
        artifactRewriteOptions: null,
        imagineClientOptions: null,
        spaceId: null,
        __relay_internal__pv__AbraArtifactsEnabledrelayprovider: true,
        __relay_internal__pv__KadabraMemoryEnabledrelayprovider: true,
        __relay_internal__pv__AbraPlannerEnabledrelayprovider: false,
        __relay_internal__pv__AbraWidgetsEnabledrelayprovider: false,
        __relay_internal__pv__KadabraDeepResearchEnabledrelayprovider: false,
        __relay_internal__pv__KadabraThinkHarderEnabledrelayprovider: false,
        __relay_internal__pv__AbraSearchInlineReferencesEnabledrelayprovider: true,
        __relay_internal__pv__AbraComposedTextWidgetsrelayprovider: true,
        __relay_internal__pv__WebPixelRatiorelayprovider: 1,
        __relay_internal__pv__AbraSearchReferencesHovercardEnabledrelayprovider: true,
        __relay_internal__pv__KadabraEmailCalendarIntegrationrelayprovider: false,
        __relay_internal__pv__AbraBugNubrelayprovider: false,
        __relay_internal__pv__AbraRedteamingrelayprovider: false,
        __relay_internal__pv__AbraDebugDevOnlyrelayprovider: false,
        __relay_internal__pv__kadabra_enable_open_in_editor_message_actionrelayprovider: false,
        __relay_internal__pv__AbraThreadsEnabledrelayprovider: false,
        __relay_internal__pv__KadabraImagineCanvasDevSettingsrelayprovider: false,
        __relay_internal__pv__AbraArtifactDragImagineFromConversationrelayprovider: true,
        __relay_internal__pv__AbraQPDocUploadNuxTriggerNamerelayprovider: "meta_dot_ai_abra_web_doc_upload_nux_tour",
        __relay_internal__pv__AbraSurfaceNuxIDrelayprovider: "12177",
        __relay_internal__pv__KadabraSharingDialogV2relayprovider: false,
        __relay_internal__pv__KadabraConversationRenamingrelayprovider: true,
        __relay_internal__pv__AbraIsLoggedOutrelayprovider: true,
        __relay_internal__pv__KadabraArtifactsRewriteV2relayprovider: false,
        __relay_internal__pv__AbraArtifactEditorDebugModerelayprovider: false,
        __relay_internal__pv__AbraArtifactEditorDownloadHTMLEnabledrelayprovider: false,
        __relay_internal__pv__AbraArtifactsRenamingEnabledrelayprovider: true,
        __relay_internal__pv__KadabraSocialGraphrelayprovider: false
      };

    const form = new FormData();
    if(this.is_authed) {
        // Authenticated flow not fully implemented based on new API
        form.append("fb_dtsg", this.cookies.fb_dtsg);
    } else {
        form.append("access_token", this.access_token);
    }

    form.append("av", 0);
    form.append("__user", 0);
    form.append("__a", 1);
    form.append("__req", "g");
    form.append("__hs", "20256.HYP:kadabra_pkg.2.1...0"); // Static from curl
    form.append("dpr", 1);
    form.append("__ccg", "MODERATE");
    form.append("__rev", this.cookies.__spin_r);
    form.append("__hsi", "7516791444907507304"); // Static from curl, may need updates
    form.append("__spin_r", this.cookies.__spin_r);
    form.append("__spin_b", "trunk");
    form.append("__spin_t", Math.floor(Date.now() / 1000));
    form.append("lsd", this.cookies.lsd);
    form.append("jazoest", this.cookies.jazoest);
    form.append("fb_api_caller_class", "RelayModern");
    form.append("fb_api_req_friendly_name", "useKadabraSendMessageMutation");
    form.append("variables", JSON.stringify(variables));
    form.append("server_timestamps", "true");
    form.append("doc_id", "9232477736855473");


    const headers = {
        ...form.getHeaders(),
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
        "sec-fetch-site": "same-site",
        origin: "https://www.meta.ai",
        referer: "https://www.meta.ai/",
    };
    if (this.is_authed) {
        headers.cookie = `abra_sess=${this.cookies.abra_sess}`;
    } else {
        headers.cookie = `datr=${this.cookies.datr}`
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
    if (attempts < MAX_RETRIES) {
      console.warn(
        `Was unable to obtain a valid response from Meta AI. Retrying... Attempt ${
          attempts + 1
        }/${MAX_RETRIES}.`
      );
      await new Promise((resolve) => setTimeout(resolve, 3000));
      return this._promptInternal(message, stream, false, attempts + 1);
    } else {
      throw new Error(
        "Unable to obtain a valid response from Meta AI. Try again later."
      );
    }
  }

  extract_last_response(response) {
    let last_overall_done_chunk = null;
    const lines = response.split("\n");
    for (const line of lines) {
      if (line.startsWith('{')) {
        try {
          const json_chunk = JSON.parse(line);
          let bot_response;
          if (json_chunk.data?.xfb_silverstone_send_message) {
            const edge = json_chunk.data.xfb_silverstone_send_message.agent_stream.edges[0];
            bot_response = edge?.node?.bot_response_message;
          } else if (json_chunk.label?.endsWith("useKadabraSendMessageMutationStreamingLabel")) {
            bot_response = json_chunk.data?.node?.bot_response_message;
          }
          
          if (bot_response && bot_response.streaming_state === 'OVERALL_DONE') {
            last_overall_done_chunk = json_chunk;
          }
        } catch (e) {
          // ignore parsing errors
        }
      }
    }
    return last_overall_done_chunk;
  }

    async* stream_response(lines) {
        let buffer = "";
        const stream = Readable.from(lines);
        for await (const chunk of stream) {
            buffer += chunk.toString();
            let eolIndex;
            while ((eolIndex = buffer.indexOf('\n')) >= 0) {
                const line = buffer.substring(0, eolIndex).trim();
                buffer = buffer.substring(eolIndex + 1);
                if (line.startsWith("{")) {
                    try {
                        const json_line = JSON.parse(line);
                         if (json_line.errors) {
                            console.error("Error in stream:", json_line.errors);
                            throw new Error("Stream returned an error.");
                        }

                        const extracted_data = await this.extract_data(json_line);

                        if (extracted_data && extracted_data.message && extracted_data.message.trim()) {
                            yield extracted_data;
                        }

                    } catch (e) {
                        console.warn("Could not parse line in stream:", line, e.message);
                    }
                }
            }
        }
    }

  async extract_data(json_line) {
    let bot_response_message;
    // The structure differs between the first response and subsequent stream chunks
    if (json_line.data?.xfb_silverstone_send_message) { // Initial response
        const edges = json_line.data.xfb_silverstone_send_message.agent_stream.edges;
        bot_response_message = edges[edges.length -1]?.node?.bot_response_message;
    } else if (json_line.label?.endsWith("useKadabraSendMessageMutationStreamingLabel")) { // Streaming update
        bot_response_message = json_line.data?.node?.bot_response_message;
    }

    if (!bot_response_message) {
        return { message: "", sources: [], searchResults: null, media: [] };
    }

    // The 'snippet' field contains the full, pre-formatted response text.
    const message = bot_response_message.snippet || "";

    // The 'actions' array in the 'action_panel' contains search results.
    let searchResults = null;
    const action_panel = bot_response_message.action_panel;
    if (action_panel && action_panel.actions) {
        const searchAction = action_panel.actions.find(
            (action) => action.__typename === "XFBAbraMessageSearchResults"
        );
        if (searchAction && searchAction.search_results) {
            searchResults = searchAction.search_results;
        }
    }

    const fetch_id = bot_response_message.fetch_id;
    const sources = fetch_id ? await this.fetch_sources(fetch_id) : [];
    const medias = this.extract_media(bot_response_message);
    
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
    const url = "https://graph.meta.ai/graphql?locale=user";
    const variables = {
        abraMessageFetchID: fetch_id
    };

    const form = new FormData();
    if (this.is_authed) {
        // Auth flow not updated
    } else {
        form.append("access_token", this.access_token);
    }
    form.append("fb_api_caller_class", "RelayModern");
    form.append("fb_api_req_friendly_name", "AbraSearchPluginDialogQuery");
    form.append("variables", JSON.stringify(variables));
    form.append("server_timestamps", "true");
    form.append("doc_id", "6946734308765963"); 

    const headers = {
        ...form.getHeaders(),
        "x-fb-friendly-name": "AbraSearchPluginDialogQuery",
        cookie: `dpr=2; abra_csrf=${this.cookies.abra_csrf}; datr=${this.cookies.datr}; ps_n=1; ps_l=1`,
    };

    try {
        const response = await this.session.post(url, form, { headers });
        const response_json = response.data;
        const searchResultsNode = response_json?.data?.message?.searchResults;
        return searchResultsNode ? searchResultsNode.references : [];
    } catch(e) {
        console.error("Failed to fetch sources:", e.message);
        return [];
    }
  }
}

module.exports = { MetaAI }; 