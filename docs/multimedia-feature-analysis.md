# Multimedia & Calling Feature Analysis

## 1. Overview
This document outlines the technical approach and effort to add multimedia capabilities (Images, Voice) and Real-time Calling to LanguageBuddy.
**Note:** This analysis explicitly excludes Twilio, focusing on developer-friendly alternatives like Telnyx and Vonage.

---

## 2. Feature: Image Processing (Vision)
**Goal:** User sends a photo -> Agent "sees" it.

### Technical Flow
1.  **Ingest:**
    -   **WhatsApp:** `messages` webhook contains `image` type -> Get `id` -> `GET /url` -> Download binary.
    -   **Telegram/LINE:** Similar fetch-by-ID flows.
2.  **Process:**
    -   Convert binary to **Base64** or host temporarily on a private URL (if provider supports URL input).
    -   OpenAI API: Send to `gpt-4o` with `type: "image_url"` (supports base64).
3.  **Response:**
    -   Agent generates text response based on image.

### Effort: Low (2-3 days)
-   **Risks:** hosting/storage of temporary images (privacy/cleanup). Suggest using in-memory buffers or short-lived S3 pre-signed URLs.

---

## 3. Feature: Voice Messaging (Async)
**Goal:** User sends Voice Note -> Agent replies with Voice Note.

### Technical Flow
1.  **Ingest (Speech-to-Text):**
    -   Receive Audio (Ogg/AAC/MP4).
    -   **Transcribe:** Send to **OpenAI Whisper API** (`v1/audio/transcriptions`).
    -   Result: Text string.
2.  **Logic:**
    -   Feed Text into existing `LanguageBuddyAgent`.
    -   Agent generates Text response.
3.  **Output (Text-to-Speech):**
    -   **Synthesize:** Send Text to **OpenAI TTS API** (`v1/audio/speech`).
    -   Result: MP3/Opus binary.
4.  **Delivery:**
    -   **WhatsApp:** Upload binary to Media Endpoint -> Get ID -> Send Message with `audio` type.
    -   **Telegram:** `sendVoice` (Must be OGG-Opus for "waveform" UI, else sends as file).

### Effort: Medium (3-5 days)
-   **Complexity:** Handling different audio codecs (converting to OGG/Opus for Telegram/WhatsApp compatibility using `ffmpeg`).
-   **Latency:** The "Transcribe -> Think -> Speak -> Upload -> Send" pipeline adds significant delay (3-6s).

---

## 4. Feature: Real-Time Calling (Sync)
**Goal:** User calls the bot number -> Real-time conversation.

### Technical Approach
This requires shifting from HTTP Request/Response to **WebSockets**.

**Architecture: Telnyx Media Streaming + OpenAI Realtime API**

**Why Telnyx?** It offers a modern `Call Control` API with native "Media Streaming" (Audio Forking) over WebSockets, similar to Twilio but often more cost-effective and developer-centric.

1.  **Telephony Provider (Telnyx):**
    -   User calls Phone Number.
    -   Telnyx Call Control Webhook triggers your app.
    -   App responds with `call_control.answer`.
    -   App sends `call_control.stream_audio` (or `fork_media`) command pointing to `wss://our-server/media-stream`.
2.  **Backend (WebSocket Server):**
    -   Server listens on `/media-stream`.
    -   Handshake with Telnyx.
3.  **Bridge (The "Glue"):**
    -   Server opens a **second WebSocket** to **OpenAI Realtime API** (`wss://api.openai.com/v1/realtime`).
    -   **Inbound:** Receive Raw Audio (G.711 PCMU) from Telnyx -> Convert to PCM16 (or pass G.711 if OpenAI supports it) -> Stream to OpenAI.
    -   **Outbound:** Receive Audio from OpenAI -> Convert to PCMU -> Stream to Telnyx.
4.  **Agent Logic:**
    -   The "Brain" is now the OpenAI Realtime model (e.g., `gpt-4o-realtime-preview`).

**Alternative: Vonage Voice API**
-   Uses `NCCO` (Nexmo Call Control Object).
-   Action: `connect` with `endpoint` type `websocket`.
-   Supports bidirectional audio (16-bit PCM at 16kHz recommended for AI).

### Effort: High (2-3 weeks)
-   **Complexity:**
    -   **Audio Transcoding:** Raw packet manipulation (mulaw <-> pcm16).
    -   **State Management:** Handling interruptions/barge-in.
    -   **Infrastructure:** Requires a persistent running server (Node.js/Python).

---

## Summary of Efforts

| Feature | Tech Stack | Est. Effort | Difficulty |
| :--- | :--- | :--- | :--- |
| **Image Input** | OpenAI Vision | 3 Days | Low |
| **Voice Msgs** | Whisper + TTS + FFMPEG | 5 Days | Medium |
| **Phone Calls** | Telnyx/Vonage + OpenAI Realtime | 2-3 Weeks | High |