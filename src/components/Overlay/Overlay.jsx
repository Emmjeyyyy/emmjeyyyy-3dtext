import React from 'react';

const Overlay = ({ error }) => {
  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      zIndex: 2,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      fontFamily: "'Cormorant Garamond', Georgia, serif",
      pointerEvents: 'none'
    }}>
      {/* 3D text rendered via Three.js - hidden HTML text for SEO */}
      <h1 id="main-title" style={{
        position: 'absolute',
        fontSize: 'clamp(3rem, 10vw, 8rem)',
        fontWeight: 300,
        letterSpacing: '0.4em',
        textTransform: 'uppercase',
        color: 'transparent',
        WebkitTextFillColor: 'transparent',
        marginBottom: '0.5rem'
      }}>
        EMMJEYYYY
      </h1>

      <p id="interaction-hint" style={{
        position: 'absolute',
        bottom: '25%',
        fontSize: 'clamp(0.8rem, 2vw, 1.1rem)',
        fontWeight: 400,
        letterSpacing: '0.6em',
        color: '#ffffff',
        textTransform: 'uppercase'
      }}>
        3D TEXT TEST
      </p>

      {error && (
        <div id="error-boundary" style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          color: '#ff4444',
          zIndex: 10
        }}>
          Error: {error}
        </div>
      )}
    </div>
  );
};

export default Overlay;
