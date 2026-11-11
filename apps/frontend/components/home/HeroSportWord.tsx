import { useEffect, useRef, useState } from 'react';

const SPORTS = ['fútbol', 'pádel', 'tenis', 'básquet'];

// Keep the rotating word's updates local instead of rendering the whole home page.
export default function HeroSportWord() {
  const wordRef = useRef<HTMLSpanElement>(null);
  const [sportIndex, setSportIndex] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const word = wordRef.current;
    if (!word) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let inViewport = false;
    let interval: ReturnType<typeof setInterval> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const stop = () => {
      clearInterval(interval);
      clearTimeout(timeout);
      interval = undefined;
      timeout = undefined;
    };

    const syncPlayback = () => {
      if (!inViewport || document.hidden || reducedMotion.matches) {
        stop();
        setVisible(true);
        return;
      }
      if (interval !== undefined) return;

      interval = setInterval(() => {
        setVisible(false);
        timeout = setTimeout(() => {
          setSportIndex(index => (index + 1) % SPORTS.length);
          setVisible(true);
          timeout = undefined;
        }, 380);
      }, 2700);
    };

    const observer = new IntersectionObserver(([entry]) => {
      inViewport = entry.isIntersecting;
      syncPlayback();
    });
    observer.observe(word);
    document.addEventListener('visibilitychange', syncPlayback);
    reducedMotion.addEventListener('change', syncPlayback);

    return () => {
      stop();
      observer.disconnect();
      document.removeEventListener('visibilitychange', syncPlayback);
      reducedMotion.removeEventListener('change', syncPlayback);
    };
  }, []);

  return (
    <span ref={wordRef} className={`p-home-sport-word${visible ? '' : ' p-home-sport-word-out'}`}>
      <span className="p-home-grad-text">{SPORTS[sportIndex]}</span>
    </span>
  );
}
