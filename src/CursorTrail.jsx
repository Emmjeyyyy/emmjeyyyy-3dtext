import { useMemo } from 'react'
import * as THREE from 'three'
import { Config } from './config'
import { particleVertexShader, particleFragmentShader } from './shaders'

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

export function useCursorTrail(renderer) {
  const { geometry, material, points } = useMemo(() => {
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
    
    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geom.setAttribute('size', new THREE.BufferAttribute(sizes, 1))
    geom.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1))
    
    const texture = createCircleTexture()
    
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uPixelRatio: { value: renderer?.getPixelRatio() || 1 },
        uPointSize: { value: Config.particleSize * 50 },
        uTexture: { value: texture }
      },
      vertexShader: particleVertexShader,
      fragmentShader: particleFragmentShader,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
    
    const pts = new THREE.Points(geom, mat)
    
    return { geometry: geom, material: mat, points: pts, history }
  }, [renderer])
  
  return { geometry, material, points, history }
}

export function updateCursorTrail(points, history, smoothedCursor, velocity, time, frustumSize, aspect) {
  const halfWidth = frustumSize * aspect / 2
  const halfHeight = frustumSize / 2
  
  // Update history
  for (let i = history.length - 1; i > 0; i--) {
    history[i] = { ...history[i - 1] }
  }
  history[0] = { x: smoothedCursor.x, y: smoothedCursor.y, velocity }
  
  const posAttr = points.geometry.getAttribute('position')
  const sizeAttr = points.geometry.getAttribute('size')
  const alphaAttr = points.geometry.getAttribute('alpha')
  const colorAttr = points.geometry.getAttribute('color')
  
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
}
