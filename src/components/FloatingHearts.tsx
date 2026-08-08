import { useEffect, useState } from 'react';
import { Heart } from 'lucide-react';

interface HeartProps {
  id: number;
  left: number;
  delay: number;
  duration: number;
  size: number;
}

export function FloatingHearts({ theme }: { theme?: 'light' | 'dark' | 'sweet' }) {
  const [hearts, setHearts] = useState<HeartProps[]>([]);
  const isSweet = theme === 'sweet';

  useEffect(() => {
    const initialHearts = Array.from({ length: isSweet ? 22 : 15 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 5,
      duration: 15 + Math.random() * 10,
      size: 20 + Math.random() * 20
    }));
    setHearts(initialHearts);
  }, [isSweet]);

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