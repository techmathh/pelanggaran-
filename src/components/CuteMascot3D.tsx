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
const _tempMatrix = new THREE.Matrix4();
const _tempPos = new THREE.Vector3();
const _tempQuat = new THREE.Quaternion();
const _tempEuler = new THREE.Euler();
const _tempScale = new THREE.Vector3();
const _targetRimColor = new THREE.Color();
const _targetRingColor = new THREE.Color();

const CONFETTI_COUNT = 16;

const INTERACTIVE_TIPS: Record<MascotMood, string[]> = {
  idle: [
    'Halo! Geser Piko untuk putar 3D atau klik untuk menyapa.',
    'Tips: Ketik beberapa huruf nama siswa — kelas terisi otomatis.',
    'Semangat bertugas! Piko siap menemani piket pagi hari ini.',
  ],
  recording: [
    'Piko siaga menemani pencatatan piket hari ini.',
    'Tips: Pilih kategori A–F dulu supaya daftar aturan langsung rapi.',
    'Spreadsheet akan otomatis ditutup & siap diunduh sesuai jam selesai yang diatur.',
  ],
  locked: [
    'Piko sedang istirahat — di luar jadwal piket Anda.',
    'Anda tetap bisa melihat Rekap Siswa dan Arsip Piket kapan saja.',
  ],
  celebrate: [
    'Yeay! Sesi hari ini telah ditutup otomatis. Laporan Excel & PDF siap diunduh!',
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
  const confettiBurstRef = useRef<number>(0);
  const [webglReady, setWebglReady] = useState(true);
  const [tipIndex, setTipIndex] = useState(0);

  useEffect(() => {
    moodRef.current = mood;
    setTipIndex(0);
    if (mood === 'celebrate') {
      hopImpulseRef.current = 1.0;
      spinImpulseRef.current = Math.PI * 2;
      confettiBurstRef.current += 1;
    }
  }, [mood]);

  useEffect(() => {
    if (triggerPulse > 0) {
      hopImpulseRef.current = 0.95;
      spinImpulseRef.current = Math.PI * 2;
      confettiBurstRef.current += 1;
    }
  }, [triggerPulse]);

  function triggerMascotInteraction() {
    hopImpulseRef.current = 1.0;
    spinImpulseRef.current = Math.PI * 2;
    confettiBurstRef.current += 1;
    setTipIndex((prev) => prev + 1);
  }

  function triggerOrbitSpin() {
    spinImpulseRef.current = Math.PI * 2;
    hopImpulseRef.current = Math.max(hopImpulseRef.current, 0.45);
  }

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
    renderer.domElement.style.touchAction = 'pan-y';

    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const envTexture = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTexture;
    pmremGenerator.dispose();

    const camera = new THREE.PerspectiveCamera(34, width / height, 0.1, 40);
    camera.position.set(0, 1.48, compact ? 4.45 : 4.25);
    camera.lookAt(0, 0.72, 0);

    // 3-point balanced studio lighting with mood-reactive rim light
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

    const rimLight = new THREE.DirectionalLight(0x93c5fd, 1.05);
    rimLight.position.set(-3.0, 2.6, -2.8);
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
      new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.42, metalness: 0.06 })
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
        emissiveIntensity: 0.65,
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
    const haloRingMat = trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x60a5fa,
        emissive: 0x2563eb,
        emissiveIntensity: 0.45,
        roughness: 0.22,
        metalness: 0.55,
        transparent: true,
        opacity: 0.82,
      })
    );
    const clockBodyMat = trackMat(
      new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.3, metalness: 0.6 })
    );
    const clockFaceMat = trackMat(
      new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.4, metalness: 0.05 })
    );
    const clockHandMat = trackMat(
      new THREE.MeshStandardMaterial({ color: 0x2563eb, roughness: 0.3, metalness: 0.2 })
    );

    const rootGroup = new THREE.Group();
    scene.add(rootGroup);

    // 1. Ceramic/Wood Desk Pedestal + Orbital 3D Halo Ring
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

    const haloRingPivot = new THREE.Group();
    haloRingPivot.position.y = 0.28;
    haloRingPivot.rotation.set(0.06, 0, -0.04);
    rootGroup.add(haloRingPivot);

    const haloRing = new THREE.Mesh(
      trackGeo(new THREE.TorusGeometry(1.24, 0.022, 12, 56)),
      haloRingMat
    );
    haloRing.rotation.x = Math.PI / 2;
    haloRingPivot.add(haloRing);

    // Subtle orbiting jewel nodes on the halo ring
    const orbNodeGeo = trackGeo(new THREE.OctahedronGeometry(0.048, 0));
    const orbNode1 = new THREE.Mesh(orbNodeGeo, goldBadgeMat);
    orbNode1.position.set(1.24, 0, 0);
    haloRingPivot.add(orbNode1);
    const orbNode2 = new THREE.Mesh(orbNodeGeo, goldBadgeMat);
    orbNode2.position.set(-1.24, 0, 0);
    haloRingPivot.add(orbNode2);

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

    // 3. Floating Mini Clipboard (right) + Cute Pencil (left) + 3D Desk Clock (front-left)
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
    pencilGroup.position.set(-0.95, 0.78, 0.26);
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

    // 3D Miniature Desk Clock Prop (reflects automatic schedule timing)
    const clockGroup = new THREE.Group();
    clockGroup.position.set(-0.72, 0.43, 0.58);
    clockGroup.rotation.set(-0.18, 0.38, 0);
    clockGroup.scale.setScalar(0.84);
    rootGroup.add(clockGroup);

    const clockBody = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(0.15, 0.15, 0.055, 24)),
      clockBodyMat
    );
    clockBody.rotation.x = Math.PI / 2;
    clockBody.castShadow = true;
    clockGroup.add(clockBody);

    const clockFace = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(0.125, 0.125, 0.06, 24)),
      clockFaceMat
    );
    clockFace.rotation.x = Math.PI / 2;
    clockGroup.add(clockFace);

    const minuteHandPivot = new THREE.Group();
    minuteHandPivot.position.z = 0.036;
    clockGroup.add(minuteHandPivot);
    const minuteHand = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.015, 0.085, 0.01)),
      clockHandMat
    );
    minuteHand.position.y = 0.035;
    minuteHandPivot.add(minuteHand);

    const hourHandPivot = new THREE.Group();
    hourHandPivot.position.z = 0.039;
    clockGroup.add(hourHandPivot);
    const hourHand = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.018, 0.058, 0.01)),
      beakMat
    );
    hourHand.position.y = 0.022;
    hourHandPivot.add(hourHand);

    // 4. Orbiting Star Sparkles (celebrate or hop)
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

    // 5. InstancedMesh 3D Confetti Burst Fountain (single draw call, zero GC in tick)
    const confettiGeo = trackGeo(new THREE.OctahedronGeometry(0.052, 0));
    const confettiMat = trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.25,
        metalness: 0.45,
      })
    );
    const confettiMesh = new THREE.InstancedMesh(confettiGeo, confettiMat, CONFETTI_COUNT);
    confettiMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    rootGroup.add(confettiMesh);

    const confettiPalette = [
      new THREE.Color(0x3b82f6),
      new THREE.Color(0xfbbf24),
      new THREE.Color(0x10b981),
      new THREE.Color(0xf472b6),
      new THREE.Color(0x38bdf8),
    ];
    for (let i = 0; i < CONFETTI_COUNT; i++) {
      confettiMesh.setColorAt(i, confettiPalette[i % confettiPalette.length]);
    }
    if (confettiMesh.instanceColor) confettiMesh.instanceColor.needsUpdate = true;

    const pX = new Float32Array(CONFETTI_COUNT);
    const pY = new Float32Array(CONFETTI_COUNT);
    const pZ = new Float32Array(CONFETTI_COUNT);
    const vX = new Float32Array(CONFETTI_COUNT);
    const vY = new Float32Array(CONFETTI_COUNT);
    const vZ = new Float32Array(CONFETTI_COUNT);
    const pLife = new Float32Array(CONFETTI_COUNT);
    const pSpin = new Float32Array(CONFETTI_COUNT);

    function spawnConfettiBurst() {
      for (let i = 0; i < CONFETTI_COUNT; i++) {
        const angle = (i / CONFETTI_COUNT) * Math.PI * 2 + (i % 3) * 0.22;
        const speed = 1.2 + (i % 4) * 0.35;
        pX[i] = Math.cos(angle) * 0.22;
        pY[i] = 1.05;
        pZ[i] = Math.sin(angle) * 0.22;
        vX[i] = Math.cos(angle) * speed;
        vY[i] = 2.0 + (i % 5) * 0.38;
        vZ[i] = Math.sin(angle) * speed;
        pLife[i] = 1.0;
        pSpin[i] = (i % 2 === 0 ? 1 : -1) * (4.5 + (i % 3) * 2.0);
      }
    }

    // Drag-to-rotate 360° orbit + hover look-at + click hop interaction
    let isDragging = false;
    let dragDistance = 0;
    let dragStartX = 0;
    let dragStartY = 0;
    let lastDragX = 0;
    let lastDragY = 0;
    let userOrbitYaw = 0;
    let userOrbitPitch = 0;
    let seenConfettiVersion = confettiBurstRef.current;

    const onPointerDown = (e: PointerEvent) => {
      isDragging = true;
      dragDistance = 0;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      lastDragX = e.clientX;
      lastDragY = e.clientY;
      renderer.domElement.style.cursor = 'grabbing';
    };

    const onPointerMove = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      _pointerVec.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      _pointerVec.y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);

      if (isDragging) {
        const dx = e.clientX - lastDragX;
        const dy = e.clientY - lastDragY;
        dragDistance = Math.hypot(e.clientX - dragStartX, e.clientY - dragStartY);
        userOrbitYaw += dx * 0.012;
        userOrbitPitch = THREE.MathUtils.clamp(userOrbitPitch + dy * 0.006, -0.26, 0.32);
        lastDragX = e.clientX;
        lastDragY = e.clientY;
      }
    };

    const onPointerUpOrCancel = () => {
      if (!isDragging) return;
      isDragging = false;
      renderer.domElement.style.cursor = 'grab';
      if (dragDistance < 6) {
        triggerMascotInteraction();
      }
    };

    const onContextLost = (ev: Event) => {
      ev.preventDefault();
      setWebglReady(false);
    };
    const onContextRestored = () => {
      setWebglReady(true);
    };

    renderer.domElement.style.cursor = 'grab';
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUpOrCancel);
    window.addEventListener('pointercancel', onPointerUpOrCancel);
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', onContextRestored);

    let frameId = 0;
    let disposed = false;
    let lastTimeMs = performance.now();
    const startTimeMs = lastTimeMs;
    let currentRotY = 0;
    let currentRotX = 0;
    let currentHopY = 0;
    let prevHopY = 0;
    let currentSpinY = 0;
    let squashY = 1;
    let blinkTimer = 0;
    let celebrateTimer = 0;

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
      const elapsed = prefersReducedMotion ? 0 : (nowMs - startTimeMs) / 1000;
      const activeMood = moodRef.current;

      if (confettiBurstRef.current !== seenConfettiVersion) {
        seenConfettiVersion = confettiBurstRef.current;
        if (!prefersReducedMotion) spawnConfettiBurst();
      }

      if (activeMood === 'celebrate' && !prefersReducedMotion) {
        celebrateTimer += dt;
        if (celebrateTimer > 2.4) {
          celebrateTimer = 0;
          spawnConfettiBurst();
        }
      } else {
        celebrateTimer = 0;
      }

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

      const targetHop = prefersReducedMotion
        ? 0
        : activeMood === 'celebrate'
          ? Math.abs(Math.sin(elapsed * 4.5)) * 0.22 + hopImpulseRef.current * 0.28
          : hopImpulseRef.current * 0.36;
      prevHopY = currentHopY;
      currentHopY = THREE.MathUtils.damp(currentHopY, targetHop, 12, dt);

      // Volume-preserving squash & stretch based on hop velocity
      const hopVel = (currentHopY - prevHopY) / Math.max(dt, 0.008);
      const targetSquash = prefersReducedMotion
        ? 1
        : THREE.MathUtils.clamp(1 + hopVel * 0.085, 0.88, 1.15);
      squashY = THREE.MathUtils.damp(squashY, targetSquash, 16, dt);
      const squashXZ = 1 / Math.sqrt(squashY);
      owlGroup.scale.set(squashXZ, squashY, squashXZ);

      const bobY = prefersReducedMotion
        ? 0
        : activeMood === 'locked'
          ? Math.sin(elapsed * 1.4) * 0.015
          : Math.sin(elapsed * 2.6) * 0.03;
      owlGroup.position.y = 0.27 + currentHopY + bobY;

      // Smooth drag-to-orbit return damping when pointer released
      if (!isDragging) {
        userOrbitYaw = THREE.MathUtils.damp(userOrbitYaw, 0, 2.2, dt);
        userOrbitPitch = THREE.MathUtils.damp(userOrbitPitch, 0, 3.0, dt);
      }
      rootGroup.rotation.y = userOrbitYaw;
      rootGroup.rotation.x = userOrbitPitch;

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
        currentRotY +
        currentSpinY +
        (activeMood === 'celebrate' && !prefersReducedMotion ? Math.sin(elapsed * 3) * 0.22 : 0);
      owlGroup.rotation.x = currentRotX;

      const wingWave = prefersReducedMotion
        ? 0.12
        : activeMood === 'celebrate'
          ? 0.55 + Math.sin(elapsed * 9) * 0.45
          : activeMood === 'recording'
            ? 0.16 + Math.sin(elapsed * 3.5) * 0.12 + hopImpulseRef.current * 0.65
            : activeMood === 'locked'
              ? 0.04 + hopImpulseRef.current * 0.45
              : 0.12 + Math.sin(elapsed * 2.1) * 0.08 + hopImpulseRef.current * 0.72;

      leftWingPivot.rotation.z = wingWave;
      rightWingPivot.rotation.z = -wingWave;

      // Ear tuft wiggle on hop
      leftTuft.rotation.z = 0.42 + hopImpulseRef.current * 0.2;
      rightTuft.rotation.z = -0.42 - hopImpulseRef.current * 0.2;

      blinkTimer += dt;
      const isBlinking = !prefersReducedMotion && blinkTimer % 3.6 > 3.44;
      const lidScaleY = activeMood === 'locked' ? 0.62 : isBlinking ? 1.05 : 0.05;
      leftLid.scale.y = THREE.MathUtils.damp(leftLid.scale.y, lidScaleY, 18, dt);
      rightLid.scale.y = THREE.MathUtils.damp(rightLid.scale.y, lidScaleY, 18, dt);

      clipboardGroup.position.y = 0.62 + Math.sin(elapsed * 2.2 + 0.8) * 0.045;
      clipboardGroup.rotation.z = 0.12 + Math.sin(elapsed * 1.6) * 0.05;
      pencilGroup.position.y = 0.78 + Math.sin(elapsed * 2.4 + 2.2) * 0.045;
      pencilGroup.rotation.z = 0.42 + Math.cos(elapsed * 1.8) * 0.06;
      osisPin.rotation.y = elapsed * 1.4;

      // Desk clock gentle hover & hand ticking
      clockGroup.position.y = 0.43 + Math.sin(elapsed * 1.9 + 1.2) * 0.02;
      minuteHandPivot.rotation.z = -elapsed * (activeMood === 'recording' ? 0.9 : 0.25);
      hourHandPivot.rotation.z = -elapsed * (activeMood === 'recording' ? 0.12 : 0.04);

      // Mood-reactive orbital halo ring & rim lighting
      haloRingPivot.rotation.y = elapsed * (activeMood === 'celebrate' ? 1.1 : 0.42);
      haloRingPivot.position.y = 0.29 + Math.sin(elapsed * 1.7) * 0.015;
      if (activeMood === 'celebrate') {
        _targetRimColor.setHex(0xfbbf24);
        _targetRingColor.setHex(0xf59e0b);
      } else if (activeMood === 'recording') {
        _targetRimColor.setHex(0x60a5fa);
        _targetRingColor.setHex(0x3b82f6);
      } else if (activeMood === 'locked') {
        _targetRimColor.setHex(0x94a3b8);
        _targetRingColor.setHex(0x94a3b8);
      } else {
        _targetRimColor.setHex(0x93c5fd);
        _targetRingColor.setHex(0x38bdf8);
      }
      rimLight.color.lerp(_targetRimColor, Math.min(1, dt * 4));
      haloRingMat.color.lerp(_targetRingColor, Math.min(1, dt * 4));
      haloRingMat.emissive.lerp(_targetRingColor, Math.min(1, dt * 4));

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

      // Update InstancedMesh 3D confetti fountain
      let anyParticleAlive = false;
      for (let i = 0; i < CONFETTI_COUNT; i++) {
        if (pLife[i] > 0.01) {
          anyParticleAlive = true;
          vY[i] -= 4.8 * dt;
          pX[i] += vX[i] * dt;
          pY[i] += vY[i] * dt;
          pZ[i] += vZ[i] * dt;
          pLife[i] = Math.max(0, pLife[i] - dt * 0.92);

          const scale = Math.max(0.001, Math.sin(pLife[i] * Math.PI) * 1.15);
          _tempPos.set(pX[i], pY[i], pZ[i]);
          _tempEuler.set(elapsed * pSpin[i], elapsed * pSpin[i] * 0.8, 0);
          _tempQuat.setFromEuler(_tempEuler);
          _tempScale.setScalar(scale);
          _tempMatrix.compose(_tempPos, _tempQuat, _tempScale);
          confettiMesh.setMatrixAt(i, _tempMatrix);
        } else {
          _tempPos.set(0, -10, 0);
          _tempQuat.identity();
          _tempScale.setScalar(0.0001);
          _tempMatrix.compose(_tempPos, _tempQuat, _tempScale);
          confettiMesh.setMatrixAt(i, _tempMatrix);
        }
      }
      confettiMesh.visible = anyParticleAlive;
      if (anyParticleAlive) {
        confettiMesh.instanceMatrix.needsUpdate = true;
      }

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
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUpOrCancel);
      window.removeEventListener('pointercancel', onPointerUpOrCancel);
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', onContextRestored);
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
        title="Geser untuk putar 3D atau klik Piko!"
        className={`relative w-full select-none ${
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
        <div className="flex flex-wrap items-center justify-center gap-1.5">
          <button
            type="button"
            onClick={triggerMascotInteraction}
            className="card-3d-interactive rounded-lg border border-sky-200/80 bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-blue-700 hover:border-blue-300 hover:bg-white whitespace-nowrap"
          >
            Sapa Piko
          </button>
          <button
            type="button"
            onClick={triggerOrbitSpin}
            className="card-3d-interactive rounded-lg border border-slate-200/90 bg-white/80 px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:border-slate-300 hover:text-slate-900 whitespace-nowrap"
          >
            Putar 360°
          </button>
        </div>
      </div>
    </div>
  );
}
