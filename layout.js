const DEFAULT_LAYOUT_OPTIONS = {
  personWidth: 142,
  personHeight: 62,
  personPaddingX: 14,
  personLineHeight: 16,
  personPaddingY: 10,
  personNameFontSize: 14,
  personNoteFontSize: 11,
  personNameFontWeight: "400",
  personNoteFontWeight: "400",
  personFontFamily: "IBM Plex Sans, Segoe UI, sans-serif",
  personGap: 34,
  generationGap: 158,
  unionSize: 14,
  unionOffsetY: 0,
  paddingX: 24,
  paddingY: 24,
  iterations: 8,
};

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function getPersonLabel(person) {
  if (!person) return "?";
  if (person.value && person.value.trim()) return person.value.trim();
  return "?";
}

function normalizeAnnotations(annotations) {
  return (annotations || [])
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
}

function createTextWidthMeasurer(options) {
  let ctx = null;

  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(1, 1);
    ctx = canvas.getContext("2d");
  } else if (typeof document !== "undefined" && document.createElement) {
    const canvas = document.createElement("canvas");
    ctx = canvas.getContext("2d");
  }

  const cache = new Map();
  const family = options.personFontFamily;

  const fallbackWidth = (text, fontSize) => {
    const value = String(text || "");
    if (!value.length) return fontSize * 0.3;

    // Approximate glyph widths by category for non-browser runtimes.
    let units = 0;
    for (const ch of value) {
      if ("il.:,|'`!".includes(ch)) {
        units += 0.32;
      } else if ("mwMW@#%&".includes(ch)) {
        units += 0.92;
      } else if (ch === " ") {
        units += 0.33;
      } else {
        units += 0.58;
      }
    }

    return units * fontSize;
  };

  return (text, fontSize, fontWeight) => {
    const value = String(text || "");
    const key = `${fontWeight}|${fontSize}|${value}`;
    if (cache.has(key)) {
      return cache.get(key);
    }

    let width;
    if (ctx) {
      ctx.font = `${fontWeight} ${fontSize}px ${family}`;
      width = ctx.measureText(value).width;
    } else {
      width = fallbackWidth(value, fontSize);
    }

    cache.set(key, width);
    return width;
  };
}

function computePersonMetrics(meta, options, measureTextWidth) {
  const annotations = normalizeAnnotations(meta?.annotations || []);
  const label = meta?.label || "?";
  const widestLabel = measureTextWidth(
    label,
    options.personNameFontSize,
    options.personNameFontWeight
  );
  const widestAnnotation = annotations.length
    ? Math.max(
        ...annotations.map((line) =>
          measureTextWidth(line, options.personNoteFontSize, options.personNoteFontWeight)
        )
      )
    : 0;

  const widestLine = Math.max(widestLabel, widestAnnotation) + options.personPaddingX * 2;
  const width = Math.max(options.personWidth, widestLine);

  const lineCount = 1 + annotations.length;
  const computedHeight = options.personPaddingY * 2 + lineCount * options.personLineHeight;
  const height = Math.max(options.personHeight, computedHeight);

  return {
    annotations,
    width,
    height,
  };
}

function collectPeople(ast) {
  const map = new Map();

  (ast.people || []).forEach((person, index) => {
    map.set(person.id, {
      id: person.id,
      kind: person.kind || "named",
      label: getPersonLabel(person),
      annotations: normalizeAnnotations(person.annotations || []),
      sortIndex: index,
    });
  });

  (ast.unions || []).forEach((union) => {
    (union.members || []).forEach((member) => {
      if (!map.has(member.personId)) {
        map.set(member.personId, {
          id: member.personId,
          kind: member.kind || "named",
          label: getPersonLabel(member),
          annotations: normalizeAnnotations(member.annotations || []),
          sortIndex: member.personId,
        });
      } else if (member.annotations?.length) {
        const existing = map.get(member.personId);
        existing.annotations = normalizeAnnotations([
          ...(existing.annotations || []),
          ...member.annotations,
        ]);
      }
    });

    (union.children || []).forEach((child) => {
      if (!map.has(child.personId)) {
        map.set(child.personId, {
          id: child.personId,
          kind: child.kind || "named",
          label: getPersonLabel(child),
          annotations: normalizeAnnotations(child.annotations || []),
          sortIndex: child.personId,
        });
      } else if (child.annotations?.length) {
        const existing = map.get(child.personId);
        existing.annotations = normalizeAnnotations([
          ...(existing.annotations || []),
          ...child.annotations,
        ]);
      }
    });
  });

  return map;
}

