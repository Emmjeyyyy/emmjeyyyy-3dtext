import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { Config } from './config'
import { particleVertexShader, particleFragmentShader } from './shaders'
import { backgroundVertexShader, backgroundFragmentShader } from './shaders'

// Create circular texture
function createCircleTexture() {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  
  const gradient = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2)
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)')
  gradient.addColorStop(0.2, 'rgba(255, 255, 255, 0.9)')
  gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.4)')
  gradient.addColorStop(0.8, 'rgba(255, 255, 255, 0.1)')
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)')
  
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)
  
  return new THREE.CanvasTexture(canvas)
}

// ============================================
// MAIN APP COMPONENT
// ============================================
function App() {
  const containerRef = useRef(null)
  const maskRef = useRef(null)
  const [error, setError] = useState(null)

  // Initialize Three.js objects at component level
  const { scene, camera, frustumSize, trail, bg } = useMemo(() => {
    const aspect = window.innerWidth / window.innerHeight
    const frustum = 10
    
    const s = new THREE.Scene()
    const c = new THREE.OrthographicCamera(
      -frustum * aspect / 2, frustum * aspect / 2,
      frustum / 2, -frustum / 2, 0.1, 100
    )
    c.position.z = 10

    // Create trail particles
    const count = Config.trailLength
    const positions = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)
    const sizes = new Float32Array(count)
    const alphas = new Float32Array(count)
    const history = []
    
    for (let i = 0; i < count; i++) {
      positions[i * 3] = 0
      positions[i * 3 + 1] = 0
      positions[i * 3 + 2] = 0
      
      const color = new THREE.Color()
      color.setHSL(Config.baseHue / 360, Config.saturation, Config.lightness)
      colors[i * 3] = color.r
      colors[i * 3 + 1] = color.g
      colors[i * 3 + 2] = color.b
      
      sizes[i] = 0
      alphas[i] = 0
      history.push({ x: 0, y: 0, velocity: 0 })
    }
    
    const trailGeom = new THREE.BufferGeometry()
    trailGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    trailGeom.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    trailGeom.setAttribute('size', new THREE.BufferAttribute(sizes, 1))
    trailGeom.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1))
    
    const texture = createCircleTexture()
    
    const trailMat = new THREE.ShaderMaterial({
      uniforms: {
        uPixelRatio: { value: 1 },
        uPointSize: { value: Config.particleSize * 50 },
        uTexture: { value: texture }
      },
      vertexShader: particleVertexShader,
      fragmentShader: particleFragmentShader,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
    
    const trailPoints = new THREE.Points(trailGeom, trailMat)
    s.add(trailPoints)

    // Create background
    const bgGeom = new THREE.PlaneGeometry(frustum * aspect * 2, frustum * 2)
    const bgMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uMouse: { value: new THREE.Vector2(0, 0) },
        uVelocity: { value: 0 },
        uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
        uFrustumSize: { value: frustum },
        uAspect: { value: aspect }
      },
      vertexShader: backgroundVertexShader,
      fragmentShader: backgroundFragmentShader,
      transparent: false
    })
    
    const bgMesh = new THREE.Mesh(bgGeom, bgMat)
    bgMesh.position.z = -5
    s.add(bgMesh)

    return { 
      scene: s, 
      camera: c, 
      frustumSize: frustum, 
      trail: { points: trailPoints, material: trailMat, history },
      bg: { mesh: bgMesh, material: bgMat, geometry: bgGeom }
    }
  }, [])

  // Update mask layer to reveal hidden text
  const updateMask = useCallback((history, width, height) => {
    if (!maskRef.current) return
    
    // Create SVG filter for blur effect
    let html = ''
    
    for (let i = 0; i < Math.min(60, Config.trailLength); i++) {
      const h = history[i]
      if (h && h.velocity > 0.25) {
        const screenX = ((h.x + 1) / 2) * width
        const screenY = ((1 - h.y) / 2) * height
        
        const t = i / 60
        const radius = 60 * (1 - t * 0.6)
        const opacity = Math.pow(1 - t, 1.5) * Math.min((h.velocity - 0.25) * 0.2, 0.85)
        
        html += `<circle cx="${screenX}" cy="${screenY}" r="${radius}" fill="rgba(255,255,255,${opacity})" />`
      }
    }
    
    if (html) {
      maskRef.current.innerHTML = html
    } else {
      maskRef.current.innerHTML = ''
    }
  }, [])

  useEffect(() => {
    let renderer, composer
    let smoothedCursor = new THREE.Vector2(0, 0)
    let lastSmoothedCursor = new THREE.Vector2(0, 0)
    let velocity = 0
    let animationId
    let clock

    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
      renderer.setSize(window.innerWidth, window.innerHeight)
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      renderer.setClearColor(0x0a0a0a, 1)
      containerRef.current.appendChild(renderer.domElement)

      trail.material.uniforms.uPixelRatio.value = renderer.getPixelRatio()

      composer = new EffectComposer(renderer)
      composer.addPass(new RenderPass(scene, camera))
      composer.addPass(new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        Config.bloomStrength, Config.bloomRadius, Config.bloomThreshold
      ))

      clock = new THREE.Clock()

      // Mouse tracking
      let currentMouse = new THREE.Vector2(0, 0)
      const updateMouse = (x, y) => {
        currentMouse.x = (x / window.innerWidth) * 2 - 1
        currentMouse.y = -(y / window.innerHeight) * 2 + 1
      }

      window.addEventListener('mousemove', e => updateMouse(e.clientX, e.clientY))
      window.addEventListener('touchmove', e => e.touches[0] && updateMouse(e.touches[0].clientX, e.touches[0].clientY))
      window.addEventListener('touchstart', e => e.touches[0] && updateMouse(e.touches[0].clientX, e.touches[0].clientY))

      // Resize handler
      const onResize = () => {
        const w = window.innerWidth, h = window.innerHeight, a = w / h
        const fs = frustumSize
        camera.left = -fs * a / 2
        camera.right = fs * a / 2
        camera.top = fs / 2
        camera.bottom = -fs / 2
        camera.updateProjectionMatrix()
        renderer.setSize(w, h)
        composer.setSize(w, h)
        
        bg.geometry.dispose()
        bg.geometry = new THREE.PlaneGeometry(fs * a * 2, fs * 2)
        bg.material.uniforms.uResolution.value.set(w, h)
        bg.material.uniforms.uAspect.value = a
        composer.passes[1].resolution.set(w, h)
      }
      window.addEventListener('resize', onResize)

      // Animation loop
      const animate = () => {
        animationId = requestAnimationFrame(animate)
        
        const delta = Math.min(clock.getDelta(), 0.1)
        const time = clock.getElapsedTime()
        
        lastSmoothedCursor.copy(smoothedCursor)
        const lerpFactor = 1 - Math.pow(1 - Config.damping, delta * 60)
        smoothedCursor.lerp(currentMouse, lerpFactor)
        
        const deltaPos = smoothedCursor.clone().sub(lastSmoothedCursor)
        velocity = Math.min(deltaPos.length() * Config.velocityMultiplier * 60, Config.maxVelocity)
        
        // Update trail history
        const history = trail.history
        for (let i = history.length - 1; i > 0; i--) {
          history[i] = { ...history[i - 1] }
        }
        history[0] = { x: smoothedCursor.x, y: smoothedCursor.y, velocity }
        
        const aspect = window.innerWidth / window.innerHeight
        const halfWidth = frustumSize * aspect / 2
        const halfHeight = frustumSize / 2
        
        const posAttr = trail.points.geometry.getAttribute('position')
        const sizeAttr = trail.points.geometry.getAttribute('size')
        const alphaAttr = trail.points.geometry.getAttribute('alpha')
        const colorAttr = trail.points.geometry.getAttribute('color')
        
        for (let i = 0; i < Config.trailLength; i++) {
          const h = history[i]
          const t = i / Config.trailLength
          
          posAttr.array[i * 3] = h.x * halfWidth
          posAttr.array[i * 3 + 1] = h.y * halfHeight
          posAttr.array[i * 3 + 2] = 0
          
          const baseSize = Config.particleSize * (1 - t * 0.85)
          const velocityBoost = 1 + h.velocity * 0.12
          sizeAttr.array[i] = baseSize * velocityBoost
          
          const ageFade = Math.pow(1 - t, 1.8)
          const velocityThreshold = 1.5
          const velocityFade = h.velocity < velocityThreshold 
            ? 0 
            : Math.min((h.velocity - velocityThreshold) * 0.1, 1)
          alphaAttr.array[i] = ageFade * velocityFade * Config.particleOpacity
          
          const hue = (Config.baseHue + t * 25 + time * 8) % 360
          const color = new THREE.Color()
          color.setHSL(hue / 360, Config.saturation, Config.lightness)
          colorAttr.array[i * 3] = color.r
          colorAttr.array[i * 3 + 1] = color.g
          colorAttr.array[i * 3 + 2] = color.b
        }
        
        posAttr.needsUpdate = true
        sizeAttr.needsUpdate = true
        alphaAttr.needsUpdate = true
        colorAttr.needsUpdate = true
        
        // Update background
        bg.material.uniforms.uTime.value = time
        bg.material.uniforms.uMouse.value.copy(smoothedCursor)
        bg.material.uniforms.uVelocity.value = velocity
        
        // Update SVG mask
        updateMask(history, window.innerWidth, window.innerHeight)
        
        composer.render()
      }

      animate()

      return () => {
        if (animationId) cancelAnimationFrame(animationId)
        window.removeEventListener('mousemove', e => updateMouse(e.clientX, e.clientY))
        window.removeEventListener('resize', onResize)
        if (containerRef.current && renderer.domElement) {
          containerRef.current.removeChild(renderer.domElement)
        }
        renderer.dispose()
        composer.dispose()
      }
    } catch (err) {
      console.error(err)
      setError(err.message)
    }
  }, [scene, camera, frustumSize, trail, bg, updateMask])

  return (
    <>
      <div ref={containerRef} style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', zIndex: 1, background: '#0a0a0a' }} />
      
      {/* SVG Mask Layer - reveals black text */}
      <svg 
        ref={maskRef}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          zIndex: 3,
          pointerEvents: 'none',
          filter: 'blur(8px)'
        }}
      />
      
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
        {/* Hidden black text - revealed by mask */}
        <h1 style={{
          position: 'absolute',
          fontSize: 'clamp(3rem, 10vw, 8rem)',
          fontWeight: 300,
          letterSpacing: '0.4em',
          textTransform: 'uppercase',
          color: '#000000',
          marginBottom: '0.5rem',
          mixBlendMode: 'multiply'
        }}>
          Fluid
        </h1>
        
        {/* White text on top */}
        <h1 style={{
          position: 'absolute',
          fontSize: 'clamp(3rem, 10vw, 8rem)',
          fontWeight: 300,
          letterSpacing: '0.4em',
          textTransform: 'uppercase',
          background: `
            linear-gradient(
              135deg,
              #f5f5fa 0%,
              #e8e8f2 15%,
              #d0d0dd 25%,
              #f8f8ff 35%,
              #e0e0ed 45%,
              #c8c8d5 55%,
              #f0f0fa 65%,
              #d8d8e5 75%,
              #e5e5f0 85%,
              #f5f5ff 100%
            )
          `,
          WebkitBackgroundClip: 'text',
          backgroundClip: 'text',
          color: 'transparent',
          marginBottom: '0.5rem',
          textShadow: `
            0 0 40px rgba(220, 225, 255, 0.5),
            0 0 80px rgba(200, 210, 255, 0.3),
            0 0 120px rgba(180, 195, 255, 0.15)
          `
        }}>
          Fluid
        </h1>
        
        <p style={{
          position: 'absolute',
          bottom: '25%',
          fontSize: 'clamp(0.8rem, 2vw, 1.1rem)',
          fontWeight: 400,
          letterSpacing: '0.6em',
          opacity: 0.35,
          color: '#e8e8e8',
          textTransform: 'uppercase'
        }}>
          Move your cursor
        </p>
      </div>
      
      {error && <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', color: '#ff4444', zIndex: 10 }}>Error: {error}</div>}
    </>
  )
}

export default App
