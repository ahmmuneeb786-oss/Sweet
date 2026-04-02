import { useState } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { MapPin, X } from 'lucide-react';

// Fix for Leaflet default icon path issues in React
const icon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41]
});

interface MapPickerProps {
  onSelect: (lat: number, lng: number) => void;
  onCancel: () => void;
}

export default function LocationPicker({ onSelect, onCancel }: MapPickerProps) {
  // Default position (Change this to your city's lat/lng if you want)
  const [position, setPosition] = useState<[number, number]>([25.2048, 55.2708]); 

  function LocationMarker() {
    useMapEvents({
      click(e) {
        setPosition([e.latlng.lat, e.latlng.lng]);
      },
    });
    return <Marker position={position} icon={icon} />;
  }

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white w-full max-w-md rounded-[32px] overflow-hidden shadow-2xl flex flex-col animate-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="p-5 bg-pink-500 text-white flex justify-between items-center">
          <div className="flex items-center gap-2">
            <MapPin className="w-5 h-5" />
            <span className="font-black uppercase tracking-wider text-sm">Pick Sweet Spot</span>
          </div>
          <button onClick={onCancel} className="p-1 hover:bg-white/20 rounded-full transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        {/* Map Area */}
        <div className="h-[350px] w-full relative">
          <MapContainer center={position} zoom={13} style={{ height: '100%', width: '100%' }}>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <LocationMarker />
          </MapContainer>
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[1000] bg-white/90 px-4 py-1 rounded-full shadow-sm text-[10px] text-pink-600 font-bold border border-pink-100">
            TAP MAP TO MOVE PIN
          </div>
        </div>

        {/* Action Button */}
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