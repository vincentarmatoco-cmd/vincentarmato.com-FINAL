/*
 * Infinite 3D photo archive — vanilla Three.js port of the React
 * "3d-gallery-photography" component (cloth shader, golden-angle layout,
 * depth fade/blur, hover flag-wave, autoplay with scroll-driven velocity).
 *
 * Adaptation for this site: instead of hijacking the wheel, plane velocity
 * is fed by normal page scrolling while the sticky section is on screen,
 * so the page never traps the user. Autoplay resumes after 3s idle.
 *
 * Supports multiple galleries per site (one per page): each `.g3d-canvas`
 * picks its photo set via a `data-image-set` attribute against IMAGE_SETS
 * below, and gets its own independent renderer/scene/state.
 */
(function () {
  'use strict';

  if (typeof THREE === 'undefined') return;

  var IMAGE_SETS = {
    // Add more photos of Vincent by dropping them in photos/about-me/ and
    // listing the filename here — see photos/about-me/README.md.
    // Interleaved athlete/behind-the-lens so the fly-through never puts two
    // similar shots back to back.
    about: [
      'photos/thumbs/about-me/01.webp',
      'photos/thumbs/about-me/athlete/football-portrait.webp',
      'photos/thumbs/about-me/behind-the-lens/bts-01.webp',
      'photos/thumbs/about-me/athlete/basketball-seniornight.webp',
      'photos/thumbs/about-me/behind-the-lens/bts-02.webp',
      'photos/thumbs/about-me/athlete/basketball-huddle.webp',
      'photos/thumbs/about-me/behind-the-lens/bts-03.webp',
      'photos/thumbs/about-me/athlete/football-night.webp',
      'photos/thumbs/about-me/behind-the-lens/bts-04.webp',
      'photos/thumbs/about-me/pfp.webp'
    ]
  };

  var SPEED = 1.2;
  var VISIBLE_COUNT = 10;
  var DEPTH_RANGE = 50;
  var MAX_HORIZONTAL_OFFSET = 8;
  var MAX_VERTICAL_OFFSET = 8;
  var FADE = { inStart: 0.05, inEnd: 0.25, outStart: 0.4, outEnd: 0.43 };
  var BLUR = { inStart: 0.0, inEnd: 0.1, outStart: 0.4, outEnd: 0.43, max: 8.0 };

  var VERTEX_SHADER = [
    'uniform float scrollForce;',
    'uniform float time;',
    'uniform float isHovered;',
    'varying vec2 vUv;',
    'varying vec3 vNormal;',
    'void main() {',
    '  vUv = uv;',
    '  vNormal = normal;',
    '  vec3 pos = position;',
    '  float curveIntensity = scrollForce * 0.3;',
    '  float distanceFromCenter = length(pos.xy);',
    '  float curve = distanceFromCenter * distanceFromCenter * curveIntensity;',
    '  float ripple1 = sin(pos.x * 2.0 + scrollForce * 3.0) * 0.02;',
    '  float ripple2 = sin(pos.y * 2.5 + scrollForce * 2.0) * 0.015;',
    '  float clothEffect = (ripple1 + ripple2) * abs(curveIntensity) * 2.0;',
    '  float flagWave = 0.0;',
    '  if (isHovered > 0.5) {',
    '    float wavePhase = pos.x * 3.0 + time * 8.0;',
    '    float waveAmplitude = sin(wavePhase) * 0.1;',
    '    float dampening = smoothstep(-0.5, 0.5, pos.x);',
    '    flagWave = waveAmplitude * dampening;',
    '    float secondaryWave = sin(pos.x * 5.0 + time * 12.0) * 0.03 * dampening;',
    '    flagWave += secondaryWave;',
    '  }',
    '  pos.z -= (curve + clothEffect + flagWave);',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);',
    '}'
  ].join('\n');

  var FRAGMENT_SHADER = [
    'uniform sampler2D map;',
    'uniform float opacity;',
    'uniform float blurAmount;',
    'uniform float scrollForce;',
    'varying vec2 vUv;',
    'varying vec3 vNormal;',
    'void main() {',
    '  vec4 color = texture2D(map, vUv);',
    '  if (blurAmount > 0.0) {',
    '    vec2 texelSize = 1.0 / vec2(textureSize(map, 0));',
    '    vec4 blurred = vec4(0.0);',
    '    float total = 0.0;',
    '    for (float x = -2.0; x <= 2.0; x += 1.0) {',
    '      for (float y = -2.0; y <= 2.0; y += 1.0) {',
    '        vec2 offset = vec2(x, y) * texelSize * blurAmount;',
    '        float weight = 1.0 / (1.0 + length(vec2(x, y)));',
    '        blurred += texture2D(map, vUv + offset) * weight;',
    '        total += weight;',
    '      }',
    '    }',
    '    color = blurred / total;',
    '  }',
    '  float curveHighlight = abs(scrollForce) * 0.05;',
    '  color.rgb += vec3(curveHighlight * 0.1);',
    '  gl_FragColor = vec4(color.rgb, color.a * opacity);',
    '}'
  ].join('\n');

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function initGallery3D(canvas, IMAGES) {
    var section = canvas.closest('.film-section');
    var stage = canvas.closest('.film-sticky');
    var intro = section.querySelector('.film-intro');
    var tagline = section.querySelector('.film-center-tagline');
    var hint = section.querySelector('.film-hint-wrap');
    var outro = section.querySelector('.film-outro');

    function buildFallback() {
      canvas.style.display = 'none';
      var grid = document.createElement('div');
      grid.className = 'g3d-fallback';
      IMAGES.slice(0, 12).forEach(function (src) {
        var img = document.createElement('img');
        img.src = src;
        img.alt = '';
        img.loading = 'lazy';
        grid.appendChild(img);
      });
      stage.insertBefore(grid, stage.firstChild);
      section.classList.add('is-static');
      if (outro) {
        outro.style.opacity = 1;
        outro.style.pointerEvents = 'auto';
      }
    }

    // Opened as a local file (double-clicked, not served over http/https)?
    // Browsers block WebGL from uploading file:// images as textures — the
    // scene would run with every plane invisible. Skip straight to the
    // fallback grid rather than showing a dead black canvas.
    if (window.location.protocol === 'file:') {
      buildFallback();
      return;
    }

    // The blur shader needs textureSize(), which requires a WebGL2 context.
    var probe = document.createElement('canvas');
    if (!window.WebGL2RenderingContext || !probe.getContext('webgl2')) {
      buildFallback();
      return;
    }

    var renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    } catch (e) {
      buildFallback();
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    // Default (linear) encoding end-to-end: the unlit passthrough shader then
    // shows the JPEGs exactly as authored, with no sRGB double-conversion.

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);

    function createClothMaterial() {
      return new THREE.ShaderMaterial({
        transparent: true,
        uniforms: {
          map: { value: null },
          opacity: { value: 1.0 },
          blurAmount: { value: 0.0 },
          scrollForce: { value: 0.0 },
          time: { value: 0.0 },
          isHovered: { value: 0.0 }
        },
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER
      });
    }

    // Golden-angle spatial distribution (same math as the React component).
    var spatialPositions = [];
    for (var i = 0; i < VISIBLE_COUNT; i++) {
      var horizontalAngle = (i * 2.618) % (Math.PI * 2);
      var verticalAngle = (i * 1.618 + Math.PI / 3) % (Math.PI * 2);
      var horizontalRadius = (i % 3) * 1.2;
      var verticalRadius = ((i + 1) % 4) * 0.8;
      spatialPositions.push({
        x: (Math.sin(horizontalAngle) * horizontalRadius * MAX_HORIZONTAL_OFFSET) / 3,
        y: (Math.cos(verticalAngle) * verticalRadius * MAX_VERTICAL_OFFSET) / 4
      });
    }

    var totalImages = IMAGES.length;
    // Never place more planes than we have distinct images — a ring larger than
    // the set repeats a photo, so the same shot shows twice at once (10 planes
    // vs a 9-photo set = one visible duplicate).
    var planeCount = Math.min(VISIBLE_COUNT, totalImages);
    var imageAdvance = planeCount % totalImages || totalImages;
    var halfRange = DEPTH_RANGE / 2;

    var textures = [];
    var planes = [];
    var scrollVelocity = 0;
    var autoPlay = !reduceMotion;
    var lastInteraction = Date.now();
    var started = false;
    var loadRequested = false;
    var clock = new THREE.Clock();

    function setPlaneTexture(plane) {
      var texture = textures[plane.imageIndex];
      if (!texture) return;
      plane.mesh.material.uniforms.map.value = texture;
      var img = texture.image;
      var aspect = img ? img.width / img.height : 1;
      if (aspect > 1) {
        plane.mesh.scale.set(2 * aspect, 2, 1);
      } else {
        plane.mesh.scale.set(2, 2 / aspect, 1);
      }
    }

    function start() {
      if (started) return;
      started = true;

      var geometry = new THREE.PlaneGeometry(1, 1, 32, 32);
      for (var i = 0; i < planeCount; i++) {
        var mesh = new THREE.Mesh(geometry, createClothMaterial());
        var plane = {
          mesh: mesh,
          z: ((DEPTH_RANGE / planeCount) * i) % DEPTH_RANGE,
          imageIndex: i % totalImages,
          x: spatialPositions[i].x,
          y: spatialPositions[i].y
        };
        setPlaneTexture(plane);
        mesh.position.set(plane.x, plane.y, plane.z - halfRange);
        scene.add(mesh);
        planes.push(plane);
      }

      sizeCanvas();
      canvas.classList.add('is-ready');
      if (reduceMotion) {
        section.classList.add('is-static');
        if (outro) {
          outro.style.opacity = 1;
          outro.style.pointerEvents = 'auto';
        }
      }
      renderer.setAnimationLoop(tick);
    }

    function loadTextures() {
      if (loadRequested) return;
      loadRequested = true;
      var loader = new THREE.TextureLoader();
      var loaded = 0;
      var failed = 0;
      function done() {
        loaded++;
        if (loaded < totalImages) return;
        // e.g. file:// pages: browsers block WebGL texture uploads entirely.
        if (failed === totalImages) {
          buildFallback();
        } else {
          start();
        }
      }
      IMAGES.forEach(function (src, i) {
        loader.load(src, function (texture) {
          textures[i] = texture;
          done();
        }, undefined, function () {
          failed++;
          done();
        });
      });
    }

    function sizeCanvas() {
      var w = stage.clientWidth;
      var h = stage.clientHeight;
      if (!w || !h) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    }

    function sectionProgress() {
      var rect = section.getBoundingClientRect();
      var total = rect.height - window.innerHeight;
      if (total <= 0) return 0;
      return Math.max(0, Math.min(1, -rect.top / total));
    }

    function sectionNear() {
      var rect = section.getBoundingClientRect();
      var vh = window.innerHeight;
      if (rect.top < vh * 2 && rect.bottom > -vh) {
        loadTextures();
        return rect.top < vh && rect.bottom > 0;
      }
      return false;
    }

    function setOverlays(p) {
      if (intro) {
        var introOpacity = Math.max(0, Math.min(1, 1 - p / 0.22));
        intro.style.opacity = introOpacity;
        intro.style.visibility = introOpacity === 0 ? 'hidden' : 'visible';
      }
      // Tagline + scroll hint fade early; the centered name (.film-center-name)
      // and corner signature (.film-meta) are untouched here — they stay
      // visible for the whole section, by design.
      if (tagline || hint) {
        var fadeOpacity = Math.max(0, Math.min(1, 1 - p / 0.2));
        if (tagline) tagline.style.opacity = fadeOpacity;
        if (hint) {
          hint.style.opacity = fadeOpacity;
          hint.style.visibility = fadeOpacity === 0 ? 'hidden' : 'visible';
        }
      }
      if (outro && !reduceMotion) {
        var outroOpacity = Math.max(0, Math.min(1, (p - 0.82) / 0.14));
        outro.style.opacity = outroOpacity;
        outro.style.pointerEvents = outroOpacity > 0.5 ? 'auto' : 'none';
      }
    }

    function tick() {
      var delta = Math.min(clock.getDelta(), 0.05);
      if (!sectionNear()) return;

      if (!reduceMotion) {
        if (autoPlay) scrollVelocity += 0.3 * delta;
        scrollVelocity *= 0.95;
        scrollVelocity = Math.max(-10, Math.min(10, scrollVelocity));
      }

      var time = clock.getElapsedTime();

      planes.forEach(function (plane) {
        var newZ = plane.z + scrollVelocity * delta * 10;
        var wrapsForward = 0;
        var wrapsBackward = 0;

        if (newZ >= DEPTH_RANGE) {
          wrapsForward = Math.floor(newZ / DEPTH_RANGE);
          newZ -= DEPTH_RANGE * wrapsForward;
        } else if (newZ < 0) {
          wrapsBackward = Math.ceil(-newZ / DEPTH_RANGE);
          newZ += DEPTH_RANGE * wrapsBackward;
        }

        var changed = false;
        if (wrapsForward > 0) {
          plane.imageIndex = (plane.imageIndex + wrapsForward * imageAdvance) % totalImages;
          changed = true;
        }
        if (wrapsBackward > 0) {
          var step = plane.imageIndex - wrapsBackward * imageAdvance;
          plane.imageIndex = ((step % totalImages) + totalImages) % totalImages;
          changed = true;
        }
        if (changed) setPlaneTexture(plane);

        plane.z = ((newZ % DEPTH_RANGE) + DEPTH_RANGE) % DEPTH_RANGE;
        plane.mesh.position.set(plane.x, plane.y, plane.z - halfRange);

        var normalized = plane.z / DEPTH_RANGE;

        var opacity = 1;
        if (normalized >= FADE.inStart && normalized <= FADE.inEnd) {
          opacity = (normalized - FADE.inStart) / (FADE.inEnd - FADE.inStart);
        } else if (normalized < FADE.inStart) {
          opacity = 0;
        } else if (normalized >= FADE.outStart && normalized <= FADE.outEnd) {
          opacity = 1 - (normalized - FADE.outStart) / (FADE.outEnd - FADE.outStart);
        } else if (normalized > FADE.outEnd) {
          opacity = 0;
        }

        var blur = 0;
        if (normalized >= BLUR.inStart && normalized <= BLUR.inEnd) {
          blur = BLUR.max * (1 - (normalized - BLUR.inStart) / (BLUR.inEnd - BLUR.inStart));
        } else if (normalized < BLUR.inStart) {
          blur = BLUR.max;
        } else if (normalized >= BLUR.outStart && normalized <= BLUR.outEnd) {
          blur = BLUR.max * ((normalized - BLUR.outStart) / (BLUR.outEnd - BLUR.outStart));
        } else if (normalized > BLUR.outEnd) {
          blur = BLUR.max;
        }

        var uniforms = plane.mesh.material.uniforms;
        uniforms.opacity.value = Math.max(0, Math.min(1, opacity));
        uniforms.blurAmount.value = Math.max(0, Math.min(BLUR.max, blur));
        uniforms.time.value = time;
        uniforms.scrollForce.value = scrollVelocity;
      });

      setOverlays(sectionProgress());
      renderer.render(scene, camera);
    }

    /* ----- Input: page scroll feeds velocity (no wheel hijack) ----- */

    var lastScrollY = window.pageYOffset;

    window.addEventListener('scroll', function () {
      var y = window.pageYOffset;
      var deltaY = y - lastScrollY;
      lastScrollY = y;
      var onScreen = sectionNear(); // also starts texture preload when close
      if (reduceMotion || !started || !onScreen) return;
      scrollVelocity += deltaY * 0.01 * SPEED;
      autoPlay = false;
      lastInteraction = Date.now();
    }, { passive: true });

    document.addEventListener('keydown', function (event) {
      if (reduceMotion || !started) return;
      var rect = section.getBoundingClientRect();
      if (rect.top >= window.innerHeight || rect.bottom <= 0) return;
      if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
        scrollVelocity -= 2 * SPEED;
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
        scrollVelocity += 2 * SPEED;
      } else {
        return;
      }
      autoPlay = false;
      lastInteraction = Date.now();
    });

    setInterval(function () {
      if (!reduceMotion && Date.now() - lastInteraction > 3000) autoPlay = true;
    }, 1000);

    /* ----- Hover flag-wave via raycaster ----- */

    var raycaster = new THREE.Raycaster();
    var pointer = new THREE.Vector2();
    var hoveredMesh = null;

    canvas.addEventListener('pointermove', function (event) {
      if (!started) return;
      var rect = canvas.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      var hits = raycaster.intersectObjects(scene.children);
      var mesh = hits.length ? hits[0].object : null;
      if (mesh !== hoveredMesh) {
        if (hoveredMesh) hoveredMesh.material.uniforms.isHovered.value = 0.0;
        if (mesh) mesh.material.uniforms.isHovered.value = 1.0;
        hoveredMesh = mesh;
      }
    });

    canvas.addEventListener('pointerleave', function () {
      if (hoveredMesh) {
        hoveredMesh.material.uniforms.isHovered.value = 0.0;
        hoveredMesh = null;
      }
    });

    window.addEventListener('resize', sizeCanvas);

    // Kick off texture loading early if the page opens near the section.
    sectionNear();
  }

  document.querySelectorAll('.g3d-canvas').forEach(function (canvas) {
    var setName = canvas.getAttribute('data-image-set') || 'archive';
    var images = IMAGE_SETS[setName];
    if (images && images.length) initGallery3D(canvas, images);
  });
})();
