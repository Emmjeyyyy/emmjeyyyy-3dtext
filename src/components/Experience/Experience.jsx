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

      const updateMouse = (x, y) => {
        currentMouse.x = (x / window.innerWidth) * 2 - 1
        currentMouse.y = -(y / window.innerHeight) * 2 + 1
      }

      const handleMouseMove = e => updateMouse(e.clientX, e.clientY)
      const handleTouchMove = e => e.touches[0] && updateMouse(e.touches[0].clientX, e.touches[0].clientY)

      const handleContextMenu = e => e.preventDefault()

      const handleMouseDown = (e) => {
        if (e.button !== 0) return
        isMouseDownRef.current = true
        if (!isExplodedRef.current && !isResettingRef.current) {
          isExplodedRef.current = true
          letterMeshesRef.current.forEach(item => {
            item.velocity.set((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 10)
            item.angularVelocity.set((Math.random() - 0.5) * 0.05, (Math.random() - 0.5) * 0.05, (Math.random() - 0.5) * 0.05)
          })
        }
        if (isExplodedRef.current) isAttractingRef.current = true
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
            item.velocity.z += (Math.random() - 0.5) * 6
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
        isHovered = intersects.length > 0 && !isExplodedRef.current && !isResettingRef.current

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
          const { mesh, velocity, angularVelocity, originalPos, originalRot, colliders, width, height } = item
          if (isExplodedRef.current) {
            velocity.multiplyScalar(0.99); angularVelocity.multiplyScalar(0.94)
            mesh.position.add(velocity.clone().multiplyScalar(dt))
            mesh.rotation.x += angularVelocity.x; mesh.rotation.y += angularVelocity.y; mesh.rotation.z += angularVelocity.z
            const mainR = width * 0.5
            if (Math.abs(mesh.position.x) > hw - mainR) {
              velocity.x *= -0.75; mesh.position.x = Math.sign(mesh.position.x) * (hw - mainR)
              angularVelocity.y += (Math.random() - 0.5) * velocity.x * 0.02; angularVelocity.z += (Math.random() - 0.5) * velocity.x * 0.01
            }
            if (Math.abs(mesh.position.y) > hh - mainR) {
              velocity.y *= -0.75; mesh.position.y = Math.sign(mesh.position.y) * (hh - mainR)
              angularVelocity.x += (Math.random() - 0.5) * velocity.y * 0.02; angularVelocity.z += (Math.random() - 0.5) * velocity.y * 0.01
            }
            if (Math.abs(mesh.position.z) > 4) { velocity.z *= -0.8; mesh.position.z = Math.sign(mesh.position.z) * 4 }
            const mouseWorld = new THREE.Vector2(currentMouse.x * hw, currentMouse.y * hh)
            tmpRelativePos.set(mesh.position.x - mouseWorld.x, mesh.position.y - mouseWorld.y)
            const distToMouse = tmpRelativePos.length()
            if (isAttractingRef.current) {
              const attractionStrength = 1.8
              const pull = tmpRelativePos.clone().normalize().multiplyScalar(-attractionStrength)
              velocity.add(new THREE.Vector3(pull.x, pull.y, 0))
              const swirlStrength = 0.6; const swirl = new THREE.Vector3(-pull.y, pull.x, 0).multiplyScalar(swirlStrength)
              velocity.add(swirl); velocity.multiplyScalar(0.92); angularVelocity.multiplyScalar(0.88)
            } else if (distToMouse < repulsionRadius) {
              const force = (1.0 - distToMouse / repulsionRadius) * repulsionStrength
              velocity.x += tmpRelativePos.x * force; velocity.y += tmpRelativePos.y * force
            }
            for (let j = index + 1; j < letterMeshesRef.current.length; j++) {
              const other = letterMeshesRef.current[j]
              colliders.forEach(c1 => {
                const worldC1 = c1.offset.clone().applyQuaternion(mesh.quaternion).add(mesh.position)
                other.colliders.forEach(c2 => {
                  const worldC2 = c2.offset.clone().applyQuaternion(other.mesh.quaternion).add(other.mesh.position)
                  const diff = worldC1.clone().sub(worldC2); const minDist = c1.r + c2.r
                  if (diff.length() < minDist) {
                    const normal = diff.normalize(); const overlap = minDist - diff.length()
                    const resolveVec = normal.clone().multiplyScalar(overlap * 0.5)
                    mesh.position.add(resolveVec); other.mesh.position.sub(resolveVec)
                    const impulse = normal.clone().multiplyScalar(velocity.clone().sub(other.velocity).length() * 0.35 + 0.05)
                    velocity.add(impulse); other.velocity.sub(impulse)
                    const torque1 = c1.offset.clone().cross(impulse).multiplyScalar(0.03)
                    const torque2 = c2.offset.clone().cross(impulse.clone().negate()).multiplyScalar(0.03)
                    angularVelocity.add(torque1); other.angularVelocity.add(torque2)
                  }
                })
              })
            }
          } else if (isResettingRef.current) {
            mesh.position.lerp(originalPos, 0.15)
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
