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

const INTERACTIVE_TIPS: Record<MascotMood, string[]> = {
  idle: [
    'Halo! Klik Piko atau masuk dengan akun OSIS untuk mulai.',
    'Tips: Ketik beberapa huruf nama siswa — kelas terisi otomatis.',
    'Semangat bertugas! Piko siap menemani piket pagi hari ini.',
  ],
  recording: [
    'Piko siaga menemani pencatatan piket hari ini.',
    'Tips: Pilih kategori A–F dulu supaya daftar aturan langsung rapi.',
    'Jangan lupa tekan Selesai setelah jam piket selesai agar laporan terbuka!',
  ],
  locked: [
    'Piko sedang istirahat — di luar jadwal piket Anda.',
    'Anda tetap bisa melihat Rekap Siswa dan Arsip Piket kapan saja.',
  ],
  celebrate: [
    'Yeay! Semua petugas sudah Selesai. Laporan Excel & PDF siap diunduh!',
    'Terima kasih sudah menjaga ketertiban SMA Negeri 1 Kemangkon hari ini!',
  ],
};

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
  const spinImpulseRef = useRef<number>(0);
  const [webglReady, setWebglReady] = useState(true);
  const [tipIndex, setTipIndex] = useState(0);

  useEffect(() => {
    moodRef.current = mood;
    setTipIndex(0);
    if (mood === 'celebrate') {
      hopImpulseRef.current = 1.0;
      spinImpulseRef.current = Math.PI * 2;
    }
  }, [mood]);

  useEffect(() => {
    if (triggerPulse > 0) {
      hopImpulseRef.current = 0.95;
      spinImpulseRef.current = Math.PI * 2;
    }
  }, [triggerPulse]);

  function triggerMascotInteraction() {
    hopImpulseRef.current = 1.0;
    spinImpulseRef.current = Math.PI * 2;
    setTipIndex((prev) => prev + 1);
  }

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
    const pencilMat = trackMat(
      new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.45, metalness: 0.05 })
    );
    const eraserMat = trackMat(
      new THREE.MeshStandardMaterial({ color: 0xfb7185, roughness: 0.65, metalness: 0.0 })
    );

    const rootGroup = new THREE.Group();
    scene.add(rootGroup);

    // 1. Ceramic/Wood Desk Pedestal
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

    const bodyMesh = new THREE.Mesh(
      trackGeo(new THREE.SphereGeometry(0.62, 32, 24)),
      bodyMat
    );
    bodyMesh.scale.set(1.02, 1.08, 0.96);
    bodyMesh.position.y = 0.66;
    bodyMesh.castShadow = true;
    owlGroup.add(bodyMesh);

    const bellyMesh = new THREE.Mesh(
      trackGeo(new THREE.SphereGeometry(0.46, 28, 20)),
      bellyMat
    );
    bellyMesh.scale.set(0.92, 0.96, 0.55);
    bellyMesh.position.set(0, 0.56, 0.36);
    owlGroup.add(bellyMesh);

    // Cute Ear Tufts
    const tuftGeo = trackGeo(new THREE.ConeGeometry(0.14, 0.28, 16));
    const leftTuft = new THREE.Mesh(tuftGeo, bodyMat);
    leftTuft.position.set(-0.42, 1.24, 0.05);
    leftTuft.rotation.z = 0.42;
    owlGroup.add(leftTuft);

    const rightTuft = new THREE.Mesh(tuftGeo, bodyMat);
    rightTuft.position.set(0.42, 1.24, 0.05);
    rightTuft.rotation.z = -0.42;
    owlGroup.add(rightTuft);

    // Face / Eyes
    const eyeRingGeo = trackGeo(new THREE.CylinderGeometry(0.21, 0.21, 0.06, 24));
    const pupilGeo = trackGeo(new THREE.SphereGeometry(0.115, 20, 16));
    const shineGeo = trackGeo(new THREE.SphereGeometry(0.036, 12, 10));
    const lidGeo = trackGeo(
      new THREE.SphereGeometry(0.14, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2)
    );

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

    // Beak
    const beakMesh = new THREE.Mesh(
      trackGeo(new THREE.ConeGeometry(0.095, 0.16, 18)),
      beakMat
    );
    beakMesh.rotation.x = Math.PI * 0.55;
    beakMesh.position.set(0, 0.73, 0.62);
    owlGroup.add(beakMesh);

    // Wings
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
      trackGeo(
        new THREE.CylinderGeometry(0.36, 0.36, 0.035, 24, 1, false, -Math.PI * 0.45, Math.PI * 0.9)
      ),
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

    // 3. Floating Mini Clipboard (right) + Cute Pencil (left)
    const clipboardGroup = new THREE.Group();
    clipboardGroup.position.set(0.88, 0.62, 0.32);
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

    const pencilGroup = new THREE.Group();
    pencilGroup.position.set(-0.92, 0.64, 0.3);
    pencilGroup.rotation.set(0.18, 0.2, 0.42);
    rootGroup.add(pencilGroup);

    const pencilShaft = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(0.036, 0.036, 0.42, 12)),
      pencilMat
    );
    pencilShaft.castShadow = true;
    pencilGroup.add(pencilShaft);

    const pencilTip = new THREE.Mesh(
      trackGeo(new THREE.ConeGeometry(0.036, 0.1, 12)),
      deskWoodMat
    );
    pencilTip.position.y = -0.26;
    pencilTip.rotation.z = Math.PI;
    pencilGroup.add(pencilTip);

    const pencilEraser = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(0.038, 0.038, 0.06, 12)),
      eraserMat
    );
    pencilEraser.position.y = 0.24;
    pencilGroup.add(pencilEraser);

    // 4. Celebration / Interactive Star Sparkles (shown during celebrate or click burst)
    const starGroup = new THREE.Group();
    rootGroup.add(starGroup);
    const starGeo = trackGeo(new THREE.OctahedronGeometry(0.065, 0));
    const starMeshes: THREE.Mesh[] = [];
    for (let i = 0; i < 4; i++) {
      const star = new THREE.Mesh(starGeo, goldBadgeMat);
      star.scale.setScalar(0.01);
      starGroup.add(star);
      starMeshes.push(star);
    }

    // Pointer interaction
    const onPointerMove = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      _pointerVec.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      _pointerVec.y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    };

    const onClickCanvas = () => {
      triggerMascotInteraction();
    };

    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('click', onClickCanvas);

    let frameId = 0;
    let disposed = false;
    let lastTimeMs = performance.now();
    const startTimeMs = lastTimeMs;
    let currentRotY = 0;
    let currentRotX = 0;
    let currentHopY = 0;
    let currentSpinY = 0;
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

      if (hopImpulseRef.current > 0.01) {
        hopImpulseRef.current = THREE.MathUtils.damp(hopImpulseRef.current, 0, 5.2, dt);
      } else {
        hopImpulseRef.current = 0;
      }

      if (spinImpulseRef.current > 0.02) {
        const nextSpin = THREE.MathUtils.damp(spinImpulseRef.current, 0, 6.0, dt);
        currentSpinY += spinImpulseRef.current - nextSpin;
        spinImpulseRef.current = nextSpin;
      } else {
        spinImpulseRef.current = 0;
        currentSpinY = currentSpinY % (Math.PI * 2);
        currentSpinY = THREE.MathUtils.damp(currentSpinY, 0, 10, dt);
      }

      const targetHop =
        activeMood === 'celebrate'
          ? Math.abs(Math.sin(elapsed * 4.5)) * 0.22 + hopImpulseRef.current * 0.28
          : hopImpulseRef.current * 0.36;
      currentHopY = THREE.MathUtils.damp(currentHopY, targetHop, 12, dt);

      const bobY =
        activeMood === 'locked' ? Math.sin(elapsed * 1.4) * 0.015 : Math.sin(elapsed * 2.6) * 0.03;
      owlGroup.position.y = 0.27 + currentHopY + bobY;

      // Subtle contact shadow scaling when Piko hops
      const shadowScale = Math.max(0.65, 1 - currentHopY * 0.7);
      shadowDisc.scale.set(shadowScale, shadowScale, 1);

      const targetRotY = THREE.MathUtils.clamp(_pointerVec.x * 0.35, -0.45, 0.45);
      const targetRotX =
        activeMood === 'locked'
          ? 0.14
          : THREE.MathUtils.clamp(-_pointerVec.y * 0.16, -0.2, 0.2);

      currentRotY = THREE.MathUtils.damp(currentRotY, targetRotY, 6, dt);
      currentRotX = THREE.MathUtils.damp(currentRotX, targetRotX, 6, dt);
      owlGroup.rotation.y =
        currentRotY + currentSpinY + (activeMood === 'celebrate' ? Math.sin(elapsed * 3) * 0.22 : 0);
      owlGroup.rotation.x = currentRotX;

      const wingWave =
        activeMood === 'celebrate'
          ? 0.55 + Math.sin(elapsed * 9) * 0.45
          : activeMood === 'recording'
            ? 0.16 + Math.sin(elapsed * 3.5) * 0.12 + hopImpulseRef.current * 0.65
            : activeMood === 'locked'
              ? 0.04 + hopImpulseRef.current * 0.45
              : 0.12 + Math.sin(elapsed * 2.1) * 0.08 + hopImpulseRef.current * 0.72;

      leftWingPivot.rotation.z = wingWave;
      rightWingPivot.rotation.z = -wingWave;

      // Ear tuft wiggle on hop
      leftTuft.rotation.z = 0.42 + hopImpulseRef.current * 0.18;
      rightTuft.rotation.z = -0.42 - hopImpulseRef.current * 0.18;

      blinkTimer += dt;
      const isBlinking = blinkTimer % 3.6 > 3.44;
      const lidScaleY = activeMood === 'locked' ? 0.62 : isBlinking ? 1.05 : 0.05;
      leftLid.scale.y = THREE.MathUtils.damp(leftLid.scale.y, lidScaleY, 18, dt);
      rightLid.scale.y = THREE.MathUtils.damp(rightLid.scale.y, lidScaleY, 18, dt);

      clipboardGroup.position.y = 0.62 + Math.sin(elapsed * 2.2 + 0.8) * 0.045;
      clipboardGroup.rotation.z = 0.12 + Math.sin(elapsed * 1.6) * 0.05;
      pencilGroup.position.y = 0.64 + Math.sin(elapsed * 2.4 + 2.2) * 0.045;
      pencilGroup.rotation.z = 0.42 + Math.cos(elapsed * 1.8) * 0.06;
      osisPin.rotation.y = elapsed * 1.2;

      // Orbit celebratory star sparkles
      const showStars = activeMood === 'celebrate' || hopImpulseRef.current > 0.12;
      const targetStarScale = showStars
        ? activeMood === 'celebrate'
          ? 0.95
          : Math.min(1, hopImpulseRef.current * 1.4)
        : 0.001;
      starMeshes.forEach((star, idx) => {
        const angle = elapsed * 2.4 + (idx * Math.PI * 2) / starMeshes.length;
        star.position.set(
          Math.cos(angle) * 0.95,
          1.45 + Math.sin(elapsed * 3.5 + idx) * 0.14,
          Math.sin(angle) * 0.65
        );
        star.rotation.y = elapsed * 2.5 + idx;
        star.rotation.x = elapsed * 1.8;
        const s = THREE.MathUtils.damp(star.scale.x, targetStarScale, 12, dt);
        star.scale.setScalar(s);
      });

      renderer.render(scene, camera);

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    }

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

  const tips = INTERACTIVE_TIPS[mood];
  const activeTip = tips[tipIndex % tips.length];
  const displayCaption = tipIndex > 0 ? activeTip : (caption ?? activeTip);

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
      <div className="mt-1.5 flex flex-col items-center gap-1.5 px-2 text-center">
        <p className="text-xs leading-relaxed text-slate-600">{displayCaption}</p>
        <button
          type="button"
          onClick={triggerMascotInteraction}
          className="rounded-lg border border-sky-200/80 bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-blue-700 transition-all hover:border-blue-300 hover:bg-white active:scale-95"
        >
          Sapa Piko
        </button>
      </div>
    </div>
  );
}
