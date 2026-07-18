import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronLeft, ChevronRight, MoreVertical, Trash2, Download, Star } from 'lucide-react';

interface ImageViewerModalProps {
  images: string[];
  initialIndex?: number;
  alt?: string;
  onClose: () => void;
  /** Only relevant to viewing your OWN profile photos — omit for chat media / other users' profiles */
  onRemove?: (index: number) => void;
  onSetMain?: (index: number) => void;
}

export function ImageViewerModal({ images, initialIndex = 0, alt, onClose, onRemove, onSetMain }: ImageViewerModalProps) {
  const [index, setIndex] = useState(initialIndex);
  const [showActions, setShowActions] = useState(false);

  // Keeps the viewer in sync as `images` shrinks (e.g. removing a photo) —
  // clamps to the last remaining one, or closes entirely if none are left.
  useEffect(() => {
    if (images.length === 0) { onClose(); return; }
    setIndex((i) => Math.min(i, images.length - 1));
  }, [images.length, onClose]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1));
      if (e.key === 'ArrowRight') setIndex((i) => Math.min(images.length - 1, i + 1));
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [images.length, onClose]);

  if (images.length === 0) return null;

  const hasPrev = index > 0;
  const hasNext = index < images.length - 1;
  const hasActions = !!(onRemove || onSetMain);

  const handleDownload = async () => {
    try {
      const res = await fetch(images[index]);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `photo-${index + 1}.jpg`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(blobUrl);
    } catch {
      // Cross-origin fetch blocked or failed — fall back to just opening it,
      // still lets the user save it manually.
      window.open(images[index], '_blank');
    }
    setShowActions(false);
  };

  // Rendered via a portal straight to <body> — this is a fixed inset-0
  // backdrop, and an ancestor with overflow-hidden (e.g. ChatWindow's own
  // pane) or a transform (e.g. the mobile slide-in animation) clips a
  // `position: fixed` descendant right along with everything else, which
  // was why the dimmed backdrop used to stop short of the real screen edges
  // instead of covering the whole viewport.
  return createPortal(
    <div
      className="fixed inset-0 z-[10000] bg-black/90 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors z-10"
      >
        <X className="w-6 h-6 text-white" />
      </button>

      {hasActions && (
        <div className="absolute top-4 right-16 z-10" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => setShowActions((s) => !s)}
            className="p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
          >
            <MoreVertical className="w-6 h-6 text-white" />
          </button>

          {showActions && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowActions(false)} />
              <div className="absolute top-full right-0 mt-2 w-44 bg-white rounded-2xl shadow-2xl overflow-hidden z-20 animate-in fade-in zoom-in-95 duration-150">
                {onSetMain && index !== 0 && (
                  <button
                    onClick={() => { onSetMain(index); setShowActions(false); }}
                    className="w-full px-4 py-3 flex items-center gap-2 text-sm font-medium text-gray-700 hover:bg-pink-50 transition-colors"
                  >
                    <Star className="w-4 h-4 text-pink-500" />
                    Set as Main
                  </button>
                )}
                <button
                  onClick={handleDownload}
                  className="w-full px-4 py-3 flex items-center gap-2 text-sm font-medium text-gray-700 hover:bg-pink-50 transition-colors"
                >
                  <Download className="w-4 h-4 text-gray-500" />
                  Download
                </button>
                {onRemove && (
                  <button
                    onClick={() => { onRemove(index); setShowActions(false); }}
                    className="w-full px-4 py-3 flex items-center gap-2 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                    Remove
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {images.length > 1 && (
        <span className="absolute top-4 left-4 px-3 py-1 rounded-full bg-white/10 text-white text-xs font-bold">
          {index + 1} / {images.length}
        </span>
      )}

      {hasPrev && (
        <button
          onClick={(e) => { e.stopPropagation(); setIndex((i) => i - 1); }}
          className="absolute left-2 md:left-6 top-1/2 -translate-y-1/2 p-2 md:p-3 rounded-full bg-white/10 hover:bg-white/20 transition-colors z-10"
        >
          <ChevronLeft className="w-6 h-6 md:w-8 md:h-8 text-white" />
        </button>
      )}

      {hasNext && (
        <button
          onClick={(e) => { e.stopPropagation(); setIndex((i) => i + 1); }}
          className="absolute right-2 md:right-6 top-1/2 -translate-y-1/2 p-2 md:p-3 rounded-full bg-white/10 hover:bg-white/20 transition-colors z-10"
        >
          <ChevronRight className="w-6 h-6 md:w-8 md:h-8 text-white" />
        </button>
      )}

      <img
        src={images[index]}
        alt={alt || 'Photo'}
        onClick={(e) => e.stopPropagation()}
        className="max-w-full max-h-full rounded-2xl object-contain"
      />
    </div>,
    document.body
  );
}
