# Project Raptor — Technical Brief for a Loadable Template

> Historical design brief. The five script-generated phase templates were replaced in v0.3.17 by
> the single in-app-authored `src/examples/raptor-clone.json`. Keep this document as source/design
> context; it is no longer a generator contract. Refresh the bundled example by editing/exporting it
> in PVC Builder as described in `src/examples/CONTEXT.md`.

A durable engineering brief for approximating Esmée Kramer's **"Project Raptor"** — a wearable,
walk‑around raptor dinosaur costume built from a PVC/tube frame with articulated mechanisms — as a
series of loadable PVC Builder templates the user can pose and simulate.

**Primary sources (all on this machine):**

- **Article prose** — `~/Downloads/Project Raptor_ In Depth – Esmee Kramer Portfolio.html`
  (Esmée Kramer, "Project Raptor: In Depth", 2 Mar 2023). Sections quoted below as **[Body]**,
  **[Head&Neck]**, **[Legs]**, **[Tail]**, **[Foam]**, **[Sound]**.
- **Mechanism sketches** — `…Portfolio_files/2020-Raptor-Final-Sketches-{1..8}-*.jpg`, plus
  `2019-Raptor-15-Neck-*.jpg` (build photo of the neck joint) and `2019-Raptor-24-Sketch-*.jpg`
  (full‑body concept). Cited below as **[S1]…[S8]**, **[Neck photo]**, **[Concept]**.

This is a **fresh start in PVC Builder** — the model is designed from the costume description +
sketches + standard human proportions, authored natively as PVC Builder nodes/members/joints. (No
external rig is used or adapted.)

> **Note on precision.** Kramer publishes almost no numeric dimensions. All metre values below are
> **derived estimates** from (a) the stated wearer‑as‑fulcrum geometry, (b) a standard adult wearer
> (~1.75 m tall, shoulder width ~0.46 m, hip width ~0.36 m), and (c) proportions read off the
> sketches. Every number is flagged as an assumption; treat them as starting values for the build,
> tunable in‑tool.

---

## 1. Overview

**What it is.** A ~1.5‑scale (life‑ish for a small *Deinonychus*/raptor) walk‑around costume. The
wearer stands **upright inside a PVC frame worn on the hips + shoulders**; the raptor's body extends
**horizontally** around and in front of them — long neck + head reaching forward, long tail
cantilevered behind — so the silhouette is a horizontal theropod while the human inside is vertical.
The legs of the raptor are **decorative props attached to the wearer's own shoes**, not weight‑bearing
stilts. **[Body][Legs][Concept]**

**How it is worn — the seesaw principle (the single most important idea).**
> "The red dots … are rotatable points. These make the body function as a **seesaw in which I am the
> fulcrum**. By pulling/pushing the neck the body leans forward or backward, but for this to work
> **both sides (head and tail) need to be around the same weight**." **[Body]**

The horizontal body frame pivots about **rotatable points at the wearer's hips** (the red dots in
**[S1]** side view, drawn as blue saddle blocks at the lower corners). Neck+head on the front arm and
tail on the rear arm are **mass‑balanced about the hip pivot** so the whole assembly hangs level and
can be tipped fore/aft with little back strain. This balance requirement drives the entire phased
build below.

**Load path.** Weight rides mainly on the **hips**: bent PVC "harness" bows go over the shoulders and
are tied by **diagonal pipes down to a horizontal rectangle at the waist**, so most load lands on the
hips; foam pads the contact and a **belt** + back‑brace keep it located. **[Body][S2][S3]**

**Overall scale (derived estimate).**

| Quantity | Estimate | Basis |
|---|---|---|
| Wearer height | 1.75 m | standard adult wearer (assumption) |
| Hip‑pivot height (frame height off ground) | ~1.0 m | waist height of a 1.75 m wearer |
| Body rectangle (fore‑aft × width) | ~0.9 m × ~0.5 m | **[S1]** top view, ~hip width 0.36 m + clearance |
| Harness bow rise (rectangle → shoulder) | ~0.45 m | shoulder‑to‑waist drop **[S2][S3]** |
| Neck reach (hip pivot → head), horizontal | ~0.8–1.0 m | **[S4]** seesaw beam, **[Concept]** |
| Head length | ~0.35 m | skull outline **[S4][S6‑left]** |
| Tail length (root → tip) | ~1.4–1.6 m | **[S8]** taper, balances neck+head **[Concept]** |
| Decorative leg length (hip→toe) | ~0.7 m | **[S6]** three‑segment leg |
| Nose‑to‑tail overall | ~2.6–3.0 m | sum of the above |

