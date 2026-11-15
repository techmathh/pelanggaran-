import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export type MascotMood = 'idle' | 'recording' | 'locked' | 'celebrate';

interface CuteMascot3DProps {
  mood: MascotMood;
  caption?: string;
  compact?: boolean;
  triggerPulse?: number;
}

const _pointerVec = new THREE.Vector2(0, 0);

function detectSoftwareWebGL(): boolean {
  try {
    const probeCanvas = document.createElement('canvas');
    const gl = probeCanvas.getContext('webgl2') || probeCanvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const rendererName = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(rendererName);
  } catch {
    return true;
  }
}

export function CuteMascot3D({
  mood,
  caption,
  compact = false,
  triggerPulse = 0,
}: CuteMascot3DProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const moodRef = useRef<MascotMood>(mood);
  const hopImpulseRef = useRef<number>(0);
  const [webglReady, setWebglReady] = useState(true);

  useEffect(() => {
    moodRef.current = mood;
    if (mood === 'celebrate') {
      hopImpulseRef.current = 1.0;
    }
  }, [mood]);

  useEffect(() => {
    if (triggerPulse > 0) {
      hopImpulseRef.current = 0.85;
    }
  }, [triggerPulse]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = detectSoftwareWebGL();
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        alpha: true,
        powerPreference: 'high-performance',
      });
    } catch {
      setWebglReady(false);
      return;
    }

    const width = Math.max(container.clientWidth, 160);
    const height = Math.max(container.clientHeight, 160);

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';

    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const envTexture = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTexture;
    pmremGenerator.dispose();

    const camera = new THREE.PerspectiveCamera(34, width / height, 0.1, 40);
    camera.position.set(0, 1.45, compact ? 4.4 : 4.2);
    camera.lookAt(0, 0.72, 0);

    // 3-point balanced studio lighting
    const hemiLight = new THREE.HemisphereLight(0xeef4ff, 0xdbeafe, 0.85);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff8ed, 1.85);
    keyLight.position.set(3.2, 5.2, 4.0);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.set(512, 512);
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 14;
    keyLight.shadow.camera.left = -2.2;
    keyLight.shadow.camera.right = 2.2;
    keyLight.shadow.camera.top = 2.2;
    keyLight.shadow.camera.bottom = -2.2;
    keyLight.shadow.bias = -0.0005;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x93c5fd, 0.9);
    rimLight.position.set(-3.0, 2.5, -2.8);
    scene.add(rimLight);

    // Track geometries & materials for clean disposal
    const geometries: THREE.BufferGeometry[] = [];
    const materials: THREE.Material[] = [];
    const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
      geometries.push(g);
      return g;
    };
    const trackMat = <T extends THREE.Material>(m: T): T => {
      materials.push(m);
      return m;
    };

    // Materials (varied roughness & metalness)
    const deskWoodMat = trackMat(
      new THREE.MeshStandardMaterial({ color: 0xe2c799, roughness: 0.65, metalness: 0.04 })
    );
    const deskTrimMat = trackMat(
      new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.35, metalness: 0.08 })
    );
    const bodyMat = trackMat(
      new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.42, metalness: 0.05 })
    );
    const bellyMat = trackMat(
      new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.68, metalness: 0.02 })
    );
    const beakMat = trackMat(
      new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.32, metalness: 0.12 })
    );
    const eyeDarkMat = trackMat(
      new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.12, metalness: 0.2 })
    );
    const eyeShineMat = trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0xffffff,
        emissiveIntensity: 0.6,
        roughness: 0.1,
      })
    );
    const cheekMat = trackMat(
      new THREE.MeshStandardMaterial({ color: 0xfda4af, roughness: 0.72, metalness: 0.0 })
    );
    const capNavyMat = trackMat(
      new THREE.MeshStandardMaterial({ color: 0x1e3a8a, roughness: 0.55, metalness: 0.08 })
    );
    const goldBadgeMat = trackMat(
      new THREE.MeshStandardMaterial({ color: 0xfbbf24, roughness: 0.22, metalness: 0.85 })
    );
    const boardMat = trackMat(
      new THREE.MeshStandardMaterial({ color: 0x92400e, roughness: 0.6, metalness: 0.05 })
    );
    const paperMat = trackMat(
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0.0 })
    );

    const rootGroup = new THREE.Group();
    scene.add(rootGroup);

    // 1. Ceramic/Wood Desk Pedestal (grounded at y = 0)
    const pedestal = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(1.18, 1.28, 0.22, 36)),
      deskTrimMat
    );
    pedestal.position.y = 0.11;
    pedestal.receiveShadow = true;
    rootGroup.add(pedestal);

    const deskTop = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(1.06, 1.06, 0.06, 36)),
      deskWoodMat
    );
    deskTop.position.y = 0.24;
    deskTop.receiveShadow = true;
    rootGroup.add(deskTop);

    // Contact shadow disc
    const shadowDisc = new THREE.Mesh(
      trackGeo(new THREE.CircleGeometry(0.68, 28)),
      trackMat(
        new THREE.MeshBasicMaterial({
          color: 0x1e293b,
          transparent: true,
          opacity: 0.16,
          depthWrite: false,
        })
      )
    );
    shadowDisc.rotation.x = -Math.PI / 2;
    shadowDisc.position.y = 0.275;
    rootGroup.add(shadowDisc);

    // 2. Piko the Cute Chibi OSIS Owl Group
    const owlGroup = new THREE.Group();
    owlGroup.position.y = 0.27;
    rootGroup.add(owlGroup);

    // Body (smooth capsule-sphere silhouette)
    const bodyMesh = new THREE.Mesh(
      trackGeo(new THREE.SphereGeometry(0.62, 32, 24)),
      bodyMat
    );
    bodyMesh.scale.set(1.02, 1.08, 0.96);
    bodyMesh.position.y = 0.66;
    bodyMesh.castShadow = true;
    owlGroup.add(bodyMesh);

    // Cream Belly Patch
    const bellyMesh = new THREE.Mesh(
      trackGeo(new THREE.SphereGeometry(0.46, 28, 20)),
      bellyMat
    );
    bellyMesh.scale.set(0.92, 0.96, 0.55);
    bellyMesh.position.set(0, 0.56, 0.36);
    owlGroup.add(bellyMesh);

    // Cute Ear Tufts (left & right)
    const tuftGeo = trackGeo(new THREE.ConeGeometry(0.14, 0.28, 16));
    const leftTuft = new THREE.Mesh(tuftGeo, bodyMat);
    leftTuft.position.set(-0.42, 1.24, 0.05);
    leftTuft.rotation.z = 0.42;
    owlGroup.add(leftTuft);

    const rightTuft = new THREE.Mesh(tuftGeo, bodyMat);
    rightTuft.position.set(0.42, 1.24, 0.05);
    rightTuft.rotation.z = -0.42;
    owlGroup.add(rightTuft);

    // Face / Eyes (with white rings, glossy pupils, specular catchlights, and blinking eyelids)
    const eyeRingGeo = trackGeo(new THREE.CylinderGeometry(0.21, 0.21, 0.06, 24));
    const pupilGeo = trackGeo(new THREE.SphereGeometry(0.115, 20, 16));
    const shineGeo = trackGeo(new THREE.SphereGeometry(0.036, 12, 10));
    const lidGeo = trackGeo(new THREE.SphereGeometry(0.14, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2));

    const leftEyeGroup = new THREE.Group();
    leftEyeGroup.position.set(-0.22, 0.86, 0.52);
    owlGroup.add(leftEyeGroup);

    const leftRing = new THREE.Mesh(eyeRingGeo, bellyMat);
    leftRing.rotation.x = Math.PI / 2;
    leftEyeGroup.add(leftRing);
    const leftPupil = new THREE.Mesh(pupilGeo, eyeDarkMat);
    leftPupil.position.z = 0.03;
    leftEyeGroup.add(leftPupil);
    const leftShine = new THREE.Mesh(shineGeo, eyeShineMat);
    leftShine.position.set(0.04, 0.045, 0.125);
    leftEyeGroup.add(leftShine);
    const leftLid = new THREE.Mesh(lidGeo, bodyMat);
    leftLid.position.z = 0.02;
    leftLid.scale.set(1.15, 0.05, 1.05);
    leftEyeGroup.add(leftLid);

    const rightEyeGroup = new THREE.Group();
    rightEyeGroup.position.set(0.22, 0.86, 0.52);
    owlGroup.add(rightEyeGroup);

    const rightRing = new THREE.Mesh(eyeRingGeo, bellyMat);
    rightRing.rotation.x = Math.PI / 2;
    rightEyeGroup.add(rightRing);
    const rightPupil = new THREE.Mesh(pupilGeo, eyeDarkMat);
    rightPupil.position.z = 0.03;
    rightEyeGroup.add(rightPupil);
    const rightShine = new THREE.Mesh(shineGeo, eyeShineMat);
    rightShine.position.set(0.04, 0.045, 0.125);
    rightEyeGroup.add(rightShine);
    const rightLid = new THREE.Mesh(lidGeo, bodyMat);
    rightLid.position.z = 0.02;
    rightLid.scale.set(1.15, 0.05, 1.05);
    rightEyeGroup.add(rightLid);

    // Rosy Cheeks
    const cheekGeo = trackGeo(new THREE.SphereGeometry(0.08, 14, 12));
    const leftCheek = new THREE.Mesh(cheekGeo, cheekMat);
    leftCheek.scale.set(1.2, 0.75, 0.5);
    leftCheek.position.set(-0.36, 0.7, 0.5);
    owlGroup.add(leftCheek);

    const rightCheek = new THREE.Mesh(cheekGeo, cheekMat);
    rightCheek.scale.set(1.2, 0.75, 0.5);
    rightCheek.position.set(0.36, 0.7, 0.5);
    owlGroup.add(rightCheek);

    // Cute Rounded Beak
    const beakMesh = new THREE.Mesh(
      trackGeo(new THREE.ConeGeometry(0.095, 0.16, 18)),
      beakMat
    );
    beakMesh.rotation.x = Math.PI * 0.55;
    beakMesh.position.set(0, 0.73, 0.62);
    owlGroup.add(beakMesh);

    // Wings (pivot at shoulder)
    const wingGeo = trackGeo(new THREE.SphereGeometry(0.22, 18, 14));
    const leftWingPivot = new THREE.Group();
    leftWingPivot.position.set(-0.58, 0.68, 0.05);
    const leftWing = new THREE.Mesh(wingGeo, bodyMat);
    leftWing.scale.set(0.5, 1.45, 0.85);
    leftWing.position.set(-0.06, -0.14, 0);
    leftWing.rotation.z = 0.25;
    leftWingPivot.add(leftWing);
    owlGroup.add(leftWingPivot);

    const rightWingPivot = new THREE.Group();
    rightWingPivot.position.set(0.58, 0.68, 0.05);
    const rightWing = new THREE.Mesh(wingGeo, bodyMat);
    rightWing.scale.set(0.5, 1.45, 0.85);
    rightWing.position.set(0.06, -0.14, 0);
    rightWing.rotation.z = -0.25;
    rightWingPivot.add(rightWing);
    owlGroup.add(rightWingPivot);

    // Cute Feet
    const footGeo = trackGeo(new THREE.SphereGeometry(0.11, 14, 12));
    const leftFoot = new THREE.Mesh(footGeo, beakMat);
    leftFoot.scale.set(1.05, 0.55, 1.35);
    leftFoot.position.set(-0.22, 0.05, 0.22);
    owlGroup.add(leftFoot);

    const rightFoot = new THREE.Mesh(footGeo, beakMat);
    rightFoot.scale.set(1.05, 0.55, 1.35);
    rightFoot.position.set(0.22, 0.05, 0.22);
    owlGroup.add(rightFoot);

    // Navy OSIS Cap with Gold Pin Badge
    const capGroup = new THREE.Group();
    capGroup.position.set(0, 1.28, 0.04);
    capGroup.rotation.z = -0.06;
    owlGroup.add(capGroup);

    const capCrown = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(0.32, 0.36, 0.16, 24)),
      capNavyMat
    );
    capGroup.add(capCrown);

    const capVisor = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(0.36, 0.36, 0.035, 24, 1, false, -Math.PI * 0.45, Math.PI * 0.9)),
      capNavyMat
    );
    capVisor.position.set(0, -0.06, 0.14);
    capVisor.rotation.y = Math.PI / 2;
    capGroup.add(capVisor);

    const osisPin = new THREE.Mesh(
      trackGeo(new THREE.OctahedronGeometry(0.065, 0)),
      goldBadgeMat
    );
    osisPin.position.set(0, 0.02, 0.34);
    capGroup.add(osisPin);

    // 3. Floating Mini Clipboard & Pencil Props beside Piko
    const clipboardGroup = new THREE.Group();
    clipboardGroup.position.set(0.86, 0.62, 0.32);
    clipboardGroup.rotation.set(-0.18, -0.45, 0.12);
    rootGroup.add(clipboardGroup);

    const boardMesh = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.38, 0.5, 0.035)),
      boardMat
    );
    boardMesh.castShadow = true;
    clipboardGroup.add(boardMesh);

    const paperMesh = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.32, 0.41, 0.042)),
      paperMat
    );
    paperMesh.position.y = -0.02;
    clipboardGroup.add(paperMesh);

    const clipMetal = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.16, 0.07, 0.06)),
      goldBadgeMat
    );
    clipMetal.position.y = 0.23;
    clipboardGroup.add(clipMetal);

    // Pointer interaction
    const onPointerMove = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      _pointerVec.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      _pointerVec.y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    };

    const onClickCanvas = () => {
      hopImpulseRef.current = 1.0;
    };

    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('click', onClickCanvas);

    // Animation state & software-WebGL paced loop
    let frameId = 0;
    let disposed = false;
    let lastTimeMs = performance.now();
    const startTimeMs = lastTimeMs;
    let currentRotY = 0;
    let currentRotX = 0;
    let currentHopY = 0;
    let blinkTimer = 0;

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (!gl || typeof gl.fenceSync !== 'function') {
        frameId = window.setTimeout(cb, 90);
        return;
      }
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) return;
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 6);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 6);
    }

    function tick() {
      if (disposed) return;
      const nowMs = performance.now();
      const dt = Math.min((nowMs - lastTimeMs) / 1000, 0.08);
      lastTimeMs = nowMs;
      const elapsed = (nowMs - startTimeMs) / 1000;
      const activeMood = moodRef.current;

      // Decay hop impulse
      if (hopImpulseRef.current > 0.01) {
        hopImpulseRef.current = THREE.MathUtils.damp(hopImpulseRef.current, 0, 5.5, dt);
      } else {
        hopImpulseRef.current = 0;
      }

      const targetHop =
        activeMood === 'celebrate'
          ? Math.abs(Math.sin(elapsed * 4.5)) * 0.22 + hopImpulseRef.current * 0.28
          : hopImpulseRef.current * 0.34;
      currentHopY = THREE.MathUtils.damp(currentHopY, targetHop, 12, dt);

      // Gentle breathing bob
      const bobY = activeMood === 'locked' ? Math.sin(elapsed * 1.4) * 0.015 : Math.sin(elapsed * 2.6) * 0.03;
      owlGroup.position.y = 0.27 + currentHopY + bobY;

      // Look gently toward cursor
      const targetRotY = THREE.MathUtils.clamp(_pointerVec.x * 0.35, -0.45, 0.45);
      const targetRotX =
        activeMood === 'locked'
          ? 0.14
          : THREE.MathUtils.clamp(-_pointerVec.y * 0.16, -0.2, 0.2);

      currentRotY = THREE.MathUtils.damp(currentRotY, targetRotY, 6, dt);
      currentRotX = THREE.MathUtils.damp(currentRotX, targetRotX, 6, dt);
      owlGroup.rotation.y = currentRotY + (activeMood === 'celebrate' ? Math.sin(elapsed * 3) * 0.22 : 0);
      owlGroup.rotation.x = currentRotX;

      // Wing wave
      const wingWave =
        activeMood === 'celebrate'
          ? 0.55 + Math.sin(elapsed * 9) * 0.45
          : activeMood === 'recording'
            ? 0.16 + Math.sin(elapsed * 3.5) * 0.12
            : activeMood === 'locked'
              ? 0.04
              : 0.12 + Math.sin(elapsed * 2.1) * 0.08 + hopImpulseRef.current * 0.65;

      leftWingPivot.rotation.z = wingWave;
      rightWingPivot.rotation.z = -wingWave;

      // Blinking or sleepy eyelids when locked
      blinkTimer += dt;
      const isBlinking = (blinkTimer % 3.6) > 3.44;
      const lidScaleY = activeMood === 'locked' ? 0.62 : isBlinking ? 1.05 : 0.05;
      leftLid.scale.y = THREE.MathUtils.damp(leftLid.scale.y, lidScaleY, 18, dt);
      rightLid.scale.y = THREE.MathUtils.damp(rightLid.scale.y, lidScaleY, 18, dt);

      // Floating clipboard prop
      clipboardGroup.position.y = 0.62 + Math.sin(elapsed * 2.2 + 0.8) * 0.045;
      clipboardGroup.rotation.z = 0.12 + Math.sin(elapsed * 1.6) * 0.05;
      osisPin.rotation.y = elapsed * 1.2;

      renderer.render(scene, camera);

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    }

    // Handle container resize
    const handleResize = () => {
      if (!container || disposed) return;
      const nextW = Math.max(container.clientWidth, 160);
      const nextH = Math.max(container.clientHeight, 160);
      camera.aspect = nextW / nextH;
      camera.updateProjectionMatrix();
      renderer.setSize(nextW, nextH);
      renderer.render(scene, camera);
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('click', onClickCanvas);
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
      envTexture.dispose();
      renderer.dispose();
    };
  }, [compact]);

  const moodLabel =
    mood === 'celebrate'
      ? 'Piko senang! Sesi piket hari ini selesai & siap diekspor.'
      : mood === 'locked'
        ? 'Piko sedang istirahat — di luar jadwal piket Anda.'
        : mood === 'recording'
          ? 'Piko siaga menemani pencatatan piket hari ini.'
          : 'Halo! Klik Piko atau masuk dengan akun OSIS untuk mulai.';

  return (
    <div className="flex flex-col items-center">
      <div
        ref={mountRef}
        data-testid="mascot-3d-canvas"
        data-mood={mood}
        title="Klik Piko si Maskot OSIS!"
        className={`relative w-full cursor-pointer select-none ${
          compact ? 'h-44' : 'h-64 sm:h-72'
        }`}
      >
        {!webglReady && (
          <div className="flex h-full w-full items-center justify-center rounded-2xl bg-blue-50 text-sm font-medium text-blue-700">
            Maskot OSIS Piko
          </div>
        )}
      </div>
      {caption !== undefined ? (
        <p className="mt-1 text-center text-xs text-slate-500">{caption}</p>
      ) : (
        <p className="mt-1 text-center text-xs text-slate-500">{moodLabel}</p>
      )}
    </div>
  );
}
