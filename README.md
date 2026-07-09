# Kin

Kin is a minimalist, line-oriented domain-specific language designed for mapping out people, lineages, and family relationships in plain text.
This repository hosts the **Kin Interactive Workspace**—a split-screen web application featuring a live text editor on the left and a dynamic, zoomable/pannable canvas layout viewer on the right.

## Why Kin?

Standard genealogical software is rigid and forces you to fill out dense forms. Kin is built around the reality of research: information is often incomplete, messy, and evolving.
 * **Human-First:** Write family trees as fast as you can type.
 * **Tolerant of Ambiguity:** Easily map unknown or missing relatives using the ? token.
 * **Append-Friendly:** Built to be line-oriented so you can easily append new discoveries.

## The Core Concept

Kin uses a handful of intuitive symbols to build complex visual layouts:

```
Alex + Barbara        # Create a union
| Married 2001        # Attach details to that union
= Charlie             # Add a child to the union
| Born 2002           # Attach details to the child
```

When typed into the workspace editor, this instantly generates a visual, connected tree node infrastructure on the canvas.

## Live Workspace Features

 * **Split-Screen Execution:** Write text on the left, watch the visual graph generate on the right in real-time.
 * **Infinite Canvas Viewer:** Zoom, pan, and drag your way through massive, multi-generational lineage trees without losing performance.
 * **Unknown Entity Highlighting:** Visual cues specifically designed to emphasize missing research links (like ? maternal grandmother).

## Syntax Cheat Sheet

Kin's parser relies on four simple character markers:

| Operator | Name | Example | Description |
|---|---|---|---|
| + | **Union** | Alex + Barbara | Establishes a relationship context between two or more people. |
| = | **Child** | = Charlie | Attaches a child to the preceding union context (or single parent). |
| | | **Annotation** | | Born 1950 | Attaches free-form metadata/notes to the immediate line above it. |
| ? | **Unknown** | ? 1 + David | Represents a person whose identity is currently unknown. |

### Layout Rules to Remember

 1. **Forward Flow:** Unions and parent contexts apply downward until a new one is declared.
 2. **Strict Binding:** Annotations (|) always latch onto the *exact line* right above them.
 3. **Unique Unknowns:** ? 1 and ? 2 will render as separate mystery nodes, while repeated uses of ? 1 link back to the exact same unknown individual.

## Getting Started

I've set up this repository with GitHub Pages, so you can just go to Https://magnogen.net/kin/ and have fun!

Alternatively, you can...

## Getting Started Locally

To run the web editor and layout engine locally on your machine:

```bash
# Clone the repository
git clone https://github.com/Magnogen/kin.git
cd kin

# Start the development server
bunx http-server . # or some other http alternative
```

Open http://localhost:8080 (or the configured local port) in your browser to start mapping.

> **Looking for the technical implementation?**
> The formal grammar rules, error-handling states, and parser rules are documented in the [Kin Language Specification](/SPEC.md).

## Contribution

Extensions to Kin should favor conventions and annotations over adding new syntax symbols. If you find a layout rendering bug or have an idea for canvas controls, feel free to open an issue!
