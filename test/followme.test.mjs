import assert from "node:assert/strict";
import test from "node:test";

const hooks = new Map();
const onceHooks = new Map();
const keybindings = new Map();

globalThis.Hooks = {
  on(name, callback) {
    hooks.set(name, callback);
  },
  once(name, callback) {
    onceHooks.set(name, callback);
  },
};
globalThis.CONST = {
  KEYBINDING_PRECEDENCE: { NORMAL: 0 },
  TEXT_ANCHOR_POINTS: { TOP: 0 },
};
globalThis.game = {
  i18n: { localize: (key) => key },
  settings: {
    get: (namespace, key) =>
      namespace === "core" && key === "tokenAutoRotate",
    register() {},
  },
  keybindings: {
    register(namespace, action, config) {
      keybindings.set(`${namespace}.${action}`, config);
    },
  },
  user: { isGM: true },
};

function createFollower({
  id,
  x,
  y,
  leaderId,
  distance,
  gridSpaces,
  positions,
  snap = (point) => point,
}) {
  const moves = [];
  const updates = [];
  const unsets = [];
  let description = {
    who: leaderId,
    dist: distance,
    gridSpaces,
    positions: positions ?? [
        { x, y },
        { x: x + distance, y },
      ],
  };
  const document = {
    id,
    x,
    y,
    isOwner: true,
    getFlag: () => description,
    getCenterPoint: (point = { x, y }) => point,
    async move(waypoints, options) {
      moves.push({ waypoints, options });
      const destination = waypoints.at(-1);
      document.x = destination.x;
      document.y = destination.y;
      return true;
    },
    async update(data) {
      updates.push(data);
      description = data["flags.FollowMe.following"];
    },
    async unsetFlag(namespace, key) {
      unsets.push({ namespace, key });
      description = null;
    },
  };
  const token = {
    id,
    name: id,
    center: { x, y },
    isOwner: true,
    document,
    getSnappedPosition: snap,
    checkCollision: () => false,
  };
  document.object = token;
  return { token, moves, updates, unsets };
}

function squareGrid(size = 100) {
  return {
    isGridless: false,
    getDirectPath(points) {
      const path = [{ x: points[0].x, y: points[0].y }];
      for (let i = 1; i < points.length; i += 1) {
        const from = path.at(-1);
        const to = points[i];
        const steps = Math.max(
          Math.abs(to.x - from.x) / size,
          Math.abs(to.y - from.y) / size,
        );
        for (let step = 1; step <= steps; step += 1) {
          path.push({
            x: from.x + ((to.x - from.x) * step) / steps,
            y: from.y + ((to.y - from.y) * step) / steps,
          });
        }
      }
      return path;
    },
    getTopLeftPoint: ({ x, y }) => ({ x, y }),
  };
}

async function flushMovementQueue() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test("a follower advances on the leader's first move", async () => {
  const leader = {
    id: "leader-1",
    getFlag: () => null,
    object: { name: "Leader" },
  };
  const follower = createFollower({
    id: "follower-1",
    x: 0,
    y: 0,
    leaderId: leader.id,
    distance: 100,
  });
  globalThis.canvas = {
    grid: { isGridless: false },
    tokens: {
      placeables: [follower.token],
      get: () => leader.object,
    },
  };

  await import(`../script/followme.mjs?first-move=${Date.now()}`);
  onceHooks.get("init")();
  hooks.get("moveToken")(
    leader,
    {
      origin: { x: 100, y: 0 },
      passed: { waypoints: [{ x: 200, y: 0 }] },
    },
    {},
    { isSelf: true },
  );
  await flushMovementQueue();

  assert.deepEqual(follower.moves[0].waypoints, [{ x: 100, y: 0 }]);
  assert.equal(follower.moves[0].options.animate, true);
  assert.equal(follower.moves[0].options.autoRotate, true);
  assert.deepEqual(follower.moves[0].options.constrainOptions, {
    ignoreCost: true,
  });
  assert.deepEqual(
    follower.updates.at(-1)["flags.FollowMe.following"].positions,
    [
      { x: 100, y: 0 },
      { x: 200, y: 0 },
    ],
  );
});

test("Shift+F stops selected followers without requiring a hovered leader", async () => {
  const leader = { id: "leader-unfollow", name: "Leader" };
  const follower = createFollower({
    id: "follower-unfollow",
    x: 0,
    y: 0,
    leaderId: leader.id,
    distance: 100,
  });
  const scrollingText = [];
  globalThis.canvas = {
    interface: {
      createScrollingText: (position, text) =>
        scrollingText.push({ position, text }),
    },
    tokens: {
      controlled: [follower.token],
      get: () => leader,
    },
  };

  const binding = keybindings.get("FollowMe.stopFollowing");
  assert.deepEqual(binding.editable, [
    { key: "KeyF", modifiers: ["Shift"] },
  ]);
  assert.equal(binding.onDown(), true);
  await flushMovementQueue();

  assert.deepEqual(follower.unsets, [
    { namespace: "FollowMe", key: "following" },
  ]);
  assert.equal(scrollingText.length, 1);
});

