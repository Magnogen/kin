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
      return (innerLeftEdge + innerRightEdge) / 2;
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

  const generationHeight = new Map();

  generationKeys.forEach((generation) => {
    const personIds = generations.get(generation) || [];
    let maxHeight = options.personHeight;

    personIds.forEach((personId) => {
      const height = personHeightById.get(personId) ?? options.personHeight;
      personHeightById.set(personId, height);
      const yOffset = seededGroupedChildLayout.yOffsets.get(personId) ?? 0;
      maxHeight = Math.max(maxHeight, yOffset + height);
    });

    generationHeight.set(generation, maxHeight);
  });

  const generationTop = new Map();
  let cursorY = options.paddingY;
  generationKeys.forEach((generation) => {
    generationTop.set(generation, cursorY);
    cursorY += (generationHeight.get(generation) ?? options.personHeight) + options.generationGap;
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

  const nodes = [];
  const edges = [];

  for (const personId of people.keys()) {
    const generation = personGeneration.get(personId) ?? 0;
    const width = personWidthById.get(personId) ?? options.personWidth;
    const centerX = personX.get(personId) ?? 0;
    const x = options.paddingX + centerX - width / 2;
    const y =
      (generationTop.get(generation) ?? options.paddingY) +
      (seededGroupedChildLayout.yOffsets.get(personId) ?? 0);
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
    const centerY =
      (generationTop.get(generation) ?? options.paddingY) +
      (generationHeight.get(generation) ?? options.personHeight) / 2 +
      options.unionOffsetY;

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
