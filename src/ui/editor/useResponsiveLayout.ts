import { useEffect, useState } from 'react';

export interface ResponsiveLayout {
  compactWidth: boolean;
  veryNarrow: boolean;
  shortViewport: boolean;
  visualViewport: { width: number; height: number; offsetTop: number; offsetLeft: number };
}

export function readResponsiveLayout(): ResponsiveLayout {
  const fallback = { width: 1024, height: 768, offsetTop: 0, offsetLeft: 0 };
  if (typeof window === 'undefined') {
    return {
      compactWidth: false,
      veryNarrow: false,
      shortViewport: false,
      visualViewport: fallback,
    };
  }
  const viewport = window.visualViewport;
  const visualViewport = {
    width: viewport?.width ?? window.innerWidth,
    height: viewport?.height ?? window.innerHeight,
    offsetTop: viewport?.offsetTop ?? 0,
    offsetLeft: viewport?.offsetLeft ?? 0,
  };
  return {
    compactWidth: window.innerWidth < 640,
    veryNarrow: window.innerWidth < 360,
    shortViewport: visualViewport.height < 720,
    visualViewport,
  };
}

export function useResponsiveLayout(): ResponsiveLayout {
  const [layout, setLayout] = useState(readResponsiveLayout);
  useEffect(() => {
    const sync = () => setLayout(readResponsiveLayout());
    sync();
    window.addEventListener('resize', sync);
    window.visualViewport?.addEventListener('resize', sync);
    window.visualViewport?.addEventListener('scroll', sync);
    return () => {
      window.removeEventListener('resize', sync);
      window.visualViewport?.removeEventListener('resize', sync);
      window.visualViewport?.removeEventListener('scroll', sync);
    };
  }, []);
  return layout;
}
