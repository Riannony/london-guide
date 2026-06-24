# 🇬🇧 London Explorer — AI Audio Guide
### Proof of Concept

---

## Executive Summary

**London Explorer** is a full-stack AI-powered audio walking guide that demonstrates the capabilities of Google's **Agent Development Kit (ADK)** in a real-world consumer application. A visitor drops a pin on an interactive map, receives an AI-curated list of nearby landmarks sorted by proximity, and — with a single tap — hears a professionally narrated audio guide about each site, voiced by a warm British storyteller persona named **Alistair**. They can then ask Alistair follow-up questions in real-time via a conversational live chat interface.

This POC showcases a seamless integration of multi-agent orchestration, real-time audio synthesis, geolocation, and a premium glassmorphic user experience — all served from a lightweight local stack.

---

## Problem Statement

Traditional audio guides require expensive hardware rentals or static mobile apps with pre-recorded tracks. Modern tourists expect an AI-first experience: personalised, conversational, always available, and able to answer unexpected questions in the moment.

> **London Explorer answers: what would it look like if your tour guide was a brilliant, omniscient AI storyteller — and you could ask it anything?**

---

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│                  React Frontend                 │
│  Leaflet Map · Glassmorphic Cards · Audio Player │
│  Live Chat Modal · Material Symbols Icons        │
└──────────────────────┬──────────────────────────┘
                       │ REST API
┌──────────────────────▼──────────────────────────┐
│           FastAPI Backend (Python)               │
│  CORS · Session Management · Streaming Responses │
└──────┬──────────────┬────────────────┬───────────┘
       │              │                │
┌──────▼──────┐ ┌─────▼──────┐ ┌──────▼──────────┐
│  ADK Agent  │ │  ADK Agent  │ │   ADK Agents    │
│  Pipeline   │ │  Pipeline   │ │   (Chat + TTS)  │
│  Places     │ │  Narration  │ │                 │
│  Discovery  │ │  Writer     │ │  Suggestion     │
│             │ │             │ │  Generator      │
└──────┬──────┘ └─────┬──────┘ └──────┬──────────┘
       │              │                │
┌──────▼──────────────▼────────────────▼──────────┐
│            Google Cloud APIs                    │
│  Vertex AI (Gemini 3 Flash) · Places API (New)  │
│  Gemini TTS (gemini-3.1-flash-tts-preview)      │
│  OSRM Open-Source Routing                       │
└─────────────────────────────────────────────────┘
```

---

## Key Features

### 🗺️ Intelligent Landmark Discovery

- User drops a pin anywhere on an interactive dark-mode Leaflet map (or uses geolocation)
- Adjustable search radius slider (0.5–5 km)
- A **SequentialAgent pipeline** (ADK) orchestrates two sub-agents:
  1. **Places Fetcher** — calls the Google Places API (New) or falls back to a curated London dataset
  2. **Places Formatter** — structures results into typed Pydantic schemas, sorted by Haversine distance
- Results appear as premium glassmorphic cards with category badges and distance pills

### 🎙️ AI Narration with Gemini TTS

- One click generates a bespoke 150–250 word narration script via a **Narration Writer Agent** (Gemini 3 Flash on Vertex AI)
- The script is voiced in real-time using **Gemini's native TTS model** (`gemini-3.1-flash-tts-preview`) with the `Sadaltager` voice — warm, British-accented
- Audio streams back to the client as an MP3 and auto-plays in a gold-accented waveform player
- Falls back gracefully to Google's `gTTS` library if API credentials are unavailable

### 💬 Live Conversational Chat with Alistair

- A full **conversational AI agent** (ADK `Agent`) maintains multi-turn session state per landmark
- On opening chat, a **Suggestion Agent** generates 3 cinematic, story-driven topic prompts (e.g., *"The Bus That Leaped Tower Bridge"*)
- Users can type questions or use **Web Speech API voice input**
- Every response is automatically voiced via the TTS endpoint, creating a spoken dialogue experience
- Session continuity is maintained so Alistair remembers the conversation history

### 🧭 Routing Integration

- "Build Route" opens Google Maps walking directions directly from the user's pin to the selected landmark
- Route path is also drawn as an animated polyline on the Leaflet map (OSRM routing API)

---

## Technology Stack

| Layer | Technology |
| :--- | :--- |
| **Frontend** | React 19, Vite, Leaflet / react-leaflet, Vanilla CSS |
| **UI Design** | Glassmorphism, Playfair Display + Outfit fonts, Material Symbols |
| **Backend** | FastAPI (Python), uvicorn |
| **AI Agents** | Google ADK 2.0 — `Agent`, `SequentialAgent`, `Runner` |
| **LLM** | Gemini 3 Flash on Vertex AI (`gemini-3-flash-preview`) |
| **TTS** | Gemini Interactions API (`gemini-3.1-flash-tts-preview`) |
| **Places Data** | Google Places API (New) + curated fallback dataset |
| **Routing** | OSRM open-source routing engine |
| **Session State** | ADK `InMemorySessionService` (per-agent namespaced) |

---

## Agent Design Patterns Demonstrated

This POC showcases **three distinct ADK patterns**:

| Pattern | Where Used | Why |
| :--- | :--- | :--- |
| **Sequential Pipeline** | Places Discovery | Two-step: fetch raw data → format to typed schema |
| **Stateful Single Agent** | Narration Writer | Pre-populated session state drives personalised output |
| **Multi-turn Conversational Agent** | Alistair Live Chat | Session persistence enables contextual follow-up Q&A |

---

## API Surface

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/api/places` | `POST` | Run the ADK discovery pipeline; returns sorted landmarks |
| `/api/narrate` | `POST` | Generate narration script → stream MP3 audio |
| `/api/chat/suggest` | `POST` | Return 3 AI-generated story-driven topic suggestions |
| `/api/chat` | `POST` | Multi-turn conversational chat with Alistair |
| `/api/tts` | `POST` | Synthesise any text to MP3 stream via Gemini TTS |
| `/api/photo` | `GET` | Proxy Google Places photo to bypass browser CORS |

---

## What This POC Proves

1. **ADK is production-ready for consumer applications** — multi-agent pipelines with structured Pydantic outputs work reliably and compose cleanly.
2. **Gemini TTS creates a premium real-time audio experience** — persona-directed voice synthesis with director's notes produces a rich, warm British guide persona.
3. **Conversational agents with session state can power rich live chat** — the multi-turn `InMemorySessionService` correctly maintains context across follow-up questions.
4. **A small team can ship a full-stack AI product fast** — backend ADK agents + React frontend with a clean design system, built from scratch in a single sprint.

---

## Next Steps (Production Roadmap)

- [ ] **Persistent session storage** — replace `InMemorySessionService` with Cloud Firestore or Redis
- [ ] **User authentication** — add Google Sign-In for saved guides and history
- [ ] **Offline mode** — cache narration MP3s and landmark data for use without connectivity
- [ ] **Multi-city expansion** — parameterise the curated landmark dataset for Paris, NYC, Tokyo
- [ ] **AR integration** — overlay landmark information on live camera feed
- [ ] **Deploy to Cloud Run** — containerise the FastAPI backend for production scalability

---

*Built with Google ADK 2.0 · Gemini 3 Flash · Gemini TTS · React 19 · FastAPI*
