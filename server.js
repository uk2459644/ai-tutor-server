// server.js (CommonJS)
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");

const PORT = process.env.PORT || 4000;
const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// init OpenAI client
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Health check
 */
app.get("/api/health", (req, res) => {
    res.json({ ok: true, uptime: process.uptime() });
});

/**
 * POST /api/ask
 * body: { question: string }
 * returns: { answer: string }
 */
app.post("/api/ask", async (req, res) => {
    const { question } = req.body;
    if (!question) return res.status(400).json({ error: "question required" });

    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini", // change if you prefer
            messages: [
                {
                    role: "system",
                    content: "You are a friendly AI tutor. Explain topics simply and step-by-step with examples if possible."
                },
                { role: "user", content: question }
            ],
            max_tokens: 800
        });

        const answer = completion.choices?.[0]?.message?.content || "";
        res.json({ answer });
    } catch (err) {
        console.error("OpenAI /ask error:", err?.message ?? err);
        res.status(502).json({ error: "AI provider error", detail: err?.message ?? String(err) });
    }
});

/**
 * POST /api/audio
 * body: { text: string }
 * returns: { audio: "data:audio/mpeg;base64,..." }
 *
 * Note: This endpoint streams the TTS result into a base64 data URL so the
 * frontend can directly assign it to <audio src="...">.
 */
app.post("/api/audio", async (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "text required" });

    try {
        // create speech using OpenAI TTS model
        const response = await openai.audio.speech.create({
            model: "gpt-4o-mini-tts", // adjust if your account doesn't support
            voice: "alloy",          // or pick another available voice
            input: text
        });

        // response is a stream-like object; get full array buffer -> base64
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const base64 = buffer.toString("base64");
        const dataUrl = `data:audio/mpeg;base64,${base64}`;

        res.json({ audio: dataUrl });
    } catch (err) {
        console.error("OpenAI /audio error:", err?.message ?? err);
        res.status(502).json({ error: "TTS error", detail: err?.message ?? String(err) });
    }
});

/**
 * POST /api/did-talk
 * body: { text: string }
 * returns: { videoUrl: string }
 *
 * Notes:
 * - This proxies the D-ID Talks API. D-ID typically returns an `output_url` you can use to play a video.
 * - D-ID is asynchronous in some plans; check their API docs for polling if needed.
 */
app.post("/api/did-talk", async (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "text required" });
    const DID_API_KEY = process.env.DID_API_KEY;
    const sourceUrl = process.env.DID_SOURCE_URL || "https://randomuser.me/api/portraits/women/65.jpg"; // public image url

    if (!DID_API_KEY || !sourceUrl) {
        return res.status(500).json({ error: "D-ID key or source image not configured" });
    }

    try {
        const createResponse = await fetch("https://api.d-id.com/talks", {
            method: "POST",
            headers: {
                Authorization: `Basic ${DID_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                source_url: 'https://d-id-public-bucket.s3.us-west-2.amazonaws.com/alice.jpg',
                script: {
                    type: "text",
                    provider: {
                        type: "microsoft", // e.g., 'microsoft', 'elevenlabs' [1.3.7, 1.4.2]
                        voice_id: 'en-US-JennyNeural',
                        // voice_config: { style: 'string', rate: '0.5', pitch: '+2st' },
                        // language: 'English (United States)'
                    },
                    input: text,
                    // ssml: true
                },
                // config: {
                //     logo: { url: 'string', position: [0, 500] },
                //     stitch: true,
                //     result_format: 'mp4',
                //     fluent: true,
                //     driver_expressions: {
                //         expressions: [{ start_frame: 0, expression: 'neutral', intensity: 0 }],
                //         transition_frames: 0
                //     },
                //     output_resolution: 512
                // },

            })
        });

        console.log("D-ID response:", createResponse);
        if (!createResponse.ok) {
            // console.error("D-ID creation failed:", await createResponse.text());
            res.json({ error: "D-ID creation failed", detail: await createResponse.text() });
        }
        // First, you must parse the JSON to get the ID
        const createData = await createResponse.json();
        const talkId = createData.id;
        console.log("Talk created with ID:", talkId);

        // Then poll the status until done or error
        let talkResult;
        while (!talkResult || (talkResult.status !== 'done' && talkResult.status !== 'error')) {
            // Wait for a few seconds before checking again
            await new Promise(resolve => setTimeout(resolve, 3000)); // 3-second delay

            console.log("Checking status for talk:", talkId);
            const getResponse = await fetch(`https://api.d-id.com/talks/${talkId}`, {
                method: "GET",
                headers: {
                    Authorization: `Basic ${DID_API_KEY}`,
                }
            });

            talkResult = await getResponse.json();
        }

        if (talkResult.status === 'done') {
            console.log("Video is ready!");
            console.log("Video URL:", talkResult.result_url);
            res.json({ videoUrl: talkResult.result_url ?? talkResult });
        }
        else {
            console.error("Video processing failed:", talkResult);
        }
        res.status(500).json({ error: "D-ID processing failed", detail: talkResult });

        // D-ID returns output_url (or an id you must poll). We return whatever they gave.

    } catch (err) {
        console.error("D-ID /did-talk error:", err?.message ?? err);
        res.status(502).json({ error: "D-ID error", detail: err?.message ?? String(err) });
    }
});

/* Start server */
app.listen(PORT, () => {
    console.log(`AI Tutor proxy server listening on http://localhost:${PORT}`);
});
