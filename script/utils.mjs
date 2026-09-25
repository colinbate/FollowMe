const EPSILON = 1e-6;

export function pointDistance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function samePoint(a, b) {
  return pointDistance(a, b) <= EPSILON;
}

export function pathLength(points) {
  let length = 0;
  for (let i = 1; i < points.length; i += 1) {
    length += pointDistance(points[i - 1], points[i]);
  }
  return length;
}

function interpolate(a, b, fraction) {
  return {
    x: a.x + (b.x - a.x) * fraction,
    y: a.y + (b.y - a.y) * fraction,
  };
}

function cross(a, b) {
  return a.x * b.y - a.y * b.x;
}

function subtract(a, b) {
  return { x: a.x - b.x, y: a.y - b.y };
}

/**
 * Find where a newly-added segment first re-enters an existing route.
 * Returning the end of a collinear overlap is what collapses a U-turn.
 */
function segmentIntersection(start, end, routeStart, routeEnd) {
  const movement = subtract(end, start);
  const route = subtract(routeEnd, routeStart);
  const denominator = cross(movement, route);
  const offset = subtract(routeStart, start);

  if (Math.abs(denominator) > EPSILON) {
    const movementFraction = cross(offset, route) / denominator;
    const routeFraction = cross(offset, movement) / denominator;
    if (
      movementFraction > EPSILON &&
      movementFraction <= 1 + EPSILON &&
      routeFraction >= -EPSILON &&
      routeFraction <= 1 + EPSILON
    ) {
      return {
        point: interpolate(start, end, Math.min(movementFraction, 1)),
        movementFraction,
      };
    }
    return null;
  }

  if (Math.abs(cross(offset, movement)) > EPSILON) return null;

  const movementLengthSquared =
    movement.x * movement.x + movement.y * movement.y;
  if (movementLengthSquared <= EPSILON) return null;

  const startFraction =
    ((routeStart.x - start.x) * movement.x +
      (routeStart.y - start.y) * movement.y) /
    movementLengthSquared;
  const endFraction =
    ((routeEnd.x - start.x) * movement.x +
      (routeEnd.y - start.y) * movement.y) /
    movementLengthSquared;
  const overlapEnd = Math.min(1, Math.max(startFraction, endFraction));
  const overlapStart = Math.max(0, Math.min(startFraction, endFraction));

  if (overlapEnd <= EPSILON || overlapStart > overlapEnd + EPSILON) return null;
  return {
    point: interpolate(start, end, overlapEnd),
    movementFraction: overlapEnd,
  };
}

function appendPoint(route, point) {
  if (samePoint(route.at(-1), point)) return route;

  let result = route;
  while (!samePoint(result.at(-1), point)) {
    const start = result.at(-1);
    let firstIntersection = null;

    for (let i = 0; i < result.length - 1; i += 1) {
      const intersection = segmentIntersection(
        start,
        point,
        result[i],
        result[i + 1],
      );
      if (
        intersection &&
        (!firstIntersection ||
          intersection.movementFraction < firstIntersection.movementFraction)
      ) {
        firstIntersection = { ...intersection, segmentIndex: i };
      }
    }

    if (!firstIntersection) {
      result.push({ x: point.x, y: point.y });
      break;
    }

    result = result.slice(0, firstIntersection.segmentIndex + 1);
    if (!samePoint(result.at(-1), firstIntersection.point)) {
      result.push(firstIntersection.point);
    }
  }

  return result;
}

/**
 * Add travelled waypoints to a route, removing loops and retraced sections.
 */
export function appendPath(route, points) {
  let result = route.map(({ x, y }) => ({ x, y }));
  for (const point of points) {
    if (Number.isFinite(point?.x) && Number.isFinite(point?.y)) {
      result = appendPoint(result, point);
    }
  }
  return result;
}

/**
 * Split a route at a distance from its beginning.
 */
export function splitPathAtDistance(points, distance) {
  if (points.length === 0) return { traversed: [], remaining: [] };
  if (distance <= EPSILON) {
    return {
      traversed: [points[0]],
      remaining: points.map(({ x, y }) => ({ x, y })),
    };
  }

  let travelled = 0;
  for (let i = 1; i < points.length; i += 1) {
    const segmentLength = pointDistance(points[i - 1], points[i]);
    if (travelled + segmentLength + EPSILON >= distance) {
      const fraction = Math.min((distance - travelled) / segmentLength, 1);
      const splitPoint = interpolate(points[i - 1], points[i], fraction);
      const traversed = points.slice(0, i).map(({ x, y }) => ({ x, y }));
      const remaining = points.slice(i).map(({ x, y }) => ({ x, y }));

      if (!samePoint(traversed.at(-1), splitPoint)) traversed.push(splitPoint);
      if (!samePoint(splitPoint, remaining[0])) remaining.unshift(splitPoint);

      return { traversed, remaining };
    }
    travelled += segmentLength;
  }

  const copied = points.map(({ x, y }) => ({ x, y }));
  return { traversed: copied, remaining: [copied.at(-1)] };
}
