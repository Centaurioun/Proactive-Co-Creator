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

export interface ViewTransform {
  x: number;
  y: number;
  k: number;
}

export interface ForceLayoutParams {
  objectEntities: Entity[];
  relationships: Relationship[];
  nodeDimensions: Record<string, NodeDimension>;
  containerWidth: number;
  containerHeight: number;
  previousPositions?: Record<string, NodePosition>;
}

const REPULSION_STRENGTH = 26000;
const LINK_STRENGTH = 0.22;
const CENTER_GRAVITY_X = 0.002;
const CENTER_GRAVITY_Y = 0.0075;
const COLLISION_PADDING = 52;
const DAMPING = 0.78;

export function getEntityGraphKey(entity: Pick<Entity, 'id' | 'name'>): string {
  return entity.id ?? entity.name;
}

function computeDimensionsMap(
  objectEntities: Entity[],
  keyFn: (entity: Entity) => string
): Record<string, NodeDimension> {
  const dimensions: Record<string, NodeDimension> = {};
  for (const entity of objectEntities) {
    const textWidth = entity.name.length * 8 + 24;
    dimensions[keyFn(entity)] = { width: Math.max(64, textWidth), height: 36 };
  }
  return dimensions;
}

export function computeNodeDimensions(
  objectEntities: Entity[]
): Record<string, NodeDimension> {
  return computeDimensionsMap(objectEntities, (entity) => entity.name);
}