test("a leader moving toward its follower does not move the follower", async () => {
  const leader = {
    id: "leader-2",
    getFlag: () => null,
    object: { name: "Leader" },
  };
  const follower = createFollower({
    id: "follower-2",
    x: 0,
    y: 0,
    leaderId: leader.id,
    distance: 200,
  });
  globalThis.canvas = {
    grid: { isGridless: false },
    tokens: {
      placeables: [follower.token],
      get: () => leader.object,
    },
  };

  hooks.get("moveToken")(
    leader,
    {
      origin: { x: 200, y: 0 },
      passed: { waypoints: [{ x: 100, y: 0 }] },
    },
    {},
    { isSelf: true },
  );
  await flushMovementQueue();

  assert.deepEqual(follower.moves, []);
  assert.deepEqual(
    follower.updates.at(-1)["flags.FollowMe.following"].positions,
    [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ],
  );
});

test("a follower vacates into the leader's origin when the leader lands on it", async () => {
  const leader = {
    id: "leader-3",
    getFlag: () => null,
    object: { name: "Leader" },
  };
  const follower = createFollower({
    id: "follower-3",
    x: 0,
    y: 0,
    leaderId: leader.id,
    distance: 100,
  });
  globalThis.canvas = {
    grid: { isGridless: false },
    tokens: {
      placeables: [follower.token],
      get: () => leader.object,
    },
  };

  hooks.get("moveToken")(
    leader,
    {
      origin: { x: 100, y: 0 },
      passed: { waypoints: [{ x: 0, y: 0, snapped: true }] },
    },
    {},
    { isSelf: true },
  );
  await flushMovementQueue();

  assert.deepEqual(follower.moves[0].waypoints, [
    { x: 100, y: 0, snapped: true },
  ]);
  assert.deepEqual(
    follower.updates.at(-1)["flags.FollowMe.following"].positions,
    [
      { x: 100, y: 0 },
      { x: 0, y: 0 },
    ],
  );
});

test("a snapped leader move snaps the follower endpoint on a gridded scene", async () => {
  const leader = {
    id: "leader-4",
    getFlag: () => null,
    object: { name: "Leader" },
  };
  const follower = createFollower({
    id: "follower-4",
    x: 0,
    y: 0,
    leaderId: leader.id,
    distance: 100,
    snap: ({ x, y }) => ({
      x: Math.round(x / 100) * 100,
      y: Math.round(y / 100) * 100,
    }),
  });
  globalThis.canvas = {
    grid: { isGridless: false },
    tokens: {
      placeables: [follower.token],
      get: () => leader.object,
    },
  };

  hooks.get("moveToken")(
    leader,
    {
      origin: { x: 100, y: 0 },
      passed: { waypoints: [{ x: 200, y: 50, snapped: true }] },
    },
    {},
    { isSelf: true },
  );
  await flushMovementQueue();

  assert.deepEqual(follower.moves[0].waypoints.at(-1), {
    x: 100,
    y: 0,
    snapped: true,
  });
});

test("an unsnapped leader move keeps the follower endpoint off-grid", async () => {
  const leader = {
    id: "leader-5",
    getFlag: () => null,
    object: { name: "Leader" },
  };
  const follower = createFollower({
    id: "follower-5",
    x: 0,
    y: 0,
    leaderId: leader.id,
    distance: 100,
    snap: () => {
      throw new Error("Off-grid movement must not request a snapped position");
    },
  });
  globalThis.canvas = {
    grid: { isGridless: false },
    tokens: {
      placeables: [follower.token],
      get: () => leader.object,
    },
  };

  hooks.get("moveToken")(
    leader,
    {
      origin: { x: 100, y: 0 },
      passed: { waypoints: [{ x: 200, y: 50, snapped: false }] },
    },
    {},
    { isSelf: true },
  );
  await flushMovementQueue();

  assert.notEqual(follower.moves[0].waypoints.at(-1).y, 0);
});

test("grid spacing counts diagonal grid steps instead of pixel distance", async () => {
  const leader = {
    id: "leader-6",
    getFlag: () => null,
    object: { name: "Leader" },
  };
  const follower = createFollower({
    id: "follower-6",
    x: 0,
    y: 0,
    leaderId: leader.id,
    distance: Math.hypot(200, 200),
    gridSpaces: 2,
    positions: [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
      { x: 200, y: 200 },
    ],
  });
  globalThis.canvas = {
    grid: squareGrid(),
    tokens: {
      placeables: [follower.token],
      get: () => leader.object,
    },
  };

  hooks.get("moveToken")(
    leader,
    {
      origin: { x: 200, y: 200 },
      passed: { waypoints: [{ x: 300, y: 300, snapped: true }] },
    },
    {},
    { isSelf: true },
  );
  await flushMovementQueue();

  assert.deepEqual(follower.moves[0].waypoints.at(-1), {
    x: 100,
    y: 100,
    snapped: true,
  });
});

