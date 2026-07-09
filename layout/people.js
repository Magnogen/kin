import { getPersonLabel, normalizeAnnotations } from "./utils.js";

export function collectPeople(ast) {
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
