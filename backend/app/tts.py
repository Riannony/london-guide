# Copyright 2026 Google LLC
# Licensed under the Apache License, Version 2.0

import base64
import io
import os
from collections.abc import Generator

from google import genai
from gtts import gTTS


def text_to_speech_stream(text: str) -> Generator[bytes, None, None]:
    """Converts text to speech and yields MP3 audio bytes in chunks.

    Uses the native Gemini TTS model (`gemini-3.1-flash-tts-preview`) with 
    a warm, British-accented voice ('Sadaltager'). If the API call fails or 
    credentials are not set, it gracefully falls back to local gTTS.
    
    Args:
        text: The narration script text to speak.
        
    Yields:
        Bytes chunks of the generated MP3 audio.
    """
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    use_native_gemini = os.environ.get("USE_NATIVE_GEMINI_TTS", "True").lower() in ("true", "1", "yes")

    if use_native_gemini and api_key:
        try:
            # Initialize GenAI Client using the key
            client = genai.Client(api_key=api_key)

            # Director's Chair prompting for a charming British tour guide
            prompt = f"""# AUDIO PROFILE: Alistair
            ## "The Knowledgeable London Guide"
            
            ## THE SCENE: A historic street in London
            Alistair is standing outside, speaking warmly and clearly to a visitor.
            
            ### DIRECTOR'S NOTES
            Style: Warm, engaging, and friendly. Vocal smile is present.
            Pace: Measured and clear, giving the listener time to look around.
            Accent: British English accent.
            
            #### TRANSCRIPT
            {text}"""

            # Call the native Gemini TTS model with streaming
            stream = client.interactions.create(
                model="gemini-3.1-flash-tts-preview",
                input=prompt,
                response_format={"type": "audio"},
                generation_config={
                    "speech_config": [
                        {"voice": "Sadaltager"}  # Knowledgeable voice
                    ]
                },
                stream=True
            )

            for event in stream:
                if event.event_type == "step.delta":
                    if event.delta.type == "audio":
                        yield base64.b64decode(event.delta.data)
            return
        except Exception as e:
            print(f"Error using native Gemini TTS, falling back to local gTTS: {e}")

    # Fallback to local gTTS (free, no credentials required)
    # Use 'co.uk' top-level domain to get a British English accent!
    try:
        tts = gTTS(text=text, lang="en", tld="co.uk")
        fp = io.BytesIO()
        tts.write_to_fp(fp)
        fp.seek(0)

        while True:
            chunk = fp.read(4096)
            if not chunk:
                break
            yield chunk
    except Exception as e:
        print(f"Error generating fallback gTTS audio: {e}")
        # Return a silent chunk to avoid breaking the stream
        yield b""
