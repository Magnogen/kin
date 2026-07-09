export function parse(tokens) {
  let index = 0;

  const peek = (offset = 0) => tokens[index + offset];
  const eof = () => peek()?.type === 'EOF';
  const advance = () => {
    if (!eof()) index++;
    return peek(-1);
  };
  
  const check = (type) => peek()?.type === type;
  const match = (...types) => {
    for (const type of types) {
      if (check(type)) {
        advance();
        return true;
      }
    }
    return false;
  };
  const expect = (type, msg) => {
    if (check(type)) return advance();
    throw new Error(msg);
  };

  const isPersonToken = (token) => token?.type === "TEXT" || token?.type === "UNKNOWN";
  const trimLexeme = (token) => (token?.lexeme ?? "").trim();

  const errors = [];
  const warnings = [];
  const statements = [];
  const people = [];
  const peopleByKey = new Map();
  const unions = [];
  const unionsByKey = new Map();
  const singleParentLinks = [];
  const singleParentLinksByKey = new Map();

  let currentUnion = null;
  let currentSingleParent = null;
  let lastEntity = null;

  const addError = (message, token = peek()) => {
    errors.push({
      message,
      start: token?.start ?? -1,
      end: token?.end ?? -1,
      tokenType: token?.type ?? "UNKNOWN",
    });
  };

  const addSemanticError = (message, start, end, tokenType = "SEMANTIC") => {
    errors.push({
      message,
      start: Number.isFinite(start) ? start : -1,
      end: Number.isFinite(end) ? end : -1,
      tokenType,
    });
  };

  const addSemanticWarning = (
    message,
    start,
    end,
    tokenType = "SEMANTIC",
    details = null
  ) => {
    const warning = {
      message,
      start: Number.isFinite(start) ? start : -1,
      end: Number.isFinite(end) ? end : -1,
      tokenType,
    };

    if (details && typeof details === "object") {
      warning.details = details;
    }

    warnings.push(warning);
  };

  const getPersonLabelById = (personId) => {
    const person = people[personId];
    if (!person) return `#${personId}`;
    return (person.value ?? "").trim() || "?";
  };

  const validateFamilyTreeSemantics = () => {
    const edges = [];

    unions.forEach((union) => {
      const members = union.members || [];
      const children = union.children || [];

      children.forEach((child) => {
        members.forEach((member) => {
          edges.push({
            from: member.personId,
            to: child.personId,
            start: union.start,
            end: union.end,
            tokenType: "UNION",
          });
        });
      });
    });

    singleParentLinks.forEach((link) => {
      edges.push({
        from: link.parent?.personId,
        to: link.child?.personId,
        start: link.start,
        end: link.end,
        tokenType: "SINGLE_PARENT",
      });
    });

    const uniqueSelfLoopKeys = new Set();
    edges.forEach((edge) => {
      if (edge.from == null || edge.to == null) return;
      if (edge.from !== edge.to) return;

      const key = `${edge.from}:${edge.start}:${edge.end}`;
      if (uniqueSelfLoopKeys.has(key)) return;
      uniqueSelfLoopKeys.add(key);

      const label = getPersonLabelById(edge.from);
      addSemanticError(
        `Invalid family tree: '${label}' cannot be their own parent/child.`,
        edge.start,
        edge.end,
        edge.tokenType
      );
    });

    const adjacency = new Map();
    for (const person of people) {
      adjacency.set(person.id, []);
    }

    edges.forEach((edge) => {
      if (edge.from == null || edge.to == null) return;
      if (edge.from === edge.to) return;
      if (!adjacency.has(edge.from)) {
        adjacency.set(edge.from, []);
      }
      adjacency.get(edge.from).push(edge);
    });

    const state = new Map();
    const stackPeople = [];
    const stackEdges = [];
    const reportedCycleKeys = new Set();

    const visit = (personId) => {
      state.set(personId, 1);
      stackPeople.push(personId);

      const outgoing = adjacency.get(personId) || [];
      outgoing.forEach((edge) => {
        const nextId = edge.to;
        const nextState = state.get(nextId) || 0;

        if (nextState === 0) {
          stackEdges.push(edge);
          visit(nextId);
          stackEdges.pop();
          return;
        }

        if (nextState !== 1) {
          return;
        }

        const cycleStartIndex = stackPeople.lastIndexOf(nextId);
        if (cycleStartIndex < 0) {
          return;
        }

        const cyclePeople = stackPeople.slice(cycleStartIndex);
        const cycleEdges = stackEdges.slice(cycleStartIndex);
        cycleEdges.push(edge);

        const normalizedCycleKey = [...new Set(cyclePeople)].sort((a, b) => a - b).join(",");
        if (reportedCycleKeys.has(normalizedCycleKey)) {
          return;
        }
        reportedCycleKeys.add(normalizedCycleKey);

        const cyclePathIds = [...cyclePeople, nextId];
        const cyclePathLabels = cyclePathIds.map((id) => getPersonLabelById(id));
        const cycleStart = Math.min(...cycleEdges.map((item) => item.start ?? -1));
        const cycleEnd = Math.max(...cycleEdges.map((item) => item.end ?? -1));

        addSemanticError(
          `Invalid family tree: ancestry loop detected (${cyclePathLabels.join(" -> ")}).`,
          cycleStart,
          cycleEnd,
          "ANCESTRY_LOOP"
        );
      });

      stackPeople.pop();
      state.set(personId, 2);
    };

    for (const person of people) {
      if ((state.get(person.id) || 0) === 0) {
        visit(person.id);
      }
    }

    if (errors.length) {
      return;
    }

    const adjacencyByParent = new Map();
    const outgoingCountByParent = new Map();
    const parentIdsByChild = new Map();

    for (const person of people) {
      adjacencyByParent.set(person.id, new Set());
      outgoingCountByParent.set(person.id, 0);
    }

    edges.forEach((edge) => {
      if (edge.from == null || edge.to == null) return;
      if (edge.from === edge.to) return;

      if (!adjacencyByParent.has(edge.from)) {
        adjacencyByParent.set(edge.from, new Set());
      }
      const children = adjacencyByParent.get(edge.from);
      const beforeSize = children.size;
      children.add(edge.to);
      if (children.size !== beforeSize) {
        outgoingCountByParent.set(
          edge.from,
          (outgoingCountByParent.get(edge.from) || 0) + 1
        );

        if (!parentIdsByChild.has(edge.to)) {
          parentIdsByChild.set(edge.to, new Set());
        }
        parentIdsByChild.get(edge.to).add(edge.from);
      }
    });

    const generationByPerson = new Map();
    for (const person of people) {
      generationByPerson.set(person.id, 0);
    }

    const maxIterations = Math.max(1, people.length * Math.max(1, edges.length));
    for (let i = 0; i < maxIterations; i += 1) {
      let changed = false;

      adjacencyByParent.forEach((childSet, parentId) => {
        const parentGeneration = generationByPerson.get(parentId) ?? 0;
        childSet.forEach((childId) => {
          const childGeneration = generationByPerson.get(childId) ?? 0;
          const impliedChildGeneration = parentGeneration + 1;
          if (impliedChildGeneration > childGeneration) {
            generationByPerson.set(childId, impliedChildGeneration);
            changed = true;
          }
        });
      });

      if (!changed) {
        break;
      }
    }

    const descendantsMemo = new Map();
    const collectDescendants = (personId) => {
      if (descendantsMemo.has(personId)) {
        return descendantsMemo.get(personId);
      }

      const descendants = new Set();
      const directChildren = adjacencyByParent.get(personId) || new Set();
      directChildren.forEach((childId) => {
        descendants.add(childId);
        const nested = collectDescendants(childId);
        nested.forEach((id) => descendants.add(id));
      });

      descendantsMemo.set(personId, descendants);
      return descendants;
    };

    const warningKeys = new Set();

    const countPathsMemo = new Map();
    const countPathsBetween = (fromId, targetId) => {
      const memoKey = `${fromId}->${targetId}`;
      if (countPathsMemo.has(memoKey)) {
        return countPathsMemo.get(memoKey);
      }

      if (fromId === targetId) {
        countPathsMemo.set(memoKey, 1);
        return 1;
      }

      let total = 0;
      const directChildren = adjacencyByParent.get(fromId) || new Set();
      directChildren.forEach((childId) => {
        total += countPathsBetween(childId, targetId);
      });

      countPathsMemo.set(memoKey, total);
      return total;
    };

    for (const person of people) {
      const childCount = outgoingCountByParent.get(person.id) || 0;
      if (childCount < 1) {
        continue;
      }

      const introStart = person.firstStart;
      if (!Number.isFinite(introStart)) {
        continue;
      }

      const descendants = collectDescendants(person.id);
      if (!descendants.size) {
        continue;
      }

      const alreadyIntroducedDescendants = [...descendants].filter((descendantId) => {
        const descendant = people[descendantId];
        return Number.isFinite(descendant?.firstStart) && descendant.firstStart < introStart;
      });

      if (!alreadyIntroducedDescendants.length) {
        continue;
      }

      const personGeneration = generationByPerson.get(person.id) ?? 0;
      const maxEarlierDescendantGeneration = Math.max(
        ...alreadyIntroducedDescendants.map((descendantId) => generationByPerson.get(descendantId) ?? 0)
      );
      const generationsBackfilled = maxEarlierDescendantGeneration - personGeneration;

      if (generationsBackfilled < 2) {
        continue;
      }

      const key = `${person.id}:${introStart}`;
      if (warningKeys.has(key)) {
        continue;
      }
      warningKeys.add(key);

      const label = getPersonLabelById(person.id);
      const earlierDescendantInfo = alreadyIntroducedDescendants.map((descendantId) => ({
        id: descendantId,
        label: getPersonLabelById(descendantId),
        firstStart: people[descendantId]?.firstStart ?? -1,
        generation: generationByPerson.get(descendantId) ?? 0,
      }));

      const duplicateLabelBuckets = new Map();
      earlierDescendantInfo.forEach((item) => {
        if (!duplicateLabelBuckets.has(item.label)) {
          duplicateLabelBuckets.set(item.label, []);
        }
        duplicateLabelBuckets.get(item.label).push(item.id);
      });

      const duplicateLabels = [...duplicateLabelBuckets.entries()]
        .filter(([, ids]) => ids.length > 1)
        .map(([dupLabel, ids]) => ({ label: dupLabel, ids }));

      const repeatedDescendantsByPath = alreadyIntroducedDescendants
        .map((descendantId) => ({
          id: descendantId,
          label: getPersonLabelById(descendantId),
          pathCount: countPathsBetween(person.id, descendantId),
        }))
        .filter((entry) => entry.pathCount > 1);

      const mergedDescendants = alreadyIntroducedDescendants
        .map((descendantId) => {
          const parentIds = [...(parentIdsByChild.get(descendantId) || new Set())];
          if (parentIds.length < 2) {
            return null;
          }

          return {
            id: descendantId,
            label: getPersonLabelById(descendantId),
            parentIds,
            parentLabels: parentIds.map((parentId) => getPersonLabelById(parentId)),
          };
        })
        .filter(Boolean);

      const warningDetails = {
        code: "LATE_ANCESTOR_INTRO",
        personId: person.id,
        personLabel: label,
        generationsBackfilled,
        earlierDescendantIds: alreadyIntroducedDescendants,
        earlierDescendantLabels: earlierDescendantInfo.map((item) => item.label),
        duplicateLabels,
        repeatedDescendantsByPath,
        mergedDescendants,
      };

      addSemanticWarning(
        `Warning: '${label}' is introduced late as an ancestor ${generationsBackfilled} generations above already-known descendants.`,
        person.firstStart,
        person.firstEnd,
        "LATE_ANCESTOR_INTRO",
        warningDetails
      );
    }
  };

  const buildUnionKey = (members) =>
    members
      .map((member) => member.personId)
      .sort((a, b) => a - b)
      .join(",");

  const buildSingleParentKey = (parent, child) => `${parent.personId}>${child.personId}`;

  const addSingleParentLink = (parent, child, start, end) => {
    if (!parent || !child) {
      return null;
    }

    const key = buildSingleParentKey(parent, child);
    let declaration = singleParentLinksByKey.get(key);

    if (!declaration) {
      declaration = {
        type: "SingleParentDeclaration",
        id: singleParentLinks.length,
        parent,
        child,
        annotations: [],
        start,
        end,
        key,
        occurrences: [],
      };

      singleParentLinksByKey.set(key, declaration);
      singleParentLinks.push(declaration);
      statements.push(declaration);
    } else {
      statements.push({
        type: "SingleParentReference",
        declarationId: declaration.id,
        parent,
        child,
        start,
        end,
      });
    }

    declaration.occurrences.push({ start, end });
    return declaration;
  };

  const readPerson = (contextMessage) => {
    const token = peek();
    if (!isPersonToken(token)) {
      addError(contextMessage, token);
      return null;
    }

    advance();

    const kind = token.type === "UNKNOWN" ? "unknown" : "named";
    const value = trimLexeme(token);
    const key = `${kind}:${value}`;

    let canonicalPerson = peopleByKey.get(key);
    if (!canonicalPerson) {
      canonicalPerson = {
        type: "Person",
        id: people.length,
        kind,
        value,
        annotations: [],
        firstStart: token.start,
        firstEnd: token.end,
        tokenType: token.type,
        occurrences: [],
      };

      peopleByKey.set(key, canonicalPerson);
      people.push(canonicalPerson);
    }

    canonicalPerson.occurrences.push({
      start: token.start,
      end: token.end,
      tokenType: token.type,
    });

    return {
      type: "PersonRef",
      personId: canonicalPerson.id,
      kind,
      value,
      annotations: [],
      start: token.start,
      end: token.end,
      tokenType: token.type,
    };
  };

  const attachAnnotationToPerson = (personRef, text) => {
    if (!personRef || !text) return;

    if (!personRef.annotations) {
      personRef.annotations = [];
    }
    personRef.annotations.push(text);

    const canonical = people[personRef.personId];
    if (!canonical) return;
    if (!canonical.annotations) {
      canonical.annotations = [];
    }
    canonical.annotations.push(text);
  };

  while (!eof()) {
    if (match("EQUAL")) {
      const opToken = peek(-1);
      const child = readPerson("Expected a person after '='.");

      if (currentSingleParent) {
        const link = addSingleParentLink(
          currentSingleParent,
          child,
          opToken.start,
          child?.end ?? opToken.end
        );
        lastEntity = link;
      } else {
        const node = {
          type: "ChildDeclaration",
          child,
          start: opToken.start,
          end: child?.end ?? opToken.end,
        };

        if (!currentUnion) {
          addError("Child declaration must follow a union or parent person declaration.", opToken);
        } else {
          currentUnion.children.push(child);
          node.unionId = currentUnion.id;
        }

        statements.push(node);
        lastEntity = node;
      }

      continue;
    }

    if (match("PIPE")) {
      const pipeToken = peek(-1);
      const annotationTarget = lastEntity;
      let text = "";

      if (isPersonToken(peek())) {
        text = trimLexeme(advance());
      }

      const node = {
        type: "Annotation",
        text,
        targetType: annotationTarget?.type ?? null,
        targetId: annotationTarget?.id ?? null,
        start: pipeToken.start,
        end: text ? peek(-1).end : pipeToken.end,
      };

      if (!annotationTarget) {
        addError("Annotation must follow a person, union, or child.", pipeToken);
      } else {
        if (!annotationTarget.annotations) {
          annotationTarget.annotations = [];
        }
        annotationTarget.annotations.push(text);

        if (annotationTarget.type === "ChildDeclaration") {
          attachAnnotationToPerson(annotationTarget.child, text);
        } else if (annotationTarget.type === "PersonDeclaration") {
          attachAnnotationToPerson(annotationTarget.person, text);
        } else if (annotationTarget.type === "SingleParentDeclaration") {
          attachAnnotationToPerson(annotationTarget.child, text);
        } else if (annotationTarget.type === "SingleParentReference") {
          attachAnnotationToPerson(annotationTarget.child, text);
        }
      }

      statements.push(node);
      continue;
    }

    if (isPersonToken(peek())) {
      const firstPerson = readPerson("Expected a person.");
      const members = firstPerson ? [firstPerson] : [];

      let sawPlus = false;
      while (match("PLUS")) {
        sawPlus = true;
        const nextPerson = readPerson("Expected a person after '+'.");
        if (nextPerson) members.push(nextPerson);
      }

      if (sawPlus) {
        if (members.length < 2) {
          addError("Union declaration must contain at least two persons.", peek(-1));
        }

        const unionKey = buildUnionKey(members);
        let union = unionsByKey.get(unionKey);

        if (!union) {
          union = {
            type: "UnionDeclaration",
            id: unions.length,
            members,
            children: [],
            annotations: [],
            start: members[0]?.start ?? peek(-1)?.start ?? -1,
            end: members[members.length - 1]?.end ?? peek(-1)?.end ?? -1,
            key: unionKey,
            occurrences: [],
          };

          unionsByKey.set(unionKey, union);
          unions.push(union);
          statements.push(union);
        } else {
          const unionReference = {
            type: "UnionReference",
            unionId: union.id,
            members,
            start: members[0]?.start ?? peek(-1)?.start ?? -1,
            end: members[members.length - 1]?.end ?? peek(-1)?.end ?? -1,
          };
          statements.push(unionReference);
        }

        union.occurrences.push({
          start: members[0]?.start ?? peek(-1)?.start ?? -1,
          end: members[members.length - 1]?.end ?? peek(-1)?.end ?? -1,
        });

        currentUnion = union;
        currentSingleParent = null;
        lastEntity = union;
      } else if (match("EQUAL")) {
        const opToken = peek(-1);
        const child = readPerson("Expected a person after '='.");

        if (!firstPerson || !child) {
          addError("Single-parent declaration must contain both parent and child.", opToken);
          currentSingleParent = firstPerson;
          lastEntity = null;
        } else {
          const declaration = addSingleParentLink(
            firstPerson,
            child,
            firstPerson.start,
            child.end
          );
          currentSingleParent = firstPerson;
          currentUnion = null;
          lastEntity = declaration;
        }
      } else {
        const node = {
          type: "PersonDeclaration",
          id: statements.length,
          person: firstPerson,
          annotations: [],
          start: firstPerson?.start ?? -1,
          end: firstPerson?.end ?? -1,
        };

        statements.push(node);
        currentSingleParent = firstPerson;
        lastEntity = node;
      }

      continue;
    }

    addError(`Unexpected token '${peek()?.type ?? "UNKNOWN"}'.`, peek());
    advance();
  }

  validateFamilyTreeSemantics();

  return {
    type: "Document",
    unions,
    singleParentLinks,
    people,
    errors,
    warnings,
  };

}