---

## 2. Skeleton / topology

Major segments and how they attach (see **[Concept]** for the whole silhouette; **[S1]–[S3]** for the
body frame; **[S4]** for the master assembly):

1. **Body / hip core (the load frame).** A **horizontal rectangle** (~0.9 × 0.5 m) at waist height,
   with **two shoulder "harness" bows** (heat‑bent inverted‑U pipes) rising off it and passing over
   the wearer's shoulders, tied back to the rectangle by **diagonal struts** (2 front + 2 back).
   **[S2][S3]** A **conduit box** (a 3D‑printed split clamp, **[Neck photo]**) is fixed to the front
   of the rectangle as the neck's mounting socket. Two inner rectangle pipes are removable and double
   as **ground‑support legs** when the costume is set down. **[Body][S1 top view]**
   - Note **[Body]**: a short **¾" sleeve over a ⅝" pipe** at front & back of the harness locates the
     outer diagonals. Real build mixes ⅝" and ¾"; our tool only offers ½" and ¾", so map to those.

2. **Neck + head (the seesaw + steer).** A **beam of three ¾" pipes duct‑taped together** passes
   through the conduit box; the box + a **rope** form a near‑ball joint that allows left/right,
   up/down, and slight **roll** of the neck. Forward of the box: the neck rises to the **head/jaw**.
   Aft of the box: a short **"steer" handle** the wearer holds. The whole thing is a seesaw about the
   conduit box; **elastics** hold head‑end **up** at rest. **[Head&Neck][S4][S5][Neck photo]**

3. **Tail.** A **tapering, segmented cantilever** off the **rear of the rectangle**, ~1.4–1.6 m,
   with **two inflection (flex) points** made of **garden hose**, a **fiberglass rod threaded through
   the top pipe** to spring it back straight, and **crossed cables**. **Clickable + screwed joints**
   make it detachable for transport. **[Tail][S8][S7‑left]**

4. **Two legs (decorative).** Digitigrade (reverse‑knee) three‑segment PVC legs — **thigh, shin,
   foot/paw** — hung beside the wearer's real legs and **strapped to the shoes**; **elastics** return
   the heel and toes. Not load‑bearing. **[Legs][S6]**

5. **Two mini‑arms.** One pipe each, hung off the **front conduit box**; uncontrolled (hands are
   full), with a **reel rope** to tuck them in when grounding the costume. **[Legs]**

**Build approach:** author the whole model natively in PVC Builder from the proportions above —
chains of straight/heat‑bent pipes joined by our `anchor` (rigid), `wrapped` (1‑DOF swivel), and
`free` (3‑DOF ball) joints, with `elastic` bands for the spring‑returns/counterbalance, resting on
the static mannequin. Derive all **proportions from anatomy + the ~1.75 m wearer**.

---

## 3. Mechanisms, one per articulation

For each: what moves, what drives it, the return element, and DOF/axis.

### 3.1 Body seesaw (fulcrum at the hips)
- **Motion:** the whole horizontal frame tips **fore/aft (pitch)** about the wearer's hips.
- **Driven by:** the wearer's torso lean + push/pull on the steer. **[Body]**
- **Pivot:** the "red dots" — a **revolute pair, one per hip, sharing a left‑right (x) axis** →
  effectively **1 pitch DOF**. **[S1 side view]** (blue saddle blocks low on each side).
- **Return / balance:** none active — **mass balance** (tail ≈ neck+head weight) keeps it level.

### 3.2 Neck (the conduit‑box joint) + steer
- **Motion:** neck yaws **left/right**, pitches **up/down**, and **rolls** slightly about its own
  axis → head shakes/tilts. **[Head&Neck]**
- **Driven by:** the wearer moving the **steer** (rear handle); the neck beam is one rigid stick, so
  moving the steer end moves the head end oppositely (a second seesaw). **[S4][S5]**
- **Pivot:** pipes pass through a **conduit box + rope** — the rope's slack gives a **~3‑DOF ball‑ish
  joint** (yaw about vertical y, pitch about horizontal x, limited roll about the neck axis).
  **[Head&Neck][Neck photo]**
