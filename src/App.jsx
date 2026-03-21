import { useEffect, useRef, useState, useMemo } from 'react'
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js'
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js'
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js'
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

  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)')
  gradient.addColorStop(0.2, 'rgba(255, 255, 255, 0.9)')
  gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.4)')
  gradient.addColorStop(0.8, 'rgba(255, 255, 255, 0.1)')
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)')

  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)

  return new THREE.CanvasTexture(canvas)
}

// Create procedural environment texture for mirror reflections
function createEnvironmentTexture() {
  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')

  // Create a deep contrasty space-like background
  const gradient = ctx.createLinearGradient(0, 0, 0, size)
  gradient.addColorStop(0, '#020205')      // Darker sky
  gradient.addColorStop(0.49, '#101520')   // Near horizon
  gradient.addColorStop(0.5, '#ffffff')    // Sharp horizon white
  gradient.addColorStop(0.51, '#151520')   // Near ground
  gradient.addColorStop(1, '#000000')      // Dark ground

  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)

  // Add high-contrast "studio light" streaks for crisp reflections
  // Horizontal streaks represent overhead lights
  for (let i = 0; i < 8; i++) {
    const y = Math.random() * size * 0.4 // Mostly in the top half
    const h = Math.random() * 30 + 10
    const alpha = Math.random() * 0.7 + 0.3 // Brighter streaks
    ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`
    ctx.fillRect(0, y, size, h)
  }

  // A couple of very bright, thin vertical lines for highlights on curves
  for (let i = 0; i < 3; i++) {
    const x = Math.random() * size
    const w = Math.random() * 10 + 2
    const alpha = Math.random() * 0.5 + 0.3
    ctx.fillStyle = `rgba(220, 235, 255, ${alpha})`
    ctx.fillRect(x, 0, w, size)
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.mapping = THREE.EquirectangularReflectionMapping
  return texture
}

// ============================================
// MAIN APP COMPONENT
// ============================================
function App() {
  const containerRef = useRef(null)
  const textMeshRef = useRef(null) // kept for compatibility in some logic
  const letterMeshesRef = useRef([])
  const isExplodedRef = useRef(false)
  const isResettingRef = useRef(false)
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
    let isMounted = true
    const envMap = createEnvironmentTexture()
    let smoothedCursor = new THREE.Vector2(0, 0)
    let lastSmoothedCursor = new THREE.Vector2(0, 0)
    let velocity = 0
    let animationId
    let clock
    const raycaster = new THREE.Raycaster()
    const mouse = new THREE.Vector2()
    let isHovered = false
    const smoothstep = (edge0, edge1, x) => {
      const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)))
      return t * t * (3 - 2 * t)
    }
    const cursorDamping = Config.damping * 3.5 // SNR = Snappy Response!

    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
      renderer.setSize(window.innerWidth, window.innerHeight)
      renderer.setClearColor(0x000000, 1)
      renderer.toneMapping = THREE.ACESFilmicToneMapping // Cinematic contrast
      renderer.toneMappingExposure = 0.85 // Clamp peak brightness
      renderer.outputColorSpace = THREE.SRGBColorSpace
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

      // Create premium mirror chrome material
      const chromeMaterial = new THREE.MeshPhysicalMaterial({
        color: 0xbbbbbb,          // Deeper base to catch more environment detail
        metalness: 1.0,           // Maximum reflectivity
        roughness: 0.18,          // Softer, more balanced light spread
        envMap: envMap,
        envMapIntensity: 1.6,     // Soft, balanced reflections (prev: 3.2)
        clearcoat: 1.0,           // Perfectly smooth outer layer
        clearcoatRoughness: 0.1,  // Balanced glint softness
        reflectivity: 1.0,
        iridescence: 0.1,
        iridescenceIOR: 1.5,
        iridescenceThicknessRange: [100, 400],
        specularIntensity: 1.2,
        specularColor: 0xffffff,
        emissive: 0xbbddff,       // Faint cyan tint
        emissiveIntensity: 0,     
        side: THREE.DoubleSide
      })

      // Add dynamic lights with softened intensities for a balanced appearance
      const keyLight = new THREE.PointLight(0xffffff, 0.9, 40)
      keyLight.position.set(5, 5, 10)
      scene.add(keyLight)

      const fillLight = new THREE.PointLight(0xddeeff, 0.7, 30)
      fillLight.position.set(-5, 3, 10)
      scene.add(fillLight)

      const rimLight = new THREE.PointLight(0xffffff, 0.6, 25)
      rimLight.position.set(0, -3, 10)
      scene.add(rimLight)

      // Add ambient light for smooth base illumination
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.25)
      scene.add(ambientLight)

      // Temp objects to avoid per-frame allocations
      const tmpColor = new THREE.Color()
      const tmpTextColor = new THREE.Color()
      const tmpLightColor = new THREE.Color()
      const tmpLightColor2 = new THREE.Color()
      const tmpDeltaPos = new THREE.Vector2()

      // Load font and create individual 3D letters for physics
      const fontLoader = new FontLoader()

      fontLoader.load('https://threejs.org/examples/fonts/helvetiker_bold.typeface.json', (font) => {
        if (!isMounted) return

        const text = 'EMMJEYYYY'
        const chars = text.split('')
        const meshes = []

        // Settings to match original look
        const textOptions = {
          font: font,
          size: 1.8,
          height: 0.4,
          curveSegments: 64, // Smoother curves
          bevelEnabled: true,
          bevelThickness: 0.18, // Thicker bevel to catch more light
          bevelSize: 0.07,
          bevelOffset: 0,
          bevelSegments: 32 // Ultra-smooth bevels
        }

        const letterGap = Config.textSpacing || 0.1
        let totalWidth = 0
        const charData = []

        // Helper to define better collision shapes for each letter (composite spheres)
        const getColliders = (char, width, height) => {
          const colliders = []
          const r = width * 0.28 // sphere radius
          
          if (char === 'M' || char === 'E' || char === 'W') {
            // 3-point wide letters
            colliders.push({ offset: new THREE.Vector3(-width * 0.3, 0, 0), r })
            colliders.push({ offset: new THREE.Vector3(0, 0, 0), r })
            colliders.push({ offset: new THREE.Vector3(width * 0.3, 0, 0), r })
          } else if (char === 'Y') {
            // Y shape
            colliders.push({ offset: new THREE.Vector3(-width * 0.3, height * 0.3, 0), r })
            colliders.push({ offset: new THREE.Vector3(width * 0.3, height * 0.3, 0), r })
            colliders.push({ offset: new THREE.Vector3(0, -height * 0.2, 0), r })
          } else if (char === 'J') {
            // J shape
            colliders.push({ offset: new THREE.Vector3(width * 0.1, height * 0.2, 0), r })
            colliders.push({ offset: new THREE.Vector3(-width * 0.1, -height * 0.2, 0), r })
          } else {
            // Default 2 points (top/bottom)
            colliders.push({ offset: new THREE.Vector3(0, height * 0.25, 0), r })
            colliders.push({ offset: new THREE.Vector3(0, -height * 0.25, 0), r })
          }
          return colliders
        }

        // First pass: create geometries and measure widths
        chars.forEach((char) => {
          let charGeo = new TextGeometry(char, textOptions)
          charGeo = BufferGeometryUtils.mergeVertices(charGeo, 0.001)
          charGeo.computeVertexNormals()
          charGeo.computeBoundingBox()
          
          const width = charGeo.boundingBox.max.x - charGeo.boundingBox.min.x
          const height = charGeo.boundingBox.max.y - charGeo.boundingBox.min.y
          charData.push({ char, geo: charGeo, width, height })
          totalWidth += width + letterGap
        })
        totalWidth -= letterGap // remove last gap

        // Second pass: position and create meshes
        let currentX = -totalWidth / 2
        charData.forEach((data, i) => {
          const { char, geo, width, height } = data
          geo.center() // center for better rotation
          
          const mesh = new THREE.Mesh(geo, chromeMaterial)
          // Position based on accumulated width
          const posX = currentX + width / 2
          mesh.position.set(posX, 0, 1)
          currentX += width + letterGap
          
          scene.add(mesh)
          
          const colliders = getColliders(char, width, height)
          
          meshes.push({
            mesh,
            originalPos: mesh.position.clone(),
            originalRot: mesh.rotation.clone(),
            velocity: new THREE.Vector3(),
            angularVelocity: new THREE.Vector3(),
            colliders,
            width, height
          })
        })

        letterMeshesRef.current = meshes
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

      // Click to scatter / Double-click to reset
      const handleMouseDown = () => {
        if (!isExplodedRef.current && !isResettingRef.current && isHovered) {
          isExplodedRef.current = true
          letterMeshesRef.current.forEach(item => {
            item.velocity.set(
              (Math.random() - 0.5) * 15,
              (Math.random() - 0.5) * 15,
              (Math.random() - 0.5) * 10
            )
            item.angularVelocity.set(
              (Math.random() - 0.5) * 0.05,
              (Math.random() - 0.5) * 0.05,
              (Math.random() - 0.5) * 0.05
            )
          })
        }
      }

      const handleDoubleClick = () => {
        if (isExplodedRef.current) {
          isExplodedRef.current = false
          isResettingRef.current = true
        }
      }

      window.addEventListener('mousedown', handleMouseDown)
      window.addEventListener('dblclick', handleDoubleClick)

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

        const dt = clock.getDelta() // Raw delta time for physics
        const delta = Math.min(dt, 0.1) // Capped delta time for smoothing
        const time = clock.getElapsedTime()

        // Update raycaster for hover detection
        raycaster.setFromCamera(currentMouse, camera)
        const intersects = raycaster.intersectObjects(letterMeshesRef.current.map(l => l.mesh))
        isHovered = intersects.length > 0 && !isExplodedRef.current && !isResettingRef.current

        // Visual feedback for hover
        if (isHovered) {
          document.body.style.cursor = 'pointer'
          chromeMaterial.emissiveIntensity = THREE.MathUtils.lerp(chromeMaterial.emissiveIntensity, 0.15, 0.1) // Subdued glow
        } else {
          document.body.style.cursor = 'default'
          chromeMaterial.emissiveIntensity = THREE.MathUtils.lerp(chromeMaterial.emissiveIntensity, 0, 0.1)
        }

        lastSmoothedCursor.copy(smoothedCursor)
        const lerpFactor = 1 - Math.pow(1 - cursorDamping, dt * 60)
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
        const hw = frustumSize * aspect / 2
        const hh = frustumSize / 2

        const posAttr = trail.points.geometry.getAttribute('position')
        const sizeAttr = trail.points.geometry.getAttribute('size')
        const alphaAttr = trail.points.geometry.getAttribute('alpha')
        const colorAttr = trail.points.geometry.getAttribute('color')

        for (let i = 0; i < Config.trailLength; i++) {
          const h = history[i]
          const t = i / Config.trailLength

          posAttr.array[i * 3] = h.x * hw
          posAttr.array[i * 3 + 1] = h.y * hh
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

        // Update physics for each letter
        const repulsionRadius = 4.0
        const repulsionStrength = 0.5

        letterMeshesRef.current.forEach((item, index) => {
          const { mesh, velocity, angularVelocity, originalPos, originalRot, colliders, width, height } = item

          if (isExplodedRef.current) {
            // Apply velocity damping for a more lifelike "air resistance" feel
            velocity.multiplyScalar(0.99)
            angularVelocity.multiplyScalar(0.94)

            // Update position and rotation
            mesh.position.add(velocity.clone().multiplyScalar(dt))
            mesh.rotation.x += angularVelocity.x
            mesh.rotation.y += angularVelocity.y
            mesh.rotation.z += angularVelocity.z

            // Boundary checks with subtle torque
            const mainR = width * 0.5
            if (Math.abs(mesh.position.x) > hw - mainR) {
              velocity.x *= -0.75
              mesh.position.x = Math.sign(mesh.position.x) * (hw - mainR)
              // Induced spin from off-center boundary hit - ultra-subdued
              angularVelocity.y += (Math.random() - 0.5) * velocity.x * 0.02
              angularVelocity.z += (Math.random() - 0.5) * velocity.x * 0.01
            }
            if (Math.abs(mesh.position.y) > hh - mainR) {
              velocity.y *= -0.75
              mesh.position.y = Math.sign(mesh.position.y) * (hh - mainR)
              angularVelocity.x += (Math.random() - 0.5) * velocity.y * 0.02
              angularVelocity.z += (Math.random() - 0.5) * velocity.y * 0.01
            }
            if (Math.abs(mesh.position.z) > 4) {
              velocity.z *= -0.8
              mesh.position.z = Math.sign(mesh.position.z) * 4
            }

            // Mouse proximity repulsion
            tmpDeltaPos.set(mesh.position.x - currentMouse.x * hw, mesh.position.y - currentMouse.y * hh)
            const distToMouse = tmpDeltaPos.length()
            if (distToMouse < repulsionRadius) {
              const force = (1.0 - distToMouse / repulsionRadius) * repulsionStrength
              velocity.x += tmpDeltaPos.x * force
              velocity.y += tmpDeltaPos.y * force
            }

            // Advanced Multi-Sphere Collision resolution with Torque
            for (let j = index + 1; j < letterMeshesRef.current.length; j++) {
              const other = letterMeshesRef.current[j]
              
              // Check every collider pair between the two characters
              colliders.forEach(c1 => {
                const worldC1 = c1.offset.clone().applyQuaternion(mesh.quaternion).add(mesh.position)
                
                other.colliders.forEach(c2 => {
                  const worldC2 = c2.offset.clone().applyQuaternion(other.mesh.quaternion).add(other.mesh.position)
                  const diff = worldC1.clone().sub(worldC2)
                  const minDist = c1.r + c2.r
                  
                  if (diff.length() < minDist) {
                    const normal = diff.normalize()
                    const overlap = minDist - diff.length()
                    
                    // Resolve overlap - push meshes apart
                    const resolveVec = normal.clone().multiplyScalar(overlap * 0.5)
                    mesh.position.add(resolveVec)
                    other.mesh.position.sub(resolveVec)

                    // Transfer impulse based on the hit point
                    const impulse = normal.clone().multiplyScalar(velocity.clone().sub(other.velocity).length() * 0.35 + 0.05)
                    
                    // Linear velocity change
                    velocity.add(impulse)
                    other.velocity.sub(impulse)
                    
                    // Apply Torque (Angular Impulse) - ultra-subdued for a weighted feel
                    const torque1 = c1.offset.clone().cross(impulse).multiplyScalar(0.03)
                    const torque2 = c2.offset.clone().cross(impulse.clone().negate()).multiplyScalar(0.03)
                    
                    angularVelocity.add(torque1)
                    other.angularVelocity.add(torque2)
                  }
                })
              })
            }
          } else if (isResettingRef.current) {
            // Smoothly return to original layout
            mesh.position.lerp(originalPos, 0.15)
            mesh.rotation.x = THREE.MathUtils.lerp(mesh.rotation.x, originalRot.x, 0.15)
            mesh.rotation.y = THREE.MathUtils.lerp(mesh.rotation.y, originalRot.y, 0.15)
            mesh.rotation.z = THREE.MathUtils.lerp(mesh.rotation.z, originalRot.z, 0.15)
            velocity.set(0, 0, 0)
            angularVelocity.set(0, 0, 0)

            // Stop resetting once very close
            if (mesh.position.distanceTo(originalPos) < 0.001) {
              mesh.position.copy(originalPos)
              mesh.rotation.copy(originalRot)
              if (index === letterMeshesRef.current.length - 1) isResettingRef.current = false
            }
          } else {
            // Idle state - gentle hover or subtle rotation
            mesh.rotation.x = smoothedCursor.y * 0.15
            mesh.rotation.y = smoothedCursor.x * 0.15
          }
        })

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
        isMounted = false
        if (animationId) cancelAnimationFrame(animationId)
        letterMeshesRef.current.forEach(item => {
          if (item.mesh) {
            scene.remove(item.mesh)
            if (item.mesh.geometry) item.mesh.geometry.dispose()
            if (item.mesh.material) item.mesh.material.dispose()
          }
        })
        letterMeshesRef.current = []

        window.removeEventListener('mousedown', handleMouseDown)
        window.removeEventListener('dblclick', handleDoubleClick)

        envMap.dispose()

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
      <div ref={containerRef} style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', zIndex: 1, background: '#000000' }} />
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
          color: '#ffffff',
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
