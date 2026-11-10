import { useEffect, useRef, useState } from 'react';
import { ImageOff } from 'lucide-react';
import { acquireMediaUrl, peekMediaUrl, releaseMediaUrl } from '../lib/mediaCache';
import { resolveMediaUrl } from '../lib/signedMedia';

interface ChatImageProps {
  src: string;
  alt: string;
  className?: string;
  // Size of the box shown while the image is being read/downloaded, so the
  // bubble doesn't start tiny and then jump when the image arrives.
  placeholderClassName?: string;
  // Load right away instead of waiting until it's near the screen (viewer).
  eager?: boolean;
  onClick?: React.MouseEventHandler<HTMLElement>;
}

/**
 * A chat image that's shown from the on-device copy (lib/mediaCache), so it's
 * downloaded at most once and works offline. It only starts loading when it's
 * near the screen, so opening a chat with many photos doesn't read or
 * download all of them at once.
 */
export function ChatImage(props: ChatImageProps) {
  // Keyed by src: when a just-sent photo's local preview is swapped for its
  // uploaded URL, start fresh instead of carrying over the old state.
  return <ChatImageInner key={props.src} {...props} />;
}

function ChatImageInner({ src, alt, className, placeholderClassName = 'h-48 w-full', eager = false, onClick }: ChatImageProps) {
  // data:/blob: previews of a photo being sent are already local.
  const isRemote = /^https?:/.test(src);
  const [url, setUrl] = useState<string | null>(() => (isRemote ? peekMediaUrl(src) : src));
  const [near, setNear] = useState(eager || url !== null);
  const [failed, setFailed] = useState(false);
  const holderRef = useRef<HTMLDivElement>(null);
  const triedNetworkRef = useRef(false);

  useEffect(() => {
    if (near || !isRemote) return;
    const el = holderRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: '800px 0px' } // start a little before it scrolls into view
    );
    io.observe(el);
    return () => io.disconnect();
  }, [near, isRemote]);

  useEffect(() => {
    if (!isRemote || !near) return;
    let cancelled = false;
    let acquired = false;
    acquireMediaUrl(src).then((resolved) => {
      if (cancelled) {
        releaseMediaUrl(src);
        return;
      }
      acquired = true;
      setUrl(resolved);
    });
    return () => {
      cancelled = true;
      if (acquired) releaseMediaUrl(src);
    };
  }, [src, near, isRemote]);

  if (failed) {
    return (
      <div onClick={onClick} className={`${placeholderClassName} flex flex-col items-center justify-center gap-1 bg-pink-200/30 text-pink-400`}>
        <ImageOff className="w-6 h-6" />
        <span className="text-[10px] font-bold">{navigator.onLine ? 'Image unavailable' : 'Not saved for offline'}</span>
      </div>
    );
  }

  if (!url) {
    return <div ref={holderRef} onClick={onClick} role="img" aria-label={alt} className={`${placeholderClassName} bg-pink-200/30`} />;
  }

  return (
    <img
      src={url}
      alt={alt}
      decoding="async"
      className={className}
      onClick={onClick}
      // The saved copy failed to display → try the network (signed) URL once, then give up.
      onError={() => {
        if (triedNetworkRef.current) {
          setFailed(true);
          return;
        }
        triedNetworkRef.current = true;
        resolveMediaUrl(src).then(setUrl);
      }}
    />
  );
}