function enforceMinGap(sortedItems, minGap) {
  if (!sortedItems.length) return;

  for (let i = 1; i < sortedItems.length; i += 1) {
    const prev = sortedItems[i - 1];
    const current = sortedItems[i];
    const nextX = Math.max(current.x, prev.x + minGap);
    current.x = nextX;
  }
}

function buildUnionComponentsForGeneration(
  personIds,
  unions,
  unionGeneration,
  generation
) {
  const personSet = new Set(personIds);
  const adjacency = new Map();

  personIds.forEach((personId) => {
    adjacency.set(personId, new Set());
  });

  unions.forEach((union) => {
    if ((unionGeneration.get(union.id) ?? 0) !== generation) {
      return;
    }

    const members = (union.members || [])
      .map((member) => member.personId)
      .filter((personId) => personSet.has(personId));

    if (members.length < 2) {
      return;
    }

    const anchor = members[0];
    for (let i = 1; i < members.length; i += 1) {
      const memberId = members[i];
      adjacency.get(anchor).add(memberId);
      adjacency.get(memberId).add(anchor);
    }
  });

  const visited = new Set();
  const components = [];

  personIds.forEach((personId) => {
    if (visited.has(personId)) return;
    if (!(adjacency.get(personId)?.size > 0)) return;

    const stack = [personId];
    const component = [];
    visited.add(personId);

    while (stack.length) {
      const current = stack.pop();
      component.push(current);

      (adjacency.get(current) || []).forEach((next) => {
        if (!visited.has(next)) {
          visited.add(next);
          stack.push(next);
        }
      });
    }

    if (component.length > 1) {
      components.push(component);
    }
  });

  return components;
}

