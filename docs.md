# Meta AI API (JavaScript)

This is a JavaScript client for interacting with the Meta AI API. It allows you to send prompts and receive responses, either as a complete object or as a stream. The client can be used anonymously or with Facebook authentication.

## Installation

To use this library in your project, you can install it via npm:

```bash
npm install <path-to-meta-ai-api-js-directory>
```
Or, if you are developing within this project, simply install the dependencies:
```bash
cd meta-ai-api-js
npm install
```

## Usage

The main entry point for the library is the `MetaAI` class. You must use the static `create()` method to instantiate it, as the constructor performs asynchronous operations.

### Anonymous Usage

For unauthenticated, anonymous sessions, create an instance without any arguments. This is the recommended way to get direct, non-personalized responses.

```javascript
const MetaAI = require('meta-ai-api');

(async () => {
  const meta = await MetaAI.create();
  const response = await meta.prompt("What is the capital of France?");
  console.log(response);
})();
```

### Authenticated Usage

You can also authenticate with your Facebook credentials. Note that this may result in personalized responses, as the AI will have the context of your account.

```javascript
const MetaAI = require('meta-ai-api');

(async () => {
  const meta = await MetaAI.create("your-facebook-email", "your-facebook-password");
  const response = await meta.prompt("What have I asked you about before?");
  console.log(response.message);
})();
```

### Getting a Response

The `prompt()` method is the primary way to interact with the AI.

`meta.prompt(message, stream = false, new_conversation = false)`

*   `message` (string): The prompt to send to the AI.
*   `stream` (boolean): If `true`, returns an async generator that yields response chunks as they arrive. Defaults to `false`.
*   `new_conversation` (boolean): If `true`, starts a new conversation thread, ignoring previous context. Defaults to `false`.

#### Standard Response (Non-streaming)

When `stream` is `false`, you get a single JSON object after the AI has finished generating the full response.

```javascript
const response = await meta.prompt("What was the Warriors score last game?");
console.log(response);
```

#### Streaming Response

When `stream` is `true`, you get an async iterator that you can loop over.

```javascript
const streamResponse = await meta.prompt("Write a short story about a robot.", true);
for await (const chunk of streamResponse) {
    process.stdout.write(chunk.message);
}
```

### Continuing a Conversation

The library automatically manages the conversation state. To ask a follow-up question, simply call `.prompt()` again on the same `MetaAI` instance.

```javascript
// First prompt
const response1 = await meta.prompt("What is the capital of France?");
console.log(response1.message);

// Follow-up prompt, has context of the first one
const response2 = await meta.prompt("What is its population?");
console.log(response2.message);
```
To start over, pass `true` as the third argument:
```javascript
const newResponse = await meta.prompt("Let's talk about something else.", false, true);
```


## The Response Object

The `prompt` method returns an object with the following structure:

```json
{
  "message": "The full text response from the AI...",
  "sources": [
    {
      "title": "Source Title",
      "url": "https://source.url/path",
      "snippet": "A snippet from the source content..."
    }
  ],
  "searchResults": {
    "references_count": 1,
    "search_engine": "BING",
    "attribution_link": "https://www.bing.com/search?q=...",
    "search_query": "The query the AI used..."
  },
  "media": [
      {
          "url": "https://image.url/path",
          "type": "IMAGE", // or "VIDEO"
          "prompt": "The prompt used to generate the image"
      }
  ]
}
```

*   `message`: A string containing the complete, formatted text from the AI.
*   `sources`: An array of objects, each representing a web source the AI consulted. This is only populated if the AI performs a web search and a `fetch_id` is present in the response.
*   `searchResults`: An object containing metadata about the web search the AI performed, including the query and search engine used.
*   `media`: An array of objects representing generated media, such as images. 