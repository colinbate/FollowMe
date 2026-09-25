/*
▓█████▄  ██▀███           ▒█████
▒██▀ ██▌▓██ ▒ ██▒        ▒██▒  ██▒
░██   █▌▓██ ░▄█ ▒        ▒██░  ██▒
░▓█▄   ▌▒██▀▀█▄          ▒██   ██░
░▒████▓ ░██▓ ▒██▒ ██▓    ░ ████▓▒░
 ▒▒▓  ▒ ░ ▒▓ ░▒▓░ ▒▓▒    ░ ▒░▒░▒░
 ░ ▒  ▒   ░▒ ░ ▒░ ░▒       ░ ▒ ▒░
 ░ ░  ░   ░░   ░  ░      ░ ░ ░ ▒
   ░       ░       ░         ░ ░
 ░                 ░
 */
import * as utils from "./utils.mjs";

const MOD_NAME = "FollowMe";
const FLAG_FOLLOWING = "following";
const automatedMovements = new Set();
const movementQueues = new Map();

function lang(k) {
  return game.i18n.localize("FOLLOWME." + k);
}

function strTemplate(s, o) {
  for (let k of Object.keys(o)) {
    s = s.replace("{" + k + "}", o[k]);
  }
  return s;
}

/**
 * Display a text above a token
 * @param {*} token A token object
 * @param {String} text The text to display above the token
 */
function scrollText(token, text) {
  const config = {
    anchor: CONST.TEXT_ANCHOR_POINTS.TOP,
    direction: CONST.TEXT_ANCHOR_POINTS.TOP,
    textStyle: {
      fill: "#FFFFFF",
      stroke: "#000000",
      strokeThickness: 2,
    },
  };
  canvas.interface.createScrollingText(token.center, text, config);
}

async function stopFollowing(token, whom, collided = false) {
  if (collided) {
    scrollText(token.object, strTemplate(lang("collided"), { name: whom }));
  } else {
    scrollText(token.object, strTemplate(lang("stopped"), { name: whom }));
  }
  if (token.isOwner) {
    await token.unsetFlag(MOD_NAME, FLAG_FOLLOWING);
  }
}

function movementPath(movement) {
  return [movement.origin, ...(movement.passed?.waypoints ?? [])];
}

function updateRoute(document, description, positions) {
  return document.update(
    {
      [`flags.${MOD_NAME}.${FLAG_FOLLOWING}`]: {
        ...description,
        positions,
      },
    },
    { by_following: true },
  );
}

function expandGridRoute(follower, route) {
  return canvas.grid
    .getDirectPath(route)
    .map((offset) => canvas.grid.getTopLeftPoint(offset))
    .map((point) => ({ ...follower.getSnappedPosition(point), snapped: true }))
    .filter((point, index, points) =>
      index === 0 || !utils.samePoint(point, points[index - 1]),
    );
}

function splitGridRoute(route, spaces) {
  const spacesToTravel = route.length - 1 - spaces;
  if (spacesToTravel <= 0) return null;
  return {
    traversed: route.slice(0, spacesToTravel + 1),
    remaining: route.slice(spacesToTravel),
  };
}