function compactGenerationIntoBlocks(
  personIds,
  componentMap,
  xByPersonId,
  pinnedByPersonId,
  parentUnionIdsByPerson,
  minGap
) {
  const blocks = [];
  const consumed = new Set();

  const anchoredStartForIds = (ids, width) => {
    const pinnedTargets = ids
      .filter((id) => pinnedByPersonId.get(id))
      .map((id) => xByPersonId.get(id))
      .filter((value) => Number.isFinite(value));

    if (!pinnedTargets.length) {
      const center = average(ids.map((id) => xByPersonId.get(id) ?? 0));
      return center - width / 2;
    }

    // For partnered/branch blocks, anchor the block center to parent-union targets.
    const targetCenter = average(pinnedTargets);
    if (ids.length <= 1) {
      return targetCenter;
    }
    return targetCenter - width / 2;
  };

  personIds.forEach((personId) => {
    if (consumed.has(personId)) return;

    const component = componentMap.get(personId);
    if (component?.length > 1) {
      const ids = [...component].sort((a, b) => {
        const delta = (xByPersonId.get(a) ?? 0) - (xByPersonId.get(b) ?? 0);
        if (delta !== 0) return delta;
        return a - b;
      });
      ids.forEach((id) => consumed.add(id));

      const width = (ids.length - 1) * minGap;
      const center = average(ids.map((id) => xByPersonId.get(id) ?? 0));
      const start = anchoredStartForIds(ids, width);
      blocks.push({ ids, center, width, start });
      return;
    }

    consumed.add(personId);
    const x = xByPersonId.get(personId) ?? 0;
    blocks.push({ ids: [personId], center: x, width: 0, start: x });
  });

  const personToBlockIndex = new Map();
  blocks.forEach((block, index) => {
    block.ids.forEach((personId) => {
      personToBlockIndex.set(personId, index);
    });
  });

  const parentUnionToBlockIndices = new Map();
  personIds.forEach((personId) => {
    const blockIndex = personToBlockIndex.get(personId);
    if (blockIndex == null) return;

    const parentUnionIds = parentUnionIdsByPerson.get(personId) || [];
    parentUnionIds.forEach((unionId) => {
      if (!parentUnionToBlockIndices.has(unionId)) {
        parentUnionToBlockIndices.set(unionId, new Set());
      }
      parentUnionToBlockIndices.get(unionId).add(blockIndex);
    });
  });

  const roots = new Map();
  const find = (index) => {
    let root = roots.get(index);
    if (root == null) {
      roots.set(index, index);
      return index;
    }
    while (root !== roots.get(root)) {
      root = roots.get(root);
    }
    let cursor = index;
    while (roots.get(cursor) !== root) {
      const parent = roots.get(cursor);
      roots.set(cursor, root);
      cursor = parent;
    }
    return root;
  };

  const unite = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) {
      roots.set(rb, ra);
    }
  };

  parentUnionToBlockIndices.forEach((indices) => {
    const list = [...indices];
    if (list.length < 2) return;
    const anchor = list[0];
    for (let i = 1; i < list.length; i += 1) {
      unite(anchor, list[i]);
    }
  });

  const groupedBlocks = new Map();
  blocks.forEach((block, index) => {
    const root = find(index);
    if (!groupedBlocks.has(root)) {
      groupedBlocks.set(root, []);
    }
    groupedBlocks.get(root).push({ ...block });
  });

  const mergedBlocks = [];
  groupedBlocks.forEach((members) => {
    members.sort((a, b) => a.center - b.center);
    const ids = members.flatMap((block) => block.ids);

    const width = (ids.length - 1) * minGap;
    const center = average(ids.map((id) => xByPersonId.get(id) ?? 0));
    const start = anchoredStartForIds(ids, width);
    mergedBlocks.push({ ids, center, width, start });
  });

  mergedBlocks.sort((a, b) => a.center - b.center);

  const targetStarts = mergedBlocks.map((block) => block.start);
  const relaxNonOverlap = () => {
    for (let i = 1; i < mergedBlocks.length; i += 1) {
      const prev = mergedBlocks[i - 1];
      const block = mergedBlocks[i];
      const minStart = prev.start + prev.width + minGap;
      if (block.start < minStart) {
        block.start = minStart;
      }
    }

    for (let i = mergedBlocks.length - 2; i >= 0; i -= 1) {
      const next = mergedBlocks[i + 1];
      const block = mergedBlocks[i];
      const maxStart = next.start - block.width - minGap;
      if (block.start > maxStart) {
        block.start = maxStart;
      }
    }
  };

  relaxNonOverlap();

  const targetMean = average(targetStarts);
  const currentMean = average(mergedBlocks.map((block) => block.start));
  const meanShift = targetMean - currentMean;
  if (Number.isFinite(meanShift) && Math.abs(meanShift) > 1e-6) {
    mergedBlocks.forEach((block) => {
      block.start += meanShift;
    });
    relaxNonOverlap();
  }

  const placed = new Map();
  mergedBlocks.forEach((block) => {
    block.ids.forEach((personId, index) => {
      placed.set(personId, block.start + index * minGap);
    });
  });

  return placed;
}