- **Return:** **elastics (green in sketches)** hold the head **up** at rest, so the wearer only pulls
  the steer **up** to lower the head (gravity‑assist balancing the heavier head end). **[Head&Neck][S5]**

### 3.3 Head aim + jaw
- **Head aim:** **two extra joints** at the head (one horizontal, one vertical), **mirrored by two
  joints on the steer**, **synchronized by ropes (blue in sketches)** — rotating the steer about its
  own axes re‑aims the head independently of neck position. DOF: **2 (head pan + tilt)** on top of the
  neck's 3. **[Head&Neck][S5‑left]**
- **Jaw (mouth):** opened via a **Bowden cable** (old **bike‑brake cable**: fixed casing at both
  ends, inner wire pulls) so mouth control is **decoupled from all neck/head rotations**. DOF: **1
  hinge (jaw open/close)**, sprung/elastic‑closed. **[Head&Neck][S7‑right]**

### 3.4 Tail
- **Motion:** side‑to‑side **swing** + passive droop, bending at **two inflection points**.
- **Driven by:** a **slight swing of the wearer's body** (hands are full). **[Tail]**
- **Pivots:** the two **garden‑hose flex sections** behave like **compliant universal joints** (bend
  in any direction) between three rigid tail segments. **[S8]**
- **Return:** a **fiberglass rod in the top pipe** springs the tail **back to straight**; **crossed
  cables** couple/limit the bend. **[Tail][S8]**
- **Detachable:** clickable + **screwed** joints at the root for transport. **[Tail][S7‑left]**

### 3.5 Legs + paws (decorative)
- **Motion:** follow the wearer's real leg; **three segments** (thigh/shin/foot), **digitigrade** so
  the raptor "heel" bends **backward** where the human knee bends forward. **[Legs][S6]**
- **Pivots:** **hip pivot** and **knee/ankle pivots** (blue dots in **[S6‑right]**) — **1‑DOF hinges**,
  swing axis left‑right (x). Paw strapped to the shoe.
- **Return:** **elastic from thigh‑top down to the foot** lifts the **heel** with the leg, and a second
  **elastic rope** stops the **toes** getting stuck up. **[Legs][S6‑left green line]**

### 3.6 Mini‑arms
- One pipe each off the front conduit box; **no active control**, just a **tuck‑in reel rope**.
  Effectively a **free/loose hang**. **[Legs]**

---

## 4. Mapping to PVC Builder primitives

