import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

// Execute the component itself with controlled hooks and MapLibre events. No
// browser location, map provider, credential, or production service is used.
const compiled = ts.transpileModule(readFileSync("src/components/KovaMaps.tsx", "utf8"), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
  },
}).outputText;

function place(id, longitude = 10) {
  return { id, name: id, latitude: 20, longitude, type: "city", address: {}, bounds: null };
}

function fixture({ approved = true, lockdown = false } = {}) {
  const hooks = [];
  const effects = [];
  const maps = [];
  const markers = [];
  const calls = [];
  const timers = new Map();
  let cursor = 0;
  let timerId = 0;
  let dirty = true;
  let tree;
  let user = { isLoaded: true, isSignedIn: true, user: { id: "owner-a" } };
  let nextResults = [place("First")];
  let chunkReady;
  const chunk = new Promise((resolve) => {
    chunkReady = resolve;
  });
  const jsx = (type, props) => ({ type, props: props ?? {} });
  function nodes(node) {
    if (!node || typeof node !== "object") return [];
    if (Array.isArray(node)) return node.flatMap((item) => nodes(item));
    return [node, ...nodes(node.props?.children)];
  }
  function find(predicate) {
    const node = nodes(tree).find(predicate);
    assert.ok(node, "Expected component control to exist");
    return node.props;
  }
  const control = (label) => find((node) => node.props?.["aria-label"] === label);
  class FakeMap {
    constructor() {
      this.handlers = new Map();
      this.moves = [];
      this.center = { lng: 0, lat: 0 };
      this.sources = new Map([["openmaptiles", {}]]);
      this.layers = new Map();
      maps.push(this);
    }
    on(name, callback) {
      const entries = this.handlers.get(name) ?? [];
      entries.push({ callback, once: false });
      this.handlers.set(name, entries);
    }
    once(name, callback) {
      this.on(name, callback);
      this.handlers.get(name).at(-1).once = true;
    }
    emit(name, event = {}) {
      const entries = [...(this.handlers.get(name) ?? [])];
      this.handlers.set(
        name,
        entries.filter((entry) => !entry.once),
      );
      for (const entry of entries) entry.callback(event);
    }
    addControl() {}
    getCenter() {
      return this.center;
    }
    getZoom() {
      return 16;
    }
    getBounds() {
      return { getWest: () => 0, getSouth: () => 0, getEast: () => 30, getNorth: () => 30 };
    }
    flyTo(options) {
      this.moves.push(options.center);
      this.center = { lng: options.center[0], lat: options.center[1] };
    }
    fitBounds() {
      throw new Error("This fixture uses point selections");
    }
    easeTo() {}
    setStyle(style) {
      this.style = style;
    }
    getStyle() {
      return { layers: [] };
    }
    getSource(id) {
      return this.sources.get(id);
    }
    addSource(id, source) {
      this.sources.set(id, source);
    }
    getLayer(id) {
      return this.layers.get(id);
    }
    addLayer(layer) {
      this.layers.set(layer.id, layer);
    }
    setLayoutProperty(id, property, value) {
      this.layers.get(id)[property] = value;
    }
    setTerrain(value) {
      this.terrain = value;
    }
    remove() {
      this.removed = true;
    }
  }
  class FakeMarker {
    constructor() {
      markers.push(this);
    }
    setLngLat(coordinates) {
      this.coordinates = coordinates;
      return this;
    }
    addTo(map) {
      this.map = map;
      return this;
    }
    remove() {
      this.removed = true;
    }
  }
  const modules = {
    "react/jsx-runtime": { jsx, jsxs: jsx },
    react: {
      useRef(initial) {
        const index = cursor++;
        hooks[index] ??= { current: initial };
        return hooks[index];
      },
      useState(initial) {
        const index = cursor++;
        hooks[index] ??= { value: typeof initial === "function" ? initial() : initial };
        return [
          hooks[index].value,
          (next) => {
            const value = typeof next === "function" ? next(hooks[index].value) : next;
            if (!Object.is(value, hooks[index].value)) {
              hooks[index].value = value;
              dirty = true;
            }
          },
        ];
      },
      useEffect(run, dependencies) {
        const index = cursor++;
        const prior = hooks[index];
        if (!prior || dependencies.some((value, i) => !Object.is(value, prior.dependencies[i]))) {
          hooks[index] = { dependencies, cleanup: prior?.cleanup };
          effects.push(() => {
            hooks[index].cleanup?.();
            hooks[index].cleanup = run();
          });
        }
      },
    },
    "@tanstack/react-router": { useNavigate: () => (value) => calls.push(["navigate", value]) },
    "lucide-react": {},
    "maplibre-gl/dist/maplibre-gl.css": {},
    "@/components/auth/ClerkSafe": { useUser: () => user },
    "@/lib/maps-release-gate": {
      MAPS_RELEASE_APPROVED: approved,
      MAPS_RELEASE_UNAVAILABLE_MESSAGE: "Maps approval is pending.",
    },
    "@/lib/auth-fetch": {
      authFetch: async (url) => {
        calls.push(["fetch", url]);
        return {
          ok: true,
          json: async () =>
            url.includes("lockdown") ? { enabled: lockdown } : { results: nextResults },
        };
      },
    },
    "@/lib/principal-browser-storage.mjs": {
      safeBrowserStorage: () => ({}),
      writePrincipalHandoff: (...args) => {
        calls.push(["handoff", args]);
        return { ok: true };
      },
    },
  };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    require(name) {
      if (name === "maplibre-gl") {
        calls.push(["import"]);
        return chunk;
      }
      assert.ok(name in modules, `Unexpected import: ${name}`);
      return modules[name];
    },
    AbortController,
    AbortSignal,
    DOMException,
    console: { error() {} },
    document: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} },
    window: {
      setTimeout(callback) {
        timers.set(++timerId, callback);
        return timerId;
      },
      clearTimeout(id) {
        timers.delete(id);
      },
      setInterval() {
        return ++timerId;
      },
      clearInterval() {},
    },
    navigator: { geolocation: { getCurrentPosition: (...args) => calls.push(["location", args]) } },
  });
  function render() {
    cursor = 0;
    dirty = false;
    tree = exports.KovaMaps();
    for (const node of nodes(tree)) {
      if (node.props?.["data-testid"] === "map-container") node.props.ref.current = {};
    }
    while (effects.length) effects.shift()();
  }
  async function flush() {
    for (let i = 0; i < 12; i++) {
      await new Promise((resolve) => setImmediate(resolve));
      if (dirty) render();
    }
  }
  return {
    maps,
    markers,
    calls,
    timers,
    control,
    nodes: () => nodes(tree),
    flush,
    async start() {
      render();
      await flush();
    },
    async resolveChunk() {
      chunkReady({
        Map: FakeMap,
        Marker: FakeMarker,
        NavigationControl: class {},
        FullscreenControl: class {},
      });
      await flush();
    },
    async ready() {
      await this.start();
      await this.resolveChunk();
      maps[0].emit("load");
      await flush();
    },
    async search(value, results = [place(value)]) {
      nextResults = results;
      control("Ask Kova about Maps").onChange({ target: { value } });
      await flush();
      find((node) => node.type === "form").onSubmit({ preventDefault() {} });
      await flush();
    },
    async switchOwner() {
      user = { ...user, user: { id: "owner-b" } };
      dirty = true;
      await flush();
    },
  };
}

