import { X } from 'lucide-react';

interface ImageViewerModalProps {
  src: string;
  alt?: string;
  onClose: () => void;
}

export function ImageViewerModal({ src, alt, onClose }: ImageViewerModalProps) {
  return (
    <div
      className="fixed inset-0 z-[10000] bg-black/90 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
      >
        <X className="w-6 h-6 text-white" />
      </button>
      <img
        src={src}
        alt={alt || 'Profile picture'}
        onClick={(e) => e.stopPropagation()}
        className="max-w-full max-h-full rounded-2xl object-contain"
      />
    </div>
  );
}