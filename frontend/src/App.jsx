// Copyright 2026 Google LLC
// Licensed under the Apache License, Version 2.0

import { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';

// Define a custom, beautiful CSS-based marker icon to avoid bundler path issues with Leaflet images
const customIcon = L.divIcon({
  className: 'custom-div-icon',
  html: `<div class="pulse-ring"></div><div class="marker-pin"></div>`,
  iconSize: [30, 42],
  iconAnchor: [15, 42]
});

// Component to handle map click events
function MapEventsHandler({ onMapClick }) {
  const map = useMap();
  useEffect(() => {
    const clickHandler = (e) => {
      onMapClick(e.latlng);
    };
    map.on('click', clickHandler);
    return () => {
      map.off('click', clickHandler);
    };
  }, [map, onMapClick]);
  return null;
}

// Component to smoothly change map view when coordinates change
function ChangeView({ center }) {
  const map = useMap();
  useEffect(() => {
    if (center) {
      map.setView(center, map.getZoom(), { animate: true });
    }
  }, [center, map]);
  return null;
}

function App() {
  // State variables
  const [pin, setPin] = useState({ lat: 51.5074, lng: -0.1278 }); // Default to London Center
  const [radius, setRadius] = useState(2000); // 2km search radius
  const [places, setPlaces] = useState([]);
  const [placesMessage, setPlacesMessage] = useState(null);
  const [visibleCount, setVisibleCount] = useState(5); // Show 5 cards initially
  const [loading, setLoading] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState(null);

  // Routing State
  const [routeCoords, setRouteCoords] = useState([]);
  const [routeInfo, setRouteInfo] = useState(null);

  // Audio State
  const [currentPlace, setCurrentPlace] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [audioLoading, setAudioLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // New Modal and Chat State
  const [activeModal, setActiveModal] = useState(null);
  const [chatHistory, setChatHistory] = useState([]);
  const [chatSessionId, setChatSessionId] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatAudioPlaying, setChatAudioPlaying] = useState(false);
  const [chatAudioUrl, setChatAudioUrl] = useState(null);
  const [recording, setRecording] = useState(false);
  const [micError, setMicError] = useState(null);
  const [chatInputText, setChatInputText] = useState('');

  // Refs
  const audioRef = useRef(null);
  const chatAudioRef = useRef(null);
  const recognitionRef = useRef(null);
  const chatEndRef = useRef(null);

  // Handle map click
  const handleMapClick = (latlng) => {
    setPin({
      lat: parseFloat(latlng.lat.toFixed(6)),
      lng: parseFloat(latlng.lng.toFixed(6))
    });
    setRouteCoords([]);
    setRouteInfo(null);
  };

  // Fetch walking route from pin to destination using OSRM Routing API
  const getRoute = async (start, end) => {
    try {
      // OSRM walking/foot profile URL format: longitude,latitude
      const url = `https://router.project-osrm.org/route/v1/foot/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error('OSRM routing request failed');
      }
      const data = await response.json();
      if (data.routes && data.routes.length > 0) {
        const route = data.routes[0];
        // Map [lng, lat] array from OSRM to Leaflet [lat, lng] format
        const coords = route.geometry.coordinates.map(c => [c[1], c[0]]);
        setRouteCoords(coords);
        setRouteInfo({
          distance_km: (route.distance / 1000).toFixed(2),
          duration_mins: Math.round(route.duration / 60)
        });
      }
    } catch (err) {
      console.error('Routing failed, using straight-line fallback:', err);
      setRouteCoords([[start.lat, start.lng], [end.lat, end.lng]]);
      setRouteInfo({
        distance_km: 'Direct',
        duration_mins: 'Direct path'
      });
    }
  };

  // Locate the user using browser Geolocation API
  const locateUser = () => {
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your browser.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const newPin = {
          lat: parseFloat(position.coords.latitude.toFixed(6)),
          lng: parseFloat(position.coords.longitude.toFixed(6))
        };
        setPin(newPin);
        setLocating(false);
        setRouteCoords([]);
        setRouteInfo(null);
      },
      (err) => {
        alert(`Geolocation error: ${err.message}`);
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 6000, maximumAge: 0 }
    );
  };

  // Fetch nearby places
  const discoverPlaces = async () => {
    setLoading(true);
    setError(null);
    setPlaces([]);
    setPlacesMessage(null);
    setVisibleCount(5); // Reset visibility count
    setRouteCoords([]);
    setRouteInfo(null);
    setCurrentPlace(null);
    
    try {
      const response = await fetch('http://localhost:8000/api/places', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lat: pin.lat,
          lng: pin.lng,
          radius_m: radius
        })
      });
      
      if (!response.ok) {
        throw new Error(`Server returned error status: ${response.status}`);
      }
      
      const data = await response.json();
      const rawPlaces = data.places || [];
      const sorted = [...rawPlaces].sort((a, b) => {
        const distA = a.distance_m ?? 999999;
        const distB = b.distance_m ?? 999999;
        return distA - distB;
      });
      setPlaces(sorted);
      setPlacesMessage(data.message || null);
    } catch (err) {
      setError(err.message || 'Failed to discover nearby places. Make sure the backend server is running.');
    } finally {
      setLoading(false);
    }
  };

  // Fetch and stream MP3 narration and fetch walking route
  const playNarration = async (place) => {
    // If selecting the same place and audio is loaded, toggle play/pause
    if (currentPlace && currentPlace.place_id === place.place_id && audioUrl) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play().catch(err => console.log('Audio playback error:', err));
      }
      return;
    }

    // Stop current audio if playing
    if (audioRef.current) {
      audioRef.current.pause();
    }
    if (chatAudioRef.current) {
      chatAudioRef.current.pause();
      setChatAudioPlaying(false);
    }

    setAudioLoading(true);
    setCurrentPlace(place);
    setAudioUrl(null);
    setIsPlaying(false);
    
    // Fetch walking route path
    getRoute(pin, { lat: place.lat, lng: place.lng }); // Enable drawing route path on map when clicking the card
    
    try {
      const response = await fetch('http://localhost:8000/api/narrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          place_id: place.place_id,
          name: place.name,
          description: place.description
        })
      });

      if (!response.ok) {
        throw new Error(`Audio guide failed to generate: ${response.status}`);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);
    } catch (err) {
      alert(`Narration Error: ${err.message}`);
      setCurrentPlace(null);
    } finally {
      setAudioLoading(false);
    }
  };

  // Close unified overlay modals and pause active audio guides
  const closeModal = () => {
    setActiveModal(null);
    if (audioRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);
    }
    if (chatAudioRef.current) {
      chatAudioRef.current.pause();
      setChatAudioPlaying(false);
    }
    if (recording && recognitionRef.current) {
      recognitionRef.current.stop();
    }
  };

  // Speaks out custom tour guide text responses using backend TTS endpoint
  const playChatTTS = async (text) => {
    setChatAudioPlaying(true);
    if (chatAudioRef.current) {
      chatAudioRef.current.pause();
    }
    setChatAudioUrl(null);

    try {
      const response = await fetch('http://localhost:8000/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      
      if (!response.ok) {
        throw new Error('TTS synthesis failed');
      }
      
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      setChatAudioUrl(url);
    } catch (err) {
      console.error('Chat TTS playback failed:', err);
      setChatAudioPlaying(false);
    }
  };

  // Sends message to backend chat agent and triggers speaking guide response
  const sendChatMessage = async (msgText) => {
    if (!msgText.trim() || chatLoading) return;
    
    // Stop currently playing guide audios
    if (chatAudioRef.current) {
      chatAudioRef.current.pause();
      setChatAudioPlaying(false);
    }
    if (audioRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);
    }

    const newUserMsg = { role: 'user', content: msgText };
    setChatHistory(prev => [...prev, newUserMsg]);
    setChatLoading(true);

    try {
      const response = await fetch('http://localhost:8000/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: chatSessionId,
          landmark_name: currentPlace.name,
          message: msgText
        })
      });
      
      if (!response.ok) {
        throw new Error(`Chat API error: ${response.status}`);
      }
      
      const data = await response.json();
      const replyText = data.text;
      
      setChatHistory(prev => [...prev, { role: 'assistant', content: replyText }]);
      playChatTTS(replyText);
    } catch (err) {
      console.error('Failed to send chat message:', err);
      setChatHistory(prev => [...prev, { role: 'assistant', content: `Sorry, I had trouble connecting. ${err.message}` }]);
    } finally {
      setChatLoading(false);
    }
  };

  // Opens Google Live-like conversation modal and loads landmark topics
  const openChatMode = async () => {
    setActiveModal('chat');
    if (audioRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);
    }
    
    const newSessionId = `chat_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    setChatSessionId(newSessionId);
    
    setChatHistory([
      {
        role: 'assistant',
        content: `Hi there! I am Alistair, your London Guide. I am delighted to share more stories about ${currentPlace.name}. I've suggested 3 topics below, or feel free to ask me anything using voice or text!`
      }
    ]);
    
    setSuggestions([]);
    
    try {
      const response = await fetch('http://localhost:8000/api/chat/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          landmark_name: currentPlace.name,
          description: currentPlace.description
        })
      });
      if (response.ok) {
        const data = await response.json();
        setSuggestions(data.topics || []);
      }
    } catch (err) {
      console.error('Failed to load chat suggestions:', err);
      setSuggestions(['Architectural Secrets', 'Historic Incidents', 'Modern Day Significance']);
    }
  };

  // Start or stop browser voice speech recognition
  const toggleRecording = () => {
    if (!recognitionRef.current) {
      alert('Speech recognition is not supported in your browser or microphone permissions are blocked.');
      return;
    }
    
    if (recording) {
      recognitionRef.current.stop();
    } else {
      if (chatAudioRef.current) {
        chatAudioRef.current.pause();
        setChatAudioPlaying(false);
      }
      recognitionRef.current.start();
    }
  };

  // Audio lifecycle hooks
  useEffect(() => {
    if (audioUrl && audioRef.current) {
      audioRef.current.play()
        .then(() => setIsPlaying(true))
        .catch(err => console.log('Autoplay blocked or failed:', err));
    }
  }, [audioUrl]);

  const togglePlayPause = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(err => console.log('Playback error:', err));
    }
  };

  const handleTimeUpdate = () => {
    if (!audioRef.current) return;
    setCurrentTime(audioRef.current.currentTime);
  };

  const handleLoadedMetadata = () => {
    if (!audioRef.current) return;
    setDuration(audioRef.current.duration);
  };

  const handleAudioEnded = () => {
    setIsPlaying(false);
    setCurrentTime(0);
  };

  const handleProgressChange = (e) => {
    if (!audioRef.current || duration === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const width = rect.width;
    const percentage = clickX / width;
    const newTime = percentage * duration;
    audioRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const formatTime = (time) => {
    if (isNaN(time)) return '0:00';
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  };

  // Chat audio autoplay hook
  useEffect(() => {
    if (chatAudioUrl && chatAudioRef.current) {
      chatAudioRef.current.play()
        .then(() => setChatAudioPlaying(true))
        .catch(err => console.log('Chat audio autoplay error:', err));
    }
  }, [chatAudioUrl]);

  // Speech Recognition hook
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const rec = new SpeechRecognition();
      rec.continuous = false;
      rec.interimResults = false;
      rec.lang = 'en-US';
      
      rec.onstart = () => {
        setRecording(true);
        setMicError(null);
      };
      
      rec.onerror = (e) => {
        console.error('Speech recognition error:', e.error);
        setMicError(e.error === 'not-allowed' ? 'Mic blocked. Please allow mic access.' : e.error);
        setRecording(false);
      };
      
      rec.onend = () => {
        setRecording(false);
      };
      
      rec.onresult = (e) => {
        const resultText = e.results[0][0].transcript;
        if (resultText) {
          sendChatMessage(resultText);
        }
      };
      
      recognitionRef.current = rec;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPlace, chatSessionId]);

  // Scroll to bottom hook for chat messages
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatHistory, chatLoading]);

  return (
    <div className="app-container">
      {/* Hidden audio element */}
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onEnded={handleAudioEnded}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
        />
      )}

      {/* Hidden chat audio element */}
      {chatAudioUrl && (
        <audio
          ref={chatAudioRef}
          src={chatAudioUrl}
          onEnded={() => setChatAudioPlaying(false)}
          onPlay={() => setChatAudioPlaying(true)}
          onPause={() => setChatAudioPlaying(false)}
        />
      )}

      {/* Left Navigation Sidebar */}
      <nav className="nav-sidebar">
        <div className="nav-brand">
          <div className="nav-brand-icon">🇬🇧</div>
          <div className="nav-brand-text">
            <div className="nav-brand-title">London Explorer</div>
            <div className="nav-brand-subtitle">AI Luxury Guide</div>
          </div>
        </div>
        <div className="nav-links">
          <button className="nav-link">
            <span className="material-symbols-outlined">auto_awesome</span>
            Generate a Trip
          </button>
          <button className="nav-link active">
            <span className="material-symbols-outlined">explore</span>
            Discovery
          </button>
          <button className="nav-link" onClick={() => currentPlace && setActiveModal('chat')}>
            <span className="material-symbols-outlined">chat_bubble</span>
            Live Chat
          </button>
          <button className="nav-link">
            <span className="material-symbols-outlined">bookmark</span>
            Saved Guides
          </button>
        </div>
      </nav>

      {/* Map Section */}
      <div className="map-section">
        <MapContainer
          center={[51.5074, -0.1278]}
          zoom={14}
          scrollWheelZoom={true}
          className="map-container"
        >
          <ChangeView center={[pin.lat, pin.lng]} />
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          />
          <Marker position={[pin.lat, pin.lng]} icon={customIcon} />
          {currentPlace && (
            <Marker
              position={[currentPlace.lat, currentPlace.lng]}
              icon={L.divIcon({
                className: 'custom-div-icon',
                html: `<div class="marker-pin" style="background: #3b82f6; box-shadow: 0 0 10px rgba(59, 130, 246, 0.5);"></div>`,
                iconSize: [30, 42],
                iconAnchor: [15, 42]
              })}
            />
          )}
          {routeCoords.length > 0 && (
            <Polyline
              positions={routeCoords}
              color="#eec14a"
              weight={4}
              opacity={0.8}
              dashArray="8, 12"
            />
          )}
          <MapEventsHandler onMapClick={handleMapClick} />
        </MapContainer>
      </div>

      {/* Sidebar Section */}
      <div className="sidebar-section">
        <div className="sidebar-header">
          <div className="sidebar-locality">Locality · London</div>
          <div className="brand">
            <h1>Curated Landmarks</h1>
          </div>
          <p>Drop a pin or use your location to discover places near you</p>
        </div>

        <div className="action-area">
          <div className="coords-box">
            <span className="coords-title">Coordinates Selected</span>
            <span className="coords-values">
              {pin.lat.toFixed(4)}° N, {pin.lng.toFixed(4)}° W
            </span>
          </div>

          <button onClick={locateUser} disabled={locating} className="btn-locate">
            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>my_location</span>
            {locating ? 'Locating...' : 'Use My Location'}
          </button>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--on-surface-variant)' }}>
              <span>Search Radius</span>
              <span style={{ color: 'var(--secondary)', fontWeight: 600 }}>{radius / 1000} km</span>
            </div>
            <input
              type="range"
              min="500"
              max="5000"
              step="500"
              value={radius}
              onChange={(e) => setRadius(parseInt(e.target.value))}
              style={{ accentColor: 'var(--secondary)', cursor: 'pointer', width: '100%' }}
            />
          </div>

          <button onClick={discoverPlaces} disabled={loading} className="btn-primary">
            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>travel_explore</span>
            {loading ? 'Consulting Agent...' : 'Discover Landmarks'}
          </button>
        </div>

        {/* Places List Area */}
        <div className="places-list">
          {placesMessage && (
            <div style={{
              color: '#e5b842',
              fontSize: '13px',
              background: 'rgba(229, 184, 66, 0.08)',
              padding: '12px 16px',
              borderRadius: '8px',
              border: '1px solid rgba(229, 184, 66, 0.2)',
              lineHeight: '1.4',
              marginBottom: '12px',
              textAlign: 'left'
            }}>
              ⚠️ {placesMessage}
            </div>
          )}

          {error && (
            <div style={{ color: '#ef4444', fontSize: '13px', background: 'rgba(239, 68, 68, 0.1)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
              {error}
            </div>
          )}

          {loading ? (
            // Shimmer Loading Skeleton
            <>
              <div className="skeleton-card">
                <div className="skeleton-title"></div>
                <div className="skeleton-text"></div>
              </div>
              <div className="skeleton-card">
                <div className="skeleton-title"></div>
                <div className="skeleton-text"></div>
              </div>
            </>
          ) : places.length > 0 ? (
            <>
              {places.slice(0, visibleCount).map((place) => (
                <article
                  key={place.place_id}
                  onClick={() => { setActiveModal('detail'); playNarration(place); }}
                  className={`place-card ${currentPlace?.place_id === place.place_id ? 'active' : ''}`}
                >
                  {/* Info */}
                  <div className="place-info">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '4px' }}>
                      <span className="category-badge" style={{ position: 'static', fontSize: '9px' }}>{place.category}</span>
                      {place.distance_m !== undefined && place.distance_m !== null && (
                        <span className="distance-pill" style={{ position: 'static', fontSize: '10px' }}>
                          {(place.distance_m / 1000).toFixed(2)} km
                        </span>
                      )}
                    </div>
                    <h3 className="place-name">{place.name}</h3>
                    <p className="place-teaser">{place.teaser}</p>


                    {/* Action buttons */}
                    <div className="card-action-bar">
                      <button
                        className="btn-play-card"
                        onClick={(e) => { e.stopPropagation(); playNarration(place); }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: '16px', fontVariationSettings: "'FILL' 1" }}>
                          {audioLoading && currentPlace?.place_id === place.place_id
                            ? 'hourglass_top'
                            : isPlaying && currentPlace?.place_id === place.place_id
                            ? 'pause'
                            : 'play_arrow'}
                        </span>
                        {audioLoading && currentPlace?.place_id === place.place_id
                          ? 'Synthesizing...'
                          : isPlaying && currentPlace?.place_id === place.place_id
                          ? 'Pause'
                          : 'Play Guide'}
                      </button>
                      <button
                        className="btn-route-card"
                        onClick={(e) => {
                          e.stopPropagation();
                          window.open(`https://www.google.com/maps/dir/?api=1&origin=${pin.lat},${pin.lng}&destination=${place.lat},${place.lng}&travelmode=walking`, '_blank');
                        }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>map</span>
                        Route
                      </button>
                    </div>
                  </div>
                </article>
              ))}

              {places.length > visibleCount && (
                <button
                  onClick={() => setVisibleCount(prev => prev + 5)}
                  style={{
                    width: '100%',
                    padding: '12px',
                    borderRadius: '6px',
                    border: '1px solid rgba(238, 193, 74, 0.2)',
                    background: 'transparent',
                    color: 'var(--secondary)',
                    fontFamily: 'var(--font-sans)',
                    fontSize: '11px',
                    fontWeight: 500,
                    letterSpacing: '0.15em',
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    marginTop: '4px',
                    marginBottom: '12px',
                    transition: 'all 0.2s ease',
                  }}
                  onMouseOver={e => { e.currentTarget.style.background = 'rgba(238,193,74,0.08)'; }}
                  onMouseOut={e => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>arrow_forward</span>
                  Load More Landmarks ({places.length - visibleCount} remaining)
                </button>
              )}
            </>
          ) : (
            <div className="no-places">
              <span className="no-places-icon">🗺️</span>
              <p className="no-places-text">
                Tap anywhere on the map to drop a pin, or click "Use My Location". Then click "Discover Landmarks" to begin.
              </p>
            </div>
          )}
        </div>

        {/* Sticky Audio Player Panel */}
        {(currentPlace || audioLoading) && !activeModal && (
          <div className="audio-player-panel">
            <div className="audio-info">
              <div className="audio-title-group">
                <span className="audio-guide-title">
                  {audioLoading ? 'Generating Guide Audio...' : currentPlace?.name}
                </span>
                <span className="audio-guide-subtitle">
                  {audioLoading
                    ? 'Landmark Audio Guide · Gemini TTS'
                    : routeInfo
                      ? `${routeInfo.distance_km} km · ${routeInfo.duration_mins} mins walk`
                      : 'Landmark Audio Guide'}
                </span>
              </div>
              <div className={`wave-container ${isPlaying && !audioLoading ? 'playing' : ''}`}>
                <div className="wave-bar" /><div className="wave-bar" /><div className="wave-bar" />
                <div className="wave-bar" /><div className="wave-bar" />
              </div>
            </div>

            <div className="audio-controls">
              <button onClick={togglePlayPause} disabled={audioLoading} className="btn-audio-control">
                <span className="material-symbols-outlined" style={{ fontSize: '22px', fontVariationSettings: "'FILL' 1" }}>
                  {audioLoading ? 'hourglass_top' : isPlaying ? 'pause' : 'play_arrow'}
                </span>
              </button>
              <div className="progress-bar-container">
                <div onClick={handleProgressChange} className="progress-bar-wrapper">
                  <div className="progress-bar-fill" style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }} />
                </div>
                <div className="progress-time">
                  <span>{formatTime(currentTime)}</span>
                  <span>{formatTime(duration)}</span>
                </div>
              </div>
            </div>

            {!audioLoading && currentPlace && (
              <button
                className="btn-route-card"
                style={{ width: '100%', justifyContent: 'center', padding: '10px 14px' }}
                onClick={() => window.open(`https://www.google.com/maps/dir/?api=1&origin=${pin.lat},${pin.lng}&destination=${currentPlace.lat},${currentPlace.lng}&travelmode=walking`, '_blank')}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>explore</span>
                Build Route in Google Maps
              </button>
            )}
          </div>
        )}
      </div>

      {/* Details Overlay Modal */}
      {activeModal === 'detail' && currentPlace && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>

            {/* Header */}
            <div className="modal-header">
              <div>
                <div className="modal-category-pill">{currentPlace.category}</div>
                <h2 className="modal-title">{currentPlace.name}</h2>
              </div>
              <button onClick={closeModal} className="modal-close-btn">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            {/* Body */}
            <div className="modal-body">
              {/* Hero image with gradient overlay */}
              <div className="modal-hero-image">
                <img src={currentPlace.photo_url} alt={currentPlace.name} />
              </div>

              {/* Description */}
              <p className="modal-description">{currentPlace.description}</p>

              {/* Audio widget */}
              <div className="modal-audio-widget">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span className="modal-audio-label">
                    {audioLoading ? 'Generating Guide Audio...' : 'Landmark Audio Guide'}
                  </span>
                  <div className={`wave-container ${isPlaying && !audioLoading ? 'playing' : ''}`}>
                    <div className="wave-bar" /><div className="wave-bar" /><div className="wave-bar" />
                    <div className="wave-bar" /><div className="wave-bar" />
                  </div>
                </div>
                <div className="audio-controls">
                  <button onClick={togglePlayPause} disabled={audioLoading} className="btn-audio-control">
                    <span className="material-symbols-outlined" style={{ fontSize: '24px', fontVariationSettings: "'FILL' 1" }}>
                      {audioLoading ? 'hourglass_top' : isPlaying ? 'pause' : 'play_arrow'}
                    </span>
                  </button>
                  <div className="progress-bar-container">
                    <div onClick={handleProgressChange} className="progress-bar-wrapper">
                      <div className="progress-bar-fill" style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }} />
                    </div>
                    <div className="progress-time">
                      <span>{formatTime(currentTime)}</span>
                      <span>{formatTime(duration)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="modal-footer">
              <button
                className="btn-modal-route"
                onClick={() => window.open(`https://www.google.com/maps/dir/?api=1&origin=${pin.lat},${pin.lng}&destination=${currentPlace.lat},${currentPlace.lng}&travelmode=walking`, '_blank')}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>explore</span>
                Build Route
              </button>
              <button className="btn-modal-learn" onClick={openChatMode}>
                <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>chat_bubble</span>
                Want to learn more? ➜
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Interactive Chat Overlay Modal */}
      {activeModal === 'chat' && currentPlace && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ height: '80vh', maxWidth: '650px' }}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontSize: '22px' }}>🇬🇧</span>
                <div>
                  <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: '18px', fontWeight: 500, color: 'var(--secondary)' }}>
                    Alistair — London Guide Live
                  </h2>
                  <span style={{ fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#10b981', display: 'flex', alignItems: 'center', gap: '5px', marginTop: '2px' }}>
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10b981', display: 'inline-block', boxShadow: '0 0 6px #10b981' }} />
                    Connected Live
                  </span>
                </div>
              </div>
              <button onClick={closeModal} className="modal-close-btn">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            
            <div className="modal-body" style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="chat-messages-container" style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px', minHeight: '200px' }}>
                {chatHistory.map((msg, idx) => (
                  <div key={idx} className={`chat-bubble ${msg.role}`}>
                    {msg.content}
                  </div>
                ))}
                {chatLoading && (
                  <div className="chat-bubble assistant" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="dot-flashing"></span>
                    <span>Alistair is writing story...</span>
                  </div>
                )}
                {chatAudioPlaying && (
                  <div style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--accent-gold)', marginLeft: '12px', marginTop: '-8px' }}>
                    🔊 Guide is speaking...
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              {suggestions.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Suggested Topics:</span>
                  <div className="chat-suggestions">
                    {suggestions.map((topic, idx) => (
                      <button
                        key={idx}
                        onClick={() => {
                          sendChatMessage(topic);
                          setSuggestions(prev => prev.filter(t => t !== topic));
                        }}
                        className="suggestion-chip"
                      >
                        💡 {topic}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="modal-footer" style={{ padding: '16px 20px', borderTop: '1px solid var(--border-color)' }}>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (chatInputText.trim()) {
                    sendChatMessage(chatInputText);
                    setChatInputText('');
                  }
                }}
                className="chat-input-bar"
              >
                <button
                  type="button"
                  onClick={toggleRecording}
                  className={`btn-mic ${recording ? 'recording' : ''}`}
                  title={recording ? 'Stop Recording' : 'Record Voice Question'}
                  style={{
                    width: '44px', height: '44px', borderRadius: '50%', flexShrink: 0,
                    border: '1px solid rgba(238, 193, 74, 0.3)',
                    background: 'rgba(238, 193, 74, 0.05)',
                    color: 'var(--secondary)',
                    cursor: 'pointer', display: 'flex', alignItems: 'center',
                    justifyContent: 'center', transition: 'all 0.2s ease',
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '20px', fontVariationSettings: "'FILL' 1" }}>
                    {recording ? 'stop_circle' : 'mic'}
                  </span>
                </button>
                <input
                  type="text"
                  value={chatInputText}
                  onChange={(e) => setChatInputText(e.target.value)}
                  placeholder={recording ? 'Listening...' : 'Type a question for the guide...'}
                  disabled={recording}
                  className="chat-input"
                />
                <button
                  type="submit"
                  disabled={!chatInputText.trim() || chatLoading}
                  className="btn-primary"
                  style={{ padding: '10px 18px', borderRadius: '6px', flexShrink: 0 }}
                >
                  Send
                </button>
              </form>
              {micError && (
                <div style={{ color: 'var(--accent-red)', fontSize: '11px', marginTop: '6px', textAlign: 'center' }}>
                  ⚠️ Microphone status: {micError}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
