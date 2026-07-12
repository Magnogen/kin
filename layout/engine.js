import { DEFAULT_LAYOUT_OPTIONS } from "./options.js";
import { average, createTextWidthMeasurer, normalizeAnnotations } from "./utils.js";
import { computePersonMetrics, enforceCenterGapByWidth } from "./metrics.js";
import { collectPeople } from "./people.js";
import {
  buildUnionComponentsForGeneration,
  orderUnionComponentForGeneration,
  compactGenerationIntoBlocks,
} from "./components.js";
import {
  buildGroupedChildLayout,
  computeChildGroupSpanWidth,
} from "./child-groups.js";

function buildHexRingSlots(count, baseStep) {
  if (!(count > 0)) return [];

  const step = Math.max(1, baseStep);
  const slots = [];
  const axialDirections = [
    [1, 0],
    [1, -1],
    [0, -1],
    [-1, 0],
    [-1, 1],
    [0, 1],
  ];

  let ring = 1;
  while (slots.length < count) {
    const ringCoords = [];

    let q = -ring;
    let r = ring;

    for (let side = 0; side < 6; side += 1) {
      const [dq, dr] = axialDirections[side];
      for (let i = 0; i < ring; i += 1) {
        const x = step * (q + r / 2);
        const y = step * 0.8660254037844386 * r;
        ringCoords.push({ x, y });
        q += dq;
        r += dr;
      }
    }

    ringCoords.sort((a, b) => {
      const aAngle = (Math.PI * 2 - Math.atan2(a.y, a.x)) % (Math.PI * 2);
      const bAngle = (Math.PI * 2 - Math.atan2(b.y, b.x)) % (Math.PI * 2);
      return aAngle - bAngle;
    });

    // Fill each ring in opposite pairs so declaration order expands evenly around anchor.
    const half = Math.floor(ringCoords.length / 2);
    const ordered = [];
    for (let i = 0; i < half; i += 1) {
      ordered.push(ringCoords[i]);
      ordered.push(ringCoords[i + half]);
    }

    if (ringCoords.length % 2 === 1) {
      ordered.push(ringCoords[ringCoords.length - 1]);
    }

    slots.push(...ordered);
    ring += 1;
  }

  return slots.slice(0, count);
}

function buildPartnerFanoutLayout(
  unions,
  personGeneration,
  personX,
  people,
  fanoutStep
) {
  const byAnchor = new Map();

  const addAnchorPartner = (anchorId, partnerId, unionOrder) => {
    if (!byAnchor.has(anchorId)) {
      byAnchor.set(anchorId, []);
    }
    byAnchor.get(anchorId).push({ partnerId, unionOrder });
  };

  unions.forEach((union, unionOrder) => {
    const members = union.members || [];
    if (members.length !== 2) {
      return;
    }

    const first = members[0]?.personId;
    const second = members[1]?.personId;
    if (first == null || second == null || first === second) {
      return;
    }

    const firstGeneration = personGeneration.get(first);
    const secondGeneration = personGeneration.get(second);
    if (firstGeneration == null || secondGeneration == null || firstGeneration !== secondGeneration) {
      return;
    }

    addAnchorPartner(first, second, unionOrder);
    addAnchorPartner(second, first, unionOrder);
  });

  const candidates = [];

  byAnchor.forEach((entries, anchorId) => {
    const seen = new Set();
    const orderedPartners = [];

    entries
      .sort((a, b) => a.unionOrder - b.unionOrder)
      .forEach((entry) => {
        if (seen.has(entry.partnerId)) {
          return;
        }
        seen.add(entry.partnerId);
        orderedPartners.push(entry.partnerId);
      });

    if (orderedPartners.length < 3) {
      return;
    }

    candidates.push({
      anchorId,
      partners: orderedPartners,
      sortIndex: people.get(anchorId)?.sortIndex ?? anchorId,
    });
  });

  candidates.sort((a, b) => {
    if (b.partners.length !== a.partners.length) {
      return b.partners.length - a.partners.length;
    }
    return a.sortIndex - b.sortIndex;
  });

  const positionOverrides = new Map();
  const yOffsets = new Map();
  const consumed = new Set();

  candidates.forEach((candidate) => {
    if (consumed.has(candidate.anchorId)) {
      return;
    }

    const anchorX = personX.get(candidate.anchorId);
    if (!Number.isFinite(anchorX)) {
      return;
    }

    const partners = candidate.partners.filter((partnerId) => !consumed.has(partnerId));
    if (partners.length < 3) {
      return;
    }

    const slots = buildHexRingSlots(partners.length, fanoutStep);
    partners.forEach((partnerId, index) => {
      const slot = slots[index];
      if (!slot) {
        return;
      }

      positionOverrides.set(partnerId, anchorX + slot.x);
      yOffsets.set(partnerId, slot.y);
      consumed.add(partnerId);
    });
  });

  return {
    positionOverrides,
    yOffsets,
  };
}

