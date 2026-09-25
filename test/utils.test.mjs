import assert from "node:assert/strict";
import test from "node:test";

import {
  appendPath,
  pathLength,
  splitPathAtDistance,
} from "../script/utils.mjs";

test("a direct U-turn removes the retraced route", () => {
  const route = appendPath(
    [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ],
    [
      { x: 100, y: 0 },
      { x: -100, y: 0 },
    ],
  );

  assert.deepEqual(route, [
    { x: 0, y: 0 },
    { x: -100, y: 0 },
  ]);
  assert.equal(pathLength(route), 100);

  const movement = splitPathAtDistance(
    route,
    Math.max(0, pathLength(route) - 100),
  );
  assert.deepEqual(movement.traversed, [{ x: 0, y: 0 }]);
});

test("a step-by-step U-turn waits until the leader is ahead again", () => {
  let route = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ];

  route = appendPath(route, [{ x: 0, y: 0 }]);
  assert.deepEqual(route, [{ x: 0, y: 0 }]);

  route = appendPath(route, [{ x: -100, y: 0 }]);
  assert.deepEqual(
    splitPathAtDistance(route, Math.max(0, pathLength(route) - 100)).traversed,
    [{ x: 0, y: 0 }],
  );

  route = appendPath(route, [{ x: -200, y: 0 }]);
  assert.deepEqual(
    splitPathAtDistance(route, pathLength(route) - 100).traversed,
    [
      { x: 0, y: 0 },
      { x: -100, y: 0 },
    ],
  );
});

test("the follower retains the leader's corner waypoints", () => {
  const route = appendPath(
    [
      { x: 0, y: 0 },
      { x: 0, y: -100 },
    ],
    [
      { x: 0, y: -100 },
      { x: 0, y: -200 },
      { x: -100, y: -200 },
    ],
  );
  const movement = splitPathAtDistance(route, pathLength(route) - 100);

  assert.deepEqual(movement.traversed, [
    { x: 0, y: 0 },
    { x: 0, y: -100 },
    { x: 0, y: -200 },
  ]);
  assert.deepEqual(movement.remaining, [
    { x: 0, y: -200 },
    { x: -100, y: -200 },
  ]);
});

test("crossing an earlier route removes the resulting loop", () => {
  const route = appendPath(
    [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ],
    [{ x: 50, y: -50 }],
  );

  assert.deepEqual(route[0], { x: 0, y: 0 });
  assert.ok(Math.abs(route[1].x - 200 / 3) < 1e-6);
  assert.equal(route[1].y, 0);
  assert.deepEqual(route[2], { x: 50, y: -50 });
});
