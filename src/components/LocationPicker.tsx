import { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { MapPin, X, Loader2 } from 'lucide-react'; // Added Loader2 for a cute spinner

const sweetIcon = L.divIcon({
  className: 'custom-pin',
  html: `
    <div class="relative flex items-center justify-center">
      <div class="absolute w-10 h-10 bg-pink-500/30 rounded-full animate-ping"></div>
      
      <div class="relative bg-white p-1 rounded-full shadow-lg border-2 border-pink-500 group">
        <div class="bg-pink-500 rounded-full p-2 text-white">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>
          </svg>
        </div>
        
        <div class="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-pink-500 rotate-45 border-r border-b border-pink-500"></div>
      </div>
    </div>
  `,
  iconSize: [40, 40],
  iconAnchor: [20, 40], // Anchors the "tip" of the heart to the coordinates
});

interface MapPickerProps {
  onSelect: (lat: number, lng: number) => void;
  onCancel: () => void;
}

function RecenterMap({ position }: { position: [number, number] }) {
  const map = useMapEvents({});
  useEffect(() => {
    map.flyTo(position, 15, { duration: 0.5 }); // Zoomed in a bit more for accuracy
  }, [position, map]);
  return null;
}

export default function LocationPicker({ onSelect, onCancel }: MapPickerProps) {
  const [position, setPosition] = useState<[number, number] | null>(null);
  
  // 1. Use a Ref to hold the ID so it doesn't get lost during renders
  const watchIdRef = useRef<number | null>(null);

  useEffect(() => {
    console.log("GPS Hardware: Powering ON ✨");

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setPosition([latitude, longitude]);
      },
      (err) => {
        setPosition([25.2048, 55.2708]);
        console.error("GPS Error:", err.message);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );

    // 2. This ONLY runs when the entire LocationPicker is removed from the screen
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        console.log("GPS Hardware: Powering OFF 🔒");
      }
    };
  }, []);

  function LocationMarker() {
    useMapEvents({
      click(e) {
        setPosition([e.latlng.lat, e.latlng.lng]);
      },
    });
    return position ? <Marker position={position} icon={sweetIcon} /> : null;
  }

  // 2. SHOW LOADING SCREEN if position is null
  if (!position) {
    return (
      <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div className="bg-white p-8 rounded-[32px] flex flex-col items-center gap-4 shadow-2xl animate-in zoom-in-95">
          <Loader2 className="w-10 h-10 text-pink-500 animate-spin" />
          <p className="text-pink-600 font-black tracking-widest text-sm uppercase">Finding You...</p>
          <button onClick={onCancel} className="text-xs text-gray-400 font-bold mt-2 uppercase">Cancel</button>
        </div>
      </div>
    );
  }

  // 3. SHOW MAP only when position is found
  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white w-full max-w-md rounded-[32px] overflow-hidden shadow-2xl flex flex-col animate-in zoom-in-95 duration-200">
        
        <div className="p-5 bg-pink-500 text-white flex justify-between items-center">
          <div className="flex items-center gap-2">
            <MapPin className="w-5 h-5" />
            <span className="font-black uppercase tracking-wider text-sm">Pick Sweet Spot</span>
          </div>
          <button onClick={onCancel} className="p-1 hover:bg-white/20 rounded-full transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="h-[350px] w-full relative">
          {/* MapContainer now uses the device position found in useEffect */}
          <MapContainer center={position} zoom={15} style={{ height: '100%', width: '100%' }}>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <RecenterMap position={position} />
            <LocationMarker />
          </MapContainer>
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[1000] bg-white/90 px-4 py-1 rounded-full shadow-sm text-[10px] text-pink-600 font-bold border border-pink-100 uppercase">
            Tap to move pin
          </div>
        </div>

        <div className="p-6">
          <button 
            onClick={() => onSelect(position[0], position[1])} 
            className="w-full py-4 bg-pink-500 text-white rounded-2xl font-black uppercase text-sm shadow-[0_8px_20px_rgba(236,72,153,0.3)] active:scale-95 transition-all"
          >
            Send This Location
          </button>
        </div>
      </div>
    </div>
  );
}