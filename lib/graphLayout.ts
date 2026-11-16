/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Entity, Relationship } from '../shared/types';

export interface NodePosition {
  x: number;
  y: number;
}

export interface NodeDimension {
  width: number;
  height: number;
}

export function computeNodeDimensions(
  objectEntities: Entity[]
): Record<string, NodeDimension> {
  const dimensions: Record<string, NodeDimension> = {};
  for (const entity of objectEntities) {
    const textWidth = entity.name.length * 8 + 24;
    dimensions[entity.name] = { width: Math.max(64, textWidth), height: 36 };
  }
  return dimensions;
}

export function getIntersection(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  w: number,
  h: number,
  gap: number = 0
): NodePosition {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist === 0) return { x: x1, y: y1 };

  const halfW = w / 2;
  const halfH = h / 2;

  if (dx === 0) {
    return { x: x1, y: y1 + (halfH + gap) * Math.sign(dy) };
  }

  const tanTheta = Math.abs(dy / dx);
  const tanCorner = halfH / halfW;

  if (tanTheta < tanCorner) {
    const sign = Math.sign(dx);
    return {
      x: x1 + (halfW + gap) * sign,
      y: y1 + (halfW + gap) * sign * (dy / dx),
    };
  }

  const sign = Math.sign(dy);
  return {
    x: x1 + (halfH + gap) * sign * (dx / dy),
    y: y1 + (halfH + gap) * sign,
  };
}

export function computeParallelEdgeOffsets(
  relationships: Relationship[]
): Record<string, number> {
  const groups = new Map<string, Relationship[]>();
  for (const rel of relationships) {
    const pairKey = [rel.source.toLowerCase(), rel.target.toLowerCase()].sort().join('::');
    const list = groups.get(pairKey) ?? [];
    list.push(rel);
    groups.set(pairKey, list);
  }

  const offsets: Record<string, number> = {};
  for (const [, list] of groups.entries()) {
    if (list.length <= 1) {
      const r = list[0];
      if (r) {
        const key = r.id ?? `${r.source}->${r.target}::${r.label}`;
        offsets[key] = 0;
      }
      continue;
    }

    const spacing = 28;
    list.forEach((r, idx) => {
      const key = r.id ?? `${r.source}->${r.target}::${r.label}`;
      offsets[key] = (idx - (list.length - 1) / 2) * spacing;
    });
  }

  return offsets;
}