export function computeNodeDimensionsByKey(
  objectEntities: Entity[]
): Record<string, NodeDimension> {
  return computeDimensionsMap(objectEntities, getEntityGraphKey);
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
  if (dx * dx + dy * dy === 0) return { x: x1, y: y1 };

  const halfW = w / 2;
  const halfH = h / 2;
  if (dx === 0) return { x: x1, y: y1 + (halfH + gap) * Math.sign(dy) };

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

function getRelationshipOffsetKey(rel: Relationship): string {
  return rel.id ?? `${rel.source}->${rel.target}::${rel.label}`;
}

function groupRelationshipsByPair(relationships: Relationship[]): Map<string, Relationship[]> {
  const groups = new Map<string, Relationship[]>();
  for (const rel of relationships) {
    const sourceKey = rel.sourceId ?? rel.source.toLowerCase();
    const targetKey = rel.targetId ?? rel.target.toLowerCase();
    const pairKey = sourceKey <= targetKey ? `${sourceKey}::${targetKey}` : `${targetKey}::${sourceKey}`;
    const list = groups.get(pairKey);
    if (list) {
      list.push(rel);
    } else {
      groups.set(pairKey, [rel]);
    }
  }
  return groups;
}

export function computeParallelEdgeOffsets(
  relationships: Relationship[]
): Record<string, number> {
  const groups = groupRelationshipsByPair(relationships);
  const offsets: Record<string, number> = {};
  const spacing = 28;

  for (const list of groups.values()) {
    if (list.length <= 1) {
      if (list[0]) offsets[getRelationshipOffsetKey(list[0])] = 0;
      continue;
    }
    const mid = (list.length - 1) / 2;
    for (let idx = 0; idx < list.length; idx++) {
      offsets[getRelationshipOffsetKey(list[idx])] = (idx - mid) * spacing;
    }
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
    return {
      path: `M ${start.x} ${start.y} L ${end.x} ${end.y}`,
      labelX: (start.x + end.x) / 2,
      labelY: (start.y + end.y) / 2,
    };
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

  return {
    path: `M ${start.x} ${start.y} Q ${ctrlX} ${ctrlY} ${end.x} ${end.y}`,
    labelX: 0.25 * start.x + 0.5 * ctrlX + 0.25 * end.x,
    labelY: 0.25 * start.y + 0.5 * ctrlY + 0.25 * end.y,
  };
}

interface SimNode {
  id: string;
  name: string;
  halfW: number;
  halfH: number;
  paddedHalfW: number;
  paddedHalfH: number;
  halfMaxDim: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fx: number;
  fy: number;
}

interface SimLink {
  source: SimNode;
  target: SimNode;
  nodeAvoidBase: number;
  edgeLabelHalfSpan: number;
  targetDist: number;
}

interface InitNodesOptions {
  objectEntities: Entity[];
  nodeDimensions: Record<string, NodeDimension>;
  previousPositions: Record<string, NodePosition>;
  width: number;
  height: number;
  keyFn: (entity: Entity) => string;
}

function initializeSimNodes(options: InitNodesOptions): SimNode[] {
  const { objectEntities, nodeDimensions, previousPositions, width, height, keyFn } = options;
  const initRadiusX = width * 0.32;
  const initRadiusY = height * 0.26;
  const halfPad = COLLISION_PADDING / 2;
  const count = objectEntities.length;

  return objectEntities.map((entity, i) => {
    const key = keyFn(entity);
    const prev = previousPositions[key];
    const dims = nodeDimensions[key] ?? { width: 90, height: 36 };
    const halfW = dims.width / 2;
    const halfH = dims.height / 2;
    const hasPrev = Boolean(prev && Number.isFinite(prev.x) && Number.isFinite(prev.y));
    const angle = (i / count) * 2 * Math.PI;
    return {
      id: key,
      name: entity.name,
      halfW,
      halfH,
      paddedHalfW: halfW + halfPad,
      paddedHalfH: halfH + halfPad,
      halfMaxDim: Math.max(dims.width, dims.height) / 2,
      x: hasPrev ? prev!.x : width / 2 + initRadiusX * Math.cos(angle),
      y: hasPrev ? prev!.y : height / 2 + initRadiusY * Math.sin(angle),
      vx: 0,
      vy: 0,
      fx: 0,
      fy: 0,
    };
  });
}

function resolveEndpointNode(
  maps: { byId: Map<string, SimNode>; byName: Map<string, SimNode> },
  idValue: string | undefined,
  nameValue: string,
  useIds: boolean
): SimNode | undefined {
  if (!useIds) return maps.byId.get(nameValue);
  const byId = idValue ? maps.byId.get(idValue) : undefined;
  return byId ?? maps.byId.get(nameValue) ?? maps.byName.get(nameValue);
}

function buildSimLinks(
  nodes: SimNode[],
  relationships: Relationship[],
  useIds: boolean
): SimLink[] {
  const byId = new Map<string, SimNode>();
  const byName = new Map<string, SimNode>();
  for (const node of nodes) {
    byId.set(node.id, node);
    if (!byName.has(node.name)) byName.set(node.name, node);
  }
  const maps = { byId, byName };

  const links: SimLink[] = [];
  for (const rel of relationships) {
    const source = resolveEndpointNode(maps, rel.sourceId, rel.source, useIds);
    const target = resolveEndpointNode(maps, rel.targetId, rel.target, useIds);
    if (!source || !target) continue;

    const labelLen = rel.label?.length ?? 0;
    links.push({
      source,
      target,
      nodeAvoidBase: (labelLen * 6 + 10) / 2 + 16,
      edgeLabelHalfSpan: (labelLen * 7 + 36) / 2,
      targetDist: source.halfW + target.halfW + labelLen * 5.5 + 34,
    });
  }
  return links;
}

function applyRepulsionForces(nodes: SimNode[]): void {
  const len = nodes.length;
  for (let i = 0; i < len; i++) {
    const nodeA = nodes[i];
    for (let j = i + 1; j < len; j++) {
      const nodeB = nodes[j];
      const dx = nodeB.x - nodeA.x;
      const dy = nodeB.y - nodeA.y;
      let distanceSq = dx * dx + dy * dy;
      if (distanceSq === 0) distanceSq = 1;
      const distance = Math.sqrt(distanceSq);
      const force = REPULSION_STRENGTH / distanceSq;
      const fx = (dx / distance) * force;
      const fy = (dy / distance) * force;
      nodeA.fx -= fx;
      nodeA.fy -= fy;
      nodeB.fx += fx;
      nodeB.fy += fy;
    }
  }
}

function applyLabelNodeAvoidance(
  nodes: SimNode[],
  links: SimLink[],
  midXs: Float64Array,
  midYs: Float64Array
): void {
  const linkCount = links.length;
  const nodeCount = nodes.length;
  for (let li = 0; li < linkCount; li++) {
    const link = links[li];
    const midX = midXs[li];
    const midY = midYs[li];
    const avoidBase = link.nodeAvoidBase;
    for (let ni = 0; ni < nodeCount; ni++) {
      const node = nodes[ni];
      if (node === link.source || node === link.target) continue;
      const threshold = avoidBase + node.halfMaxDim;
      const dx = node.x - midX;
      const dy = node.y - midY;
      const distSq = dx * dx + dy * dy;
      if (distSq >= threshold * threshold) continue;
      const dist = distSq === 0 ? 1 : Math.sqrt(distSq);
      const forceStrength = (threshold - dist) * 1.2;
      node.fx += (dx / dist) * forceStrength;
      node.fy += (dy / dist) * forceStrength;
    }
  }
}

function applyLabelEdgeAvoidance(
  links: SimLink[],
  midXs: Float64Array,
  midYs: Float64Array
): void {
  const linkCount = links.length;
  for (let i = 0; i < linkCount; i++) {
    const l1 = links[i];
    const m1x = midXs[i];
    const m1y = midYs[i];
    const baseSpan = l1.edgeLabelHalfSpan + 20;
    for (let j = i + 1; j < linkCount; j++) {
      const l2 = links[j];
      const minDist = baseSpan + l2.edgeLabelHalfSpan;
      const dx = m1x - midXs[j];
      const dy = m1y - midYs[j];
      const distSq = dx * dx + dy * dy;
      if (distSq >= minDist * minDist) continue;
      const dist = distSq === 0 ? 0.1 : Math.sqrt(distSq);
      const halfForce = ((minDist - dist) * 0.8) * 0.5;
      const fx = (dx / dist) * halfForce;
      const fy = (dy / dist) * halfForce;
      l1.source.fx += fx;
      l1.source.fy += fy;
      l1.target.fx += fx;
      l1.target.fy += fy;
      l2.source.fx -= fx;
      l2.source.fy -= fy;
      l2.target.fx -= fx;
      l2.target.fy -= fy;
    }
  }
}

function applyLinkSprings(links: SimLink[]): void {
  for (let i = 0; i < links.length; i++) {
    const link = links[i];
    const dx = link.target.x - link.source.x;
    const dy = link.target.y - link.source.y;
    const distSq = dx * dx + dy * dy;
    if (distSq === 0) continue;
    const distance = Math.sqrt(distSq);
    const force = LINK_STRENGTH * (distance - link.targetDist);
    const fx = (dx / distance) * force;
    const fy = (dy / distance) * force;
    link.source.fx += fx;
    link.source.fy += fy;
    link.target.fx -= fx;
    link.target.fy -= fy;
  }
}

function integrateVelocities(nodes: SimNode[], halfWidth: number, halfHeight: number): void {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    node.fx += (halfWidth - node.x) * CENTER_GRAVITY_X;
    node.fy += (halfHeight - node.y) * CENTER_GRAVITY_Y;
    node.vx = (node.vx + node.fx) * DAMPING;
    node.vy = (node.vy + node.fy) * DAMPING;
    node.x += node.vx;
    node.y += node.vy;
  }
}

function separateOverlappingPair(
  nodeA: SimNode,
  nodeB: SimNode,
  indexA: number,
  indexB: number
): void {
  const dx = nodeB.x - nodeA.x;
  const overlapX = nodeA.paddedHalfW + nodeB.paddedHalfW - Math.abs(dx);
  if (overlapX <= 0) return;

  const dy = nodeB.y - nodeA.y;
  const overlapY = nodeA.paddedHalfH + nodeB.paddedHalfH - Math.abs(dy);
  if (overlapY <= 0) return;

  if (overlapX < overlapY) {
    const sign = dx === 0 ? (indexA % 2 === 0 ? 1 : -1) : Math.sign(dx);
    const shift = (overlapX / 2) * sign;
    nodeA.x -= shift;
    nodeB.x += shift;
  } else {
    const sign = dy === 0 ? (indexB % 2 === 0 ? 1 : -1) : Math.sign(dy);
    const shift = (overlapY / 2) * sign;
    nodeA.y -= shift;
    nodeB.y += shift;
  }
}

function resolveNodeCollisions(nodes: SimNode[], passes: number): void {
  const len = nodes.length;
  for (let k = 0; k < passes; k++) {
    for (let i = 0; i < len; i++) {
      const nodeA = nodes[i];
      for (let j = i + 1; j < len; j++) {
        separateOverlappingPair(nodeA, nodes[j], i, j);
      }
    }
  }
}

interface TickContext {
  nodes: SimNode[];
  links: SimLink[];
  midXs: Float64Array;
  midYs: Float64Array;
  applyLabelForces: boolean;
  halfWidth: number;
  halfHeight: number;
  collisionPasses: number;
}

function stepSimulationTick(ctx: TickContext): void {
  const { nodes, links, midXs, midYs, applyLabelForces, halfWidth, halfHeight, collisionPasses } = ctx;
  for (let i = 0; i < nodes.length; i++) {
    nodes[i].fx = 0;
    nodes[i].fy = 0;
  }

  applyRepulsionForces(nodes);

  if (applyLabelForces) {
    for (let li = 0; li < links.length; li++) {
      midXs[li] = (links[li].source.x + links[li].target.x) / 2;
      midYs[li] = (links[li].source.y + links[li].target.y) / 2;
    }
    applyLabelNodeAvoidance(nodes, links, midXs, midYs);
    applyLabelEdgeAvoidance(links, midXs, midYs);
  }

  applyLinkSprings(links);
  integrateVelocities(nodes, halfWidth, halfHeight);
  resolveNodeCollisions(nodes, collisionPasses);
}

function centerAndExportPositions(
  nodes: SimNode[],
  width: number,
  height: number
): Record<string, NodePosition> {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    if (n.x < minX) minX = n.x;
    if (n.x > maxX) maxX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.y > maxY) maxY = n.y;
  }
  const offsetX = width / 2 - (minX + maxX) / 2;
  const offsetY = height / 2 - (minY + maxY) / 2;

  const finalPositions: Record<string, NodePosition> = {};
  for (const node of nodes) {
    finalPositions[node.id] = { x: node.x + offsetX, y: node.y + offsetY };
  }
  return finalPositions;
}

