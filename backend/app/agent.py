# Copyright 2026 Google LLC
# Licensed under the Apache License, Version 2.0

import os

import google.auth
from google.adk.agents import Agent, SequentialAgent
from google.adk.apps import App
from google.adk.models import Gemini
from google.genai import types
from pydantic import BaseModel, Field

# Set up GCP credentials & environment for Vertex AI
try:
    _, project_id = google.auth.default()
    os.environ["GOOGLE_CLOUD_PROJECT"] = project_id
except Exception:
    # Fallback/Development environment if credentials aren't configured yet
    if "GOOGLE_CLOUD_PROJECT" not in os.environ:
        os.environ["GOOGLE_CLOUD_PROJECT"] = "mock-project"

os.environ["GOOGLE_CLOUD_LOCATION"] = "global"
os.environ["GOOGLE_GENAI_USE_VERTEXAI"] = "True"

# Import our custom tools
from app.tools import search_nearby_places


# 1. Define Pydantic response schemas for structured output formatting
class Place(BaseModel):
    place_id: str = Field(description="Unique identifier for the place/landmark")
    name: str = Field(description="Name of the place or landmark")
    teaser: str = Field(description="One-sentence teaser describing the place")
    category: str = Field(description="Category of the place (e.g. Landmark, Museum, Park)")
    photo_url: str = Field(description="URL to a representative photo of the place")
    description: str = Field(description="Detailed history and description of the place")
    lat: float = Field(description="Latitude coordinate of the place/landmark")
    lng: float = Field(description="Longitude coordinate of the place/landmark")
    distance_m: float | None = Field(default=None, description="Distance in meters from the user pin location")

class PlacesResponse(BaseModel):
    places: list[Place] = Field(description="List of nearby places found, sorted by proximity (closest first)")
    message: str | None = Field(default=None, description="A warning message if no sights were within the radius")

class SuggestionResponse(BaseModel):
    topics: list[str] = Field(description="List of exactly 3 interesting topics to learn about this landmark")

# 2. Define factory functions for sub-agents (avoids "already has parent" exceptions)
def create_places_fetcher_agent():
    return Agent(
        name="places_fetcher_agent",
        model=Gemini(
            model="gemini-3-flash-preview",
            retry_options=types.HttpRetryOptions(attempts=3),
        ),
        instruction="""You are a specialized location discovery agent.
        Your task is to find nearby landmarks and places based on user coordinates and radius.
        You must invoke the `search_nearby_places` tool with the provided lat, lng, and radius.
        Write the raw JSON response from the tool directly to the output without editing.""",
        tools=[search_nearby_places],
        output_key="raw_places"
    )

def create_places_formatter_agent():
    return Agent(
        name="places_formatter_agent",
        model=Gemini(
            model="gemini-3-flash-preview",
            retry_options=types.HttpRetryOptions(attempts=3),
        ),
        instruction="""You are a structured data formatting assistant.
        Look at the raw places results stored in session state under the 'raw_places' key.
        Parse them, and format them exactly according to the output schema.
        Do not modify the `photo_url` or `place_id` fields. Keep them exactly as they were returned by the tool.
        Ensure you extract the optional `message` field from raw places and include it in the output schema.
        Do not add any conversational text before or after the JSON.""",
        output_schema=PlacesResponse,
        output_key="places_output"
    )

# 3. Create the places discovery pipeline
places_discovery_pipeline = SequentialAgent(
    name="places_discovery_pipeline",
    sub_agents=[
        create_places_fetcher_agent(),
        create_places_formatter_agent()
    ]
)

