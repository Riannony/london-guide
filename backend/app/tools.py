# Copyright 2026 Google LLC
# Licensed under the Apache License, Version 2.0

import math
import os

import requests

# Curated list of famous London landmarks for fallback
CURATED_LANDMARKS = [
    {
        "place_id": "tower_bridge",
        "name": "Tower Bridge",
        "teaser": "An iconic symbol of London, this Victorian engine of history stands proud over the River Thames.",
        "category": "Landmark",
        "photo_url": "https://images.unsplash.com/photo-1549880338-65ddcdfd017b?w=600",
        "description": "Tower Bridge is a combined bascule and suspension bridge in London, built between 1886 and 1894. The bridge crosses the River Thames close to the Tower of London and has become an iconic symbol of London.",
        "lat": 51.5055,
        "lng": -0.0754
    },
    {
        "place_id": "big_ben",
        "name": "Big Ben & Palace of Westminster",
        "teaser": "The monumental clock tower and seat of British Parliament, echoing London's historical chime.",
        "category": "Historical Site",
        "photo_url": "https://images.unsplash.com/photo-1520986606214-8b456906c813?w=600",
        "description": "Big Ben is the nickname for the Great Bell of the striking clock at the north end of the Palace of Westminster in London. The official name of the tower in which Big Ben is located is the Elizabeth Tower.",
        "lat": 51.5007,
        "lng": -0.1246
    },
    {
        "place_id": "london_eye",
        "name": "The London Eye",
        "teaser": "A giant Ferris wheel on the South Bank, offering panoramic vistas across the capital.",
        "category": "Entertainment",
        "photo_url": "https://images.unsplash.com/photo-1507608869274-d3177c8bb4c7?w=600",
        "description": "The London Eye is a cantilevered observation wheel on the South Bank of the River Thames in London. It is Europe's tallest cantilevered observation wheel, and the most popular paid tourist attraction in the United Kingdom.",
        "lat": 51.5033,
        "lng": -0.1195
    },
    {
        "place_id": "buckingham_palace",
        "name": "Buckingham Palace",
        "teaser": "The official London residence and administrative headquarters of the British monarch.",
        "category": "Royal Palace",
        "photo_url": "https://images.unsplash.com/photo-1533929736458-ca588d08c8be?w=600",
        "description": "Buckingham Palace is the London residence and administrative headquarters of the monarch of the United Kingdom. Located in the City of Westminster, the palace is often at the center of state occasions and royal hospitality.",
        "lat": 51.5014,
        "lng": -0.1419
    },
    {
        "place_id": "british_museum",
        "name": "The British Museum",
        "teaser": "A public museum dedicated to human history, art, and culture, housing the Rosetta Stone.",
        "category": "Museum",
        "photo_url": "https://images.unsplash.com/photo-1580541832626-2a7131ee809f?w=600",
        "description": "The British Museum is a public museum dedicated to human history, art and culture, located in the Bloomsbury area of London. Its permanent collection of eight million works is among the largest and most comprehensive in existence.",
        "lat": 51.5194,
        "lng": -0.1270
    },
    {
        "place_id": "tower_of_london",
        "name": "Tower of London",
        "teaser": "A historic castle founded in 1066, home to the Crown Jewels and centuries of intrigue.",
        "category": "History",
        "photo_url": "https://images.unsplash.com/photo-1585647347384-2593bc35786b?w=600",
        "description": "The Tower of London, officially Her Majesty's Royal Palace and Fortress of the Tower of London, is a historic castle on the north bank of the River Thames in central London.",
        "lat": 51.5081,
        "lng": -0.0759
    },
    {
        "place_id": "trafalgar_square",
        "name": "Trafalgar Square",
        "teaser": "A vibrant public square containing Nelson's Column and surrounded by the National Gallery.",
        "category": "Square",
        "photo_url": "https://images.unsplash.com/photo-1508849789987-4e5333c12b78?w=600",
        "description": "Trafalgar Square is a public square in the City of Westminster, Central London, established in the early 19th century around the area formerly known as Charing Cross.",
        "lat": 51.5080,
        "lng": -0.1281
    },
    {
        "place_id": "st_pauls_cathedral",
        "name": "St. Paul's Cathedral",
        "teaser": "An Anglican cathedral with a world-famous dome, dominating the city skyline for over 300 years.",
        "category": "Cathedral",
        "photo_url": "https://images.unsplash.com/photo-1563245372-f21724e3856d?w=600",
        "description": "St Paul's Cathedral is an Anglican cathedral in London, the seat of the Bishop of London. The cathedral serves as the mother church of the Diocese of London.",
        "lat": 51.5138,
        "lng": -0.0984
    },
    {
        "place_id": "hyde_park",
        "name": "Hyde Park",
        "teaser": "One of the largest royal parks in London, famous for its Speakers' Corner and Serpentine Lake.",
        "category": "Park",
        "photo_url": "https://images.unsplash.com/photo-1502082553048-f009c37129b9?w=600",
        "description": "Hyde Park is a Grade I-listed major park in Central London. It is the largest of four Royal Parks that form a chain from the entrance of Kensington Palace through Kensington Gardens and Hyde Park via Hyde Park Corner and Green Park.",
        "lat": 51.5073,
        "lng": -0.1697
    },
    {
        "place_id": "westminster_abbey",
        "name": "Westminster Abbey",
        "teaser": "A royal church offering daily worship and the site of every Coronation since 1066.",
        "category": "Church",
        "photo_url": "https://images.unsplash.com/photo-1543872084-c7bd3822856f?w=600",
        "description": "Westminster Abbey, formally titled the Collegiate Church of Saint Peter at Westminster, is a large, mainly Gothic abbey church in the City of Westminster, London, England, just to the west of the Palace of Westminster.",
        "lat": 51.4993,
        "lng": -0.1273
    }
]