async function moveFollower(follower, leader, leaderPath, incomingPath) {
  const description = follower.document.getFlag(MOD_NAME, FLAG_FOLLOWING);
  if (!description) return;

  const followerPosition = {
    x: follower.document.x,
    y: follower.document.y,
  };
  const leaderDestination = leaderPath.at(-1);
  const incomingDestination = incomingPath?.traversed.at(-1);
  const useGridSpaces =
    Number.isInteger(description.gridSpaces) &&
    !canvas.grid.isGridless &&
    leaderDestination.snapped === true;
  let path;

  // When a snapped movement passes back through the formation, assign each
  // follower its numbered grid position directly from the leader's path. This
  // prevents the last follower being left underneath a nearer follower.
  if (useGridSpaces) {
    const gridLeaderPath = expandGridRoute(follower, leaderPath);
    const targetIndex = gridLeaderPath.length - 1 - description.gridSpaces;
    const currentIndex = gridLeaderPath.reduce((closest, point, index) => {
      if (!utils.samePoint(point, followerPosition)) return closest;
      if (closest < 0) return index;
      return Math.abs(index - targetIndex) < Math.abs(closest - targetIndex)
        ? index
        : closest;
    }, -1);
    if (targetIndex >= 0 && currentIndex >= 0) {
      const traversed = currentIndex <= targetIndex
        ? gridLeaderPath.slice(currentIndex, targetIndex + 1)
        : gridLeaderPath.slice(targetIndex, currentIndex + 1).reverse();
      path = {
        traversed,
        remaining: gridLeaderPath.slice(targetIndex),
      };
    }
  }

  // If the leader or preceding follower finishes on this follower, pass the
  // vacated position down the line instead of allowing tokens to stack.
  if (!path &&
    incomingDestination &&
    utils.samePoint(followerPosition, incomingDestination)
  ) {
    const reversePath = incomingPath.traversed
      .slice(0, -1)
      .reverse()
      .map(({ x, y, snapped }) => ({ x, y, snapped }));
    path = {
      traversed: [followerPosition, ...reversePath],
      remaining: [
        reversePath.at(-1),
        ...incomingPath.remaining.map(({ x, y }) => ({ x, y })),
      ],
    };
  } else if (!path) {
    let route = utils.appendPath(description.positions, leaderPath);
    if (useGridSpaces) route = expandGridRoute(follower, route);
    const distanceToTravel = useGridSpaces
      ? route.length - 1 - description.gridSpaces
      : utils.pathLength(route) - description.dist;

    if (distanceToTravel <= 0) {
      await updateRoute(follower.document, description, route);
      return { traversed: [followerPosition], remaining: route };
    }

    path = useGridSpaces
      ? splitGridRoute(route, description.gridSpaces)
      : utils.splitPathAtDistance(route, distanceToTravel);
  }

  const leaderSnapped = leaderDestination.snapped === true;
  if (!canvas.grid.isGridless && leaderSnapped) {
    const { x, y } = follower.getSnappedPosition(path.traversed.at(-1));
    const snapped = { x, y };
    path.traversed[path.traversed.length - 1] = { x, y, snapped: true };
    path.remaining[0] = snapped;
  }

  const waypoints = [];
  let previous = followerPosition;
  for (const waypoint of path.traversed.slice(1)) {
    if (utils.samePoint(previous, waypoint)) {
      if (waypoints.length > 0) Object.assign(waypoints.at(-1), waypoint);
      continue;
    }
    waypoints.push(waypoint);
    previous = waypoint;
  }
  if (waypoints.length === 0) {
    await updateRoute(follower.document, description, path.remaining);
    return path;
  }

  const moveOptions = {
    animate: true,
    autoRotate: game.settings.get("core", "tokenAutoRotate"),
    by_following: true,
    pan: false,
    showRuler: false,
    constrainOptions: {
      ignoreCost: true,
    },
  };

  automatedMovements.add(follower.id);
  let completed;
  try {
    completed = await follower.document.move(waypoints, moveOptions);
  } finally {
    automatedMovements.delete(follower.id);
  }

  if (!completed) {
    await stopFollowing(follower.document, leader.name, true);
    return;
  }

  await updateRoute(follower.document, description, path.remaining);
  return path;
}

async function handleMovement(token, movement, automated) {
  const following = token.getFlag(MOD_NAME, FLAG_FOLLOWING);

  if (!automated && following) {
    const leader = canvas.tokens.get(following.who);
    await stopFollowing(token, leader?.name);
  }

  const followers = canvas.tokens.placeables.filter(
    (candidate) =>
      candidate.isOwner &&
      candidate.document.getFlag(MOD_NAME, FLAG_FOLLOWING)?.who === token.id,
  );
  const leaderPath = movementPath(movement);

  followers.sort((a, b) => {
    const aDescription = a.document.getFlag(MOD_NAME, FLAG_FOLLOWING);
    const bDescription = b.document.getFlag(MOD_NAME, FLAG_FOLLOWING);
    if (
      Number.isInteger(aDescription.gridSpaces) &&
      Number.isInteger(bDescription.gridSpaces)
    ) {
      return aDescription.gridSpaces - bDescription.gridSpaces;
    }
    return aDescription.dist - bDescription.dist;
  });

  let incomingPath = {
    traversed: leaderPath,
    remaining: [leaderPath.at(-1)],
  };
  for (const follower of followers) {
    incomingPath = await moveFollower(
      follower,
      token.object,
      leaderPath,
      incomingPath,
    );
    if (!incomingPath) break;
  }
}