export function getEdgePath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  sourceW: number,
  sourceH: number,
  targetW: number,
  targetH: number,
  curveOffset: number = 0
): { path: string; labelX: number; labelY: number } {
  const start = getIntersection(x1, y1, x2, y2, sourceW, sourceH, 0);
  const end = getIntersection(x2, y2, x1, y1, targetW, targetH, 5);

  if (Math.abs(curveOffset) < 0.5) {
    const path = `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
    const labelX = (start.x + end.x) / 2;
    const labelY = (start.y + end.y) / 2;
    return { path, labelX, labelY };
  }

  // Canonical normal vector so A->B and B->A with different signed curveOffsets bend in opposite directions
  const isCanonicalOrder = x1 < x2 || (x1 === x2 && y1 <= y2);
  const canonicalDx = isCanonicalOrder ? end.x - start.x : start.x - end.x;
  const canonicalDy = isCanonicalOrder ? end.y - start.y : start.y - end.y;
  const len = Math.hypot(canonicalDx, canonicalDy) || 1;
  const nx = -canonicalDy / len;
  const ny = canonicalDx / len;

  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;
  const ctrlX = midX + nx * curveOffset * 1.6;
  const ctrlY = midY + ny * curveOffset * 1.6;

  const labelX = 0.25 * start.x + 0.5 * ctrlX + 0.25 * end.x;
  const labelY = 0.25 * start.y + 0.5 * ctrlY + 0.25 * end.y;
  const path = `M ${start.x} ${start.y} Q ${ctrlX} ${ctrlY} ${end.x} ${end.y}`;

  return { path, labelX, labelY };
}

interface SimNode {
  id: string;
  width: number;
  height: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fx: number;
  fy: number;
}

export function computeForceLayout(params: {
  objectEntities: Entity[];
  relationships: Relationship[];
  nodeDimensions: Record<string, NodeDimension>;
  containerWidth: number;
  containerHeight: number;
  previousPositions?: Record<string, NodePosition>;
}): Record<string, NodePosition> {
  const {
    objectEntities,
    relationships,
    nodeDimensions,
    containerWidth,
    containerHeight,
    previousPositions = {},
  } = params;

  if (objectEntities.length === 0) return {};

  const width = containerWidth > 0 ? containerWidth : 600;
  const height = containerHeight > 0 ? containerHeight : 400;

  const nodeCount = objectEntities.length;
  const SIMULATION_TICKS =
    nodeCount <= 30 ? 600 : nodeCount <= 100 ? 220 : nodeCount <= 250 ? 90 : 40;
  const COLLISION_PASSES = nodeCount <= 30 ? 3 : nodeCount <= 100 ? 2 : 1;
  const REPULSION_STRENGTH = 26000;
  const LINK_STRENGTH = 0.22;
  const CENTER_GRAVITY_X = 0.002;
  const CENTER_GRAVITY_Y = 0.0075;
  const COLLISION_PADDING = 52;
  const DAMPING = 0.78;

  const initRadiusX = width * 0.32;
  const initRadiusY = height * 0.26;
  const nodes: SimNode[] = objectEntities.map((entity, i) => {
    const prev = previousPositions[entity.name];
    const dims = nodeDimensions[entity.name] ?? { width: 90, height: 36 };
    if (prev && Number.isFinite(prev.x) && Number.isFinite(prev.y)) {
      return {
        id: entity.name,
        width: dims.width,
        height: dims.height,
        x: prev.x,
        y: prev.y,
        vx: 0,
        vy: 0,
        fx: 0,
        fy: 0,
      };
    }
    const angle = (i / objectEntities.length) * 2 * Math.PI;
    return {
      id: entity.name,
      width: dims.width,
      height: dims.height,
      x: width / 2 + initRadiusX * Math.cos(angle),
      y: height / 2 + initRadiusY * Math.sin(angle),
      vx: 0,
      vy: 0,
      fx: 0,
      fy: 0,
    };
  });

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const links = relationships
    .map((rel) => ({
      source: nodeMap.get(rel.source),
      target: nodeMap.get(rel.target),
      label: rel.label,
    }))
    .filter(
      (link): link is { source: SimNode; target: SimNode; label: string } =>
        Boolean(link.source && link.target)
    );

  for (let tick = 0; tick < SIMULATION_TICKS; tick++) {
    for (const node of nodes) {
      node.fx = 0;
      node.fy = 0;
    }

    // Node-node repulsion
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const nodeA = nodes[i];
        const nodeB = nodes[j];
        const dx = nodeB.x - nodeA.x;
        const dy = nodeB.y - nodeA.y;
        let distanceSq = dx * dx + dy * dy;
        if (distanceSq === 0) distanceSq = 1;
        const distance = Math.sqrt(distanceSq);
        const force = REPULSION_STRENGTH / distanceSq;
        nodeA.fx -= (dx / distance) * force;
        nodeA.fy -= (dy / distance) * force;
        nodeB.fx += (dx / distance) * force;
        nodeB.fy += (dy / distance) * force;
      }
    }

    if (nodeCount <= 120) {
      // Keep nodes away from edge midpoint labels
      for (const link of links) {
        const midX = (link.source.x + link.target.x) / 2;
        const midY = (link.source.y + link.target.y) / 2;
        const labelWidth = (link.label || '').length * 6 + 10;
        for (const node of nodes) {
          if (node === link.source || node === link.target) continue;
          const dx = node.x - midX;
          const dy = node.y - midY;
          let dist = Math.sqrt(dx * dx + dy * dy);
          if (dist === 0) dist = 1;
          const threshold =
            labelWidth / 2 + Math.max(node.width, node.height) / 2 + 16;
          if (dist < threshold) {
            const forceStrength = (threshold - dist) * 1.2;
            node.fx += (dx / dist) * forceStrength;
            node.fy += (dy / dist) * forceStrength;
          }
        }
      }

      // Keep edge midpoint labels separated
      for (let i = 0; i < links.length; i++) {
        for (let j = i + 1; j < links.length; j++) {
          const l1 = links[i];
          const l2 = links[j];
          const m1x = (l1.source.x + l1.target.x) / 2;
          const m1y = (l1.source.y + l1.target.y) / 2;
          const m2x = (l2.source.x + l2.target.x) / 2;
          const m2y = (l2.source.y + l2.target.y) / 2;
          const dx = m1x - m2x;
          const dy = m1y - m2y;
          let dist = Math.sqrt(dx * dx + dy * dy);
          if (dist === 0) dist = 0.1;
          const minDist =
            ((l1.label?.length || 0) * 7 + 36 + (l2.label?.length || 0) * 7 + 36) /
              2 +
            20;
          if (dist < minDist) {
            const force = (minDist - dist) * 0.8;
            l1.source.fx += (dx / dist) * force * 0.5;
            l1.source.fy += (dy / dist) * force * 0.5;
            l1.target.fx += (dx / dist) * force * 0.5;
            l1.target.fy += (dy / dist) * force * 0.5;
            l2.source.fx -= (dx / dist) * force * 0.5;
            l2.source.fy -= (dy / dist) * force * 0.5;
            l2.target.fx -= (dx / dist) * force * 0.5;
            l2.target.fy -= (dy / dist) * force * 0.5;
          }
        }
      }
    }

    // Spring forces along links
    for (const link of links) {
      const dx = link.target.x - link.source.x;
      const dy = link.target.y - link.source.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const sourceR = link.source.width / 2;
      const targetR = link.target.width / 2;
      const idealVisibleLength = (link.label || '').length * 5.5 + 34;
      const targetDist = sourceR + targetR + idealVisibleLength;
      if (distance > 0) {
        const diff = distance - targetDist;
        const force = LINK_STRENGTH * diff;
        link.source.fx += (dx / distance) * force;
        link.source.fy += (dy / distance) * force;
        link.target.fx -= (dx / distance) * force;
        link.target.fy -= (dy / distance) * force;
      }
    }

    // Center gravity & velocity integration
    for (const node of nodes) {
      node.fx += (width / 2 - node.x) * CENTER_GRAVITY_X;
      node.fy += (height / 2 - node.y) * CENTER_GRAVITY_Y;
      node.vx = (node.vx + node.fx) * DAMPING;
      node.vy = (node.vy + node.fy) * DAMPING;
      node.x += node.vx;
      node.y += node.vy;
    }

    // Collision resolution
    for (let k = 0; k < COLLISION_PASSES; k++) {
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const nodeA = nodes[i];
          const nodeB = nodes[j];
          const dx = nodeB.x - nodeA.x;
          const dy = nodeB.y - nodeA.y;
          const overlapX =
            nodeA.width / 2 + nodeB.width / 2 + COLLISION_PADDING - Math.abs(dx);
          const overlapY =
            nodeA.height / 2 + nodeB.height / 2 + COLLISION_PADDING - Math.abs(dy);
          if (overlapX > 0 && overlapY > 0) {
            if (overlapX < overlapY) {
              const sign = dx === 0 ? (i % 2 === 0 ? 1 : -1) : Math.sign(dx);
              nodeA.x -= (overlapX / 2) * sign;
              nodeB.x += (overlapX / 2) * sign;
            } else {
              const sign = dy === 0 ? (j % 2 === 0 ? 1 : -1) : Math.sign(dy);
              nodeA.y -= (overlapY / 2) * sign;
              nodeB.y += (overlapY / 2) * sign;
            }
          }
        }
      }
    }
  }

  // Center graph bounding box in container
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    maxX = Math.max(maxX, n.x);
    minY = Math.min(minY, n.y);
    maxY = Math.max(maxY, n.y);
  }
  const offsetX = width / 2 - (minX + maxX) / 2;
  const offsetY = height / 2 - (minY + maxY) / 2;

  const finalPositions: Record<string, NodePosition> = {};
  for (const node of nodes) {
    finalPositions[node.id] = { x: node.x + offsetX, y: node.y + offsetY };
  }
  return finalPositions;
}

export interface ViewTransform {
  x: number;
  y: number;
  k: number;
}

export function computeFitTransform(
  nodePositions: Record<string, NodePosition>,
  nodeDimensions: Record<string, NodeDimension>,
  containerWidth: number,
  containerHeight: number,
  padding: number = 44
): ViewTransform {
  const entries = Object.entries(nodePositions);
  if (entries.length === 0 || containerWidth <= 0 || containerHeight <= 0) {
    return { x: 0, y: 0, k: 1 };
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const [name, pos] of entries) {
    const dims = nodeDimensions[name] ?? { width: 90, height: 36 };
    minX = Math.min(minX, pos.x - dims.width / 2);
    maxX = Math.max(maxX, pos.x + dims.width / 2);
    minY = Math.min(minY, pos.y - dims.height / 2);
    maxY = Math.max(maxY, pos.y + dims.height / 2);
  }

  const bboxW = Math.max(1, maxX - minX);
  const bboxH = Math.max(1, maxY - minY);
  const availW = Math.max(80, containerWidth - padding * 2);
  const availH = Math.max(80, containerHeight - padding * 2);

  const k = Math.min(1, Math.max(0.35, Math.min(availW / bboxW, availH / bboxH)));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  return {
    x: containerWidth / 2 - cx * k,
    y: containerHeight / 2 - cy * k,
    k,
  };
}

