'use strict';

const { Position } = require('../types/position');
const { Range } = require('../types/range');

function numberOrZero(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function atomPointParts(point) {
  if (!point) return null;
  if (point instanceof Position) return { row: point.line, column: point.character };
  if (Array.isArray(point)) return { row: numberOrZero(point[0]), column: numberOrZero(point[1]) };
  if (typeof point.row === 'number' || typeof point.column === 'number') {
    return { row: numberOrZero(point.row), column: numberOrZero(point.column) };
  }
  if (typeof point.line === 'number' || typeof point.character === 'number') {
    return { row: numberOrZero(point.line), column: numberOrZero(point.character) };
  }
  return null;
}

function positionParts(position) {
  if (!position) return null;
  if (position instanceof Position) return { line: position.line, character: position.character };
  if (Array.isArray(position)) return { line: numberOrZero(position[0]), character: numberOrZero(position[1]) };
  if (typeof position.line === 'number' || typeof position.character === 'number') {
    return { line: numberOrZero(position.line), character: numberOrZero(position.character) };
  }
  if (typeof position.row === 'number' || typeof position.column === 'number') {
    return { line: numberOrZero(position.row), character: numberOrZero(position.column) };
  }
  return null;
}

function atomPointToPosition(point) {
  if (point instanceof Position) return point;
  const parts = atomPointParts(point);
  return new Position(parts ? parts.row : 0, parts ? parts.column : 0);
}

function positionToAtomPoint(position) {
  const parts = positionParts(position);
  if (!parts) return null;
  return [parts.line, parts.character];
}

function positionToAtomPointObject(position) {
  const parts = positionParts(position);
  if (!parts) return null;
  return { row: parts.line, column: parts.character };
}

function atomRangeParts(range) {
  if (!range) return null;
  if (range instanceof Range) return { start: range.start, end: range.end };
  if (Array.isArray(range) && range.length >= 2) {
    return { start: atomPointToPosition(range[0]), end: atomPointToPosition(range[1]) };
  }
  if (range.start || range.end) {
    return {
      start: atomPointToPosition(range.start || range.end),
      end: atomPointToPosition(range.end || range.start)
    };
  }
  return null;
}

function rangeParts(range) {
  if (!range) return null;
  if (range instanceof Range) return { start: range.start, end: range.end };
  if (Array.isArray(range) && range.length >= 2) {
    return { start: atomPointToPosition(range[0]), end: atomPointToPosition(range[1]) };
  }
  if (range.start || range.end) {
    return {
      start: atomPointToPosition(range.start || range.end),
      end: atomPointToPosition(range.end || range.start)
    };
  }
  return null;
}

function atomRangeToRange(range) {
  if (range instanceof Range) return range;
  const parts = atomRangeParts(range);
  if (!parts) return null;
  return new Range(parts.start, parts.end);
}

function rangeToAtomRange(range) {
  if (!range) return null;
  const parts = rangeParts(range);
  if (!parts) return null;
  return [positionToAtomPoint(parts.start), positionToAtomPoint(parts.end)];
}

function rangeToAtomRangeObject(range) {
  const parts = rangeParts(range);
  if (!parts) return null;
  return makeAtomRangeObject(positionToAtomPointObject(parts.start), positionToAtomPointObject(parts.end));
}

function makeAtomRangeObject(start, end) {
  if (!start || !end) return null;
  return {
    start,
    end,
    containsPoint(point) {
      const pos = normalizeComparableAtomPoint(point);
      return !!pos && compareAtomPoints(this.start, pos) <= 0 && compareAtomPoints(pos, this.end) <= 0;
    },
    intersectsWith(other) {
      const otherStart = other && normalizeComparableAtomPoint(other.start || (Array.isArray(other) && other[0]));
      const otherEnd = other && normalizeComparableAtomPoint(other.end || (Array.isArray(other) && other[1]));
      if (!otherStart || !otherEnd) return false;
      return compareAtomPoints(this.start, otherEnd) <= 0 && compareAtomPoints(otherStart, this.end) <= 0;
    }
  };
}

function normalizeComparableAtomPoint(point) {
  const parts = atomPointParts(point);
  return parts ? { row: parts.row, column: parts.column } : null;
}

function compareAtomPoints(a, b) {
  const left = normalizeComparableAtomPoint(a);
  const right = normalizeComparableAtomPoint(b);
  if (!left || !right) return 0;
  if (left.row < right.row) return -1;
  if (left.row > right.row) return 1;
  if (left.column < right.column) return -1;
  if (left.column > right.column) return 1;
  return 0;
}

module.exports = {
  atomPointToPosition,
  positionToAtomPoint,
  positionToAtomPointObject,
  atomRangeToRange,
  rangeToAtomRange,
  rangeToAtomRangeObject,
  compareAtomPoints
};
