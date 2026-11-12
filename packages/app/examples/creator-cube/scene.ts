export function scene(
  canvas: HTMLCanvasElement,
  orient: (angles: { x: number; y: number }) => void,
  zoom: (value: number) => void,
) {
  const gl = canvas.getContext("webgl", { antialias: true, alpha: true, preserveDrawingBuffer: true })
  if (!gl) throw new Error("WebGL não está disponível neste navegador.")
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)!
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(shader) ?? "Shader failed")
    return shader
  }
  const vertex = compile(
    gl.VERTEX_SHADER,
    `
    attribute vec3 position; attribute vec3 normal;
    uniform vec2 rotation; uniform float aspect; uniform float scale;
    varying vec3 n; varying vec3 p;
    void main() {
      float cx=cos(rotation.x), sx=sin(rotation.x), cy=cos(rotation.y), sy=sin(rotation.y);
      mat3 ry=mat3(cy,0.,-sy,0.,1.,0.,sy,0.,cy);
      mat3 rx=mat3(1.,0.,0.,0.,cx,sx,0.,-sx,cx);
      vec3 v=rx*ry*position*scale; n=rx*ry*normal; p=v;
      float depth=4.8-v.z;
      gl_Position=vec4(v.x*2.8/aspect,v.y*2.8,v.z*-.1,depth);
    }`,
  )
  const fragment = compile(
    gl.FRAGMENT_SHADER,
    `
    precision mediump float;
    uniform vec3 color; uniform float lines; varying vec3 n; varying vec3 p;
    void main() {
      vec3 nn=normalize(n);
      float diffuse=max(dot(nn,normalize(vec3(-.5,.9,1.))),0.);
      float sheen=pow(max(dot(reflect(-normalize(vec3(-.5,.9,1.)),nn),normalize(vec3(0.,0.,5.)-p)),0.),28.);
      vec3 lit=color*(.30+diffuse*.70)+vec3(sheen*.12);
      gl_FragColor=vec4(mix(lit,vec3(.95,.96,1.),lines),1.);
    }`,
  )
  const program = gl.createProgram()!
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "Link failed")
  const faces = [
    {
      n: [0, 0, 1],
      v: [
        [-1, -1, 1],
        [1, -1, 1],
        [1, 1, 1],
        [-1, 1, 1],
      ],
    },
    {
      n: [0, 0, -1],
      v: [
        [1, -1, -1],
        [-1, -1, -1],
        [-1, 1, -1],
        [1, 1, -1],
      ],
    },
    {
      n: [0, 1, 0],
      v: [
        [-1, 1, 1],
        [1, 1, 1],
        [1, 1, -1],
        [-1, 1, -1],
      ],
    },
    {
      n: [0, -1, 0],
      v: [
        [-1, -1, -1],
        [1, -1, -1],
        [1, -1, 1],
        [-1, -1, 1],
      ],
    },
    {
      n: [1, 0, 0],
      v: [
        [1, -1, 1],
        [1, -1, -1],
        [1, 1, -1],
        [1, 1, 1],
      ],
    },
    {
      n: [-1, 0, 0],
      v: [
        [-1, -1, -1],
        [-1, -1, 1],
        [-1, 1, 1],
        [-1, 1, -1],
      ],
    },
  ]
  const triangles = new Float32Array(
    faces.flatMap((face) => [0, 1, 2, 0, 2, 3].flatMap((index) => [...face.v[index], ...face.n])),
  )
  const edges = new Float32Array(
    faces.flatMap((face) =>
      [0, 1, 1, 2, 2, 3, 3, 0].flatMap((index) => [...face.v[index].map((value) => value * 1.002), ...face.n]),
    ),
  )
  const buffers = [triangles, edges].map((data) => {
    const buffer = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
    return buffer
  })
  const uniforms = Object.fromEntries(
    ["rotation", "aspect", "scale", "color", "lines"].map((name) => [name, gl.getUniformLocation(program, name)]),
  )
  const position = gl.getAttribLocation(program, "position")
  const normal = gl.getAttribLocation(program, "normal")
  gl.useProgram(program)
  gl.enable(gl.DEPTH_TEST)
  gl.enableVertexAttribArray(position)
  gl.enableVertexAttribArray(normal)
  const state = {
    x: 0.42,
    y: 0.63,
    size: 1,
    zoom: 1,
    wireframe: false,
    playing: false,
    color: [0.984, 0.36, 0.475],
    frame: 0,
    disposed: false,
    last: 0,
    lastReport: 0,
    pointer: null as { x: number; y: number } | null,
  }
  const draw = () => {
    if (state.disposed || document.hidden) return
    const width = Math.round(canvas.clientWidth * Math.min(devicePixelRatio, 2))
    const height = Math.round(canvas.clientHeight * Math.min(devicePixelRatio, 2))
    if (!width || !height) return
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }
    gl.viewport(0, 0, width, height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    gl.uniform2f(uniforms.rotation, state.x, state.y)
    gl.uniform1f(uniforms.aspect, width / height)
    gl.uniform1f(uniforms.scale, state.size * state.zoom * 0.72)
    gl.uniform3fv(uniforms.color, state.color)
    const render = (index: number, mode: number, count: number) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffers[index])
      gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 24, 0)
      gl.vertexAttribPointer(normal, 3, gl.FLOAT, false, 24, 12)
      gl.uniform1f(uniforms.lines, index)
      gl.drawArrays(mode, 0, count)
    }
    render(0, gl.TRIANGLES, 36)
    if (state.wireframe) render(1, gl.LINES, 48)
    canvas.dataset.rendered = String(Number(canvas.dataset.rendered ?? 0) + 1)
  }
  const report = () =>
    orient({ x: Math.round((state.x * 180) / Math.PI), y: Math.round((state.y * 180) / Math.PI) % 360 })
  const tick = (time: number) => {
    if (!state.playing || state.disposed || document.hidden) {
      state.frame = 0
      return
    }
    if (time - state.last >= 1000 / 30) {
      state.y += 0.008
      state.last = time
      draw()
    }
    if (time - state.lastReport >= 200) {
      state.lastReport = time
      report()
    }
    state.frame = requestAnimationFrame(tick)
  }
  const animate = () => {
    if (state.playing && !state.frame && !document.hidden) state.frame = requestAnimationFrame(tick)
  }
  const down = (event: PointerEvent) => {
    state.pointer = { x: event.clientX, y: event.clientY }
    canvas.setPointerCapture(event.pointerId)
  }
  const move = (event: PointerEvent) => {
    if (!state.pointer) return
    state.y += (event.clientX - state.pointer.x) * 0.008
    state.x = Math.max(-1.4, Math.min(1.4, state.x + (event.clientY - state.pointer.y) * 0.008))
    state.pointer = { x: event.clientX, y: event.clientY }
    draw()
    report()
  }
  const up = () => {
    state.pointer = null
  }
  const wheel = (event: WheelEvent) => {
    event.preventDefault()
    zoom(Math.round(Math.max(0.7, Math.min(1.5, state.zoom - event.deltaY * 0.001)) * 20) / 20)
  }
  const key = (event: KeyboardEvent) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return
    event.preventDefault()
    state.y += event.key === "ArrowLeft" ? -0.1 : event.key === "ArrowRight" ? 0.1 : 0
    state.x += event.key === "ArrowUp" ? -0.1 : event.key === "ArrowDown" ? 0.1 : 0
    draw()
    report()
  }
  const visibility = () => {
    if (document.hidden) {
      cancelAnimationFrame(state.frame)
      state.frame = 0
    } else {
      draw()
      animate()
    }
  }
  const observer = new ResizeObserver(draw)
  observer.observe(canvas)
  canvas.addEventListener("pointerdown", down)
  canvas.addEventListener("pointermove", move)
  canvas.addEventListener("pointerup", up)
  canvas.addEventListener("pointercancel", up)
  canvas.addEventListener("wheel", wheel, { passive: false })
  canvas.addEventListener("keydown", key)
  document.addEventListener("visibilitychange", visibility)
  const dispose = () => {
    if (state.disposed) return
    state.disposed = true
    cancelAnimationFrame(state.frame)
    observer.disconnect()
    canvas.removeEventListener("pointerdown", down)
    canvas.removeEventListener("pointermove", move)
    canvas.removeEventListener("pointerup", up)
    canvas.removeEventListener("pointercancel", up)
    canvas.removeEventListener("wheel", wheel)
    canvas.removeEventListener("keydown", key)
    document.removeEventListener("visibilitychange", visibility)
    window.removeEventListener("pagehide", dispose)
    buffers.forEach((buffer) => gl.deleteBuffer(buffer))
    gl.deleteProgram(program)
    gl.deleteShader(vertex)
    gl.deleteShader(fragment)
    gl.getExtension("WEBGL_lose_context")?.loseContext()
  }
  window.addEventListener("pagehide", dispose)
  draw()
  report()
  return {
    update(controls: { size: number; zoom: number; wireframe: boolean; playing: boolean }, color: string) {
      Object.assign(state, controls, {
        color: [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16) / 255),
      })
      if (!state.playing) {
        cancelAnimationFrame(state.frame)
        state.frame = 0
      }
      draw()
      animate()
    },
    reset() {
      state.x = 0.42
      state.y = 0.63
      draw()
      report()
    },
    dispose,
  }
}
