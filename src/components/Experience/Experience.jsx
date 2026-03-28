import { useEffect, useRef, useState, useMemo } from 'react'
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js'
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js'
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { Config } from '../../config'
import { particleVertexShader, particleFragmentShader, backgroundVertexShader, backgroundFragmentShader } from '../../shaders'
import { createCircleTexture, createEnvironmentTexture } from '../../utils/textures'

const Experience = ({ setError }) => {
  const containerRef = useRef(null)
  const letterMeshesRef = useRef([])
  const isExplodedRef = useRef(false)
  const isResettingRef = useRef(false)
  const isMouseDownRef = useRef(false)
  const isAttractingRef = useRef(false)

  // Initialize Three.js objects
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
    trailPoints.position.z = 6
    if (Config.enableTrail) {
      s.add(trailPoints)
    }

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
    const currentMouse = new THREE.Vector2()
    const tmpCursorVelocity = new THREE.Vector2()
    const tmpRelativePos = new THREE.Vector2()
    const tmpColor = new THREE.Color()
    const tmpColliderA = new THREE.Vector2()
    const tmpColliderB = new THREE.Vector2()
    const tmpNormal2D = new THREE.Vector2()
    let isHovered = false
    const smoothstep = (edge0, edge1, x) => {
      const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)))
      return t * t * (3 - 2 * t)
    }
    const cursorDamping = Config.damping * 3.5
    let hw = 0, hh = 0

    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
      renderer.setSize(window.innerWidth, window.innerHeight)
      renderer.setClearColor(0x000000, 1)
      renderer.toneMapping = THREE.ACESFilmicToneMapping
      renderer.toneMappingExposure = 0.85
      renderer.outputColorSpace = THREE.SRGBColorSpace
      containerRef.current.appendChild(renderer.domElement)

      trail.material.uniforms.uPixelRatio.value = renderer.getPixelRatio()

      composer = new EffectComposer(renderer)
      composer.addPass(new RenderPass(scene, camera))
      const bloomScale = 0.5
      const bloomPass = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth * bloomScale, window.innerHeight * bloomScale),
        Config.bloomStrength,
        Config.bloomRadius,
        Config.bloomThreshold
      )
      composer.addPass(bloomPass)

      const chromeMaterial = new THREE.MeshPhysicalMaterial({
        color: 0xbbbbbb,
        metalness: 1.0,
        roughness: 0.18,
        envMap: envMap,
        envMapIntensity: 1.6,
        clearcoat: 1.0,
        clearcoatRoughness: 0.1,
        reflectivity: 1.0,
        specularIntensity: 1.2,
        specularColor: 0xffffff,
        emissive: 0xffffff,
        emissiveIntensity: 0,
        side: THREE.DoubleSide
      })

      // Add ambient light
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.25)
      scene.add(ambientLight)

      const fontLoader = new FontLoader()
      fontLoader.load('https://threejs.org/examples/fonts/helvetiker_bold.typeface.json', (font) => {
        if (!isMounted) return

        const text = 'EMMJEYYYY'
        const chars = text.split('')
        const meshes = []
        const textOptions = {
          font: font,
          size: 1.8,
          height: 0.4,
          curveSegments: 64,
          bevelEnabled: true,
          bevelThickness: 0.18,
          bevelSize: 0.07,
          bevelSegments: 32
        }

        const letterGap = Config.textSpacing || 0.1
        let totalWidth = 0
        const charData = []

        const getColliders = (char, width, height) => {
          const colliders = []
          const r = width * 0.28
          if (char === 'M' || char === 'E' || char === 'W') {
            colliders.push({ offset: new THREE.Vector3(-width * 0.3, 0, 0), r })
            colliders.push({ offset: new THREE.Vector3(0, 0, 0), r })
            colliders.push({ offset: new THREE.Vector3(width * 0.3, 0, 0), r })
          } else if (char === 'Y') {
            colliders.push({ offset: new THREE.Vector3(-width * 0.3, height * 0.3, 0), r })
            colliders.push({ offset: new THREE.Vector3(width * 0.3, height * 0.3, 0), r })
            colliders.push({ offset: new THREE.Vector3(0, -height * 0.2, 0), r })
          } else if (char === 'J') {
            colliders.push({ offset: new THREE.Vector3(width * 0.1, height * 0.2, 0), r })
            colliders.push({ offset: new THREE.Vector3(-width * 0.1, -height * 0.2, 0), r })
          } else {
            colliders.push({ offset: new THREE.Vector3(0, height * 0.25, 0), r })
            colliders.push({ offset: new THREE.Vector3(0, -height * 0.25, 0), r })
          }
          return colliders
        }

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
        totalWidth -= letterGap

        let currentX = -totalWidth / 2
        charData.forEach((data) => {
          const { char, geo, width, height } = data
          geo.center()
          const mesh = new THREE.Mesh(geo, chromeMaterial)
          const posX = currentX + width / 2
          mesh.position.set(posX, 0, 1)
          currentX += width + letterGap
          scene.add(mesh)
          const colliders = getColliders(char, width, height)
          const boundRadius = colliders.reduce((maxR, c) => Math.max(maxR, c.offset.length() + c.r), Math.max(width, height) * 0.45)
          meshes.push({
            mesh,
            originalPos: mesh.position.clone(),
            originalRot: mesh.rotation.clone(),
            velocity: new THREE.Vector3(),
            angularVelocity: new THREE.Vector3(),
            colliders,
            boundRadius,
            width, height
          })
        })
        letterMeshesRef.current = meshes
      })

      clock = new THREE.Clock()

      const updateMouse = (x, y) => {
        currentMouse.x = (x / window.innerWidth) * 2 - 1
        currentMouse.y = -(y / window.innerHeight) * 2 + 1
      }

      const handleMouseMove = e => updateMouse(e.clientX, e.clientY)
      const handleTouchMove = e => e.touches[0] && updateMouse(e.touches[0].clientX, e.touches[0].clientY)

      const handleContextMenu = e => e.preventDefault()
      const fixedZ = 1
      const physicsSubsteps = 3
      const collisionIterations = 4

      const getColliderWorld2D = (item, collider, out) => {
        const angle = item.mesh.rotation.z
        const cos = Math.cos(angle)
        const sin = Math.sin(angle)
        const localX = collider.offset.x
        const localY = collider.offset.y
        out.set(
          item.mesh.position.x + localX * cos - localY * sin,
          item.mesh.position.y + localX * sin + localY * cos
        )
      }

      const clampToBounds = (item) => {
        const { mesh, velocity, angularVelocity, boundRadius } = item
        if (Math.abs(mesh.position.x) > hw - boundRadius) {
          mesh.position.x = Math.sign(mesh.position.x) * (hw - boundRadius)
          velocity.x *= -0.75
          angularVelocity.z += (Math.random() - 0.5) * 0.02
        }
        if (Math.abs(mesh.position.y) > hh - boundRadius) {
          mesh.position.y = Math.sign(mesh.position.y) * (hh - boundRadius)
          velocity.y *= -0.75
          angularVelocity.z += (Math.random() - 0.5) * 0.02
        }
        mesh.position.z = fixedZ
        velocity.z = 0
      }

      const resolveCharacterCollisions = () => {
        const restitution = 0.12
        const friction = 0.08
        const minDistEps = 1e-6
        const slop = 0.001
        const correctionPercent = 0.95
        const pairCount = letterMeshesRef.current.length

        for (let iteration = 0; iteration < collisionIterations; iteration++) {
          for (let i = 0; i < pairCount - 1; i++) {
            const itemA = letterMeshesRef.current[i]
            for (let j = i + 1; j < pairCount; j++) {
              const itemB = letterMeshesRef.current[j]

              itemA.colliders.forEach((c1) => {
                getColliderWorld2D(itemA, c1, tmpColliderA)
                itemB.colliders.forEach((c2) => {
                  getColliderWorld2D(itemB, c2, tmpColliderB)

                  const dx = tmpColliderA.x - tmpColliderB.x
                  const dy = tmpColliderA.y - tmpColliderB.y
                  const minDist = c1.r + c2.r
                  const distSq = dx * dx + dy * dy
                  if (distSq >= minDist * minDist) return

                  let dist = Math.sqrt(distSq)
                  if (dist < minDistEps) {
                    tmpNormal2D.set(itemA.mesh.position.x - itemB.mesh.position.x, itemA.mesh.position.y - itemB.mesh.position.y)
                    if (tmpNormal2D.lengthSq() < minDistEps) tmpNormal2D.set(1, 0)
                    tmpNormal2D.normalize()
                    dist = 0
                  } else {
                    tmpNormal2D.set(dx / dist, dy / dist)
                  }

                  const overlap = minDist - dist
                  const correctedOverlap = Math.max(0, overlap - slop) * correctionPercent
                  const correctionX = tmpNormal2D.x * correctedOverlap * 0.5
                  const correctionY = tmpNormal2D.y * correctedOverlap * 0.5
                  itemA.mesh.position.x += correctionX
                  itemA.mesh.position.y += correctionY
                  itemB.mesh.position.x -= correctionX
                  itemB.mesh.position.y -= correctionY

                  const relVx = itemA.velocity.x - itemB.velocity.x
                  const relVy = itemA.velocity.y - itemB.velocity.y
                  const velAlongNormal = relVx * tmpNormal2D.x + relVy * tmpNormal2D.y
                  if (velAlongNormal > 0) return

                  const invMassSum = 2
                  const impulseMag = (-(1 + restitution) * velAlongNormal) / invMassSum
                  const impulseX = tmpNormal2D.x * impulseMag
                  const impulseY = tmpNormal2D.y * impulseMag

                  itemA.velocity.x += impulseX
                  itemA.velocity.y += impulseY
                  itemB.velocity.x -= impulseX
                  itemB.velocity.y -= impulseY

                  const tangentX = -tmpNormal2D.y
                  const tangentY = tmpNormal2D.x
                  const relTanVel = relVx * tangentX + relVy * tangentY
                  const frictionImpulseMag = (-relTanVel * friction) / invMassSum
                  const frictionX = tangentX * frictionImpulseMag
                  const frictionY = tangentY * frictionImpulseMag
                  itemA.velocity.x += frictionX
                  itemA.velocity.y += frictionY
                  itemB.velocity.x -= frictionX
                  itemB.velocity.y -= frictionY

                  const armAx = tmpColliderA.x - itemA.mesh.position.x
                  const armAy = tmpColliderA.y - itemA.mesh.position.y
                  const armBx = tmpColliderB.x - itemB.mesh.position.x
                  const armBy = tmpColliderB.y - itemB.mesh.position.y
                  const torqueA = armAx * impulseY - armAy * impulseX
                  const torqueB = armBx * -impulseY - armBy * -impulseX
                  itemA.angularVelocity.z += torqueA * 0.004
                  itemB.angularVelocity.z += torqueB * 0.004
                })
              })
            }
          }
        }
      }

      const handleMouseDown = (e) => {
        if (e.button !== 0) return
        
        // Initial scatter trigger: must click on a letter
        if (!isExplodedRef.current && !isResettingRef.current) {
          if (!isHovered) return 
          isMouseDownRef.current = true
          isExplodedRef.current = true
          letterMeshesRef.current.forEach(item => {
            item.velocity.set((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, 0)
            item.angularVelocity.set((Math.random() - 0.5) * 0.05, (Math.random() - 0.5) * 0.05, (Math.random() - 0.5) * 0.05)
          })
          isAttractingRef.current = true
        } else if (isExplodedRef.current) {
          // Attraction phase: allow global clicks to trigger the black hole
          isMouseDownRef.current = true
          isAttractingRef.current = true
        }
      }

      const handleMouseUp = (e) => {
        if (e.button !== 0) return
        if (isAttractingRef.current) {
          const throwScale = 45
          const throwVelocity = new THREE.Vector3(tmpCursorVelocity.x * hw * throwScale, tmpCursorVelocity.y * hh * throwScale, 0)
          letterMeshesRef.current.forEach(item => {
            item.velocity.copy(throwVelocity)
            item.velocity.x += (Math.random() - 0.5) * 8
            item.velocity.y += (Math.random() - 0.5) * 8
            item.angularVelocity.add(new THREE.Vector3((Math.random() - 0.5) * 0.1, (Math.random() - 0.5) * 0.1, (Math.random() - 0.5) * 0.1))
          })
          isAttractingRef.current = false
        }
        isMouseDownRef.current = false
      }

      const handleDoubleClick = () => {
        if (isExplodedRef.current) {
          isExplodedRef.current = false
          isResettingRef.current = true
        }
      }

      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('touchmove', handleTouchMove)
      window.addEventListener('touchstart', handleTouchMove)
      window.addEventListener('mousedown', handleMouseDown)
      window.addEventListener('mouseup', handleMouseUp)
      window.addEventListener('dblclick', handleDoubleClick)
      window.addEventListener('contextmenu', handleContextMenu)

      const onResize = () => {
        const w = window.innerWidth, h = window.innerHeight, a = w / h
        hw = frustumSize * a / 2
        hh = frustumSize / 2
        camera.left = -hw; camera.right = hw; camera.top = hh; camera.bottom = -hh
        camera.updateProjectionMatrix()
        renderer.setSize(w, h)
        composer.setSize(w, h)
        bg.geometry.dispose()
        bg.geometry = new THREE.PlaneGeometry(hw * 4, hh * 4)
        bg.mesh.geometry = bg.geometry
        bg.material.uniforms.uResolution.value.set(w, h)
        bg.material.uniforms.uAspect.value = a
        bloomPass.resolution.set(w * bloomScale, h * bloomScale)
      }
      onResize()
      window.addEventListener('resize', onResize)

      const animate = () => {
        animationId = requestAnimationFrame(animate)
        const dt = clock.getDelta()
        const delta = Math.min(dt, 0.1)
        const time = clock.getElapsedTime()

        raycaster.setFromCamera(currentMouse, camera)
        const intersects = raycaster.intersectObjects(letterMeshesRef.current.map(l => l.mesh))
        isHovered = intersects.length > 0

        if (isAttractingRef.current) {
          document.body.style.cursor = 'crosshair'
          chromeMaterial.emissiveIntensity = THREE.MathUtils.lerp(chromeMaterial.emissiveIntensity, 0.8, 0.1)
        } else if (isHovered) {
          document.body.style.cursor = 'pointer'
          chromeMaterial.emissiveIntensity = THREE.MathUtils.lerp(chromeMaterial.emissiveIntensity, 0.15, 0.1)
        } else {
          document.body.style.cursor = 'default'
          chromeMaterial.emissiveIntensity = THREE.MathUtils.lerp(chromeMaterial.emissiveIntensity, 0, 0.1)
        }

        lastSmoothedCursor.copy(smoothedCursor)
        const lerpFactor = 1 - Math.pow(1 - cursorDamping, dt * 60)
        smoothedCursor.lerp(currentMouse, lerpFactor)
        tmpCursorVelocity.copy(smoothedCursor).sub(lastSmoothedCursor)
        velocity = Math.min(tmpCursorVelocity.length() * Config.velocityMultiplier * 60, Config.maxVelocity)

        const history = trail.history
        for (let i = history.length - 1; i > 0; i--) {
          history[i].x = history[i - 1].x; history[i].y = history[i - 1].y; history[i].velocity = history[i - 1].velocity
        }
        history[0].x = smoothedCursor.x; history[0].y = smoothedCursor.y; history[0].velocity = velocity

        if (Config.enableTrail) {
          const posAttr = trail.points.geometry.getAttribute('position')
          const sizeAttr = trail.points.geometry.getAttribute('size')
          const alphaAttr = trail.points.geometry.getAttribute('alpha')
          const colorAttr = trail.points.geometry.getAttribute('color')
          for (let i = 0; i < Config.trailLength; i++) {
            const h = history[i]
            const t = i / Config.trailLength
            posAttr.array[i * 3] = h.x * hw; posAttr.array[i * 3 + 1] = h.y * hh; posAttr.array[i * 3 + 2] = 2
            const baseSize = Config.particleSize * (1 - t * 0.85)
            const velocityBoost = 1 + h.velocity * 0.12
            const ripple = 1 + Math.sin(time * 8 + t * 10) * 0.3 * (1 - t)
            sizeAttr.array[i] = baseSize * velocityBoost * ripple
            const ageFade = Math.pow(1 - t, 1.2)
            const velocityFade = Math.pow(smoothstep(1.2, 2.5, h.velocity), 0.85)
            alphaAttr.array[i] = ageFade * velocityFade * Config.particleOpacity * 1.2
            const hue = (Config.baseHue + t * 25 + time * 8) % 360
            tmpColor.setHSL(hue / 360, Config.saturation, Config.lightness)
            colorAttr.array[i * 3] = tmpColor.r; colorAttr.array[i * 3 + 1] = tmpColor.g; colorAttr.array[i * 3 + 2] = tmpColor.b
          }
          posAttr.needsUpdate = sizeAttr.needsUpdate = alphaAttr.needsUpdate = colorAttr.needsUpdate = true
        }

        bg.material.uniforms.uTime.value = time
        bg.material.uniforms.uMouse.value.copy(smoothedCursor)
        bg.material.uniforms.uVelocity.value = velocity

        const repulsionRadius = 4.0; const repulsionStrength = 0.5
        letterMeshesRef.current.forEach((item, index) => {
          const { mesh, velocity, angularVelocity, originalPos, originalRot } = item
          if (isExplodedRef.current) {
            mesh.position.z = fixedZ
            velocity.z = 0
          } else if (isResettingRef.current) {
            mesh.position.lerp(originalPos, 0.15)
            mesh.position.z = fixedZ
            mesh.rotation.x = THREE.MathUtils.lerp(mesh.rotation.x, originalRot.x, 0.15)
            mesh.rotation.y = THREE.MathUtils.lerp(mesh.rotation.y, originalRot.y, 0.15)
            mesh.rotation.z = THREE.MathUtils.lerp(mesh.rotation.z, originalRot.z, 0.15)
            velocity.set(0, 0, 0); angularVelocity.set(0, 0, 0)
            if (mesh.position.distanceTo(originalPos) < 0.001) {
              mesh.position.copy(originalPos); mesh.rotation.copy(originalRot)
              if (index === letterMeshesRef.current.length - 1) isResettingRef.current = false
            }
          } else {
            mesh.rotation.x = smoothedCursor.y * 0.15; mesh.rotation.y = smoothedCursor.x * 0.15
          }
        })

        if (isExplodedRef.current) {
          const mouseWorldX = currentMouse.x * hw
          const mouseWorldY = currentMouse.y * hh
          const substepDt = delta / physicsSubsteps

          for (let step = 0; step < physicsSubsteps; step++) {
            letterMeshesRef.current.forEach((item) => {
              const { mesh, velocity, angularVelocity } = item
              velocity.multiplyScalar(0.992)
              angularVelocity.multiplyScalar(0.94)

              tmpRelativePos.set(mesh.position.x - mouseWorldX, mesh.position.y - mouseWorldY)
              const distToMouse = tmpRelativePos.length()
              if (isAttractingRef.current) {
                const attractionStrength = 1.8
                const safeDist = Math.max(distToMouse, 0.001)
                const nx = tmpRelativePos.x / safeDist
                const ny = tmpRelativePos.y / safeDist
                velocity.x += -nx * attractionStrength
                velocity.y += -ny * attractionStrength
                velocity.x += ny * 0.6
                velocity.y += -nx * 0.6
                velocity.multiplyScalar(0.93)
                angularVelocity.multiplyScalar(0.9)
              } else if (distToMouse < repulsionRadius && distToMouse > 0.001) {
                const force = (1.0 - distToMouse / repulsionRadius) * repulsionStrength
                velocity.x += (tmpRelativePos.x / distToMouse) * force
                velocity.y += (tmpRelativePos.y / distToMouse) * force
              }

              mesh.position.x += velocity.x * substepDt
              mesh.position.y += velocity.y * substepDt
              mesh.position.z = fixedZ
              mesh.rotation.x += angularVelocity.x
              mesh.rotation.y += angularVelocity.y
              mesh.rotation.z += angularVelocity.z
              clampToBounds(item)
            })

            resolveCharacterCollisions()
            letterMeshesRef.current.forEach(clampToBounds)
          }
        }
        composer.render()
      }
      animate()
      return () => {
        isMounted = false; if (animationId) cancelAnimationFrame(animationId)
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('touchmove', handleTouchMove)
        window.removeEventListener('touchstart', handleTouchMove)
        window.removeEventListener('mousedown', handleMouseDown)
        window.removeEventListener('mouseup', handleMouseUp)
        window.removeEventListener('dblclick', handleDoubleClick)
        window.removeEventListener('contextmenu', handleContextMenu)
        window.removeEventListener('resize', onResize)
        envMap.dispose(); renderer.dispose(); composer.dispose()
        if (containerRef.current && renderer.domElement) containerRef.current.removeChild(renderer.domElement)
      }
    } catch (err) {
      console.error(err); setError(err.message)
    }
  }, [scene, camera, frustumSize, trail, bg, setError])

  return <div ref={containerRef} style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', zIndex: 1, background: '#000000' }} />
}

export default Experience
