# Kin Language Specification

Version 0.1 - Draft

---

## 1. Introduction

Kin is a human-readable language for describing people and their relationships.
It is designed to support incomplete, uncertain, and evolving information and to be authored directly by humans.

Kin prioritizes simplicity, linearity, and tolerance of ambiguity over strict validation.

---

## 2. Design Goals

Kin is designed to be:

- human-authored and human-readable
- tolerant of unknown or partial information
- line-oriented and append-friendly
- minimal in syntax
- renderer-agnostic
- easy to parse with a simple parser

---

## 3. Terminology

Person: an individual, identified by a textual name.

Union: a relationship context between two or more people.

Child: a person associated with a union.

Annotation: free-form text attached to a person, union, or child.

Unknown person: a person whose identity is unknown, represented using ?.

---

## 4. Lexical Structure

### 4.1 Lines

The input is processed line by line.

Line order is significant.

Empty lines are ignored.

Leading and trailing whitespace on each line is ignored.

### 4.2 Comments

A comment line begins with `#`.

Comment lines are ignored.

### 4.3 Characters

The following characters have special meaning:

`+`  union operator
`=`  child operator
`|`  annotation marker
`?`  unknown person marker

All other characters are treated as literal text.

---

## 5. Persons

### 5.1 Person Declaration

A person is declared by a line containing a name.

Example:

```
Alex
```

A name is any non-empty text not starting with a reserved character.

Names MAY contain spaces.

Names are case-sensitive for display, but tools MAY normalize internally.

### 5.2 Unknown Persons

The token `?` denotes an unknown person.

Unknown persons MAY be combined with additional text to disambiguate identity.

Examples:

```
?
? 1
? maternal
Alex ???
```

Identical unknown tokens refer to the same unknown person.

Different unknown tokens refer to different unknown persons.

---

## 6. Unions

### 6.1 Union Declaration

A union is declared using the `+` operator.

Example:

```
Alex + Barbara
```

A union MUST contain at least two persons.

A union establishes a new relationship context.

### 6.2 Union Continuation

Whitespace around `+` is optional.

Example:

```
Alex+Barbara
```

---

## 7. Children

### 7.1 Child Declaration

A child is declared using the `=` operator following a union.

Example:

```
= Charlie
```

A child declaration MUST follow a union.

The child is a person.

Multiple children MAY be declared for a single union.

---

## 8. Annotations

### 8.1 Annotation Syntax

An annotation line begins with `|`.

Example:

```
| Born 2002
```

### 8.2 Annotation Binding

An annotation applies to the immediately preceding entity.

Valid annotation targets are:

- a person
- a union
- a child

An annotation with no valid preceding entity is invalid.

### 8.3 Annotation Semantics

Annotation text is opaque.

Parsers MUST NOT infer meaning from annotation content.

Tools MAY recognize annotation conventions.

---

## 9. Ordering Rules

Unions apply forward until a new union is declared.

Children apply to the most recent union.

Annotations apply only to the immediately preceding entity.

The same person MAY appear multiple times in the file.

---

## 10. Rendering Guidance

Renderers MAY treat the first annotation of a union as a display label.

Renderers MAY vary visual styling based on annotation content.

Renderers MAY use file order as a layout hint.

Renderers SHOULD visually distinguish unknown persons.

These behaviors do not affect validity.

---

## 11. Error Handling

A parser MUST reject or report:
- a child declaration without a preceding union
- an annotation without a valid preceding entity
- a union with fewer than two persons

A parser MAY recover from errors where possible.

---

## 12. Stability and Extensions

This specification defines the core language.

Extensions SHOULD prefer conventions and annotations over new syntax.

Backwards compatibility is a goal but not guaranteed prior to version 1.0.

---

## 13. Minimal Example

```
Alex + Barbara
| Married 2001
= Charlie
| Born 2002

Charlie + Felicity
= Gertrude

?
| Unknown individual
```

---

## Closing note

This spec is intentionally conservative.
Most semantic meaning is deferred to tooling and rendering layers.