function selectTickSchedule(nodeCount: number): { ticks: number; passes: number } {
  if (nodeCount <= 30) return { ticks: 600, passes: 3 };
  if (nodeCount <= 100) return { ticks: 220, passes: 2 };
  if (nodeCount <= 250) return { ticks: 90, passes: 1 };
  return { ticks: 40, passes: 1 };
}

function runForceLayout(
  params: ForceLayoutParams,
  keyFn: (entity: Entity) => string,
  useIds: boolean
): Record<string, NodePosition> {
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
  const { ticks, passes } = selectTickSchedule(nodeCount);

  const nodes = initializeSimNodes({
    objectEntities,
    nodeDimensions,
    previousPositions,
    width,
    height,
    keyFn,
  });
  const links = buildSimLinks(nodes, relationships, useIds);
  const ctx: TickContext = {
    nodes,
    links,
    midXs: new Float64Array(links.length),
    midYs: new Float64Array(links.length),
    applyLabelForces: nodeCount <= 120 && links.length > 0,
    halfWidth: width / 2,
    halfHeight: height / 2,
    collisionPasses: passes,
  };

  for (let tick = 0; tick < ticks; tick++) {
    stepSimulationTick(ctx);
  }

  return centerAndExportPositions(nodes, width, height);
}

export function computeForceLayout(
  params: ForceLayoutParams
): Record<string, NodePosition> {
  return runForceLayout(params, (entity) => entity.name, false);
}

