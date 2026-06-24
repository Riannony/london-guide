# Copyright 2026 Google LLC
# Licensed under the Apache License, Version 2.0

import uuid

import requests as http_requests
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types
from pydantic import BaseModel

from app.agent import (
    create_chat_agent,
    create_suggestion_agent,
    narration_writer_agent,
    places_discovery_pipeline,
)
from app.tts import text_to_speech_stream

app = FastAPI(
    title="London Guide Backend API",
    description="FastAPI service powered by ADK 2.0 agents for discovering nearby places and generating walking guides.",
    version="0.1.0"
)

# Enable CORS for frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Adjust in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Shared in-memory session service
session_service = InMemorySessionService()

class PlacesRequest(BaseModel):
    lat: float
    lng: float
    radius_m: int = 1000

class NarrationRequest(BaseModel):
    place_id: str
    name: str
    description: str

@app.get("/")
def read_root():
    return {"message": "Welcome to the London Guide API. Use POST /api/places or POST /api/narrate."}

@app.post("/api/places")
async def get_places(req: PlacesRequest):
    """Finds up to 5 nearby places using the ADK places discovery agent pipeline."""
    session_id = f"session_{uuid.uuid4().hex[:8]}"
    user_id = "user"

    # Create session
    await session_service.create_session(
        app_name="london_guide",
        user_id=user_id,
        session_id=session_id
    )

    # Initialize ADK Runner
    runner = Runner(
        agent=places_discovery_pipeline,
        app_name="london_guide",
        session_service=session_service
    )

    prompt = f"Find nearby places around lat={req.lat}, lng={req.lng} within {req.radius_m} meters."

    try:
        # Run agent pipeline to discover and format places
        async for event in runner.run_async(
            user_id=user_id,
            session_id=session_id,
            new_message=types.Content(role="user", parts=[types.Part.from_text(text=prompt)])
        ):
            pass

        # Retrieve final session state
        session = await session_service.get_session(
            app_name="london_guide",
            user_id=user_id,
            session_id=session_id
        )

        # Proxy pattern: URL construction for Place Photos API
        # photo_url = f"https://places.googleapis.com/v1/{photo_name}/media?key={places_api_key}&maxWidthPx=600&skipHttpRedirect=false"

        places_output = session.state.get("places_output")
        if not places_output:
            raise HTTPException(status_code=500, detail="Places discovery agent pipeline did not return places_output.")

        return places_output
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Agent Pipeline Error: {e!s}")

@app.post("/api/narrate")
async def get_narration(req: NarrationRequest):
    """Generates a walking guide script and streams the synthesized MP3 audio back to the client."""
    session_id = f"session_{uuid.uuid4().hex[:8]}"
    user_id = "user"

    # Pre-populate session state with variables referenced in agent instructions
    await session_service.create_session(
        app_name="london_guide",
        user_id=user_id,
        session_id=session_id,
        state={
            "place_name": req.name,
            "place_description": req.description
        }
    )

    # Initialize ADK Runner
    runner = Runner(
        agent=narration_writer_agent,
        app_name="london_guide",
        session_service=session_service
    )

    prompt = "Write a narration guide."

    try:
        # Run agent pipeline to generate narration text script
        async for event in runner.run_async(
            user_id=user_id,
            session_id=session_id,
            new_message=types.Content(role="user", parts=[types.Part.from_text(text=prompt)])
        ):
            pass

        session = await session_service.get_session(
            app_name="london_guide",
            user_id=user_id,
            session_id=session_id
        )

        script = session.state.get("narration_script")
        if not script:
            raise HTTPException(status_code=500, detail="Narration agent did not return narration_script.")

        # Stream the audio chunks back to the client
        return StreamingResponse(
            text_to_speech_stream(script),
            media_type="audio/mpeg",
            headers={
                "Content-Disposition": f'inline; filename="{req.place_id}.mp3"'
            }
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Narration Pipeline Error: {e!s}")


class SuggestRequest(BaseModel):
    landmark_name: str
    description: str

class ChatRequest(BaseModel):
    session_id: str
    landmark_name: str
    message: str

class TTSRequest(BaseModel):
    text: str

@app.post("/api/chat/suggest")
async def suggest_topics(req: SuggestRequest):
    """Generates exactly 3 intriguing suggested topics for a landmark."""
    session_id = f"session_sug_{uuid.uuid4().hex[:8]}"
    user_id = "user"

    await session_service.create_session(
        app_name="london_guide_suggest",
        user_id=user_id,
        session_id=session_id,
        state={
            "landmark_name": req.landmark_name,
            "place_description": req.description
        }
    )

    suggestion_agent = create_suggestion_agent()
    runner = Runner(
        agent=suggestion_agent,
        app_name="london_guide_suggest",
        session_service=session_service
    )

    try:
        async for event in runner.run_async(
            user_id=user_id,
            session_id=session_id,
            new_message=types.Content(role="user", parts=[types.Part.from_text(text="Generate 3 topics.")])
        ):
            pass

        session = await session_service.get_session(
            app_name="london_guide_suggest",
            user_id=user_id,
            session_id=session_id
        )

        output = session.state.get("suggestion_output")
        if not output:
            raise HTTPException(status_code=500, detail="Suggestion agent failed to return topics.")
        return output
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/chat")
async def chat_with_guide(req: ChatRequest):
    """Processes user chat messages and returns the tour guide's conversational response."""
    user_id = "user"
    session_id = req.session_id

    try:
        session = await session_service.get_session(
            app_name="london_guide_chat",
            user_id=user_id,
            session_id=session_id
        )
    except Exception:
        session = None

    if session is None:
        # Session does not exist yet — create it with initial landmark context
        await session_service.create_session(
            app_name="london_guide_chat",
            user_id=user_id,
            session_id=session_id,
            state={
                "landmark_name": req.landmark_name
            }
        )

    chat_agent = create_chat_agent()
    runner = Runner(
        agent=chat_agent,
        app_name="london_guide_chat",
        session_service=session_service
    )

    try:
        async for event in runner.run_async(
            user_id=user_id,
            session_id=session_id,
            new_message=types.Content(role="user", parts=[types.Part.from_text(text=req.message)])
        ):
            pass

        session = await session_service.get_session(
            app_name="london_guide_chat",
            user_id=user_id,
            session_id=session_id
        )

        response_text = session.state.get("chat_response")
        if not response_text:
            raise HTTPException(status_code=500, detail="Chat agent failed to return response.")
        return {"text": response_text}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/photo")
async def proxy_place_photo(name: str = Query(...), key: str = Query(...)):
    """Proxies a Google Places photo URL to avoid CORS/redirect issues in browser img tags."""
    try:
        url = f"https://places.googleapis.com/v1/{name}/media?key={key}&maxWidthPx=600&skipHttpRedirect=true"
        resp = http_requests.get(url, timeout=10)
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail="Photo fetch failed")
        content_type = resp.headers.get("content-type", "image/jpeg")
        return Response(content=resp.content, media_type=content_type)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Photo proxy error: {e!s}")


@app.post("/api/tts")
async def get_custom_tts(req: TTSRequest):
    """Synthesizes custom text to MP3 audio stream."""
    try:
        return StreamingResponse(
            text_to_speech_stream(req.text),
            media_type="audio/mpeg"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
