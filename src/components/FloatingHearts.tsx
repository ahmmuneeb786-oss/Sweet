import { useEffect, useState } from 'react';
import { Heart } from 'lucide-react';
import { usePerformance } from '../contexts/PerformanceContext';

interface HeartProps {
  id: number;
  left: number;
  delay: number;
  duration: number;
  size: number;
  progress: number; // 0–1: how far up its float path a frozen heart sits
}

export function FloatingHearts({ theme }: { theme?: 'light' | 'dark' | 'sweet' }) {
  const [hearts, setHearts] = useState<HeartProps[]>([]);
  const { perfLevel, isLowPerfMode } = usePerformance();
  const isSweet = theme === 'sweet';

  useEffect(() => {
    const count = isSweet ? 22 : 15;
    const initialHearts = Array.from({ length: count }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 5,
      duration: 15 + Math.random() * 10,
      size: 20 + Math.random() * 20,
      // One heart per vertical slice (shuffled by the random offset) so the
      // frozen hearts spread over the whole screen instead of clumping.
      progress: 0.05 + ((i + Math.random()) / count) * 0.9
    }));
    setHearts(initialHearts);
  }, [isSweet]);

  // Minimal: no background hearts at all.
  if (perfLevel === 'minimal') return null;

  // Low-perf mode: freeze each heart at a random point of its float path —
  // same height, tilt and fade it would have mid-animation — so the
  // background looks the same but nothing moves. Moving hearts behind the
  // blurred bubbles/keyboard force those blurs to be redrawn every frame.
  if (isLowPerfMode) {
    return (
      <div className="absolute inset-0 pointer-events-none overflow-hidden z-0">
        {hearts.map((heart) => (
          <div
            key={heart.id}
            className="absolute"
            style={{
              left: `${heart.left}%`,
              bottom: '-50px',
              transform: `translateY(-${heart.progress * 100}vh) rotate(${heart.progress * 360}deg)`,
              opacity: 0.3
            }}
          >
            <Heart
              size={heart.size}
              className={isSweet ? 'fill-[#FF69B4] text-[#FF69B4]' : 'fill-pink-300 text-pink-300'}
            />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden z-0">
      {hearts.map((heart) => (
        <div
          key={heart.id}
          className={`absolute animate-float ${isSweet ? 'opacity-30' : 'opacity-20'}`}
          style={{
            left: `${heart.left}%`,
            animationDelay: `${heart.delay}s`,
            animationDuration: `${heart.duration}s`,
            bottom: '-50px'
          }}
        >
          <Heart
            size={heart.size}
            className={isSweet ? 'fill-[#FF69B4] text-[#FF69B4]' : 'fill-pink-300 text-pink-300'}
          />
        </div>
      ))}
      <style>{`
        @keyframes float {
          0% {
            transform: translateY(0) rotate(0deg);
            opacity: 0;
          }
          10% {
            opacity: 0.3;
          }
          90% {
            opacity: 0.3;
          }
          100% {
            transform: translateY(-100vh) rotate(360deg);
            opacity: 0;
          }
        }
        .animate-float {
          animation: float linear infinite;
        }
      `}</style>
    </div>
  );
}