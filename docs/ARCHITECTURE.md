# EP Zone Configurator – Architecture Lock (v4.4)

## Purpose

This document captures the **agreed architectural intent** for the EP Zone Configurator at version **v4.4**.

It exists to:

* Prevent scope creep and design drift
* Preserve the mental model agreed at this point in time
* Act as a shared reference for future work and review

This is a **design lock**, not an implementation guide.

---

## Baseline

* **Version:** v4.4 (Known Good Baseline)
* All changes after this point must be incremental
* No refactors without an explicit task in README → Next Tasks

---

## Core Principle (Single Sentence Rule)

> External systems may notify the model, but **only the model decides whether to listen**.

This rule overrides convenience and short-term fixes.

---

## System Roles and Authority

### Home Assistant (External System)

* Noisy, asynchronous, global updates
* Never authoritative during local edits
* Provides observations, not commands

### Card (Orchestrator)

* Translates UI intent into model signals
* Owns no state authority
* Does not interpret HA data

### HassAdapter / HassHandler (Translator)

* Converts HA state → typed domain snapshot
* Converts committed domain snapshot → HA service calls
* No policy decisions
* No edit or suppression logic

### RadarModel (Authority)

* Single source of truth for radar state
* Owns edit lifecycle and validity
* Decides whether external updates are accepted, ignored, or deferred

### Canvas (Renderer)

* Draws only
* No logic
* No HA knowledge

---

## Edit Lifecycle (Authoritative)

The model defines and owns edit state.

### States

* clean
* editing
* committed

### Procedures (Minimal API)

* beginEdit(source)
* updateLive(change)
* commitEdit()
* abortEdit() (optional)
* isEditing()
* isDirty()

Rules:

* Live edits update the model only
* HA is never updated during editing
* HA writes occur only on commit

---

## Data Flow Model

### RECEIVE (HA → Model)

1. set hass() fires (unavoidable heartbeat)
2. Card forwards hass to HassAdapter
3. HassAdapter extracts **typed RadarSnapshot** only
4. RadarModel.acceptExternalSnapshot(snapshot)
5. Model decides: accept / ignore / partial accept

### TRANSMIT (Model → HA)

1. User presses Save
2. RadarModel.commitEdit()
3. Card observes commit signal
4. HassAdapter.pushCommit(snapshot)
5. HA services invoked

---

## RadarSnapshot (Domain Contract)

The only data shape allowed across the HA boundary.

```text
RadarSnapshot
- pose
  - angleDeg
  - rangeM
- zones[]
- targets[]
```

Rules:

* No HA entity IDs
* No attributes blobs
* No flags or UI state
* Domain data only

---

## Function Responsibility Mapping

### Moves to HassAdapter

* getAvailableDevices()
* HA parsing logic from _loadZonesFromHA()
* HA parsing logic from syncModelFromHA()

### Moves to RadarModel

* Suppression / acceptance logic
* Edit state tracking
* Dirty / committed authority

### Remains in Card

* UI event wiring
* Intent orchestration
* Calling adapter and model procedures

### Removed as Concepts

* HA suppression flags in card
* Conditional HA writes during edit
* Policy logic in syncModelFromHA()

---

## Migration Order (Non-Negotiable)

1. Freeze baseline (v4.4)
2. Introduce HassAdapter (no wiring)
3. Move HA parsing into adapter
4. Route HA snapshots to model
5. Move suppression authority into model
6. Wire commit-only HA writes
7. Cleanup redundant flags

At each step, behaviour must remain stable before proceeding.

---

## Drift Guardrails

Stop and reassess if any code:

* Reads hass.states[] outside HassAdapter
* Decides edit or suppression outside RadarModel
* Writes to HA outside HassAdapter

Keyword reminder if instability reappears: **déjà vu**

---

## Closing Statement

This document is the **single source of architectural intent** for the EP Zone Configurator post-v4.4.

If a future change conflicts with this document, the change is paused until intent is updated here first.
