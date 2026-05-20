# Codex Notes

## Project

`dig` is a browser-based first-person digging game built with Vite, React, TypeScript, and Three.js.

The current MVP focuses on a simple playable loop:

- Full-screen first-person 3D view
- WASD movement, mouse look, click-to-mine
- Space jump, Shift sprint
- Procedural block world with soil, stone, and ore
- HUD for depth, mined blocks, ore count, and energy

## Commands

Run from `C:\dev\hobby\dig`.

```powershell
npm install
npm run dev
npm run build
```

Default dev URL is usually:

```text
http://localhost:5173
```

## Important Files

- `src/App.tsx`: game logic, Three.js scene setup, block generation, input handling, mining loop, HUD state
- `src/styles.css`: full-screen game UI and HUD styling
- `src/main.tsx`: React entrypoint
- `vite.config.ts`: Vite config

## Implementation Notes

- The world is stored as a `Map<string, Block>` keyed by `x:y:z`.
- Blocks are generated in `makeWorld()`.
- Mining uses a center-screen `THREE.Raycaster`.
- Rendering rebuilds visible block meshes after mining.
- Player position and camera rotation live inside `gameRef` to avoid React rerenders every frame.
- HUD stats are copied into React state only when they need to be displayed.

## Current Constraints

- There is no persistence yet.
- There is no mobile touch control yet.
- Collision is intentionally simple and only handles floor support.
- The renderer uses plain Three.js, not React Three Fiber.
- The production bundle may warn about chunk size because Three.js is included directly.

## Good Next Steps

- Add better collision for walls and ceilings.
- Add procedural depth biomes and rarer materials.
- Add tool upgrades and mining speed differences.
- Add sound effects and hit feedback.
- Add save/load using `localStorage`.
- Add mobile controls if targeting phones.

## GitHub

Remote repository:

```text
https://github.com/coo001/dig
```

Local branch currently tracks `origin/master`.
