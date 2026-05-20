import { Crosshair, Gauge, Gem, Mountain, Pickaxe, RotateCcw, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

type Block = {
  key: string;
  x: number;
  y: number;
  z: number;
  kind: "soil" | "stone" | "ore" | "crystal";
};

type GameStats = {
  depth: number;
  blocks: number;
  ore: number;
  crystals: number;
  combo: number;
  energy: number;
};

const WORLD_RADIUS = 7;
const WORLD_DEPTH = 38;
const PLAYER_HEIGHT = 1.62;
const EYE_REACH = 3.6;
const COMBO_WINDOW_MS = 1450;

function blockKey(x: number, y: number, z: number) {
  return `${x}:${y}:${z}`;
}

function seededNoise(x: number, y: number, z: number) {
  const value = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return value - Math.floor(value);
}

function makeWorld() {
  const blocks = new Map<string, Block>();

  for (let y = 0; y > -WORLD_DEPTH; y -= 1) {
    for (let x = -WORLD_RADIUS; x <= WORLD_RADIUS; x += 1) {
      for (let z = -WORLD_RADIUS; z <= WORLD_RADIUS; z += 1) {
        const edge = Math.max(Math.abs(x), Math.abs(z));
        const tunnelHint = Math.abs(x) <= 1 && Math.abs(z) <= 1 && y > -3;
        const roughEdge = seededNoise(x, y, z) > 0.94 && edge > WORLD_RADIUS - 2;

        if (tunnelHint || roughEdge) continue;

        const crystalChance = y < -17 && seededNoise(x + 9, y - 6, z + 11) > 0.986;
        const oreChance = y < -7 && seededNoise(x + 4, y - 11, z + 2) > 0.965;
        const stoneChance = y < -9 && seededNoise(x - 3, y + 8, z - 9) > 0.72;
        const kind = crystalChance ? "crystal" : oreChance ? "ore" : stoneChance ? "stone" : "soil";
        const key = blockKey(x, y, z);
        blocks.set(key, { key, x, y, z, kind });
      }
    }
  }

  return blocks;
}

function blockColor(kind: Block["kind"], y: number) {
  if (kind === "crystal") return new THREE.Color("#62f0ff").offsetHSL(0, 0.06, y * -0.001);
  if (kind === "ore") return new THREE.Color("#f6c65b");
  if (kind === "stone") return new THREE.Color("#63615d").offsetHSL(0, 0, y * -0.002);
  return new THREE.Color("#8a5a38").offsetHSL(0.02, -0.02, y * -0.003);
}

function blockLabel(kind: Block["kind"]) {
  if (kind === "crystal") return "수정 동굴";
  if (kind === "ore") return "금맥";
  if (kind === "stone") return "단단한 암반";
  return "흙";
}

function nextGoal(stats: GameStats) {
  if (stats.depth < 8) return "8m까지 내려가 첫 금맥을 찾아보세요";
  if (stats.ore < 4) return "금맥 4개를 모아 램프를 밝히세요";
  if (stats.depth < 18) return "18m 아래 수정층까지 길을 뚫으세요";
  if (stats.crystals < 2) return "수정 2개를 캐면 에너지가 크게 회복됩니다";
  return "더 깊이 내려가 최고 기록을 갱신하세요";
}

const initialStats: GameStats = {
  depth: 0,
  blocks: 0,
  ore: 0,
  crystals: 0,
  combo: 0,
  energy: 100,
};

export function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<{
    blocks: Map<string, Block>;
    camera: THREE.PerspectiveCamera;
    scene: THREE.Scene;
    renderer: THREE.WebGLRenderer;
    group: THREE.Group;
    keys: Set<string>;
    velocity: THREE.Vector3;
    particles: Array<{
      mesh: THREE.Mesh;
      velocity: THREE.Vector3;
      life: number;
      maxLife: number;
    }>;
    lastMineAt: number;
    yaw: number;
    pitch: number;
    stats: GameStats;
    active: boolean;
  } | null>(null);
  const [stats, setStats] = useState<GameStats>(initialStats);
  const [isLocked, setIsLocked] = useState(false);
  const [toast, setToast] = useState("아래로 파고들수록 희귀한 광맥이 나옵니다");
  const [resetSeed, setResetSeed] = useState(0);
  const goalText = nextGoal(stats);

  const materialMap = useMemo(
    () => ({
      soil: new THREE.MeshStandardMaterial({ color: "#8a5a38", roughness: 0.95 }),
      stone: new THREE.MeshStandardMaterial({ color: "#66625c", roughness: 0.9 }),
      ore: new THREE.MeshStandardMaterial({
        color: "#f6c65b",
        emissive: "#503800",
        emissiveIntensity: 0.18,
        roughness: 0.62,
      }),
      crystal: new THREE.MeshStandardMaterial({
        color: "#62f0ff",
        emissive: "#0f6a77",
        emissiveIntensity: 0.42,
        roughness: 0.38,
      }),
    }),
    [],
  );

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const host = mount;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#17130f");
    scene.fog = new THREE.FogExp2("#17130f", 0.045);

    const camera = new THREE.PerspectiveCamera(74, host.clientWidth / host.clientHeight, 0.1, 90);
    camera.position.set(0, PLAYER_HEIGHT, 4.8);

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    host.appendChild(renderer.domElement);

    const ambient = new THREE.HemisphereLight("#d8c29e", "#24190f", 1.75);
    scene.add(ambient);

    const lamp = new THREE.PointLight("#ffd08a", 14, 13, 1.55);
    lamp.castShadow = true;
    scene.add(lamp);

    const pickLight = new THREE.SpotLight("#fff2cf", 16, 12, Math.PI / 6, 0.5, 1);
    scene.add(pickLight);

    const group = new THREE.Group();
    scene.add(group);

    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const chipGeometry = new THREE.TetrahedronGeometry(0.08, 0);
    const edgeGeometry = new THREE.EdgesGeometry(geometry);
    const edgesMaterial = new THREE.LineBasicMaterial({ color: "#20150d", transparent: true, opacity: 0.28 });
    const chipMaterials = {
      soil: new THREE.MeshStandardMaterial({ color: "#b9784a", roughness: 0.8 }),
      stone: new THREE.MeshStandardMaterial({ color: "#a6a29a", roughness: 0.8 }),
      ore: new THREE.MeshStandardMaterial({ color: "#ffd76b", emissive: "#5a3800", emissiveIntensity: 0.35 }),
      crystal: new THREE.MeshStandardMaterial({ color: "#8af8ff", emissive: "#116b77", emissiveIntensity: 0.65 }),
    };
    const blocks = makeWorld();

    function rebuildVisibleBlocks() {
      for (const child of group.children) {
        if (child instanceof THREE.Mesh) {
          const material = child.material;
          if (Array.isArray(material)) material.forEach((item) => item.dispose());
          else material.dispose();
        }
      }
      group.clear();

      for (const block of blocks.values()) {
        const distance = Math.hypot(block.x - camera.position.x, block.y - camera.position.y, block.z - camera.position.z);
        if (distance > 18) continue;

        const mesh = new THREE.Mesh(geometry, materialMap[block.kind].clone());
        (mesh.material as THREE.MeshStandardMaterial).color = blockColor(block.kind, block.y);
        mesh.position.set(block.x, block.y, block.z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.key = block.key;
        group.add(mesh);

        const line = new THREE.LineSegments(edgeGeometry, edgesMaterial);
        line.position.copy(mesh.position);
        group.add(line);
      }
    }

    rebuildVisibleBlocks();

    const keys = new Set<string>();
    const velocity = new THREE.Vector3();
    const particles: NonNullable<typeof gameRef.current>["particles"] = [];
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2(0, 0);
    const clock = new THREE.Clock();

    gameRef.current = {
      blocks,
      camera,
      scene,
      renderer,
      group,
      keys,
      velocity,
      particles,
      lastMineAt: 0,
      yaw: 0,
      pitch: 0,
      stats,
      active: true,
    };

    const setGameStats = (next: GameStats) => {
      if (!gameRef.current) return;
      gameRef.current.stats = next;
      setStats(next);
    };

    function burst(block: Block, origin: THREE.Vector3) {
      const material = chipMaterials[block.kind];
      const count = block.kind === "crystal" ? 16 : block.kind === "ore" ? 12 : 8;
      for (let index = 0; index < count; index += 1) {
        const mesh = new THREE.Mesh(chipGeometry, material);
        mesh.position.copy(origin);
        mesh.castShadow = true;
        const chipVelocity = new THREE.Vector3(
          (Math.random() - 0.5) * 3,
          Math.random() * 2.4 + 0.7,
          (Math.random() - 0.5) * 3,
        );
        const life = block.kind === "soil" ? 0.45 : 0.75;
        particles.push({ mesh, velocity: chipVelocity, life, maxLife: life });
        scene.add(mesh);
      }
    }

    function targetBlock() {
      raycaster.setFromCamera(pointer, camera);
      const meshes = group.children.filter((child) => child instanceof THREE.Mesh);
      const hits = raycaster.intersectObjects(meshes, false);
      return hits.find((hit) => hit.distance < EYE_REACH && hit.object.userData.key);
    }

    function mine() {
      const hit = targetBlock();
      if (!hit || !gameRef.current) return;

      const key = hit.object.userData.key as string;
      const block = blocks.get(key);
      if (!block) return;

      blocks.delete(key);
      burst(block, hit.point);
      rebuildVisibleBlocks();

      const current = gameRef.current.stats;
      const now = performance.now();
      const combo = now - gameRef.current.lastMineAt < COMBO_WINDOW_MS ? Math.min(current.combo + 1, 9) : 1;
      gameRef.current.lastMineAt = now;
      const energyCost = block.kind === "stone" ? 8 : block.kind === "ore" ? 5 : block.kind === "crystal" ? 2 : 3;
      const energyGain = block.kind === "crystal" ? 28 : block.kind === "ore" ? 14 : combo >= 4 ? 3 : 0;
      const next = {
        depth: Math.max(current.depth, Math.max(0, Math.floor(-camera.position.y + PLAYER_HEIGHT))),
        blocks: current.blocks + 1,
        ore: current.ore + (block.kind === "ore" ? 1 : 0),
        crystals: current.crystals + (block.kind === "crystal" ? 1 : 0),
        combo,
        energy: Math.max(0, Math.min(100, current.energy - energyCost + energyGain)),
      };
      setGameStats(next);

      if (block.kind === "ore" || block.kind === "crystal") {
        setToast(`${blockLabel(block.kind)} 발견! 콤보 x${combo}`);
      } else if (combo >= 4) {
        setToast(`빠른 채굴 콤보 x${combo} - 에너지 보너스`);
      } else {
        setToast(`${blockLabel(block.kind)} 제거`);
      }
    }

    function isSolidAt(x: number, y: number, z: number) {
      return blocks.has(blockKey(Math.round(x), Math.round(y), Math.round(z)));
    }

    function floorBelow(position: THREE.Vector3) {
      const footY = position.y - PLAYER_HEIGHT;
      for (let y = Math.floor(footY); y > footY - 2.2; y -= 1) {
        if (isSolidAt(position.x, y, position.z)) return y + 1 + PLAYER_HEIGHT;
      }
      return null;
    }

    function animate() {
      const game = gameRef.current;
      if (!game?.active) return;

      const delta = Math.min(clock.getDelta(), 0.05);
      const direction = new THREE.Vector3();
      const forward = new THREE.Vector3(Math.sin(game.yaw), 0, Math.cos(game.yaw) * -1);
      const right = new THREE.Vector3(Math.cos(game.yaw), 0, Math.sin(game.yaw));

      if (keys.has("KeyW")) direction.add(forward);
      if (keys.has("KeyS")) direction.sub(forward);
      if (keys.has("KeyD")) direction.add(right);
      if (keys.has("KeyA")) direction.sub(right);

      if (direction.lengthSq() > 0) direction.normalize();
      const speed = keys.has("ShiftLeft") ? 5.8 : 3.4;
      camera.position.addScaledVector(direction, speed * delta);

      game.velocity.y -= 13 * delta;
      camera.position.addScaledVector(game.velocity, delta);
      const floorY = floorBelow(camera.position);
      if (floorY !== null && camera.position.y < floorY) {
        camera.position.y = floorY;
        game.velocity.y = 0;
      }

      camera.position.x = THREE.MathUtils.clamp(camera.position.x, -WORLD_RADIUS + 0.35, WORLD_RADIUS - 0.35);
      camera.position.z = THREE.MathUtils.clamp(camera.position.z, -WORLD_RADIUS + 0.35, WORLD_RADIUS - 0.35);
      camera.rotation.order = "YXZ";
      camera.rotation.y = game.yaw;
      camera.rotation.x = game.pitch;

      lamp.position.copy(camera.position).add(new THREE.Vector3(0, 0.4, 0));
      pickLight.position.copy(camera.position);
      pickLight.target.position.copy(camera.position).add(forward.multiplyScalar(3));
      scene.add(pickLight.target);

      const currentDepth = Math.max(0, Math.floor(-camera.position.y + PLAYER_HEIGHT));
      if (currentDepth > game.stats.depth) {
        setGameStats({ ...game.stats, depth: currentDepth, energy: Math.min(100, game.stats.energy + delta * 1.6) });
        if (currentDepth >= 18 && game.stats.depth < 18) setToast("공기가 차가워집니다. 수정층이 가까워요");
        if (currentDepth >= 8 && game.stats.depth < 8) setToast("벽 사이로 금빛이 보이기 시작합니다");
      }

      for (let index = particles.length - 1; index >= 0; index -= 1) {
        const particle = particles[index];
        particle.life -= delta;
        particle.velocity.y -= 7.5 * delta;
        particle.mesh.position.addScaledVector(particle.velocity, delta);
        particle.mesh.rotation.x += delta * 7;
        particle.mesh.rotation.y += delta * 9;
        particle.mesh.scale.setScalar(Math.max(0.05, particle.life / particle.maxLife));
        if (particle.life <= 0) {
          scene.remove(particle.mesh);
          particles.splice(index, 1);
        }
      }

      renderer.render(scene, camera);
      window.requestAnimationFrame(animate);
    }

    function resize() {
      camera.aspect = host.clientWidth / host.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(host.clientWidth, host.clientHeight);
    }

    function pointerMove(event: MouseEvent) {
      if (document.pointerLockElement !== renderer.domElement || !gameRef.current) return;
      gameRef.current.yaw -= event.movementX * 0.0022;
      gameRef.current.pitch -= event.movementY * 0.0022;
      gameRef.current.pitch = THREE.MathUtils.clamp(gameRef.current.pitch, -1.35, 1.35);
    }

    function keyDown(event: KeyboardEvent) {
      keys.add(event.code);
      if (event.code === "Space" && gameRef.current && Math.abs(gameRef.current.velocity.y) < 0.01) {
        gameRef.current.velocity.y = 5.3;
      }
    }

    function keyUp(event: KeyboardEvent) {
      keys.delete(event.code);
    }

    function click() {
      if (document.pointerLockElement !== renderer.domElement) {
        renderer.domElement.requestPointerLock();
        return;
      }
      mine();
    }

    function lockChange() {
      setIsLocked(document.pointerLockElement === renderer.domElement);
    }

    window.addEventListener("resize", resize);
    window.addEventListener("mousemove", pointerMove);
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    document.addEventListener("pointerlockchange", lockChange);
    renderer.domElement.addEventListener("click", click);
    animate();

    return () => {
      gameRef.current = null;
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", pointerMove);
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      document.removeEventListener("pointerlockchange", lockChange);
      renderer.domElement.removeEventListener("click", click);
      host.removeChild(renderer.domElement);
      for (const particle of particles) scene.remove(particle.mesh);
      renderer.dispose();
      geometry.dispose();
      chipGeometry.dispose();
      edgeGeometry.dispose();
      edgesMaterial.dispose();
      Object.values(chipMaterials).forEach((material) => material.dispose());
    };
  }, [materialMap, resetSeed]);

  function resetGame() {
    setStats(initialStats);
    setToast("새 갱도가 열렸습니다");
    setResetSeed((value) => value + 1);
  }

  return (
    <main className="shell">
      <div ref={mountRef} className="viewport" />
      <div className="hud top">
        <div className="brand">
          <Pickaxe size={20} />
          <span>DIG</span>
        </div>
        <button className="icon-button" onClick={resetGame} aria-label="다시 시작" title="다시 시작">
          <RotateCcw size={18} />
        </button>
      </div>
      <div className="hud goal">
        <Sparkles size={16} />
        <span>{goalText}</span>
      </div>
      <div className="hud toast" aria-live="polite">
        {toast}
      </div>
      <div className="hud stats" aria-label="게임 상태">
        <div>
          <Mountain size={18} />
          <span>{stats.depth}m</span>
        </div>
        <div>
          <Pickaxe size={18} />
          <span>{stats.blocks}</span>
        </div>
        <div>
          <Crosshair size={18} />
          <span>{stats.ore}</span>
        </div>
        <div>
          <Gem size={18} />
          <span>{stats.crystals}</span>
        </div>
        <div>
          <Gauge size={18} />
          <span>{Math.round(stats.energy)}</span>
        </div>
      </div>
      {stats.combo > 1 && <div className="combo">x{stats.combo}</div>}
      <div className="reticle" aria-hidden="true" />
      {!isLocked && (
        <button className="start" onClick={() => mountRef.current?.querySelector("canvas")?.requestPointerLock()}>
          클릭해서 채굴 시작
        </button>
      )}
      <div className="controls">WASD 이동 · 마우스 시점 · 클릭 채굴 · Space 점프 · Shift 달리기</div>
    </main>
  );
}
