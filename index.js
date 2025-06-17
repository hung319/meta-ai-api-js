const { MetaAI } = require("./src/main");

// Add a static factory method to handle async initialization
MetaAI.create = async (fb_email = null, fb_password = null, proxy = null) => {
    const instance = new MetaAI(fb_email, fb_password, proxy);
    await instance.initialize();
    return instance;
};


module.exports = MetaAI;


// Example usage:
if (require.main === module) {
  (async () => {
    try {
      console.log("Running Meta AI example...");
      
      const meta = await MetaAI.create();

      const prompt = "What was the Warriors score last game?";
      console.log(`Sending prompt: "${prompt}"`);

      const response = await meta.prompt(prompt, false);
      console.log("Response:", response);

      console.log("\n--- End of non-streaming example ---\n");

      console.log("Streaming response:");
      const streamResponse = await meta.prompt(prompt, true);
      for await (const chunk of streamResponse) {
          console.log(chunk);
      }
      console.log("\n--- End of streaming example ---\n");

    } catch (error) {
      console.error("Example failed:", error);
    }
  })();
} 