export function computeForceLayoutByKey(
  params: ForceLayoutParams
): Record<string, NodePosition> {
  return runForceLayout(params, getEntityGraphKey, true);
}

function computePositionBoundingBox(
  entries: [string, NodePosition][],
  nodeDimensions: Record<string, NodeDimension>
) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const [key, pos] of entries) {
    const dims = nodeDimensions[key] ?? { width: 90, height: 36 };
    const halfW = dims.width / 2;
    const halfH = dims.height / 2;
    minX = Math.min(minX, pos.x - halfW);
    maxX = Math.max(maxX, pos.x + halfW);
    minY = Math.min(minY, pos.y - halfH);
    maxY = Math.max(maxY, pos.y + halfH);
  }

  return { minX, maxX, minY, maxY };
}

export function computeFitTransform(
  nodePositions: Record<string, NodePosition>,
  nodeDimensions: Record<string, NodeDimension>,
  containerWidth: number,
  containerHeight: number,
  padding: number = 44
): ViewTransform {
  const entries = Object.entries(nodePositions);
  if (entries.length === 0) return { x: 0, y: 0, k: 1 };
  if (containerWidth <= 0 || containerHeight <= 0) return { x: 0, y: 0, k: 1 };

  const { minX, maxX, minY, maxY } = computePositionBoundingBox(entries, nodeDimensions);
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

export const computeFitTransformByKey = computeFitTransform;