Our primitives: **straight** ½"/¾" pipe; **formed** (heat‑bent) spline pipe; joints **`anchor`**
(rigid/welded), **`wrapped`** (1‑DOF revolute about the receiver's axis), **`free`** (3‑DOF ball);
**elastic band** (tension spring between two points, in the physics sim); **static mannequin**
(head/shoulders/waist/arms/legs/hand+foot) for collision/rest.

| Mechanism | DOF / axis | Buildable? | How to build it |
|---|---|---|---|
| **Harness bows** | — | ✅ | `formed` inverted‑U pipes; `anchor` to the rectangle. Rest the bows **on the mannequin's shoulders**; frame collides with **waist**. |
| **Body rectangle + diagonals** | rigid | ✅ | `straight` ¾" pipes, `anchor` joints; a 3D truss. |
| **Hip seesaw (pitch)** | 1 (pitch, x) | ✅ | Two `wrapped` joints, **one per hip**, both about a **left‑right (x) receiver pipe** through the frame → a shared pitch axis. The receiver is a short cross‑pipe at the wearer's hip line, resting on the **mannequin waist/hip**. Balance via §5. |
| **Neck conduit‑box joint** | ~3 (yaw+pitch+roll) | ✅ (as `free`) | One **`free`** ball joint at the conduit‑box node; `wrapped` alone can't give the extra pitch/roll. Optionally add a `wrapped` about the neck axis for the deliberate **roll**. |
| **Neck ↔ steer seesaw** | shares neck joint | ✅ | Model neck + steer as **one rigid formed/straight beam** through the `free` joint (mover on one side, steer stub the other). |
| **Elastic head‑up return** | — | ✅ | **Elastic band** from a high point on the front harness bow to the **head‑side** of the neck beam; pulls head up at rest. |
| **Head pan+tilt (2 synced joints)** | 2 | ⚠️ partial | Build the head‑end **pan** + **tilt** as two stacked `wrapped` joints (axes vertical + horizontal). We **cannot** model the **rope synchronization to the steer** (no cable/tendon primitive) — pose the two joints directly instead. |
| **Jaw (Bowden)** | 1 hinge | ⚠️ geometry only | Jaw as a `wrapped` hinge (axis = left‑right x) with an **elastic** for the sprung‑closed return. The **Bowden cable actuation is not modelable** (no cable primitive); the user poses the hinge. |
| **Tail flex points** | ~2×(2–3) | ⚠️ approximate | Represent each **garden‑hose section as a `free` joint** between rigid tail segments (best available for "bends any direction"). Two `free` joints → a 2‑segment‑bend tail. A `formed` spline can render the taper cosmetically but won't articulate. |
| **Tail straight‑return (fiberglass rod)** | — | ✅ (approx) | **Elastic bands** spanning across each `free` tail joint (top + sides) to pull it back to straight — mimics the rod + crossed cables. |
| **Leg hinges (hip/knee/ankle)** | 1 each (x) | ✅ | `wrapped` hinges about left‑right (x) receiver pipes; three `straight` segments (digitigrade layout: shin angles back). Rest/attach the paw at the **mannequin's foot**; hip near the **mannequin leg/hip**. |
| **Leg heel/toe elastic** | — | ✅ | **Elastic bands** thigh‑top→foot and foot→toe, as in **[S6]**. |
| **Mini‑arms** | loose | ✅ | One `straight` pipe each, `free` joint at the conduit box (loose hang). Skip the reel rope. |
| **Foam plates, speaker, RPi, sounds** | — | ❌ skip | Cosmetic/electronic; **not** structural — out of scope for the tool. **[Foam][Sound][Concept]** |

**Explicitly cannot build yet (and why):**
- **Cable/rope synchronization** (head↔steer ropes, jaw Bowden, tail crossed cables, arm reel):
  we have no **tendon/cable** primitive that couples two joints. Model the *joints*; let the user
  pose them; approximate *returns* with elastics only.
- **Compliant continuous bends** (garden‑hose, fiberglass springiness): we only have discrete joints,
  so a smooth flex becomes **one or two `free` joints + elastics** — a good enough kinematic stand‑in.
- **The wearer as an active fulcrum:** the mannequin is **static** (collision/rest only), so the
  seesaw is posed by the user, not driven by a body model. Fine for pose/sim; note it in‑tool.

---

## 5. Proposed phased build (five loadable templates)

Each template is a `Design` stored at schemaVersion 9 and migrated to the current schema on load. It
**extends the previous** — same node ids reused so they stack cleanly, in the spirit of the bundled
examples (`src/examples/*.json`, `src/examples/index.ts`). Sizes: harness/frame/neck **¾"**,
legs/tail/arms **½"** unless noted.
Coordinates: **+x** = wearer's right, **+y** = up, **+z** = forward (nose direction). Hip‑pivot line
at **y ≈ 1.0 m, z ≈ 0**. All numbers are **estimates to tune in‑tool**.

### Phase 1 — Torso / hip core (mounts on the mannequin)
- **Nodes/members (~14 nodes, ~16 pipes):** horizontal rectangle 0.9 (z) × 0.5 (x) m at y≈1.0;
  4 corner uprights/short posts; 2 heat‑`formed` shoulder bows rising ~0.45 m over the shoulders;
  4 diagonal struts (2 front, 2 back) bow→rectangle; 1 front cross‑pipe carrying the **conduit‑box
  node**; 1 rear cross‑pipe carrying the **tail‑root node**.
- **Joints:** all `anchor` **except** the two **`wrapped` hip pivots** (one per side) about a
  left‑right (x) hip cross‑pipe → the seesaw pitch axis.
- **Mannequin:** shoulder bows **rest on the shoulders**; rectangle **collides with the waist**;
  belt line at the waist.
- **Balance:** empty frame is roughly symmetric about the hip line; verify it hangs level before
  adding cantilevers.

### Phase 2 — + Tail (rear cantilever, the counterweight)
- **Add (~6 nodes, ~4 members):** 3 tapering tail segments (¾"→½") from the rear cross‑pipe going
  **−z and down**, ~1.4–1.6 m total; render taper as a `formed` spline if desired.
- **Joints:** `anchor` at the root (detachable in reality); **2 `free` joints** at the two garden‑hose
  inflection points.
- **Elastics:** across each `free` joint (top + both sides) → the fiberglass‑rod straight‑return.
- **Balance strategy (core):** size/position the tail so its moment about the hip pivot **pre‑loads
  the rear**, anticipating the neck+head added in Phase 4. Target: **tail moment ≈ future
  (neck+head) moment** so the seesaw sits level. This is why the tail is built **before** the neck.

### Phase 3 — + Legs (decorative)
- **Add (~8 nodes, ~6 members):** two digitigrade legs (thigh/shin/foot) hung beside the wearer,
  paw node at the **mannequin foot**.
- **Joints:** `wrapped` hip, knee, ankle hinges (x‑axis).
- **Elastics:** thigh‑top→foot (heel lift) and foot→toe (toe hold‑up), per **[S6]**.
- **Balance:** legs hang near the hip line → **near‑zero net moment**; don't disturb the seesaw.

### Phase 4 — + Neck (front cantilever)
- **Add (~4–5 nodes, ~3 members):** neck beam through the conduit‑box node going **+z and up**
  ~0.8–1.0 m to a head‑base node; a short **steer stub** aft of the conduit box.
- **Joints:** one **`free`** joint at the conduit box (yaw+pitch+roll); optional `wrapped` roll about
  the neck axis.
- **Elastics:** front harness bow → head‑side of the neck beam (**head‑up return**).
- **Balance:** with the tail from Phase 2 present, **tune neck length / counter‑position the tail**
  until the assembly hangs **level about the hip pivot** (tail moment = neck+head moment). Add the
  two mini‑arms here as loose `free` pipes off the conduit box.

### Phase 5 — + Head / jaw
- **Add (~4 nodes, ~3 members):** skull box (~0.35 m) at the head base; a lower‑jaw pipe.
- **Joints:** head **pan** + **tilt** as two stacked `wrapped` hinges; **jaw** as a `wrapped` hinge.
- **Elastics:** jaw sprung‑closed elastic; (head‑up elastic already from Phase 4).
- **Balance:** the head is the heaviest front element — re‑check tail counterweight and, if needed,
  extend the tail or shift its mass rearward so the level‑hang condition still holds.

---

## 6. Open questions / assumptions

1. **All metre dimensions are estimates.** Kramer gives no measurements; values come from a standard
   ~1.75 m wearer, sketch proportions, and the fulcrum geometry. Confirm against video stills if a
   tighter build is wanted.
2. **Pipe sizes — RESOLVED.** The wearer is modifying ¾" PVC to accept ½" PVC (heat‑spread +
   drilled), so we freely mix **½" and ¾"** and assume the connections work — no size‑mismatch
   special‑casing. Use ¾" for the load frame/neck beam, ½" for tail/legs/arms. (Real build also had
   ⅝"; treat that as ¾".)
3. **Conduit‑box joint = `free`.** It is really a clamp + rope with limited roll; `free` (3‑DOF) is
   the closest primitive. If roll must be independent, add a `wrapped` roll DOF.
4. **Tail flex.** Continuous garden‑hose compliance is discretized to **2 `free` joints + elastics**;
   segment count and elastic stiffness are guesses to tune for a natural droop/swing.
5. **No cable/tendon primitive.** Every rope/Bowden synchronization (head↔steer, jaw, tail cross‑cables,
   arm reel) is **omitted**; only spring **returns** (elastics) are modeled. Head aim + jaw are posed
   directly.
6. **Mannequin is static.** The seesaw is user‑posed against a rigid body; we don't simulate the
   wearer actively driving it. Balance is validated as "hangs level", not as "comfortable to wield".
7. **Hip‑pivot placement.** Assumed a single shared left‑right (x) pitch axis at the waist. If the
   real red dots sit slightly forward/back of the hip, the balance target shifts — expose the pivot
   node position as the main tuning knob.
8. **Fresh start, authored in PVC Builder.** The model is built natively from the costume description,
   sketches, and anatomy — no external rig is adapted.

---

*Citations key:* **[Body]/[Head&Neck]/[Legs]/[Tail]/[Foam]/[Sound]** = article sections;
**[S1]…[S8]** = `2020-Raptor-Final-Sketches-1…8`; **[Neck photo]** = `2019-Raptor-15-Neck`;
**[Concept]** = `2019-Raptor-24-Sketch`.
