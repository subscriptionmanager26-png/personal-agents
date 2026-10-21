"use client";

import { useEffect, useRef } from "react";

const VERT = `
attribute vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAG = `
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform vec2 u_mouse;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float starfield(vec2 uv, float t) {
  vec2 g = floor(uv * 120.0);
  vec2 f = fract(uv * 120.0);
  float n = hash(g);
  float tw = 0.5 + 0.5 * sin(t * 2.5 + n * 6.28);
  float d = length(f - 0.5);
  return step(d, 0.08 * n) * tw * n * 0.9;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  uv += (u_mouse - 0.5) * vec2(0.12, 0.08);

  vec2 bh = uv - vec2(0.0, 0.06);
  float r = length(bh);
  float ang = atan(bh.y, bh.x);

  vec3 col = vec3(0.008, 0.009, 0.014);
  col += starfield(uv + vec2(0.0, u_time * 0.01), u_time) * vec3(0.85, 0.9, 1.0);

  float diskMask = exp(-pow(bh.y * 5.5, 2.0));
  diskMask *= smoothstep(0.2, 0.28, r) * smoothstep(0.68, 0.48, r);
  diskMask *= 0.55 + 0.45 * sin(ang * 7.0 - u_time * 1.6 + r * 4.0);

  vec3 diskCol = mix(vec3(0.35, 0.65, 1.0), vec3(1.0, 0.55, 0.22), smoothstep(-1.0, 1.0, sin(ang - u_time * 0.7))) * diskMask * 1.35;

  float ring1 = smoothstep(0.175, 0.182, r) * smoothstep(0.195, 0.185, r);
  float shadow = smoothstep(0.105, 0.13, r);
  float core = 1.0 - smoothstep(0.0, 0.11, r);

  col += diskCol * (1.0 - core);
  col += ring1 * vec3(1.0, 0.82, 0.55) * (1.0 - core * 0.8);
  col *= 1.0 - shadow * 0.97;
  col = mix(col, vec3(0.0), core * 0.98);
  col *= 1.0 - dot(uv, uv) * 0.45;

  gl_FragColor = vec4(col, 1.0);
}
`;

function compileShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return null;
  return shader;
}

/** v2 — animated + mouse parallax black hole. */
export function SaffronHorizonGlInteractive() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef({ x: 0.5, y: 0.5 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { antialias: false, alpha: false });
    if (!gl) return;

    const vs = compileShader(gl, gl.VERTEX_SHADER, VERT);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return;

    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    const aPos = gl.getAttribLocation(program, "a_position");
    const uRes = gl.getUniformLocation(program, "u_res");
    const uTime = gl.getUniformLocation(program, "u_time");
    const uMouse = gl.getUniformLocation(program, "u_mouse");

    let raf = 0;
    const start = performance.now();

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(canvas.clientWidth * dpr);
      canvas.height = Math.floor(canvas.clientHeight * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
    };

    const onMove = (e: PointerEvent) => {
      mouseRef.current = {
        x: e.clientX / window.innerWidth,
        y: 1.0 - e.clientY / window.innerHeight,
      };
    };

    const draw = (now: number) => {
      const t = (now - start) * 0.001;
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, t);
      gl.uniform2f(uMouse, mouseRef.current.x, mouseRef.current.y);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      raf = requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onMove, { passive: true });
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(buf);
    };
  }, []);

  return <canvas ref={canvasRef} className="fixed inset-0 h-full w-full" aria-hidden />;
}