test("a reversal propagates occupied positions through a follower line", async () => {
  const leader = {
    id: "leader-7",
    getFlag: () => null,
    object: { name: "Leader" },
  };
  const nearFollower = createFollower({
    id: "follower-7a",
    x: 100,
    y: 0,
    leaderId: leader.id,
    distance: 100,
    gridSpaces: 1,
    positions: [
      { x: 100, y: 0 },
      { x: 200, y: 0 },
    ],
  });
  const farFollower = createFollower({
    id: "follower-7b",
    x: 0,
    y: 0,
    leaderId: leader.id,
    distance: 200,
    gridSpaces: 2,
    positions: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 200, y: 0 },
    ],
  });
  globalThis.canvas = {
    grid: squareGrid(),
    tokens: {
      placeables: [farFollower.token, nearFollower.token],
      get: () => leader.object,
    },
  };

  hooks.get("moveToken")(
    leader,
    {
      origin: { x: 200, y: 0 },
      passed: {
        waypoints: [
          { x: 100, y: 0, snapped: true },
          { x: 0, y: 0, snapped: true },
          { x: -100, y: 0, snapped: true },
        ],
      },
    },
    {},
    { isSelf: true },
  );
  await flushMovementQueue();

  assert.deepEqual(nearFollower.moves[0].waypoints.at(-1), {
    x: 0,
    y: 0,
    snapped: true,
  });
  assert.deepEqual(farFollower.moves[0].waypoints.at(-1), {
    x: 100,
    y: 0,
    snapped: true,
  });
});

test("landing on the last follower reverses a two-follower line without overlap", async () => {
  const leader = {
    id: "leader-8",
    getFlag: () => null,
    object: { name: "Leader" },
  };
  const nearFollower = createFollower({
    id: "follower-8a",
    x: 200,
    y: 0,
    leaderId: leader.id,
    distance: 100,
    gridSpaces: 1,
    positions: [
      { x: 200, y: 0 },
      { x: 300, y: 0 },
    ],
  });
  const farFollower = createFollower({
    id: "follower-8b",
    x: 100,
    y: 0,
    leaderId: leader.id,
    distance: 200,
    gridSpaces: 2,
    positions: [
      { x: 100, y: 0 },
      { x: 200, y: 0 },
      { x: 300, y: 0 },
    ],
  });
  globalThis.canvas = {
    grid: squareGrid(),
    tokens: {
      placeables: [farFollower.token, nearFollower.token],
      get: () => leader.object,
    },
  };

  hooks.get("moveToken")(
    leader,
    {
      origin: { x: 300, y: 0 },
      passed: {
        waypoints: [
          { x: 200, y: 0, snapped: true },
          { x: 100, y: 0, snapped: true },
        ],
      },
    },
    {},
    { isSelf: true },
  );
  await flushMovementQueue();

  assert.deepEqual(nearFollower.moves, []);
  assert.deepEqual(farFollower.moves[0].waypoints.at(-1), {
    x: 300,
    y: 0,
    snapped: true,
  });
});

test("moving beyond three followers preserves every grid position", async () => {
  const leader = {
    id: "leader-9",
    getFlag: () => null,
    object: { name: "Leader" },
  };
  const followers = [1, 2, 3].map((spaces) => createFollower({
    id: `follower-9-${spaces}`,
    x: 400 - spaces * 100,
    y: 0,
    leaderId: leader.id,
    distance: spaces * 100,
    gridSpaces: spaces,
    positions: Array.from({ length: spaces + 1 }, (_, index) => ({
      x: 400 - (spaces - index) * 100,
      y: 0,
    })),
  }));
  globalThis.canvas = {
    grid: squareGrid(),
    tokens: {
      placeables: followers.map(({ token }) => token).reverse(),
      get: () => leader.object,
    },
  };

  hooks.get("moveToken")(
    leader,
    {
      origin: { x: 400, y: 0 },
      passed: {
        waypoints: [
          { x: 300, y: 0, snapped: true },
          { x: 200, y: 0, snapped: true },
          { x: 100, y: 0, snapped: true },
          { x: 0, y: 0, snapped: true },
        ],
      },
    },
    {},
    { isSelf: true },
  );
  await flushMovementQueue();

  assert.deepEqual(
    followers.map(({ token }) => ({ x: token.document.x, y: token.document.y })),
    [
      { x: 100, y: 0 },
      { x: 200, y: 0 },
      { x: 300, y: 0 },
    ],
  );
});
