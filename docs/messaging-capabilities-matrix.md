# Messaging Capabilities Matrix

## Provider Feature Comparison

| Feature | **WhatsApp** (Meta) | **Telegram** | **LINE** | **RCS** (Google) | **Apple Msgs** (AMB) | **KakaoTalk** |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Type** | REST API (Cloud) | REST API (Bot) | REST API | REST / gRPC | REST (via MSP) | REST (Biz) |
| **Setup Difficulty** | Medium (Meta Verify) | Very Low | Low | High (Partner Verify) | Very High (Apple Verify) | High (Dealer) |
| **Text Msgs** | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes |
| **Images (In)** | ✅ Yes (Get URL) | ✅ Yes (Get File) | ✅ Yes (Get Stream) | ✅ Yes | ✅ Yes | ⚠️ Limited |
| **Images (Out)** | ✅ Yes (Link/ID) | ✅ Yes (Link/ID) | ✅ Yes (Link) | ✅ Yes | ✅ Yes | ✅ Yes |
| **Voice (In)** | ✅ Yes (AAC/Ogg) | ✅ Yes (Ogg) | ✅ Yes (M4A) | ✅ Yes | ✅ Yes | ⚠️ Limited |
| **Voice (Out)** | ✅ Yes | ✅ Yes (Ogg/Opus) | ✅ Yes | ✅ Yes | ✅ Yes | ⚠️ Limited |
| **Buttons/Lists** | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes (Chips) | ✅ Yes (Pickers) | ✅ Yes |
| **Carousels** | ✅ Yes | ❌ (Inline Keyboards) | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes |
| **Cost** | Per Conversation | Free | Free / Tiered | Per Message | Free (MSP costs apply) | Per Message |

## Key Takeaways

1.  **Telegram** is the clear winner for "Developer Experience". It is free, instant to set up, and supports all media types natively with simple APIs.
2.  **LINE** is a strong runner-up, very popular in Asia (Japan, Taiwan, Thailand), with a modern and well-documented API.
3.  **RCS** and **Apple Messages** are "Premium" channels. They offer a rich native experience on Android/iOS respectively but require significant business verification overhead.
4.  **KakaoTalk** is arguably the hardest for a generic "global" bot due to its strictly regulated business messaging ecosystem (AlimTalk vs. Consultation Talk).
5.  **Calling Infrastructure:** For real-time voice, **Telnyx** or **Vonage** are recommended over Twilio for their clean WebSocket APIs and developer focus.