const initialControls = [
  "Search maps",
  "Use my current location",
  "Switch to 2D",
  "Show satellite imagery",
];
function assertDisabled(f) {
  for (const label of initialControls) assert.equal(f.control(label).disabled, true, label);
}

test("Maps approval and Lockdown gates still prevent map initialization", async () => {
  const unavailable = fixture({ approved: false });
  await unavailable.start();
  assert.equal(unavailable.calls.length, 0);
  const locked = fixture({ lockdown: true });
  await locked.start();
  assertDisabled(locked);
  assert.equal(locked.calls.filter(([kind]) => kind === "import").length, 0);
});

test("Maps controls and their handlers stay inactive while the map chunk is pending", async () => {
  const f = fixture();
  await f.start();
  assertDisabled(f);
  await f.search("Delayed chunk");
  f.control("Use my current location").onClick();
  f.control("Show satellite imagery").onClick();
  f.control("Switch to 2D").onClick();
  await f.flush();
  assert.equal(
    f.calls.filter(([kind, url]) => kind === "fetch" && url.includes("/maps/search")).length,
    0,
  );
  assert.equal(f.calls.filter(([kind]) => kind === "location").length, 0);
});

test("Maps remains inactive until the initial style loads, then selects a single result", async () => {
  const f = fixture();
  await f.start();
  await f.resolveChunk();
  assertDisabled(f);
  await f.search("Before style");
  f.control("Use my current location").onClick();
  assert.equal(f.calls.filter(([kind]) => kind === "location").length, 0);
  assert.equal(
    f.calls.filter(([kind, url]) => kind === "fetch" && url.includes("/maps/search")).length,
    0,
  );
  f.maps[0].emit("load");
  await f.flush();
  assert.equal(f.control("Search maps").disabled, false);
  await f.search("Only result");
  assert.ok(f.nodes().some((node) => node.type === "h1" && node.props.children === "Only result"));
  assert.deepEqual(Array.from(f.markers.at(-1).coordinates), [10, 20]);
});

