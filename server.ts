import { localApiOnly, isLocalRequest } from './local-api-guard.mjs';
import express from "express";
import http from "http";
import path from "path";
import { WebSocketServer } from "ws";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";

const ai = new GoogleGenAI({ 
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

async function startServer() {
  const app = express();
app.use('/api', localApiOnly(() => PORT));
  const PORT = 3000;

  // Add a route to initialize the websocket connection config if needed, or we just handle it directly.
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  const server = http.createServer(app);

  const wss = new WebSocketServer({ verifyClient: (info) => isLocalRequest(info.req, PORT, true), server });

  wss.on("connection", async (clientWs, request) => {
    // Only handle /live connections
    if (!request.url?.startsWith('/live')) {
      clientWs.close();
      return;
    }

    const url = new URL(request.url, `http://localhost`);
    const lang = url.searchParams.get("lang") || "English";
    
    console.log(`Client connected to WebSocket for language: ${lang}`);

    try {
      const session = await ai.live.connect({
        model: "gemini-3.1-flash-live-preview",
        callbacks: {
          onmessage: (message: LiveServerMessage) => {
            // Audio data
            const audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (audio) {
              clientWs.send(JSON.stringify({ audio }));
            }
            // Interruption flag
            if (message.serverContent?.interrupted) {
              clientWs.send(JSON.stringify({ interrupted: true }));
            }
            
            // Output transcription (AI speaking)
            // Wait, outputAudioTranscription usually comes back like regular text chunks or specific properties in serverContent.
            // Let's send the whole serverContent modelTurn text if it's there
            const parts = message.serverContent?.modelTurn?.parts;
            if (parts) {
              for (const part of parts) {
                if (part.text) {
                  clientWs.send(JSON.stringify({ aiTranscription: part.text }));
                }
              }
            }

            // Let's also check for user input transcription if available inside message? Wait, I need to know where input transciption lives.
            // It might be under message.clientContent or similar? Actually, let's just listen for any message data and pass it.
            // Wait, GoogleGenAI SDK LiveServerMessage might not have input transcription fields clearly documented here. Let's just catch all text parts in the model turn.
          },
          onerror: (err) => {
            console.error("Gemini session error:", err);
            clientWs.send(JSON.stringify({ error: "Gemini session error" }));
          },
          onclose: () => {
            console.log("Gemini session closed");
            clientWs.send(JSON.stringify({ close: true }));
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } },
          },
          // We prompt it to be a language learning partner
          systemInstruction: {
            parts: [{
              text: `You are a helpful language learning partner. Have a friendly conversation with the user. Help them practice their conversational skills in ${lang}. Correct them gently and encouragingly if they make major mistakes, but prioritize keeping the conversation flowing. Keep your responses relatively short to emulate a real conversation. Speak natively in ${lang}.`
            }]
          }
        },
      });

      clientWs.on("message", async (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.audio) {
            // base64 encoded PCM 16kHz
            await session.sendRealtimeInput([{
              audio: { data: msg.audio, mimeType: "audio/pcm;rate=16000" },
            }]);
          }
          if (msg.text) {
            // For sending explicit text messages if we wanted to
            await session.sendRealtimeInput([{ text: msg.text }]);
          }
        } catch (e) {
          console.error("Error processing client message", e);
        }
      });

      clientWs.on("close", () => {
        console.log("Client disconnected");
        // We cannot explicitly "close" the session easily sometimes, but we can stop sending.
        // Actually, try to close it if possible, but the SDK may not expose a clean close method on the session object?
        // Actually SKILL.md says: `Use session.close() when finished.`
        try {
          // session.close() is available? But it returns `sessionPromise.then(...)` sometimes in raw code, wait. 
          // `await ai.live.connect` returns a session object. Let's assume it has .close() or close is not strictly needed on error.
          // Let's try calling it if it exists.
          if ((session as any).close) {
            (session as any).close();
          }
        } catch (e) {
          console.error("Error closing session", e);
        }
      });

    } catch (err) {
      console.error("Failed to connect to Gemini Live:", err);
      clientWs.close();
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, "127.0.0.1", () => {
    console.log(`Server running on http://HOST:${PORT}`);
  });
}

startServer();