def haversine_distance(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Calculates the great-circle distance between two points in meters."""
    R = 6371000  # Radius of the Earth in meters
    phi_1 = math.radians(lat1)
    phi_2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lng2 - lng1)

    a = math.sin(delta_phi / 2.0) ** 2 + \
        math.cos(phi_1) * math.cos(phi_2) * \
        math.sin(delta_lambda / 2.0) ** 2
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))

    return R * c


def search_nearby_places(lat: float, lng: float, radius_m: int) -> dict:
    """Searches for nearby landmarks and points of interest around specified coordinates.

    Args:
        lat: Latitude of the center point (e.g., 51.5074).
        lng: Longitude of the center point (e.g., -0.1278).
        radius_m: Search radius in meters (e.g., 1000).

    Returns:
        A dictionary containing a list of matching places with details:
        name, teaser, category, photo_url, place_id, and description.
    """
    places_api_key = os.environ.get("GOOGLE_PLACES_API_KEY")

    if places_api_key:
        try:
            # Perform a real call to Google Places API (New) Search Nearby
            url = "https://places.googleapis.com/v1/places:searchNearby"
            headers = {
                "Content-Type": "application/json",
                "X-Goog-Api-Key": places_api_key,
                "X-Goog-FieldMask": "places.id,places.displayName,places.primaryType,places.types,places.editorialSummary,places.photos,places.location"
            }
            body = {
                "includedTypes": [
                    "tourist_attraction", "museum", "park", "landmark", "historical_landmark",
                    "church", "zoo", "amusement_park", "national_park"
                ],
                "maxResultCount": 20,
                "locationRestriction": {
                    "circle": {
                        "center": {
                            "latitude": lat,
                            "longitude": lng
                        },
                        "radius": float(radius_m)
                    }
                }
            }
            response = requests.post(url, json=body, headers=headers, timeout=10)
            if response.status_code == 200:
                data = response.json()
                places = data.get("places", [])

                results = []
                for p in places:
                    name = p.get("displayName", {}).get("text", "Unknown Landmark")

                    # Extract editorial summary or construct fallback teaser
                    teaser = p.get("editorialSummary", {}).get("text", "")
                    if not teaser:
                        # Construct a generic description based on type
                        ptype = p.get("primaryType", "landmark").replace("_", " ").title()
                        teaser = f"A popular {ptype.lower()} located in London."

                    # Ensure it is a single sentence
                    teaser = teaser.split(".")[0] + "."

                    # Determine a clean category
                    category = p.get("primaryType", "landmark").replace("_", " ").title()

                    # Extract Photo URL if available
                    photo_url = "https://images.unsplash.com/photo-1549880338-65ddcdfd017b?w=600" # Fallback photo
                    photos = p.get("photos", [])
                    if photos:
                        photo_name = photos[0].get("name")
                        if photo_name:
                            # Proxy through backend to avoid CORS issues in browser img tags
                            photo_url = f"http://localhost:8000/api/photo?name={photo_name}&key={places_api_key}"

                    p_lat = p.get("location", {}).get("latitude", lat)
                    p_lng = p.get("location", {}).get("longitude", lng)
                    dist = haversine_distance(lat, lng, p_lat, p_lng)

                    results.append({
                        "place_id": p.get("id"),
                        "name": name,
                        "teaser": teaser,
                        "category": category,
                        "photo_url": photo_url,
                        "description": p.get("editorialSummary", {}).get("text", f"A beautiful {category.lower()} to explore."),
                        "lat": p_lat,
                        "lng": p_lng,
                        "distance_m": dist
                    })

                # Sort results by distance (closest first)
                results.sort(key=lambda x: x["distance_m"])

                if results:
                    return {
                        "status": "success",
                        "places": results,
                        "message": None
                    }
        except Exception as e:
            # Log error and fall back to curated landmarks
            print(f"Error calling Places API, falling back: {e}")

    # Fallback to curated landmarks: calculate distance and return nearest ones
    landmarks_with_distance = []
    any_within_radius = False
    for lm in CURATED_LANDMARKS:
        dist = haversine_distance(lat, lng, lm["lat"], lm["lng"])
        lm_copy = lm.copy()
        lm_copy["distance_m"] = dist
        landmarks_with_distance.append((dist, lm_copy))
        if dist <= radius_m:
            any_within_radius = True

    # Sort landmarks by distance
    landmarks_with_distance.sort(key=lambda x: x[0])

    selected_places = [item[1] for item in landmarks_with_distance]

    message = None
    if not any_within_radius:
        radius_km = radius_m / 1000
        message = f"We couldn't find any sights in your area (within {radius_km} km), but note that parks, zoos, and historic sites are also considered landmarks! Here are the nearest London landmarks:"

    return {
        "status": "success",
        "places": selected_places,
        "message": message
    }
