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
  const statements = [];
  const people = [];
  const peopleByKey = new Map();
  const unions = [];
  const unionsByKey = new Map();
  const singleParentLinks = [];
  const singleParentLinksByKey = new Map();

  let currentUnion = null;
  let lastEntity = null;

  const addError = (message, token = peek()) => {
    errors.push({
      message,
      start: token?.start ?? -1,
      end: token?.end ?? -1,
      tokenType: token?.type ?? "UNKNOWN",
    });
  };

  const buildUnionKey = (members) =>
    members
      .map((member) => member.personId)
      .sort((a, b) => a - b)
      .join(",");

  const buildSingleParentKey = (parent, child) => `${parent.personId}>${child.personId}`;

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

      const node = {
        type: "ChildDeclaration",
        child,
        start: opToken.start,
        end: child?.end ?? opToken.end,
      };

      if (!currentUnion) {
        addError("Child declaration must follow a union.", opToken);
      } else {
        currentUnion.children.push(child);
        node.unionId = currentUnion.id;
      }

      statements.push(node);
      lastEntity = node;
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
        lastEntity = union;
      } else if (match("EQUAL")) {
        const opToken = peek(-1);
        const child = readPerson("Expected a person after '='.");

        let declaration = null;

        if (firstPerson && child) {
          const key = buildSingleParentKey(firstPerson, child);
          declaration = singleParentLinksByKey.get(key);

          if (!declaration) {
            declaration = {
              type: "SingleParentDeclaration",
              id: singleParentLinks.length,
              parent: firstPerson,
              child,
              annotations: [],
              start: firstPerson.start,
              end: child.end,
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
              parent: firstPerson,
              child,
              start: firstPerson.start,
              end: child.end,
            });
          }

          declaration.occurrences.push({
            start: firstPerson.start,
            end: child.end,
          });
        } else {
          addError("Single-parent declaration must contain both parent and child.", opToken);
        }

        lastEntity = declaration;
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
        lastEntity = node;
      }

      continue;
    }

    addError(`Unexpected token '${peek()?.type ?? "UNKNOWN"}'.`, peek());
    advance();
  }

  return {
    type: "Document",
    unions,
    singleParentLinks,
    people,
    errors,
  };

}