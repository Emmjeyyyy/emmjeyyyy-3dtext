import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js'
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js'
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
        uPointSize: { value: Config.particleSize * 25 },
        uTexture: { value: texture }
      },
      vertexShader: particleVertexShader,
      fragmentShader: particleFragmentShader,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
    
    const trailPoints = new THREE.Points(trailGeom, trailMat)
    trailPoints.position.z = 6  // Render in front of text (z=1)
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

    // Create 3D metallic text placeholder (will be loaded with font)
    let textMesh = null
    let textMaterial = null

    return { 
      scene: s, 
      camera: c, 
      frustumSize: frustum, 
      trail: { points: trailPoints, material: trailMat, history },
      bg: { mesh: bgMesh, material: bgMat, geometry: bgGeom },
      text: { mesh: textMesh, material: textMaterial }
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
      renderer.setClearColor(0x888888, 1)
      containerRef.current.appendChild(renderer.domElement)

      trail.material.uniforms.uPixelRatio.value = renderer.getPixelRatio()

      composer = new EffectComposer(renderer)
      composer.addPass(new RenderPass(scene, camera))
      composer.addPass(new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        Config.bloomStrength, Config.bloomRadius, Config.bloomThreshold
      ))

      // Create premium iridescent material with soft, blurred reflections
      const iridescentMaterial = new THREE.MeshPhysicalMaterial({
        color: 0xe8f4ff,
        metalness: 0.7,  // Lower for softer reflections
        roughness: 0.35,  // Higher for more blurred/fuzzy highlights
        clearcoat: 0.5,  // Less clearcoat for softer look
        clearcoatRoughness: 0.4,
        reflectivity: 0.5,
        iridescence: 0.3,  // Very subtle iridescence
        iridescenceIOR: 1.3,
        iridescenceThicknessRange: [300, 700],
        sheen: 0.3,  // Subtle sheen
        sheenRoughness: 0.5,  // Fuzzy sheen
        sheenColor: new THREE.Color(0x88ccff),
        emissive: 0x0a1520,
        emissiveIntensity: 0.02
      })

      // Add dynamic circular spot lights matching trail color (cyan/blue)
      const keyLight = new THREE.PointLight(0x88ddff, 1.2, 15)  // Cyan - shorter range for circular falloff
      keyLight.position.set(5, 5, 5)
      scene.add(keyLight)

      const fillLight = new THREE.PointLight(0x66bbff, 0.8, 12)  // Blue-cyan
      fillLight.position.set(-5, 3, 3)
      scene.add(fillLight)

      const rimLight = new THREE.PointLight(0x99ccff, 1.0, 10)  // Light blue
      rimLight.position.set(0, -3, 5)
      scene.add(rimLight)

      // Add ambient light for base illumination - subtle cyan tint
      const ambientLight = new THREE.AmbientLight(0x334455, 0.3)
      scene.add(ambientLight)

      // Load font and create 3D text centered in scene
      const fontLoader = new FontLoader()
      fontLoader.load('https://threejs.org/examples/fonts/helvetiker_bold.typeface.json', (font) => {
        const textGeo = new TextGeometry('EMMJEYYYY', {
          font: font,
          size: 1.8,
          height: 0.5,
          curveSegments: 16,
          bevelEnabled: true,
          bevelThickness: 0.1,
          bevelSize: 0.08,
          bevelOffset: 0,
          bevelSegments: 12
        })
        
        // Center the geometry
        textGeo.center()
        
        const textMesh = new THREE.Mesh(textGeo, iridescentMaterial)
        textMesh.position.set(0, 0, 1)  // Center in viewport
        scene.add(textMesh)
      })

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
          posAttr.array[i * 3 + 2] = 2  // Offset for front rendering
          
          const baseSize = Config.particleSize * (1 - t * 0.85)
          const velocityBoost = 1 + h.velocity * 0.12
          // Add ripple effect - pulsing size based on time and particle age
          const ripple = 1 + Math.sin(time * 8 + t * 10) * 0.3 * (1 - t)
          sizeAttr.array[i] = baseSize * velocityBoost * ripple
          
          const ageFade = Math.pow(1 - t, 1.2)  // Smoother fade curve
          const velocityThreshold = 1.5
          const velocityFade = h.velocity < velocityThreshold 
            ? 0 
            : Math.min(Math.pow((h.velocity - velocityThreshold) * 0.08, 0.8), 1)  // Smoother velocity fade
          alphaAttr.array[i] = ageFade * velocityFade * Config.particleOpacity * 1.2  // Slightly higher for glow
          
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
        
        // Update 3D text - subtle rotation based on mouse position
        scene.traverse((child) => {
          if (child instanceof THREE.Mesh && child.geometry instanceof TextGeometry) {
            child.rotation.x = smoothedCursor.y * 0.15
            child.rotation.y = smoothedCursor.x * 0.15
            // Dynamic color matching trail
            const trailHue = (Config.baseHue + time * 8) % 360
            const trailColor = new THREE.Color()
            trailColor.setHSL(trailHue / 360, 0.8, 0.6)
            child.material.emissive.copy(trailColor).multiplyScalar(0.015 + velocity * 0.008)
            child.material.sheenColor.copy(trailColor)
          }
          // Update dynamic circular spot lights with color matching trail (dynamic hue)
          if (child instanceof THREE.PointLight) {
            // Calculate distance from center (where text is)
            const distFromCenter = Math.sqrt(smoothedCursor.x * smoothedCursor.x + smoothedCursor.y * smoothedCursor.y)
            const proximityFactor = Math.max(0, 1 - distFromCenter * 0.5)
            
            // Dynamic color matching trail - uses same hue calculation as particles
            const trailHue = (Config.baseHue + time * 8) % 360
            const trailColor = new THREE.Color()
            trailColor.setHSL(trailHue / 360, 0.8, 0.7)
            
            if (child === keyLight) {
              child.position.x = smoothedCursor.x * 8 + 5
              child.position.y = smoothedCursor.y * 5 + 5
              child.intensity = 0.3 + proximityFactor * 0.3  // Reduced intensity
              child.color.copy(trailColor)
            } else if (child === fillLight) {
              child.position.x = smoothedCursor.x * 8 - 5
              child.position.y = smoothedCursor.y * 5 + 3
              child.intensity = 0.2 + proximityFactor * 0.2  // Reduced intensity
              child.color.copy(trailColor).offsetHSL(0, -0.1, -0.1)
            } else if (child === rimLight) {
              child.position.x = smoothedCursor.x * 8
              child.position.y = smoothedCursor.y * 5 - 3
              child.intensity = 0.25 + proximityFactor * 0.25  // Reduced intensity
              child.color.copy(trailColor).offsetHSL(0.02, 0.1, 0.1)
            }
          }
        })
        
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
        // Dispose lights
        scene.traverse((child) => {
          if (child instanceof THREE.PointLight) {
            child.dispose()
          }
        })
      }
    } catch (err) {
      console.error(err)
      setError(err.message)
    }
  }, [scene, camera, frustumSize, trail, bg, updateMask])

  return (
    <>
      <div ref={containerRef} style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', zIndex: 1, background: '#888888' }} />
      
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
        {/* 3D text rendered via Three.js - hidden HTML text */}
        <h1 style={{
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
        
        <p style={{
          position: 'absolute',
          bottom: '25%',
          fontSize: 'clamp(0.8rem, 2vw, 1.1rem)',
          fontWeight: 400,
          letterSpacing: '0.6em',
          color: '#000000',
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
