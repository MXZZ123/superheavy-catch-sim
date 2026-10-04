/* Procedural outdoor environment map (PMREM) for the stainless reflections: sky gradient by time of day, bright horizon
   haze, sun disc, dark sand/sea lower hemisphere.  Cheap to rebuild when the time of day changes. */
(function (SH) {
  "use strict";
  const T = window.THREE;
  const FRAG = `varying vec3 v; uniform vec3 sunDir; uniform float tod; uniform float space; uniform float contrast;
    void main(){ vec3 d=normalize(v); float h=d.y;
      vec3 zen=mix(vec3(0.05,0.07,0.16), vec3(0.32,0.47,0.72), tod);
      vec3 hor=mix(vec3(0.85,0.45,0.30), vec3(0.86,0.88,0.90), smoothstep(0.15,0.6,tod));
      vec3 sky=mix(hor, zen, pow(clamp(h,0.0,1.0),0.55));
      vec3 gnd=mix(vec3(0.16,0.15,0.14), vec3(0.30,0.29,0.27), tod);
      vec3 c = h>0.0 ? sky : mix(hor*0.6, gnd, clamp(-h*4.0,0.0,1.0));
      // azimuthal structure (buildings, tower, haze breaks, floodlit panels) -> the bright / dark vertical streaks that a
      // brushed stainless cylinder shows in photos.  Strongest near the horizon, where a vertical cylinder reflects most.
      float az=atan(d.z,d.x);
      float st=0.5+0.5*sin(az*5.0+1.3)*sin(az*3.0+0.4); st=pow(st,2.5);
      float panel=smoothstep(0.9,0.98,0.5+0.5*sin(az*7.0+2.0))*(1.0-smoothstep(0.0,0.5,abs(h-0.12)));
      float band=1.0-smoothstep(0.0,0.6,abs(h));
      c *= mix(1.0, 0.35+1.9*st, band*contrast);
      c += vec3(1.0,0.97,0.92)*panel*0.9*contrast;
      c = mix(c, vec3(0.0), space);
      float s=max(dot(d,normalize(sunDir)),0.0); c += vec3(1.0,0.92,0.8)*(pow(s,600.0)*30.0 + pow(s,12.0)*0.35*tod);
      gl_FragColor=vec4(c,1.0);} `;
  SH.makeEnvMap = function (renderer, o) {
    o = o || {};
    const sc = new T.Scene();
    const m = new T.ShaderMaterial({ side: T.BackSide, depthWrite: false, uniforms: { sunDir: { value: o.sunDir || new T.Vector3(0.3, 0.6, 0.4) }, tod: { value: o.tod ?? 0.6 }, space: { value: o.space || 0 }, contrast: { value: o.contrast ?? 0.8 } },
      vertexShader: "varying vec3 v; void main(){ v=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} ", fragmentShader: FRAG });
    sc.add(new T.Mesh(new T.SphereGeometry(50, 48, 24), m));
    const pm = new T.PMREMGenerator(renderer); const rt = pm.fromScene(sc, 0.0, 0.1, 100); pm.dispose();
    return rt.texture;
  };
})(window.SH = window.SH || {});
