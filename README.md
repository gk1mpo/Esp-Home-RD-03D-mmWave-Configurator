# Esp-Home-RD-03D-mmWave-Configurator
Config files for my GitHub profile.
## Next Tasks

This section tracks planned improvements and known gaps.
Items are grouped by priority and may be promoted to GitHub Issues
once implementation starts.

---

Next Tasks

This section tracks planned improvements and known limitations.
Items are intentionally explicit to avoid UI drift and Home Assistant state spam.


---

Mobile & Layout

[ ] Normalize mobile portrait vs landscape sizing so both orientations feel consistent

[ ] Prevent canvas from overpowering the UI on small screens

[ ] Reduce canvas height on mobile to preserve space for controls

[ ] Ensure toolbar never clips, overlaps, or overflows on narrow devices

[ ] Improve touch target spacing without scaling the canvas itself



---

Header & Naming

[ ] Update header title to reflect the correct software name

[ ] Display the selected sensor/device name above the room view

[ ] Ensure header text wraps cleanly and does not break layout on mobile



---

Edit Mode Behaviour

[ ] Show Angle Edit and Range Edit controls only when relevant

[ ] Hide all edit-only controls in view mode

[ ] Ensure edit state is visually obvious (selected zone, active handle, mode)

[ ] Keep default UI clean when nothing is selected



---

Home Assistant State Synchronisation

[ ] Prevent HA state spam during live angle edits

[ ] Prevent HA state spam during live range edits

[ ] Apply the same save semantics used for zones to angle/range edits

[ ] Commit angle/range values only on release or explicit save

[ ] Avoid snap-back caused by HA overwriting in-progress edits



---

UI & Settings

[ ] Move hamburger menu to top-right (HA-native convention)

[ ] Align hamburger menu behaviour and style with Better Thermostat

[ ] Replace inline settings with a proper popup/modal

[ ] Ensure settings UI is mobile-safe, scrollable, and dismissible



---

Theme Awareness

[ ] Respect Home Assistant global dark/light theme variables

[ ] Remove hard-coded light colours

[ ] Ensure contrast and readability in both themes

[ ] Make toolbar tiles, grid, overlays, and labels theme-aware



---

Visual Aids (UI-Only, Optional)

[ ] Add direction indicator overlay

[ ] Add velocity indicator overlay

[ ] Add distance markers

[ ] Add target trails / history

[ ] Make all visual aids toggleable via UI settings

[ ] Ensure visual aids do not write state back to HA



---

Zone Navigation

[ ] Add “previous zone” navigation

[ ] Add “last zone” navigation

[ ] Allow quick cycling between zones on mobile



---

Design Guardrails (Non-Negotiable)

[ ] Canvas remains a renderer only

[ ] Model remains the single source of truth

[ ] UI gates edits and controls HA write timing

[ ] No new features that blur these responsibilities



---

How to use this in GitHub (quick recap)

GitHub renders [ ] as checkboxes automatically

You can tick items off as they’re completed

When you start working on a task:

Create a GitHub Issue with the same title

Optionally link it back here:
(see #23)


This section becomes your re-entry point after breaks and a scope boundary during development



---

If you want, next we can:

Trim this further into a “Minimal Next Tasks” version, or

Split this into README roadmap + Issues-only execution, or

Add a short “Known Good Baseline” section above it to lock v5.0 visually and architecturally.


This is exactly the right move to stabilise the project.