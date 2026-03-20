import { useEffect, useRef, useState, useMemo } from 'react'
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js'
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js'
import { Config } from './config'
import { particleVertexShader, particleFragmentShader } from './shaders'
import { backgroundVertexShader, backgroundFragmentShader } from './shaders'
import FluidCursor from './components/FluidCursor'

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

  useEffect(() => {
    let renderer, composer
    let smoothedCursor = new THREE.Vector2(0, 0)
    let lastSmoothedCursor = new THREE.Vector2(0, 0)
    let velocity = 0
    let animationId
    let clock
    const smoothstep = (edge0, edge1, x) => {
      const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)))
      return t * t * (3 - 2 * t)
    }
    const cursorDamping = Math.min(0.25, Config.damping * 2.0)

    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
      renderer.setSize(window.innerWidth, window.innerHeight)
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
      renderer.setClearColor(0x888888, 1)
      containerRef.current.appendChild(renderer.domElement)

      trail.material.uniforms.uPixelRatio.value = renderer.getPixelRatio()

      composer = new EffectComposer(renderer)
      composer.addPass(new RenderPass(scene, camera))
      const bloomScale = 0.5 // lower internal bloom buffer cost
      const bloomPass = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth * bloomScale, window.innerHeight * bloomScale),
        Config.bloomStrength,
        Config.bloomRadius,
        Config.bloomThreshold
      )
      composer.addPass(bloomPass)

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
      let textMesh = null

      // Temp objects to avoid per-frame allocations
      const tmpColor = new THREE.Color()
      const tmpTextColor = new THREE.Color()
      const tmpLightColor = new THREE.Color()
      const tmpLightColor2 = new THREE.Color()
      const tmpDeltaPos = new THREE.Vector2()

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
        
        textMesh = new THREE.Mesh(textGeo, iridescentMaterial)
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
        bg.mesh.geometry = bg.geometry
        bg.material.uniforms.uResolution.value.set(w, h)
        bg.material.uniforms.uAspect.value = a

        bloomPass.resolution.set(w * bloomScale, h * bloomScale)
      }
      window.addEventListener('resize', onResize)

      // Animation loop
      const animate = () => {
        animationId = requestAnimationFrame(animate)
        
        const delta = Math.min(clock.getDelta(), 0.1)
        const time = clock.getElapsedTime()
        
        lastSmoothedCursor.copy(smoothedCursor)
        const lerpFactor = 1 - Math.pow(1 - cursorDamping, delta * 60)
        smoothedCursor.lerp(currentMouse, lerpFactor)
        
        tmpDeltaPos.copy(smoothedCursor).sub(lastSmoothedCursor)
        velocity = Math.min(tmpDeltaPos.length() * Config.velocityMultiplier * 60, Config.maxVelocity)
        
        // Update trail history
        const history = trail.history
        for (let i = history.length - 1; i > 0; i--) {
          // Mutate existing objects to avoid GC churn.
          history[i].x = history[i - 1].x
          history[i].y = history[i - 1].y
          history[i].velocity = history[i - 1].velocity
        }
        // Use the responsive smoothed cursor for the head to reduce micro-jitter
        // while staying aligned to the fluid effect.
        history[0].x = smoothedCursor.x
        history[0].y = smoothedCursor.y
        history[0].velocity = velocity
        
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
          const velocityThreshold = 1.2
          // Smooth transition to avoid visible “on/off” popping (reads as jitter).
          const velocityFade = Math.pow(smoothstep(velocityThreshold, velocityThreshold + 1.3, h.velocity), 0.85)
          alphaAttr.array[i] = ageFade * velocityFade * Config.particleOpacity * 1.2  // Slightly higher for glow
          
          const hue = (Config.baseHue + t * 25 + time * 8) % 360
          tmpColor.setHSL(hue / 360, Config.saturation, Config.lightness)
          colorAttr.array[i * 3] = tmpColor.r
          colorAttr.array[i * 3 + 1] = tmpColor.g
          colorAttr.array[i * 3 + 2] = tmpColor.b
        }
        
        posAttr.needsUpdate = true
        sizeAttr.needsUpdate = true
        alphaAttr.needsUpdate = true
        colorAttr.needsUpdate = true
        
        // Update background
        bg.material.uniforms.uTime.value = time
        bg.material.uniforms.uMouse.value.copy(smoothedCursor)
        bg.material.uniforms.uVelocity.value = velocity

        // Update 3D text - subtle rotation based on mouse position
        if (textMesh) {
          textMesh.rotation.x = smoothedCursor.y * 0.15
          textMesh.rotation.y = smoothedCursor.x * 0.15

          // Dynamic color matching trail
          const trailHue = (Config.baseHue + time * 8) % 360
          tmpTextColor.setHSL(trailHue / 360, 0.8, 0.6)
          textMesh.material.emissive.copy(tmpTextColor).multiplyScalar(0.015 + velocity * 0.008)
          textMesh.material.sheenColor.copy(tmpTextColor)
        }

        // Update dynamic circular spot lights with color matching trail (dynamic hue)
        // Calculate distance from center (where text is)
        const distFromCenter = Math.sqrt(smoothedCursor.x * smoothedCursor.x + smoothedCursor.y * smoothedCursor.y)
        const proximityFactor = Math.max(0, 1 - distFromCenter * 0.5)
        const trailHue = (Config.baseHue + time * 8) % 360
        tmpLightColor.setHSL(trailHue / 360, 0.8, 0.7)

        keyLight.position.x = smoothedCursor.x * 8 + 5
        keyLight.position.y = smoothedCursor.y * 5 + 5
        keyLight.intensity = 0.3 + proximityFactor * 0.3
        keyLight.color.copy(tmpLightColor)

        fillLight.position.x = smoothedCursor.x * 8 - 5
        fillLight.position.y = smoothedCursor.y * 5 + 3
        fillLight.intensity = 0.2 + proximityFactor * 0.2
        tmpLightColor2.copy(tmpLightColor).offsetHSL(0, -0.1, -0.1)
        fillLight.color.copy(tmpLightColor2)

        rimLight.position.x = smoothedCursor.x * 8
        rimLight.position.y = smoothedCursor.y * 5 - 3
        rimLight.intensity = 0.25 + proximityFactor * 0.25
        tmpLightColor2.copy(tmpLightColor).offsetHSL(0.02, 0.1, 0.1)
        rimLight.color.copy(tmpLightColor2)
        
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
  }, [scene, camera, frustumSize, trail, bg])

  return (
    <>
      <div ref={containerRef} style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', zIndex: 1, background: '#888888' }} />
      <FluidCursor />

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
