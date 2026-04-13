import { useEffect } from 'react';
import fluidCursor from '@/hooks/use-FluidCursor.js';
const FluidCursor = () => {
  useEffect(() => {
    fluidCursor();
  }, []);
  return (
    <canvas
      id="fluid"
      aria-hidden="true"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 2,
        pointerEvents: 'none',
        // Helps the fluid dye pop above the WebGL background without blocking UI.
        mixBlendMode: 'screen',
      }}
    />
  );
};
export default FluidCursor;