export function layoutFamilyTree(ast, userOptions = {}) {
  const options = { ...DEFAULT_LAYOUT_OPTIONS, ...userOptions };
  const people = collectPeople(ast || {});
  const unions = ast?.unions || [];
  const singleParentLinks = ast?.singleParentLinks || [];
  const measureTextWidth = createTextWidthMeasurer(options);

  const personAnnotationsById = new Map();
  const personWidthById = new Map();
  const personHeightById = new Map();

  for (const personId of people.keys()) {
    const metrics = computePersonMetrics(people.get(personId), options, measureTextWidth);
    personAnnotationsById.set(personId, metrics.annotations);
    personWidthById.set(personId, metrics.width);
    personHeightById.set(personId, metrics.height);
  }

  if (!unions.length && !people.size) {
    return {
      nodes: [],
      edges: [],
      bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 },
      generationCount: 0,
    };
  }

  const memberUnionsByPerson = new Map();
  const parentUnionsByPerson = new Map();
  const parentPeopleByPerson = new Map();
  const childPeopleByPerson = new Map();

  for (const personId of people.keys()) {
    memberUnionsByPerson.set(personId, []);
    parentUnionsByPerson.set(personId, []);
    parentPeopleByPerson.set(personId, []);
    childPeopleByPerson.set(personId, []);
  }

  unions.forEach((union) => {
    (union.members || []).forEach((member) => {
      if (!memberUnionsByPerson.has(member.personId)) {
        memberUnionsByPerson.set(member.personId, []);
      }
      memberUnionsByPerson.get(member.personId).push(union.id);
    });

    (union.children || []).forEach((child) => {
      if (!parentUnionsByPerson.has(child.personId)) {
        parentUnionsByPerson.set(child.personId, []);
      }
      parentUnionsByPerson.get(child.personId).push(union.id);
    });
  });

  singleParentLinks.forEach((link) => {
    const parentId = link.parent?.personId;
    const childId = link.child?.personId;
    if (parentId == null || childId == null) return;

    if (!parentPeopleByPerson.has(childId)) {
      parentPeopleByPerson.set(childId, []);
    }
    parentPeopleByPerson.get(childId).push(parentId);

    if (!childPeopleByPerson.has(parentId)) {
      childPeopleByPerson.set(parentId, []);
    }
    childPeopleByPerson.get(parentId).push(childId);
  });

  const personGeneration = new Map();
  const unionGeneration = new Map();

  for (const personId of people.keys()) {
    personGeneration.set(personId, 0);
  }
  unions.forEach((union) => {
    unionGeneration.set(union.id, 0);
  });

  const maxIterations = Math.max(12, (people.size + unions.length) * 4);
  for (let i = 0; i < maxIterations; i += 1) {
    let changed = false;

    unions.forEach((union) => {
      const members = union.members || [];
      const children = union.children || [];

      const memberGeneration = members.length
        ? Math.max(...members.map((member) => personGeneration.get(member.personId) ?? 0))
        : 0;

      members.forEach((member) => {
        const prev = personGeneration.get(member.personId) ?? 0;
        if (memberGeneration > prev) {
          personGeneration.set(member.personId, memberGeneration);
          changed = true;
        }
      });

      const previousUnionGeneration = unionGeneration.get(union.id) ?? 0;
      if (memberGeneration > previousUnionGeneration) {
        unionGeneration.set(union.id, memberGeneration);
        changed = true;
      }

      const childGeneration = memberGeneration + 1;
      children.forEach((child) => {
        const prev = personGeneration.get(child.personId) ?? 0;
        if (childGeneration > prev) {
          personGeneration.set(child.personId, childGeneration);
          changed = true;
        }
      });
    });

    singleParentLinks.forEach((link) => {
      const parentId = link.parent?.personId;
      const childId = link.child?.personId;
      if (parentId == null || childId == null) return;

      const parentGeneration = personGeneration.get(parentId) ?? 0;
      const childGeneration = personGeneration.get(childId) ?? 0;

      const impliedFromParent = parentGeneration + 1;
      if (impliedFromParent > childGeneration) {
        personGeneration.set(childId, impliedFromParent);
        changed = true;
      }

      const impliedFromChild = childGeneration - 1;
      if (impliedFromChild > parentGeneration) {
        personGeneration.set(parentId, impliedFromChild);
        changed = true;
      }
    });

    if (!changed) break;
  }

  const generations = new Map();
  for (const personId of people.keys()) {
    const generation = personGeneration.get(personId) ?? 0;
    if (!generations.has(generation)) {
      generations.set(generation, []);
    }
    generations.get(generation).push(personId);
  }

  const generationKeys = [...generations.keys()].sort((a, b) => a - b);
  const nominalCenterGap = options.personWidth + options.personGap;
  const groupedSpanWidthByParentAnchor = new Map();

  unions.forEach((union) => {
    const childIds = (union.children || []).map((child) => child.personId);
    const groupedWidth = computeChildGroupSpanWidth(childIds, personWidthById, options);
    if (Number.isFinite(groupedWidth)) {
      groupedSpanWidthByParentAnchor.set(`u:${union.id}`, groupedWidth);
    }
  });

  childPeopleByPerson.forEach((childIds, parentId) => {
    const groupedWidth = computeChildGroupSpanWidth(childIds, personWidthById, options);
    if (Number.isFinite(groupedWidth)) {
      groupedSpanWidthByParentAnchor.set(`p:${parentId}`, groupedWidth);
    }
  });

  const componentsByGeneration = new Map();
  const orderedComponentIdsByGeneration = new Map();
  generationKeys.forEach((generation) => {
    const personIds = generations.get(generation) || [];
    const components = buildUnionComponentsForGeneration(
      personIds,
      unions,
      unionGeneration,
      generation
    );
    const componentMap = new Map();
    const orderedComponentIdsByPerson = new Map();

    components.forEach((component) => {
      const orderedComponent = orderUnionComponentForGeneration(
        component,
        unions,
        unionGeneration,
        generation,
        people
      );

      component.forEach((personId) => {
        componentMap.set(personId, component);
        orderedComponentIdsByPerson.set(personId, orderedComponent);
      });
    });

    componentsByGeneration.set(generation, componentMap);
    orderedComponentIdsByGeneration.set(generation, orderedComponentIdsByPerson);
  });

  const personX = new Map();
  generationKeys.forEach((generation) => {
    const personIds = generations.get(generation) || [];

    personIds
      .sort((a, b) => {
        const aSort = people.get(a)?.sortIndex ?? a;
        const bSort = people.get(b)?.sortIndex ?? b;
        return aSort - bSort;
      })
      .forEach((personId, index) => {
        personX.set(personId, index * nominalCenterGap);
      });
  });

  const unionX = new Map();
  const getUnionCenterX = (union) => {
    const members = union.members || [];
    const centers = members.map((member) => personX.get(member.personId) ?? 0);
    if (!centers.length) return 0;

    const getGenerationCenterX = (generation) => {
      const personIds = generations.get(generation) || [];
      const generationCenters = personIds
        .map((personId) => personX.get(personId) ?? 0)
        .filter((value) => Number.isFinite(value));
      return average(generationCenters);
    };

    if (members.length === 2) {
      const [first, second] = members;
      const firstCenter = personX.get(first.personId) ?? 0;
      const secondCenter = personX.get(second.personId) ?? 0;
      const firstWidth = personWidthById.get(first.personId) ?? options.personWidth;
      const secondWidth = personWidthById.get(second.personId) ?? options.personWidth;

      let leftCenter = firstCenter;
      let rightCenter = secondCenter;
      let leftWidth = firstWidth;
      let rightWidth = secondWidth;

      if (firstCenter > secondCenter) {
        leftCenter = secondCenter;
        rightCenter = firstCenter;
        leftWidth = secondWidth;
        rightWidth = firstWidth;
      }

      const innerLeftEdge = leftCenter + leftWidth / 2;
      const innerRightEdge = rightCenter - rightWidth / 2;

      const generation = personGeneration.get(first.personId) ?? 0;
      const generationCenterX = getGenerationCenterX(generation);
      const leftDeviation = Math.abs(leftCenter - generationCenterX);
      const rightDeviation = Math.abs(rightCenter - generationCenterX);
      const outerOnRight = rightDeviation >= leftDeviation;

      const span = Math.abs(secondCenter - firstCenter);
      const spanFactor = Math.max(
        0,
        Math.min(1, (span - nominalCenterGap) / Math.max(1, nominalCenterGap))
      );
      const bias = 0.5 + spanFactor * 0.18;

      return outerOnRight
        ? innerLeftEdge + (innerRightEdge - innerLeftEdge) * bias
        : innerRightEdge - (innerRightEdge - innerLeftEdge) * bias;
    }

    return average(centers);
  };

  const getPersonCenterY = (personId) => {
    const generation = personGeneration.get(personId) ?? 0;
    const topY =
      (generationTop.get(generation) ?? options.paddingY) +
      (generationYOffsetShift.get(generation) ?? 0) +
      getFinalPersonYOffset(personId);
    const height = personHeightById.get(personId) ?? options.personHeight;
    return topY + height / 2;
  };

  const getUnionCenterY = (union) => {
    const members = union.members || [];
    const centers = members.map((member) => getPersonCenterY(member.personId));
    if (!centers.length) {
      return options.paddingY + options.personHeight / 2;
    }

    if (members.length === 2) {
      const [first, second] = members;
      const firstCenter = getPersonCenterY(first.personId);
      const secondCenter = getPersonCenterY(second.personId);
      return (firstCenter + secondCenter) / 2;
    }

    return average(centers);
  };

  const seededGroupedChildLayout = buildGroupedChildLayout(
    unions,
    singleParentLinks,
    personGeneration,
    personX,
    unionX,
    personWidthById,
    personHeightById,
    people,
    options
  );

  seededGroupedChildLayout.positionOverrides.forEach((centerX, personId) => {
    personX.set(personId, centerX);
  });

  for (let i = 0; i < options.iterations; i += 1) {
    unions.forEach((union) => {
      unionX.set(union.id, getUnionCenterX(union));
    });

    generationKeys.forEach((generation) => {
      const personIds = generations.get(generation) || [];
      const desiredByPersonId = new Map();
      const pinnedByPersonId = new Map();
      const parentAnchorIdsByPerson = new Map();

      personIds.forEach((personId) => {
        const parentUnionIds = parentUnionsByPerson.get(personId) || [];
        const memberUnionIds = memberUnionsByPerson.get(personId) || [];
        const parentPersonIds = parentPeopleByPerson.get(personId) || [];

        parentAnchorIdsByPerson.set(personId, [
          ...parentUnionIds.map((unionId) => `u:${unionId}`),
          ...parentPersonIds.map((parentId) => `p:${parentId}`),
        ]);

        const parentTargets = parentUnionIds
          .map((unionId) => unionX.get(unionId))
          .concat(
            parentPersonIds
              .map((parentId) => personX.get(parentId))
              .filter((value) => Number.isFinite(value))
          )
          .filter((value) => Number.isFinite(value));
        const memberTargets = memberUnionIds
          .map((unionId) => unionX.get(unionId))
          .filter((value) => Number.isFinite(value));

        const current = personX.get(personId) ?? 0;
        const parentBias = parentTargets.length ? average(parentTargets) : current;
        const memberBias = memberTargets.length ? average(memberTargets) : current;
        const nextX =
          parentTargets.length && memberTargets.length
            ? parentBias + (memberBias - parentBias) * 0.25
            : parentTargets.length
              ? parentBias
              : memberBias;

        desiredByPersonId.set(personId, Number.isFinite(nextX) ? nextX : current);
        pinnedByPersonId.set(personId, parentUnionIds.length > 0 && memberTargets.length === 0);
      });

      const componentMap = componentsByGeneration.get(generation) || new Map();
      const orderedComponentIdsByPerson =
        orderedComponentIdsByGeneration.get(generation) || new Map();
      const compacted = compactGenerationIntoBlocks(
        personIds,
        componentMap,
        orderedComponentIdsByPerson,
        desiredByPersonId,
        pinnedByPersonId,
        parentAnchorIdsByPerson,
        nominalCenterGap,
        groupedSpanWidthByParentAnchor
      );

      personIds.forEach((personId) => {
        const x = compacted.get(personId) ?? (personX.get(personId) ?? 0);
        personX.set(personId, x);
      });

      const hasGroupedSpan = personIds.some((personId) => {
        const anchorIds = parentAnchorIdsByPerson.get(personId) || [];
        return anchorIds.some((anchorId) =>
          Number.isFinite(groupedSpanWidthByParentAnchor.get(anchorId))
        );
      });

      if (!hasGroupedSpan) {
        enforceCenterGapByWidth(personIds, personX, personWidthById, options.personGap);
      }
    });
  }

  unions.forEach((union) => {
    unionX.set(union.id, getUnionCenterX(union));
  });

  const groupedChildLayout = buildGroupedChildLayout(
    unions,
    singleParentLinks,
    personGeneration,
    personX,
    unionX,
    personWidthById,
    personHeightById,
    people,
    options
  );

  groupedChildLayout.positionOverrides.forEach((centerX, personId) => {
    personX.set(personId, centerX);
  });

  const partnerFanoutLayout = buildPartnerFanoutLayout(
    unions,
    personGeneration,
    personX,
    people,
    Number.isFinite(options.partnerFanoutStep) && options.partnerFanoutStep > 0
      ? options.partnerFanoutStep
      : nominalCenterGap
  );

  partnerFanoutLayout.positionOverrides.forEach((centerX, personId) => {
    personX.set(personId, centerX);
  });

  unions.forEach((union) => {
    unionX.set(union.id, getUnionCenterX(union));
  });

  const getFinalPersonYOffset = (personId) => {
    const groupedYOffset = groupedChildLayout.yOffsets.get(personId) ?? 0;
    const fanoutYOffset = partnerFanoutLayout.yOffsets.get(personId) ?? 0;
    return groupedYOffset + fanoutYOffset;
  };

  const enforceCenterGapByWidthWithVerticalSeparation = (personIds) => {
    if (!personIds.length) {
      return;
    }

    const ordered = [...personIds]
      .map((personId) => {
        const width = personWidthById.get(personId) ?? options.personWidth;
        const center = personX.get(personId) ?? 0;
        const top = getFinalPersonYOffset(personId);
        const height = personHeightById.get(personId) ?? options.personHeight;
        return {
          personId,
          width,
          center,
          top,
          bottom: top + height,
        };
      })
      .sort((a, b) => {
        const delta = a.center - b.center;
        if (delta !== 0) return delta;
        return a.personId - b.personId;
      });

    const overlapsVertically = (a, b) =>
      Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0;

    const targetMean = average(ordered.map((item) => item.center));

    for (let i = 1; i < ordered.length; i += 1) {
      const current = ordered[i];
      let minCenter = -Infinity;

      for (let j = 0; j < i; j += 1) {
        const prev = ordered[j];
        if (!overlapsVertically(prev, current)) {
          continue;
        }
        minCenter = Math.max(
          minCenter,
          prev.center + (prev.width + current.width) / 2 + options.personGap
        );
      }

      if (current.center < minCenter) {
        current.center = minCenter;
      }
    }

    const shiftedMean = average(ordered.map((item) => item.center));
    const meanShift = targetMean - shiftedMean;
    if (Number.isFinite(meanShift) && Math.abs(meanShift) > 1e-6) {
      ordered.forEach((item) => {
        item.center += meanShift;
      });

      for (let i = 1; i < ordered.length; i += 1) {
        const current = ordered[i];
        let minCenter = -Infinity;

        for (let j = 0; j < i; j += 1) {
          const prev = ordered[j];
          if (!overlapsVertically(prev, current)) {
            continue;
          }
          minCenter = Math.max(
            minCenter,
            prev.center + (prev.width + current.width) / 2 + options.personGap
          );
        }

        if (current.center < minCenter) {
          current.center = minCenter;
        }
      }
    }

    ordered.forEach((item) => {
      personX.set(item.personId, item.center);
    });
  };

  generationKeys.forEach((generation) => {
    const personIds = generations.get(generation) || [];
    enforceCenterGapByWidthWithVerticalSeparation(personIds);
  });

  unions.forEach((union) => {
    unionX.set(union.id, getUnionCenterX(union));
  });

  const generationMinYOffset = new Map();
  const generationMaxBottom = new Map();
  const generationHeight = new Map();

  generationKeys.forEach((generation) => {
    const personIds = generations.get(generation) || [];
    let minYOffset = 0;
    let maxBottom = options.personHeight;

    personIds.forEach((personId) => {
      const height = personHeightById.get(personId) ?? options.personHeight;
      personHeightById.set(personId, height);

      const yOffset = getFinalPersonYOffset(personId);
      minYOffset = Math.min(minYOffset, yOffset);
      maxBottom = Math.max(maxBottom, yOffset + height);
    });

    generationMinYOffset.set(generation, minYOffset);
    generationMaxBottom.set(generation, maxBottom);
    generationHeight.set(generation, maxBottom - minYOffset);
  });

  const generationTop = new Map();
  const generationYOffsetShift = new Map();
  let cursorY = options.paddingY;
  generationKeys.forEach((generation) => {
    generationTop.set(generation, cursorY);
    generationYOffsetShift.set(generation, -(generationMinYOffset.get(generation) ?? 0));
    cursorY += (generationHeight.get(generation) ?? options.personHeight) + options.generationGap;
  });

  const nodes = [];
  const edges = [];

  for (const personId of people.keys()) {
    const generation = personGeneration.get(personId) ?? 0;
    const width = personWidthById.get(personId) ?? options.personWidth;
    const centerX = personX.get(personId) ?? 0;
    const x = options.paddingX + centerX - width / 2;
    const y =
      (generationTop.get(generation) ?? options.paddingY) +
      (generationYOffsetShift.get(generation) ?? 0) +
      getFinalPersonYOffset(personId);
    const meta = people.get(personId);
    const annotations = personAnnotationsById.get(personId) || [];
    const height = personHeightById.get(personId) ?? options.personHeight;

    nodes.push({
      id: `person:${personId}`,
      type: "person",
      personId,
      generation,
      x,
      y,
      width,
      height,
      label: meta?.label || "?",
      annotations,
      kind: meta?.kind || "named",
    });
  }

  unions.forEach((union) => {
    const generation = unionGeneration.get(union.id) ?? 0;
    const centerX = options.paddingX + (unionX.get(union.id) ?? 0);
    const centerY = getUnionCenterY(union) + options.unionOffsetY;

    const x = centerX - options.unionSize / 2;
    const y = centerY - options.unionSize / 2;

    nodes.push({
      id: `union:${union.id}`,
      type: "union",
      unionId: union.id,
      generation,
      x,
      y,
      width: options.unionSize,
      height: options.unionSize,
      annotationCount: (union.annotations || []).filter(Boolean).length,
      annotationLines: normalizeAnnotations(union.annotations || []),
    });

    (union.members || []).forEach((member) => {
      edges.push({
        id: `edge:member:${union.id}:${member.personId}`,
        type: "member",
        from: `person:${member.personId}`,
        to: `union:${union.id}`,
      });
    });

    (union.children || []).forEach((child) => {
      edges.push({
        id: `edge:child:${union.id}:${child.personId}`,
        type: "child",
        from: `union:${union.id}`,
        to: `person:${child.personId}`,
      });
    });
  });

  singleParentLinks.forEach((link) => {
    const parentId = link.parent?.personId;
    const childId = link.child?.personId;
    if (parentId == null || childId == null) return;

    edges.push({
      id: `edge:single-parent:${parentId}:${childId}`,
      type: "singleParent",
      from: `person:${parentId}`,
      to: `person:${childId}`,
    });
  });

  if (!nodes.length) {
    return {
      nodes,
      edges,
      bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 },
      generationCount: generationKeys.length,
    };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  nodes.forEach((node) => {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + node.width);
    maxY = Math.max(maxY, node.y + node.height);
  });

  return {
    nodes,
    edges,
    bounds: {
      minX,
      minY,
      maxX,
      maxY,
      width: maxX - minX,
      height: maxY - minY,
    },
    generationCount: generationKeys.length,
  };
}
