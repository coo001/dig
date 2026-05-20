import { Crosshair, Gauge, Mountain, Pickaxe, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

type Block = {
  key: string;
  x: number;
  y: number;
  z: number;
  kind: "soil" | "stone" | "ore";
};

type GameStats = {
  depth: number;
  blocks: number;
  ore: number;
  energy: number;
};

const WORLD_RADIUS = 7;
const WORLD_DEPTH = 38;
const PLAYER_HEIGHT = 1.62;
const EYE_REACH = 3.6;

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

        const oreChance = y < -7 && seededNoise(x + 4, y - 11, z + 2) > 0.965;
        const stoneChance = y < -9 && seededNoise(x - 3, y + 8, z - 9) > 0.72;
        const kind = oreChance ? "ore" : stoneChance ? "stone" : "soil";
        const key = blockKey(x, y, z);
        blocks.set(key, { key, x, y, z, kind });
      }
    }
  }

  return blocks;
}

function blockColor(kind: Block["kind"], y: number) {
  if (kind === "ore") return new THREE.Color("#f6c65b");
  if (kind === "stone") return new THREE.Color("#63615d").offsetHSL(0, 0, y * -0.002);
  return new THREE.Color("#8a5a38").offsetHSL(0.02, -0.02, y * -0.003);
}

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
    yaw: number;
    pitch: number;
    stats: GameStats;
    active: boolean;
  } | null>(null);
  const [stats, setStats] = useState<GameStats>({
    depth: 0,
    blocks: 0,
    ore: 0,
    energy: 100,
  });
  const [isLocked, setIsLocked] = useState(false);
  const [resetSeed, setResetSeed] = useState(0);

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
    const edgesMaterial = new THREE.LineBasicMaterial({ color: "#20150d", transparent: true, opacity: 0.28 });
    const blocks = makeWorld();

    function rebuildVisibleBlocks() {
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

        const line = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), edgesMaterial);
        line.position.copy(mesh.position);
        group.add(line);
      }
    }

    rebuildVisibleBlocks();

    const keys = new Set<string>();
    const velocity = new THREE.Vector3();
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
      rebuildVisibleBlocks();

      const current = gameRef.current.stats;
      const energyCost = block.kind === "stone" ? 8 : block.kind === "ore" ? 5 : 3;
      setGameStats({
        depth: Math.max(current.depth, Math.max(0, Math.floor(-camera.position.y + PLAYER_HEIGHT))),
        blocks: current.blocks + 1,
        ore: current.ore + (block.kind === "ore" ? 1 : 0),
        energy: Math.max(0, Math.min(100, current.energy - energyCost + (block.kind === "ore" ? 14 : 0))),
      });
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
      if (currentDepth !== game.stats.depth) {
        setGameStats({ ...game.stats, depth: Math.max(game.stats.depth, currentDepth), energy: Math.min(100, game.stats.energy + delta * 1.6) });
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
      renderer.dispose();
      geometry.dispose();
      edgesMaterial.dispose();
    };
  }, [materialMap, resetSeed]);

  function resetGame() {
    setStats({ depth: 0, blocks: 0, ore: 0, energy: 100 });
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
        <button className="icon-button" onClick={resetGame} aria-label="다시 시작">
          <RotateCcw size={18} />
        </button>
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
          <Gauge size={18} />
          <span>{Math.round(stats.energy)}</span>
        </div>
      </div>
      <div className="reticle" aria-hidden="true" />
      {!isLocked && (
        <button className="start" onClick={() => mountRef.current?.querySelector("canvas")?.requestPointerLock()}>
          클릭해서 파기 시작
        </button>
      )}
      <div className="controls">
        WASD 이동 · 마우스 시점 · 클릭 파기 · Space 점프 · Shift 달리기
      </div>
    </main>
  );
}
