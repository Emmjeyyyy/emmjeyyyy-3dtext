// ============================================
// SHADERS
// ============================================

export const particleVertexShader = `
  precision highp float;
  
  attribute float size;
  attribute float alpha;
  attribute vec3 color;
  
  varying vec3 vColor;
  varying float vAlpha;
  
  uniform float uPixelRatio;
  uniform float uPointSize;
  
  void main() {
    vColor = color;
    vAlpha = alpha;
    
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * uPixelRatio * uPointSize / 5.0 * (300.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`

export const particleFragmentShader = `
  precision highp float;
  
  uniform sampler2D uTexture;
  
  varying vec3 vColor;
  varying float vAlpha;
  
  void main() {
    vec4 texColor = texture2D(uTexture, gl_PointCoord);
    float finalAlpha = texColor.a * vAlpha;
    
    if (finalAlpha < 0.001) discard;
    
    gl_FragColor = vec4(vColor * texColor.rgb * 2.0, finalAlpha);
  }
`

export const backgroundVertexShader = `
  precision highp float;
  
  varying vec2 vUv;
  
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

export const backgroundFragmentShader = `
  precision highp float;
  
  uniform float uTime;
  uniform vec2 uMouse;
  uniform float uVelocity;
  uniform vec2 uResolution;
  uniform float uFrustumSize;
  uniform float uAspect;
  
  varying vec2 vUv;
  
  // Simple noise function
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  
  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    
    for (int i = 0; i < 4; i++) {
      value += amplitude * noise(p);
      p *= 2.0;
      amplitude *= 0.5;
    }
    
    return value;
  }
  
  void main() {
    // Match the orthographic camera frustum calculation from App.jsx
    // In trail: halfWidth = frustumSize * aspect / 2, halfHeight = frustumSize / 2
    float halfWidth = uFrustumSize * uAspect * 0.5;
    float halfHeight = uFrustumSize * 0.5;
    
    // Convert UV [0,1] to world coordinates [-halfSize, halfSize]
    vec2 worldPos = vec2(
      (vUv.x - 0.5) * 2.0 * halfWidth,
      (vUv.y - 0.5) * 2.0 * halfHeight
    );
    
    // Convert normalized mouse coords [-1,1] to world coords - same as trail calculation
    vec2 mouseWorld = vec2(
      uMouse.x * halfWidth,
      uMouse.y * halfHeight
    );
    
    float dist = length(worldPos - mouseWorld);
    
    float time = uTime * 0.25;
    
    // Layered noise
    float n1 = fbm(worldPos * 0.3 + vec2(time * 0.5, 0.0));
    float n2 = fbm(worldPos * 0.6 - vec2(0.0, time * 0.3));
    float n3 = noise(worldPos * 1.2 + vec2(time * 0.2, time * 0.15));
    
    float pattern = n1 * 0.5 + n2 * 0.3 + n3 * 0.2;
    
    // Mouse influence
    float mouseInfluence = exp(-dist * 0.4) * uVelocity * 0.015;
    
    // Distorted UV
    vec2 distorted = worldPos + vec2(
      fbm(worldPos * 0.5 + mouseInfluence * 10.0 + time),
      fbm(worldPos * 0.5 - mouseInfluence * 10.0 - time * 0.8)
    ) * 0.5 * (1.0 + mouseInfluence * 3.0);
    
    // Colors
    vec3 darkColor = vec3(0.015, 0.02, 0.035);
    vec3 midColor = vec3(0.04, 0.08, 0.12);
    vec3 accentColor = vec3(0.08, 0.25, 0.35);
    vec3 highlightColor = vec3(0.15, 0.45, 0.6);
    vec3 glowColor = vec3(0.25, 0.65, 0.85);
    
    float noisePattern = fbm(distorted * 0.25 + time * 0.1);
    
    vec3 color = mix(darkColor, midColor, noisePattern * 0.5 + 0.5);
    color = mix(color, accentColor, pow(noisePattern * 0.5 + 0.5, 2.5) * 0.6);
    
    // Highlight
    float highlight = pow(max(0.0, fbm(distorted * 0.35 + time * 0.15)), 3.0);
    color += highlightColor * highlight * 0.3;
    
    // Vignette
    float vignette = 1.0 - length(vUv - 0.5) * 0.7;
    color *= vignette;
    
    gl_FragColor = vec4(color, 1.0);
  }
`