function enforceCenterGapByWidth(personIds, centerByPersonId, widthByPersonId, gap) {
  if (!personIds.length) return;

  const ordered = [...personIds]
    .map((personId) => ({
      personId,
      center: centerByPersonId.get(personId) ?? 0,
      width: widthByPersonId.get(personId) ?? 0,
    }))
    .sort((a, b) => {
      const delta = a.center - b.center;
      if (delta !== 0) return delta;
      return a.personId - b.personId;
    });

  const targetMean = average(ordered.map((item) => item.center));

  for (let i = 1; i < ordered.length; i += 1) {
    const prev = ordered[i - 1];
    const current = ordered[i];
    const minCenter = prev.center + (prev.width + current.width) / 2 + gap;
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
      const prev = ordered[i - 1];
      const current = ordered[i];
      const minCenter = prev.center + (prev.width + current.width) / 2 + gap;
      if (current.center < minCenter) {
        current.center = minCenter;
      }
    }
  }

  ordered.forEach((item) => {
    centerByPersonId.set(item.personId, item.center);
  });
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

      let memberGeneration = members.length
        ? Math.max(...members.map((member) => personGeneration.get(member.personId) ?? 0))
        : 0;

      // Keep parent unions one generation above their known children.
      if (children.length) {
        const impliedFromChildren = Math.max(
          ...children.map((child) => (personGeneration.get(child.personId) ?? 0) - 1)
        );
        if (Number.isFinite(impliedFromChildren) && impliedFromChildren > memberGeneration) {
          memberGeneration = impliedFromChildren;
        }
      }

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

      const impliedFromChild = childGeneration - 1;
      if (impliedFromChild > parentGeneration) {
        personGeneration.set(parentId, impliedFromChild);
        changed = true;
      }

      const impliedFromParent = parentGeneration + 1;
      if (impliedFromParent > childGeneration) {
        personGeneration.set(childId, impliedFromParent);
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

  const componentsByGeneration = new Map();
  generationKeys.forEach((generation) => {
    const personIds = generations.get(generation) || [];
    const components = buildUnionComponentsForGeneration(
      personIds,
      unions,
      unionGeneration,
      generation
    );
    const componentMap = new Map();

    components.forEach((component) => {
      component.forEach((personId) => {
        componentMap.set(personId, component);
      });
    });

    componentsByGeneration.set(generation, componentMap);
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

  for (let i = 0; i < options.iterations; i += 1) {
    unions.forEach((union) => {
      unionX.set(union.id, getUnionCenterX(union));
    });

    generationKeys.forEach((generation) => {
      const personIds = generations.get(generation) || [];
      const desiredByPersonId = new Map();
      const pinnedByPersonId = new Map();
      const parentUnionIdsByPerson = new Map();

      personIds.forEach((personId) => {
        const parentUnionIds = parentUnionsByPerson.get(personId) || [];
        const memberUnionIds = memberUnionsByPerson.get(personId) || [];
        const parentPersonIds = parentPeopleByPerson.get(personId) || [];
        const childPersonIds = childPeopleByPerson.get(personId) || [];

        parentUnionIdsByPerson.set(personId, [
          ...parentUnionIds,
          ...parentPersonIds.map((parentId) => `parent:${parentId}`),
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
          .concat(
            childPersonIds
              .map((childId) => personX.get(childId))
              .filter((value) => Number.isFinite(value))
          )
          .filter((value) => Number.isFinite(value));

        const current = personX.get(personId) ?? 0;
        const parentBias = parentTargets.length ? average(parentTargets) : current;
        const memberBias = memberTargets.length ? average(memberTargets) : current;
        const nextX = parentTargets.length ? parentBias : memberBias;

        desiredByPersonId.set(personId, Number.isFinite(nextX) ? nextX : current);
        pinnedByPersonId.set(personId, parentTargets.length > 0);
      });

      const componentMap = componentsByGeneration.get(generation) || new Map();
      const compacted = compactGenerationIntoBlocks(
        personIds,
        componentMap,
        desiredByPersonId,
        pinnedByPersonId,
        parentUnionIdsByPerson,
        nominalCenterGap
      );

      personIds.forEach((personId) => {
        const x = compacted.get(personId) ?? (personX.get(personId) ?? 0);
        personX.set(personId, x);
      });

      enforceCenterGapByWidth(personIds, personX, personWidthById, options.personGap);
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
      maxHeight = Math.max(maxHeight, height);
    });

    generationHeight.set(generation, maxHeight);
  });

  const generationTop = new Map();
  let cursorY = options.paddingY;
  generationKeys.forEach((generation) => {
    generationTop.set(generation, cursorY);
    cursorY += (generationHeight.get(generation) ?? options.personHeight) + options.generationGap;
  });

  const nodes = [];
  const edges = [];

  for (const personId of people.keys()) {
    const generation = personGeneration.get(personId) ?? 0;
    const width = personWidthById.get(personId) ?? options.personWidth;
    const centerX = personX.get(personId) ?? 0;
    const x = options.paddingX + centerX - width / 2;
    const y = generationTop.get(generation) ?? options.paddingY;
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