// Use Foundry's movement waypoints so followers take the leader's actual route.
Hooks.on("moveToken", (token, movement, operation, user) => {
  if (!user.isSelf) return;

  const automated =
    operation.by_following === true || automatedMovements.has(token.id);
  const previous = movementQueues.get(token.id) ?? Promise.resolve();
  const queued = previous
    .then(() => handleMovement(token, movement, automated))
    .catch((error) => console.error(`${MOD_NAME} | Failed to follow movement`, error))
    .finally(() => {
      if (movementQueues.get(token.id) === queued) movementQueues.delete(token.id);
    });
  movementQueues.set(token.id, queued);
});

function follow() {
  let leader = canvas.tokens.hover;
  let followers = canvas.tokens.controlled;

  if (leader === null || followers.length === 0) {
    return;
  }
  //console.warn("leader", leader);
  //console.warn("followers", followers);

  for (let follower of followers) {
    if (leader.id === follower.id) {
      scrollText(leader, lang("followYourself"));
    } else {
      let token = canvas.tokens.get(follower.id);
      let dist = Math.sqrt(
        (token.x - leader.x) ** 2 + (token.y - leader.y) ** 2,
      );
      const followerSnapped = utils.samePoint(
        token.getSnappedPosition({ x: token.x, y: token.y }),
        token,
      );
      const leaderSnapped = utils.samePoint(
        leader.getSnappedPosition({ x: leader.x, y: leader.y }),
        leader,
      );
      const useGridSpaces =
        !canvas.grid.isGridless && followerSnapped && leaderSnapped;
      const initialRoute = useGridSpaces
        ? expandGridRoute(token, [token, leader])
        : [
            { x: token.x, y: token.y },
            { x: leader.x, y: leader.y },
          ];
      let distance = Math.round(
        (canvas.scene.dimensions.distance * dist) /
          canvas.scene.dimensions.size,
      );

      let text = strTemplate(lang("following"), {
        distance: distance,
        unit: canvas.scene.grid.units,
        name: leader.name,
      });
      scrollText(token, text);
      token.document.setFlag(MOD_NAME, FLAG_FOLLOWING, {
        who: leader.id,
        dist: dist,
        ...(useGridSpaces ? { gridSpaces: initialRoute.length - 1 } : {}),
        positions: initialRoute,
      });
    }
  }
}

async function stopSelectedFollowers() {
  const followers = canvas.tokens.controlled.filter((token) =>
    token.document.getFlag(MOD_NAME, FLAG_FOLLOWING),
  );
  await Promise.all(
    followers.map((token) => {
      const description = token.document.getFlag(MOD_NAME, FLAG_FOLLOWING);
      const leader = canvas.tokens.get(description.who);
      return stopFollowing(token.document, leader?.name);
    }),
  );
}

Hooks.on("combatStart", () => {
  if (!game.user.isGM) return; // Not a DM
  if (!game.settings.get(MOD_NAME, "combat")) return; // We don't care (setting)

  // We are the GM, And this is the very start of the combat.
  canvas.tokens.placeables
    .filter((t) => t.document.getFlag(MOD_NAME, FLAG_FOLLOWING))
    .forEach((t) => {
      let whom = canvas.tokens.get(
        t.document.getFlag(MOD_NAME, FLAG_FOLLOWING).who,
      )?.name;
      stopFollowing(t.document, whom, false);
    });
});

// Settings:
Hooks.once("init", () => {
  game.settings.register(MOD_NAME, "combat", {
    name: lang("combat"),
    hint: lang("combat_hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
  });

  game.keybindings.register(MOD_NAME, "follow", {
    name: "FollowMe",
    hint: lang("key_hint"),
    editable: [
      {
        key: "KeyF",
      },
    ],
    onDown: () => {
      follow();
    },
    restricted: false,
    precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL,
  });

  game.keybindings.register(MOD_NAME, "stopFollowing", {
    name: lang("unfollow"),
    hint: lang("unfollow_hint"),
    editable: [
      {
        key: "KeyF",
        modifiers: ["Shift"],
      },
    ],
    onDown: () => {
      void stopSelectedFollowers().catch((error) =>
        console.error(`${MOD_NAME} | Failed to stop following`, error),
      );
      return true;
    },
    restricted: false,
    precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL,
  });
});