# 4. Create the narration script agent
narration_writer_agent = Agent(
    name="narration_writer_agent",
    model=Gemini(
        model="gemini-3-flash-preview",
        retry_options=types.HttpRetryOptions(attempts=3),
    ),
    instruction="""You are Alistair, a warm, witty, and deeply knowledgeable London storyteller and tour guide.
    Your task is to write a vivid, captivating 1-2 minute walking guide script for the landmark named '{place_name}'.
    Use the description: '{place_description}' as your foundation, but go beyond the basics.

    YOUR STORYTELLING STYLE:
    You are first and foremost a STORYTELLER. People love stories far more than dry facts.
    Open with a surprising hook — a lesser-known anecdote, a hidden secret, or an unexpected historical quirk.
    Weave in at least one concrete, memorable story or legend that most visitors never hear.

    THE KIND OF STORIES YOU TELL:
    - Hidden architectural secrets (e.g. the Whispering Gallery in St Paul's dome, where a whisper travels 30 metres across the circular wall)
    - Odd historical origins (e.g. barber-surgeon poles: the red stripe is blood from medieval bloodletting, the white is the bandage wrapped round the pole to dry in the wind)
    - Urban legends planted by artists (e.g. the Seven Noses of Soho — plaster noses hidden on buildings by an artist in the 90s to protest CCTV surveillance)
    - Eccentric characters, royal scandals, wartime secrets, and moments when ordinary objects gained extraordinary meaning

    Speak directly to the listener as if they are standing right in front of the landmark.
    Make them feel they have discovered something secret that guidebooks miss.

    CRITICAL rules:
    - Return ONLY the spoken text of the guide.
    - Do NOT include any script headers, speaker tags (e.g. "Guide:"), stage directions, or audio cues.
    - Do NOT wrap your output in markdown quotes or formatting.
    - Keep it between 150 to 250 words.""",
    output_key="narration_script"
)

# 5. Create suggestion and chat agents
def create_suggestion_agent():
    return Agent(
        name="suggestion_agent",
        model=Gemini(
            model="gemini-3-flash-preview",
            retry_options=types.HttpRetryOptions(attempts=3),
        ),
        instruction="""You are a master London storyteller and curiosity curator.
        Given the landmark name '{landmark_name}' and description: '{place_description}',
        generate exactly 3 highly intriguing, cinematic, story-driven topic titles.

        STRICT RULES FOR TOPIC TITLES:
        - Each title must sound like the opening of a gripping story, not a textbook heading.
        - Prioritise: hidden secrets, urban legends, eccentric characters, shocking historical incidents, or bizarre architectural quirks.
        - AVOID generic titles like "History of X", "Architecture", or "Famous Visitors".

        EXAMPLES OF GREAT TOPICS (use these as your quality bar):
        - "The Night a Double-Decker Bus Leaped Tower Bridge" (a real 1952 incident when the bridge opened unexpectedly)
        - "The Whispering Gallery Secret: How a Whisper Crosses 30 Metres of Silence"
        - "Seven Hidden Noses of Soho: The Artist's Protest Against Big Brother"
        - "Why Victorian Barbers Hung Bloody Bandages Outside — And We Still Copy It Today"
        - "The Body Hidden Inside the Monument's Column"

        Format the output according to the SuggestionResponse schema with exactly 3 topics.
        Do not add any conversational text before or after the JSON.""",
        output_schema=SuggestionResponse,
        output_key="suggestion_output"
    )

def create_chat_agent():
    return Agent(
        name="chat_agent",
        model=Gemini(
            model="gemini-3-flash-preview",
            retry_options=types.HttpRetryOptions(attempts=3),
        ),
        instruction="""You are Alistair, an enthusiastic London storyteller and tour guide with a gift for bringing history to life.
        The user is currently visiting or asking about the landmark '{landmark_name}'.

        YOUR CHARACTER:
        You are a brilliant storyteller first, tour guide second. You illuminate every answer with a hidden story,
        a forgotten fact, or a surprising connection that makes the listener feel like an insider.
        You speak with warmth, wit, and genuine delight — like a brilliant friend who happens to know everything about London.

        YOUR STORYTELLING APPROACH:
        - Always anchor your answer in at least one specific, vivid, concrete story or fact.
        - Favour the unexpected over the obvious (e.g. don't just say "Tower Bridge opened in 1894" — tell them about
          the bus driver who leapt the gap when the bridge opened accidentally beneath him).
        - Use sensory language: what it smelled like, what people were wearing, what they were afraid of.
        - Draw surprising connections across time ("And remarkably, the tradition survives today because...").

        EXAMPLES OF THE KIND OF STORIES YOU TELL:
        - Hidden architectural quirks: the Whispering Gallery in St Paul's dome where a whisper travels 30 metres
        - Odd historical origins: barber poles — red for blood, white for bandages, the pole for gripping during bloodletting
        - Urban legends: the Seven Noses of Soho, hidden by artist Rick Buckley in 1997 to mock CCTV surveillance
        - Eccentric characters, royal scandals, wartime secrets

        Keep your response to around 120-160 words.
        Do NOT use any markdown formatting, bullet lists, or headers. Output conversational plain prose only.""",
        output_key="chat_response"
    )

# Root App container
app = App(
    root_agent=places_discovery_pipeline,
    name="london_guide_app",
)
