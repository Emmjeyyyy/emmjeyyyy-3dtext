import { useMemo } from 'react'
import * as THREE from 'three'
import { Config } from './config'
import { backgroundVertexShader, backgroundFragmentShader } from './shaders'

export function useBackgroundDistortion(frustumSize, aspect) {
  const { geometry, material, mesh } = useMemo(() => {
    const geom = new THREE.PlaneGeometry(frustumSize * aspect * 2, frustumSize * 2)
    
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uMouse: { value: new THREE.Vector2(0, 0) },
        uVelocity: { value: 0 },
        uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
        uFrustumSize: { value: frustumSize },
        uAspect: { value: aspect }
      },
      vertexShader: backgroundVertexShader,
      fragmentShader: backgroundFragmentShader,
      transparent: false
    })
    
    const m = new THREE.Mesh(geom, mat)
    m.position.z = -5
    
    return { geometry: geom, material: mat, mesh: m }
  }, [frustumSize, aspect])
  
  return { geometry, material, mesh }
}

export function updateBackgroundDistortion(material, time, smoothedCursor, velocity) {
  material.uniforms.uTime.value = time
  material.uniforms.uMouse.value.copy(smoothedCursor)
  material.uniforms.uVelocity.value = velocity
}

export function resizeBackground(geometry, material, frustumSize, newAspect, width, height) {
  geometry.dispose()
  geometry.dispose()
  return new THREE.PlaneGeometry(frustumSize * newAspect * 2, frustumSize * 2)
}
