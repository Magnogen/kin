const DEFAULT_LAYOUT_OPTIONS = {
  personWidth: 142,
  personHeight: 62,
  personLineHeight: 16,
  personPaddingY: 10,
  personGap: 34,
  generationGap: 158,
  unionSize: 14,
  unionOffsetY: 24,
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
  const seen = new Set();
  const result = [];

  (annotations || []).forEach((entry) => {
    const value = String(entry || "").trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    result.push(value);
  });

  return result;
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
  personGeneration,
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

  const partneredPeople = new Set();
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

    members.forEach((personId) => partneredPeople.add(personId));
  });

  unions.forEach((union) => {
    const children = (union.children || [])
      .map((child) => child.personId)
      .filter(
        (personId) =>
          personSet.has(personId) &&
          (personGeneration.get(personId) ?? 0) === generation &&
          !partneredPeople.has(personId)
      );

    if (children.length < 2) {
      return;
    }

    const anchor = children[0];
    for (let i = 1; i < children.length; i += 1) {
      const childId = children[i];
      adjacency.get(anchor).add(childId);
      adjacency.get(childId).add(anchor);
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

function compactGenerationIntoBlocks(personIds, componentMap, xByPersonId, pinnedByPersonId, minGap) {
  const blocks = [];
  const consumed = new Set();

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

      const anchoredStarts = [];
      ids.forEach((id, index) => {
        if (pinnedByPersonId.get(id)) {
          anchoredStarts.push((xByPersonId.get(id) ?? 0) - index * minGap);
        }
      });

      const width = (ids.length - 1) * minGap;
      const center = average(ids.map((id) => xByPersonId.get(id) ?? 0));
      const start = anchoredStarts.length ? average(anchoredStarts) : center - width / 2;
      blocks.push({ ids, center, width, start });
      return;
    }

    consumed.add(personId);
    const x = xByPersonId.get(personId) ?? 0;
    blocks.push({ ids: [personId], center: x, width: 0, start: x });
  });

  blocks.sort((a, b) => a.center - b.center);

  for (let i = 1; i < blocks.length; i += 1) {
    const prev = blocks[i - 1];
    const block = blocks[i];
    const minStart = prev.start + prev.width + minGap;
    if (block.start < minStart) {
      block.start = minStart;
    }
  }

  const placed = new Map();
  blocks.forEach((block) => {
    block.ids.forEach((personId, index) => {
      placed.set(personId, block.start + index * minGap);
    });
  });

  return placed;
}

export function layoutFamilyTree(ast, userOptions = {}) {
  const options = { ...DEFAULT_LAYOUT_OPTIONS, ...userOptions };
  const people = collectPeople(ast || {});
  const unions = ast?.unions || [];

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

  for (const personId of people.keys()) {
    memberUnionsByPerson.set(personId, []);
    parentUnionsByPerson.set(personId, []);
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
      (union.children || []).forEach((child) => {
        const prev = personGeneration.get(child.personId) ?? 0;
        if (childGeneration > prev) {
          personGeneration.set(child.personId, childGeneration);
          changed = true;
        }
      });
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
  const minGap = options.personWidth + options.personGap;

  const componentsByGeneration = new Map();
  generationKeys.forEach((generation) => {
    const personIds = generations.get(generation) || [];
    const components = buildUnionComponentsForGeneration(
      personIds,
      unions,
      unionGeneration,
      personGeneration,
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
        personX.set(personId, index * minGap);
      });
  });

  const unionX = new Map();
  const getUnionCenterX = (union) => {
    const members = union.members || [];
    const xs = members.map((member) => personX.get(member.personId) ?? 0);
    return xs.length ? average(xs) : 0;
  };

  for (let i = 0; i < options.iterations; i += 1) {
    unions.forEach((union) => {
      unionX.set(union.id, getUnionCenterX(union));
    });

    generationKeys.forEach((generation) => {
      const personIds = generations.get(generation) || [];
      const desiredByPersonId = new Map();
      const pinnedByPersonId = new Map();

      personIds.forEach((personId) => {
        const parentUnionIds = parentUnionsByPerson.get(personId) || [];
        const memberUnionIds = memberUnionsByPerson.get(personId) || [];

        const parentTargets = parentUnionIds
          .map((unionId) => unionX.get(unionId))
          .filter((value) => Number.isFinite(value));
        const memberTargets = memberUnionIds
          .map((unionId) => unionX.get(unionId))
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
        minGap
      );

      personIds.forEach((personId) => {
        const x = compacted.get(personId) ?? (personX.get(personId) ?? 0);
        personX.set(personId, x);
      });
    });
  }

  unions.forEach((union) => {
    unionX.set(union.id, getUnionCenterX(union));
  });

  const personAnnotationsById = new Map();
  const personHeightById = new Map();
  const generationHeight = new Map();

  generationKeys.forEach((generation) => {
    const personIds = generations.get(generation) || [];
    let maxHeight = options.personHeight;

    personIds.forEach((personId) => {
      const meta = people.get(personId);
      const annotations = normalizeAnnotations(meta?.annotations || []);
      personAnnotationsById.set(personId, annotations);

      const lineCount = 1 + annotations.length;
      const computedHeight = options.personPaddingY * 2 + lineCount * options.personLineHeight;
      const height = Math.max(options.personHeight, computedHeight);
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
    const x = options.paddingX + (personX.get(personId) ?? 0);
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
      width: options.personWidth,
      height,
      label: meta?.label || "?",
      annotations,
      kind: meta?.kind || "named",
    });
  }

  unions.forEach((union) => {
    const generation = unionGeneration.get(union.id) ?? 0;
    const centerX = options.paddingX + (unionX.get(union.id) ?? 0) + options.personWidth / 2;
    const centerY =
      (generationTop.get(generation) ?? options.paddingY) +
      (generationHeight.get(generation) ?? options.personHeight) +
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
