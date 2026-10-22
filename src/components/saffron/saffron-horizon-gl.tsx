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

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float starfield(vec2 uv, float t) {
  vec2 g = floor(uv * 140.0);
  vec2 f = fract(uv * 140.0);
  float n = hash(g);
  float tw = 0.45 + 0.55 * sin(t * 2.0 + n * 6.28);
  float d = length(f - 0.5);
  return step(d, 0.07 * n) * tw * n * 0.85;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  vec2 bh = uv - vec2(0.0, 0.2);
  float r = length(bh);
  float ang = atan(bh.y, bh.x);

  vec3 col = vec3(0.0);
  col += starfield(uv, u_time) * vec3(0.72, 0.76, 0.82);

  float diskY = bh.y * 6.2;
  float diskMask = exp(-diskY * diskY);
  diskMask *= smoothstep(0.19, 0.27, r) * smoothstep(0.72, 0.5, r);
  float turbulence = 0.5 + 0.5 * sin(ang * 9.0 + r * 5.0);
  diskMask *= turbulence;

  float doppler = smoothstep(-1.0, 1.0, sin(ang - 0.4));
  vec3 warm = vec3(1.0, 0.62, 0.32);
  vec3 cool = vec3(0.38, 0.68, 1.0);
  vec3 diskCol = mix(cool, warm, doppler) * diskMask * 1.45;

  float hump = exp(-pow(abs(bh.y) - 0.32, 2.0) * 28.0);
  diskCol += mix(vec3(0.95, 0.78, 0.5), vec3(0.45, 0.72, 1.0), step(0.0, bh.y)) * hump * smoothstep(0.22, 0.5, r) * 0.55;

  float photon = 0.0;
  photon += smoothstep(0.166, 0.172, r) * smoothstep(0.188, 0.178, r);
  photon += smoothstep(0.152, 0.156, r) * smoothstep(0.164, 0.158, r) * 0.5;
  photon += smoothstep(0.138, 0.142, r) * smoothstep(0.148, 0.144, r) * 0.22;

  float arcR = 0.34;
  float arcBand = exp(-pow(abs(length(vec2(bh.x, abs(bh.y))) - arcR), 2.0) * 220.0);
  arcBand *= smoothstep(0.11, 0.14, abs(bh.y));
  arcBand *= smoothstep(0.2, 0.55, r);
  vec3 arcCol = mix(vec3(0.42, 0.7, 1.0), vec3(1.0, 0.68, 0.38), doppler) * arcBand * 0.4;

  float shadow = smoothstep(0.098, 0.122, r);
  float core = 1.0 - smoothstep(0.0, 0.105, r);

  col += diskCol * (1.0 - core);
  col += arcCol * (1.0 - core);
  col += photon * vec3(1.0, 0.88, 0.62) * 1.85 * (1.0 - core * 0.75);
  col += photon * vec3(1.0, 0.72, 0.38) * 0.35 * (1.0 - core);
  col *= 1.0 - shadow * 0.98;
  col = mix(col, vec3(0.0), core);

  float lensGlow = exp(-pow(r - 0.172, 2.0) * 520.0) * 0.22;
  col += lensGlow * vec3(1.0, 0.82, 0.55) * (1.0 - core);
  col += exp(-r * 2.35) * vec3(0.88, 0.52, 0.34) * 0.05;
  col *= 1.0 - dot(uv * vec2(1.0, 0.85), uv * vec2(1.0, 0.85)) * 0.42;

  gl_FragColor = vec4(col, 1.0);
}
`;

const STATIC_TIME = 2.65;

function compileShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export function SaffronHorizonGl() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

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

    const draw = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w === 0 || h === 0) return;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, STATIC_TIME);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };

    draw();
    window.addEventListener("resize", draw);
    const ro = new ResizeObserver(() => draw());
    ro.observe(canvas);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", draw);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(buf);
    };
  }, []);

  return <canvas ref={canvasRef} className="fixed inset-0 h-full w-full" aria-hidden />;
}