test("A startup timeout does not enable controls; a successful late load does", async () => {
  const f = fixture();
  await f.start();
  await f.resolveChunk();
  for (const callback of [...f.timers.values()]) callback();
  await f.flush();
  assertDisabled(f);
  f.maps[0].emit("load");
  await f.flush();
  assert.equal(f.control("Search maps").disabled, false);
});

test("A delayed style callback never restores an older selected place", async () => {
  const f = fixture();
  await f.ready();
  await f.search("First", [place("First", 10)]);
  f.control("Show satellite imagery").onClick();
  await f.flush();
  await f.search("Newer", [place("Newer", 12)]);
  const moveCount = f.maps[0].moves.length;
  f.maps[0].emit("style.load");
  await f.flush();
  assert.equal(
    f.maps[0].moves.length,
    moveCount,
    "style completion must not move to a stale place",
  );
  assert.deepEqual(Array.from(f.markers.at(-1).coordinates), [12, 20]);
  assert.ok(f.nodes().some((node) => node.type === "h1" && node.props.children === "Newer"));
});

test("Street style completion honors the latest 2D choice", async () => {
  const f = fixture();
  await f.ready();
  f.control("Show satellite imagery").onClick();
  await f.flush();
  f.maps[0].emit("style.load");
  f.control("Show street map").onClick();
  await f.flush();
  f.control("Switch to 2D").onClick();
  await f.flush();
  f.maps[0].emit("style.load");
  await f.flush();
  assert.equal(f.maps[0].terrain, null);
  assert.equal(f.maps[0].layers.get("kova-3d-buildings").visibility, "none");
});

test("Old map callbacks cannot restore readiness or selection after an account change", async () => {
  const f = fixture();
  await f.ready();
  await f.search("Private place");
  const oldMap = f.maps[0];
  f.control("Show satellite imagery").onClick();
  await f.flush();
  await f.switchOwner();
  oldMap.emit("style.load");
  oldMap.emit("load");
  await f.flush();
  assert.equal(oldMap.removed, true);
  assertDisabled(f);
  assert.equal(
    f.nodes().some((node) => node.type === "h1" && node.props.children === "Private place"),
    false,
  );
});
