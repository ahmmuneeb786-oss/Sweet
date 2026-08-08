import { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { MapPin, X, Loader2 } from 'lucide-react';
import { PermissionManager } from '../services/PermissionManager'; // 🌟 Links into your updated manager file

// Custom HTML/Tailwind styling for the marker pin wrapper layout
const sweetIcon = L.divIcon({
  className: 'custom-pin',
  html: `
    <div class="relative flex items-center justify-center">
      <div class="absolute w-10 h-10 bg-pink-500/30 rounded-full animate-ping"></div>
      <div class="relative bg-white p-1 rounded-full shadow-lg border-2 border-pink-500">
        <div class="bg-pink-500 rounded-full p-2 text-white flex items-center justify-center">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"></path>
            <circle cx="12" cy="10" r="3"></circle>
          </svg>
        </div>
      </div>
    </div>
  `,
  iconSize: [40, 40],
  iconAnchor: [20, 20]
});

interface LocationPickerProps {
  onSelect: (lat: number, lng: number) => void;
  onCancel: () => void;
}

export default function LocationPicker({ onSelect, onCancel }: LocationPickerProps) {
  // Default to fallback coordinates if everything else fails (e.g., London coordinates)
  const [position, setPosition] = useState<[number, number]>([51.505, -0.09]);
  const [loadingLocation, setLoadingLocation] = useState(true);

  useEffect(() => {
    async function acquireUserLocation() {
      try {
        // 1. Ask PermissionManager specifically for 'location' rights just-in-time
        const contextGranted = await PermissionManager.requestPermission('location');
        
        if (contextGranted && 'geolocation' in navigator) {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              // On success: Snap to physical coordinates
              setPosition([pos.coords.latitude, pos.coords.longitude]);
              setLoadingLocation(false);
            },
            (error) => {
              console.warn("Geolocation API failure callback:", error);
              // 🌟 BUG FIX Fallback: Don't get stuck spinning! Use defaults so user can still drop a pin
              setLoadingLocation(false);
            },
            { enableHighAccuracy: true, timeout: 7000 }
          );
        } else {
          // If denied, stop spinner immediately so user can navigate map from fallback spot manually
          setLoadingLocation(false);
        }
      } catch (err) {
        console.error("Failed inside location extraction pipeline setup:", err);
        setLoadingLocation(false);
      }
    }

    acquireUserLocation();
  }, []);

  // 🌟 UX FIX: Map interactions sub-component tracker
  function MapEventsHandler() {
    useMapEvents({
      click(e) {
        // Change the marker position to the tapped coordinate
        setPosition([e.latlng.lat, e.latlng.lng]);
      },
    });
    return null;
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-lg bg-[#FFF0F5] border border-[#FFB6C1] rounded-3xl overflow-hidden shadow-2xl flex flex-col">
        
        {/* HEADER BAR */}
        <div className="bg-[#8B004B] text-white p-5 flex items-center justify-between shadow-md">
          <div className="flex items-center gap-2">
            <MapPin className="w-5 h-5 animate-bounce" />
            <span className="font-black uppercase tracking-wider text-sm">Pick Your Spot</span>
          </div>
          <button onClick={onCancel} className="p-1.5 hover:bg-white/10 active:scale-95 rounded-full transition-all">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        {/* INTERACTIVE MAP FIELD BODY */}
        <div className="h-[380px] w-full relative bg-gray-100 flex items-center justify-center">
          {loadingLocation ? (
            <div className="flex flex-col items-center gap-3 z-50 text-[#8B004B]">
              <Loader2 className="w-10 h-10 animate-spin text-pink-500" />
              <p className="text-xs font-bold uppercase tracking-widest animate-pulse">Locating sweet spot...</p>
            </div>
          ) : (
            <>
              {/* 🌟 UX FIX: Removed '<RecenterMap>' component to stop forced camera resets when tapping */}
              <MapContainer center={position} zoom={15} style={{ height: '100%', width: '100%' }}>
                <TileLayer 
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" 
                  attribution='&copy; <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>'
                />
                <MapEventsHandler />
                <Marker position={position} icon={sweetIcon} />
              </MapContainer>
              
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[1000] bg-white/90 backdrop-blur-sm px-4 py-1.5 rounded-full shadow-md text-[10px] text-pink-600 font-extrabold border border-pink-100 uppercase tracking-wider select-none">
                Tap anywhere to relocate pin 📍
              </div>
            </>
          )}
        </div>

        {/* BOTTOM CONTROLS FOOTER PANEL */}
        <div className="p-5 bg-white border-t border-[#FFB6C1]/30">
          <button 
            onClick={() => onSelect(position[0], position[1])} 
            disabled={loadingLocation}
            className="w-full py-4 bg-pink-500 hover:bg-pink-600 disabled:bg-gray-300 text-white font-black uppercase tracking-widest rounded-2xl shadow-lg transition-all active:scale-[0.98] disabled:scale-100 text-sm"
          >
            Confirm Location Choice 🌟
          </button>
        </div>

      </div>
    </div>
  );
}